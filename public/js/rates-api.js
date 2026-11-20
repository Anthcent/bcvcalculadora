import { load, save } from './storage.js';
import { resolveEffectiveRates } from './convert.js';

const STORAGE_KEY = 'rates';
const HISTORY_KEY = 'rateHistory';
const CUSTOM_KEY = 'customRates';
const MAX_HISTORY = 30;

const listeners = new Set();

const DEFAULT_CUSTOM = {
  enabled: false,
  mode: 'manual', // 'manual' | 'margin'
  usd: null,
  eur: null,
  marginPct: 5,
  label: '',
};

// Last known official BCV rates, restored from localStorage so the app works offline.
let official = load(STORAGE_KEY);
let history = restoreHistory();
let custom = restoreCustom();

function restoreHistory() {
  const raw = load(HISTORY_KEY);
  if (!Array.isArray(raw)) return official ? [toHistoryEntry(official)] : [];
  return raw
    .filter((e) => e && Number(e.usd) > 0 && Number(e.eur) > 0)
    .slice(-MAX_HISTORY);
}

function restoreCustom() {
  const raw = load(CUSTOM_KEY);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CUSTOM };
  return {
    enabled: Boolean(raw.enabled),
    mode: raw.mode === 'margin' ? 'margin' : 'manual',
    usd: Number(raw.usd) > 0 ? Number(raw.usd) : null,
    eur: Number(raw.eur) > 0 ? Number(raw.eur) : null,
    marginPct: Number.isFinite(Number(raw.marginPct)) ? Number(raw.marginPct) : 5,
    label: typeof raw.label === 'string' ? raw.label : '',
  };
}

function toHistoryEntry(rates) {
  return {
    valueDate: rates.valueDate || new Date().toISOString().slice(0, 10),
    usd: rates.usd,
    eur: rates.eur,
    fetchedAt: rates.fetchedAt || new Date().toISOString(),
  };
}

function recordHistory(rates) {
  if (!rates || !(rates.usd > 0 && rates.eur > 0)) return;
  const entry = toHistoryEntry(rates);
  const last = history[history.length - 1];

  if (!last) {
    history = [entry];
  } else if (last.valueDate === entry.valueDate) {
    // Same value date: only append a distinct point if the rate actually changed; otherwise refresh timestamp.
    if (Math.abs(last.usd - entry.usd) > 1e-6 || Math.abs(last.eur - entry.eur) > 1e-6) {
      history = [...history.slice(0, -1), entry];
    } else {
      history = [...history.slice(0, -1), { ...last, fetchedAt: entry.fetchedAt }];
    }
  } else {
    history = [...history, entry].slice(-MAX_HISTORY);
  }
  save(HISTORY_KEY, history);
}

function notify() {
  const effective = getRates();
  listeners.forEach((fn) => fn(effective));
}

/** Returns the active effective rates (custom when enabled, otherwise official BCV). */
export function getRates() {
  return resolveEffectiveRates(official, custom);
}

/** Returns the raw official BCV rates regardless of custom mode. */
export function getOfficialRates() {
  return official;
}

/** Returns the saved local history of official BCV rates (oldest -> newest). */
export function getRateHistory() {
  return history;
}

/**
 * Returns the variation between the latest recorded BCV rate and the previous distinct entry.
 * Returns null if fewer than 2 entries exist.
 */
export function getRateVariation() {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  if (!prev || !(prev.usd > 0 && prev.eur > 0)) return null;
  return {
    prevDate: prev.valueDate,
    usdDiff: latest.usd - prev.usd,
    usdPct: ((latest.usd - prev.usd) / prev.usd) * 100,
    eurDiff: latest.eur - prev.eur,
    eurPct: ((latest.eur - prev.eur) / prev.eur) * 100,
  };
}

export function getCustomRateConfig() {
  return custom;
}

export function setCustomRateConfig(patch) {
  custom = { ...custom, ...patch };
  save(CUSTOM_KEY, custom);
  notify();
}

export function disableCustomRate() {
  if (!custom.enabled) return;
  setCustomRateConfig({ enabled: false });
}

export function onRatesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setOfficialRates(rates) {
  official = rates;
  save(STORAGE_KEY, rates);
  if (!rates.stale) recordHistory(rates);
  notify();
}

/**
 * Fetches rates from the local server. Resolves with the official rates on success.
 * Rejects on network/server errors; cached rates stay available via getRates().
 */
export async function fetchRates({ refresh = false } = {}) {
  const res = await fetch(`/api/rates${refresh ? '?refresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  if (!(body.usd > 0 && body.eur > 0)) throw new Error('Invalid rates received');
  setOfficialRates(body);
  return body;
}
