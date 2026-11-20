import {
  fetchRates,
  getRates,
  getOfficialRates,
  getRateHistory,
  getRateVariation,
  getCustomRateConfig,
  setCustomRateConfig,
  disableCustomRate,
  onRatesChange,
} from './rates-api.js';
import { normalizeTypedAmount, parseInput } from './convert.js';
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
  el.textContent = `${arrow} ${sign}${formatNumber(Math.abs(pct), 2)}% (${sign}${formatNumber(Math.abs(diff), 2)} Bs)`;
}

function renderHistory() {
  const listEl = $('#history-list');
  const sparkEl = $('#history-spark');
  const countEl = $('#history-count');
  if (!listEl || !sparkEl) return;

  const history = getRateHistory();
  if (countEl) countEl.textContent = history.length ? `${history.length} reg.` : '';

  if (history.length === 0) {
    listEl.innerHTML = '<li class="history__empty">Aún no hay historial guardado en este dispositivo.</li>';
    sparkEl.hidden = true;
    return;
  }

  // Render SVG sparkline when at least 2 points exist.
  if (history.length >= 2) {
    const vals = history.map((h) => h.usd);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const W = 280;
    const H = 56;
    const PAD = 6;
    const points = vals.map((v, i) => {
      const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
      const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    sparkEl.hidden = false;
    sparkEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <polyline fill="none" stroke="var(--usd)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${points}"/>
      </svg>`;
  } else {
    sparkEl.hidden = true;
  }

  // Latest first in the table.
  const rows = [...history].reverse().slice(0, 12);
  listEl.replaceChildren(...rows.map((item) => {
    const li = document.createElement('li');
    li.className = 'history__row';
    const d = document.createElement('span');
    d.className = 'history__date';
    d.textContent = formatValueDate(item.valueDate);
    const u = document.createElement('span');
    u.className = 'history__val num';
    u.dataset.cur = 'USD';
    u.textContent = `${formatNumber(item.usd, 2)} Bs`;
    const e = document.createElement('span');
    e.className = 'history__val num';
    e.dataset.cur = 'EUR';
    e.textContent = `${formatNumber(item.eur, 2)} Bs`;
    li.append(d, u, e);
    return li;
  }));
}

function renderCustomUi(effective) {
  const cfg = getCustomRateConfig();
  const official = getOfficialRates();

  if (bannerEl) {
    bannerEl.hidden = !effective?.isCustom;
    if (effective?.isCustom && bannerLabelEl) {
      const spread = effective.marginPct != null
        ? ` (${effective.marginPct >= 0 ? '+' : '−'}${formatNumber(Math.abs(effective.marginPct), 2)}% vs BCV)`
        : '';
      bannerLabelEl.textContent = `${effective.customLabel}: 1 $ = ${formatNumber(effective.usd, 2)} Bs${spread}`;
    }
  }

  const toggle = $('#custom-enabled');
  if (toggle) toggle.checked = cfg.enabled;

  const badge = $('#custom-status-badge');
  if (badge) {
    badge.textContent = cfg.enabled ? 'Activa' : 'BCV Oficial';
    badge.dataset.active = String(cfg.enabled);
  }

  document.querySelectorAll('[data-custom-mode]').forEach((btn) => {
    const active = btn.dataset.customMode === cfg.mode;
    btn.setAttribute('aria-checked', String(active));
  });

  const manualBox = $('#custom-manual-fields');
  const marginBox = $('#custom-margin-fields');
  if (manualBox) manualBox.hidden = cfg.mode !== 'manual';
  if (marginBox) marginBox.hidden = cfg.mode !== 'margin';

  const compareEl = $('#custom-compare');
  if (compareEl) {
    if (official && effective?.isCustom) {
      const diffUsd = effective.usd - official.usd;
      const pct = ((diffUsd) / official.usd) * 100;
      const sign = diffUsd >= 0 ? '+' : '−';
      compareEl.textContent = `Diferencia vs BCV: ${sign}${formatNumber(Math.abs(diffUsd), 2)} Bs (${sign}${formatNumber(Math.abs(pct), 2)}%) · BCV: ${formatNumber(official.usd, 2)} Bs`;
    } else if (official) {
      compareEl.textContent = `Referencia oficial BCV: 1 USD = ${formatNumber(official.usd, 2)} Bs · 1 EUR = ${formatNumber(official.eur, 2)} Bs`;
    } else {
      compareEl.textContent = 'Puedes fijar una tasa manual incluso sin conexión al BCV.';
    }
  }
}

function render(rates) {
  const official = getOfficialRates();
  const variation = getRateVariation();

  if (!rates) {
    setStatus('idle', 'Sin tasas todavía');
    renderCustomUi(null);
    renderHistory();
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

  // Show subtle label on rate cards if custom mode is active.
  document.querySelectorAll('.rate').forEach((card) => {
    card.classList.toggle('is-custom', Boolean(rates.isCustom));
  });

  if (rates.isCustom) {
    setStatus('custom', rates.customLabel || 'Tasa personalizada');
  } else if (rates.stale) {
    setStatus('stale', 'BCV sin respuesta, tasas guardadas');
  } else {
    setStatus('live', `Actualizado: ${formatFetchedAt((official ?? rates).fetchedAt)}`);
  }

  renderCustomUi(rates);
  renderHistory();
}

/* ---------- Automatic & manual refresh ---------- */

// The server caches BCV for 10 minutes, so polling more often never hits BCV harder.
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
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.setAttribute('aria-busy', 'true');
  }

  try {
    const rates = await fetchRates({ refresh: force });
    if (rates.stale) {
      if (force || !lastErrorShown) toast('El BCV no responde. Se muestran las últimas tasas obtenidas.', { tone: 'error' });
      lastErrorShown = true;
    } else {
      lastErrorShown = false;
      if (rateChanged(before, rates)) {
        toast(`Nueva tasa BCV: 1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs`);
      } else if (force) {
        toast(`Tasas al día: 1 USD = ${formatNumber(rates.usd, 2)} Bs`);
      }
    }
  } catch {
    const cached = getOfficialRates();
    if (!getRates()?.isCustom) {
      setStatus('stale', cached ? `Sin conexión · ${formatFetchedAt(cached.fetchedAt)}` : 'Tasas no disponibles');
    }
    if (force || !lastErrorShown) {
      toast(cached
        ? 'Sin conexión. Se muestran las tasas guardadas.'
        : `No se pudieron cargar las tasas. ${navigator.onLine ? 'Se reintentará automáticamente.' : 'No hay conexión a internet.'}`,
      { tone: 'error' });
    }
    lastErrorShown = true;
  } finally {
    loading = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.setAttribute('aria-busy', 'false');
    }
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

function setupCustomControls() {
  const cfg = getCustomRateConfig();
  const usdInput = $('#custom-usd');
  const eurInput = $('#custom-eur');
  const marginInput = $('#custom-margin');
  const labelInput = $('#custom-label');
  const toggle = $('#custom-enabled');

  if (usdInput && cfg.usd) usdInput.value = formatBankCopy(cfg.usd, 2);
  if (eurInput && cfg.eur) eurInput.value = formatBankCopy(cfg.eur, 2);
  if (marginInput) marginInput.value = String(cfg.marginPct ?? 5);
  if (labelInput) labelInput.value = cfg.label ?? '';

  const readManual = () => {
    const usd = parseInput(normalizeTypedAmount(usdInput.value));
    const eur = parseInput(normalizeTypedAmount(eurInput.value));
    return {
      usd: usd > 0 ? usd : null,
      eur: eur > 0 ? eur : null,
      label: labelInput.value.trim(),
    };
  };

  toggle?.addEventListener('change', () => {
    const currentCfg = getCustomRateConfig();
    if (toggle.checked && currentCfg.mode === 'manual') {
      const parsed = readManual();
      if (!parsed.usd) {
        const official = getOfficialRates();
        if (official) {
          usdInput.value = formatBankCopy(official.usd, 2);
          parsed.usd = official.usd;
        } else {
          toggle.checked = false;
          toast('Ingresa primero una tasa USD personalizada.', { tone: 'error' });
          return;
        }
      }
      setCustomRateConfig({ enabled: true, ...parsed });
      return;
    }
    setCustomRateConfig({ enabled: toggle.checked });
  });

  document.querySelectorAll('[data-custom-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setCustomRateConfig({ mode: btn.dataset.customMode });
    });
  });

  const onManualInput = () => {
    const parsed = readManual();
    setCustomRateConfig(parsed);
  };
  usdInput?.addEventListener('input', onManualInput);
  eurInput?.addEventListener('input', onManualInput);
  labelInput?.addEventListener('input', onManualInput);

  marginInput?.addEventListener('input', () => {
    const n = Number(String(marginInput.value).replace(',', '.'));
    if (Number.isFinite(n)) setCustomRateConfig({ marginPct: n });
  });

  document.querySelectorAll('[data-margin-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pct = Number(btn.dataset.marginPreset);
      if (marginInput) marginInput.value = String(pct);
      setCustomRateConfig({ mode: 'margin', marginPct: pct, enabled: true });
    });
  });

  $('#custom-reset-bcv')?.addEventListener('click', () => {
    disableCustomRate();
    toast('Volviste a la tasa oficial BCV');
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
  setupRateCopy();
  setupCustomControls();
  render(getRates());
  onRatesChange(render);
  startAutoRefresh();
}
