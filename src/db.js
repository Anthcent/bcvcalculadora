import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bcvcalc.sqlite');

const SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS bcv_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    value_date  TEXT    NOT NULL UNIQUE,
    usd         REAL    NOT NULL CHECK (usd > 0),
    eur         REAL    NOT NULL CHECK (eur > 0),
    source      TEXT    NOT NULL DEFAULT 'bcv.org.ve',
    fetched_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_rates (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    label       TEXT    NOT NULL DEFAULT '',
    mode        TEXT    NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'margin')),
    usd         REAL,
    eur         REAL,
    margin_pct  REAL    NOT NULL DEFAULT 5,
    is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    updated_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calculations (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    from_currency TEXT    NOT NULL CHECK (from_currency IN ('VES', 'USD', 'EUR')),
    to_currency   TEXT    NOT NULL CHECK (to_currency IN ('VES', 'USD', 'EUR')),
    input_expr    TEXT    NOT NULL DEFAULT '',
    qty           INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
    included      INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
    position      INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_number  TEXT    NOT NULL UNIQUE,
    title           TEXT    NOT NULL,
    client_name     TEXT    NOT NULL DEFAULT '',
    note            TEXT    NOT NULL DEFAULT '',
    total_currency  TEXT    NOT NULL CHECK (total_currency IN ('VES', 'USD', 'EUR')),
    total_amount    REAL    NOT NULL,
    rate_usd        REAL    NOT NULL,
    rate_eur        REAL    NOT NULL,
    rate_label      TEXT    NOT NULL DEFAULT 'Tasa BCV',
    bcv_rate_id     INTEGER REFERENCES bcv_rates(id) ON DELETE SET NULL,
    pago_movil_json TEXT,
    issued_at       TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS receipt_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id       INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    name             TEXT    NOT NULL,
    from_currency    TEXT    NOT NULL CHECK (from_currency IN ('VES', 'USD', 'EUR')),
    to_currency      TEXT    NOT NULL CHECK (to_currency IN ('VES', 'USD', 'EUR')),
    unit_amount      REAL    NOT NULL,
    qty              INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
    result_amount    REAL    NOT NULL,
    converted_amount REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quick_chips (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_group  TEXT    NOT NULL CHECK (currency_group IN ('foreign', 'ves')),
    amount          REAL    NOT NULL CHECK (amount > 0),
    position        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bcv_rates_date ON bcv_rates(value_date DESC);
  CREATE INDEX IF NOT EXISTS idx_receipts_issued ON receipts(issued_at DESC);
  CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
  CREATE INDEX IF NOT EXISTS idx_quick_chips_group ON quick_chips(currency_group, position);
`;

export function createDatabase(dbPath = process.env.BCV_DB_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(SCHEMA_SQL);

  function withTransaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /* ---------- BCV Rates ---------- */

  const stmtUpsertRate = db.prepare(`
    INSERT INTO bcv_rates (value_date, usd, eur, source, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(value_date) DO UPDATE SET
      usd = excluded.usd,
      eur = excluded.eur,
      source = excluded.source,
      fetched_at = excluded.fetched_at
  `);
  const stmtLatestRate = db.prepare(`
    SELECT id, value_date, usd, eur, source, fetched_at
    FROM bcv_rates
    ORDER BY value_date DESC, fetched_at DESC
    LIMIT 1
  `);
  const stmtListRates = db.prepare(`
    SELECT id, value_date, usd, eur, source, fetched_at
    FROM bcv_rates
    ORDER BY value_date ASC
    LIMIT ?
  `);
  const stmtRateByDate = db.prepare(`
    SELECT id FROM bcv_rates WHERE value_date = ? LIMIT 1
  `);

  function mapRateRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      valueDate: row.value_date,
      usd: row.usd,
      eur: row.eur,
      source: row.source,
      fetchedAt: row.fetched_at,
    };
  }

  function upsertBcvRate({ valueDate, usd, eur, source = 'bcv.org.ve', fetchedAt = new Date().toISOString() }) {
    const dateKey = valueDate || fetchedAt.slice(0, 10);
    stmtUpsertRate.run(dateKey, usd, eur, source, fetchedAt);
    return mapRateRow(stmtLatestRate.get());
  }

  function getLatestBcvRate() {
    return mapRateRow(stmtLatestRate.get());
  }

  function listBcvRates(limit = 60) {
    return stmtListRates.all(limit).map(mapRateRow);
  }

  /* ---------- Custom Rate ---------- */

  const stmtGetCustom = db.prepare(`
    SELECT label, mode, usd, eur, margin_pct, is_active, updated_at
    FROM custom_rates WHERE id = 1
  `);
  const stmtSaveCustom = db.prepare(`
    INSERT INTO custom_rates (id, label, mode, usd, eur, margin_pct, is_active, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      mode = excluded.mode,
      usd = excluded.usd,
      eur = excluded.eur,
      margin_pct = excluded.margin_pct,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);

  function getCustomRate() {
    const row = stmtGetCustom.get();
    if (!row) return null;
    return {
      label: row.label,
      mode: row.mode,
      usd: row.usd,
      eur: row.eur,
      marginPct: row.margin_pct,
      enabled: Boolean(row.is_active),
      updatedAt: row.updated_at,
    };
  }

  function saveCustomRate(cfg) {
    const mode = cfg?.mode === 'margin' ? 'margin' : 'manual';
    const usd = Number(cfg?.usd) > 0 ? Number(cfg.usd) : null;
    const eur = Number(cfg?.eur) > 0 ? Number(cfg.eur) : null;
    const marginPct = Number.isFinite(Number(cfg?.marginPct)) ? Number(cfg.marginPct) : 5;
    const enabled = cfg?.enabled ? 1 : 0;
    const label = typeof cfg?.label === 'string' ? cfg.label.slice(0, 40) : '';
    const updatedAt = new Date().toISOString();
    stmtSaveCustom.run(label, mode, usd, eur, marginPct, enabled, updatedAt);
    return getCustomRate();
  }

  /* ---------- Calculations ---------- */

  const stmtListCalcs = db.prepare(`
    SELECT id, name, from_currency, to_currency, input_expr, qty, included, position, is_active, updated_at
    FROM calculations
    ORDER BY position ASC
  `);
  const stmtClearCalcs = db.prepare('DELETE FROM calculations');
  const stmtInsertCalc = db.prepare(`
    INSERT INTO calculations (id, name, from_currency, to_currency, input_expr, qty, included, position, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function getCalculationsState() {
    const rows = stmtListCalcs.all();
    if (rows.length === 0) return null;
    const windows = rows.map((r) => ({
      id: r.id,
      name: r.name,
      from: r.from_currency,
      to: r.to_currency,
      input: r.input_expr,
      qty: r.qty,
      included: Boolean(r.included),
    }));
    const activeRow = rows.find((r) => r.is_active === 1) ?? rows[0];
    const updatedAt = Math.max(...rows.map((r) => r.updated_at));
    return { windows, activeId: activeRow.id, updatedAt };
  }

  function replaceCalculations({ windows, activeId, updatedAt = Date.now() }) {
    if (!Array.isArray(windows) || windows.length === 0) return null;
    const validCurs = new Set(['VES', 'USD', 'EUR']);
    withTransaction(() => {
      stmtClearCalcs.run();
      windows.forEach((w, idx) => {
        if (!w || typeof w.id !== 'string') return;
        const from = validCurs.has(w.from) ? w.from : 'USD';
        const to = validCurs.has(w.to) ? w.to : 'VES';
        const qty = Number.isInteger(w.qty) && w.qty >= 1 ? Math.min(w.qty, 999) : 1;
        stmtInsertCalc.run(
          w.id.slice(0, 32),
          String(w.name || `Cálculo ${idx + 1}`).slice(0, 40),
          from,
          to,
          typeof w.input === 'string' ? w.input.slice(0, 80) : '',
          qty,
          w.included === false ? 0 : 1,
          idx,
          w.id === activeId ? 1 : 0,
          Number.isFinite(updatedAt) ? Math.trunc(updatedAt) : Date.now(),
        );
      });
    });
    return getCalculationsState();
  }

  /* ---------- Receipts & Receipt Items (1:N + FK to bcv_rates) ---------- */

  const stmtInsertReceipt = db.prepare(`
    INSERT INTO receipts (
      receipt_number, title, client_name, note,
      total_currency, total_amount, rate_usd, rate_eur, rate_label,
      bcv_rate_id, pago_movil_json, issued_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(receipt_number) DO UPDATE SET
      title = excluded.title,
      client_name = excluded.client_name,
      note = excluded.note,
      total_currency = excluded.total_currency,
      total_amount = excluded.total_amount,
      rate_usd = excluded.rate_usd,
      rate_eur = excluded.rate_eur,
      rate_label = excluded.rate_label,
      bcv_rate_id = excluded.bcv_rate_id,
      pago_movil_json = excluded.pago_movil_json,
      issued_at = excluded.issued_at
  `);
  const stmtReceiptByNumber = db.prepare('SELECT id FROM receipts WHERE receipt_number = ?');
  const stmtClearReceiptItems = db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?');
  const stmtInsertReceiptItem = db.prepare(`
    INSERT INTO receipt_items (
      receipt_id, name, from_currency, to_currency,
      unit_amount, qty, result_amount, converted_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtListReceipts = db.prepare(`
    SELECT r.*, b.value_date AS bcv_value_date
    FROM receipts r
    LEFT JOIN bcv_rates b ON b.id = r.bcv_rate_id
    ORDER BY r.issued_at DESC
    LIMIT ?
  `);
  const stmtItemsForReceipt = db.prepare(`
    SELECT id, name, from_currency, to_currency, unit_amount, qty, result_amount, converted_amount
    FROM receipt_items
    WHERE receipt_id = ?
    ORDER BY id ASC
  `);
  const stmtDeleteReceipt = db.prepare('DELETE FROM receipts WHERE id = ?');
  const stmtCountReceipts = db.prepare('SELECT COUNT(*) AS cnt FROM receipts');

  function mapReceiptRow(row) {
    if (!row) return null;
    let pagoMovil = null;
    if (row.pago_movil_json) {
      try { pagoMovil = JSON.parse(row.pago_movil_json); } catch { pagoMovil = null; }
    }
    return {
      id: row.id,
      receiptNumber: row.receipt_number,
      title: row.title,
      clientName: row.client_name,
      note: row.note,
      totalCurrency: row.total_currency,
      totalAmount: row.total_amount,
      rateUsd: row.rate_usd,
      rateEur: row.rate_eur,
      rateLabel: row.rate_label,
      bcvRateId: row.bcv_rate_id,
      bcvValueDate: row.bcv_value_date ?? null,
      pagoMovil,
      issuedAt: row.issued_at,
      items: stmtItemsForReceipt.all(row.id).map((it) => ({
        id: it.id,
        name: it.name,
        from: it.from_currency,
        to: it.to_currency,
        unitAmount: it.unit_amount,
        qty: it.qty,
        resultAmount: it.result_amount,
        convertedAmount: it.converted_amount,
      })),
    };
  }

  function saveReceipt(payload) {
    if (!payload || !payload.receiptNumber || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new Error('Invalid receipt payload');
    }
    const bcvRow = payload.valueDate ? stmtRateByDate.get(payload.valueDate) : null;
    const bcvRateId = bcvRow ? bcvRow.id : null;

    let receiptId;
    withTransaction(() => {
      stmtInsertReceipt.run(
        String(payload.receiptNumber).slice(0, 40),
        String(payload.title || 'Recibo de cálculo').slice(0, 60),
        String(payload.clientName || '').slice(0, 60),
        String(payload.note || '').slice(0, 140),
        payload.totalCurrency,
        Number(payload.totalAmount) || 0,
        Number(payload.rateUsd) || 0,
        Number(payload.rateEur) || 0,
        String(payload.rateLabel || 'Tasa BCV').slice(0, 40),
        bcvRateId,
        payload.pagoMovil ? JSON.stringify(payload.pagoMovil) : null,
        payload.issuedAt || new Date().toISOString(),
      );
      receiptId = stmtReceiptByNumber.get(String(payload.receiptNumber).slice(0, 40)).id;
      stmtClearReceiptItems.run(receiptId);
      for (const item of payload.items) {
        stmtInsertReceiptItem.run(
          receiptId,
          String(item.name || 'Cálculo').slice(0, 60),
          item.from,
          item.to,
          Number(item.unitAmount) || 0,
          Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 1,
          Number(item.resultAmount) || 0,
          Number(item.convertedAmount) || 0,
        );
      }
    });

    const saved = db.prepare(`
      SELECT r.*, b.value_date AS bcv_value_date
      FROM receipts r LEFT JOIN bcv_rates b ON b.id = r.bcv_rate_id
      WHERE r.id = ?
    `).get(receiptId);
    return mapReceiptRow(saved);
  }

  function listReceipts(limit = 30) {
    return stmtListReceipts.all(limit).map(mapReceiptRow);
  }

  function deleteReceipt(id) {
    const info = stmtDeleteReceipt.run(Number(id));
    return info.changes > 0;
  }

  function countReceipts() {
    return stmtCountReceipts.get().cnt;
  }

  /* ---------- Quick Chips ---------- */

  const stmtGetChips = db.prepare(`
    SELECT currency_group, amount FROM quick_chips ORDER BY currency_group ASC, position ASC
  `);
  const stmtClearChips = db.prepare('DELETE FROM quick_chips');
  const stmtInsertChip = db.prepare(`
    INSERT INTO quick_chips (currency_group, amount, position) VALUES (?, ?, ?)
  `);

  function getQuickChips() {
    const rows = stmtGetChips.all();
    if (rows.length === 0) return null;
    const foreign = [];
    const ves = [];
    for (const r of rows) {
      if (r.currency_group === 'foreign') foreign.push(r.amount);
      else if (r.currency_group === 'ves') ves.push(r.amount);
    }
    if (foreign.length === 0 || ves.length === 0) return null;
    return { foreign, ves };
  }

  function saveQuickChips({ foreign, ves }) {
    const clean = (arr) => (Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 10) : []);
    const fList = clean(foreign);
    const vList = clean(ves);
    if (fList.length === 0 || vList.length === 0) throw new Error('Quick chips cannot be empty');
    withTransaction(() => {
      stmtClearChips.run();
      fList.forEach((amt, idx) => stmtInsertChip.run('foreign', amt, idx));
      vList.forEach((amt, idx) => stmtInsertChip.run('ves', amt, idx));
    });
    return { foreign: fList, ves: vList };
  }

  /* ---------- User Settings (theme, profile, Pago Móvil) ---------- */

  const stmtAllSettings = db.prepare('SELECT key, value FROM user_settings');
  const stmtUpsertSetting = db.prepare(`
    INSERT INTO user_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  function getSettings() {
    const rows = stmtAllSettings.all();
    const out = {};
    for (const r of rows) {
      try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
    }
    return out;
  }

  function saveSettings(patch) {
    if (!patch || typeof patch !== 'object') return getSettings();
    const now = new Date().toISOString();
    withTransaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (typeof k !== 'string' || !k || k.length > 40) continue;
        stmtUpsertSetting.run(k, JSON.stringify(v), now);
      }
    });
    return getSettings();
  }

  /* ---------- Bootstrap snapshot ---------- */

  function getBootstrapState() {
    return {
      history: listBcvRates(60),
      customRate: getCustomRate(),
      calculations: getCalculationsState(),
      quickChips: getQuickChips(),
      settings: getSettings(),
      receiptsCount: countReceipts(),
    };
  }

  return {
    db,
    close: () => db.close(),
    upsertBcvRate,
    getLatestBcvRate,
    listBcvRates,
    getCustomRate,
    saveCustomRate,
    getCalculationsState,
    replaceCalculations,
    saveReceipt,
    listReceipts,
    deleteReceipt,
    countReceipts,
    getQuickChips,
    saveQuickChips,
    getSettings,
    saveSettings,
    getBootstrapState,
  };
}

let singleton = null;

export function getDb() {
  singleton ??= createDatabase();
  return singleton;
}
