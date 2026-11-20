import { CURRENCIES, aggregate, convert, parseInput } from './convert.js';
import { formatAmount, formatNumber, formatValueDate, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { getProfile, hasPagoMovilData, formatPagoMovilText } from './profile-store.js';
import { load, save } from './storage.js';
import { confirmAction } from './confirm.js';
import * as store from './windows-store.js';
import { buildSegment, markSegment, addCalculation } from './calculator-view.js';
import { copyText, formatBankCopy } from './clipboard.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);
const panel = $('#panel');
const scrim = $('#scrim');
const listEl = $('#calc-list');
const currencySeg = $('#total-currency');
const openBtn = $('#open-panel');
const docked = window.matchMedia('(min-width: 900px)');

let outCurrency = CURRENCIES.includes(load('totalCurrency')) ? load('totalCurrency') : 'VES';
let isOpen = false;

// The total follows the currency being calculated into, so Bs → USD work totals in USD.
// Picking a currency in the panel still overrides it until the pair changes again.
let lastTo = store.getActive()?.to;
function followActivePair() {
  const to = store.getActive()?.to;
  if (!to || to === lastTo) return;
  lastTo = to;
  setTotalCurrency(to);
}

function setTotalCurrency(cur) {
  outCurrency = cur;
  save('totalCurrency', cur);
}

function windowsWithAmounts() {
  return store.getState().windows.map((w) => ({ ...w, amount: parseInput(w.input) }));
}

/* ---------- Drawer ---------- */

function syncDrawer() {
  const visible = docked.matches || isOpen;
  panel.classList.toggle('is-open', isOpen);
  panel.inert = !visible;
  scrim.hidden = docked.matches || !isOpen;
  openBtn.setAttribute('aria-expanded', String(visible));
}

export function openPanel() {
  isOpen = true;
  syncDrawer();
  if (!docked.matches) $('#close-panel').focus();
  listEl.querySelector('.item.is-active')?.scrollIntoView({ block: 'nearest' });
}

export function closePanel() {
  if (!isOpen) return;
  isOpen = false;
  syncDrawer();
  if (!docked.matches) openBtn.focus();
}

/* ---------- Items ---------- */

const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function deleteWithUndo(win) {
  const deleted = store.removeWindow(win.id);
  if (!deleted) return;
  toast(`"${win.name}" eliminado`, {
    duration: 5000,
    actionLabel: 'Deshacer',
    onAction: () => {
      store.restoreWindow(deleted);
      toast(`"${win.name}" restaurado`);
    },
  });
}

function renderItem(win, rates, activeId) {
  const qty = win.qty > 1 ? win.qty : 1;
  const subtotal = win.amount * qty;

  const li = document.createElement('li');
  li.className = 'item';
  li.classList.toggle('is-active', win.id === activeId);
  li.classList.toggle('is-excluded', win.included === false);

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'item__open';
  open.setAttribute('aria-label', `Abrir ${win.name}`);
  open.innerHTML = `
    <span class="item__name"></span>
    <span class="item__from num"></span>
    <span class="item__to num"></span>`;
  open.querySelector('.item__name').textContent = win.name;
  open.querySelector('.item__from').dataset.cur = win.from;
  open.querySelector('.item__to').dataset.cur = win.to;
  open.querySelector('.item__from').textContent = qty > 1
    ? `${qty} × ${formatAmount(win.amount)} ${code(win.from)}`
    : `${formatAmount(win.amount)} ${code(win.from)}`;
  open.querySelector('.item__to').textContent = rates
    ? `${formatAmount(convert(subtotal, win.from, win.to, rates))} ${code(win.to)}`
    : '–';
  open.addEventListener('click', () => {
    store.selectWindow(win.id);
    closePanel();
  });

  const actions = document.createElement('div');
  actions.className = 'item__actions';

  const include = document.createElement('label');
  include.className = 'item__include';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = win.included !== false;
  check.id = `inc-${win.id}`;
  check.addEventListener('change', () => store.updateWindow(win.id, { included: check.checked }));
  include.append(check, document.createTextNode('Sumar'));

  // Quantity stepper (×1, ×2, ...)
  const qtyBox = document.createElement('div');
  qtyBox.className = 'item__qty';
  const dec = document.createElement('button');
  dec.type = 'button';
  dec.className = 'qty-btn';
  dec.textContent = '−';
  dec.disabled = qty <= 1;
  dec.setAttribute('aria-label', `Disminuir cantidad de ${win.name}`);
  dec.addEventListener('click', () => store.updateWindow(win.id, { qty: Math.max(1, qty - 1) }));

  const qtyVal = document.createElement('span');
  qtyVal.className = 'qty-val num';
  qtyVal.textContent = `×${qty}`;

  const inc = document.createElement('button');
  inc.type = 'button';
  inc.className = 'qty-btn';
  inc.textContent = '+';
  inc.setAttribute('aria-label', `Aumentar cantidad de ${win.name}`);
  inc.addEventListener('click', () => store.updateWindow(win.id, { qty: Math.min(999, qty + 1) }));
  qtyBox.append(dec, qtyVal, inc);

  const rightBtns = document.createElement('div');
  rightBtns.className = 'item__btns';

  const dup = document.createElement('button');
  dup.type = 'button';
  dup.className = 'icon-btn item__dup';
  dup.innerHTML = copyIcon;
  dup.title = 'Duplicar cálculo';
  dup.setAttribute('aria-label', `Duplicar ${win.name}`);
  dup.addEventListener('click', () => {
    store.duplicateWindow(win.id);
    toast(`"${win.name}" duplicado`);
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn item__delete';
  del.innerHTML = deleteIcon;
  del.title = 'Eliminar cálculo';
  del.setAttribute('aria-label', `Eliminar ${win.name}`);
  del.addEventListener('click', () => deleteWithUndo(win));

  rightBtns.append(dup, del);
  actions.append(include, qtyBox, rightBtns);
  li.append(open, actions);
  return li;
}

/* ---------- Render ---------- */

function render() {
  markSegment(currencySeg, outCurrency);
  const rates = getRates();
  const { activeId } = store.getState();
  const windows = windowsWithAmounts();

  const focusedId = document.activeElement?.id;
  listEl.replaceChildren(...windows.map((w) => renderItem(w, rates, activeId)));
  // Keep keyboard focus on the checkbox that triggered the re-render.
  if (focusedId?.startsWith('inc-')) document.getElementById(focusedId)?.focus();

  const count = windows.length;
  $('#dock-count').textContent = `${count} ${count === 1 ? 'cálculo' : 'cálculos'}`;

  if (!rates) {
    for (const id of ['#grand-total', '#dock-total']) $(id).textContent = '–';
    $('#total-rates').textContent = 'Sin tasas disponibles. Actualice en la pestaña Tasas.';
    return;
  }

  const total = formatAmount(aggregate(windows, outCurrency, rates).total);
  $('#grand-total').textContent = total;
  $('#dock-total').textContent = total;
  $('#grand-code').textContent = code(outCurrency);
  $('#dock-code').textContent = code(outCurrency);
  $('#open-panel').dataset.cur = outCurrency;

  const ratePrefix = rates.isCustom ? `${rates.customLabel || 'Personalizada'}: ` : '';
  const datePart = rates.valueDate ? ` · ${formatValueDate(rates.valueDate)}` : '';
  $('#total-rates').textContent =
    `${ratePrefix}1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs${datePart}`;
}

/* ---------- Share ---------- */

/** Included calculations converted to the chosen total currency, or null without rates. */
export function getSummary() {
  const rates = getRates();
  if (!rates) return null;
  return { ...aggregate(windowsWithAmounts(), outCurrency, rates), rates };
}

export function buildShareText() {
  const rates = getRates();
  if (!rates) return null;
  const { lines, total } = aggregate(windowsWithAmounts(), outCurrency, rates);
  const out = code(outCurrency);
  const profile = getProfile();

  const title = profile.businessName ? `*${profile.businessName} — Resumen*` : '*Resumen de cálculos*';
  const rateTitle = rates.isCustom ? (rates.customLabel || 'Tasa personalizada') : 'Tasa BCV';

  const parts = [
    title,
    ...lines.map((l) => {
      const qtyPart = l.qty > 1 ? `${l.qty} × ` : '';
      return `• ${l.name}: ${qtyPart}${formatAmount(l.amount)} ${code(l.from)} → ${formatAmount(l.result)} ${code(l.to)}`;
    }),
    '',
    `*Total: ${formatAmount(total)} ${out}*`,
    '',
    `${rateTitle}: 1 USD = ${formatNumber(rates.usd, 2)} Bs | 1 EUR = ${formatNumber(rates.eur, 2)} Bs`,
  ];

  if (rates.valueDate && !rates.isCustom) {
    parts.push(`Fecha valor BCV: ${formatValueDate(rates.valueDate)}`);
  }

  if (profile.pagoMovil.enabled && hasPagoMovilData(profile)) {
    parts.push('', formatPagoMovilText(profile));
  }

  return parts.join('\n');
}

function getTextOrWarn() {
  const text = buildShareText();
  if (!text) toast('No hay tasas disponibles para compartir.', { tone: 'error' });
  return text;
}

async function copySummaryText() {
  const text = getTextOrWarn();
  if (!text) return;
  await copyText(text, 'Texto copiado');
}

function shareWhatsApp() {
  const text = getTextOrWarn();
  if (text) window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

async function shareNative() {
  const text = getTextOrWarn();
  if (!text) return;
  try {
    await navigator.share({ title: 'Resumen de cálculos', text });
  } catch (err) {
    if (err.name !== 'AbortError') toast('No se pudo compartir.', { tone: 'error' });
  }
}

async function clearAll() {
  const ok = await confirmAction({
    title: '¿Vaciar todos los cálculos?',
    text: 'Se eliminarán todos los cálculos y el total volverá a cero.',
    confirmLabel: 'Confirmar',
  });
  if (!ok) return;
  const snapshot = store.clearAll();
  toast('Cálculos borrados', {
    duration: 5000,
    actionLabel: 'Deshacer',
    onAction: () => {
      store.restoreSnapshot(snapshot);
      toast('Cálculos restaurados');
    },
  });
}

/* ---------- Init ---------- */

export function initPanelView() {
  buildSegment(currencySeg, (cur) => {
    setTotalCurrency(cur);
    render();
  });

  openBtn.addEventListener('click', openPanel);
  $('#close-panel').addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen && !document.querySelector('dialog[open]')) closePanel();
  });
  docked.addEventListener('change', syncDrawer);

  $('#panel-add').addEventListener('click', () => {
    addCalculation();
    closePanel();
  });

  $('#copy-grand-total')?.addEventListener('click', () => {
    const summary = getSummary();
    if (!summary || summary.total <= 0) return;
    const plain = formatBankCopy(summary.total);
    copyText(plain, `Total copiado: ${plain} ${code(summary.currency)}`);
  });

  if (typeof navigator.share === 'function') $('#share-native').hidden = false;
  $('#share-whatsapp').addEventListener('click', shareWhatsApp);
  $('#share-native').addEventListener('click', shareNative);
  $('#share-copy').addEventListener('click', copySummaryText);
  $('#clear-all').addEventListener('click', clearAll);
  $('#empty-all').addEventListener('click', clearAll);

  store.subscribe(() => {
    followActivePair();
    render();
  });
  onRatesChange(render);
  syncDrawer();
  render();
}
