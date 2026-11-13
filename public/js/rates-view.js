import { fetchRates, getRates, onRatesChange } from './rates-api.js';
import { formatNumber, formatAmount, formatValueDate, formatFetchedAt } from './format.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);

const statusEl = $('#status');

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function render(rates) {
  if (!rates) {
    setStatus('idle', 'Sin tasas todavía');
    return;
  }
  for (const [cur, value] of [['USD', rates.usd], ['EUR', rates.eur]]) {
    $(`[data-rate="${cur}"]`).textContent = formatNumber(value, 2);
    $(`[data-rate-exact="${cur}"]`).textContent = formatNumber(value, cur === 'USD' ? 4 : 8);
  }
  $('[data-rate-inverse="USD"]').textContent = formatAmount(1 / rates.usd);
  $('[data-rate-cross]').textContent = formatNumber(rates.eur / rates.usd, 4);
  $('#value-date').textContent = formatValueDate(rates.valueDate);
  $('#fetched-at').textContent = formatFetchedAt(rates.fetchedAt);

  if (rates.stale) setStatus('stale', 'BCV sin respuesta, tasas guardadas');
  else setStatus('live', `Actualizado: ${formatFetchedAt(rates.fetchedAt)}`);
}

/* ---------- Automatic refresh ---------- */

// The server caches BCV for 10 minutes, so polling more often never hits BCV harder.
const POLL_MS = 5 * 60 * 1000;
const RESUME_MIN_GAP_MS = 60 * 1000;

let loading = false;
let lastCheckAt = 0;
let lastErrorShown = false;

function rateChanged(before, after) {
  return before && (before.usd !== after.usd || before.eur !== after.eur);
}

export async function refresh() {
  if (loading) return;
  loading = true;
  lastCheckAt = Date.now();
  const before = getRates();
  if (!before) setStatus('loading', 'Cargando tasas…');

  try {
    const rates = await fetchRates();
    if (rates.stale) {
      if (!lastErrorShown) toast('El BCV no responde. Se muestran las últimas tasas obtenidas.', { tone: 'error' });
      lastErrorShown = true;
    } else {
      lastErrorShown = false;
      if (rateChanged(before, rates)) {
        toast(`Nueva tasa BCV: 1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs`);
      }
    }
  } catch {
    const cached = getRates();
    setStatus('stale', cached ? `Sin conexión · ${formatFetchedAt(cached.fetchedAt)}` : 'Tasas no disponibles');
    // Report a failure once; keep retrying quietly on the next tick.
    if (!lastErrorShown) {
      toast(cached
        ? 'Sin conexión. Se muestran las tasas guardadas.'
        : `No se pudieron cargar las tasas. ${navigator.onLine ? 'Se reintentará automáticamente.' : 'No hay conexión a internet.'}`,
      { tone: 'error' });
    }
    lastErrorShown = true;
  } finally {
    loading = false;
  }
}

function startAutoRefresh() {
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheckAt > RESUME_MIN_GAP_MS) refresh();
  });
  window.addEventListener('online', refresh);
}

export function initRatesView() {
  render(getRates());
  onRatesChange(render);
  startAutoRefresh();
}
