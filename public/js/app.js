import { initRatesView } from './rates-view.js';
import { initCalculatorView } from './calculator-view.js';
import { initPanelView, openPanel } from './panel-view.js';
import { initQuickCalc } from './quick-calc.js';
import { initReceipt } from './receipt.js';
import { load, save } from './storage.js';

const VIEWS = ['rates', 'calc'];
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

initRatesView();
initCalculatorView(() => activeView === 'calc');
initPanelView();
initQuickCalc(() => showView('calc'));
initReceipt();
showView(activeView);
if (wantsPanel) openPanel();

