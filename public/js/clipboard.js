import { toast } from './toast.js';

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

/** Copies plain text to clipboard (works on HTTP LAN URLs too) and optionally shows a toast. */
export async function copyText(text, successMessage = 'Copiado al portapapeles') {
  if (text == null || text === '') return false;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(String(text));
    else if (!legacyCopy(String(text))) throw new Error('copy failed');
    navigator.vibrate?.(10);
    if (successMessage) toast(successMessage);
    return true;
  } catch {
    toast('No se pudo copiar al portapapeles.', { tone: 'error' });
    return false;
  }
}

/**
 * Formats a numeric amount ready to paste into Venezuelan banking / Pago Móvil apps:
 * no thousands separator, comma decimal, 2 decimal places (or custom precision).
 * Example: 4558.124 -> "4558,12"
 */
export function formatBankCopy(value, decimals = 2) {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(decimals).replace('.', ',');
}
