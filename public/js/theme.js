import { load, save } from './storage.js';

const STORAGE_KEY = 'theme';
const THEME_COLORS = {
  dark: '#0A0E14',
  light: '#F4F7FC',
};

let current = 'dark';

function resolveInitial() {
  const saved = load(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

function apply(theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', theme);

  const btn = document.querySelector('#theme-toggle');
  if (btn) {
    const nextLabel = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    btn.setAttribute('aria-label', nextLabel);
    btn.title = nextLabel;
    btn.dataset.theme = theme;
  }
}

export function getTheme() {
  return current;
}

export function toggleTheme() {
  const next = current === 'dark' ? 'light' : 'dark';
  save(STORAGE_KEY, next);
  apply(next);
}

export function initTheme() {
  apply(resolveInitial());
  document.querySelector('#theme-toggle')?.addEventListener('click', toggleTheme);
}
