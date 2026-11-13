import { normalizeTypedAmount } from './convert.js';
import { load, save } from './storage.js';
import { buildSegment, markSegment, startCalculation } from './calculator-view.js';
import { toast } from './toast.js';

const form = document.querySelector('#quick-form');
const input = document.querySelector('#quick-amount');
const currencySeg = document.querySelector('#quick-currency');

let currency = ['USD', 'EUR', 'VES'].includes(load('quickCurrency')) ? load('quickCurrency') : 'USD';

function pick(cur) {
  currency = cur;
  save('quickCurrency', cur);
  markSegment(currencySeg, cur);
  input.dataset.cur = cur;
  input.focus();
}

/** Amount box on the rates screen: type, hit "go", land in the calculator with it loaded. */
export function initQuickCalc(goToCalculator) {
  buildSegment(currencySeg, pick);
  markSegment(currencySeg, currency);
  input.dataset.cur = currency;

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
    input.blur();
    goToCalculator();
  });
}
