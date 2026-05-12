const Data = globalThis.ArrowverseData;
const Store = globalThis.ArrowverseStore;

let progress = Data.normalizeProgress(null);
let dashboard = null;

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

function renderSummary() {
  dashboard = Data.getDashboard(progress);
  const current = dashboard.current;
  const next = dashboard.next;

  document.getElementById('current-episode').textContent = Data.formatEpisode(current);
  document.getElementById('current-title').textContent = current
    ? `${current.title}${current.crossover ? ` - ${current.crossover}` : ''}`
    : 'No current episode';
  document.getElementById('watched-count').textContent =
    `${dashboard.watchedCount}/${dashboard.totalCount}`;
  document.getElementById('next-episode').textContent = next ? Data.formatEpisode(next) : 'Done';
  document.getElementById('show-switch').textContent = distanceLabel(dashboard.episodesUntilShowSwitch);
  document.getElementById('next-crossover').textContent = distanceLabel(dashboard.episodesUntilNextCrossover);
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

  const items = Data.EPISODES
    .map((episode, index) => ({ episode, index }))
    .filter(({ episode }) => !show || episode.show === show)
    .filter(({ episode }) => {
      if (!query) return true;
      return Data.normalizeText(`${episode.show} ${episode.title} ${episode.crossover || ''}`).includes(query);
    })
    .slice(0, 80);

  list.innerHTML = items.map(({ episode, index }) => {
    const watched = progress.watched[episode.id];
    const current = index === currentIndex;
    return `
      <li class="${watched ? 'watched' : ''} ${current ? 'current' : ''}" data-id="${episode.id}">
        <button class="episode-toggle" data-id="${episode.id}" title="Toggle watched">${watched ? 'OK' : '+'}</button>
        <div>
          <strong>${escapeHtml(Data.formatEpisode(episode))}</strong>
          <span>${escapeHtml(episode.title)}</span>
          ${episode.crossover ? `<em>${escapeHtml(episode.crossover)}</em>` : ''}
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
  document.getElementById('open-app').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('arrowverse.html') });
  });
}

document.addEventListener('DOMContentLoaded', init);
