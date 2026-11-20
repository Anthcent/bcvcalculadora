import { getProfile, updateProfile, formatPagoMovilText, hasPagoMovilData } from './profile-store.js';
import { copyText } from './clipboard.js';
import { toast } from './toast.js';

const $ = (sel) => document.querySelector(sel);

export function openProfileModal() {
  const dialog = $('#profile-dialog');
  const profile = getProfile();

  $('#prof-business').value = profile.businessName;
  $('#prof-note').value = profile.receiptNote;
  $('#pm-enabled').checked = profile.pagoMovil.enabled;
  $('#pm-bank').value = profile.pagoMovil.bank;
  $('#pm-id').value = profile.pagoMovil.idDoc;
  $('#pm-phone').value = profile.pagoMovil.phone;

  dialog.showModal();
}

export function initProfileModal() {
  const dialog = $('#profile-dialog');
  const form = $('#profile-form');

  $('#open-profile')?.addEventListener('click', openProfileModal);
  $('#panel-profile-btn')?.addEventListener('click', openProfileModal);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    updateProfile({
      businessName: $('#prof-business').value.trim(),
      receiptNote: $('#prof-note').value.trim(),
      pagoMovil: {
        enabled: $('#pm-enabled').checked,
        bank: $('#pm-bank').value.trim(),
        idDoc: $('#pm-id').value.trim(),
        phone: $('#pm-phone').value.trim(),
      },
    });
    dialog.close();
    toast('Datos guardados');
  });

  $('#pm-copy-only')?.addEventListener('click', () => {
    const draft = {
      pagoMovil: {
        bank: $('#pm-bank').value.trim(),
        idDoc: $('#pm-id').value.trim(),
        phone: $('#pm-phone').value.trim(),
      },
    };
    if (!hasPagoMovilData(draft)) {
      toast('Completa al menos un dato de Pago Móvil.', { tone: 'error' });
      return;
    }
    copyText(formatPagoMovilText(draft), 'Datos de Pago Móvil copiados');
  });

  $('#profile-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
