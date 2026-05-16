(function () {
  'use strict';

  const Data = globalThis.ArrowverseData;
  const Store = globalThis.ArrowverseStore;
  const Analytics = globalThis.ArrowverseAnalytics;

  let progress = Data.normalizeProgress(null);
  let deferredInstallPrompt = null;
  let sortByRating = false;
  let bingeMode = 'episodes';

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

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('visible'), 4200);
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function renderProgressSummary(stats) {
    const label = document.getElementById('overallProgressLabel');
    const fill = document.getElementById('overallProgressFill');
    const shows = document.getElementById('showProgressBars');
    if (!label || !fill) return;

    label.textContent = `${stats.watchedCount} / ${stats.totalCount} episodes · ${stats.percentWatched}%`;
    fill.style.width = `${stats.percentWatched}%`;

    if (!shows) return;
    shows.innerHTML = (stats.showProgress || [])
      .map((row) => {
        const head = `<span class="show-progress-head"><span>${escapeHtml(row.show)}</span><span>${row.watched}/${row.total}</span></span>`;
        const track = `<span class="mini-track"><span class="mini-fill" style="width:${row.percent}%;background:${row.color}"></span></span>`;
        return `<article class="show-progress-row">${head}${track}</article>`;
      })
      .join('');
  }

  function renderDashboard() {
    const stats = Data.getDashboard(progress);
    const current = stats.current;
    const next = stats.next;
    const crossover = getNextCrossover(stats);

    document.getElementById('currentEpisode').textContent = current
      ? Data.formatEpisode(current)
      : 'All caught up';
    document.getElementById('currentTitle').textContent = current
      ? [current.title, current.crossover].filter(Boolean).join(' · ')
      : 'Pick an episode below to continue.';
    document.getElementById('nextEpisode').textContent = next ? Data.formatEpisode(next) : 'Done';
    document.getElementById('showSwitch').textContent = distanceLabel(stats.episodesUntilShowSwitch);
    document.getElementById('nextCrossover').textContent = distanceLabel(stats.episodesUntilNextCrossover);
    const crossoverEl = document.getElementById('crossoverName');
    if (crossoverEl) {
      const name = crossover?.crossover;
      crossoverEl.hidden = !name;
      crossoverEl.textContent = name ? `Next event: ${name}` : '';
    }
    document.getElementById('timeRemaining').textContent = Data.formatDurationSeconds(stats.timeLeftTotal);
    renderProgressSummary(stats);
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

    let rows = Data.EPISODES.map((episode, index) => ({ episode, index })).filter(({ episode }) => {
      if (show && episode.show !== show) return false;
      if (platform && episode.platform !== platform) return false;
      if (status === 'watched' && !progress.watched[episode.id]) return false;
      if (status === 'unwatched' && progress.watched[episode.id]) return false;
      if (status === 'crossover' && !episode.crossover) return false;
      if (!query) return true;
      return Data.normalizeText(`${episode.show} ${episode.title} ${episode.crossover || ''} ${episode.platform}`)
        .includes(query);
    });

    if (sortByRating) {
      rows.sort((a, b) => (b.episode.imdbRating || 0) - (a.episode.imdbRating || 0));
    }
    return rows;
  }

  function renderEpisodes() {
    const container = document.getElementById('episodes');
    const currentIndex = Data.getCurrentIndex(progress);
    const rows = getFilteredEpisodes();

    container.innerHTML = rows.length
      ? rows
          .map(({ episode, index }) => {
            const rating = Analytics.formatRating(episode);
            const watched = progress.watched[episode.id];
            const meta = [episode.airdate, episode.platform, `${episode.runtimeMinutes || 42}m`].join(' · ');
            return `<article class="ep-card ${watched ? 'watched' : ''} ${index === currentIndex ? 'current' : ''}" data-id="${escapeHtml(episode.id)}">
          <button type="button" class="ep-check" data-action="toggle" data-id="${escapeHtml(episode.id)}" aria-label="${watched ? 'Mark unwatched' : 'Mark watched'}">${watched ? '✓' : ''}</button>
          <div class="ep-body">
            <div class="ep-line1">
              <span class="ep-order">#${episode.order}</span>
              ${rating ? `<span class="ep-rating">${escapeHtml(rating)}</span>` : ''}
            </div>
            <h3 class="ep-title">${escapeHtml(Data.formatEpisode(episode))} — ${escapeHtml(episode.title)}</h3>
            <p class="ep-meta">${escapeHtml(meta)}</p>
            ${episode.crossover ? `<p class="ep-crossover">${escapeHtml(episode.crossover)}</p>` : ''}
          </div>
        </article>`;
          })
          .join('')
      : '<p class="empty">No episodes match these filters.</p>';

    container.querySelectorAll('[data-action="toggle"]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        progress = await Store.markWatched(button.dataset.id, !progress.watched[button.dataset.id]);
        render();
      });
    });

    container.querySelectorAll('.ep-card').forEach((row) => {
      row.addEventListener('click', async () => {
        progress = await Store.setCurrent(row.dataset.id);
        render();
      });
    });
  }

  function renderBinge() {
    const episodesInput = document.getElementById('bingeEpisodes');
    const hoursInput = document.getElementById('bingeHours');
    const targetInput = document.getElementById('bingeTarget');
    if (!episodesInput) return;

    const plan = Analytics.computeBingePlan(progress, {
      episodesPerDay: bingeMode === 'episodes' ? episodesInput.value : 0,
      hoursPerDay: bingeMode === 'hours' ? hoursInput.value : 0,
      targetDate: targetInput.value,
    });
    const bingeHero = document.getElementById('bingeTotalHours');
    if (bingeHero) bingeHero.innerHTML = `<em>${plan.totalHoursFormatted}</em>`;
    document.getElementById('bingeFinish').textContent = plan.finishDate || '—';
    document.getElementById('bingePace').textContent = plan.paceEpisodes
      ? `${plan.paceEpisodes} eps/day · ${plan.paceHours} h/day to hit target`
      : 'Set a target finish date to see required pace';
  }

  function renderMilestones() {
    const grid = document.getElementById('milestonesGrid');
    if (!grid) return;
    grid.innerHTML = Analytics.getMilestoneList(progress)
      .map((item) => `<article class="milestone ${item.unlocked ? 'unlocked' : 'locked'}">
        <span class="milestone-icon">${escapeHtml(item.icon)}</span>
        <span class="milestone-label">${escapeHtml(item.label)}</span>
        <span class="milestone-date">${item.unlocked ? formatDate(item.unlockedAt) : 'Locked'}</span>
      </article>`)
      .join('');
  }

  function renderStats() {
    const stats = Analytics.getStats(progress);
    document.getElementById('statTotalHours').textContent = `${stats.totalHours} h`;
    document.getElementById('statAvgPerDay').textContent = stats.episodesPerDay;
    document.getElementById('statMostShow').textContent = stats.mostWatchedShow;
    document.getElementById('statStreakCurrent').textContent = stats.streakCurrent;
    document.getElementById('statStreakLongest').textContent = stats.streakLongest;
    document.getElementById('statFirst').textContent = formatDate(stats.firstWatchedAt);
    document.getElementById('statLast').textContent = formatDate(stats.lastWatchedAt);

    const chart = document.getElementById('statsChart');
    const max = Math.max(1, ...stats.perShow.map((row) => row.watched));
    chart.innerHTML = stats.perShow
      .map((row) => `<article class="stat-bar-row">
        <span class="stat-bar-label">${escapeHtml(row.show)}</span>
        <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round((row.watched / max) * 100)}%;background:${row.color}"></span></span>
        <span class="stat-bar-value">${row.watched}</span>
      </article>`)
      .join('');
  }

  function renderTimeline() {
    const wrap = document.getElementById('timelineWrap');
    const tooltip = document.getElementById('timelineTooltip');
    if (!wrap) return;

    const currentIndex = Data.getCurrentIndex(progress);
    const shows = [...new Set(Data.EPISODES.map((episode) => episode.show))];
    const markers = Analytics.getCrossoverMarkers();
    const cellSize = 10;
    const gap = 2;
    const width = Data.EPISODES.length * (cellSize + gap) + 40;

    let html = `<section class="timeline-inner" style="width:${width}px">`;
    markers.forEach((marker) => {
      const left = 24 + marker.index * (cellSize + gap);
      html += `<span class="timeline-crossover" style="left:${left}px" title="${escapeHtml(marker.label)}"></span>`;
    });

    shows.forEach((show) => {
      html += `<article class="timeline-row"><span class="timeline-label">${escapeHtml(show)}</span><span class="timeline-cells">`;
      Data.EPISODES.forEach((episode, index) => {
        if (episode.show !== show) {
          html += '<span class="timeline-cell spacer" aria-hidden="true"></span>';
          return;
        }
        const watched = progress.watched[episode.id];
        const current = index === currentIndex;
        const color = Data.SHOW_COLORS[show] || '#e50914';
        const title = `${Data.formatEpisode(episode)} — ${episode.title}`;
        html += `<button type="button" class="timeline-cell ${watched ? 'watched' : 'unwatched'} ${current ? 'current' : ''}"
          style="background:${watched ? color : '#1a1a1a'};${current ? 'box-shadow:0 0 0 2px #e50914' : ''}"
          data-id="${escapeHtml(episode.id)}" aria-label="${escapeHtml(title)}"></button>`;
      });
      html += '</span></article>';
    });
    html += '</section>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.timeline-cell').forEach((cell) => {
      cell.addEventListener('mouseenter', () => {
        const episode = Data.getEpisodeById(cell.dataset.id);
        if (!episode || !tooltip) return;
        tooltip.textContent = `${Data.formatEpisode(episode)} — ${episode.title} ${Analytics.formatRating(episode)}`;
        tooltip.classList.add('visible');
      });
      cell.addEventListener('mouseleave', () => tooltip?.classList.remove('visible'));
      cell.addEventListener('click', async () => {
        progress = await Store.setCurrent(cell.dataset.id);
        render();
      });
    });

    wrap.querySelector('.timeline-cell.current')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  function setActiveTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    if (tabId === 'timeline') renderTimeline();
    if (tabId === 'stats') renderStats();
    if (tabId === 'milestones') renderMilestones();
    if (tabId === 'binge') renderBinge();
  }

  function render() {
    renderDashboard();
    renderEpisodes();
    renderSyncStatus();
    renderSyncId();
    const active = document.querySelector('.tab-btn.active');
    if (active) setActiveTab(active.dataset.tab);
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
    window.addEventListener('arrowverse-milestone', (event) => {
      (event.detail?.keys || []).forEach((key) => {
        showToast(`Milestone unlocked: ${Analytics.getMilestoneLabel(key)}`);
      });
      renderMilestones();
    });
    document.getElementById('saveSyncId').addEventListener('click', async () => {
      try {
        Store.setSyncUserId(document.getElementById('syncId').value);
        progress = await Store.getProgress();
        render();
      } catch (error) {
        renderSyncStatus({ state: 'error', message: error.message || 'Invalid sync ID' });
      }
    });
  }

  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });
  }

  function setupBinge() {
    const episodesInput = document.getElementById('bingeEpisodes');
    const hoursInput = document.getElementById('bingeHours');
    const targetInput = document.getElementById('bingeTarget');
    document.querySelectorAll('[name="bingeMode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        bingeMode = radio.value;
        episodesInput.disabled = bingeMode !== 'episodes';
        hoursInput.disabled = bingeMode !== 'hours';
        renderBinge();
      });
    });
    [episodesInput, hoursInput, targetInput].forEach((el) => {
      el?.addEventListener('input', renderBinge);
    });
  }

  async function init() {
    registerServiceWorker();
    setupInstallPrompt();
    setupSyncControls();
    setupTabs();
    setupBinge();
    renderFilters();

    document.getElementById('sortRating')?.addEventListener('click', () => {
      sortByRating = !sortByRating;
      document.getElementById('sortRating').classList.toggle('active', sortByRating);
      renderEpisodes();
    });

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
