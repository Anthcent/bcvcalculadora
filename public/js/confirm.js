const dialog = document.querySelector('#confirm-dialog');

export function isConfirmOpen() {
  return dialog.open;
}

/** Shows the shared confirmation dialog and resolves to true when the user confirms. */
export function confirmAction({ title, text, confirmLabel = 'Eliminar', cancelLabel = 'Cancelar' }) {
  if (typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n${text}`));
  }
  dialog.querySelector('#confirm-title').textContent = title;
  dialog.querySelector('#confirm-text').textContent = text;
  dialog.querySelector('#confirm-ok').textContent = confirmLabel;
  dialog.querySelector('#confirm-cancel').textContent = cancelLabel;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    const form = dialog.querySelector('form');
    // Read the answer from the button pressed; "close" is only a fallback (Escape, close()).
    const finish = (confirmed) => {
      form.removeEventListener('submit', onSubmit);
      dialog.removeEventListener('close', onClose);
      resolve(confirmed);
    };
    const onSubmit = (e) => finish(e.submitter?.value === 'confirm');
    const onClose = () => finish(dialog.returnValue === 'confirm');
    form.addEventListener('submit', onSubmit);
    dialog.addEventListener('close', onClose);
  });
}
