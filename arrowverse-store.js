(function (root) {
  'use strict';

  const Data = root.ArrowverseData;
  const STORAGE_KEY = Data.STORAGE_KEY;
  const SYNC_ID_KEY = 'arrowverseSyncUserIdV1';
  const DEFAULT_TABLE = 'arrowverse_progress';

  let syncStatus = {
    state: 'local',
    message: 'Local only',
    updatedAt: null,
  };

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getConfig() {
    return root.ARROWVERSE_SUPABASE_CONFIG || null;
  }

  function hasUsableSupabaseConfig() {
    const config = getConfig();
    return Boolean(
      config &&
      config.url &&
      config.anonKey &&
      !String(config.url).includes('YOUR_PROJECT') &&
      !String(config.anonKey).includes('YOUR_SUPABASE_ANON_KEY')
    );
  }

  function getSupabaseClient() {
    if (!hasUsableSupabaseConfig() || !root.supabase || !root.supabase.createClient) {
      return null;
    }

    const config = getConfig();
    if (!root.__arrowverseSupabaseClient) {
      root.__arrowverseSupabaseClient = root.supabase.createClient(config.url, config.anonKey);
    }
    return root.__arrowverseSupabaseClient;
  }

  function getTableName() {
    return (getConfig() && getConfig().table) || DEFAULT_TABLE;
  }

  function setSyncStatus(state, message) {
    syncStatus = {
      state,
      message,
      updatedAt: Date.now(),
    };
    root.dispatchEvent?.(new CustomEvent('arrowverse-sync-status', { detail: syncStatus }));
  }

  function parseTimestamp(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function generateUuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) =>
      (Number(char) ^ root.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(char) / 4).toString(16)
    );
  }

  function readLocalValue(key) {
    try {
      return root.localStorage && root.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeLocalValue(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures on pages that restrict localStorage.
    }
  }

  function getSyncUserId() {
    let userId = readLocalValue(SYNC_ID_KEY);
    if (!userId) {
      userId = generateUuid();
      writeLocalValue(SYNC_ID_KEY, userId);
    }
    return userId;
  }

  function setSyncUserId(userId) {
    const safe = String(userId || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(safe)) {
      throw new Error('Invalid sync ID');
    }
    writeLocalValue(SYNC_ID_KEY, safe);
    return safe;
  }

  function readLocalMirror() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeLocalMirror(progress) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
      }
    } catch {
      // Some streaming pages restrict storage; chrome.storage remains the source of truth.
    }
  }

  function readChromeStorage() {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve(null);
        return;
      }

      chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(result && result[STORAGE_KEY] ? result[STORAGE_KEY] : null);
      });
    });
  }

  function writeChromeStorage(progress) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve();
        return;
      }

      chrome.storage.local.set({ [STORAGE_KEY]: progress }, () => resolve());
    });
  }

  async function getProgress() {
    const chromeProgress = await readChromeStorage();
    const localProgress = readLocalMirror();
    const localBest = getNewerProgress(chromeProgress, localProgress);
    const remoteProgress = await readSupabaseProgress();
    const progress = Data.normalizeProgress(getNewerProgress(localBest, remoteProgress));

    writeLocalMirror(progress);
    await writeChromeStorage(progress);

    return progress;
  }

  async function saveProgress(progress) {
    const safe = Data.normalizeProgress(progress);
    safe.updatedAt = Date.now();
    writeLocalMirror(safe);
    await writeChromeStorage(safe);
    await writeSupabaseProgress(safe);
    return safe;
  }

  async function markWatched(id, watched) {
    const progress = await getProgress();
    return saveProgress(Data.markEpisode(progress, id, watched));
  }

  async function setCurrent(id) {
    const progress = await getProgress();
    if (!Data.getEpisodeById(id)) return progress;
    progress.currentId = id;
    progress.updatedAt = Date.now();
    return saveProgress(progress);
  }

  async function setDetected(id) {
    const progress = await getProgress();
    if (!Data.getEpisodeById(id)) return progress;
    progress.lastDetectedId = id;
    progress.currentId = id;
    progress.updatedAt = Date.now();
    return saveProgress(progress);
  }

  function getNewerProgress(first, second) {
    const safeFirst = first ? Data.normalizeProgress(first) : null;
    const safeSecond = second ? Data.normalizeProgress(second) : null;

    if (!safeFirst) return safeSecond;
    if (!safeSecond) return safeFirst;

    return parseTimestamp(safeSecond.updatedAt) > parseTimestamp(safeFirst.updatedAt)
      ? safeSecond
      : safeFirst;
  }

  function progressToSupabaseRow(progress) {
    const safe = Data.normalizeProgress(progress);
    const current = safe.currentId ? Data.getEpisodeById(safe.currentId) : null;
    const firstUnwatched = Data.EPISODES.find((episode) => !safe.watched[episode.id]);
    const episodeOrder = current?.order || firstUnwatched?.order || Data.EPISODES.length;

    return {
      user_id: getSyncUserId(),
      episode_order: episodeOrder,
      watched_ids: Object.keys(safe.watched).filter((id) => safe.watched[id]),
      updated_at: new Date(parseTimestamp(safe.updatedAt) || Date.now()).toISOString(),
    };
  }

  function supabaseRowToProgress(row) {
    if (!row) return null;

    const watched = {};
    (Array.isArray(row.watched_ids) ? row.watched_ids : []).forEach((id) => {
      if (Data.getEpisodeById(id)) watched[id] = true;
    });

    const current = Data.EPISODES.find((episode) => episode.order === row.episode_order) ||
      Data.EPISODES.find((episode) => !watched[episode.id]) ||
      Data.EPISODES[Data.EPISODES.length - 1];

    return Data.normalizeProgress({
      watched,
      currentId: current ? current.id : null,
      lastDetectedId: null,
      updatedAt: parseTimestamp(row.updated_at),
    });
  }

  async function readSupabaseProgress() {
    const client = getSupabaseClient();
    if (!client) {
      setSyncStatus('local', 'Local only');
      return null;
    }

    try {
      const { data, error } = await client
        .from(getTableName())
        .select('user_id, episode_order, watched_ids, updated_at')
        .eq('user_id', getSyncUserId())
        .maybeSingle();

      if (error) throw error;
      if (data) setSyncStatus('synced', 'Synced');
      else setSyncStatus('local', 'No cloud row yet');
      return supabaseRowToProgress(data);
    } catch (error) {
      setSyncStatus(root.navigator?.onLine === false ? 'offline' : 'error', error.message || 'Sync failed');
      return null;
    }
  }

  async function writeSupabaseProgress(progress) {
    const client = getSupabaseClient();
    if (!client) {
      setSyncStatus('local', 'Local only');
      return false;
    }

    try {
      const { error } = await client
        .from(getTableName())
        .upsert(progressToSupabaseRow(progress), { onConflict: 'user_id' });

      if (error) throw error;
      setSyncStatus('synced', 'Synced');
      return true;
    } catch (error) {
      setSyncStatus(root.navigator?.onLine === false ? 'offline' : 'error', error.message || 'Sync failed');
      return false;
    }
  }

  root.ArrowverseStore = {
    STORAGE_KEY,
    SYNC_ID_KEY,
    getProgress,
    saveProgress,
    markWatched,
    setCurrent,
    setDetected,
    getSyncStatus: () => syncStatus,
    getSyncUserId,
    setSyncUserId,
    hasSupabase: () => Boolean(getSupabaseClient()),
  };
})(globalThis);
