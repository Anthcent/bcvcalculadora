const el = document.getElementById('toast');
let timer = null;

export function toast(message, { tone = 'info', duration = 3200 } = {}) {
  clearTimeout(timer);
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  timer = setTimeout(() => { el.hidden = true; }, duration);
}
