import { CURRENCIES, aggregate, convert, parseInput } from './convert.js';
import { formatAmount, formatNumber, formatValueDate, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { load, save } from './storage.js';
import { confirmAction } from './confirm.js';
import * as store from './windows-store.js';
import { buildSegment, markSegment, addCalculation } from './calculator-view.js';
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

const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function requestDelete(win) {
  const ok = await confirmAction({
    title: '¿Eliminar cálculo?',
    text: `"${win.name}" se eliminará de la lista y del total.`,
  });
  if (ok) store.removeWindow(win.id);
}

function renderItem(win, rates, activeId) {
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
  open.querySelector('.item__from').textContent = `${formatAmount(win.amount)} ${code(win.from)}`;
  open.querySelector('.item__to').textContent = rates
    ? `${formatAmount(convert(win.amount, win.from, win.to, rates))} ${code(win.to)}`
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

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn item__delete';
  del.innerHTML = deleteIcon;
  del.setAttribute('aria-label', `Eliminar ${win.name}`);
  del.addEventListener('click', () => requestDelete(win));

  actions.append(include, del);
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
  $('#total-rates').textContent =
    `1 USD = ${formatNumber(rates.usd, 2)} Bs · 1 EUR = ${formatNumber(rates.eur, 2)} Bs · ${formatValueDate(rates.valueDate)}`;
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
  return [
    '*Resumen de cálculos*',
    ...lines.map((l) => `• ${l.name}: ${formatAmount(l.amount)} ${code(l.from)} → ${formatAmount(l.result)} ${code(l.to)}`),
    '',
    `*Total: ${formatAmount(total)} ${out}*`,
    '',
    `Tasa BCV: 1 USD = ${formatNumber(rates.usd, 2)} Bs | 1 EUR = ${formatNumber(rates.eur, 2)} Bs`,
    `Fecha valor BCV: ${formatValueDate(rates.valueDate)}`,
  ].join('\n');
}

function getTextOrWarn() {
  const text = buildShareText();
  if (!text) toast('No hay tasas disponibles para compartir.', { tone: 'error' });
  return text;
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

async function copyText() {
  const text = getTextOrWarn();
  if (!text) return;
  try {
    // The Clipboard API only exists in secure contexts (not on http://<LAN-IP>).
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else if (!legacyCopy(text)) throw new Error('copy failed');
    toast('Texto copiado');
  } catch {
    toast('No se pudo copiar el texto.', { tone: 'error' });
  }
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
    title: '¿Borrar todos los cálculos?',
    text: 'Se eliminarán todos los cálculos y el total volverá a cero. Esta acción no se puede deshacer.',
    confirmLabel: 'Borrar todo',
  });
  if (!ok) return;
  store.clearAll();
  toast('Cálculos borrados');
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
  if (typeof navigator.share === 'function') $('#share-native').hidden = false;
  $('#share-whatsapp').addEventListener('click', shareWhatsApp);
  $('#share-native').addEventListener('click', shareNative);
  $('#share-copy').addEventListener('click', copyText);
  $('#clear-all').addEventListener('click', clearAll);

  store.subscribe(() => {
    followActivePair();
    render();
  });
  onRatesChange(render);
  syncDrawer();
  render();
}
