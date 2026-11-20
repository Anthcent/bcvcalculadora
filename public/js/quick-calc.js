import { CURRENCIES, CURRENCY_META, convert, normalizeTypedAmount, parseInput, toKeypadInput } from './convert.js';
import { formatAmount, formatInput, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { load, save } from './storage.js';
import { buildSegment, markSegment, startCalculation } from './calculator-view.js';
import { copyText, formatBankCopy } from './clipboard.js';
import { syncQuickChips } from './db-sync.js';
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

/* ---------- Editable quick amount chips: two swipeable pages, each tap adds to the amount ---------- */

const CHIPS_KEY = 'quickChips';
const MAX_CHIPS = 10;
const DEFAULT_PAGES = [
  [1, 5, 10, 15, 20, 25, 30],
  [500, 1000, 1500, 5000, 10000, 20000],
];
const SYMBOLS = { USD: '$', EUR: '€', VES: 'Bs' };

function sanitizeChipList(arr, fallback) {
  if (!Array.isArray(arr)) return [...fallback];
  const valid = arr
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 1_000_000_000)
    .slice(0, MAX_CHIPS);
  return valid.length ? valid : [...fallback];
}

function loadChipPages() {
  const saved = load(CHIPS_KEY);
  return [
    sanitizeChipList(saved?.foreign, DEFAULT_PAGES[0]),
    sanitizeChipList(saved?.ves, DEFAULT_PAGES[1]),
  ];
}

let pages = loadChipPages();

const track = document.querySelector('#quick-chips');
const pageEls = [...track.querySelectorAll('.chips__page')];
const hint = document.querySelector('#chips-hint');
const clearBtn = document.querySelector('#quick-clear');

const pageFor = (cur) => (cur === 'VES' ? 1 : 0);
const currentPage = () => (track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : pageFor(currency));

let lastForeign = currency === 'VES' ? 'USD' : currency;
let visualPage = pageFor(currency);
let targetPage = null;

function goToPage(page, smooth = true) {
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

function formatChipLabel(value) {
  return `+${formatInput(toKeypadInput(value))}`;
}

function buildChips() {
  pages.forEach((amounts, page) => {
    pageEls[page].replaceChildren(...amounts.map((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick__chip num';
      btn.textContent = formatChipLabel(value);
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

/* ---------- Chips editor modal ---------- */

function setupChipsEditor() {
  const dialog = document.querySelector('#chips-editor-dialog');
  const openBtn = document.querySelector('#edit-chips-btn');
  const closeBtn = document.querySelector('#chips-editor-close');
  const gridEl = document.querySelector('#chips-editor-grid');
  const addBtn = document.querySelector('#chips-editor-add');
  const resetBtn = document.querySelector('#chips-editor-reset');
  const formEl = document.querySelector('#chips-editor-form');
  const tabBtns = [...dialog.querySelectorAll('[data-editor-page]')];

  let editorPage = 0;
  let draft = [pages[0].map((v) => toKeypadInput(v)), pages[1].map((v) => toKeypadInput(v))];

  function renderEditor() {
    tabBtns.forEach((btn) => {
      btn.setAttribute('aria-checked', String(Number(btn.dataset.editorPage) === editorPage));
    });
    const list = draft[editorPage];
    const unit = editorPage === 0 ? SYMBOLS[lastForeign] : 'Bs';
    const curCode = editorPage === 0 ? lastForeign : 'VES';
    gridEl.dataset.cur = curCode;

    gridEl.replaceChildren(...list.map((val, idx) => {
      const cell = document.createElement('div');
      cell.className = 'chip-edit-item';

      const prefix = document.createElement('span');
      prefix.className = 'chip-edit-item__prefix';
      prefix.textContent = `+${unit}`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'decimal';
      inp.className = 'chip-edit-item__input num';
      inp.value = val;
      inp.placeholder = editorPage === 0 ? '10' : '1000';
      inp.setAttribute('aria-label', `Botón ${idx + 1} en ${unit}`);
      inp.addEventListener('input', () => {
        draft[editorPage][idx] = inp.value;
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chip-edit-item__del';
      del.disabled = list.length <= 1;
      del.setAttribute('aria-label', `Eliminar botón ${idx + 1}`);
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
      del.addEventListener('click', () => {
        if (draft[editorPage].length <= 1) return;
        draft[editorPage].splice(idx, 1);
        renderEditor();
      });

      cell.append(prefix, inp, del);
      return cell;
    }));

    addBtn.disabled = list.length >= MAX_CHIPS;
  }

  openBtn?.addEventListener('click', () => {
    editorPage = pageFor(currency);
    draft = [pages[0].map((v) => toKeypadInput(v)), pages[1].map((v) => toKeypadInput(v))];
    renderEditor();
    dialog.showModal();
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      editorPage = Number(btn.dataset.editorPage);
      renderEditor();
    });
  });

  addBtn?.addEventListener('click', () => {
    if (draft[editorPage].length >= MAX_CHIPS) return;
    draft[editorPage].push('');
    renderEditor();
    const inputs = gridEl.querySelectorAll('.chip-edit-item__input');
    inputs[inputs.length - 1]?.focus();
  });

  resetBtn?.addEventListener('click', () => {
    draft[editorPage] = DEFAULT_PAGES[editorPage].map((v) => toKeypadInput(v));
    renderEditor();
    toast('Montos predeterminados cargados');
  });

  formEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    const parsedForeign = draft[0]
      .map((s) => parseInput(normalizeTypedAmount(s)))
      .filter((n) => n > 0);
    const parsedVes = draft[1]
      .map((s) => parseInput(normalizeTypedAmount(s)))
      .filter((n) => n > 0);

    if (parsedForeign.length === 0 || parsedVes.length === 0) {
      toast('Deja al menos un monto válido en cada moneda.', { tone: 'error' });
      return;
    }

    pages = [parsedForeign.slice(0, MAX_CHIPS), parsedVes.slice(0, MAX_CHIPS)];
    save(CHIPS_KEY, { foreign: pages[0], ves: pages[1] });
    syncQuickChips({ foreign: pages[0], ves: pages[1] });
    buildChips();
    updateHint();
    dialog.close();
    toast('Botones rápidos guardados');
  });

  closeBtn?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function setupChips() {
  buildChips();
  updateHint();
  setupChipsEditor();

  track.addEventListener('click', (e) => {
    const chip = e.target.closest('.quick__chip');
    if (chip) addAmount(Number(chip.dataset.amount));
  });
  hint.addEventListener('click', () => goToPage(1 - pageFor(currency)));
  clearBtn.addEventListener('click', clearAmount);

  let frame = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!track.clientWidth) return;
      const page = currentPage();
      visualPage = page;
      if (targetPage !== null) {
        if (page === targetPage) targetPage = null;
        return;
      }
      if (page !== pageFor(currency)) pick(page ? 'VES' : lastForeign, { fromSwipe: true });
    });
  }, { passive: true });

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

export function getChipPages() {
  return { foreign: [...pages[0]], ves: [...pages[1]] };
}

export function hydrateChipsFromDb(remote) {
  if (!remote) return;
  pages = [
    sanitizeChipList(remote.foreign, DEFAULT_PAGES[0]),
    sanitizeChipList(remote.ves, DEFAULT_PAGES[1]),
  ];
  save(CHIPS_KEY, { foreign: pages[0], ves: pages[1] });
  buildChips();
  updateHint();
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
