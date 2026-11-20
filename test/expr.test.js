import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, applyExprKey, formatExpression, isExpression, isValidExprString } from '../public/js/expr.js';
import { toKeypadInput } from '../public/js/convert.js';
import { formatInput } from '../public/js/format.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('evaluates basic arithmetic with operator precedence', () => {
  close(evaluateExpression('10+5×2').value, 20);
  close(evaluateExpression('100-25÷5').value, 95);
  close(evaluateExpression('12,5+7,5').value, 20);
  close(evaluateExpression('50÷4').value, 12.5);
});

test('evaluates Venezuelan-style percentages (IVA, IGTF, discounts)', () => {
  close(evaluateExpression('100+16%').value, 116);
  close(evaluateExpression('100+3%').value, 103);
  close(evaluateExpression('200-10%').value, 180);
  close(evaluateExpression('200×10%').value, 20);
  close(evaluateExpression('50%').value, 0.5);
});

test('handles trailing operators gracefully while typing', () => {
  close(evaluateExpression('45+').value, 45);
  close(evaluateExpression('45+5×').value, 50);
  assert.equal(evaluateExpression('').value, 0);
});

test('reports division by zero error cleanly', () => {
  assert.equal(evaluateExpression('10÷0').error, 'DIV_ZERO');
});

test('applyExprKey builds and resolves expressions safely', () => {
  let s = '';
  for (const k of ['1', '0', '0', '+', '1', '6', '%']) {
    s = applyExprKey(s, k, { formatResult: toKeypadInput });
  }
  assert.equal(s, '100+16%');
  assert.equal(isExpression(s), true);
  assert.equal(isValidExprString(s), true);

  s = applyExprKey(s, '=', { formatResult: toKeypadInput });
  assert.equal(s, '116');
  assert.equal(isExpression(s), false);
});

test('applyExprKey replaces consecutive operators and blocks duplicate decimals', () => {
  assert.equal(applyExprKey('12+', '×'), '12×');
  assert.equal(applyExprKey('12,5', ','), '12,5');
  assert.equal(applyExprKey('12,5+3', ','), '12,5+3,');
});

test('formatExpression groups numbers while spacing operators', () => {
  const formatted = formatExpression('1500+250,5', formatInput);
  assert.ok(formatted.includes(' + '));
});
