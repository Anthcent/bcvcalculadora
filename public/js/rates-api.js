import { load, save } from './storage.js';

const STORAGE_KEY = 'rates';
const listeners = new Set();

// Last known rates, restored from localStorage so the app works offline.
let current = load(STORAGE_KEY);

export function getRates() {
  return current;
}

export function onRatesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setRates(rates) {
  current = rates;
  save(STORAGE_KEY, rates);
  listeners.forEach((fn) => fn(current));
}

/**
 * Fetches rates from the local server. Resolves with the rates on success.
 * Rejects on network/server errors; cached rates stay available via getRates().
 */
export async function fetchRates({ refresh = false } = {}) {
  const res = await fetch(`/api/rates${refresh ? '?refresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  if (!(body.usd > 0 && body.eur > 0)) throw new Error('Invalid rates received');
  setRates(body);
  return body;
}
