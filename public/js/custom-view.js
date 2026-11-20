import {
  getRates,
  getOfficialRates,
  getRateHistory,
  getCustomRateConfig,
  setCustomRateConfig,
  disableCustomRate,
  onRatesChange,
} from './rates-api.js';
import { refresh } from './rates-view.js';
import { normalizeTypedAmount, parseInput } from './convert.js';
import { formatNumber, formatValueDate } from './format.js';
import { formatBankCopy } from './clipboard.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);

let chartCurrency = 'USD';
let selectedIndex = null;

function renderCustomSection(effective) {
  const cfg = getCustomRateConfig();
  const official = getOfficialRates();

  const toggle = $('#custom-enabled');
  if (toggle) toggle.checked = cfg.enabled;

  const badge = $('#custom-status-badge');
  if (badge) {
    badge.textContent = cfg.enabled ? 'Activa' : 'Usando BCV';
    badge.dataset.active = String(cfg.enabled);
  }

  const resetBtn = $('#custom-view-reset');
  if (resetBtn) resetBtn.hidden = !cfg.enabled;

  document.querySelectorAll('[data-custom-mode]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.customMode === cfg.mode));
  });

  const manualBox = $('#custom-manual-fields');
  const marginBox = $('#custom-margin-fields');
  if (manualBox) manualBox.hidden = cfg.mode !== 'manual';
  if (marginBox) marginBox.hidden = cfg.mode !== 'margin';

  document.querySelectorAll('[data-margin-preset]').forEach((btn) => {
    const active = cfg.enabled && cfg.mode === 'margin' && Number(btn.dataset.marginPreset) === cfg.marginPct;
    btn.classList.toggle('is-selected', active);
  });

  // Live visual comparison card
  const compBcvEl = $('#comp-bcv-val');
  const compCustomEl = $('#comp-custom-val');
  const compDiffEl = $('#comp-diff-pill');
  const compSampleEl = $('#comp-sample');

  if (compBcvEl) {
    compBcvEl.textContent = official ? `${formatNumber(official.usd, 2)} Bs` : '–';
  }
  if (compCustomEl) {
    compCustomEl.textContent = effective ? `${formatNumber(effective.usd, 2)} Bs` : '–';
  }
  if (compDiffEl) {
    if (official && effective?.isCustom) {
      const diff = effective.usd - official.usd;
      const pct = (diff / official.usd) * 100;
      const sign = diff >= 0 ? '+' : '−';
      compDiffEl.hidden = false;
      compDiffEl.dataset.dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      compDiffEl.textContent = `${sign}${formatNumber(Math.abs(diff), 2)} Bs (${sign}${formatNumber(Math.abs(pct), 2)}%)`;
    } else {
      compDiffEl.hidden = true;
    }
  }
  if (compSampleEl) {
    if (official && effective?.isCustom) {
      const exCustom = formatNumber(10 * effective.usd, 2);
      const exBcv = formatNumber(10 * official.usd, 2);
      const exDiff = Math.abs(10 * (effective.usd - official.usd));
      compSampleEl.textContent = `Ejemplo: 10 $ = ${exCustom} Bs (BCV: ${exBcv} Bs · dif. ${formatNumber(exDiff, 2)} Bs)`;
    } else if (official) {
      compSampleEl.textContent = `Actualmente toda la app usa la tasa oficial BCV (10 $ = ${formatNumber(10 * official.usd, 2)} Bs).`;
    } else {
      compSampleEl.textContent = 'Sin tasa BCV guardada. Puedes activar una tasa manual para trabajar sin conexión.';
    }
  }
}

