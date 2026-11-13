import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBcvHtml } from '../src/bcv-parser.js';

const FIXTURE = `
<div class="view-content">
  <div id="euro" class="col-sm-12 col-xs-12">
    <div class="field-content"><div class="row recuadrotsmc">
      <div class="col-sm-6 col-xs-6"><span> EUR </span></div>
      <div class="col-sm-6 col-xs-6 centrado"><strong class="strong-tb"> 1.009,34130871</strong></div>
    </div></div>
  </div>
  <div id="dolar" class="col-sm-12 col-xs-12">
    <div class="field-content"><div class="row recuadrotsmc">
      <div class="col-sm-6 col-xs-6"><span> USD</span></div>
      <div class="col-sm-6 col-xs-6 centrado"><strong class="strong-tb">911,62430000</strong></div>
    </div></div>
  </div>
  <div class="pull-right dinpro center">Fecha Valor: <span property="dc:date" datatype="xsd:dateTime" content="2026-11-13T00:00:00-04:00" class="date-display-single">Viernes, 13 Noviembre  2026</span></div>
</div>`;

test('parses USD, EUR and value date from BCV markup', () => {
  const result = parseBcvHtml(FIXTURE);
  assert.equal(result.usd, 911.6243);
  assert.equal(result.eur, 1009.34130871);
  assert.equal(result.valueDate, '2026-11-13');
});

test('throws when rate markup is missing', () => {
  assert.throws(() => parseBcvHtml('<html><body>Maintenance</body></html>'), /not found/);
  assert.throws(() => parseBcvHtml(''), /Empty/);
});
