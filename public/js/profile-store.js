import { load, save } from './storage.js';

const STORAGE_KEY = 'profile';
const listeners = new Set();

const DEFAULT_PROFILE = {
  businessName: '',
  clientName: '',
  receiptNote: '',
  pagoMovil: {
    enabled: false,
    bank: '',
    idDoc: '',
    phone: '',
  },
};

function restore() {
  const saved = load(STORAGE_KEY);
  if (!saved || typeof saved !== 'object') return structuredClone(DEFAULT_PROFILE);
  return {
    businessName: typeof saved.businessName === 'string' ? saved.businessName : '',
    clientName: typeof saved.clientName === 'string' ? saved.clientName : '',
    receiptNote: typeof saved.receiptNote === 'string' ? saved.receiptNote : '',
    pagoMovil: {
      enabled: Boolean(saved.pagoMovil?.enabled),
      bank: typeof saved.pagoMovil?.bank === 'string' ? saved.pagoMovil.bank : '',
      idDoc: typeof saved.pagoMovil?.idDoc === 'string' ? saved.pagoMovil.idDoc : '',
      phone: typeof saved.pagoMovil?.phone === 'string' ? saved.pagoMovil.phone : '',
    },
  };
}

let state = restore();

export function getProfile() {
  return state;
}

export function updateProfile(patch) {
  state = {
    ...state,
    ...patch,
    pagoMovil: patch.pagoMovil ? { ...state.pagoMovil, ...patch.pagoMovil } : state.pagoMovil,
  };
  save(STORAGE_KEY, state);
  listeners.forEach((fn) => fn(state));
}

export function onProfileChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when Pago Móvil has at least one field filled in. */
export function hasPagoMovilData(profile = state) {
  const pm = profile?.pagoMovil;
  return Boolean(pm && (pm.bank.trim() || pm.idDoc.trim() || pm.phone.trim()));
}

/** Formatted lines for Pago Móvil sharing/receipt. */
export function formatPagoMovilLines(profile = state) {
  const pm = profile?.pagoMovil;
  if (!pm) return [];
  const lines = [];
  if (pm.bank.trim()) lines.push(`Banco: ${pm.bank.trim()}`);
  if (pm.idDoc.trim()) lines.push(`C.I./RIF: ${pm.idDoc.trim()}`);
  if (pm.phone.trim()) lines.push(`Teléfono: ${pm.phone.trim()}`);
  return lines;
}

/** Single-block text ready to copy/paste for Pago Móvil. */
export function formatPagoMovilText(profile = state) {
  const lines = formatPagoMovilLines(profile);
  if (lines.length === 0) return '';
  return ['*Datos Pago Móvil*', ...lines].join('\n');
}
