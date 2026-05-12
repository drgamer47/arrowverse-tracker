// Arrowverse Watch Tracker - Content Script

const Data = globalThis.ArrowverseData;
const Store = globalThis.ArrowverseStore;

const STATE = {
  overlayVisible: true,
  currentEpisode: null,
  progress: Data.normalizeProgress(null),
  lastMarkedId: null,
};

let trackingInterval = null;
let lastUrl = location.href;

function getVideoElement() {
  return document.querySelector('video');
}

function collectTextCandidates() {
  const selectors = [
    '.video-title',
    '.video-title h4',
    '[data-uia="video-title"]',
    '[data-uia*="title"]',
    '.title-card-title',
    '[data-automation-id*="title"]',
    '[class*="title"]',
    'h1',
    'h2',
  ];

  const values = [
    document.title,
    document.querySelector('meta[property="og:title"]')?.content,
    document.querySelector('meta[name="title"]')?.content,
  ];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      const text = node.textContent && node.textContent.trim();
      if (text && text.length < 180) values.push(text);
    });
  });

  return [...new Set(values.filter(Boolean))];
}

function detectCurrentEpisode() {
  const candidates = collectTextCandidates();

  for (const text of candidates) {
    const episode = Data.findEpisodeFromText(text);
    if (episode) return episode;
  }

  const combined = candidates.join(' | ');
  return Data.findEpisodeFromText(combined);
}

function ensureOverlay() {
  let overlay = document.getElementById('avt-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('section');
  overlay.id = 'avt-overlay';
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="avt-kicker">Arrowverse Tracker</div>
    <div class="avt-current" id="avt-current">Detecting episode...</div>
    <div class="avt-subtitle" id="avt-title">Open the tracker popup to set a position manually.</div>
    <div class="avt-row"><span>Episode left</span><strong id="avt-episode-left">--</strong></div>
    <div class="avt-row"><span>Next</span><strong id="avt-next">--</strong></div>
    <div class="avt-row"><span>Left in season</span><strong id="avt-season-left">--</strong></div>
    <div class="avt-row"><span>Until show switch</span><strong id="avt-show-switch">--</strong></div>
    <div class="avt-row"><span>Until crossover</span><strong id="avt-crossover">--</strong></div>
    <div class="avt-hint">Alt+Shift+A toggles this overlay</div>
  `;
  document.documentElement.appendChild(overlay);
  return overlay;
}

function setOverlayVisible(visible) {
  STATE.overlayVisible = visible;
  const overlay = ensureOverlay();
  overlay.classList.toggle('avt-hidden', !visible);
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatVideoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 6 * 60 * 60) return '--';
  const rounded = Math.ceil(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function renderOverlay() {
  const overlay = ensureOverlay();
  overlay.classList.toggle('avt-hidden', !STATE.overlayVisible);

  const dashboard = Data.getDashboard(STATE.progress, STATE.currentEpisode?.id);
  const current = STATE.currentEpisode || dashboard.current;
  const currentStats = Data.getDashboard(STATE.progress, current?.id);
  const next = current ? Data.getNextEpisode(current.id) : dashboard.next;
  const video = getVideoElement();
  const hasRealDuration = video &&
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    video.duration < 6 * 60 * 60;
  const episodeLeft = hasRealDuration
    ? video.duration - video.currentTime
    : null;

  overlay.querySelector('#avt-current').textContent = current
    ? Data.formatEpisode(current)
    : 'Episode not detected';
  overlay.querySelector('#avt-title').textContent = current
    ? current.title
    : 'Try opening the popup and choosing the current episode.';
  overlay.querySelector('#avt-episode-left').textContent = formatVideoTime(episodeLeft);
  overlay.querySelector('#avt-next').textContent = next
    ? Data.formatEpisode(next)
    : 'Series complete';
  overlay.querySelector('#avt-season-left').textContent =
    pluralize(currentStats.episodesLeftInSeason, 'episode', 'episodes');
  overlay.querySelector('#avt-show-switch').textContent =
    currentStats.episodesUntilShowSwitch === 0
      ? 'After this episode'
      : pluralize(currentStats.episodesUntilShowSwitch, 'episode', 'episodes');
  overlay.querySelector('#avt-crossover').textContent =
    currentStats.episodesUntilNextCrossover === null
      ? 'None remaining'
      : currentStats.episodesUntilNextCrossover === 0
        ? current.crossover || 'Now'
        : pluralize(currentStats.episodesUntilNextCrossover, 'episode', 'episodes');
}

async function refreshProgress() {
  STATE.progress = await Store.getProgress();
  renderOverlay();
}

async function updateDetectedEpisode() {
  const episode = detectCurrentEpisode();
  if (episode && episode.id !== STATE.currentEpisode?.id) {
    STATE.currentEpisode = episode;
    STATE.progress = await Store.setDetected(episode.id);
  }

  await maybeMarkWatched(episode);
  renderOverlay();
}

async function maybeMarkWatched(episode) {
  const video = getVideoElement();
  if (!episode || !video || !Number.isFinite(video.duration) || video.duration <= 0) return;

  const ratio = video.currentTime / video.duration;
  if (ratio < 0.85 || STATE.lastMarkedId === episode.id) return;

  STATE.lastMarkedId = episode.id;
  STATE.progress = await Store.markWatched(episode.id, true);
}

function startTracking() {
  if (trackingInterval) clearInterval(trackingInterval);
  trackingInterval = setInterval(updateDetectedEpisode, 2500);
  updateDetectedEpisode();
}

function handleNavigation() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  STATE.currentEpisode = null;
  STATE.lastMarkedId = null;
  refreshProgress();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TOGGLE_ARROWVERSE_OVERLAY') {
    setOverlayVisible(!STATE.overlayVisible);
    sendResponse({ ok: true, visible: STATE.overlayVisible });
    return true;
  }

  if (msg.type === 'GET_ARROWVERSE_STATE') {
    sendResponse({
      currentEpisode: STATE.currentEpisode,
      progress: STATE.progress,
      overlayVisible: STATE.overlayVisible,
    });
    return true;
  }

  if (msg.type === 'SET_ARROWVERSE_CURRENT') {
    Store.setCurrent(msg.id).then((progress) => {
      STATE.progress = progress;
      STATE.currentEpisode = Data.getEpisodeById(msg.id);
      renderOverlay();
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

document.addEventListener('keydown', (event) => {
  if (event.altKey && event.shiftKey && event.code === 'KeyA') {
    setOverlayVisible(!STATE.overlayVisible);
  }
});

const observer = new MutationObserver(() => {
  handleNavigation();
  if (getVideoElement() && !trackingInterval) startTracking();
});

async function init() {
  await refreshProgress();
  ensureOverlay();
  startTracking();
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

init();
