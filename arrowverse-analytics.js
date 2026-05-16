(function (root) {
  'use strict';

  const Data = root.ArrowverseData;

  const MILESTONE_DEFS = [
    { key: 'first_episode', label: 'First episode watched', icon: '1' },
    { key: 'episodes_10', label: '10 episodes watched', icon: '10' },
    { key: 'episodes_50', label: '50 episodes watched', icon: '50' },
    { key: 'episodes_100', label: '100 episodes watched', icon: '100' },
    { key: 'episodes_250', label: '250 episodes watched', icon: '250' },
    { key: 'episodes_500', label: '500 episodes watched', icon: '500' },
    { key: 'season_complete', label: 'Finished a season', icon: 'S' },
    { key: 'show_complete', label: 'Finished a show', icon: 'TV' },
    { key: 'crossover_complete', label: 'Completed a crossover', icon: 'X' },
    { key: 'halfway', label: 'Halfway (episode 415)', icon: '½' },
  ];

  const EPISODE_THRESHOLDS = {
    first_episode: 1,
    episodes_10: 10,
    episodes_50: 50,
    episodes_100: 100,
    episodes_250: 250,
    episodes_500: 500,
    halfway: 415,
  };

  let crossoverGroupsCache = null;

  function getCrossoverGroups() {
    if (crossoverGroupsCache) return crossoverGroupsCache;
    const groups = new Map();
    Data.EPISODES.forEach((episode) => {
      if (!episode.crossover) return;
      if (!groups.has(episode.crossover)) groups.set(episode.crossover, []);
      groups.get(episode.crossover).push(episode.id);
    });
    crossoverGroupsCache = groups;
    return groups;
  }

  function dateKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function countWatched(progress) {
    return Data.countWatched(progress);
  }

  function hasCompletedSeason(progress) {
    const safe = Data.normalizeProgress(progress);
    const seasons = new Map();
    Data.EPISODES.forEach((episode) => {
      const key = `${episode.show}::${episode.season}`;
      if (!seasons.has(key)) seasons.set(key, []);
      seasons.get(key).push(episode);
    });
    return [...seasons.values()].some(
      (episodes) => episodes.length > 0 && episodes.every((episode) => safe.watched[episode.id])
    );
  }

  function hasCompletedShow(progress) {
    const safe = Data.normalizeProgress(progress);
    const shows = [...new Set(Data.EPISODES.map((episode) => episode.show))];
    return shows.some((show) => {
      const episodes = Data.EPISODES.filter((episode) => episode.show === show);
      return episodes.length > 0 && episodes.every((episode) => safe.watched[episode.id]);
    });
  }

  function hasCompletedCrossover(progress) {
    const safe = Data.normalizeProgress(progress);
    for (const ids of getCrossoverGroups().values()) {
      if (ids.length > 1 && ids.every((id) => safe.watched[id])) return true;
    }
    return false;
  }

  function updateStreak(progress, timestamp) {
    const safe = Data.normalizeProgress(progress);
    const day = dateKey(timestamp);
    if (!safe.streakLastDate) {
      safe.streakCurrent = 1;
      safe.streakLongest = Math.max(1, safe.streakLongest);
      safe.streakLastDate = day;
      return safe;
    }
    if (safe.streakLastDate === day) return safe;

    const previous = new Date(`${safe.streakLastDate}T12:00:00Z`);
    const current = new Date(`${day}T12:00:00Z`);
    const diffDays = Math.round((current - previous) / 86400000);
    if (diffDays === 1) safe.streakCurrent += 1;
    else if (diffDays > 1) safe.streakCurrent = 1;
    safe.streakLastDate = day;
    safe.streakLongest = Math.max(safe.streakLongest, safe.streakCurrent);
    return safe;
  }

  function checkMilestones(progress) {
    const safe = Data.normalizeProgress(progress);
    const watched = countWatched(safe);
    const newly = [];

    function unlock(key) {
      if (!safe.milestones[key]) {
        safe.milestones[key] = Date.now();
        newly.push(key);
      }
    }

    Object.entries(EPISODE_THRESHOLDS).forEach(([key, threshold]) => {
      if (watched >= threshold) unlock(key);
    });

    if (hasCompletedSeason(safe)) unlock('season_complete');
    if (hasCompletedShow(safe)) unlock('show_complete');
    if (hasCompletedCrossover(safe)) unlock('crossover_complete');

    return { progress: safe, newlyUnlocked: newly };
  }

  function backfillLegacyAnalytics(progress) {
    const safe = Data.normalizeProgress(progress);
    const watched = countWatched(safe);
    if (!watched) return safe;

    if (!safe.firstWatchedAt) {
      safe.firstWatchedAt = safe.updatedAt || Date.now();
    }
    if (!safe.lastWatchedAt) {
      safe.lastWatchedAt = safe.updatedAt || safe.firstWatchedAt;
    }
    if (!safe.watchLog.length) {
      const stamp = safe.lastWatchedAt || Date.now();
      safe.watchLog = Data.EPISODES.filter((episode) => safe.watched[episode.id]).map((episode) => ({
        id: episode.id,
        timestamp: stamp,
      }));
    }
    if (!safe.streakCurrent && safe.watchLog.length) {
      const days = new Set(safe.watchLog.map((entry) => dateKey(entry.timestamp)));
      safe.streakCurrent = days.size > 0 ? 1 : 0;
      safe.streakLongest = Math.max(safe.streakLongest, safe.streakCurrent);
      const sorted = [...days].sort();
      safe.streakLastDate = sorted[sorted.length - 1] || null;
    }
    return checkMilestones(safe).progress;
  }

  function applyWatchMutation(progress, id, watched) {
    let safe = Data.markEpisode(progress, id, watched);
    const newlyUnlocked = [];

    if (watched) {
      const timestamp = Date.now();
      safe.watchLog = [...safe.watchLog, { id, timestamp }];
      if (!safe.firstWatchedAt) safe.firstWatchedAt = timestamp;
      safe.lastWatchedAt = timestamp;
      safe = updateStreak(safe, timestamp);
      const milestoneResult = checkMilestones(safe);
      safe = milestoneResult.progress;
      newlyUnlocked.push(...milestoneResult.newlyUnlocked);
    }

    return { progress: safe, newlyUnlocked };
  }

  function getMilestoneList(progress) {
    const safe = Data.normalizeProgress(progress);
    return MILESTONE_DEFS.map((def) => ({
      ...def,
      unlocked: Boolean(safe.milestones[def.key]),
      unlockedAt: safe.milestones[def.key] || null,
    }));
  }

  function getMilestoneLabel(key) {
    return MILESTONE_DEFS.find((def) => def.key === key)?.label || key;
  }

  function getWatchedRuntimeSeconds(progress) {
    const safe = Data.normalizeProgress(progress);
    return Data.EPISODES.reduce((total, episode) => {
      if (!safe.watched[episode.id]) return total;
      return total + Data.getEpisodeRuntimeMinutes(episode) * 60;
    }, 0);
  }

  function getStats(progress) {
    const safe = Data.normalizeProgress(progress);
    const watchedCount = countWatched(safe);
    const totalSeconds = getWatchedRuntimeSeconds(safe);
    const perShow = Data.getShowProgress(safe).map((row) => ({
      ...row,
      hours: Data.EPISODES.filter((episode) => episode.show === row.show && safe.watched[episode.id])
        .reduce((sum, episode) => sum + Data.getEpisodeRuntimeMinutes(episode), 0) / 60,
    }));
    const mostByTime = perShow.reduce(
      (best, row) => (!best || row.hours > best.hours ? row : best),
      null
    );

    const firstDay = safe.firstWatchedAt ? dateKey(safe.firstWatchedAt) : null;
    const lastDay = safe.lastWatchedAt ? dateKey(safe.lastWatchedAt) : null;
    let daysSpan = 1;
    if (firstDay && lastDay) {
      const start = new Date(`${firstDay}T12:00:00Z`);
      const end = new Date(`${lastDay}T12:00:00Z`);
      daysSpan = Math.max(1, Math.round((end - start) / 86400000) + 1);
    }

    const episodesPerDay = watchedCount ? (watchedCount / daysSpan).toFixed(2) : '0';

    return {
      watchedCount,
      totalHours: (totalSeconds / 3600).toFixed(1),
      perShow,
      episodesPerDay,
      mostWatchedShow: mostByTime ? mostByTime.show : '—',
      streakCurrent: safe.streakCurrent,
      streakLongest: safe.streakLongest,
      firstWatchedAt: safe.firstWatchedAt,
      lastWatchedAt: safe.lastWatchedAt,
    };
  }

  function computeBingePlan(progress, options = {}) {
    const stats = Data.getDashboard(progress);
    const totalHours = stats.timeLeftTotal / 3600;
    const episodesPerDay = Number(options.episodesPerDay);
    const hoursPerDay = Number(options.hoursPerDay);
    const targetDate = options.targetDate ? String(options.targetDate) : '';

    let finishDate = null;
    let paceEpisodes = null;
    let paceHours = null;

    if (episodesPerDay > 0) {
      const days = Math.ceil((stats.totalCount - stats.watchedCount) / episodesPerDay);
      finishDate = addDays(new Date(), days);
    } else if (hoursPerDay > 0) {
      const days = Math.ceil(totalHours / hoursPerDay);
      finishDate = addDays(new Date(), days);
    }

    if (targetDate) {
      const target = new Date(`${targetDate}T12:00:00Z`);
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const daysLeft = Math.max(1, Math.ceil((target - today) / 86400000));
      const episodesLeft = stats.totalCount - stats.watchedCount;
      paceEpisodes = (episodesLeft / daysLeft).toFixed(2);
      paceHours = (totalHours / daysLeft).toFixed(2);
    }

    return {
      totalHours: totalHours.toFixed(1),
      totalHoursFormatted: Data.formatDurationSeconds(stats.timeLeftTotal),
      finishDate: finishDate ? finishDate.toISOString().slice(0, 10) : null,
      paceEpisodes,
      paceHours,
    };
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function getCrossoverMarkers() {
    const markers = [];
    const seen = new Set();
    Data.EPISODES.forEach((episode, index) => {
      if (!episode.crossover || seen.has(episode.crossover)) return;
      const firstIndex = Data.EPISODES.findIndex((item) => item.crossover === episode.crossover);
      if (firstIndex === index) {
        seen.add(episode.crossover);
        markers.push({ index, label: episode.crossover });
      }
    });
    return markers;
  }

  function formatRating(episode) {
    if (!episode || episode.imdbRating == null) return '';
    return `★ ${Number(episode.imdbRating).toFixed(1)}`;
  }

  root.ArrowverseAnalytics = {
    MILESTONE_DEFS,
    applyWatchMutation,
    backfillLegacyAnalytics,
    checkMilestones,
    getMilestoneList,
    getMilestoneLabel,
    getStats,
    computeBingePlan,
    getCrossoverMarkers,
    formatRating,
    getWatchedRuntimeSeconds,
  };
})(globalThis);
