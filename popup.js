const Data = globalThis.ArrowverseData;
const Store = globalThis.ArrowverseStore;
const Analytics = globalThis.ArrowverseAnalytics;

let progress = Data.normalizeProgress(null);
let dashboard = null;
let sortByRating = false;

async function getActiveStreamingTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:\/\/(www\.)?(netflix\.com|primevideo\.com|amazon\.com|pluto\.tv)\//i.test(tab.url || '')) return tab;
  return null;
}

async function sendToContent(msg) {
  const tab = await getActiveStreamingTab();
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function distanceLabel(value) {
  if (value === null || value === undefined) return 'None';
  if (value === 0) return 'Now';
  return pluralize(value, 'episode', 'episodes');
}

function renderProgressSummary(stats) {
  const label = document.getElementById('overall-progress-label');
  const fill = document.getElementById('overall-progress-fill');
  const shows = document.getElementById('show-progress-bars');
  if (label) label.textContent = `${stats.watchedCount} / ${stats.totalCount} episodes · ${stats.percentWatched}%`;
  if (fill) fill.style.width = `${stats.percentWatched}%`;
  if (!shows) return;
  shows.innerHTML = (stats.showProgress || [])
    .map((row) => {
      const head = `<span class="show-progress-head"><span>${escapeHtml(row.show)}</span><span>${row.watched}/${row.total}</span></span>`;
      const track = `<span class="mini-track"><span class="mini-fill" style="width:${row.percent}%;background:${row.color}"></span></span>`;
      return `<article class="show-progress-row">${head}${track}</article>`;
    })
    .join('');
}

function renderSummary() {
  dashboard = Data.getDashboard(progress);
  const current = dashboard.current;
  const next = dashboard.next;

  renderProgressSummary(dashboard);

  document.getElementById('current-episode').textContent = Data.formatEpisode(current);
  document.getElementById('current-title').textContent = current
    ? `${current.title}${current.crossover ? ` - ${current.crossover}` : ''}`
    : 'No current episode';
  document.getElementById('watched-count').textContent =
    `${dashboard.watchedCount}/${dashboard.totalCount}`;
  document.getElementById('next-episode').textContent = next ? Data.formatEpisode(next) : 'Done';
  document.getElementById('show-switch').textContent = distanceLabel(dashboard.episodesUntilShowSwitch);
  document.getElementById('next-crossover').textContent = distanceLabel(dashboard.episodesUntilNextCrossover);
  const totalTime = document.getElementById('time-total');
  if (totalTime) totalTime.textContent = Data.formatDurationSeconds(dashboard.timeLeftTotal);
}

function renderShowFilter() {
  const select = document.getElementById('show-filter');
  const shows = [...new Set(Data.EPISODES.map((episode) => episode.show))];
  select.innerHTML = '<option value="">All shows</option>' + shows
    .map((show) => `<option value="${escapeHtml(show)}">${escapeHtml(show)}</option>`)
    .join('');
}

function renderEpisodeList() {
  const list = document.getElementById('episode-list');
  const query = Data.normalizeText(document.getElementById('episode-search').value);
  const show = document.getElementById('show-filter').value;
  const currentIndex = Data.getCurrentIndex(progress);

  let items = Data.EPISODES
    .map((episode, index) => ({ episode, index }))
    .filter(({ episode }) => !show || episode.show === show)
    .filter(({ episode }) => {
      if (!query) return true;
      return Data.normalizeText(`${episode.show} ${episode.title} ${episode.crossover || ''}`).includes(query);
    });

  if (sortByRating) {
    items.sort((a, b) => (b.episode.imdbRating || 0) - (a.episode.imdbRating || 0));
  }

  items = items.slice(0, 80);

  list.innerHTML = items.map(({ episode, index }) => {
    const watched = progress.watched[episode.id];
    const current = index === currentIndex;
    const rating = Analytics.formatRating(episode);
    return `
      <li class="ep-item ${watched ? 'watched' : ''} ${current ? 'current' : ''}" data-id="${episode.id}">
        <button type="button" class="episode-toggle" data-id="${episode.id}" aria-label="Toggle watched">${watched ? '✓' : ''}</button>
        <div class="ep-item-body">
          <strong>${escapeHtml(Data.formatEpisode(episode))}${rating ? ` <span class="ep-rating">${escapeHtml(rating)}</span>` : ''}</strong>
          <span>${escapeHtml(episode.title)}</span>
        </div>
      </li>
    `;
  }).join('') || '<li class="empty">No episodes match.</li>';

  list.querySelectorAll('.episode-toggle').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const id = button.dataset.id;
      progress = await Store.markWatched(id, !progress.watched[id]);
      render();
    });
  });

  list.querySelectorAll('li[data-id]').forEach((item) => {
    item.addEventListener('click', async () => {
      progress = await Store.setCurrent(item.dataset.id);
      await sendToContent({ type: 'SET_ARROWVERSE_CURRENT', id: item.dataset.id });
      render();
    });
  });
}

function render() {
  renderSummary();
  renderEpisodeList();
}

async function init() {
  renderShowFilter();
  progress = await Store.getProgress();

  const contentState = await sendToContent({ type: 'GET_ARROWVERSE_STATE' });
  if (contentState && contentState.progress) {
    progress = Data.normalizeProgress(contentState.progress);
  }

  render();

  document.getElementById('mark-current').addEventListener('click', async () => {
    if (!dashboard.current) return;
    progress = await Store.markWatched(dashboard.current.id, true);
    await sendToContent({ type: 'SET_ARROWVERSE_CURRENT', id: progress.currentId });
    render();
  });

  document.getElementById('undo-current').addEventListener('click', async () => {
    if (!dashboard.current) return;
    progress = await Store.markWatched(dashboard.current.id, false);
    render();
  });

  document.getElementById('episode-search').addEventListener('input', renderEpisodeList);
  document.getElementById('show-filter').addEventListener('change', renderEpisodeList);
  document.getElementById('sort-rating')?.addEventListener('click', () => {
    sortByRating = !sortByRating;
    document.getElementById('sort-rating').classList.toggle('active', sortByRating);
    renderEpisodeList();
  });
  document.getElementById('open-app').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('arrowverse.html') });
  });
}

document.addEventListener('DOMContentLoaded', init);
