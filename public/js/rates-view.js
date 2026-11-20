import {
  fetchRates,
  getRates,
  getOfficialRates,
  getRateVariation,
  disableCustomRate,
  onRatesChange,
} from './rates-api.js';
import { formatNumber, formatAmount, formatValueDate, formatFetchedAt } from './format.js';
import { copyText, formatBankCopy } from './clipboard.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);

const statusEl = $('#status');
const refreshBtn = $('#refresh-rates');
const bannerEl = $('#custom-rate-banner');
const bannerLabelEl = $('#custom-banner-label');

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function renderVariation(cur, variation) {
  const el = $(`[data-rate-var="${cur}"]`);
  if (!el) return;
  if (!variation) {
    el.hidden = true;
    return;
  }
  const pct = cur === 'USD' ? variation.usdPct : variation.eurPct;
  const diff = cur === 'USD' ? variation.usdDiff : variation.eurDiff;
  if (Math.abs(diff) < 1e-6) {
    el.hidden = false;
    el.dataset.dir = 'flat';
    el.textContent = '= 0,00%';
    return;
  }
  const up = diff > 0;
  el.hidden = false;
  el.dataset.dir = up ? 'up' : 'down';
  const sign = up ? '+' : '−';
  const arrow = up ? '▲' : '▼';
  el.textContent = `${arrow} ${sign}${formatNumber(Math.abs(pct), 2)}%`;
}

function renderBanner(rates) {
  if (!bannerEl) return;
  bannerEl.hidden = !rates?.isCustom;
  if (rates?.isCustom && bannerLabelEl) {
    const spread = rates.marginPct != null
      ? ` (${rates.marginPct >= 0 ? '+' : '−'}${formatNumber(Math.abs(rates.marginPct), 2)}% vs BCV)`
      : '';
    bannerLabelEl.textContent = `${rates.customLabel}: 1 $ = ${formatNumber(rates.usd, 2)} Bs${spread}`;
  }
}

function render(rates) {
  const official = getOfficialRates();
  const variation = getRateVariation();
  renderBanner(rates);

  if (!rates) {
    setStatus('idle', 'Sin tasas todavía');
    return;
  }

  for (const [cur, value] of [['USD', rates.usd], ['EUR', rates.eur]]) {
    $(`[data-rate="${cur}"]`).textContent = formatNumber(value, 2);
    $(`[data-rate-exact="${cur}"]`).textContent = formatNumber(value, cur === 'USD' ? 4 : 8);
    renderVariation(cur, rates.isCustom ? null : variation);
  }
  $('[data-rate-inverse="USD"]').textContent = formatAmount(1 / rates.usd);
  $('[data-rate-cross]').textContent = formatNumber(rates.eur / rates.usd, 4);
  $('#value-date').textContent = rates.valueDate ? formatValueDate(rates.valueDate) : 'Manual';
  $('#fetched-at').textContent = formatFetchedAt(rates.fetchedAt);

  document.querySelectorAll('.rate').forEach((card) => {
    card.classList.toggle('is-custom', Boolean(rates.isCustom));
  });

  if (rates.isCustom) {
    setStatus('custom', rates.customLabel || 'Tasa personalizada');
  } else if (rates.stale) {
    setStatus('stale', 'Sin conexión · última tasa BCV');
  } else {
    setStatus('live', `Actualizado: ${formatFetchedAt((official ?? rates).fetchedAt)}`);
  }
}

/* ---------- Automatic & manual refresh ---------- */

const POLL_MS = 5 * 60 * 1000;
const RESUME_MIN_GAP_MS = 60 * 1000;

let loading = false;
let lastCheckAt = 0;
let lastErrorShown = false;

function rateChanged(before, after) {
  return before && (before.usd !== after.usd || before.eur !== after.eur);
}

export async function refresh({ force = false } = {}) {
  if (loading) return;
  loading = true;
  lastCheckAt = Date.now();
  const before = getOfficialRates();
  if (!before) setStatus('loading', 'Cargando tasas…');

  const spinButtons = [refreshBtn, $('#history-refresh-btn')].filter(Boolean);
  spinButtons.forEach((b) => {
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
  });

  try {
    const rates = await fetchRates({ refresh: force });
    if (rates.stale) {
      if (force || !lastErrorShown) toast('El BCV no responde. Usando la última tasa guardada.', { tone: 'error' });
      lastErrorShown = true;
    } else {
      lastErrorShown = false;
      if (rateChanged(before, rates)) {
        toast(`Nueva tasa BCV: 1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs`);
      } else if (force) {
        toast(`Tasas BCV al día: 1 USD = ${formatNumber(rates.usd, 2)} Bs`);
      }
    }
  } catch {
    const cached = getOfficialRates();
    if (!getRates()?.isCustom) {
      setStatus('stale', cached ? `Sin conexión · ${formatFetchedAt(cached.fetchedAt)}` : 'Tasas no disponibles');
    }
    if (force || !lastErrorShown) {
      toast(cached
        ? 'Sin conexión. Se sigue trabajando con la última tasa BCV guardada.'
        : `No se pudieron cargar las tasas. ${navigator.onLine ? 'Se reintentará automáticamente.' : 'No hay conexión a internet.'}`,
      { tone: 'error' });
    }
    lastErrorShown = true;
  } finally {
    loading = false;
    spinButtons.forEach((b) => {
      b.disabled = false;
      b.setAttribute('aria-busy', 'false');
    });
  }
}

function setupRateCopy() {
  document.querySelectorAll('.rate[data-cur]').forEach((card) => {
    const triggerCopy = () => {
      const rates = getRates();
      if (!rates) return;
      const cur = card.dataset.cur;
      const val = cur === 'USD' ? rates.usd : rates.eur;
      const formatted = formatBankCopy(val, 4);
      copyText(formatted, `Tasa ${cur} copiada: ${formatted} Bs`);
    };
    card.addEventListener('click', triggerCopy);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerCopy();
      }
    });
  });
}

function startAutoRefresh() {
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheckAt > RESUME_MIN_GAP_MS) refresh();
  });
  window.addEventListener('online', () => refresh());
}

export function initRatesView() {
  refreshBtn?.addEventListener('click', () => refresh({ force: true }));
  $('#custom-reset-bcv')?.addEventListener('click', () => {
    disableCustomRate();
    toast('Volviste a la tasa oficial BCV');
  });
  setupRateCopy();
  render(getRates());
  onRatesChange(render);
  startAutoRefresh();
}
