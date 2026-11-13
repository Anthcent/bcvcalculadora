const dialog = document.querySelector('#confirm-dialog');

export function isConfirmOpen() {
  return dialog.open;
}

/** Shows the shared confirmation dialog and resolves to true when the user confirms. */
export function confirmAction({ title, text, confirmLabel = 'Eliminar' }) {
  if (typeof dialog.showModal !== 'function') {
    return Promise.resolve(window.confirm(`${title}\n${text}`));
  }
  dialog.querySelector('#confirm-title').textContent = title;
  dialog.querySelector('#confirm-text').textContent = text;
  dialog.querySelector('#confirm-ok').textContent = confirmLabel;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}
