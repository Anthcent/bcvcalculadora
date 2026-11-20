import { initTheme, getTheme, hydrateThemeFromDb } from './theme.js';
import { initRatesView } from './rates-view.js';
import { initCalculatorView } from './calculator-view.js';
import { initPanelView, openPanel } from './panel-view.js';
import { initQuickCalc, getChipPages, hydrateChipsFromDb } from './quick-calc.js';
import { initCustomView } from './custom-view.js';
import { initProfileModal } from './profile-modal.js';
import { initReceipt } from './receipt.js';
import { initStaleCheck } from './stale-check.js';
import { getCustomRateConfig, hydrateCustomFromDb, hydrateHistoryFromDb } from './rates-api.js';
import { getProfile, hydrateProfileFromDb } from './profile-store.js';
import { bootstrapFromDb } from './db-sync.js';
import * as windowsStore from './windows-store.js';
import { load, save } from './storage.js';

const VIEWS = ['rates', 'calc', 'custom'];
const navItems = [...document.querySelectorAll('.bottomnav__item')];
const scroller = document.querySelector('.views');
const hashView = location.hash.slice(1);
// "#total" now lives in the side panel of the calculator.
const wantsPanel = hashView === 'total';
let activeView = [wantsPanel ? 'calc' : hashView, load('view')].find((v) => VIEWS.includes(v)) ?? 'rates';

function showView(name) {
  activeView = name;
  save('view', name);
  document.querySelectorAll('.view').forEach((view) => {
    view.hidden = view.dataset.view !== name;
  });
  navItems.forEach((item) => {
    if (item.dataset.target === name) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  scroller.scrollTop = 0;
}

navItems.forEach((item) => item.addEventListener('click', () => showView(item.dataset.target)));

initTheme();
initRatesView();
initCalculatorView(() => activeView === 'calc');
initPanelView();
initQuickCalc(() => showView('calc'));
initCustomView();
initProfileModal();
initReceipt();
showView(activeView);
if (wantsPanel) openPanel();
initStaleCheck();

// Hybrid sync: hydrate from SQLite when server is reachable, keeping localStorage as offline fallback.
bootstrapFromDb({
  onHistory: hydrateHistoryFromDb,
  onCustomRate: hydrateCustomFromDb,
  onCalculations: windowsStore.hydrateFromDb,
  onQuickChips: hydrateChipsFromDb,
  onSettings: (settings) => {
    if (settings.theme) hydrateThemeFromDb(settings.theme);
    if (settings.profile) hydrateProfileFromDb(settings.profile);
  },
  seedCustomRate: getCustomRateConfig,
  seedQuickChips: getChipPages,
  seedSettings: () => ({ theme: getTheme(), profile: getProfile() }),
  seedCalculations: () => windowsStore.getState(),
});

// Register Service Worker for full offline PWA support.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
