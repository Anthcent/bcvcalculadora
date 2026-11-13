import { parseBcvHtml } from './bcv-parser.js';

const BCV_URL = 'https://www.bcv.org.ve/';
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
// After a failure, wait this long before hitting BCV again (forced refreshes bypass it).
const RETRY_COOLDOWN_MS = 30_000;

let cache = null; // { usd, eur, valueDate, fetchedAt }
let inflight = null;
let lastFailureAt = 0;
let consecutiveFailures = 0;

async function fetchFromBcv() {
  const res = await fetch(BCV_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'Mozilla/5.0 (bcv-calc)', Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`BCV responded with HTTP ${res.status}`);
  const html = await res.text();
  try {
    return { ...parseBcvHtml(html), fetchedAt: new Date().toISOString() };
  } catch (err) {
    // A parse failure means BCV changed its markup: the scraper needs fixing, not a retry.
    err.code = 'PARSE_ERROR';
    throw err;
  }
}

function staleResult() {
  return { ...cache, source: 'bcv.org.ve', stale: true };
}

function logFailure(err) {
  const kind = err.code === 'PARSE_ERROR' ? 'parse-error' : 'fetch-error';
  const staleMin = cache ? Math.round((Date.now() - Date.parse(cache.fetchedAt)) / 60000) : null;
  console.error(
    `[rates] ${kind} failures=${consecutiveFailures} staleMinutes=${staleMin ?? 'n/a'} reason=${err.cause?.code ?? err.message}`
  );
}

/**
 * Returns rates from cache when fresh, otherwise refetches.
 * On failure, falls back to the last cached value flagged as stale.
 * Throws only when there is nothing cached.
 */
export async function getRates({ refresh = false } = {}) {
  const fresh = cache && Date.now() - Date.parse(cache.fetchedAt) < CACHE_TTL_MS;
  if (fresh && !refresh) return { ...cache, source: 'bcv.org.ve', stale: false };

  const coolingDown = Date.now() - lastFailureAt < RETRY_COOLDOWN_MS;
  if (coolingDown && !refresh && cache) return staleResult();

  try {
    // Share one in-flight request between concurrent callers.
    inflight ??= fetchFromBcv().finally(() => { inflight = null; });
    cache = await inflight;
    consecutiveFailures = 0;
    lastFailureAt = 0;
    return { ...cache, source: 'bcv.org.ve', stale: false };
  } catch (err) {
    consecutiveFailures += 1;
    lastFailureAt = Date.now();
    logFailure(err);
    if (cache) return staleResult();
    throw err;
  }
}
