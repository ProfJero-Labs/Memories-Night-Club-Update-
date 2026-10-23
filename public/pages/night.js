// night.html: the manager's and directors' screen. Simple, like a till: tonight's money (expected,
// received, still owed, how it was paid), what needs them (approvals), the tables, and closing the
// night. Everything else is behind "More", shown only when tapped. The technical side (the site,
// nights, settings) is the administrator's, in the control room.
//   Manager:  Tonight · Tables · Customers · More (buying drinks, cash from the staff, money and
//             expenses, stock, drinks & prices, payments, commissions, members, past nights)
//   Director: Tonight · Money (their share, bills, budget, commissions) · To approve (every payment:
//             salaries, loans, bills, commissions, purchases; either director) · More (reports,
//             salaries, customer reviews, staff feedback, performance, tables, staff, members).
//             Nothing from the ticket side (tickets, refunds, pay in bits).
// Tonight also opens Payments tonight (every payment, tap for what was bought, who served, how it
// was paid) and Top customers.
// "Needs you" on Tonight: approvals, and stock differences the bar found when it opened (the
// manager explains them). The manager adds expenses from Tonight; the director sees Money.
import { $, $$, esc } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { bottomNav, sheet, say, st, every, money, when, ask, backBar, bindBackBar, upcomingBookings } from '../lib/ops-ui.js';
import { expensesView, nightsView, salesView, closingView, approvalsView, productsView, stockAdminView, eodListView, eodView, moneyView, expenseSheet, explainSheet, budgetView, paymentsView, commissionsView, toApproveView, purchasesView, cashReceiveView, feedbackInboxView } from '../lib/ops-views.js';
import { payView, reviewsView, perfView } from '../lib/people-views.js';
import { staffView } from '../lib/staff-view.js';

