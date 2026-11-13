import https from 'node:https';
import tls from 'node:tls';
import { parseBcvHtml } from './bcv-parser.js';
import { SECTIGO_DV_R36 } from './bcv-ca.js';

const BCV_URL = 'https://www.bcv.org.ve/';
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
// After a failure, wait this long before hitting BCV again (forced refreshes bypass it).
const RETRY_COOLDOWN_MS = 30_000;
// Mozilla roots plus the intermediate BCV forgets to send. Verification stays fully on.
const BCV_CA = [...tls.rootCertificates, SECTIGO_DV_R36];

let cache = null; // { usd, eur, valueDate, fetchedAt }
let inflight = null;
let lastFailureAt = 0;
let consecutiveFailures = 0;

function getBcvHtml() {
  return new Promise((resolve, reject) => {
    const req = https.get(BCV_URL, {
      ca: BCV_CA,
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (bcv-calc)', Accept: 'text/html' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`BCV responded with HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding('utf8');
      let html = '';
      res.on('data', (chunk) => { html += chunk; });
      res.on('end', () => resolve(html));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('BCV request timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

async function fetchFromBcv() {
  const html = await getBcvHtml();
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
    `[rates] ${kind} failures=${consecutiveFailures} staleMinutes=${staleMin ?? 'n/a'} reason=${err.code ?? err.cause?.code ?? err.message}`
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