function renderHistorySection() {
  const history = getRateHistory();
  const countEl = $('#history-count');
  const chartBox = $('#history-chart');
  const readoutEl = $('#history-readout');
  const listEl = $('#history-list');

  if (countEl) {
    countEl.textContent = history.length === 1 ? '1 día' : `${history.length} registros`;
  }

  document.querySelectorAll('[data-hist-cur]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.histCur === chartCurrency));
  });

  if (!chartBox || !listEl || !readoutEl) return;

  if (history.length === 0) {
    chartBox.hidden = true;
    readoutEl.textContent = 'Aún no hay tasas guardadas en este dispositivo.';
    listEl.innerHTML = '';
    return;
  }

  const key = chartCurrency === 'EUR' ? 'eur' : 'usd';
  const strokeVar = chartCurrency === 'EUR' ? 'var(--eur)' : 'var(--usd)';
  const idx = selectedIndex != null && selectedIndex < history.length ? selectedIndex : history.length - 1;
  const activeItem = history[idx];

  readoutEl.innerHTML = '';
  const rDate = document.createElement('span');
  rDate.className = 'hist-readout__date';
  rDate.textContent = formatValueDate(activeItem.valueDate);
  const rVal = document.createElement('strong');
  rVal.className = 'hist-readout__val num';
  rVal.dataset.cur = chartCurrency;
  rVal.textContent = `1 ${chartCurrency} = ${formatNumber(activeItem[key], 4)} Bs`;
  readoutEl.append(rDate, rVal);

  // Interactive SVG line chart with clickable points
  if (history.length >= 2) {
    const vals = history.map((h) => h[key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const W = 320;
    const H = 110;
    const PAD_X = 16;
    const PAD_Y = 16;

    const coords = vals.map((v, i) => ({
      x: PAD_X + (i / (vals.length - 1)) * (W - PAD_X * 2),
      y: H - PAD_Y - ((v - min) / span) * (H - PAD_Y * 2),
      i,
    }));

    const polyPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPoints = `${coords[0].x.toFixed(1)},${H - PAD_Y} ${polyPoints} ${coords[coords.length - 1].x.toFixed(1)},${H - PAD_Y}`;

    chartBox.hidden = false;
    chartBox.innerHTML = `
      <div class="hist-chart__bounds num">
        <span>Máx: ${formatNumber(max, 2)} Bs</span>
        <span>Mín: ${formatNumber(min, 2)} Bs</span>
      </div>
      <svg class="hist-chart__svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica histórica de ${chartCurrency}">
        <polygon points="${areaPoints}" fill="${strokeVar}" fill-opacity="0.12" />
        <polyline fill="none" stroke="${strokeVar}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" points="${polyPoints}" />
        ${coords.map((c) => `
          <circle
            class="hist-dot ${c.i === idx ? 'is-selected' : ''}"
            cx="${c.x.toFixed(1)}"
            cy="${c.y.toFixed(1)}"
            r="${c.i === idx ? 5.5 : 3.5}"
            fill="${c.i === idx ? strokeVar : 'var(--bg)'}"
            stroke="${strokeVar}"
            stroke-width="2.2"
            data-point-idx="${c.i}"
          />
        `).join('')}
      </svg>`;

    chartBox.querySelectorAll('[data-point-idx]').forEach((dot) => {
      dot.addEventListener('click', () => {
        selectedIndex = Number(dot.dataset.pointIdx);
        renderHistorySection();
      });
    });
  } else {
    chartBox.hidden = false;
    chartBox.innerHTML = '<p class="hist-chart__single">Se mostrará la gráfica interactiva automáticamente cuando se registren 2 o más fechas del BCV.</p>';
  }

  // Table list (newest first) with day-to-day variation
  const reversed = history.map((item, origIdx) => ({ item, origIdx })).reverse().slice(0, 15);
  listEl.replaceChildren(...reversed.map(({ item, origIdx }) => {
    const prev = origIdx > 0 ? history[origIdx - 1] : null;
    const diff = prev ? item[key] - prev[key] : null;
    const pct = prev && prev[key] > 0 ? (diff / prev[key]) * 100 : null;

    const li = document.createElement('li');
    li.className = 'history__row';
    li.classList.toggle('is-selected', origIdx === idx);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history__btn';

    const d = document.createElement('span');
    d.className = 'history__date';
    d.textContent = formatValueDate(item.valueDate);

    const v = document.createElement('span');
    v.className = 'history__val num';
    v.dataset.cur = chartCurrency;
    v.textContent = `${formatNumber(item[key], 2)} Bs`;

    const delta = document.createElement('span');
    delta.className = 'history__delta num';
    if (pct == null) {
      delta.textContent = 'Base';
      delta.dataset.dir = 'flat';
    } else if (Math.abs(diff) < 1e-6) {
      delta.textContent = '0,00%';
      delta.dataset.dir = 'flat';
    } else {
      const up = diff > 0;
      delta.dataset.dir = up ? 'up' : 'down';
      delta.textContent = `${up ? '▲ +' : '▼ −'}${formatNumber(Math.abs(pct), 2)}%`;
    }

    btn.append(d, v, delta);
    btn.addEventListener('click', () => {
      selectedIndex = origIdx;
      renderHistorySection();
    });
    li.append(btn);
    return li;
  }));
}

function render(effective) {
  renderCustomSection(effective);
  renderHistorySection();
}

export function initCustomView() {
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
      toast('Tasa personalizada activada');
      return;
    }
    setCustomRateConfig({ enabled: toggle.checked });
    toast(toggle.checked ? 'Tasa personalizada activada' : 'Volviste a la tasa oficial BCV');
  });

  document.querySelectorAll('[data-custom-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setCustomRateConfig({ mode: btn.dataset.customMode });
    });
  });

  const onManualInput = () => {
    setCustomRateConfig(readManual());
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

  $('#custom-fill-bcv')?.addEventListener('click', () => {
    const official = getOfficialRates();
    if (!official) {
      toast('No hay tasa BCV disponible para copiar.', { tone: 'error' });
      return;
    }
    usdInput.value = formatBankCopy(official.usd, 2);
    eurInput.value = formatBankCopy(official.eur, 2);
    setCustomRateConfig({ mode: 'manual', usd: official.usd, eur: official.eur });
    toast('Tasas BCV copiadas como base');
  });

  $('#custom-view-reset')?.addEventListener('click', () => {
    disableCustomRate();
    toast('Volviste a la tasa oficial BCV');
  });

  document.querySelectorAll('[data-hist-cur]').forEach((btn) => {
    btn.addEventListener('click', () => {
      chartCurrency = btn.dataset.histCur;
      renderHistorySection();
    });
  });

  $('#history-refresh-btn')?.addEventListener('click', () => refresh({ force: true }));

  onRatesChange(render);
  render(getRates());
}
