// finance.html: the finance officer.
//   Today: tonight's sales.
//   To pay: what's waiting for finance: purchases to check against the stock limits, then (once a
//     director has approved) bills, salaries, loans and commissions to pay.
//   Money: in, out, profit; expenses; bills and the month's budget (finance sets them).
//   Stock: record drinks bought, stock the manager added, the bar's counts and the manager's
//     explanations; drinks, prices, costs and stock limits.
//   Reports: end of day, sign-off; each waiter's night and report; the night's checks (staff
//     reports, cash, approvals).
import { $, $$, esc } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { bottomNav, money, backBar, bindBackBar } from '../lib/ops-ui.js';
import { accountsView, waitersView, salesView, closingView, approvalsView, stockAdminView, eodListView, eodView, productsView, changesView, moneyView, budgetView, paymentsView, commissionsView, purchasesView, cashReceiveView, tipsView, chargesView, financeNightView, tabClearView } from '../lib/ops-views.js';
import { payView } from '../lib/people-views.js';

const user = await requireStaff(['finance', 'superAdmin', 'director', 'manager']);
staffHeader(user, 'Finance');
const app = $('#app');
const canSignOff = ['finance', 'superAdmin', 'director'].includes(user.role);
const nav = bottomNav([['today', 'Today'], ['pay', 'To pay'], ['money', 'Money'], ['stock', 'Stock'], ['reports', 'Reports']], k => { location.hash = k; });
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${esc(e.message)}</div>`; };
const back = (label = '', to = 'today') => backBar('', to); // ← Back: where they came from (or the parent screen)
const bindBack = () => { bindBackBar(app); $$('[data-goto]:not(.back-btn)', app).forEach(b => b.onclick = () => { location.hash = b.dataset.goto; }); };
const sub = (label, to, html) => { app.innerHTML = `${back(label, to)}<div id="sv"></div>`; bindBack(); return html($('#sv')); };

async function route() {
  const [k, arg] = location.hash.slice(1).split('/');
  const group = { report: 'reports', check: 'reports', waiters: 'reports', accounts: 'reports', finance: 'reports', charges: 'reports', opentabs: 'reports', prices: 'stock', budget: 'money', payments: 'money', commissions: 'pay', salaries: 'pay', purchases: 'pay', cash: 'pay', tips: 'pay' }[k] || k || 'today';
  nav.setActive(group); scrollTo(0, 0);
  try {
    if (k === 'pay') return await toPay();
    if (k === 'salaries') return await sub('To pay', 'pay', el => payView(el, arg));
    if (k === 'purchases') return await sub('To pay', 'pay', el => purchasesView(el));
    if (k === 'commissions') return await sub('To pay', 'pay', el => commissionsView(el));
    if (k === 'cash') return await sub('To pay', 'pay', el => cashReceiveView(el));
    if (k === 'tips') return await sub('To pay', 'pay', el => tipsView(el));
    if (k === 'check') { app.innerHTML = `${back('Reports', 'reports')}<div id="cl"></div><div id="ap" style="margin-top:20px"></div>`; bindBack(); await closingView($('#cl'), undefined, { canClose: false }); await approvalsView($('#ap')); return; }
    if (k === 'accounts') return await sub('Reports', 'reports', el => accountsView(el, arg));
    if (k === 'waiters') return await sub('Reports', 'reports', el => waitersView(el, arg));
    if (k === 'finance') return await sub('Reports', 'reports', el => financeNightView(el, arg));
    if (k === 'charges') return await sub('Reports', 'reports', el => chargesView(el));
    if (k === 'opentabs') return await sub('Reports', 'reports', el => tabClearView(el));
    if (k === 'money') return await moneyView(app);
    if (k === 'budget') return await sub('Money', 'money', el => budgetView(el));
    if (k === 'payments') return await sub('Money', 'money', el => paymentsView(el));
    if (k === 'stock') { app.innerHTML = '<div id="sk"></div><button class="big ghost" id="toPrices" style="margin-top:16px">Drinks, prices, costs and stock limits</button>'; $('#toPrices').onclick = () => { location.hash = 'prices'; }; return await stockAdminView($('#sk'), undefined, undefined, { role: user.role }); }
    if (k === 'reports') { app.innerHTML = '<button class="big ghost" data-goto="accounts">Night accounts: what the drinks should bring, who isn’t aligned</button><button class="big ghost" data-goto="waiters">Waiters, one by one: sales, cash, MoMo, their reports</button><button class="big ghost" data-goto="finance">Night’s finances: sales, Paystack fees, settlement, every payment</button><button class="big ghost" data-goto="check">The night’s checks: staff reports, cash, approvals</button><button class="big ghost" data-goto="charges">Service charge &amp; commission (view), pricing simulation</button>' + (canSignOff ? '<button class="big ghost" data-goto="opentabs">Tabs left open after a night: clear them</button>' : '') + '<div id="rl"></div>'; bindBack(); return await eodListView($('#rl'), { canSignOff }); }
    if (k === 'report' && arg) return await eodView(app, arg, { canSignOff });
    if (k === 'prices') { app.innerHTML = `${back('Stock', 'stock')}<div id="pr"></div><div id="ch" style="margin-top:20px"></div>`; bindBack(); await productsView($('#pr'), { canEdit: ['finance', 'superAdmin'].includes(user.role) }); await changesView($('#ch')); return; }
    return await salesView(app);
  } catch (e) { fail(e); }
}
addEventListener('hashchange', route);

// ── To pay: one place for everything waiting for finance ──
async function toPay() {
  app.innerHTML = '<div class="loading">Loading…</div>';
  const [b, p, c, pu, tp] = await Promise.all([sapi('/api/ops/budget'), sapi('/api/ops/payroll'), sapi('/api/ops/commissions'), sapi('/api/ops/purchases'), sapi('/api/ops/tips/owed').catch(() => null)]);
  const billsReady = b.bills.filter(x => x.approved && x.leftPesewas), billsWaiting = b.bills.filter(x => x.state === 'awaiting_approval');
  const loansReady = p.loans.filter(l => l.status === 'approved');
  const comReady = c.people.filter(x => x.payout?.status === 'approved' && x.owedPesewas);
  const toCheck = pu.requests.filter(r => r.status === 'requested');
  const row = (to, title, sub, amount, ready) => `<a class="pos-row" href="#${to}" style="text-decoration:none"><span class="where">${esc(title)}<small>${sub}</small></span><span class="amt">${amount}${ready ? '<small style="display:block;color:#6fcfae">ready to pay</small>' : ''}</span></a>`;
  app.innerHTML = `<h1>To pay</h1><p class="lead" style="margin:0">Finance pays only what a director has approved.</p>
    <div class="pos-tables">
      ${row('purchases', 'Drinks to buy', toCheck.length ? `${toCheck.length} request${toCheck.length > 1 ? 's' : ''} to check against the stock limits` : 'Nothing to check', toCheck.length ? money(toCheck.reduce((n, r) => n + r.estTotalPesewas, 0)) : '', false)}
      ${row('budget', 'Bills', `${billsReady.length} approved to pay${billsWaiting.length ? ` · ${billsWaiting.length} waiting for a director` : ''}${b.totals.overdue ? ` · ${b.totals.overdue} overdue` : ''}`, money(billsReady.reduce((n, x) => n + x.leftPesewas, 0)), billsReady.length)}
      ${row('salaries', `Salaries · ${p.label}`, `${esc(p.statusLabel)}${loansReady.length ? ` · ${loansReady.length} loan${loansReady.length > 1 ? 's' : ''} to pay out` : ''}`, money(p.totals.netPesewas - p.totals.paidPesewas), p.can.pay || loansReady.length)}
      ${tp ? row('tips', 'Tips owed to staff', tp.people.length ? `${tp.people.length} ${tp.people.length > 1 ? 'people' : 'person'} · MoMo and card tips · no director needed` : 'Nothing owed', money(tp.owedPesewas), tp.owedPesewas > 0) : ''}
      ${row('commissions', 'Commissions', comReady.length ? `${comReady.length} approved to pay` : `${money(c.totals.owedPesewas)} owed this month`, money(comReady.reduce((n, x) => n + x.owedPesewas, 0)), comReady.length)}
    </div>`;
}
route();
