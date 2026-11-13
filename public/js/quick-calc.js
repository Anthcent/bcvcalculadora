import { CURRENCIES, CURRENCY_META, convert, normalizeTypedAmount, parseInput, toKeypadInput } from './convert.js';
import { formatAmount, formatInput, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { load, save } from './storage.js';
import { buildSegment, markSegment, startCalculation } from './calculator-view.js';
import { toast } from './toast.js';

const form = document.querySelector('#quick-form');
const input = document.querySelector('#quick-amount');
const currencySeg = document.querySelector('#quick-currency');
const preview = document.querySelector('#quick-preview');
const chipsEl = document.querySelector('#quick-chips');

let currency = ['USD', 'EUR', 'VES'].includes(load('quickCurrency')) ? load('quickCurrency') : 'USD';

function pick(cur) {
  currency = cur;
  save('quickCurrency', cur);
  markSegment(currencySeg, cur);
  input.dataset.cur = cur;
  renderPreview();
  renderChips();
}

/* ---------- Quick amount chips: each tap adds to the current amount ---------- */

const QUICK_AMOUNTS = [1, 5, 10, 15, 20, 25];
const SYMBOLS = { USD: '$', EUR: '€', VES: 'Bs' };

function addAmount(value) {
  const current = parseInput(normalizeTypedAmount(input.value));
  input.value = formatInput(toKeypadInput(current + value));
  navigator.vibrate?.(8);
  renderPreview();
}

function clearAmount() {
  input.value = '';
  renderPreview();
}

function renderChips() {
  const chips = QUICK_AMOUNTS.map((value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick__chip num';
    btn.textContent = `+${value}`;
    btn.dataset.amount = String(value);
    btn.setAttribute('aria-label', `Sumar ${value} ${CURRENCY_META[currency].name.toLowerCase()}`);
    return btn;
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'quick__chip quick__chip--clear';
  clear.dataset.action = 'clear';
  clear.setAttribute('aria-label', 'Borrar monto');
  clear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12zM17.5 9.5l-5 5M12.5 9.5l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  chipsEl.replaceChildren(...chips, clear);
  chipsEl.dataset.cur = currency;
  chipsEl.dataset.symbol = SYMBOLS[currency];
}

/** Live equivalents in the other two currencies while typing. */
function renderPreview() {
  const rates = getRates();
  const amount = parseInput(normalizeTypedAmount(input.value));
  const others = CURRENCIES.filter((c) => c !== currency);
  preview.replaceChildren(...others.map((cur) => {
    const item = document.createElement('div');
    item.className = 'quick__eq';
    item.dataset.cur = cur;
    const label = document.createElement('span');
    label.className = 'quick__eq-label';
    label.textContent = CURRENCY_META[cur].name;
    const value = document.createElement('span');
    value.className = 'quick__eq-value num';
    value.textContent = rates ? `${formatAmount(convert(amount, currency, cur, rates))} ${code(cur)}` : '–';
    item.append(label, value);
    return item;
  }));
}

/** Amount box on the rates screen: type, hit "go", land in the calculator with it loaded. */
export function initQuickCalc(goToCalculator) {
  buildSegment(currencySeg, pick);
  markSegment(currencySeg, currency);
  input.dataset.cur = currency;
  renderChips();
  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.quick__chip');
    if (!chip) return;
    if (chip.dataset.action === 'clear') clearAmount();
    else addAmount(Number(chip.dataset.amount));
  });
  input.addEventListener('input', renderPreview);
  onRatesChange(renderPreview);
  renderPreview();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = normalizeTypedAmount(input.value);
    if (!amount) {
      toast('Ingrese un monto para calcular.', { tone: 'error' });
      return;
    }
    startCalculation(currency, amount);
    input.value = '';
    renderPreview();
    input.blur();
    goToCalculator();
  });
}
