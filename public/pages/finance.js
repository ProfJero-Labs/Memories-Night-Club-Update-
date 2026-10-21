// finance.html: the finance officer. Today (tonight's sales) · Money (in, out, profit; expenses) ·
// Stock (record drinks bought, stock the manager added, the bar's counts and the manager's
// explanations; drinks, prices and costs) · Check (staff reports, cash, approvals) · Reports (end of
// day, sign-off, print, CSV).
import { $ } from '../app.js';
import { requireStaff, staffHeader } from '../staff.js';
import { bottomNav } from '../lib/ops-ui.js';
import { salesView, closingView, approvalsView, stockAdminView, eodListView, eodView, productsView, changesView, moneyView } from '../lib/ops-views.js';

const user = await requireStaff(['finance', 'superAdmin', 'director', 'manager']);
staffHeader(user, 'Finance');
const app = $('#app');
const canSignOff = ['finance', 'superAdmin', 'director'].includes(user.role);
const nav = bottomNav([['today', 'Today'], ['money', 'Money'], ['stock', 'Stock'], ['check', 'Check'], ['reports', 'Reports']], k => { location.hash = k; });
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${e.message}</div>`; };

async function route() {
  const [k, arg] = location.hash.slice(1).split('/');
  nav.setActive(k === 'report' ? 'reports' : k === 'prices' ? 'stock' : k || 'today'); scrollTo(0, 0);
  try {
    if (k === 'check') { app.innerHTML = '<div id="cl"></div><div id="ap" style="margin-top:20px"></div>'; await closingView($('#cl'), undefined, { canClose: false }); await approvalsView($('#ap')); return; }
    if (k === 'money') return await moneyView(app);
    if (k === 'stock') { app.innerHTML = '<div id="sk"></div><button class="big ghost" id="toPrices" style="margin-top:16px">Drinks, prices and costs</button>'; $('#toPrices').onclick = () => { location.hash = 'prices'; }; return await stockAdminView($('#sk'), undefined, undefined, { role: user.role }); }
    if (k === 'reports') return await eodListView(app, { canSignOff });
    if (k === 'report' && arg) return await eodView(app, arg, { canSignOff });
    if (k === 'prices') { app.innerHTML = '<div id="pr"></div><div id="ch" style="margin-top:20px"></div>'; await productsView($('#pr')); await changesView($('#ch')); return; }
    return await salesView(app);
  } catch (e) { fail(e); }
}
addEventListener('hashchange', route);
route();
