const STORAGE_KEY = 'l2-incident-lab.request-history.v1';
const MAX_ITEMS = 12;

export function getHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.slice(0, MAX_ITEMS) : [];
  } catch (_) {
    return [];
  }
}

export function pushHistory(result) {
  try {
    const next = [result, ...getHistory().filter(item => item.id !== result.id)].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (_) {
    // The request result remains visible even if storage is blocked by the browser.
  }
}

export function clearHistory() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* storage may be unavailable */ }
}
