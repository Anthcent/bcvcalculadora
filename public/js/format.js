const LOCALE = 'es-VE';
const cache = new Map();

function formatter(min, max) {
  const key = `${min}-${max}`;
  if (!cache.has(key)) {
    cache.set(key, new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max }));
  }
  return cache.get(key);
}

/** Money amount: 2 decimals, more precision for small non-zero values. */
export function formatAmount(value) {
  if (!Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return formatter(2, 6).format(value);
  if (abs > 0 && abs < 1) return formatter(2, 4).format(value);
  return formatter(2, 2).format(value);
}

export function formatNumber(value, decimals) {
  return Number.isFinite(value) ? formatter(decimals, decimals).format(value) : '–';
}

/** Formats keypad text ("12345,5") with grouping while keeping a trailing comma. */
export function formatInput(text) {
  if (!text) return '0';
  const [intPart, decPart] = text.split(',');
  const grouped = formatter(0, 0).format(Number(intPart || '0'));
  return decPart === undefined ? grouped : `${grouped},${decPart}`;
}

/** Display code: bolivars are shown as "Bs". */
export function code(currency) {
  return currency === 'VES' ? 'Bs' : currency;
}

/** "2026-11-13" -> "vie, 13 nov 2026" (built locally to avoid a timezone shift). */
export function formatValueDate(isoDate) {
  if (!isoDate) return '–';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** "Hoy, 10:42 a. m." or "12 nov, 10:42 a. m." */
export function formatFetchedAt(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  const time = date.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
  const isToday = date.toDateString() === new Date().toDateString();
  if (isToday) return `Hoy, ${time}`;
  return `${date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })}, ${time}`;
}
