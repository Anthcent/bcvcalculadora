import { CURRENCIES, CURRENCY_META, convert, parseInput, thirdCurrency, rateBetween, toKeypadInput } from './convert.js';
import { formatAmount, formatInput, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { isConfirmOpen } from './confirm.js';
import * as store from './windows-store.js';

const $ = (sel) => document.querySelector(sel);

const nameBtn = $('#window-name');
const nameInput = $('#window-name-input');
const resultEl = $('#result-display');
const amountEl = $('#amount-display');

const MAX_INT_DIGITS = 12;
const MAX_DECIMALS = 2;
const LONG_PRESS_MS = 550;

/* ---------- Keypad input rules ---------- */

export function applyKey(input, key) {
  if (key === 'back') return input.slice(0, -1);
  if (key === 'clear') return '';
  const [intPart, decPart] = input.split(',');
  if (key === ',') return decPart !== undefined ? input : `${intPart || '0'},`;
  if (!/^\d$/.test(key)) return input;
  if (decPart !== undefined) return decPart.length >= MAX_DECIMALS ? input : input + key;
  if (intPart === '0') return key; // Replace a leading zero.
  return intPart.length >= MAX_INT_DIGITS ? input : input + key;
}

function pressKey(key) {
  const win = store.getActive();
  const next = applyKey(win.input, key);
  if (next !== win.input) store.updateWindow(win.id, { input: next });
}

/* ---------- Long press helper ---------- */

function onLongPress(el, handler) {
  let timer = null;
  let fired = false;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(15);
      handler();
    }, LONG_PRESS_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, cancel));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // Swallow the click that follows a long press.
  el.addEventListener('click', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
}

/* ---------- Currency selectors ---------- */

export function buildSegment(container, onPick) {
  container.replaceChildren(...CURRENCIES.map((cur) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg__opt';
    btn.setAttribute('role', 'radio');
    btn.dataset.currency = cur;
    btn.textContent = code(cur);
    btn.addEventListener('click', () => onPick(cur));
    return btn;
  }));
}

export function markSegment(container, value) {
  container.querySelectorAll('.seg__opt').forEach((btn) => {
    const checked = btn.dataset.currency === value;
    btn.setAttribute('aria-checked', String(checked));
    btn.tabIndex = checked ? 0 : -1;
  });
}

function pickCurrency(side, cur) {
  const win = store.getActive();
  const other = side === 'from' ? 'to' : 'from';
  // Picking the same currency on both sides swaps them instead.
  const patch = cur === win[other] ? { [side]: cur, [other]: win[side] } : { [side]: cur };
  store.updateWindow(win.id, patch);
}

/** Reverses the conversion: the current result becomes the new amount (5 USD -> 4.558,12 Bs). */
function swap() {
  const win = store.getActive();
  const rates = getRates();
  const amount = parseInput(win.input);
  const input = rates && amount ? toKeypadInput(convert(amount, win.from, win.to, rates)) : win.input;
  store.updateWindow(win.id, { from: win.to, to: win.from, input });
  $('#swap').classList.toggle('is-flipped');
}

/* ---------- Readout ---------- */

// Shrinks long numbers so they always fit on one line.
function fitSize(el, text) {
  const len = text.length;
  el.dataset.size = len > 16 ? 'xs' : len > 12 ? 'sm' : len > 9 ? 'md' : 'lg';
}

function renderReadout(win) {
  const rates = getRates();
  const amount = parseInput(win.input);

  const amountText = formatInput(win.input);
  amountEl.textContent = amountText;
  fitSize(amountEl.parentElement, amountText);
  $('#from-code').textContent = code(win.from);
  $('#to-code').textContent = code(win.to);
  // Color each card by its currency so the input currency is obvious at a glance.
  $('#money-from').dataset.cur = win.from;
  $('#money-to').dataset.cur = win.to;
  $('#from-name').textContent = CURRENCY_META[win.from].name;
  $('#to-name').textContent = CURRENCY_META[win.to].name;

  if (!rates) {
    resultEl.textContent = '–';
    $('#third-display').textContent = 'Sin tasas. Actualice en la pestaña Tasas.';
    return;
  }

  const result = formatAmount(convert(amount, win.from, win.to, rates));
  resultEl.textContent = result;
  fitSize(resultEl.parentElement, result);

  const third = thirdCurrency(win.from, win.to);
  const thirdValue = formatAmount(convert(amount, win.from, third, rates));
  const rate = formatAmount(rateBetween(win.from, win.to, rates));
  $('#third-display').textContent = `≈ ${thirdValue} ${code(third)}  ·  1 ${code(win.from)} = ${rate} ${code(win.to)}`;
}

function renderWindow() {
  const win = store.getActive();
  if (nameInput.hidden) nameBtn.textContent = win.name;
  markSegment($('.seg[data-side="from"]'), win.from);
  markSegment($('.seg[data-side="to"]'), win.to);
  renderReadout(win);
}

/* ---------- Rename ---------- */

function startRename() {
  const win = store.getActive();
  nameInput.value = win.name;
  nameBtn.hidden = true;
  nameInput.hidden = false;
  nameInput.focus();
  nameInput.select();
}

function finishRename(commit) {
  if (nameInput.hidden) return;
  const win = store.getActive();
  const name = nameInput.value.trim();
  nameInput.hidden = true;
  nameBtn.hidden = false;
  if (commit && name && name !== win.name) store.updateWindow(win.id, { name });
  else nameBtn.textContent = win.name;
}

/* ---------- Init ---------- */

export function addCalculation() {
  finishRename(true);
  store.addWindow();
}

/** Opens a calculation with a ready amount; keeps the active one if it has data. */
export function startCalculation(from, input) {
  finishRename(true);
  const active = store.getActive();
  const win = active.input ? store.addWindow() : active;
  const to = win.to === from ? (from === 'VES' ? 'USD' : 'VES') : win.to;
  store.updateWindow(win.id, { from, to, input });
}

export function initCalculatorView(isActive) {
  buildSegment($('.seg[data-side="from"]'), (cur) => pickCurrency('from', cur));
  buildSegment($('.seg[data-side="to"]'), (cur) => pickCurrency('to', cur));

  $('#keypad').addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (key) pressKey(key);
  });
  onLongPress($('[data-key="back"]'), () => pressKey('clear'));
  $('#clear-amount').addEventListener('click', () => pressKey('clear'));
  $('#swap').addEventListener('click', swap);
  $('#add-window').addEventListener('click', addCalculation);

  nameBtn.addEventListener('click', startRename);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finishRename(true);
    if (e.key === 'Escape') finishRename(false);
  });
  nameInput.addEventListener('blur', () => finishRename(true));

  // Physical keyboard support while the calculator is visible.
  document.addEventListener('keydown', (e) => {
    if (!isActive() || e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isConfirmOpen()) return;
    const map = { Backspace: 'back', Delete: 'clear', '.': ',', ',': ',' };
    const key = /^\d$/.test(e.key) ? e.key : map[e.key];
    if (!key) return;
    e.preventDefault();
    pressKey(key);
  });

  store.subscribe(renderWindow);
  onRatesChange(renderWindow);
  renderWindow();
}
