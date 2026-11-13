import { confirmAction, isConfirmOpen } from './confirm.js';
import { formatFetchedAt } from './format.js';
import { toast } from './toast.js';
import * as store from './windows-store.js';

// Calculations untouched for this long are considered old (rates usually changed since).
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

let asking = false;

/** Asks whether to keep or clear calculations that have not been used for a while. */
async function checkForOldCalculations() {
  const { windows, updatedAt } = store.getState();
  if (asking || isConfirmOpen() || !store.hasAmounts()) return;
  if (Date.now() - updatedAt < STALE_AFTER_MS) return;

  asking = true;
  const count = windows.filter((w) => w.input).length;
  const plural = count === 1 ? 'cálculo guardado' : 'cálculos guardados';
  const remove = await confirmAction({
    title: 'Tiene cálculos anteriores',
    text: `Hay ${count} ${plural} (último uso: ${formatFetchedAt(new Date(updatedAt).toISOString())}). `
      + 'Si los mantiene, se recalculan con la tasa BCV actual.',
    confirmLabel: 'Borrar',
    cancelLabel: 'Mantener',
  });
  asking = false;

  if (remove) {
    store.clearAll();
    toast('Cálculos borrados');
  } else {
    store.touch(); // Don't ask again until they sit unused for another period.
  }
}

export function initStaleCheck() {
  checkForOldCalculations();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkForOldCalculations();
  });
}
