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
 * Each window: { id, name, from, amount, included }.
 */
export function aggregate(windows, outCurrency, rates) {
  const lines = windows
    .filter((w) => w.included !== false)
    .map((w) => ({
      id: w.id,
      name: w.name,
      from: w.from,
      amount: w.amount,
      converted: convert(w.amount, w.from, outCurrency, rates),
    }));
  const total = lines.reduce((sum, line) => sum + line.converted, 0);
  return { lines, total, currency: outCurrency };
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

/** Parses keypad input like "1234,5" into a number (0 when empty). */
export function parseInput(text) {
  if (!text) return 0;
  const n = Number(String(text).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
