import { load, save } from './storage.js';
import { CURRENCIES } from './convert.js';
import { isValidExprString } from './expr.js';
import { syncCalculations } from './db-sync.js';

/**
 * Calculation windows, persisted on every change so switching never loses data.
 * Window: { id, name, from, to, input, qty, included }
 *   input: keypad text or expression with comma decimal, e.g. "1250,5" or "100+16%"
 *   qty: integer >= 1 (quantity multiplier)
 */

const STORAGE_KEY = 'windows';
const listeners = new Set();

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function nextName(windows, baseName = null) {
  const used = new Set(windows.map((w) => w.name));
  if (baseName) {
    let candidate = `${baseName} (copia)`;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${baseName} (${n})`;
      n += 1;
    }
    return candidate.slice(0, 24);
  }
  let n = windows.length + 1;
  while (used.has(`Cálculo ${n}`)) n += 1;
  return `Cálculo ${n}`;
}

// New windows reuse the currency pair in use, since people tend to keep counting in one currency.
function createWindow(windows, { from = 'USD', to = 'VES' } = {}) {
  return { id: makeId(), name: nextName(windows), from, to, input: '', qty: 1, included: true };
}

function currentPair() {
  const active = state?.windows.find((w) => w.id === state.activeId);
  return active ? { from: active.from, to: active.to } : undefined;
}

function isValidWindow(w) {
  return w && typeof w.id === 'string' && CURRENCIES.includes(w.from) && CURRENCIES.includes(w.to);
}

function normalizeQty(q) {
  const n = Number(q);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : 1;
}

function restore() {
  const saved = load(STORAGE_KEY);
  // Normalize older or hand-edited saves so every window has the fields the UI relies on.
  const windows = Array.isArray(saved?.windows)
    ? saved.windows.filter(isValidWindow).map((w, i) => ({
      ...w,
      name: typeof w.name === 'string' && w.name.trim() ? w.name : `Cálculo ${i + 1}`,
      input: isValidExprString(w.input) ? w.input : '',
      qty: normalizeQty(w.qty),
      included: w.included !== false,
    }))
    : [];
  if (windows.length === 0) windows.push(createWindow([]));
  const activeId = windows.some((w) => w.id === saved?.activeId) ? saved.activeId : windows[0].id;
  // Older saves have no timestamp: count them as fresh rather than nagging right away.
  const updatedAt = Number.isFinite(saved?.updatedAt) ? saved.updatedAt : Date.now();
  return { windows, activeId, updatedAt };
}

let state = restore();

// Every change stamps the time of last use, which drives the "old calculations" prompt.
function commit(next, { sync = true, updatedAt = Date.now() } = {}) {
  state = { ...next, updatedAt };
  save(STORAGE_KEY, state);
  if (sync) syncCalculations(state);
  listeners.forEach((fn) => fn(state));
}

/** Hydrates calculation windows from SQLite when server data is newer (or local is empty). */
export function hydrateFromDb(remote) {
  if (!remote?.windows?.length) return;
  const localHasData = state.windows.some((w) => w.input);
  const remoteUpdated = Number.isFinite(remote.updatedAt) ? remote.updatedAt : 0;
  if (localHasData && remoteUpdated < state.updatedAt) {
    // Local offline edits are newer: push them up to SQLite instead.
    syncCalculations(state);
    return;
  }
  const windows = remote.windows.filter(isValidWindow).map((w, i) => ({
    ...w,
    name: typeof w.name === 'string' && w.name.trim() ? w.name : `Cálculo ${i + 1}`,
    input: isValidExprString(w.input) ? w.input : '',
    qty: normalizeQty(w.qty),
    included: w.included !== false,
  }));
  if (windows.length === 0) return;
  const activeId = windows.some((w) => w.id === remote.activeId) ? remote.activeId : windows[0].id;
  commit({ windows, activeId }, { sync: false, updatedAt: remoteUpdated || Date.now() });
}

/** True when at least one calculation has an amount typed in. */
export function hasAmounts() {
  return state.windows.some((w) => w.input);
}

/** Marks the calculations as just used without changing them. */
export function touch() {
  commit(state);
}

export function getState() {
  return state;
}

export function getActive() {
  return state.windows.find((w) => w.id === state.activeId);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addWindow() {
  const win = createWindow(state.windows, currentPair());
  commit({ windows: [...state.windows, win], activeId: win.id });
  return win;
}

export function duplicateWindow(id) {
  const source = state.windows.find((w) => w.id === id);
  if (!source) return null;
  const copy = {
    ...source,
    id: makeId(),
    name: nextName(state.windows, source.name.replace(/\s*\(copia\)|\s*\(\d+\)$/, '')),
  };
  const index = state.windows.findIndex((w) => w.id === id);
  const windows = [...state.windows];
  windows.splice(index + 1, 0, copy);
  commit({ windows, activeId: copy.id });
  return copy;
}

export function selectWindow(id) {
  if (id !== state.activeId) commit({ ...state, activeId: id });
}

export function updateWindow(id, patch) {
  const cleanPatch = { ...patch };
  if ('qty' in cleanPatch) cleanPatch.qty = normalizeQty(cleanPatch.qty);
  commit({ ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, ...cleanPatch } : w)) });
}

/** Drops every window and starts over with a single empty one. Returns previous state for Undo. */
export function clearAll() {
  const previous = { windows: state.windows.map((w) => ({ ...w })), activeId: state.activeId };
  const win = createWindow([], currentPair());
  commit({ windows: [win], activeId: win.id });
  return previous;
}

/** Restores a full snapshot (used for Undo after clearAll). */
export function restoreSnapshot(snapshot) {
  if (!snapshot?.windows?.length) return;
  commit({ windows: snapshot.windows, activeId: snapshot.activeId ?? snapshot.windows[0].id });
}

/** Removes a single window and returns { window, index, wasOnly } for Undo support. */
export function removeWindow(id) {
  const index = state.windows.findIndex((w) => w.id === id);
  if (index === -1) return null;
  const removed = { ...state.windows[index] };
  const wasOnly = state.windows.length === 1;
  let windows = state.windows.filter((w) => w.id !== id);
  if (windows.length === 0) windows = [createWindow([], currentPair())];
  const activeId = state.activeId === id
    ? windows[Math.min(index, windows.length - 1)].id
    : state.activeId;
  commit({ windows, activeId });
  return { window: removed, index, wasOnly };
}

/** Restores a previously deleted window at its original index. */
export function restoreWindow(deleted) {
  if (!deleted?.window) return;
  const { window: win, index, wasOnly } = deleted;
  // If deleting the last item spawned an empty placeholder, replace it cleanly.
  let windows;
  if (wasOnly && state.windows.length === 1 && !state.windows[0].input) {
    windows = [win];
  } else {
    windows = state.windows.filter((w) => w.id !== win.id);
    const insertAt = Math.max(0, Math.min(index, windows.length));
    windows.splice(insertAt, 0, win);
  }
  commit({ windows, activeId: win.id });
}
