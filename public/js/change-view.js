import { CURRENCIES, CURRENCY_META, computeChange, convert, normalizeTypedAmount, parseInput, toKeypadInput } from './convert.js';
import { formatAmount, formatInput, code } from './format.js';
import { getRates, onRatesChange } from './rates-api.js';
import { getSummary } from './panel-view.js';
import { buildSegment, markSegment } from './calculator-view.js';
import { copyText, formatBankCopy } from './clipboard.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);

let due = { input: '', currency: 'USD' };
let nextPayId = 1;
let payments = [
  { id: nextPayId++, input: '', currency: 'USD' },
  { id: nextPayId++, input: '', currency: 'VES' },
];

const dueInput = $('#change-due');
const dueCurSeg = $('#change-due-cur');
const payList = $('#change-payments');
const resultBox = $('#change-result');

function parsedDue() {
  return {
    amount: parseInput(normalizeTypedAmount(due.input)),
    currency: due.currency,
  };
}

function parsedPayments() {
  return payments.map((p) => ({
    id: p.id,
    amount: parseInput(normalizeTypedAmount(p.input)),
    currency: p.currency,
  }));
}

function renderResult() {
  const rates = getRates();
  if (!rates) {
    resultBox.dataset.status = 'empty';
    resultBox.innerHTML = '<p class="change-res__empty">Sin tasas disponibles. Actualiza en la pestaña Tasas.</p>';
    return;
  }

  const calc = computeChange(parsedDue(), parsedPayments(), rates);
  resultBox.dataset.status = calc.status;

  if (calc.status === 'empty') {
    resultBox.innerHTML = '<p class="change-res__empty">Ingresa el monto a cobrar y los pagos recibidos en cualquier moneda.</p>';
    return;
  }

  const titles = {
    remaining: 'Falta por pagar',
    exact: 'Pago exacto ✓',
    change: 'Vuelto a entregar',
  };

  const head = document.createElement('div');
  head.className = 'change-res__head';
  const title = document.createElement('strong');
  title.className = 'change-res__title';
  title.textContent = titles[calc.status];

  const paidSummary = document.createElement('span');
  paidSummary.className = 'change-res__sub num';
  paidSummary.textContent = `Recibido: ${formatAmount(calc.paid[due.currency])} / ${formatAmount(calc.due[due.currency])} ${code(due.currency)}`;
  head.append(title, paidSummary);

  resultBox.replaceChildren(head);

  if (calc.status === 'exact') {
    const exactMsg = document.createElement('p');
    exactMsg.className = 'change-res__exact';
    exactMsg.textContent = 'El monto cubierto coincide con el total a cobrar.';
    resultBox.append(exactMsg);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'change-res__grid';

  for (const cur of ['VES', 'USD', 'EUR']) {
    const val = calc.diff[cur];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'change-res__cell copyable';
    btn.dataset.cur = cur;
    btn.setAttribute('aria-label', `Copiar ${formatAmount(val)} ${CURRENCY_META[cur].name}`);

    const lbl = document.createElement('span');
    lbl.className = 'change-res__cur';
    lbl.textContent = CURRENCY_META[cur].name;

    const num = document.createElement('span');
    num.className = 'change-res__val num';
    num.textContent = `${formatAmount(val)} ${code(cur)}`;

    btn.append(lbl, num);
    btn.addEventListener('click', () => {
      copyText(formatBankCopy(val), `Copiado: ${formatBankCopy(val)} ${code(cur)}`);
    });
    grid.append(btn);
  }

  resultBox.append(grid);
}

function renderPayments() {
  payList.replaceChildren(...payments.map((p, idx) => {
    const row = document.createElement('div');
    row.className = 'pay-row';

    const curSelect = document.createElement('select');
    curSelect.className = 'pay-row__cur';
    curSelect.dataset.cur = p.currency;
    curSelect.setAttribute('aria-label', `Moneda del pago ${idx + 1}`);
    for (const c of CURRENCIES) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = code(c);
      opt.selected = c === p.currency;
      curSelect.append(opt);
    }
    curSelect.addEventListener('change', () => {
      p.currency = curSelect.value;
      curSelect.dataset.cur = p.currency;
      inp.dataset.cur = p.currency;
      renderResult();
    });

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.className = 'pay-row__input num';
    inp.placeholder = '0,00';
    inp.value = p.input;
    inp.dataset.cur = p.currency;
    inp.setAttribute('aria-label', `Monto del pago ${idx + 1}`);
    inp.addEventListener('input', () => {
      p.input = inp.value;
      renderResult();
    });

    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'pay-row__fill';
    fillBtn.textContent = 'Resto';
    fillBtn.title = 'Completar con lo que falta en esta moneda';
    fillBtn.addEventListener('click', () => {
      const rates = getRates();
      if (!rates) return;
      const others = payments.filter((x) => x.id !== p.id).map((x) => ({
        amount: parseInput(normalizeTypedAmount(x.input)),
        currency: x.currency,
      }));
      const calc = computeChange(parsedDue(), others, rates);
      if (calc.status !== 'remaining') {
        toast('El monto ya está cubierto.');
        return;
      }
      const needed = calc.diff[p.currency];
      p.input = formatInput(toKeypadInput(needed));
      inp.value = p.input;
      renderResult();
    });

    row.append(curSelect, inp, fillBtn);

    if (payments.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'icon-btn pay-row__del';
      delBtn.setAttribute('aria-label', `Quitar pago ${idx + 1}`);
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
      delBtn.addEventListener('click', () => {
        payments = payments.filter((x) => x.id !== p.id);
        renderPayments();
        renderResult();
      });
      row.append(delBtn);
    }

    return row;
  }));
}

function useGrandTotal() {
  const summary = getSummary();
  if (!summary || summary.total <= 0) {
    toast('El total de tus cálculos es cero.', { tone: 'error' });
    return;
  }
  due.currency = summary.currency;
  due.input = formatInput(toKeypadInput(summary.total));
  dueInput.value = due.input;
  dueInput.dataset.cur = due.currency;
  markSegment(dueCurSeg, due.currency);
  renderResult();
  toast(`Total cargado: ${formatAmount(summary.total)} ${code(summary.currency)}`);
}

function addPaymentRow() {
  const used = payments.map((p) => p.currency);
  const nextCur = CURRENCIES.find((c) => !used.includes(c)) ?? 'VES';
  payments.push({ id: nextPayId++, input: '', currency: nextCur });
  renderPayments();
  renderResult();
}

function resetChange() {
  due.input = '';
  dueInput.value = '';
  payments = [
    { id: nextPayId++, input: '', currency: 'USD' },
    { id: nextPayId++, input: '', currency: 'VES' },
  ];
  renderPayments();
  renderResult();
}

export function initChangeView() {
  buildSegment(dueCurSeg, (cur) => {
    due.currency = cur;
    dueInput.dataset.cur = cur;
    markSegment(dueCurSeg, cur);
    renderResult();
  });
  markSegment(dueCurSeg, due.currency);
  dueInput.dataset.cur = due.currency;

  dueInput.addEventListener('input', () => {
    due.input = dueInput.value;
    renderResult();
  });

  $('#change-use-total')?.addEventListener('click', useGrandTotal);
  $('#change-add-pay')?.addEventListener('click', addPaymentRow);
  $('#change-clear')?.addEventListener('click', resetChange);

  onRatesChange(renderResult);
  renderPayments();
  renderResult();
}