const user = await requireStaff(['manager', 'director', 'superAdmin']);
const director = user.role !== 'manager';
staffHeader(user, 'Tonight');
const app = $('#app');
const navItems = director ? [['tonight', 'Tonight'], ['money', 'Money'], ['approve', 'To approve'], ['more', 'More']] : [['tonight', 'Tonight'], ['tables', 'Tables'], ['customers', 'Customers'], ['more', 'More']];
// The directors see how many payments wait for them, wherever they are.
if (director) sapi('/api/ops/to-approve').then(d => nav.setDot('approve', d.items.length)).catch(() => {});
const nav = bottomNav(navItems, k => { if (k === 'more') more(); else location.hash = k; });
let stop = null;
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${esc(e.message)}</div><button class="big ghost" id="retry">Try again</button>`; $('#retry').onclick = route; };
const back = (label = '', to = 'tonight') => backBar('', to); // ← Back: where they came from (or the parent screen)
const bindBack = () => { bindBackBar(app); $$('[data-goto]:not(.back-btn)', app).forEach(b => b.onclick = () => { location.hash = b.dataset.goto; }); };

async function route() {
  if (stop) { stop(); stop = null; }
  const [k, arg] = location.hash.slice(1).split('/');
  const key = k || 'tonight';
  nav.setActive(navItems.some(([k2]) => k2 === key) ? key : key === 'report' ? 'reports' : 'more');
  scrollTo(0, 0);
  try {
    if (key === 'tables') { stop = every(10000, alive => tables(alive).catch(e => alive() && fail(e))); return; }
    if (key === 'staff') { app.innerHTML = `${back()}<div id="sv"></div>`; bindBack(); return await staffView($('#sv'), user); }
    if (key === 'reports') { app.innerHTML = `${back()}<div id="rv"></div>`; bindBack(); return await eodListView($('#rv'), { canSignOff: director }); }
    if (key === 'report' && arg) { app.innerHTML = '<div id="rv"></div>'; return await eodView($('#rv'), arg, { canSignOff: director }); }
    if (key === 'close') { app.innerHTML = `${back()}<div id="cv"></div>`; bindBack(); return await closingView($('#cv'), undefined, { canClose: !director || user.role === 'superAdmin' }); }
    if (key === 'approvals') { app.innerHTML = `${back()}<div id="av"></div>`; bindBack(); return await approvalsView($('#av')); }
    if (key === 'sales') { app.innerHTML = `${back()}<div id="sv"></div>`; bindBack(); return await salesView($('#sv')); }
    if (key === 'prices') { app.innerHTML = `${back()}<div id="pv"></div>`; bindBack(); return await productsView($('#pv'), { canEdit: user.role === 'superAdmin' }); }
    if (key === 'commissions') { app.innerHTML = `${back('Money', 'money')}<div id="cv2"></div>`; bindBack(); return await commissionsView($('#cv2')); }
    if (key === 'budget') { app.innerHTML = `${back('Money', 'money')}<div id="bv"></div>`; bindBack(); return await budgetView($('#bv')); }
    if (key === 'payments') { app.innerHTML = `${back()}<div id="yv"></div>`; bindBack(); return await paymentsView($('#yv'), { tab: key }); }
    if (key === 'customers') { app.innerHTML = `${director ? back() : ''}<div id="rv2"></div><div id="yv" style="margin-top:20px"></div>`; bindBack(); await reviewsView($('#rv2')).catch(() => {}); return await paymentsView($('#yv'), { tab: 'customers' }); }
    if (key === 'approve') { app.innerHTML = '<div id="tav"></div>'; return await toApproveView($('#tav'), { onCount: n => nav.setDot('approve', n) }); }
    if (key === 'salaries') { app.innerHTML = `${back('Money', 'money')}<div id="slv"></div>`; bindBack(); return await payView($('#slv'), arg); }
    if (key === 'reviews') { app.innerHTML = `${back()}<div id="rvv"></div>`; bindBack(); return await reviewsView($('#rvv')); }
    if (key === 'feedback') { app.innerHTML = `${back()}<div id="fbv"></div>`; bindBack(); return await feedbackInboxView($('#fbv')); }
    if (key === 'perf') { app.innerHTML = `${back()}<div id="pfv"></div>`; bindBack(); return await perfView($('#pfv'), arg); }
    if (key === 'purchases') { app.innerHTML = `${back()}<div id="puv"></div>`; bindBack(); return await purchasesView($('#puv')); }
    if (key === 'cash') { app.innerHTML = `${back()}<div id="crv"></div>`; bindBack(); return await cashReceiveView($('#crv')); }
    if (key === 'stock') { app.innerHTML = `${back()}<div id="kv"></div>`; bindBack(); return await stockAdminView($('#kv'), undefined, undefined, { role: user.role }); }
    if (key === 'expenses') { app.innerHTML = `${back()}<div id="exv"></div>`; bindBack(); return await expensesView($('#exv')); }
    if (key === 'nights') { app.innerHTML = `${back()}<div id="nv"></div>`; bindBack(); return await nightsView($('#nv')); }
    if (key === 'money') { app.innerHTML = `${director ? '' : back()}<div id="mv"></div>`; bindBack(); return await moneyView($('#mv')); }
    stop = every(10000, alive => tonight(alive).catch(e => alive() && fail(e)));
  } catch (e) { fail(e); }
}
addEventListener('hashchange', route);

// ── Tonight: the money, what needs you, close ──
// Tonight redraws itself (every 10 seconds, and after each action), so a confirmation is kept for a
// few seconds and shown again after each redraw instead of vanishing with it.
let flash = null;
const flashNote = (text, kind = 'good') => { flash = { text, kind, at: Date.now() }; say($('#msg'), text, kind); };
const note = flashNote;
async function tonight(alive = () => location.hash.slice(1).split('/')[0] in { '': 1, tonight: 1 }) {
  const [s, a, t, ex, m, ta] = await Promise.all([sapi('/api/ops/sales'), sapi('/api/ops/approvals'), sapi('/api/ops/tabs?all=1'), sapi('/api/ops/stock/to-explain').catch(() => ({ counts: [] })),
    director ? sapi('/api/ops/money?period=today').catch(() => null) : null, director ? sapi('/api/ops/to-approve').catch(() => null) : null]);
  if (!alive()) return;
  const x = s.totals, waiting = a.approvals.filter(p => p.canDecide), toExplain = ex.counts || [];
  const open = t.tabs.filter(tb => tb.status === 'open');
  const closed = s.night.status === 'closed';
  const toPay = ta?.items?.length || 0;
  nav.setDot('tonight', waiting.length + toExplain.length);
  // Glanceable: the director sees their own share first; the Manager sees the money received.
  const top = director && m?.myShare
    ? `<div class="hero ${m.myShare.profitPesewas >= 0 ? 'good' : 'bad'}"><span>Your share tonight (${m.myShare.pct}%)</span><b>${m.myShare.profitPesewas < 0 ? '−' : ''}${money(Math.abs(m.myShare.profitPesewas))}</b></div>
       <div class="hero-row"><div class="hero good"><span>Received</span><b>${money(x.paidPesewas)}</b></div><div class="hero ${x.owedPesewas ? 'bad' : ''}"><span>Still owed</span><b>${money(x.owedPesewas)}</b></div></div>`
    : `<div class="hero good"><span>Received tonight</span><b>${money(x.paidPesewas)}</b></div>
       <div class="hero-row"><div class="hero"><span>Sold</span><b>${money(x.salesPesewas)}</b></div><div class="hero ${x.owedPesewas ? 'bad' : ''}"><span>Still owed</span><b>${money(x.owedPesewas)}</b></div></div>`;
  app.innerHTML = `<div class="pos">
    <p class="kicker">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Accra' }))}${closed ? ' · closed' : ''}</p>
    ${top}
    <p class="muted" style="margin:0">Cash ${money(x.cashPesewas)} · MoMo ${money((x.momoPesewas || 0))} · Paid on phone ${money(x.digitalPesewas)}</p>
    <div id="msg"></div>
    ${director && toPay ? `<button class="big red" data-goto="approve">${toPay} payment${toPay > 1 ? 's' : ''} to approve</button>` : ''}
    ${toExplain.length ? `<section class="pos-need"><h2>Stock to explain <span class="count">${toExplain.length}</span></h2>
      ${toExplain.map((c, i) => `<div class="need"><div><b>${esc(c.stationName)}: the bar found a different number</b><span>${c.differences.map(d => `${esc(d.name)} ${Math.abs(d.difference)} ${d.difference < 0 ? 'fewer' : 'more'}`).join(' · ')}</span><small>${esc(c.byName)} counted when the bar opened · ${esc(c.date)}</small></div>
        <div class="need-btns"><button class="mid" data-explain="${i}">Explain</button></div></div>`).join('')}</section>` : ''}
    ${waiting.length ? `<section class="pos-need"><h2>Needs you <span class="count">${waiting.length}</span></h2>
      ${waiting.map(p => `<div class="need"><div><b>${esc(p.label)}</b><span>${esc(p.summary)}</span><small>${esc(p.requestedByName)} · “${esc(p.reason)}”</small></div>
        <div class="need-btns"><button class="mid okc" data-yes="${esc(p.id)}" aria-label="Approve">✓</button><button class="mid" data-no="${esc(p.id)}" aria-label="Refuse">✗</button></div></div>`).join('')}</section>` : ''}
    ${closed ? `<div class="say good"><b>The night is closed</b>The report is under ${director ? 'More → End-of-day reports' : 'More → Past nights'}.</div>` : director ? '' : '<button class="big" id="toClose">Close the night</button>'}
    <div class="rows">
      <button type="button" class="row-btn" data-goto="payments"><span class="t">Payments tonight</span><span class="s">Every payment: what, who served, how it was paid</span><span class="r"></span></button>
      <button type="button" class="row-btn" data-goto="customers"><span class="t">${director ? 'Customers' : 'Top customers'}</span><span class="s">Who spent the most; reviews</span><span class="r"></span></button>
      ${director ? '' : '<button type="button" class="row-btn" data-goto="cash"><span class="t">Cash from the staff</span><span class="s">Receive each person’s counted cash</span><span class="r"></span></button><button type="button" class="row-btn" data-goto="purchases"><span class="t">Buying drinks</span><span class="s">Ask for what to buy</span><span class="r"></span></button>'}
      ${!director || !closed ? '' : ''}
    </div>
    <section><div class="pos-head"><h2>Tables</h2><span class="muted">${open.length} open</span></div>
      <div class="pos-tables">${open.slice(0, 5).map(tableRow).join('') || '<p class="muted">No open tables.</p>'}</div>
      ${open.length > 5 ? `<button class="link" data-goto="tables">See all ${open.length} tables →</button>` : ''}</section>
    ${director ? (closed ? '' : '<button class="big ghost" id="toClose">How closing is going</button>') : '<button class="big ghost" id="addExp">Add an expense</button>'}
  </div>`;
  bindRows();
  if (flash && Date.now() - flash.at < 8000) say($('#msg'), flash.text, flash.kind);
  $('#toClose') && ($('#toClose').onclick = () => { location.hash = 'close'; });
  $$('[data-explain]', app).forEach(b => b.onclick = () => explainSheet(toExplain[Number(b.dataset.explain)], () => { note('Explanation saved. Finance can see it.'); tonight().catch(fail); }));
  $('#addExp') && ($('#addExp').onclick = async () => { const m = await sapi('/api/ops/money?period=today').catch(() => null); expenseSheet(m, r => note(r?.needsApproval ? 'Saved. It’s above the limit, so it waits for a director.' : 'Expense saved.')); });
  $$('[data-goto]:not(.back-btn)', app).forEach(b => b.onclick = () => { location.hash = b.dataset.goto; });
  const decide = async (id, approve) => {
    const note = approve ? '' : await ask({ title: 'Refuse this?', label: 'Why? (optional)', quick: ['Not tonight', 'Too much', 'Ask me first', 'Wrong table'], send: 'Refuse', required: false, danger: true }); if (note === null) return;
    try { await sapi('/api/ops/approvals/decide', { method: 'POST', body: { id, approve, note } }); flashNote(approve ? 'Approved.' : 'Refused.'); tonight().catch(fail); }
    catch (e) { flashNote(e.message, 'bad'); }
  };
  $$('[data-yes]', app).forEach(b => b.onclick = () => decide(b.dataset.yes, true));
  $$('[data-no]', app).forEach(b => b.onclick = () => decide(b.dataset.no, false));
}

// One table: where, who serves it, what it owes, paid or not.
const tableRow = tb => `<button type="button" class="pos-row" data-tab="${esc(tb.id)}">
  <span class="where">${esc(tb.table === 'Walk-in' ? 'Walk-in' : `Table ${tb.table}`)}<small>${esc(tb.label)} · ${esc(tb.waiterName.split(' ')[0])}${tb.customerName ? ` · ${esc(tb.customerName)}` : ''}</small></span>
  <span class="amt">${money(tb.bill.balancePesewas || tb.bill.totalPesewas)}${st(tb.payStatus, tb.bill.balancePesewas ? (tb.bill.paidPesewas ? 'part paid' : 'unpaid') : tb.bill.totalPesewas ? 'paid' : 'empty')}</span></button>`;
function bindRows() { $$('[data-tab]', app).forEach(b => b.onclick = () => tableSheet(b.dataset.tab)); }

async function tables(alive = () => true) {
  const [{ tabs }, booked] = await Promise.all([sapi('/api/ops/tabs?all=1'), sapi('/api/ops/tables').catch(() => ({ tables: [], upcoming: [] }))]);
  if (!alive()) return;
  const open = tabs.filter(t => t.status === 'open'), done = tabs.filter(t => t.status !== 'open');
  const owed = open.reduce((n, t) => n + t.bill.balancePesewas, 0);
  app.innerHTML = `${director ? back() : ''}<h1>Tables</h1><p class="lead">${open.length} open · ${money(owed)} still to pay</p>
    <div class="pos-tables">${open.map(tableRow).join('') || '<p class="muted">No open tables.</p>'}</div>
    ${done.length ? `<details class="fold"><summary>Finished tonight (${done.length})</summary><div class="pos-tables">${done.map(tableRow).join('')}</div></details>` : ''}
    <h2>Booked tables</h2>
    ${booked.tables.length ? `<div class="group-h">Tonight · ${booked.tables.length} booked, ${booked.tables.filter(t => t.arrived).length} here</div><div class="rows">${booked.tables.map(t => `<div class="row-btn plain"><span class="t">${esc(t.name)} · ${esc(t.packageName)}</span><span class="s">${esc(t.code)} · phone …${esc(t.phoneLast4)} · ${t.arrived ? `arrived${t.tableNumber ? `, table ${esc(t.tableNumber)}` : ''}` : 'not here yet'}</span></div>`).join('')}</div>` : '<p class="muted" style="margin:0">No tables booked for tonight.</p>'}
    <details class="fold" ${booked.upcoming.length ? 'open' : ''}><summary>Coming nights (${booked.upcoming.length})</summary>${upcomingBookings(booked.upcoming)}</details>`;
  bindRows();
  bindBack();
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
  // Grouped, so each thing is quick to find (no scrolling through one long list).
  const groups = director ? [
    ['Money', [['salaries', 'Salaries and loans', 'What staff are paid'], ['budget', 'Bills and budget', 'What’s due this month'], ['commissions', 'Commissions', '10% on tables over GHS 3,000'], ['reports', 'End-of-day reports', 'Each night, signed off'], ['sales', 'Tonight in detail', 'By waiter, by bar, by drink']]],
    ['People', [['staff', 'Staff', 'Add people, send PINs'], ['feedback', 'Staff feedback', 'Complaints and ideas'], ['perf', 'Performance reviews', 'Each staff member, every month'], ['@admin.html#members', 'Members', 'Members and passes']]],
    ['Floor', [['tables', 'Tables', 'Open tables and what they owe'], ['reviews', 'Customer reviews', 'What customers say'], ...(user.role === 'superAdmin' ? [['@admin.html', 'Control room', 'Site, nights, settings']] : [])]],
  ] : [
    ['Tonight', [['payments', 'Payments tonight', 'Every payment, with details'], ['cash', 'Cash from the staff', 'Receive each person’s counted cash'], ['approvals', 'Approvals', 'Everything asked tonight'], ['sales', 'Tonight in detail', 'By waiter, by bar, by drink']]],
    ['Stock and money', [['expenses', 'Expenses', 'What was spent; add one'], ['purchases', 'Buying drinks', 'Ask; finance and a director approve'], ['stock', 'Stock', 'New stock, counts, differences'], ['money', 'Money', 'In, out, profit'], ['prices', 'Drinks & prices', 'Set by finance'], ['commissions', 'Commissions', 'Who brought the big tables']]],
    ['Records', [['nights', 'Nights coming up', 'Tickets sold, tables booked'], ['reports', 'Past nights', 'End-of-day reports'], ['@admin.html#members', 'Members', 'Members and passes']]],
  ];
  const { box, close } = sheet(`<h2>More</h2>${groups.map(([g, items]) => `<p class="group-h">${esc(g)}</p><div class="more-list">${items.map(([k, l, sub]) => `<button type="button" data-more="${esc(k)}"><b>${esc(l)}</b><span>${esc(sub)}</span></button>`).join('')}</div>`).join('')}`, { label: 'More', full: true });
  $$('[data-more]', box).forEach(b => b.onclick = () => { close(); const k = b.dataset.more; if (k.startsWith('@')) location.href = k.slice(1); else location.hash = k; });
}

route();
