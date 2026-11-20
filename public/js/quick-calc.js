import { CURRENCIES, CURRENCY_META, convert, normalizeTypedAmount, parseInput, toKeypadInput } from './convert.js';
import { formatAmount, formatInput, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { load, save } from './storage.js';
import { buildSegment, markSegment, startCalculation } from './calculator-view.js';
import { copyText, formatBankCopy } from './clipboard.js';
import { toast } from './toast.js';

const form = document.querySelector('#quick-form');
const input = document.querySelector('#quick-amount');
const currencySeg = document.querySelector('#quick-currency');
const preview = document.querySelector('#quick-preview');

let currency = ['USD', 'EUR', 'VES'].includes(load('quickCurrency')) ? load('quickCurrency') : 'USD';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function pick(cur, { fromSwipe = false } = {}) {
  currency = cur;
  if (cur !== 'VES') lastForeign = cur;
  save('quickCurrency', cur);
  markSegment(currencySeg, cur);
  input.dataset.cur = cur;
  renderPreview();
  updateHint();
  if (!fromSwipe) goToPage(pageFor(cur));
}

/* ---------- Quick amount chips: two swipeable pages, each tap adds to the amount ---------- */

// Page 0 adds in the foreign currency ($ or €), page 1 in bolivars. Swiping switches the currency.
const PAGES = [
  [1, 5, 10, 15, 20, 25, 30],
  [500, 1000, 1500, 5000, 10000, 20000],
];
const SYMBOLS = { USD: '$', EUR: '€', VES: 'Bs' };

const track = document.querySelector('#quick-chips');
const pageEls = [...track.querySelectorAll('.chips__page')];
const hint = document.querySelector('#chips-hint');
const clearBtn = document.querySelector('#quick-clear');

const pageFor = (cur) => (cur === 'VES' ? 1 : 0);
const currentPage = () => (track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : pageFor(currency));

let lastForeign = currency === 'VES' ? 'USD' : currency;
// Page the track shows, and the page a programmatic scroll is heading to (null while the user swipes).
let visualPage = pageFor(currency);
let targetPage = null;

function goToPage(page, smooth = true) {
  // Already there: no scroll event will fire, so don't wait for one.
  if (Math.abs(track.scrollLeft - page * track.clientWidth) < 1) {
    targetPage = null;
    visualPage = page;
    return;
  }
  targetPage = page;
  track.scrollTo({ left: page * track.clientWidth, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto' });
}

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

function buildChips() {
  PAGES.forEach((amounts, page) => {
    pageEls[page].replaceChildren(...amounts.map((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick__chip num';
      btn.textContent = `+${formatInput(String(value))}`;
      btn.dataset.amount = String(value);
      return btn;
    }));
  });
}

function updateHint() {
  const page = pageFor(currency);
  const foreign = SYMBOLS[lastForeign];
  pageEls[0].dataset.cur = lastForeign;
  hint.dataset.page = String(page);
  document.querySelector('#chips-title').textContent = `Montos en ${page ? 'Bs' : foreign}`;
  document.querySelector('#chips-swipe').textContent = page ? `← ${foreign}` : 'Desliza → Bs';
  hint.setAttribute('aria-label', page ? `Cambiar a montos en ${CURRENCY_META[lastForeign].name.toLowerCase()}` : 'Cambiar a montos en bolívares');
  pageEls.forEach((el, i) => {
    el.inert = i !== page;
    el.querySelectorAll('.quick__chip').forEach((chip) => {
      chip.setAttribute('aria-label', `Sumar ${chip.textContent.slice(1)} ${CURRENCY_META[i ? 'VES' : lastForeign].name.toLowerCase()}`);
    });
  });
}

function setupChips() {
  buildChips();
  updateHint();

  track.addEventListener('click', (e) => {
    const chip = e.target.closest('.quick__chip');
    if (chip) addAmount(Number(chip.dataset.amount));
  });
  hint.addEventListener('click', () => goToPage(1 - pageFor(currency)));
  clearBtn.addEventListener('click', clearAmount);

  // A finished swipe picks the currency of the page it lands on.
  let frame = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!track.clientWidth) return;
      const page = currentPage();
      visualPage = page;
      // Ignore our own scrolling until it lands; only user swipes change the currency.
      if (targetPage !== null) {
        if (page === targetPage) targetPage = null;
        return;
      }
      if (page !== pageFor(currency)) pick(page ? 'VES' : lastForeign, { fromSwipe: true });
    });
  }, { passive: true });

  // The rates view can start hidden (zero width): re-align once it has a size.
  // Keep the visible page aligned when the width changes (rotation, scrollbars, view shown).
  new ResizeObserver(() => {
    if (track.clientWidth) goToPage(targetPage ?? visualPage, false);
  }).observe(track);
}

/** Live equivalents in the other two currencies while typing. Tapping copies for Pago Móvil. */
function renderPreview() {
  clearBtn.hidden = !input.value;
  const rates = getRates();
  const amount = parseInput(normalizeTypedAmount(input.value));
  const others = CURRENCIES.filter((c) => c !== currency);
  preview.replaceChildren(...others.map((cur) => {
    const converted = rates ? convert(amount, currency, cur, rates) : null;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'quick__eq copyable';
    item.dataset.cur = cur;
    item.setAttribute('aria-label', converted != null
      ? `Copiar ${formatAmount(converted)} ${CURRENCY_META[cur].name}`
      : CURRENCY_META[cur].name);

    const head = document.createElement('span');
    head.className = 'quick__eq-head';
    const label = document.createElement('span');
    label.className = 'quick__eq-label';
    label.textContent = CURRENCY_META[cur].name;
    const copyHint = document.createElement('span');
    copyHint.className = 'copy-tag';
    copyHint.textContent = 'Copiar';
    head.append(label, copyHint);

    const value = document.createElement('span');
    value.className = 'quick__eq-value num';
    value.textContent = converted != null ? `${formatAmount(converted)} ${code(cur)}` : '–';
    item.append(head, value);

    item.addEventListener('click', () => {
      if (converted == null || amount <= 0) return;
      const plain = formatBankCopy(converted);
      copyText(plain, `Copiado: ${plain} ${code(cur)}`);
    });
    return item;
  }));
}

/** Amount box on the rates screen: type, hit "go", land in the calculator with it loaded. */
export function initQuickCalc(goToCalculator) {
  buildSegment(currencySeg, pick);
  markSegment(currencySeg, currency);
  input.dataset.cur = currency;
  setupChips();
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
