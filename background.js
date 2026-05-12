importScripts('arrowverse-data.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([ArrowverseData.STORAGE_KEY], (data) => {
    if (data[ArrowverseData.STORAGE_KEY]) return;

    chrome.storage.local.set({
      [ArrowverseData.STORAGE_KEY]: ArrowverseData.normalizeProgress(null),
    });
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-overlay') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !isSupportedUrl(tab.url)) return;

  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ARROWVERSE_OVERLAY' });
});

function isSupportedUrl(url) {
  return /^https:\/\/(www\.)?(netflix\.com|primevideo\.com|amazon\.com|pluto\.tv)\//i.test(url || '');
}
