import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';

test('upserts and lists BCV rates chronologically', () => {
  const store = createDatabase(':memory:');
  try {
    store.upsertBcvRate({ valueDate: '2026-11-18', usd: 910.5, eur: 1001.2, fetchedAt: '2026-11-18T12:00:00Z' });
    store.upsertBcvRate({ valueDate: '2026-11-20', usd: 918.76, eur: 1009.07, fetchedAt: '2026-11-20T12:00:00Z' });
    // Updating an existing date updates in place without duplicating.
    store.upsertBcvRate({ valueDate: '2026-11-20', usd: 918.7662, eur: 1009.0717, fetchedAt: '2026-11-20T15:00:00Z' });

    const list = store.listBcvRates();
    assert.equal(list.length, 2);
    assert.equal(list[0].valueDate, '2026-11-18');
    assert.equal(list[1].usd, 918.7662);
    assert.equal(store.getLatestBcvRate().valueDate, '2026-11-20');
  } finally {
    store.close();
  }
});

test('persists custom rates, calculations, quick chips, and user settings', () => {
  const store = createDatabase(':memory:');
  try {
    const custom = store.saveCustomRate({ enabled: true, mode: 'margin', marginPct: 10, label: 'Tienda' });
    assert.equal(custom.enabled, true);
    assert.equal(custom.mode, 'margin');
    assert.equal(custom.marginPct, 10);

    const calcs = store.replaceCalculations({
      activeId: 'w2',
      windows: [
        { id: 'w1', name: 'Café', from: 'USD', to: 'VES', input: '5', qty: 2, included: true },
        { id: 'w2', name: 'Pan', from: 'VES', to: 'USD', input: '1500', qty: 1, included: false },
      ],
    });
    assert.equal(calcs.windows.length, 2);
    assert.equal(calcs.activeId, 'w2');
    assert.equal(calcs.windows[0].qty, 2);
    assert.equal(calcs.windows[1].included, false);

    const chips = store.saveQuickChips({ foreign: [2, 5, 10], ves: [500, 2000] });
    assert.deepEqual(chips, { foreign: [2, 5, 10], ves: [500, 2000] });
    assert.deepEqual(store.getQuickChips(), { foreign: [2, 5, 10], ves: [500, 2000] });

    const settings = store.saveSettings({ theme: 'light', profile: { businessName: 'Mi App' } });
    assert.equal(settings.theme, 'light');
    assert.equal(settings.profile.businessName, 'Mi App');
  } finally {
    store.close();
  }
});

test('relates receipts to bcv_rates and cascades deletion to receipt_items', () => {
  const store = createDatabase(':memory:');
  try {
    const rate = store.upsertBcvRate({ valueDate: '2026-11-20', usd: 918.7662, eur: 1009.0717, fetchedAt: '2026-11-20T15:00:00Z' });

    const saved = store.saveReceipt({
      receiptNumber: '20261120-151500',
      title: 'Recibo personal',
      clientName: 'Ana',
      note: 'Almuerzo',
      totalCurrency: 'VES',
      totalAmount: 9187.66,
      rateUsd: rate.usd,
      rateEur: rate.eur,
      rateLabel: 'Tasa BCV',
      valueDate: '2026-11-20',
      items: [
        { name: 'Plato', from: 'USD', to: 'VES', unitAmount: 8, qty: 1, resultAmount: 7350.13, convertedAmount: 7350.13 },
        { name: 'Bebida', from: 'USD', to: 'VES', unitAmount: 2, qty: 1, resultAmount: 1837.53, convertedAmount: 1837.53 },
      ],
    });

    assert.equal(saved.bcvRateId, rate.id);
    assert.equal(saved.bcvValueDate, '2026-11-20');
    assert.equal(saved.items.length, 2);
    assert.equal(store.countReceipts(), 1);

    // Deleting the receipt must cascade delete its receipt_items.
    assert.equal(store.deleteReceipt(saved.id), true);
    assert.equal(store.countReceipts(), 0);
    const orphanItems = store.db.prepare('SELECT COUNT(*) AS cnt FROM receipt_items').get().cnt;
    assert.equal(orphanItems, 0);
  } finally {
    store.close();
  }
});
