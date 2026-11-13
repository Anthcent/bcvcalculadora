import { CURRENCIES, CURRENCY_META, convert, normalizeTypedAmount, parseInput } from './convert.js';
import { formatAmount, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { load, save } from './storage.js';
import { buildSegment, markSegment, startCalculation } from './calculator-view.js';
import { toast } from './toast.js';

const form = document.querySelector('#quick-form');
const input = document.querySelector('#quick-amount');
const currencySeg = document.querySelector('#quick-currency');
const preview = document.querySelector('#quick-preview');

let currency = ['USD', 'EUR', 'VES'].includes(load('quickCurrency')) ? load('quickCurrency') : 'USD';

function pick(cur) {
  currency = cur;
  save('quickCurrency', cur);
  markSegment(currencySeg, cur);
  input.dataset.cur = cur;
  renderPreview();
  input.focus();
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
  input.addEventListener('input', renderPreview);
  onRatesChange(renderPreview);
  renderPreview();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = normalizeTypedAmount(input.value);
    if (!amount) {
      toast('Ingrese un monto para calcular.', { tone: 'error' });
      input.focus();
      return;
    }
    startCalculation(currency, amount);
    input.value = '';
    renderPreview();
    input.blur();
    goToCalculator();
  });
}
