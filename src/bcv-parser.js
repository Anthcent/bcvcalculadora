/**
 * Parses a number written in Venezuelan format ("1.009,34130871").
 * Dots are thousands separators, the comma is the decimal separator.
 */
export function parseVesNumber(raw) {
  const cleaned = String(raw).replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid number format: "${raw}"`);
  }
  return Number(cleaned);
}

function extractRate(html, id) {
  // Find the container div for the currency, then the first strong value after it.
  const pattern = new RegExp(
    `<div[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<strong[^>]*>([^<]+)</strong>`,
    'i'
  );
  const match = html.match(pattern);
  if (!match) throw new Error(`Rate for "${id}" not found in BCV markup`);
  const value = parseVesNumber(match[1]);
  if (!(value > 0)) throw new Error(`Rate for "${id}" is not a positive number`);
  return value;
}

function extractValueDate(html) {
  const match = html.match(/<span[^>]*property=["']dc:date["'][^>]*content=["'](\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : null;
}

/**
 * Extracts USD and EUR rates (Bs per unit) and the value date from the BCV home page.
 * Throws if either rate is missing.
 */
export function parseBcvHtml(html) {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('Empty BCV response');
  }
  return {
    usd: extractRate(html, 'dolar'),
    eur: extractRate(html, 'euro'),
    valueDate: extractValueDate(html),
  };
}
