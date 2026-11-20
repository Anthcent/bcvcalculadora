import { evaluateExpression, isExpression } from './expr.js';

/**
 * Pure conversion math. Rates are expressed as bolivars (Bs) per unit:
 * { usd: 911.62, eur: 1009.34 }. VES is the base currency (1 Bs = 1 Bs).
 * Values are never rounded here; rounding is a display concern.
 */

export const CURRENCIES = ['VES', 'USD', 'EUR'];

export const CURRENCY_META = {
  VES: { symbol: 'Bs', name: 'Bolívares' },
  USD: { symbol: '$', name: 'Dólares' },
  EUR: { symbol: '€', name: 'Euros' },
};

/** Bs value of one unit of the given currency. */
export function bsPerUnit(currency, rates) {
  switch (currency) {
    case 'VES': return 1;
    case 'USD': return rates.usd;
    case 'EUR': return rates.eur;
    default: throw new Error(`Unsupported currency: ${currency}`);
  }
}

export function convert(amount, from, to, rates) {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;
  return (amount * bsPerUnit(from, rates)) / bsPerUnit(to, rates);
}

/** Rate of 1 unit of `from` expressed in `to`. */
export function rateBetween(from, to, rates) {
  return convert(1, from, to, rates);
}

/** Currency that is neither `from` nor `to` (used for the secondary equivalent). */
export function thirdCurrency(from, to) {
  return CURRENCIES.find((c) => c !== from && c !== to) ?? null;
}

/**
 * Aggregates calculation windows into a single output currency.
 * Each window: { id, name, from, to, amount, qty?, included }.
 * Every line keeps its own conversion (`result` in `to`) plus its value in the total currency.
 */
export function aggregate(windows, outCurrency, rates) {
  const lines = windows
    .filter((w) => w.included !== false)
    .map((w) => {
      const qty = Number.isInteger(w.qty) && w.qty > 0 ? w.qty : 1;
      const subtotal = w.amount * qty;
      return {
        id: w.id,
        name: w.name,
        from: w.from,
        to: w.to ?? outCurrency,
        amount: w.amount,
        qty,
        subtotal,
        result: convert(subtotal, w.from, w.to ?? outCurrency, rates),
        converted: convert(subtotal, w.from, outCurrency, rates),
      };
    });
  const total = lines.reduce((sum, line) => sum + line.converted, 0);
  return { lines, total, currency: outCurrency };
}

/**
 * Computes remaining balance or change due across mixed-currency payments.
 * due: { amount, currency }
 * payments: Array<{ amount, currency }>
 * Returns values expressed in Bs, USD, and EUR plus status: 'empty' | 'remaining' | 'exact' | 'change'.
 */
export function computeChange(due, payments, rates) {
  const dueAmount = Number.isFinite(due?.amount) && due.amount > 0 ? due.amount : 0;
  const dueBs = dueAmount > 0 ? convert(dueAmount, due.currency, 'VES', rates) : 0;
  const paidBs = (payments ?? []).reduce((sum, p) => {
    const amt = Number.isFinite(p?.amount) && p.amount > 0 ? p.amount : 0;
    return sum + (amt > 0 ? convert(amt, p.currency, 'VES', rates) : 0);
  }, 0);

  // Treat differences under half a cent in Bs (or 0.005 Bs) as exact to avoid floating-point noise.
  const EPS = 0.005;
  const diffBs = paidBs - dueBs;
  let status = 'empty';
  if (dueBs > 0) {
    if (Math.abs(diffBs) <= EPS) status = 'exact';
    else status = diffBs > 0 ? 'change' : 'remaining';
  }

  const absDiffBs = Math.abs(diffBs) <= EPS ? 0 : Math.abs(diffBs);
  const toAll = (bsVal) => ({
    VES: bsVal,
    USD: convert(bsVal, 'VES', 'USD', rates),
    EUR: convert(bsVal, 'VES', 'EUR', rates),
  });

  return {
    status,
    due: toAll(dueBs),
    paid: toAll(paidBs),
    diff: toAll(absDiffBs),
  };
}

/**
 * Computes effective rates when a custom rate or percentage margin is enabled.
 * custom: { enabled, mode: 'manual' | 'margin', usd, eur, marginPct, label }
 */
export function resolveEffectiveRates(official, custom) {
  if (!custom?.enabled) return official;
  const mode = custom.mode === 'margin' ? 'margin' : 'manual';

  if (mode === 'margin') {
    if (!official) return null;
    const pct = Number.isFinite(custom.marginPct) ? custom.marginPct : 0;
    const factor = 1 + pct / 100;
    if (factor <= 0) return official;
    return {
      ...official,
      usd: official.usd * factor,
      eur: official.eur * factor,
      isCustom: true,
      customMode: 'margin',
      marginPct: pct,
      customLabel: custom.label?.trim() || `BCV ${pct >= 0 ? '+' : ''}${pct}%`,
      official: { usd: official.usd, eur: official.eur, valueDate: official.valueDate },
    };
  }

  const usd = Number.isFinite(custom.usd) && custom.usd > 0 ? custom.usd : null;
  if (!usd) return official;
  const ratio = official && official.usd > 0 ? official.eur / official.usd : 1.1;
  const eur = Number.isFinite(custom.eur) && custom.eur > 0 ? custom.eur : usd * ratio;

  return {
    ...(official ?? { valueDate: null, fetchedAt: new Date().toISOString(), source: 'manual', stale: false }),
    usd,
    eur,
    isCustom: true,
    customMode: 'manual',
    marginPct: official && official.usd > 0 ? ((usd - official.usd) / official.usd) * 100 : null,
    customLabel: custom.label?.trim() || 'Tasa personalizada',
    official: official ? { usd: official.usd, eur: official.eur, valueDate: official.valueDate } : null,
  };
}

/** Turns a number into keypad text with at most 2 decimals: 4558.1215 -> "4558,12". */
export function toKeypadInput(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const fixed = (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return fixed === '0' ? '' : fixed.replace('.', ',');
}

/**
 * Normalizes a typed amount ("1.234,56", "1234.56", "1.500", "25") into keypad text.
 * The last of "," or "." is the decimal mark when both appear; a lone "." followed by
 * exactly three digits (or repeated dots) is a thousands separator, as written in Venezuela.
 */
export function normalizeTypedAmount(text) {
  const clean = String(text ?? '').replace(/[^\d.,]/g, '');
  if (!/\d/.test(clean)) return '';
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  let decimalAt = Math.max(lastComma, lastDot);
  if (lastComma === -1 && lastDot !== -1) {
    const dots = clean.split('.').length - 1;
    if (dots > 1 || clean.length - lastDot - 1 === 3) decimalAt = -1;
  }
  const intPart = (decimalAt === -1 ? clean : clean.slice(0, decimalAt)).replace(/\D/g, '');
  const decPart = decimalAt === -1 ? '' : clean.slice(decimalAt + 1).replace(/\D/g, '').slice(0, 2);
  const int = intPart.replace(/^0+(?=\d)/, '').slice(0, 12) || '0';
  const result = decPart ? `${int},${decPart}` : int;
  return result === '0' || /^0,0*$/.test(result) ? '' : result;
}

/** Parses keypad input or arithmetic expression like "1234,5" or "100+16%" into a number (0 when empty). */
export function parseInput(text) {
  if (!text) return 0;
  const s = String(text);
  if (isExpression(s)) return evaluateExpression(s).value;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
