// night.html: the manager's and directors' screen. Simple, like a till: tonight's money (expected,
// received, still owed, how it was paid), what needs them (approvals), the tables, and closing the
// night. Everything else is behind "More", shown only when tapped. The technical side (the site,
// nights, settings) is the administrator's, in the control room.
//   Manager:  Tonight · Tables · Staff · More (money & expenses, drinks & prices, stock, full sales, past nights)
//   Director: Tonight · Money · Reports · More (tables, staff, ticket money, members & attendance)
// "Needs you" on Tonight: approvals, and stock differences the bar found when it opened (the
// manager explains them). The manager adds expenses from Tonight; the director sees Money.
import { $, $$, esc } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { bottomNav, sheet, say, st, every, money, when } from '../lib/ops-ui.js';
import { salesView, closingView, approvalsView, productsView, stockAdminView, eodListView, eodView, moneyView, expenseSheet, explainSheet } from '../lib/ops-views.js';
import { staffView } from '../lib/staff-view.js';

const user = await requireStaff(['manager', 'director', 'superAdmin']);
const director = user.role !== 'manager';
staffHeader(user, 'Tonight');
const app = $('#app');
const navItems = director ? [['tonight', 'Tonight'], ['money', 'Money'], ['reports', 'Reports'], ['more', 'More']] : [['tonight', 'Tonight'], ['tables', 'Tables'], ['staff', 'Staff'], ['more', 'More']];
const nav = bottomNav(navItems, k => { if (k === 'more') more(); else location.hash = k; });
let stop = null;
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${esc(e.message)}</div><button class="big ghost" id="retry">Try again</button>`; $('#retry').onclick = route; };
const back = (label = 'Tonight', to = 'tonight') => `<button class="link" data-goto="${to}" style="justify-self:start">← ${esc(label)}</button>`;
const bindBack = () => $$('[data-goto]', app).forEach(b => b.onclick = () => { location.hash = b.dataset.goto; });

async function route() {
  if (stop) { stop(); stop = null; }
  const [k, arg] = location.hash.slice(1).split('/');
  const key = k || 'tonight';
  nav.setActive(navItems.some(([k2]) => k2 === key) ? key : key === 'report' ? 'reports' : 'more');
  scrollTo(0, 0);
  try {
    if (key === 'tables') { stop = every(10000, () => tables().catch(fail)); return; }
    if (key === 'staff') { app.innerHTML = `${back()}<div id="sv"></div>`; bindBack(); return await staffView($('#sv'), user); }
    if (key === 'reports') { app.innerHTML = `<div id="rv"></div>`; return await eodListView($('#rv'), { canSignOff: director }); }
    if (key === 'report' && arg) { app.innerHTML = `${back('Reports', 'reports')}<div id="rv"></div>`; bindBack(); return await eodView($('#rv'), arg, { canSignOff: director }); }
    if (key === 'close') { app.innerHTML = `${back()}<div id="cv"></div>`; bindBack(); return await closingView($('#cv'), undefined, { canClose: true }); }
    if (key === 'approvals') { app.innerHTML = `${back()}<div id="av"></div>`; bindBack(); return await approvalsView($('#av')); }
    if (key === 'sales') { app.innerHTML = `${back()}<div id="sv"></div>`; bindBack(); return await salesView($('#sv')); }
    if (key === 'prices') { app.innerHTML = `${back()}<div id="pv"></div>`; bindBack(); return await productsView($('#pv')); }
    if (key === 'stock') { app.innerHTML = `${back()}<div id="kv"></div>`; bindBack(); return await stockAdminView($('#kv'), undefined, undefined, { role: user.role }); }
    if (key === 'money') { app.innerHTML = `${director ? '' : back()}<div id="mv"></div>`; bindBack(); return await moneyView($('#mv')); }
    stop = every(10000, () => tonight().catch(fail));
  } catch (e) { fail(e); }
}
addEventListener('hashchange', route);

// ── Tonight: the money, what needs you, close ──
async function tonight() {
  const [s, a, t, ex] = await Promise.all([sapi('/api/ops/sales'), sapi('/api/ops/approvals'), sapi('/api/ops/tabs?all=1'), sapi('/api/ops/stock/to-explain').catch(() => ({ counts: [] }))]);
  const x = s.totals, waiting = a.approvals.filter(p => p.canDecide), toExplain = ex.counts || [];
  const open = t.tabs.filter(tb => tb.status === 'open');
  const closed = s.night.status === 'closed';
  nav.setDot('tonight', waiting.length + toExplain.length);
  app.innerHTML = `<div class="pos">
    <p class="kicker">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Accra' }))}${closed ? ' · closed' : ''}</p>
    <div class="pos-money">
      <div class="big-line"><span>Expected</span><b>${money(x.salesPesewas)}</b></div>
      <div class="big-line good"><span>Received</span><b>${money(x.paidPesewas)}</b></div>
      <div class="big-line ${x.owedPesewas ? 'bad' : ''}"><span>Still owed</span><b>${money(x.owedPesewas)}</b></div>
      <p class="how">Cash ${money(x.cashPesewas)} · MoMo ${money((x.momoPesewas || 0))} · Paid on phone ${money(x.digitalPesewas)}</p>
    </div>
    <div id="msg"></div>
    ${toExplain.length ? `<section class="pos-need"><h2>Stock to explain <span class="count">${toExplain.length}</span></h2>
      ${toExplain.map((c, i) => `<div class="need"><div><b>${esc(c.stationName)}: the bar found a different number</b><span>${c.differences.map(d => `${esc(d.name)} ${Math.abs(d.difference)} ${d.difference < 0 ? 'fewer' : 'more'}`).join(' · ')}</span><small>${esc(c.byName)} counted when the bar opened · ${esc(c.date)}</small></div>
        <div class="need-btns"><button class="mid" data-explain="${i}">Explain</button></div></div>`).join('')}</section>` : ''}
    ${waiting.length ? `<section class="pos-need"><h2>Needs you <span class="count">${waiting.length}</span></h2>
      ${waiting.map(p => `<div class="need"><div><b>${esc(p.label)}</b><span>${esc(p.summary)}</span><small>${esc(p.requestedByName)} · “${esc(p.reason)}”</small></div>
        <div class="need-btns"><button class="mid okc" data-yes="${esc(p.id)}" aria-label="Approve">✓</button><button class="mid" data-no="${esc(p.id)}" aria-label="Refuse">✗</button></div></div>`).join('')}</section>` : ''}
    <section><div class="pos-head"><h2>Tables</h2><span class="muted">${open.length} open</span></div>
      <div class="pos-tables">${open.slice(0, 8).map(tableRow).join('') || '<p class="muted">No open tables.</p>'}</div>
      ${open.length > 8 ? `<button class="link" data-goto="tables">See all ${open.length} tables →</button>` : ''}</section>
    <button class="big ghost" id="addExp">Add an expense</button>
    ${closed ? `<div class="say good"><b>The night is closed</b>The report is under ${director ? 'Reports' : 'More → Past nights'}.</div>` : '<button class="big" id="toClose">Close the night</button>'}
  </div>`;
  bindRows();
  $('#toClose') && ($('#toClose').onclick = () => { location.hash = 'close'; });
  $$('[data-explain]', app).forEach(b => b.onclick = () => explainSheet(toExplain[Number(b.dataset.explain)], () => { say($('#msg'), 'Explanation saved. Finance can see it.'); tonight().catch(fail); }));
  $('#addExp').onclick = async () => { const m = await sapi('/api/ops/money?period=today').catch(() => null); expenseSheet(m, () => say($('#msg'), 'Expense saved.')); };
  $$('[data-goto]', app).forEach(b => b.onclick = () => { location.hash = b.dataset.goto; });
  const decide = async (id, approve) => {
    const note = approve ? '' : prompt('Why refuse? (optional)') ?? null; if (note === null) return;
    try { await sapi('/api/ops/approvals/decide', { method: 'POST', body: { id, approve, note } }); say($('#msg'), approve ? 'Approved.' : 'Refused.'); tonight().catch(fail); }
    catch (e) { say($('#msg'), e.message, 'bad'); }
  };
  $$('[data-yes]', app).forEach(b => b.onclick = () => decide(b.dataset.yes, true));
  $$('[data-no]', app).forEach(b => b.onclick = () => decide(b.dataset.no, false));
}

// One table: where, who serves it, what it owes, paid or not.
const tableRow = tb => `<button type="button" class="pos-row" data-tab="${esc(tb.id)}">
  <span class="where">${esc(tb.table === 'Walk-in' ? 'Walk-in' : `Table ${tb.table}`)}<small>${esc(tb.label)} · ${esc(tb.waiterName.split(' ')[0])}${tb.customerName ? ` · ${esc(tb.customerName)}` : ''}</small></span>
  <span class="amt">${money(tb.bill.balancePesewas || tb.bill.totalPesewas)}${st(tb.payStatus, tb.bill.balancePesewas ? (tb.bill.paidPesewas ? 'part paid' : 'unpaid') : tb.bill.totalPesewas ? 'paid' : 'empty')}</span></button>`;
function bindRows() { $$('[data-tab]', app).forEach(b => b.onclick = () => tableSheet(b.dataset.tab)); }

async function tables() {
  const { tabs } = await sapi('/api/ops/tabs?all=1');
  const open = tabs.filter(t => t.status === 'open'), done = tabs.filter(t => t.status !== 'open');
  const owed = open.reduce((n, t) => n + t.bill.balancePesewas, 0);
  app.innerHTML = `<h1>Tables</h1><p class="lead">${open.length} open · ${money(owed)} still to pay</p>
    <div class="pos-tables">${open.map(tableRow).join('') || '<p class="muted">No open tables.</p>'}</div>
    ${done.length ? `<details class="fold"><summary>Finished tonight (${done.length})</summary><div class="pos-tables">${done.map(tableRow).join('')}</div></details>` : ''}`;
  bindRows();
}

// A table's bill: every drink, what was paid and how. Read-only: waiters and the cashier record payments.
async function tableSheet(id) {
  const { tab: t } = await sapi(`/api/ops/tab?id=${encodeURIComponent(id)}`);
  const b = t.bill;
  sheet(`<h2>${esc(t.table === 'Walk-in' ? 'Walk-in' : `Table ${t.table}`)} · ${esc(t.label)}</h2>
    <p class="muted" style="margin:0">${esc(t.waiterName)}${t.customerName ? ` · ${esc(t.customerName)}` : ''} · opened ${when(t.createdAt)}</p>
    <div class="lines-list">${b.lines.map(l => `<div class="ln"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.amountPesewas)}</span></div>`).join('') || '<div class="ln"><span class="muted">No drinks yet</span></div>'}
      ${b.discountPesewas ? `<div class="ln"><span>Discount</span><span>−${money(b.discountPesewas)}</span></div>` : ''}
      <div class="ln total"><span>Total</span><span>${money(b.totalPesewas)}</span></div>
      ${t.payments.map(p => `<div class="ln"><span>${esc(p.label)}${p.momoRef ? ` <small>(${esc(p.momoRef)})</small>` : ''} · ${when(p.at)}</span><span>${money(p.amountPesewas)}</span></div>`).join('')}
      <div class="ln total"><span>Still to pay</span><span>${money(b.balancePesewas)}</span></div></div>
    ${t.rounds.some(r => !['delivered', 'cancelled'].includes(r.status)) ? `<p class="muted" style="margin:0">${t.rounds.filter(r => !['delivered', 'cancelled'].includes(r.status)).map(r => esc(r.statusLabel)).join(' · ')}</p>` : ''}
    <button class="big ghost" data-close>Done</button>`, { label: 'Table' });
}

// ── More: everything else, only when asked for ──
function more() {
  const items = [
    ...(director ? [['tables', 'Tables', 'Open tables and what they owe']] : [['money', 'Money', 'Money in, money out, profit; expenses']]),
    ['sales', 'Tonight in detail', 'By waiter, by bar, by drink'],
    ['approvals', 'Approvals', 'Everything asked tonight'],
    ['prices', 'Drinks & prices', 'Add a drink, change a price'],
    ['stock', 'Stock', 'Deliveries, counts, differences'],
    ...(director ? [['staff', 'Staff', 'Add people, send PINs']] : [['reports', 'Past nights', 'End-of-day reports']]),
    ...(director ? [['@admin.html#overview', 'Ticket money', 'Tickets sold, payments, refunds'], ['@admin.html#members', 'Members & attendance', 'Who came in, by night']] : []),
    ...(user.role === 'superAdmin' ? [['@admin.html', 'Control room', 'Site, nights, settings']] : []),
  ];
  const { box, close } = sheet(`<h2>More</h2><div class="more-list">${items.map(([k, l, sub]) => `<button type="button" data-more="${esc(k)}"><b>${esc(l)}</b><span>${esc(sub)}</span></button>`).join('')}</div>
    <button class="big ghost" data-close>Close</button>`, { label: 'More' });
  $$('[data-more]', box).forEach(b => b.onclick = () => { close(); const k = b.dataset.more; if (k.startsWith('@')) location.href = k.slice(1); else location.hash = k; });
}

route();
