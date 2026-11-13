import { load, save } from './storage.js';
import { CURRENCIES } from './convert.js';

/**
 * Calculation windows, persisted on every change so switching never loses data.
 * Window: { id, name, from, to, input, included }
 *   input: keypad text with comma decimal, e.g. "1250,5"
 */

const STORAGE_KEY = 'windows';
const listeners = new Set();

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function nextName(windows) {
  const used = new Set(windows.map((w) => w.name));
  let n = windows.length + 1;
  while (used.has(`Cálculo ${n}`)) n += 1;
  return `Cálculo ${n}`;
}

function createWindow(windows) {
  return { id: makeId(), name: nextName(windows), from: 'USD', to: 'VES', input: '', included: true };
}

function isValidWindow(w) {
  return w && typeof w.id === 'string' && CURRENCIES.includes(w.from) && CURRENCIES.includes(w.to);
}

function restore() {
  const saved = load(STORAGE_KEY);
  // Normalize older or hand-edited saves so every window has the fields the UI relies on.
  const windows = Array.isArray(saved?.windows)
    ? saved.windows.filter(isValidWindow).map((w, i) => ({
      ...w,
      name: typeof w.name === 'string' && w.name.trim() ? w.name : `Cálculo ${i + 1}`,
      input: typeof w.input === 'string' && /^\d*(,\d{0,2})?$/.test(w.input) ? w.input : '',
      included: w.included !== false,
    }))
    : [];
  if (windows.length === 0) windows.push(createWindow([]));
  const activeId = windows.some((w) => w.id === saved?.activeId) ? saved.activeId : windows[0].id;
  return { windows, activeId };
}

let state = restore();

function commit(next) {
  state = next;
  save(STORAGE_KEY, state);
  listeners.forEach((fn) => fn(state));
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
  const win = createWindow(state.windows);
  commit({ windows: [...state.windows, win], activeId: win.id });
  return win;
}

export function selectWindow(id) {
  if (id !== state.activeId) commit({ ...state, activeId: id });
}

export function updateWindow(id, patch) {
  commit({ ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
}

/** Drops every window and starts over with a single empty one. */
export function clearAll() {
  const win = createWindow([]);
  commit({ windows: [win], activeId: win.id });
}

export function removeWindow(id) {
  const index = state.windows.findIndex((w) => w.id === id);
  if (index === -1) return;
  let windows = state.windows.filter((w) => w.id !== id);
  if (windows.length === 0) windows = [createWindow([])];
  const activeId = state.activeId === id
    ? windows[Math.min(index, windows.length - 1)].id
    : state.activeId;
  commit({ windows, activeId });
}
