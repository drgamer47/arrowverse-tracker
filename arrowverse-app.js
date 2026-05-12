(function () {
  'use strict';

  const Data = globalThis.ArrowverseData;
  const Store = globalThis.ArrowverseStore;

  let progress = Data.normalizeProgress(null);
  let deferredInstallPrompt = null;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getShows() {
    return [...new Set(Data.EPISODES.map((episode) => episode.show))].sort();
  }

  function getPlatforms() {
    return [...new Set(Data.EPISODES.map((episode) => episode.platform))].sort();
  }

  function distanceLabel(value) {
    if (value === null || value === undefined) return 'None';
    if (value === 0) return 'Now';
    return `${value} episode${value === 1 ? '' : 's'}`;
  }

  function getNextCrossover(stats) {
    if (stats.episodesUntilNextCrossover === null) return null;
    return Data.EPISODES[stats.index + stats.episodesUntilNextCrossover] || null;
  }

  function renderDashboard() {
    const stats = Data.getDashboard(progress);
    const current = stats.current;
    const next = stats.next;
    const crossover = getNextCrossover(stats);

    document.getElementById('currentEpisode').textContent = Data.formatEpisode(current);
    document.getElementById('currentTitle').textContent = current
      ? `${current.title}${current.crossover ? ` - ${current.crossover}` : ''}`
      : '';
    document.getElementById('nextEpisode').textContent = next ? Data.formatEpisode(next) : 'Series complete';
    document.getElementById('nextTitle').textContent = next ? next.title : '';
    document.getElementById('showSwitch').textContent = distanceLabel(stats.episodesUntilShowSwitch);
    document.getElementById('nextCrossover').textContent = distanceLabel(stats.episodesUntilNextCrossover);
    document.getElementById('crossoverName').textContent =
      crossover && crossover.crossover ? crossover.crossover : 'No crossover remaining';
    document.getElementById('timeRemaining').textContent = Data.formatRuntime(stats.timeRemainingMinutes);
    document.getElementById('watchedCount').textContent =
      `${stats.watchedCount} of ${stats.totalCount} watched`;
    document.getElementById('progressFill').style.width = `${stats.percentWatched}%`;
  }

  function renderSyncStatus(status = Store.getSyncStatus()) {
    const el = document.getElementById('syncStatus');
    if (!el) return;

    el.dataset.state = status.state;
    el.textContent = status.message || status.state || 'Local only';
  }

  function renderSyncId() {
    const input = document.getElementById('syncId');
    if (input) input.value = Store.getSyncUserId();
  }

  function renderFilters() {
    document.getElementById('showFilter').innerHTML =
      '<option value="">All shows</option>' +
      getShows().map((show) => `<option value="${escapeHtml(show)}">${escapeHtml(show)}</option>`).join('');

    document.getElementById('platformFilter').innerHTML =
      '<option value="">All platforms</option>' +
      getPlatforms()
        .map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`)
        .join('');
  }

  function getFilteredEpisodes() {
    const query = Data.normalizeText(document.getElementById('search').value);
    const show = document.getElementById('showFilter').value;
    const platform = document.getElementById('platformFilter').value;
    const status = document.getElementById('statusFilter').value;

    return Data.EPISODES.map((episode, index) => ({ episode, index })).filter(({ episode }) => {
      if (show && episode.show !== show) return false;
      if (platform && episode.platform !== platform) return false;
      if (status === 'watched' && !progress.watched[episode.id]) return false;
      if (status === 'unwatched' && progress.watched[episode.id]) return false;
      if (status === 'crossover' && !episode.crossover) return false;
      if (!query) return true;
      return Data.normalizeText(`${episode.show} ${episode.title} ${episode.crossover || ''} ${episode.platform}`)
        .includes(query);
    });
  }

  function renderEpisodes() {
    const container = document.getElementById('episodes');
    const currentIndex = Data.getCurrentIndex(progress);
    const rows = getFilteredEpisodes();

    container.innerHTML = rows.length
      ? rows.map(({ episode, index }) => `
        <article class="episode ${progress.watched[episode.id] ? 'watched' : ''} ${index === currentIndex ? 'current' : ''}" data-id="${escapeHtml(episode.id)}">
          <button class="check" data-action="toggle" data-id="${escapeHtml(episode.id)}">${progress.watched[episode.id] ? 'OK' : '+'}</button>
          <div class="meta">#${episode.order}</div>
          <div><div class="title">${escapeHtml(Data.formatEpisode(episode))} - ${escapeHtml(episode.title)}</div><div class="sub">${escapeHtml(episode.airdate)}</div></div>
          <div class="platform">${escapeHtml(episode.platform)}</div>
          <div class="runtime">${episode.runtimeMinutes || 42} min</div>
          <div class="crossover">${escapeHtml(episode.crossover || '')}</div>
        </article>
      `).join('')
      : '<div class="empty">No episodes match these filters.</div>';

    container.querySelectorAll('[data-action="toggle"]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = button.dataset.id;
        progress = await Store.markWatched(id, !progress.watched[id]);
        render();
      });
    });

    container.querySelectorAll('.episode').forEach((row) => {
      row.addEventListener('click', async () => {
        progress = await Store.setCurrent(row.dataset.id);
        render();
      });
    });
  }

  function render() {
    renderDashboard();
    renderEpisodes();
    renderSyncStatus();
    renderSyncId();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'chrome-extension:') return;

    navigator.serviceWorker.register('./service-worker.js').catch(() => {
      renderSyncStatus({ state: 'error', message: 'Offline cache unavailable' });
    });
  }

  function setupInstallPrompt() {
    const installButton = document.getElementById('installApp');
    if (!installButton) return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.classList.remove('install-hidden');
    });

    installButton.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installButton.classList.add('install-hidden');
    });
  }

  function setupSyncControls() {
    window.addEventListener('arrowverse-sync-status', (event) => {
      renderSyncStatus(event.detail);
    });

    document.getElementById('saveSyncId').addEventListener('click', async () => {
      const input = document.getElementById('syncId');
      try {
        Store.setSyncUserId(input.value);
        progress = await Store.getProgress();
        render();
      } catch (error) {
        renderSyncStatus({ state: 'error', message: error.message || 'Invalid sync ID' });
      }
    });
  }

  async function init() {
    registerServiceWorker();
    setupInstallPrompt();
    setupSyncControls();
    renderFilters();
    if (window.ARROWVERSE_SUPABASE_READY) {
      await window.ARROWVERSE_SUPABASE_READY;
    }
    progress = await Store.getProgress();
    render();

    ['search', 'showFilter', 'platformFilter', 'statusFilter'].forEach((id) => {
      document.getElementById(id).addEventListener('input', renderEpisodes);
    });

    document.getElementById('markCurrent').addEventListener('click', async () => {
      const current = Data.getDashboard(progress).current;
      if (!current) return;
      progress = await Store.markWatched(current.id, true);
      render();
    });

    document.getElementById('reset').addEventListener('click', async () => {
      if (!confirm('Reset all Arrowverse watch progress?')) return;
      progress = await Store.saveProgress(Data.normalizeProgress(null));
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
