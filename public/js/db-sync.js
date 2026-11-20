const TIMEOUT_MS = 6000;
const timers = new Map();

async function requestJson(url, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline or server unreachable: keep working seamlessly with localStorage.
    return null;
  }
}

function schedule(key, delayMs, fn) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(fn, delayMs));
}

export function syncCustomRate(cfg) {
  schedule('customRate', 250, () => requestJson('/api/custom-rate', { method: 'PUT', body: cfg }));
}

export function syncCalculations(state) {
  schedule('calculations', 350, () => requestJson('/api/calculations', { method: 'PUT', body: state }));
}

export function syncQuickChips(chips) {
  schedule('quickChips', 150, () => requestJson('/api/quick-chips', { method: 'PUT', body: chips }));
}

export function syncSettings(patch) {
  schedule('settings', 200, () => requestJson('/api/settings', { method: 'PUT', body: patch }));
}

export function saveReceiptToDb(payload) {
  return requestJson('/api/receipts', { method: 'POST', body: payload });
}

export async function fetchSavedReceipts() {
  const data = await requestJson('/api/receipts');
  return Array.isArray(data?.receipts) ? data.receipts : null;
}

export async function deleteReceiptFromDb(id) {
  const data = await requestJson(`/api/receipts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return Boolean(data?.deleted);
}

/**
 * Fetches initial state from SQLite on load and merges with localStorage.
 * Works offline without errors: localStorage always renders first.
 */
export async function bootstrapFromDb(handlers) {
  const data = await requestJson('/api/state');
  if (!data) return false;

  if (Array.isArray(data.history) && data.history.length > 0) {
    handlers.onHistory?.(data.history);
  }
  if (data.customRate) {
    handlers.onCustomRate?.(data.customRate);
  } else if (handlers.seedCustomRate) {
    syncCustomRate(handlers.seedCustomRate());
  }

  if (data.quickChips) {
    handlers.onQuickChips?.(data.quickChips);
  } else if (handlers.seedQuickChips) {
    syncQuickChips(handlers.seedQuickChips());
  }

  if (data.settings && Object.keys(data.settings).length > 0) {
    handlers.onSettings?.(data.settings);
  } else if (handlers.seedSettings) {
    syncSettings(handlers.seedSettings());
  }

  if (data.calculations?.windows?.length) {
    handlers.onCalculations?.(data.calculations);
  } else if (handlers.seedCalculations) {
    syncCalculations(handlers.seedCalculations());
  }

  return true;
}
