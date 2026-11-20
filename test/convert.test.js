import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convert,
  aggregate,
  resolveEffectiveRates,
  toKeypadInput,
  normalizeTypedAmount,
  parseInput,
} from '../public/js/convert.js';

const rates = { usd: 911.6243, eur: 1009.34130871, valueDate: '2026-11-13' };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('converts Bs to USD and back', () => {
  close(convert(911.6243, 'VES', 'USD', rates), 1);
  close(convert(10, 'USD', 'VES', rates), 9116.243);
});

test('converts USD to EUR through the cross rate', () => {
  close(convert(100, 'USD', 'EUR', rates), (100 * 911.6243) / 1009.34130871);
  close(convert(convert(100, 'USD', 'EUR', rates), 'EUR', 'USD', rates), 100);
});

test('aggregates included windows in the chosen currency', () => {
  const windows = [
    { id: 'a', name: 'Rent', from: 'USD', amount: 10, included: true },
    { id: 'b', name: 'Food', from: 'VES', amount: 911.6243, included: true },
    { id: 'c', name: 'Skip', from: 'EUR', amount: 999, included: false },
  ];
  const result = aggregate(windows, 'USD', rates);
  assert.equal(result.lines.length, 2);
  close(result.total, 11);
});

test('aggregates windows honoring quantity multiplier (qty)', () => {
  const windows = [
    { id: 'a', name: 'Café', from: 'USD', to: 'VES', amount: 3, qty: 4, included: true },
    { id: 'b', name: 'Pan', from: 'USD', to: 'VES', amount: 2, qty: 1, included: true },
  ];
  const result = aggregate(windows, 'USD', rates);
  assert.equal(result.lines[0].qty, 4);
  close(result.lines[0].subtotal, 12);
  close(result.lines[0].result, 12 * rates.usd);
  close(result.total, 14);
});

test('swap carries the rounded result as the new amount', () => {
  const result = toKeypadInput(convert(5, 'USD', 'VES', rates));
  assert.equal(result, '4558,12');
  assert.equal(toKeypadInput(convert(4558.12, 'VES', 'USD', rates)), '5');
  assert.equal(toKeypadInput(0), '');
});

test('normalizes typed amounts in Venezuelan and plain formats', () => {
  assert.equal(normalizeTypedAmount('1.234,56'), '1234,56');
  assert.equal(normalizeTypedAmount('1234.5'), '1234,5');
  assert.equal(normalizeTypedAmount('1.500'), '1500');
  assert.equal(normalizeTypedAmount('25'), '25');
  assert.equal(normalizeTypedAmount('abc'), '');
});

test('each aggregated line keeps its own conversion, apart from the total currency', () => {
  const [line] = aggregate([{ id: 'a', name: 'Pago', from: 'VES', to: 'USD', amount: 2000 }], 'VES', rates).lines;
  close(line.result, 2000 / 911.6243); // 2,19 USD
  assert.equal(line.to, 'USD');
  close(line.converted, 2000);
});

test('parseInput evaluates arithmetic expressions too', () => {
  close(parseInput('100+16%'), 116);
  close(parseInput('25×4'), 100);
  close(parseInput('12,5'), 12.5);
});

test('resolveEffectiveRates applies manual rate and percentage margin', () => {
  assert.equal(resolveEffectiveRates(rates, { enabled: false }), rates);

  const margin = resolveEffectiveRates(rates, { enabled: true, mode: 'margin', marginPct: 10 });
  assert.equal(margin.isCustom, true);
  close(margin.usd, rates.usd * 1.1);
  close(margin.eur, rates.eur * 1.1);

  const manual = resolveEffectiveRates(rates, { enabled: true, mode: 'manual', usd: 1000, eur: null, label: 'Tienda' });
  assert.equal(manual.isCustom, true);
  assert.equal(manual.usd, 1000);
  close(manual.eur, 1000 * (rates.eur / rates.usd));
  assert.equal(manual.customLabel, 'Tienda');
});
