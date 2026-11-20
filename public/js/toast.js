const el = document.getElementById('toast');
let timer = null;

export function toast(message, { tone = 'info', duration = 3200, actionLabel = null, onAction = null } = {}) {
  clearTimeout(timer);
  el.replaceChildren();

  const textSpan = document.createElement('span');
  textSpan.className = 'toast__msg';
  textSpan.textContent = message;
  el.append(textSpan);

  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      clearTimeout(timer);
      el.hidden = true;
      onAction();
    });
    el.append(btn);
  }

  el.dataset.tone = tone;
  el.hidden = false;
  timer = setTimeout(() => { el.hidden = true; }, duration);
}
