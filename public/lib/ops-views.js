// Views shared by the manager and director (night.html) and the finance officer (finance.html):
// Money (in, out, profit; expenses) · Today's sales · Closing the night · Approvals · Products &
// prices · Stock & counts · Staff reports & cash · End-of-day reports · Who changed what. Each takes
// an element to draw into.
import { $, $$, esc } from '../app.js';
import { sapi } from '../staff.js';
import { sheet, say, st, busy, ghsIn, moneyField, money, when, dayName, ask } from './ops-ui.js';
// One-tap reasons for refusing a request or a payment (they can still type their own).
const REFUSE_QUICK = ['Wrong amount', 'Not in this month’s budget', 'Too expensive', 'Not needed now', 'Ask me first'];

// Phones: tables become labelled cards (CSS in admin.css), once per render.
export const labelTables = root => $$('table.tbl', root).forEach(t => {
  const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
  t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || ''); }));
});
const dateBar = (date, id = 'opsDate') => `<div class="toolbar" style="margin:0"><label for="${id}" class="muted" style="font-size:14px">Night of</label><input type="date" id="${id}" value="${esc(date || '')}" style="min-height:44px"></div>`;
const bindDate = (el, fn, id = 'opsDate') => { const i = $(`#${id}`, el); if (i) i.onchange = () => fn(i.value); };
const diffWord = (n, unit = '') => (n < 0 ? `${Math.abs(n)}${unit} fewer than expected` : `${n}${unit} more than expected`);
const cashWord = n => `${money(Math.abs(n))} ${n < 0 ? 'less' : 'more'} than expected`;

// ── Today's sales ──
// The three numbers that matter, big; everything else under "See details"; a spreadsheet to keep.
const signed = n => `${n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const lineRow = (label, value, sub = '') => `<div class="ln"><span>${label}${sub ? `<br><small>${sub}</small>` : ''}</span><span style="white-space:nowrap">${value}</span></div>`;
const linesOr = (html, empty) => html || `<p class="muted" style="margin:0">${esc(empty)}</p>`;
// A CSV the phone saves (opens in Excel / Google Sheets). rows: [[cell, …], …]
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cedis = p => (Number(p || 0) / 100).toFixed(2);
function saveCsv(name, rows) {
  const blob = new Blob([`﻿${rows.map(r => r.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export async function salesView(el, date) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/sales${date ? `?date=${date}` : ''}`), t = d.totals;
  const tips = d.tips?.totalPesewas ? d.tips : null, momo = d.momoPayments || [];
  el.innerHTML = `<div class="vstack" style="display:grid;gap:14px"><h1>Today’s sales</h1>
    <p class="lead">${esc(dayName(d.date))} · ${d.night.status === 'closed' ? `closed by ${esc(d.night.closedByName || '')}` : 'still open'}</p>
    <div class="hero-stack"><div class="hero"><span>Sales</span><b>${money(t.salesPesewas)}</b></div>
    <div class="hero-row">
      <div class="hero good"><span>Money received</span><b>${money(t.paidPesewas)}</b></div>
      <div class="hero ${t.owedPesewas ? 'bad' : ''}"><span>Still owed${t.unpaidTabs ? ` · ${t.unpaidTabs} bill${t.unpaidTabs > 1 ? 's' : ''}` : ''}</span><b>${money(t.owedPesewas)}</b></div>
    </div>
    <div class="hero-row"><div class="hero"><span>Cash</span><b>${money(t.cashPesewas)}</b></div><div class="hero"><span>MoMo / card</span><b>${money(t.digitalPesewas + (t.momoPesewas || 0))}</b></div></div></div>
    <p class="muted" style="margin:0">A sale is a drink on a bill. Money received is what has actually been paid.</p>
    <details class="fold"><summary>See details</summary>
      <h3 class="group-h">How it was paid</h3><div class="lines-list">
        ${d.byMethod.map(m => lineRow(esc(m.method), money(m.amountPesewas))).join('')}</div>
      ${d.unpaid.length ? `<h3 class="group-h">Unpaid bills</h3><div class="lines-list">${d.unpaid.map(u => lineRow(`Tab ${u.number}`, money(u.balancePesewas), `${esc(u.table)} · ${esc(u.waiterName)}`)).join('')}</div>` : ''}
      <h3 class="group-h">By waiter</h3>${linesOr(d.byWaiter.length ? `<div class="lines-list">${d.byWaiter.map(w => lineRow(`<b>${esc(w.name)}</b>`, money(w.salesPesewas), `${w.tabs} tab${w.tabs === 1 ? '' : 's'} · paid ${money(w.paidPesewas)}${w.unpaidPesewas ? ` · <b class="diff-neg">unpaid ${money(w.unpaidPesewas)}</b>` : ''} · report ${w.report === 'submitted' ? 'in' : '<b class="diff-pos">not yet</b>'}`)).join('')}</div>` : '', 'No waiter tabs yet.')}
      <h3 class="group-h">By bar</h3>${linesOr(d.byStation.length ? `<div class="lines-list">${d.byStation.map(s => lineRow(esc(s.name), money(s.salesPesewas), `${s.orders} order${s.orders === 1 ? '' : 's'} · paid ${money(s.paidPesewas)}`)).join('')}</div>` : '', 'Nothing yet.')}
      <h3 class="group-h">By drink</h3>${linesOr(d.byProduct.length ? `<div class="lines-list">${d.byProduct.map(p => lineRow(esc(p.name), money(p.valuePesewas), `${p.qty} sold`)).join('')}</div>` : '', 'Nothing yet.')}
      <h3 class="group-h">Given away and taken back</h3><div class="lines-list">
        ${lineRow(`Free drinks (${t.freeDrinksQty})`, money(t.freeDrinksPesewas))}${lineRow('Discounts', money(t.discountsPesewas))}${lineRow('Refunds', money(t.refundsPesewas))}${lineRow('Cancelled orders', t.cancelledOrders)}${lineRow('Open tabs', t.openTabs)}</div>
      ${tips ? `<h3 class="group-h">Tips for staff</h3><p class="muted" style="margin:0">Not sales and not the club’s money. MoMo on the statement = MoMo sales + MoMo tips (one MoMo can carry both).</p>
        <div class="lines-list">${lineRow(`Tips tonight (${tips.count})`, money(tips.totalPesewas))}${lineRow('MoMo / card tips', money(tips.momoPesewas + tips.digitalPesewas))}${lineRow('Cash tips (kept)', money(tips.cashPesewas))}
          ${tips.people.map(p => lineRow(esc(p.name), money(p.amountPesewas))).join('')}
          ${tips.momo.map(x => lineRow(`<b>${esc(x.momoRef)}</b>${x.tabNumber ? ` · Tab ${x.tabNumber}` : ''}`, money(x.amountPesewas), `Tip for ${esc(x.toName)} · ${esc(x.byName)} ${when(x.at)}`)).join('')}</div>` : ''}
      ${momo.length ? `<h3 class="group-h">MoMo to check on the statement</h3><div class="lines-list">${momo.map(m => lineRow(`<b>${esc(m.momoRef)}</b>`, money(m.amountPesewas), `Tab ${m.tabNumber} · from ${esc(m.momoFrom || '—')} · ${esc(m.byName)} ${when(m.at)}`)).join('')}</div>` : ''}
    </details>
    ${dateBar(d.date)}
    <button class="big ghost" id="slCsv">Download (spreadsheet)</button></div>`;
  bindDate(el, v => salesView(el, v));
  $('#slCsv', el).onclick = () => saveCsv(`sales-${d.date}.csv`, [
    ['Sales', d.date], [],
    ['Total', 'GHS'], ['Sales', cedis(t.salesPesewas)], ['Money received', cedis(t.paidPesewas)], ['Still owed', cedis(t.owedPesewas)],
    ['MoMo / card (confirmed)', cedis(t.digitalPesewas)], ['Cash (recorded)', cedis(t.cashPesewas)], ['Free drinks', cedis(t.freeDrinksPesewas)], ['Discounts', cedis(t.discountsPesewas)], ['Refunds', cedis(t.refundsPesewas)], [],
    ['Waiter', 'Tabs', 'Sales GHS', 'Paid GHS', 'Unpaid GHS', 'Report'], ...d.byWaiter.map(w => [w.name, w.tabs, cedis(w.salesPesewas), cedis(w.paidPesewas), cedis(w.unpaidPesewas), w.report === 'submitted' ? 'In' : 'Not yet']), [],
    ['Drink', 'Sold', 'Value GHS'], ...d.byProduct.map(p => [p.name, p.qty, cedis(p.valuePesewas)]), [],
    ['MoMo transaction ID', 'Tab', 'From', 'Recorded by', 'Time', 'Amount GHS'], ...momo.map(m => [m.momoRef, m.tabNumber, m.momoFrom || '', m.byName, when(m.at), cedis(m.amountPesewas)]),
    ...(tips?.momo.length ? [[], ['MoMo tip ID', 'Tab', 'For', 'Recorded by', 'Time', 'Tip GHS'], ...tips.momo.map(x => [x.momoRef, x.tabNumber || '', x.toName, x.byName, when(x.at), cedis(x.amountPesewas)])] : []),
  ]);
}

// ── Closing the night (manager) ──
export async function closingView(el, date, { canClose = false } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/closing${date ? `?date=${date}` : ''}`);
  const closed = d.night.status === 'closed';
  // The Manager closes the night; if they can't be there, whoever accepted the handover does.
  canClose = canClose && !!d.closer?.canClose;
  const h = d.closer?.handover;
  const who = closed ? '' : `<div class="say ${h && !h.acceptedByName ? 'warn' : 'good'}"><b>Who closes tonight</b>${h
    ? `${esc(h.byName)} can’t close: “${esc(h.note)}”. ${h.acceptedByName ? `<b>${esc(h.acceptedByName)}</b> is closing instead.` : 'Waiting for the Human manager or the Event manager to take it.'}`
    : 'The Manager.'}
    ${d.closer?.canHandOver ? '<br><button class="mid" id="clHand" style="margin-top:8px">I can’t close tonight</button>' : ''}${d.closer?.canAccept ? '<br><button class="mid okc" id="clAccept" style="margin-top:8px">I’ll close tonight</button>' : ''}</div>`;
  el.innerHTML = `<h1>Close the night</h1>${dateBar(d.date)}<p class="lead">${esc(dayName(d.date))}. You can close at any time; what isn’t done yet is listed in the report.</p>${who}
    <div class="stepbar">${d.steps.map(s => `<div class="${s.done ? 'done' : ''}"><span><b>${esc(s.label)}</b><small>${esc(s.detail)}</small></span>${s.done ? st('paid', 'Done') : st('unpaid', 'Waiting')}</div>`).join('')}</div>
    <div id="clMsg"></div>
    ${closed ? `<div class="say good"><b>Closed: the report is with finance</b>Staff can keep working. Anything sold after this goes in the report if you close again.</div>` : ''}${canClose ? `<p class="muted" style="margin:0">This prepares the end-of-day report and sends it to finance. It doesn’t stop anyone working: you can close at any time, and close again later to update it.</p><button class="big" id="closeGo">${closed ? 'Close again and send the updated report' : 'Close the night and send the report'}</button>` : ''}
    <details class="fold"><summary>See the details: tabs, bar stock, cash</summary>
    <h2>1. Waiters</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waiter</th><th class="num">Sales</th><th class="num">Not delivered</th><th class="num">Owed / unpaid</th><th>Tabs</th></tr></thead><tbody>
      ${d.waiters.map(w => `<tr><td><strong>${esc(w.name)}</strong>${w.explanation ? `<br><small class="muted">“${esc(w.explanation)}”</small>` : ''}</td><td class="num">${money(w.salesPesewas)}</td><td class="num">${w.withYouQty ? `<span class="diff-neg">${w.withYouQty}</span>` : 0}</td><td class="num">${w.unpaidPesewas ? `<span class="diff-neg">${money(w.unpaidPesewas)}</span>` : money(0)}</td><td>${w.openTabs ? st('unpaid', `${w.openTabs} open`) : st('paid', 'All closed')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">No waiters worked tonight.</td></tr>'}</tbody></table></div>
    <h2>2. Bar stock</h2>${d.bars.map(b => `<div class="tcard ${!b.counted || b.differences.length ? 'warn' : 'done'}" style="cursor:default"><span class="row"><span class="t">${esc(b.name)}</span>${b.counted ? (b.reviewed ? st('paid', 'Reviewed') : st('ready', 'Counted')) : st('unpaid', 'Not counted')}</span>
      ${b.countedByName ? `<span class="sub">Counted by ${esc(b.countedByName)}</span>` : ''}
      ${b.differences.length ? `<span>${b.differences.map(x => `<b>${esc(x.name)}</b>: ${esc(diffWord(x.difference))}`).join('<br>')}</span>` : b.counted ? '<span class="sub">Everything matched.</span>' : ''}
      ${b.counted && !b.reviewed ? `<button class="mid" data-review="${esc(b.stationId)}">Mark reviewed</button>` : ''}</div>`).join('') || '<p class="muted">No bar activity tonight.</p>'}
    <h2>3. Cash</h2>${d.cash.map(c => `<div class="tcard ${c.differencePesewas ? 'warn' : 'done'}" style="cursor:default"><span class="row"><span class="t">${esc(c.name)}</span>${c.status === 'open' ? st('unpaid', 'Not counted') : c.status === 'reviewed' ? st('paid', 'Reviewed') : st('ready', 'Counted')}</span>
      <span class="sub">Should have ${money(c.expectedPesewas)}${c.countedPesewas != null ? ` · counted ${money(c.countedPesewas)}` : ''}</span>
      ${c.differencePesewas ? `<span class="diff-neg">${esc(cashWord(c.differencePesewas))}</span><span class="sub">“${esc(c.explanation)}”</span>` : ''}
      ${c.receivedAt ? `<span class="sub">Received by ${esc(c.receivedByName)}</span>` : c.status !== 'open' ? '<span class="sub">Handed over: waiting to be received</span>' : ''}</div>`).join('') || '<p class="muted">Nobody took cash tonight.</p>'}
    <h2>4. Front office</h2>${d.frontOffice ? `<div class="say good"><b>Submitted by ${esc(d.frontOffice.name)}</b>${d.frontOffice.figures.ticketsChecked} tickets checked · ${d.frontOffice.figures.admitted} people in · ${d.frontOffice.figures.tablesArrived} of ${d.frontOffice.figures.tablesBooked} tables arrived · ${d.frontOffice.figures.openIssues} open issues${d.frontOffice.note ? `<br>“${esc(d.frontOffice.note)}”` : ''}</div>` : '<p class="muted">Not submitted yet.</p>'}
    <h2>5. Approvals</h2><p class="muted" style="margin:0">${d.pendingApprovals ? `${d.pendingApprovals} waiting: see Approvals.` : 'Nothing waiting.'}</p>
    </details>`;
  bindDate(el, v => closingView(el, v, { canClose: true })); labelTables(el);
  $('#clHand', el) && ($('#clHand', el).onclick = async () => {
    const note = await ask({ title: 'I can’t close tonight', label: 'Why? The Human manager and the Event manager are texted.', quick: ['I’m not well', 'Family emergency', 'I’m travelling', 'I’m at another venue'], send: 'Hand it over' }); if (!note) return;
    try { await sapi('/api/ops/close-night/hand-over', { method: 'POST', body: { date: d.date, note } }); await closingView(el, d.date, { canClose: true }); say($('#clMsg', el), 'Handed over. The Human manager and the Event manager have been texted.'); }
    catch (e) { say($('#clMsg', el), e.message, 'bad'); }
  });
  $('#clAccept', el) && ($('#clAccept', el).onclick = async () => {
    try { await sapi('/api/ops/close-night/accept', { method: 'POST', body: { date: d.date } }); await closingView(el, d.date, { canClose: true }); say($('#clMsg', el), 'You’re closing tonight.'); }
    catch (e) { say($('#clMsg', el), e.message, 'bad'); }
  });
  $$('[data-review]', el).forEach(b => b.onclick = async () => { try { await sapi('/api/ops/stock/review', { method: 'POST', body: { stationId: b.dataset.review, date: d.date } }); closingView(el, d.date, { canClose }); } catch (e) { say($('#clMsg', el), e.message, 'bad'); } });
  $$('[data-cash]', el).forEach(b => b.onclick = async () => { try { await sapi('/api/ops/cash/review', { method: 'POST', body: { id: b.dataset.cash } }); closingView(el, d.date, { canClose }); } catch (e) { say($('#clMsg', el), e.message, 'bad'); } });
  // Close: the Worker says if it's early or if steps are missing; the manager decides to go ahead.
  $('#closeGo', el) && ($('#closeGo', el).onclick = async () => {
    const btn = $('#closeGo', el); let extra = {};
    for (let i = 0; i < 3; i++) {
      try {
        const r = await busy(btn, () => sapi('/api/ops/close-night', { method: 'POST', body: { date: d.date, ...extra } }), 'Closing…');
        await closingView(el, d.date, { canClose });
        return say($('#clMsg', el), r.note, r.sent ? 'good' : 'warn', 'Night closed');
      } catch (e) {
        if (e.code === 'early' && confirm('The night isn’t over yet (it runs until 4AM). Close it anyway?')) { extra = { ...extra, confirmEarly: true }; continue; }
        if (e.code === 'incomplete' && confirm(`${e.message}\n\nClose anyway? What’s missing is listed in the end-of-day report.`)) { extra = { ...extra, closeAnyway: true }; continue; }
        return say($('#clMsg', el), e.message, 'bad');
      }
    }
  });
}

// ── Approvals ──
export async function approvalsView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { approvals } = await sapi('/api/ops/approvals');
  el.innerHTML = `<h1>Approvals</h1><p class="lead">Free drinks, discounts, unpaid bills, cash out and stock-count corrections. You can’t approve your own.</p><div id="apMsg"></div>
    <div class="cards">${approvals.map(a => `<div class="tcard warn" style="cursor:default"><span class="row"><span class="t" style="font-size:20px">${esc(a.label)}</span><span class="sub">${when(a.requestedAt)}</span></span>
      <span>${esc(a.summary)}</span><span class="sub">Asked by ${esc(a.requestedByName)} · “${esc(a.reason)}”</span>
      ${a.canDecide ? `<span class="btn-row"><button class="mid okc" data-yes="${esc(a.id)}">Approve</button><button class="mid" data-no="${esc(a.id)}">Refuse</button></span>` : '<span class="sub">Someone else must decide this one.</span>'}</div>`).join('') || '<div class="empty-box"><b>Nothing waiting</b></div>'}</div>`;
  const decide = async (id, approve) => { const note = approve ? '' : await ask({ title: 'Refuse this?', label: 'Why? (optional)', quick: REFUSE_QUICK, send: 'Refuse', required: false, danger: true }); if (note === null) return; try { await sapi('/api/ops/approvals/decide', { method: 'POST', body: { id, approve, note } }); approvalsView(el); } catch (e) { say($('#apMsg', el), e.message, 'bad'); } };
  $$('[data-yes]', el).forEach(b => b.onclick = () => decide(b.dataset.yes, true));
  $$('[data-no]', el).forEach(b => b.onclick = () => decide(b.dataset.no, false));
}

// ── Products & prices ──
// One line per drink: its price and cost. Tap one to change it (finance) or to read it.
const amber = s => `<b style="color:var(--mustard)">${s}</b>`;
export async function productsView(el, { canEdit = true } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { products, units } = await sapi('/api/ops/products');
  const noCost = products.filter(p => !p.costPesewas).length, offSale = products.filter(p => !p.available).length;
  let show = 'all', find = '';
  el.innerHTML = `<div class="vstack" style="display:grid;gap:14px"><h1>Drinks and prices</h1><p class="lead">${canEdit ? `Tap a drink to change its price or cost.${noCost ? ` ${amber(`${noCost} without a cost`)}: the profit on ${noCost > 1 ? 'them' : 'it'} can’t be worked out.` : ''}` : 'Finance sets the prices. Tap a drink for its details.'}</p>
    ${canEdit ? '<button class="big" id="pAdd">Add a drink</button>' : ''}<div id="pMsg"></div>
    <div class="quick" role="group" aria-label="Show">${[['all', `All (${products.length})`], ['nocost', `No cost (${noCost})`], ['off', `Off sale (${offSale})`]].map(([k, l]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${k === 'all'}">${l}</button>`).join('')}</div>
    ${products.length > 10 ? '<input type="search" class="searchbox" id="pFind" placeholder="Find a drink" aria-label="Find a drink" autocomplete="off">' : ''}
    <div id="pList"></div></div>`;
  const sub = p => `${money(p.pricePesewas)} · ${p.costPesewas ? `cost ${money(p.costPesewas)}` : amber('No cost yet')}${p.available ? '' : ' · <b>Off sale</b>'}`;
  const draw = () => {
    const q = find.trim().toLowerCase();
    const list = products.filter(p => (show === 'nocost' ? !p.costPesewas : show === 'off' ? !p.available : true) && (!q || `${p.name} ${p.category}`.toLowerCase().includes(q)));
    let cat = '';
    $('#pList', el).innerHTML = list.length ? `<div class="rows">${list.map(p => `${p.category !== cat ? `<h3 class="group-h">${esc(cat = p.category)}</h3>` : ''}<button type="button" class="row-btn" data-edit="${esc(p.id)}" style="${p.available ? '' : 'opacity:.6'}"><span class="t">${esc(p.name)}</span><span class="s">${sub(p)}</span><span class="r"></span></button>`).join('')}</div>`
      : `<div class="empty-box"><b>${products.length ? 'Nothing here' : 'No drinks yet'}</b>${products.length ? (show === 'nocost' ? 'Every drink has a cost. Good.' : show === 'off' ? 'Every drink is on sale.' : 'Try another name.') : canEdit ? 'Tap “Add a drink” to start the menu.' : 'Finance adds the drinks.'}</div>`;
    $$('[data-edit]', el).forEach(b => b.onclick = () => (canEdit ? form : details)(products.find(x => x.id === b.dataset.edit)));
  };
  $$('[data-show]', el).forEach(b => b.onclick = () => { show = b.dataset.show; $$('[data-show]', el).forEach(c => c.setAttribute('aria-pressed', String(c === b))); draw(); });
  $('#pFind', el) && ($('#pFind', el).oninput = e => { find = e.target.value; draw(); });
  const details = p => sheet(`<h2>${esc(p.name)}</h2><p class="muted" style="margin:0">${esc(p.category)} · sold by the ${esc(p.unit)} · ${p.available ? 'on sale' : 'off sale'}</p>
    <div class="lines-list">${lineRow('Selling price', money(p.pricePesewas))}${lineRow('Cost: what the club pays for one', p.costPesewas ? money(p.costPesewas) : amber('No cost yet'))}${lineRow('Made on one', p.costPesewas ? money(p.pricePesewas - p.costPesewas) : '—')}
      ${p.tracked === false ? lineRow('Counted at the bar', 'No') : `${lineRow('Buy more at or below', p.lowStock || '—')}${lineRow('Never hold more than', p.maxStock || '—')}`}</div>
    ${p.updatedByName ? `<p class="muted" style="margin:0">Last changed by ${esc(p.updatedByName)}.</p>` : ''}`, { label: p.name });
  const form = (p = null) => {
    const { box, close } = sheet(`<h2>${p ? `Change ${esc(p.name)}` : 'Add a drink'}</h2>
      <div class="sfield"><label for="pfN">Name</label><input id="pfN" maxlength="60" value="${esc(p?.name || '')}"></div>
      ${moneyField('pfP', 'Selling price (GHS)', p ? String(p.pricePesewas / 100) : '')}${moneyField('pfK', 'Cost price: what the club pays for one (GHS)', p?.costPesewas ? String(p.costPesewas / 100) : '', 'So the director sees the profit. A bill already sent keeps its price.')}
      <label class="check"><input type="checkbox" id="pfA" ${p?.available === false ? '' : 'checked'}> On sale tonight</label>
      <details class="fold" ${p ? '' : 'open'}><summary>Group, unit and stock limits</summary>
        <div class="sfield"><label for="pfC">Group (e.g. Beer, Spirits, Soft)</label><input id="pfC" maxlength="30" value="${esc(p?.category || '')}"></div>
        <div class="sfield"><label for="pfU">Sold by the</label><select id="pfU">${units.map(u => `<option ${u === (p?.unit || 'bottle') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <label class="check"><input type="checkbox" id="pfT" ${p?.tracked === false ? '' : 'checked'}> Count it at the bar (bottles and cans)</label>
        <div class="sfield"><label for="pfL">Minimum stock: buy more at or below (optional)</label><input id="pfL" inputmode="numeric" pattern="[0-9]*" value="${esc(p?.lowStock || '')}"></div>
        <div class="sfield"><label for="pfX">Maximum stock: never hold more than (optional)</label><input id="pfX" inputmode="numeric" pattern="[0-9]*" value="${esc(p?.maxStock || '')}"></div>
      </details>
      ${p?.updatedByName ? `<p class="muted" style="margin:0">Last changed by ${esc(p.updatedByName)}. Every change is recorded.</p>` : ''}
      <div id="pfM"></div><div class="sheet-dock"><button class="big" id="pfGo">Save</button></div>`, { label: p ? `Change ${p.name}` : 'Add a drink' });
    $('#pfGo', box).onclick = async () => {
      const price = ghsIn($('#pfP', box).value), cost = $('#pfK', box).value !== '' ? ghsIn($('#pfK', box).value) : '';
      if (p && price !== p.pricePesewas && !confirm(`Change the price of ${p.name} from ${money(p.pricePesewas)} to ${money(price)}? New orders will use it.`)) return;
      try { await busy($('#pfGo', box), () => sapi('/api/ops/products', { method: 'POST', body: { id: p?.id, name: $('#pfN', box).value, category: $('#pfC', box).value, unit: $('#pfU', box).value, pricePesewas: price, costPesewas: cost, lowStock: $('#pfL', box).value, maxStock: $('#pfX', box).value, tracked: $('#pfT', box).checked, available: $('#pfA', box).checked } })); close(); await productsView(el, { canEdit }); say($('#pMsg', el), 'Saved.'); }
      catch (e) { say($('#pfM', box), e.message, 'bad'); }
    };
  };
  $('#pAdd', el) && ($('#pAdd', el).onclick = () => form());
  draw();
}

// ── Stock & counts ──
// One line per drink: what should be in the bar and what was counted. Tap a drink for its ledger.
const plusMinus = n => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
export async function stockAdminView(el, date, stationId, { role = '' } = {}) {
  const buyer = ['finance', 'director', 'superAdmin'].includes(role), explainer = ['manager', 'director', 'superAdmin'].includes(role);
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { stations, products } = await sapi('/api/ops/products');
  const sid = stationId || stations[0]?.id;
  if (!sid) { el.innerHTML = '<div class="empty-box"><b>No bars yet</b>Add one under Setup → Bar orders.</div>'; return; }
  const [s, dl] = await Promise.all([sapi(`/api/ops/stock?stationId=${encodeURIComponent(sid)}${date ? `&date=${date}` : ''}`), sapi(`/api/ops/stock/deliveries?stationId=${encodeURIComponent(sid)}`).catch(() => ({ deliveries: [] }))]);
  const ok = t => `<b style="color:#6fcfae">${t}</b>`;
  const dlState = x => (x.status === 'removed' ? `<b class="diff-neg">Deleted by ${esc(x.removedByName)} ${when(x.removedAt)}: ${esc(x.removeReason)}</b>` : x.edits?.length ? `${amber(`Changed from ${x.edits[0].fromQty} by ${esc(x.edits.at(-1).byName)}: ${esc(x.edits.at(-1).reason)}`)}<br>${dlState0(x)}` : dlState0(x));
  const dlState0 = x => (x.status === 'pending' ? amber(x.byBar ? 'Waiting for finance or the manager' : 'Waiting for the bar to confirm') : x.status === 'rejected' ? '<b class="diff-neg">Didn’t arrive</b>' : x.purchase ? ok('Bought: in stock') : x.confirmedQty !== x.qty ? amber(`Bar counted ${x.confirmedQty}`) : ok('Confirmed by the bar'));
  const dlLine = x => `<div class="ln"><span><b${x.status === 'removed' ? ' style="text-decoration:line-through"' : ''}>${x.qty} × ${esc(x.productName)}</b>${x.totalCostPesewas != null ? ` · ${money(x.totalCostPesewas)}` : ''}<br><small>${esc(x.recordedByName)} ${when(x.recordedAt)}${x.supplier ? ` · ${esc(x.supplier)}${x.reference ? ` · ${esc(x.reference)}` : ''}` : ''}${x.confirmedByName ? ` · confirmed by ${esc(x.confirmedByName)} ${when(x.confirmedAt)}` : ''}${x.confirmNote ? ` · ${esc(x.confirmNote)}` : ''}</small><br>${dlState(x)}</span>
    <span>${x.canConfirm ? `<button class="sbtn" data-dl="${esc(x.id)}">Confirm ${x.qty}</button>` : ''}${x.canFix ? `<button class="sbtn ghost" data-fix="${esc(x.id)}">Fix</button>` : ''}</span></div>`;
  const pending = dl.deliveries.filter(x => x.status === 'pending'), done = dl.deliveries.filter(x => x.status !== 'pending');
  const oc = s.openingCount, needsExplain = oc && oc.differences.length && !oc.explanation;
  const odd = r => r.difference || r.low;
  const sub = r => [`Should be here ${r.expected}`, r.counted != null ? `counted ${r.counted}${r.difference ? ` <b class="${r.difference < 0 ? 'diff-neg' : 'diff-pos'}">(${plusMinus(r.difference)})</b>` : ' ✓'}` : '', r.low ? amber('low') : ''].filter(Boolean).join(' · ');
  const row = r => `<button type="button" class="row-btn" data-sk="${esc(r.productId)}"><span class="t">${esc(r.name)}</span><span class="s">${sub(r)}</span><span class="r">${r.counted ?? r.expected}</span></button>`;
  const look = s.rows.filter(odd), rest = s.rows.filter(r => !odd(r));
  let cat = '';
  const diffs = s.rows.filter(r => r.difference).length, lows = s.rows.filter(r => r.low).length;
  el.innerHTML = `<div class="vstack" style="display:grid;gap:14px"><h1>Stock</h1>
    ${stations.length > 1 ? `<div class="sfield"><label for="stSel">Bar</label><select id="stSel">${stations.map(x => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}
    <p class="lead">${stations.length > 1 ? '' : `${esc(s.station.name)} · `}${esc(dayName(s.date))} · ${s.closing ? `counted by ${esc(s.closing.byName)}${s.closing.reviewedByName ? `, reviewed by ${esc(s.closing.reviewedByName)}` : ''}` : 'not counted yet'}</p>
    <button class="big" id="rcv">${buyer ? 'Record drinks bought' : 'Add new stock'}</button><div id="stMsg"></div>
    ${needsExplain ? `<div class="say warn"><b>The bar found a difference when it opened</b>${oc.differences.map(x => `${esc(x.name)}: should be ${x.expected}, bar found ${x.counted} (${plusMinus(x.difference)})`).join('<br>')}
      <br>${explainer ? '<button class="mid" id="explain" style="margin-top:8px">Explain the difference</button>' : 'Waiting for the manager to explain.'}</div>` : ''}
    ${pending.length ? `<h3 class="group-h">New stock not confirmed yet</h3><div class="lines-list">${pending.map(dlLine).join('')}</div>` : ''}
    <p class="muted" style="margin:0">${s.rows.length} drink${s.rows.length === 1 ? '' : 's'}${diffs ? ` · <b class="diff-neg">${diffs} different</b>` : ''}${lows ? ` · ${amber(`${lows} low`)}` : ''}. Tap a drink for its details.</p>
    ${s.rows.length ? `<div class="rows">${look.length ? `<h3 class="group-h">Needs a look</h3>${look.map(row).join('')}` : ''}${rest.map(r => `${r.category !== cat ? `<h3 class="group-h">${esc(cat = r.category)}</h3>` : ''}${row(r)}`).join('')}</div>`
      : '<div class="empty-box"><b>No drinks counted at the bar</b>Drinks marked “Count it at the bar” appear here.</div>'}
    ${s.closing && s.closing.status !== 'reviewed' ? '<button class="mid" id="rev">Mark this count reviewed</button>' : ''}
    ${oc && !needsExplain ? `<details class="fold"><summary>Bar’s count when it opened</summary><p style="margin:0">${esc(oc.byName)}, ${when(oc.at)}: ${oc.differences.length ? oc.differences.map(x => `${esc(x.name)} should be ${x.expected}, bar found ${x.counted}`).map(x => x).join('; ') : 'everything matched.'}</p>${oc.explanation ? `<p style="margin:8px 0 0"><b>Manager:</b> ${esc(oc.explanation)} <small class="muted">${esc(oc.explainedByName)}</small></p>` : ''}</details>`
      : !oc ? '<p class="muted" style="margin:0">The bar hasn’t counted tonight’s stock yet. Sales go on; the count is compared when it comes in.</p>' : ''}
    ${done.length ? `<details class="fold"><summary>New stock, last 7 days (${done.length})</summary><div class="lines-list">${done.map(dlLine).join('')}</div></details>` : ''}
    <details class="fold"><summary>How “should be here” is worked out</summary><p style="margin:0">Opening + received + moved in + returned − handed out − broken − moved out. ${buyer ? 'Drinks you record as bought are in the bar’s stock straight away.' : 'New stock counts once the bar confirms it; finance sees it.'}</p></details>
    ${dateBar(s.date)}</div>`;
  const again = () => stockAdminView(el, s.date, sid, { role });
  bindDate(el, v => stockAdminView(el, v, sid, { role }));
  $('#stSel', el) && ($('#stSel', el).onchange = e => stockAdminView(el, s.date, e.target.value, { role }));
  $('#rev', el) && ($('#rev', el).onclick = async () => { try { await sapi('/api/ops/stock/review', { method: 'POST', body: { stationId: sid, date: s.date } }); again(); } catch (e) { say($('#stMsg', el), e.message, 'bad'); } });
  $('#explain', el) && ($('#explain', el).onclick = () => explainSheet({ ...oc, stationId: sid, stationName: s.station.name, date: s.date }, again));
  const confirmDl = (b, after) => async () => { try { await busy(b, () => sapi('/api/ops/stock/delivery', { method: 'POST', body: { id: b.dataset.dl, action: 'confirm' } })); after?.(); again(); } catch (e) { say($('#stMsg', el), e.message, 'bad'); } };
  $$('[data-dl]', el).forEach(b => b.onclick = confirmDl(b));
  const receive = (pid = '') => {
    const { box, close } = sheet(`<h2>${buyer ? 'Drinks bought' : 'New stock'}</h2><p class="muted" style="margin:0">${buyer ? 'It goes into the bar’s stock straight away.' : 'The bar confirms it when it arrives; only then does it count.'}</p><div class="sfield"><label for="rvP">Drink</label><select id="rvP">${products.filter(p => p.tracked).map(p => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="rvQ">How many</label><input id="rvQ" inputmode="numeric" pattern="[0-9]*" autocomplete="off"></div>
      ${moneyField('rvC', buyer ? 'Total paid (GHS)' : 'Total paid (GHS, if you know it)')}
      <div class="sfield"><label for="rvS">Supplier</label><input id="rvS" maxlength="80"></div>
      <div class="sfield"><label for="rvR">Receipt or invoice number</label><input id="rvR" maxlength="60"></div>
      <div class="sfield" ${stations.length > 1 ? '' : 'hidden'}><label for="rvB">Into which bar</label><select id="rvB">${stations.map(x => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div id="rvM"></div><div class="sheet-dock"><button class="big" id="rvGo">Save</button></div>`, { label: buyer ? 'Drinks bought' : 'New stock' });
    if (pid) setTimeout(() => $('#rvQ', box)?.focus(), 40);
    $('#rvGo', box).onclick = async () => { try { await busy($('#rvGo', box), () => sapi('/api/ops/stock/received', { method: 'POST', body: { productId: $('#rvP', box).value, stationId: $('#rvB', box).value, qty: Number($('#rvQ', box).value), supplier: $('#rvS', box).value, reference: $('#rvR', box).value, totalCostPesewas: $('#rvC', box).value ? ghsIn($('#rvC', box).value) : '' } })); close(); await again(); say($('#stMsg', el), buyer ? 'Saved. It’s in the bar’s stock.' : 'Saved. The bar confirms it when it arrives.'); } catch (e) { say($('#rvM', box), e.message, 'bad'); } };
  };
  $('#rcv', el).onclick = () => receive();
  $$('[data-sk]', el).forEach(b => b.onclick = () => {
    const r = s.rows.find(x => x.productId === b.dataset.sk), mine = dl.deliveries.filter(x => x.productId === r.productId || x.productName === r.name);
    const ledger = [['Opening', r.opening], ['Received', r.received], ['Moved in from another bar', r.transferIn], ['Returned to the bar', r.returns], ['Handed out (sold)', -r.issued], ['Broken or spilled', -r.waste], ['Moved out to another bar', -r.transferOut], ['Fixed by finance', r.corrections || 0]];
    const { box, close } = sheet(`<h2>${esc(r.name)}</h2><p class="muted" style="margin:0">${esc(s.station.name)} · ${esc(dayName(s.date))}${r.lowStock ? ` · buy more at ${r.lowStock}` : ''}</p>
      <div class="hero-row" style="margin-top:12px"><div class="hero"><span>Should be here</span><b>${r.expected}</b></div><div class="hero ${r.difference < 0 ? 'bad' : ''}"><span>Counted</span><b>${r.counted ?? '—'}</b></div></div>
      ${r.difference ? `<div class="say ${r.difference < 0 ? 'bad' : 'warn'}"><b>${esc(diffWord(r.difference))}</b>${esc(s.reasons[r.reason] || 'No reason given')}${r.note ? ` · ${esc(r.note)}` : ''}</div>` : r.counted != null ? '<div class="say good">The count matches.</div>' : ''}
      ${r.low ? `<div class="say warn"><b>Low</b>At or below ${r.lowStock}: time to buy more.</div>` : ''}
      <h3 class="group-h">Tonight</h3><div class="lines-list">${ledger.filter(([k, n]) => n || k === 'Opening').map(([k, n]) => lineRow(k, k === 'Opening' ? n : plusMinus(n))).join('')}
        ${r.comps ? lineRow('Of which free drinks', r.comps) : ''}<div class="ln total"><span>Should be here</span><span>${r.expected}</span></div></div>
      ${ledger.some(([k, n]) => !n && k !== 'Opening') ? `<p class="muted" style="margin:0">Nothing ${ledger.filter(([k, n]) => !n && k !== 'Opening').map(([k]) => k.toLowerCase().replace(/ \(sold\)/, '')).join(', ')}.</p>` : ''}
      ${mine.length ? `<h3 class="group-h">New stock, last 7 days</h3><div class="lines-list">${mine.map(dlLine).join('')}</div>` : ''}
      <div id="skM"></div>
      ${dl.canFix ? '<button class="mid" id="skSet">Set the number in the bar</button>' : ''}
      ${products.some(p => p.tracked && p.id === r.productId) ? `<div class="sheet-dock"><button class="big" id="skAdd">${buyer ? 'Record this drink bought' : 'Add new stock of this drink'}</button></div>` : ''}`, { label: r.name });
    $$('[data-dl]', box).forEach(x => x.onclick = confirmDl(x, close));
    $('#skAdd', box) && ($('#skAdd', box).onclick = () => { close(); setTimeout(() => receive(r.productId), 60); });
    $$('[data-fix]', box).forEach(x => x.onclick = () => { close(); setTimeout(() => fixEntry(x.dataset.fix), 60); });
    $('#skSet', box) && ($('#skSet', box).onclick = () => { close(); setTimeout(() => setLevel(r), 60); });
  });
  // Finance fixes a mistake: change the number (or what was paid), or delete an entry made twice.
  const fixEntry = did => {
    const x = dl.deliveries.find(d => d.id === did); if (!x) return;
    const n = x.status === 'confirmed' ? x.confirmedQty ?? x.qty : x.qty;
    const { box, close } = sheet(`<h2>Fix: ${n} × ${esc(x.productName)}</h2><p class="muted" style="margin:0">${esc(x.recordedByName)} ${when(x.recordedAt)}. The bar’s stock is put right, and the change is kept with your name and reason.</p>
      <div class="sfield"><label for="fxQ">The right number</label><input id="fxQ" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(n)}"></div>
      ${moneyField('fxC', 'Total paid (GHS)', x.totalCostPesewas != null ? String(x.totalCostPesewas / 100) : '')}
      <div class="sfield"><label for="fxR">Why</label><input id="fxR" maxlength="200" placeholder="e.g. entered twice, typed 240 not 24"></div>
      <div id="fxM"></div><div class="sheet-dock" style="display:grid;gap:8px"><button class="big" id="fxGo">Save the change</button><button class="mid red" id="fxDel">Delete this entry</button></div>`, { label: 'Fix stock entry' });
    const go = async (btn, body, msg) => { try { await busy(btn, () => sapi('/api/ops/stock/fix', { method: 'POST', body: { id: did, reason: $('#fxR', box).value, ...body } })); close(); await again(); say($('#stMsg', el), msg, 'good'); } catch (e) { say($('#fxM', box), e.message, 'bad'); } };
    $('#fxGo', box).onclick = () => go($('#fxGo', box), { qty: Number($('#fxQ', box).value), totalCostPesewas: $('#fxC', box).value ? ghsIn($('#fxC', box).value) : '' }, 'Changed. The bar’s stock is put right.');
    $('#fxDel', box).onclick = () => go($('#fxDel', box), { action: 'remove' }, 'Deleted. The bar’s stock is put right.');
  };
  const setLevel = r => {
    const { box, close } = sheet(`<h2>${esc(r.name)}: how many are there?</h2><p class="muted" style="margin:0">${esc(s.station.name)}. The records say ${r.expected}. The difference goes in as a correction, with your name and reason.</p>
      <div class="sfield"><label for="slQ">How many are in the bar now</label><input id="slQ" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(r.expected)}"></div>
      <div class="sfield"><label for="slR">Why</label><input id="slR" maxlength="200" placeholder="e.g. recounted the store"></div>
      <div id="slM"></div><div class="sheet-dock"><button class="big" id="slGo">Save</button></div>`, { label: 'Set the number' });
    $('#slGo', box).onclick = async () => { try { const res = await busy($('#slGo', box), () => sapi('/api/ops/stock/set-level', { method: 'POST', body: { stationId: sid, productId: r.productId, qty: Number($('#slQ', box).value), reason: $('#slR', box).value } })); close(); await again(); say($('#stMsg', el), res.unchanged ? 'That’s already the number.' : `Saved: ${r.name} is now ${res.qty}.`, 'good'); } catch (e) { say($('#slM', box), e.message, 'bad'); } };
  };
  $$('[data-fix]', el).forEach(b => b.onclick = () => fixEntry(b.dataset.fix));
}

// ── Money: is the club making money? Tonight / this week / this month ──
// The answer first (profit, or my share of it), then money in and out, then the details folded.
export async function moneyView(el, period = 'today') {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const [m, due, com] = await Promise.all([sapi(`/api/ops/money?period=${encodeURIComponent(period)}`), sapi('/api/ops/budget').catch(() => null), sapi('/api/ops/commissions').catch(() => null)]);
  const t = m.totals, d = m.drinks, profit = t.profitPesewas >= 0;
  const rows = list => list.filter(r => r.amountPesewas).map(r => lineRow(esc(r.label), money(r.amountPesewas))).join('') || '<div class="ln"><span class="muted">Nothing yet</span></div>';
  const live = m.expenses.filter(e => !e.removed);
  el.innerHTML = `<div class="vstack" style="display:grid;gap:14px"><h1>Money</h1>
    <div class="seg" role="radiogroup" aria-label="Period" style="grid-template-columns:repeat(3,minmax(0,1fr))">${[['today', 'Tonight'], ['week', 'This week'], ['month', 'This month']].map(([k, l]) => `<button type="button" class="mid ${k === m.period.key ? 'on' : ''}" data-per="${k}" role="radio" aria-checked="${k === m.period.key}">${l}</button>`).join('')}</div>
    <div class="hero-stack">${m.myShare ? `<div class="hero ${m.myShare.profitPesewas >= 0 ? 'good' : 'bad'}"><span>Your share (${m.myShare.pct}%)</span><b>${signed(m.myShare.profitPesewas)}</b><span>${esc(m.period.label)} · club ${profit ? 'profit' : 'loss'} ${money(Math.abs(t.profitPesewas))}</span></div>`
      : `<div class="hero ${profit ? 'good' : 'bad'}"><span>${profit ? 'Profit' : 'Loss'} · ${esc(m.period.label)}</span><b>${money(Math.abs(t.profitPesewas))}</b></div>`}
    <div class="hero-row">
      <div class="hero pos-money"><span>Money in</span><b>${money(t.inPesewas)}</b></div>
      <div class="hero pos-money"><span>Money out</span><b>${money(t.outPesewas)}</b></div>
    </div></div>
    ${t.waiting ? `<div class="say warn"><b>${t.waiting} expense${t.waiting > 1 ? 's' : ''} waiting for a director: ${money(t.waitingPesewas)}</b>Not counted until approved.</div>` : ''}
    ${m.canAddExpense ? '<button class="big" id="addExp">Add an expense</button>' : ''}<div id="mMsg"></div>
    ${due || com ? `<div class="rows">
      ${due ? `<a class="row-btn" href="#budget" style="text-decoration:none"><span class="t">Bills this month</span><span class="s">${due.totals.overdue ? `<b class="diff-neg">${due.totals.overdue} overdue</b> · ` : ''}${money(due.totals.paidPesewas)} paid of ${money(due.totals.billsPesewas)}</span><span class="r">${money(due.totals.duePesewas)}</span></a>` : ''}
      ${com ? `<a class="row-btn" href="#commissions" style="text-decoration:none"><span class="t">Commissions this month</span><span class="s">${com.ratePct}% on tables over ${money(com.overPesewas)}${com.totals.unassigned ? ` · ${com.totals.unassigned} not named yet` : ''}</span><span class="r">${money(com.totals.owedPesewas)}</span></a>` : ''}</div>` : ''}
    <details class="fold"><summary>Money in and out</summary>
      <h3 class="group-h">Money in</h3><div class="lines-list">${rows(m.moneyIn)}<div class="ln total"><span>Total</span><span>${money(t.inPesewas)}</span></div></div>
      ${d.unpaidPesewas ? `<p class="muted" style="margin:0">Not counted yet: ${money(d.unpaidPesewas)} of drinks still unpaid on open tables.</p>` : ''}
      <h3 class="group-h">Money out</h3><div class="lines-list">${rows(m.moneyOut)}<div class="ln total"><span>Total</span><span>${money(t.outPesewas)}</span></div></div></details>
    <details class="fold"><summary>Drinks <span class="muted">${signed(d.profitPesewas)} made</span></summary>
      <div class="lines-list">${lineRow('Sold', money(d.soldPesewas))}${lineRow('What they cost us', money(d.costPesewas))}<div class="ln total"><span>Made on drinks</span><span class="${d.profitPesewas >= 0 ? '' : 'diff-neg'}">${signed(d.profitPesewas)}</span></div></div>
      ${d.missingCost.length ? `<p style="margin:0">${amber('No cost entered for:')} ${d.missingCost.map(esc).join(', ')}. Finance can add it under Drinks &amp; prices.</p>` : ''}
      ${d.rows.length ? `<h3 class="group-h">By drink</h3><div class="lines-list">${d.rows.map(r => lineRow(esc(r.name), signed(r.profitPesewas), `${r.qty} sold · ${money(r.salesPesewas)} · cost ${money(r.costPesewas)}`)).join('')}</div>` : ''}</details>
    <details class="fold"><summary>Expenses (${live.length})</summary>
      ${m.expenses.length ? `<div class="lines-list">${m.expenses.map(e => `<div class="ln" style="${e.removed ? 'opacity:.55' : ''}"><span><b>${esc(e.description)}</b><br><small class="muted">${esc(e.categoryLabel)} · ${esc(dayName(e.date))} · ${esc(e.paidWith)} · ${esc(e.recordedByName)}${e.removed ? ` · taken off by ${esc(e.removedByName)}: ${esc(e.removedReason)}` : ''}${e.approval === 'pending' ? ' · <b>waiting for a director</b>' : e.approval === 'refused' ? ` · <b>refused by ${esc(e.decidedByName)}</b>: ${esc(e.decisionNote)}` : ''}</small></span>
        <span>${e.removed ? `<s>${money(e.amountPesewas)}</s>` : money(e.amountPesewas)}${e.canRemove ? `<br><button class="sbtn" data-rmexp="${esc(e.id)}">Take off</button>` : ''}</span></div>`).join('')}</div>` : '<p class="muted" style="margin:0">No expenses recorded.</p>'}</details>
    ${m.purchases.length ? `<details class="fold"><summary>Drinks bought (${m.purchases.length})</summary><div class="lines-list">${m.purchases.map(x => lineRow(`<b>${x.qty} × ${esc(x.productName)}</b>`, money(x.costPesewas), `${esc(dayName(x.date))} · ${esc(x.recordedByName)}${x.supplier ? ` · ${esc(x.supplier)}` : ''}`)).join('')}</div></details>` : ''}
    ${m.byNight.length > 1 ? `<details class="fold"><summary>Night by night</summary><div class="lines-list">${m.byNight.map(r => lineRow(esc(dayName(r.date)), signed(r.profitPesewas), `in ${money(r.inPesewas)} · out ${money(r.outPesewas)}`)).join('')}</div></details>` : ''}
    ${m.serviceFees?.totalPesewas ? `<details class="fold"><summary>Service fees: ${money(m.serviceFees.totalPesewas)}</summary><div class="lines-list">
      ${lineRow(`Paid on top of ${m.serviceFees.payments} online / MoMo payment${m.serviceFees.payments > 1 ? 's' : ''}`, money(m.serviceFees.totalPesewas))}</div>
      <p class="muted" style="margin:0">${esc(m.serviceFees.note)}</p></details>` : ''}
    ${m.tips?.totalPesewas ? `<details class="fold"><summary>Tips for staff</summary><div class="lines-list">
      ${lineRow(`Tips given (${m.tips.count})`, money(m.tips.totalPesewas))}${lineRow('MoMo / card: came into the club’s account', money(m.tips.momoPesewas + m.tips.digitalPesewas))}${lineRow('Cash: the staff kept it', money(m.tips.cashPesewas))}
      <div class="ln total"><span>Still to pay out to staff</span><span>${money(m.tips.owedPesewas)}</span></div></div>
      <p class="muted" style="margin:0">${esc(m.tips.note)}</p></details>` : ''}
    ${m.owners?.length ? `<details class="fold"><summary>Directors’ shares</summary><div class="lines-list">${m.owners.map(o => lineRow(`${esc(o.name)} <small class="muted">${o.pct}%</small>`, signed(o.profitPesewas))).join('')}</div></details>` : ''}</div>`;
  $$('[data-per]', el).forEach(b => b.onclick = () => moneyView(el, b.dataset.per));
  $('#addExp', el) && ($('#addExp', el).onclick = () => expenseSheet(m, async r => { await moneyView(el, m.period.key); say($('#mMsg', el), r?.needsApproval ? 'Saved. It’s above the limit, so it waits for a director.' : 'Expense saved.'); }));
  $$('[data-rmexp]', el).forEach(b => b.onclick = () => {
    const { box, close } = sheet(`<h2>Take off this expense</h2><p class="muted" style="margin:0">It stays on record, crossed out.</p>
      <div class="sfield"><label for="rxWhy">Why</label><input id="rxWhy" maxlength="200" placeholder="e.g. entered twice"></div><div id="rxMsg"></div>
      <button class="big" id="rxGo">Take it off</button><button class="big ghost" data-close>Cancel</button>`);
    $('#rxGo', box).onclick = async () => { try { await busy($('#rxGo', box), () => sapi('/api/ops/expenses/remove', { method: 'POST', body: { id: b.dataset.rmexp, reason: $('#rxWhy', box).value } })); close(); moneyView(el, m.period.key); } catch (e) { say($('#rxMsg', box), e.message, 'bad'); } };
  });
}

// Add an expense: what for, how much, how it was paid. Shared by the manager and finance.
export function expenseSheet(m, done) {
  const cats = m?.categories || {};
  const { box, close } = sheet(`<h2>Add an expense</h2>
    <div class="sfield"><label for="exCat">What for</label><select id="exCat"><option value="">Pick one</option>${Object.entries(cats).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
    <div class="sfield"><label for="exDesc">Details</label><input id="exDesc" maxlength="160" placeholder="e.g. DJ Kofi, Saturday"></div>
    ${moneyField('exAmt', 'Amount (GHS)')}
    <div class="sfield"><label for="exPaid">Paid with</label><select id="exPaid"><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option></select></div>
    <div class="sfield"><label for="exDate">Which night</label><input id="exDate" type="date" value="${esc(m?.period?.to || '')}"></div>
    <div id="exMsg"></div><button class="big" id="exGo">Save expense</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Add an expense' });
  $('#exGo', box).onclick = async () => {
    try {
      const r = await busy($('#exGo', box), () => sapi('/api/ops/expenses', { method: 'POST', body: { category: $('#exCat', box).value, description: $('#exDesc', box).value, amountPesewas: ghsIn($('#exAmt', box).value), paidWith: $('#exPaid', box).value, date: $('#exDate', box).value } }));
      close(); done?.(r);
    } catch (e) { say($('#exMsg', box), e.message, 'bad'); }
  };
}

// Opening counts the manager must explain (the bar found a different number when it opened).
export function explainSheet(c, done) {
  const { box, close } = sheet(`<h2>Explain the stock difference</h2>
    <p class="muted" style="margin:0">${esc(c.stationName)} · ${esc(dayName(c.date))} · counted by ${esc(c.byName)} when the bar opened.</p>
    <div class="lines-list">${c.differences.map(x => `<div class="ln"><span>${esc(x.name)}<br><small class="muted">System said ${x.expected}, bar found ${x.counted}</small></span><span class="${x.difference < 0 ? 'diff-neg' : 'diff-pos'}">${Math.abs(x.difference)} ${x.difference < 0 ? 'fewer' : 'more'}</span></div>`).join('')}</div>
    <div class="sfield"><label for="xpWhy">What happened</label><textarea id="xpWhy" rows="3" maxlength="500" placeholder="e.g. 3 beers given to the DJ on Thursday"></textarea></div>
    <div id="xpMsg"></div><button class="big" id="xpGo">Save explanation</button><button class="big ghost" data-close>Later</button>`, { label: 'Explain the stock difference' });
  $('#xpGo', box).onclick = async () => {
    try { await busy($('#xpGo', box), () => sapi('/api/ops/stock/explain', { method: 'POST', body: { stationId: c.stationId, date: c.date, note: $('#xpWhy', box).value } })); close(); done?.(); }
    catch (e) { say($('#xpMsg', box), e.message, 'bad'); }
  };
}

// ── Bills and budget for the month (finance sets them; the director and manager look) ──
export async function budgetView(el, month) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const b = await sapi(`/api/ops/budget${month ? `?month=${month}` : ''}`);
  const t = b.totals, bud = b.budget;
  const stateLabel = { due: ['unpaid', 'Due'], overdue: ['cancelled', 'Overdue'], part_paid: ['part_paid', 'Part paid'], paid: ['paid', 'Paid'], removed: ['empty', 'Taken off'], awaiting_approval: ['waiting', 'Waiting for a director'] };
  const mon = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' });
  el.innerHTML = `<h1 style="margin:0">Bills and budget</h1>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="sbtn" data-mon="${b.prev}" aria-label="Previous month">← ${esc(mon(b.prev))}</button><b style="font-size:18px">${esc(b.label)}</b><button class="sbtn" data-mon="${b.next}" aria-label="Next month">${esc(mon(b.next))} →</button></div>
    <div class="pos-money">
      <div class="big-line"><span>Bills this month</span><b>${money(t.billsPesewas)}</b></div>
      <div class="big-line good"><span>Paid</span><b>${money(t.paidPesewas)}</b></div>
      <div class="big-line ${t.duePesewas ? 'bad' : 'good'}"><span>Still to pay</span><b>${money(t.duePesewas)}</b></div>
      ${t.overdue ? `<p class="how" style="color:#ff7a9c">${t.overdue} overdue: ${money(t.overduePesewas)}</p>` : t.dueSoon ? `<p class="how">${t.dueSoon} due in the next 7 days</p>` : ''}
    </div>
    ${b.canEdit ? '<div class="btn-row"><button class="big" id="bAdd">Add a bill</button><button class="big ghost" id="bBud">Set the budget</button></div><button class="mid" id="bCopy">Copy last month’s bills and budget</button>' : ''}<div id="bMsg"></div>
    ${b.salaries?.people ? `<a class="pos-row" href="#salaries" style="text-decoration:none"><span class="where">Salaries (${b.salaries.people} people)<small>${esc(b.salaries.statusLabel)}</small></span><span class="amt">${money(b.salaries.netPesewas - b.salaries.paidPesewas)}<small style="display:block">to pay</small></span></a>` : ''}
    <h2>Bills</h2>
    ${b.bills.length ? `<div class="lines-list">${b.bills.map(x => `<div class="ln" style="${x.state === 'removed' ? 'opacity:.5' : ''}"><span><b>${esc(x.payee)}</b>${x.description ? ` · ${esc(x.description)}` : ''}<br><small class="muted">${esc(x.categoryLabel)} · due ${esc(dayName(x.dueDate))}${x.paidPesewas && x.state !== 'paid' ? ` · ${money(x.paidPesewas)} paid` : ''}${x.removedReason ? ` · ${esc(x.removedReason)}` : ''}</small><br>${st(...stateLabel[x.state])}</span>
      <span>${money(x.state === 'paid' ? x.amountPesewas : x.leftPesewas || x.amountPesewas)}${b.canEdit && x.leftPesewas && x.approved ? `<br><button class="sbtn" data-pay="${esc(x.id)}">Pay</button>` : ''}${b.canEdit && x.leftPesewas && !x.approved ? '<br><small class="muted">A director approves first</small>' : ''}${b.canEdit && x.leftPesewas && !x.paidPesewas ? `<br><button class="sbtn" data-rmb="${esc(x.id)}">Take off</button>` : ''}</span></div>`).join('')}</div>` : `<p class="muted">No bills for ${esc(b.label)}${b.canEdit ? ' yet. Add salaries, rent, suppliers owed…' : '.'}</p>`}
    <h2>Budget against spending</h2>
    <p class="muted" style="margin:0">${bud.limitInForcePesewas != null ? `Expenses over ${money(bud.limitInForcePesewas)} wait for a director.` : 'No expense limit set yet: every expense waits for a director.'}</p>
    ${bud.lines.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>For</th><th class="num">Budget</th><th class="num">Spent</th><th class="num">Left</th></tr></thead><tbody>
      ${bud.lines.map(l => `<tr><td>${esc(l.label)}${l.over ? ` ${st('cancelled', 'Over budget')}` : l.unplanned ? ` ${st('unpaid', 'Not in the budget')}` : ''}</td><td class="num">${l.budgetPesewas ? money(l.budgetPesewas) : '—'}</td><td class="num">${money(l.spentPesewas)}</td><td class="num">${l.budgetPesewas ? `${l.leftPesewas < 0 ? '−' : ''}${money(Math.abs(l.leftPesewas))}` : '—'}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td class="num"><b>${money(bud.totalPesewas)}</b></td><td class="num"><b>${money(bud.spentPesewas)}</b></td><td class="num"><b>${money(bud.totalPesewas - bud.spentPesewas)}</b></td></tr></tbody></table></div>${bud.setByName ? `<p class="muted" style="margin:0">Budget set by ${esc(bud.setByName)}.${bud.note ? ` ${esc(bud.note)}` : ''}</p>` : ''}` : `<p class="muted">No budget for ${esc(b.label)}${b.canEdit ? ' yet.' : '.'}</p>`}`;
  const again = () => budgetView(el, b.month);
  $$('[data-mon]', el).forEach(x => x.onclick = () => budgetView(el, x.dataset.mon));
  if (!b.canEdit) return labelTables(el);
  const cats = obj => Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#bAdd', el).onclick = () => {
    const { box, close } = sheet(`<h2>Add a bill</h2>
      <div class="sfield"><label for="blP">Owed to</label><input id="blP" maxlength="80" placeholder="e.g. Staff salaries, Landlord, Guinness Ghana"></div>
      <div class="sfield"><label for="blC">What for</label><select id="blC"><option value="">Pick one</option>${cats(b.billCategories)}</select><span class="hint">A drinks supplier you owe: paying it doesn’t count twice (the drinks were counted when bought).</span></div>
      <div class="sfield"><label for="blD">Details (optional)</label><input id="blD" maxlength="160"></div>
      ${moneyField('blA', 'Amount (GHS)')}
      <div class="sfield"><label for="blW">Pay by</label><input id="blW" type="date" value="${esc(b.month === b.today.slice(0, 7) ? b.today : `${b.month}-28`)}"></div>
      <div id="blM"></div><button class="big" id="blGo">Save bill</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Add a bill' });
    $('#blGo', box).onclick = async () => { try { await busy($('#blGo', box), () => sapi('/api/ops/bills', { method: 'POST', body: { payee: $('#blP', box).value, category: $('#blC', box).value, description: $('#blD', box).value, amountPesewas: ghsIn($('#blA', box).value), dueDate: $('#blW', box).value } })); close(); again(); } catch (e) { say($('#blM', box), e.message, 'bad'); } };
  };
  $('#bBud', el).onclick = () => {
    const have = Object.fromEntries(bud.lines.map(l => [l.category, l.budgetPesewas]));
    const { box, close } = sheet(`<h2>Budget for ${esc(b.label)}</h2><p class="muted" style="margin:0">How much the club plans to spend on each. Leave blank what doesn’t apply.</p>
      ${moneyField('bg_limit', 'Most one expense can be without a director (GHS)', bud.expenseLimitPesewas != null ? String(bud.expenseLimitPesewas / 100) : '', 'Above this, an expense waits for a director. Blank: every expense waits.')}
      ${Object.entries(b.categories).map(([k, v]) => moneyField(`bg_${k}`, v, have[k] ? String(have[k] / 100) : '')).join('')}
      <div class="sfield"><label for="bgN">Note (optional)</label><input id="bgN" maxlength="300" value="${esc(bud.note)}"></div>
      <div id="bgM"></div><button class="big" id="bgGo">Save budget</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Budget' });
    $('#bgGo', box).onclick = async () => {
      const lines = Object.fromEntries(Object.keys(b.categories).map(k => [k, $(`#bg_${k}`, box).value === '' ? '' : ghsIn($(`#bg_${k}`, box).value)]));
      try { await busy($('#bgGo', box), () => sapi('/api/ops/budget', { method: 'POST', body: { month: b.month, lines, note: $('#bgN', box).value, expenseLimitPesewas: $('#bg_limit', box).value === '' ? '' : ghsIn($('#bg_limit', box).value) } })); close(); again(); } catch (e) { say($('#bgM', box), e.message, 'bad'); }
    };
  };
  $('#bCopy', el).onclick = async () => {
    try { const r = await sapi('/api/ops/bills/copy', { method: 'POST', body: { month: b.month } }); await budgetView(el, b.month); say($('#bMsg', el), `${r.copied} bill${r.copied === 1 ? '' : 's'} copied${r.budget ? ', and the budget' : ''}.`); }
    catch (e) { say($('#bMsg', el), e.message, 'bad'); }
  };
  $$('[data-pay]', el).forEach(x => x.onclick = () => {
    const bill = b.bills.find(y => y.id === x.dataset.pay);
    const { box, close } = sheet(`<h2>Pay ${esc(bill.payee)}</h2>
      ${moneyField('pyA', 'Amount paid (GHS)', String(bill.leftPesewas / 100), `Left to pay: ${money(bill.leftPesewas)}. Pay part if you like.`)}
      <div class="sfield"><label for="pyW">Paid with</label><select id="pyW"><option value="bank">Bank</option><option value="momo">MoMo</option><option value="cash">Cash</option></select></div>
      <div class="sfield"><label for="pyD">Date paid</label><input id="pyD" type="date" value="${esc(b.today)}"></div>
      <div id="pyM"></div><button class="big" id="pyGo">Record payment</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Pay a bill' });
    $('#pyGo', box).onclick = async () => { try { await busy($('#pyGo', box), () => sapi('/api/ops/bills/pay', { method: 'POST', body: { id: bill.id, amountPesewas: ghsIn($('#pyA', box).value), paidWith: $('#pyW', box).value, date: $('#pyD', box).value } })); close(); again(); } catch (e) { say($('#pyM', box), e.message, 'bad'); } };
  });
  $$('[data-rmb]', el).forEach(x => x.onclick = async () => {
    const reason = await ask({ title: 'Take this bill off', label: 'Why?', quick: ['Entered twice', 'Wrong amount', 'Already paid', 'Not needed any more'], send: 'Take it off', danger: true }); if (!reason) return;
    try { await sapi('/api/ops/bills/remove', { method: 'POST', body: { id: x.dataset.rmb, reason } }); again(); } catch (e) { say($('#bMsg', el), e.message, 'bad'); }
  });
  labelTables(el);
}

// ── Commissions: 10% to whoever brings a table deal over GHS 3,000 ──
// ── Tips owed to staff (finance pays them out weekly; no director: it's the staff's own money) ──
export async function tipsView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const t = await sapi('/api/ops/tips/owed');
  el.innerHTML = `<h1 style="margin:0">Tips owed to staff</h1>
    <p class="lead" style="margin:0">Customers’ MoMo and card tips came into the club’s account. They’re the staff’s money, not the club’s: pay each person what they’re owed.</p>
    <div class="pos-money"><div class="big-line ${t.owedPesewas ? 'bad' : 'good'}"><span>Still to pay out</span><b>${money(t.owedPesewas)}</b></div></div><div id="tMsg"></div>
    ${t.people.length ? `<div class="lines-list">${t.people.map(p => `<div class="ln"><span><b>${esc(p.name)}</b>${p.roleName ? ` · ${esc(p.roleName)}` : ''}<br><small class="muted">${p.tips.length} tip${p.tips.length > 1 ? 's' : ''} · ${p.payTo ? `pay to ${esc(p.payTo)}` : 'no MoMo or bank details yet (Human manager)'}</small>
        <details class="fold"><summary>See the tips</summary>${p.tips.map(x => `<small style="display:block">${esc(dayName(x.date))} · ${esc(x.from)} · ${money(x.amountPesewas)} · ${esc(x.methodLabel)}${x.momoRef ? ` · ID ${esc(x.momoRef)}` : ''}</small>`).join('')}</details>
        ${p.needsCheck ? '<small class="muted">Some came by MoMo to the club’s number: check the IDs on the MoMo statement first.</small>' : ''}</span>
      <span>${money(p.owedPesewas)}${t.canPay ? `<br><button class="sbtn" data-payt="${esc(p.uid)}">Pay</button>` : ''}</span></div>`).join('')}</div>` : '<div class="empty-box"><b>No tips owed</b>MoMo and card tips show here until finance pays them out.</div>'}
    ${t.paid.length ? `<h2>Paid out</h2><div class="lines-list">${t.paid.map(p => `<div class="ln"><span>${esc(p.name)}<br><small class="muted">${esc(dayName(String(p.at).slice(0, 10)))} · ${esc(p.paidWith === 'momo' ? 'MoMo' : p.paidWith === 'bank' ? 'Bank' : 'Cash')}${p.ref ? ` · ref ${esc(p.ref)}` : ''} · by ${esc(p.byName)}</small></span><span>${money(p.amountPesewas)}</span></div>`).join('')}</div>` : ''}`;
  $$('[data-payt]', el).forEach(x => x.onclick = () => {
    const p = t.people.find(y => y.uid === x.dataset.payt);
    const { box, close } = sheet(`<h2>Pay ${esc(p.name)} ${money(p.owedPesewas)}</h2><p class="muted" style="margin:0">${p.tips.length} tip${p.tips.length > 1 ? 's' : ''}. ${p.payTo ? `Pay to ${esc(p.payTo)}.` : ''} They get a text when it’s recorded.</p>
      <div class="sfield"><label for="ptW">Paid with</label><select id="ptW"><option value="momo">MoMo</option><option value="bank">Bank</option><option value="cash">Cash</option></select></div>
      <div class="sfield" id="ptRefBox"><label for="ptRef">MoMo or bank reference</label><input id="ptRef" maxlength="60" autocomplete="off"></div>
      <div id="ptM"></div><button class="big" id="ptGo">Record payment</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Pay tips' });
    $('#ptW', box).onchange = e => { $('#ptRefBox', box).hidden = e.target.value === 'cash'; };
    $('#ptGo', box).onclick = async () => {
      try { const r = await busy($('#ptGo', box), () => sapi('/api/ops/tips/pay', { method: 'POST', body: { uid: p.uid, paidWith: $('#ptW', box).value, ref: $('#ptRef', box).value } })); close(); await tipsView(el); say($('#tMsg', el), `Paid ${r.name} ${money(r.amountPesewas)}. They’ve been texted.`); }
      catch (e) { say($('#ptM', box), e.message, 'bad'); }
    };
  });
}

export async function commissionsView(el, month) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const c = await sapi(`/api/ops/commissions${month ? `?month=${month}` : ''}`);
  const t = c.totals, mon = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' });
  el.innerHTML = `<h1 style="margin:0">Commissions</h1>
    <p class="lead" style="margin:0">${c.ratePct}% of every table deal over ${money(c.overPesewas)}, to the person who brought it.</p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="sbtn" data-mon="${c.prev}">← ${esc(mon(c.prev))}</button><b style="font-size:18px">${esc(c.label)}</b><button class="sbtn" data-mon="${c.next}">${esc(mon(c.next))} →</button></div>
    <div class="pos-money">
      <div class="big-line ${t.owedPesewas ? 'bad' : 'good'}"><span>Still to pay out</span><b>${money(t.owedPesewas)}</b></div>
      <div class="big-line good"><span>Paid out</span><b>${money(t.paidPesewas)}</b></div>
      ${t.unassigned ? `<p class="how">${t.unassigned} deal${t.unassigned > 1 ? 's' : ''} with nobody named yet (${money(t.unassignedPesewas)})</p>` : ''}
    </div><div id="cMsg"></div>
    <h2>Who is owed</h2>
    ${c.people.length ? `<div class="lines-list">${c.people.map(p => `<div class="ln"><span><b>${esc(p.name)}</b>${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}<br><small class="muted">${p.deals} deal${p.deals > 1 ? 's' : ''}${p.paidPesewas ? ` · ${money(p.paidPesewas)} paid` : ''}</small></span>
      <span>${p.owedPesewas ? money(p.owedPesewas) : st('paid', 'Paid')}${p.owedPesewas && !p.payout && c.canAssign ? `<br><button class="sbtn" data-askc="${esc(p.key)}">Ask a director</button>` : ''}${p.payout?.status === 'requested' ? `<br>${st('waiting', 'Waiting for a director')}` : ''}${p.payout?.status === 'refused' ? `<br>${st('cancelled', 'Refused')}` : ''}${c.canPay && p.owedPesewas && p.payout?.status === 'approved' ? `<br><button class="sbtn" data-payc="${esc(p.key)}">Pay</button>` : ''}</span></div>`).join('')}</div>` : '<p class="muted">Nobody yet this month.</p>'}
    <h2>Deals</h2>
    ${c.deals.length ? `<div class="lines-list">${c.deals.map((d, i) => `<div class="ln"><span><b>${esc(d.label)}</b>${d.night ? ` · ${esc(d.night)}` : ''}<br><small class="muted">${esc(dayName(d.date))}${d.customer ? ` · ${esc(d.customer)}` : ''}${d.servedBy ? ` · served by ${esc(d.servedBy)}` : ''} · sold ${money(d.amountPesewas)}</small><br>
      ${d.broughtBy ? `<small>Brought by <b>${esc(d.broughtBy.name)}</b></small>` : st('unpaid', 'Who brought it?')} ${d.paid ? st('paid', 'Paid') : ''}</span>
      <span>${money(d.commissionPesewas)}${c.canAssign && !d.paid ? `<br><button class="sbtn" data-who="${i}">${d.broughtBy ? 'Change' : 'Name them'}</button>` : ''}</span></div>`).join('')}</div>` : `<p class="muted">No table over ${money(c.overPesewas)} in ${esc(c.label)}.</p>`}`;
  const again = () => commissionsView(el, c.month);
  $$('[data-mon]', el).forEach(x => x.onclick = () => commissionsView(el, x.dataset.mon));
  $$('[data-who]', el).forEach(x => x.onclick = () => {
    const d = c.deals[Number(x.dataset.who)];
    const { box, close } = sheet(`<h2>Who brought this deal?</h2><p class="muted" style="margin:0">${esc(d.label)} · ${money(d.amountPesewas)} · commission ${money(d.commissionPesewas)}</p>
      <div class="sfield"><label for="wbN">Their name</label><input id="wbN" maxlength="60" value="${esc(d.broughtBy?.name || '')}"></div>
      <div class="sfield"><label for="wbP">Their phone (to pay them)</label><input id="wbP" type="tel" inputmode="tel" value="${esc(d.broughtBy?.phone || '')}" placeholder="024 123 4567"></div>
      <div id="wbM"></div><button class="big" id="wbGo">Save</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Who brought this deal' });
    $('#wbGo', box).onclick = async () => { try { await busy($('#wbGo', box), () => sapi('/api/ops/commissions/assign', { method: 'POST', body: { kind: d.kind, id: d.id, name: $('#wbN', box).value, phone: $('#wbP', box).value } })); close(); again(); } catch (e) { say($('#wbM', box), e.message, 'bad'); } };
  });
  $$('[data-askc]', el).forEach(x => x.onclick = async () => {
    try { await sapi('/api/ops/commissions/request', { method: 'POST', body: { month: c.month, key: x.dataset.askc } }); again(); } catch (e) { say($('#cMsg', el), e.message, 'bad'); }
  });
  $$('[data-payc]', el).forEach(x => x.onclick = () => {
    const p = c.people.find(y => y.key === x.dataset.payc);
    const { box, close } = sheet(`<h2>Pay ${esc(p.name)} ${money(p.owedPesewas)}</h2><p class="muted" style="margin:0">Commission on ${p.deals} deal${p.deals > 1 ? 's' : ''} in ${esc(c.label)}. It’s recorded as an expense under Commissions.</p>
      <div class="sfield"><label for="pcW">Paid with</label><select id="pcW"><option value="momo">MoMo</option><option value="cash">Cash</option><option value="bank">Bank</option></select></div>
      <div id="pcM"></div><button class="big" id="pcGo">Record payment</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Pay commission' });
    $('#pcGo', box).onclick = async () => { try { await busy($('#pcGo', box), () => sapi('/api/ops/commissions/pay', { method: 'POST', body: { month: c.month, key: p.key, paidWith: $('#pcW', box).value } })); close(); again(); } catch (e) { say($('#pcM', box), e.message, 'bad'); } };
  });
}

// ── Every payment of the night, and the top customers (manager, director, finance) ──
export async function paymentsView(el, { tab = 'payments' } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi('/api/ops/payments');
  el.innerHTML = `<h1>${tab === 'customers' ? 'Top customers tonight' : 'Payments tonight'}</h1>
    <div class="seg" role="radiogroup" aria-label="Show"><button type="button" class="mid ${tab === 'payments' ? 'on' : ''}" data-tabv="payments">Payments (${d.payments.length})</button><button type="button" class="mid ${tab === 'customers' ? 'on' : ''}" data-tabv="customers">Top customers</button></div>
    ${tab === 'customers' ? `${d.customers.length ? `<div class="lines-list">${d.customers.map((c, i) => `<div class="ln"><span><b>${i + 1}. ${esc(c.name || 'Customer')}</b> · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a><br><small class="muted">${c.visits} order${c.visits > 1 ? 's' : ''} · ${esc(c.where)} · last ${when(c.lastAt)}</small></span><span>${money(c.spentPesewas)}</span></div>`).join('')}</div>` : '<p class="muted">No customers with a phone number yet tonight.</p>'}
      ${d.noPhonePesewas ? `<p class="muted" style="margin:0">${money(d.noPhonePesewas)} was spent by customers who gave no phone number. Ask waiters and the bar to add the customer’s phone, so their spending adds up.</p>` : ''}`
    : `<div class="pos-money"><div class="big-line good"><span>Paid tonight</span><b>${money(d.totalPesewas)}</b></div><p class="how">${d.byMethod.map(m => `${esc(m.label)} ${money(m.amountPesewas)}`).join(' · ')}</p></div>
      ${d.payments.length ? `<div class="pos-tables">${d.payments.map((p, i) => `<button type="button" class="pos-row" data-pay="${i}"><span class="where">${when(p.at)} · ${esc(p.where)}<small>${esc(p.methodLabel)} · served by ${esc(p.servedByName || '—')}${p.customerName ? ` · ${esc(p.customerName)}` : ''}${p.tipPesewas ? ` · + tip ${money(p.tipPesewas)}` : ''}</small></span><span class="amt">${money(p.amountPesewas)}${p.refund ? st('cancelled', 'refund') : ''}</span></button>`).join('')}</div>` : '<p class="muted">No payments yet tonight.</p>'}`}`;
  $$('[data-tabv]', el).forEach(b => b.onclick = () => paymentsView(el, { tab: b.dataset.tabv }));
  $$('[data-pay]', el).forEach(b => b.onclick = () => {
    const p = d.payments[Number(b.dataset.pay)];
    sheet(`<h2>${money(p.amountPesewas)} · ${when(p.at)}</h2>
      <div class="lines-list">
        <div class="ln"><span>How it was paid</span><span>${esc(p.methodLabel)}</span></div>
        ${p.momoRef ? `<div class="ln"><span>Reference</span><span>${esc(p.momoRef)}</span></div>` : ''}
        <div class="ln"><span>Payment taken by</span><span>${esc(p.takenByName || '—')}</span></div>
        <div class="ln"><span>Served by</span><span>${esc(p.servedByName || '—')}</span></div>
        ${p.tipPesewas ? `<div class="ln"><span>Tip (theirs, not the club’s)</span><span>${money(p.tipPesewas)} for ${esc(p.tipToName)}</span></div>` : ''}
        <div class="ln"><span>Where</span><span>${esc(p.where)}${p.bar ? ` · ${esc(p.bar)}` : ''} · ${esc(p.tab)}</span></div>
        ${p.customerName || p.customerPhone ? `<div class="ln"><span>Customer</span><span>${esc(p.customerName)}${p.customerPhone ? ` <a href="tel:${esc(p.customerPhone)}">${esc(p.customerPhone)}</a>` : ''}</span></div>` : ''}
      </div>
      <h3 style="margin:6px 0 0">${p.wholeBill ? 'What the table had (this payment is towards the whole bill)' : 'What was bought'}</h3>
      <div class="lines-list">${p.lines.map(l => `<div class="ln"><span>${l.qty} × ${esc(l.name)}</span><span>${money(l.amountPesewas)}</span></div>`).join('') || '<div class="ln"><span class="muted">No drinks</span></div>'}
        ${p.wholeBill ? `<div class="ln total"><span>Table total</span><span>${money(p.billTotalPesewas)}</span></div>${p.billLeftPesewas ? `<div class="ln"><span>Still to pay on the table</span><span>${money(p.billLeftPesewas)}</span></div>` : ''}` : ''}</div>
      ${p.refund ? `<div class="say bad">${p.refund === 'refunded' ? 'Refunded.' : 'The bar couldn’t make it: a refund is owed.'}</div>` : ''}
      <button class="big ghost" data-close>Done</button>`, { label: 'Payment' });
  });
}

// ── For the directors: everything waiting for a director (any director may approve any of it) ──
export async function toApproveView(el, { onCount } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi('/api/ops/to-approve');
  onCount?.(d.items.length);
  const KIND = { payroll: 'Salaries', loan: 'Staff loan', bill: 'Bill', commission: 'Commission', purchase: 'Drinks to buy', expense: 'Expense' };
  el.innerHTML = `<h1>To approve</h1><p class="lead" style="margin:0">${d.items.length ? `${d.items.length} waiting · ${money(d.totalPesewas)}. Finance pays only what a director approves.` : 'Nothing waiting. Finance pays only what a director approves.'}</p>
    <div id="taMsg"></div>
    <div class="cards">${d.items.map((x, i) => `<div class="tcard" style="cursor:default"><span class="row"><span class="t" style="font-size:16px">${esc(x.title)}</span><span class="amt">${money(x.amountPesewas)}</span></span>
      <span class="sub">${esc(KIND[x.kind])} · ${esc(x.detail || '')}</span><span class="sub">Asked by ${esc(x.byName || '—')}${x.at ? ` · ${esc(dayName(String(x.at).slice(0, 10)))}` : ''}</span>
      ${x.lines?.length ? `<details class="fold"><summary>Details</summary><div class="lines-list">${x.lines.map(l => `<div class="ln"><span>${esc(l.label)}${l.sub ? `<br><small class="muted">${esc(l.sub)}</small>` : ''}</span><span>${money(l.amountPesewas)}</span></div>`).join('')}</div></details>` : ''}
      <span class="btn-row"><button class="mid okc" data-yes="${i}">Approve</button><button class="mid" data-no="${i}">Refuse</button></span></div>`).join('') || '<div class="empty-box"><b>All clear</b>New requests appear here.</div>'}</div>`;
  const decide = async (x, approve) => {
    let note = '';
    if (!approve) { note = await ask(x.kind === 'payroll' ? { title: 'Send salaries back', label: 'What needs changing? It goes back to the Human manager.', quick: ['A salary is wrong', 'A bonus needs checking', 'Someone is missing', 'Someone shouldn’t be paid'], send: 'Send back', danger: true } : { title: 'Refuse this payment', label: 'Why? They see your reason.', quick: REFUSE_QUICK, send: 'Refuse', danger: true }); if (!note) return; }
    try { await sapi('/api/ops/approve', { method: 'POST', body: { kind: x.kind, id: x.id, approve, note } }); await toApproveView(el, { onCount }); say($('#taMsg', el), approve ? 'Approved. Finance can pay it now.' : 'Refused.'); }
    catch (e) { say($('#taMsg', el), e.message, 'bad'); }
  };
  $$('[data-yes]', el).forEach(b => b.onclick = () => decide(d.items[Number(b.dataset.yes)], true));
  $$('[data-no]', el).forEach(b => b.onclick = () => decide(d.items[Number(b.dataset.no)], false));
}

// ── Buying drinks: the Manager asks, finance checks the limits, a director approves ──
export async function purchasesView(el, stationId) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/purchases${stationId ? `?stationId=${encodeURIComponent(stationId)}` : ''}`);
  const stKey = { requested: 'unpaid', checked: 'part_paid', approved: 'ready', bought: 'paid', refused: 'cancelled' };
  const low = d.stock.filter(s => s.low);
  el.innerHTML = `<h1>Buying drinks</h1>
    ${d.stations.length > 1 ? `<select id="puSt">${d.stations.map(s => `<option value="${esc(s.id)}" ${s.id === d.stationId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
    ${low.length ? `<div class="say warn"><b>${low.length} drink${low.length > 1 ? 's are' : ' is'} at or below the minimum</b>${low.map(s => `${esc(s.name)}: ${s.stockNow} (min ${s.min}${s.max ? `, max ${s.max}` : ''})`).join('<br>')}</div>` : ''}
    ${d.can.ask ? '<button class="big" id="puAsk">Ask to buy drinks</button>' : ''}<div id="puMsg"></div>
    <h2>Requests</h2>
    <div class="cards">${d.requests.map(r => `<div class="tcard" style="cursor:default"><span class="row"><span class="t" style="font-size:16px">${esc(r.stationName)} · ${money(r.estTotalPesewas)}</span>${st(stKey[r.status], r.statusLabel)}</span>
      <span>${r.lines.map(l => `<b>${l.qty} ×</b> ${esc(l.name)} <small class="muted">(had ${l.stockNow}${l.max ? `, max ${l.max}` : ''}${l.receivedQty ? `, ${l.receivedQty} arrived` : ''})</small>`).join('<br>')}</span>
      <span class="sub">Asked by ${esc(r.requestedByName)}${r.note ? `: ${esc(r.note)}` : ''}${r.checkedByName ? ` · checked by ${esc(r.checkedByName)}${r.checkNote ? ` (${esc(r.checkNote)})` : ''}` : ''}${r.decidedByName && r.status !== 'refused' ? ` · approved by ${esc(r.decidedByName)}` : ''}${r.refusedNote ? ` · refused: ${esc(r.refusedNote)}` : ''}</span>
      ${r.status === 'requested' && d.can.check ? `<span class="btn-row"><button class="mid okc" data-chk="${esc(r.id)}">Check</button></span>` : ''}
      ${r.status === 'approved' && d.can.ask ? '<span class="sub">Bought? Record it on Stock → Add new stock, and pick this purchase.</span>' : ''}</div>`).join('') || '<div class="empty-box"><b>No requests yet</b></div>'}</div>
    <details class="fold"><summary>Stock now against the limits</summary><div class="lines-list">${d.stock.map(s => `<div class="ln"><span>${esc(s.name)}${s.low ? ` ${st('unpaid', 'Low')}` : ''}<br><small class="muted">min ${s.min || '—'} · max ${s.max || '—'}</small></span><span>${s.stockNow}</span></div>`).join('')}</div></details>`;
  $('#puSt', el) && ($('#puSt', el).onchange = e => purchasesView(el, e.target.value));
  $('#puAsk', el) && ($('#puAsk', el).onclick = () => {
    const { box, close } = sheet(`<h2>Ask to buy drinks</h2><p class="muted" style="margin:0">Filled in: enough to bring low drinks up to the maximum. Finance checks it, then a director approves the money.</p>
      <div class="lines-list">${d.stock.map(s => `<div class="ln" style="align-items:center"><span>${esc(s.name)}<br><small class="muted">has ${s.stockNow}${s.max ? ` · max ${s.max}` : ''}${s.costPesewas ? ` · ${money(s.costPesewas)} each` : ''}</small></span><input data-q="${esc(s.productId)}" inputmode="numeric" style="width:80px;text-align:center" value="${s.low && s.suggestQty ? s.suggestQty : ''}" aria-label="How many ${esc(s.name)}"></div>`).join('')}</div>
      <div class="sfield"><label for="puN">Note (optional)</label><input id="puN" maxlength="300"></div><div id="puM"></div><button class="big" id="puGo">Send to finance</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Ask to buy drinks' });
    $('#puGo', box).onclick = async () => {
      const lines = $$('[data-q]', box).map(i => ({ productId: i.dataset.q, qty: Number(i.value || 0) })).filter(l => l.qty > 0);
      try { await busy($('#puGo', box), () => sapi('/api/ops/purchases', { method: 'POST', body: { stationId: d.stationId, lines, note: $('#puN', box).value } })); close(); purchasesView(el, d.stationId); } catch (e) { say($('#puM', box), e.message, 'bad'); }
    };
  });
  $$('[data-chk]', el).forEach(b => b.onclick = () => {
    const r = d.requests.find(x => x.id === b.dataset.chk);
    const { box, close } = sheet(`<h2>Check the purchase</h2><p class="muted" style="margin:0">Change the numbers if needed. Above the maximum needs a reason.</p>
      <div class="lines-list">${r.lines.map(l => `<div class="ln" style="align-items:center"><span>${esc(l.name)}<br><small class="muted">has ${l.stockNow} · min ${l.min || '—'} · max ${l.max || '—'}</small></span><input data-cq="${esc(l.productId)}" inputmode="numeric" style="width:80px;text-align:center" value="${l.qty}"></div>`).join('')}</div>
      <div class="sfield"><label for="ckN">Note (needed above the maximum, or to refuse)</label><input id="ckN" maxlength="300"></div><div id="ckM"></div>
      <button class="big" id="ckOk">Approve and send to the directors</button><button class="big ghost" id="ckNo">Refuse</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Check purchase' });
    const send = approve => busy($(approve ? '#ckOk' : '#ckNo', box), () => sapi('/api/ops/purchases/check', { method: 'POST', body: { id: r.id, approve, note: $('#ckN', box).value, lines: $$('[data-cq]', box).map(i => ({ productId: i.dataset.cq, qty: Number(i.value || 0) })) } }))
      .then(() => { close(); purchasesView(el, d.stationId); }).catch(e => say($('#ckM', box), e.message, 'bad'));
    $('#ckOk', box).onclick = () => send(true); $('#ckNo', box).onclick = () => send(false);
  });
}

// ── Cash from the staff to the Manager, after they count it ──
export async function cashReceiveView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { sessions } = await sapi('/api/ops/cash/all');
  const waiting = sessions.filter(s => s.status !== 'open' && !s.receivedAt), open = sessions.filter(s => s.status === 'open' && s.expectedPesewas), done = sessions.filter(s => s.receivedAt);
  el.innerHTML = `<h1>Cash from the staff</h1>
    <div class="cards">${waiting.map(s => `<div class="tcard" style="cursor:default"><span class="row"><span class="t" style="font-size:16px">${esc(s.name)}</span><span class="amt">${money(s.countedPesewas)}</span></span>
      <span class="sub">Counted at ${when(s.closedAt)}${s.differencePesewas ? ` · ${money(Math.abs(s.differencePesewas))} ${s.differencePesewas < 0 ? 'less' : 'more'} than expected: ${esc(s.explanation)}` : ''}</span>
      <span class="btn-row"><button class="mid okc" data-rcv="${esc(s.id)}">Received</button></span></div>`).join('') || '<p class="muted">No cash waiting to be handed over.</p>'}</div>
    ${open.length ? `<h2>Not counted yet</h2><div class="lines-list">${open.map(s => `<div class="ln"><span>${esc(s.name)}</span><span>${money(s.expectedPesewas)} expected</span></div>`).join('')}</div>` : ''}
    ${done.length ? `<h2>Received tonight</h2><div class="lines-list">${done.map(s => `<div class="ln"><span>${esc(s.name)} <small class="muted">by ${esc(s.receivedByName)}${s.receivedNote ? `: ${esc(s.receivedNote)}` : ''}</small></span><span>${money(s.receivedPesewas)}</span></div>`).join('')}</div>` : ''}<div id="crMsg"></div>`;
  $$('[data-rcv]', el).forEach(b => b.onclick = () => {
    const s = sessions.find(x => x.id === b.dataset.rcv);
    const { box, close } = sheet(`<h2>Cash from ${esc(s.name)}</h2>${moneyField('crA', 'Cash you received (GHS)', String(s.countedPesewas / 100), `They counted ${money(s.countedPesewas)}.`)}
      <div class="sfield"><label for="crN">Note (needed if it’s different)</label><input id="crN" maxlength="300"></div><div id="crM"></div><button class="big" id="crGo">Confirm received</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Receive cash' });
    $('#crGo', box).onclick = async () => { try { await busy($('#crGo', box), () => sapi('/api/ops/cash/receive', { method: 'POST', body: { id: s.id, receivedPesewas: ghsIn($('#crA', box).value), note: $('#crN', box).value } })); close(); cashReceiveView(el); } catch (e) { say($('#crM', box), e.message, 'bad'); } };
  });
}

// ── Staff feedback and complaints: the Human manager (what was sent to them); the directors (all) ──
export async function feedbackInboxView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi('/api/ops/feedback');
  el.innerHTML = `<h1>Staff feedback</h1><p class="lead" style="margin:0">${d.open} waiting for an answer.</p>
    <div class="cards">${d.feedback.map(f => `<div class="tcard" style="cursor:default"><span class="row"><span class="t" style="font-size:15px">${esc(f.kindLabel)} · ${esc(f.fromName)}${f.fromRole ? ` <small class="muted">${esc(f.fromRole)}</small>` : ''}</span><span class="sub">to ${esc(f.toLabel.toLowerCase())} · ${when(f.at)}</span></span>
      <span>${esc(f.text)}</span>
      ${f.reply ? `<span class="say good" style="margin:0"><b>${esc(f.replyByName)} answered</b>${esc(f.reply)}</span>` : `<span class="btn-row"><button class="mid" data-ans="${esc(f.id)}">Answer</button></span>`}</div>`).join('') || '<div class="empty-box"><b>Nothing yet</b>What staff send shows here.</div>'}</div>`;
  $$('[data-ans]', el).forEach(b => b.onclick = () => {
    const { box, close } = sheet(`<h2>Answer</h2><div class="sfield"><label for="faT">Your answer (they see it on their page)</label><textarea id="faT" rows="4" maxlength="1000"></textarea></div>
      <div id="faM"></div><button class="big" id="faGo">Send answer</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Answer' });
    $('#faGo', box).onclick = async () => { try { await busy($('#faGo', box), () => sapi('/api/ops/feedback/reply', { method: 'POST', body: { id: b.dataset.ans, reply: $('#faT', box).value } })); close(); feedbackInboxView(el); } catch (e) { say($('#faM', box), e.message, 'bad'); } };
  });
}

// ── End-of-day reports ──
export async function eodListView(el, { canSignOff = false } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { reports } = await sapi('/api/ops/eod/list');
  const fc = await sapi('/api/ops/finance-contact').catch(() => ({}));
  el.innerHTML = `<h1>End-of-day reports</h1><p class="lead">Prepared when the manager closes a night. Open one to check it and sign it off.</p>
    <details class="fold" ${fc.email ? '' : 'open'}><summary>Where the report is sent${fc.email ? `: ${esc(fc.email)}` : ' (not set)'}</summary>
      <div class="sfield" style="margin-top:10px"><label for="fcE">Finance email</label><input id="fcE" type="email" value="${esc(fc.email || '')}"></div>
      <div class="sfield"><label for="fcP">Finance phone (a short summary by text, optional)</label><input id="fcP" type="tel" value="${esc(fc.phone || '')}"></div>
      ${fc.emailReady === false ? '<p class="hint" style="color:var(--mustard)">Email sending isn’t set up on the server yet (Brevo key). Reports are saved here either way.</p>' : ''}
      <div id="fcM"></div><button class="mid" id="fcGo">Save</button></details>
    <div class="cards">${reports.map(r => `<button class="tcard ${r.financeApprovedAt ? 'done' : 'warn'}" data-d="${esc(r.date)}"><span class="row"><span class="t" style="font-size:20px">${esc(dayName(r.date))}</span><span class="amt">${money(r.salesPesewas)}</span></span>
      <span class="row"><span class="sub">Closed by ${esc(r.closedByName)} · ${r.sent ? 'emailed to finance' : 'saved here (not emailed)'}</span>${r.financeApprovedAt ? st('paid', `Signed off`) : st('unpaid', 'To sign off')}</span></button>`).join('') || '<div class="empty-box"><b>No reports yet</b>The first one appears when a night is closed.</div>'}</div>`;
  $$('[data-d]', el).forEach(b => b.onclick = () => eodView(el, b.dataset.d, { canSignOff }));
  $('#fcGo', el).onclick = async () => { try { await sapi('/api/ops/finance-contact', { method: 'POST', body: { email: $('#fcE', el).value, phone: $('#fcP', el).value } }); say($('#fcM', el), 'Saved.'); } catch (e) { say($('#fcM', el), e.message, 'bad'); } };
}
export async function eodView(el, date, { canSignOff = false } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { report: r } = await sapi(`/api/ops/eod?date=${encodeURIComponent(date)}`);
  if (!r) { el.innerHTML = '<div class="say warn"><b>Not closed yet</b>This night has no end-of-day report.</div>'; return; }
  const R = r.report, t = R.sales.totals, x = R.exceptions;
  el.innerHTML = `<div class="backbar"><button type="button" class="back-btn" id="back" aria-label="Back to all reports">←<span>All reports</span></button></div><h1>End of day · ${esc(dayName(r.date))}</h1>
    <p class="lead">Prepared ${when(R.preparedAt)} by ${esc(R.preparedByName)} · ${r.sent ? `emailed to ${esc(r.sentTo)}` : esc(r.sendNote || 'not emailed')}${r.financeApprovedAt ? ` · signed off by ${esc(r.financeApprovedByName)}` : ''}</p>
    <h2>Sales and money</h2><div class="nums"><div><span>Sales</span><b>${money(t.salesPesewas)}</b></div><div class="good"><span>Received</span><b>${money(t.paidPesewas)}</b></div><div><span>MoMo / card</span><b>${money(t.digitalPesewas)}</b></div><div><span>Cash</span><b>${money(t.cashPesewas)}</b></div><div><span>MoMo to the club</span><b>${money(t.momoPesewas || 0)}</b></div><div class="${t.owedPesewas ? 'bad' : 'good'}"><span>Still owed</span><b>${money(t.owedPesewas)}</b></div><div><span>Refunds</span><b>${money(t.refundsPesewas)}</b></div><div><span>Free drinks</span><b>${money(t.freeDrinksPesewas)}</b></div><div><span>Discounts</span><b>${money(t.discountsPesewas)}</b></div></div>
    <h2>Things to check</h2>${[x.unpaidTabs.length ? `${x.unpaidTabs.length} unpaid bill(s): ${x.unpaidTabs.map(u => `Tab ${u.number} ${money(u.balancePesewas)} (${esc(u.waiterName)})`).join(', ')}` : '',
      x.cashDifferences.length ? `Cash: ${x.cashDifferences.map(c => `${esc(c.name)} ${esc(cashWord(c.differencePesewas))} (“${esc(c.explanation)}”)`).join('; ')}` : '',
      x.stockDifferences.length ? `Stock: ${x.stockDifferences.map(b => `${esc(b.name)}: ${b.differences.map(d => `${esc(d.name)} ${esc(diffWord(d.difference))}`).join(', ')}`).join('; ')}` : '',
      x.missingReports.length ? `Missing: ${x.missingReports.map(esc).join(', ')}` : '', x.pendingPayments ? `${x.pendingPayments} bill payment(s) still confirming` : '', x.pendingApprovals ? `${x.pendingApprovals} approval(s) waiting` : '']
      .filter(Boolean).map(s => `<div class="say warn">${s}</div>`).join('') || '<div class="say good">Nothing to check: everything matched.</div>'}
    <h2>Waiters</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waiter</th><th class="num">From bar</th><th class="num">Delivered</th><th class="num">Returned</th><th class="num">Broken</th><th class="num">Not delivered</th><th class="num">Sales</th><th class="num">Cash taken</th></tr></thead><tbody>
      ${R.waiters.map(w => `<tr><td><strong>${esc(w.name)}</strong>${w.explanation ? `<br><small class="muted">“${esc(w.explanation)}”</small>` : ''}</td><td class="num">${w.figures.receivedQty}</td><td class="num">${w.figures.deliveredQty}</td><td class="num">${w.figures.returnedQty}</td><td class="num">${w.figures.brokenQty}</td><td class="num">${w.figures.withYouQty}</td><td class="num">${money(w.figures.salesPesewas)}</td><td class="num">${money(w.figures.cashCollectedPesewas)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty-row">None.</td></tr>'}</tbody></table></div>
    <h2>Cash</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Who</th><th class="num">Float</th><th class="num">Taken</th><th class="num">Expected</th><th class="num">Counted</th><th>Difference</th></tr></thead><tbody>
      ${R.cash.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${money(c.floatPesewas)}</td><td class="num">${money(c.takenPesewas)}</td><td class="num">${money(c.expectedPesewas)}</td><td class="num">${c.countedPesewas != null ? money(c.countedPesewas) : 'Not counted'}</td><td>${c.differencePesewas ? `<span class="diff-neg">${esc(cashWord(c.differencePesewas))}</span>` : c.countedPesewas != null ? 'Matches' : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">No cash shifts.</td></tr>'}</tbody></table></div>
    ${R.bars.map(b => `<h2>Bar stock · ${esc(b.station)}</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Opening</th><th class="num">Received</th><th class="num">Handed out</th><th class="num">Free</th><th class="num">Broken</th><th class="num">Expected</th><th class="num">Counted</th></tr></thead><tbody>${b.rows.map(rw => `<tr><td>${esc(rw.name)}</td><td class="num">${rw.opening}</td><td class="num">${rw.received + rw.transferIn + rw.returns}${rw.corrections ? ` <small>(fixed ${rw.corrections > 0 ? '+' : ''}${rw.corrections})</small>` : ''}</td><td class="num">${rw.issued}</td><td class="num">${rw.comps}</td><td class="num">${rw.waste}</td><td class="num">${rw.expected}</td><td class="num">${rw.counted ?? '—'}${rw.difference ? ` <span class="${rw.difference < 0 ? 'diff-neg' : 'diff-pos'}">(${rw.difference > 0 ? '+' : ''}${rw.difference})</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`).join('')}
    <h2>Front office</h2>${R.frontOffice.missing ? '<div class="say warn">Front office report not submitted.</div>' : ''}<p>${R.frontOffice.figures.ticketsChecked} tickets checked · ${R.frontOffice.figures.admitted} people in · ${R.frontOffice.figures.tablesArrived} of ${R.frontOffice.figures.tablesBooked} table bookings arrived · ${R.frontOffice.figures.openIssues} issues still open</p>
    <div class="btn-row"><button class="mid" id="print">Print / save as PDF</button><button class="mid" id="csv">Download for Excel (CSV)</button></div>
    ${canSignOff && !r.financeApprovedAt ? `<h2>Sign off</h2><div class="sfield"><label for="soN">Note (optional)</label><input id="soN" maxlength="400"></div><div id="soM"></div><button class="big" id="soGo">I’ve checked this report: sign off</button>` : ''}
    ${r.financeApprovedAt ? `<div class="say good"><b>Signed off by ${esc(r.financeApprovedByName)}</b>${when(r.financeApprovedAt)}${r.financeNote ? ` · “${esc(r.financeNote)}”` : ''}</div>` : ''}`;
  $('#back', el).onclick = () => eodListView(el, { canSignOff });
  $('#print', el).onclick = () => print();
  $('#csv', el).onclick = () => {
    const rows = [['Section', 'Item', 'Value'], ['Sales', 'Total sales (GHS)', t.salesPesewas / 100], ['Money', 'Received (GHS)', t.paidPesewas / 100], ['Money', 'MoMo/card (GHS)', t.digitalPesewas / 100], ['Money', 'Cash (GHS)', t.cashPesewas / 100], ['Money', 'MoMo to the club, recorded (GHS)', (t.momoPesewas || 0) / 100], ['Money', 'Still owed (GHS)', t.owedPesewas / 100], ['Money', 'Refunds (GHS)', t.refundsPesewas / 100],
      ...R.sales.byProduct.map(p => ['Drinks sold', p.name, p.qty]), ...R.sales.byWaiter.map(w => ['Waiter sales (GHS)', w.name, w.salesPesewas / 100]),
      ...R.cash.map(c => ['Cash difference (GHS)', c.name, (c.differencePesewas || 0) / 100]), ...R.bars.flatMap(b => b.rows.filter(rw => rw.difference).map(rw => [`Stock difference ${b.station}`, rw.name, rw.difference]))];
    const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `memories-end-of-day-${r.date}.csv` }); document.body.append(a); a.click(); a.remove();
  };
  $('#soGo', el) && ($('#soGo', el).onclick = async () => { try { await busy($('#soGo', el), () => sapi('/api/ops/eod/sign-off', { method: 'POST', body: { date: r.date, note: $('#soN', el).value } })); eodView(el, r.date, { canSignOff }); } catch (e) { say($('#soM', el), e.message, 'bad'); } });
  labelTables(el);
}

// ── Who changed what ──
export async function changesView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { changes } = await sapi('/api/ops/changes');
  const v = (field, x) => (x === null || x === undefined ? '—' : /price|cost/.test(field) ? money(x) : typeof x === 'boolean' ? (x ? 'yes' : 'no') : esc(String(x)));
  el.innerHTML = `<h1>Who changed what</h1><p class="lead">Prices, costs and stock: the last 60 days.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead><tbody>
    ${changes.map(c => `<tr><td>${esc(new Date(c.at).toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td><td>${esc(c.byName)}</td><td><strong>${esc(c.refName)}</strong> · ${esc(c.field)}${c.note ? `<br><small class="muted">${esc(c.note)}</small>` : ''}</td><td>${v(c.field, c.from)} → ${v(c.field, c.to)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-row">No changes yet.</td></tr>'}</tbody></table></div>`;
  labelTables(el);
}

// ── Expenses (the manager and finance): what was spent, tonight / this week / this month ──
// Above the month's limit an expense waits for a director, and doesn't count until approved.
export async function expensesView(el, period = 'today') {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const m = await sapi(`/api/ops/money?period=${encodeURIComponent(period)}`);
  const list = m.expenses || [], live = list.filter(e => !e.removed);
  const counted = live.filter(e => !['pending', 'refused'].includes(e.approval));
  const total = counted.reduce((n, e) => n + Number(e.amountPesewas || 0), 0);
  const waiting = live.filter(e => e.approval === 'pending');
  const state = e => (e.removed ? st('cancelled', 'Taken off') : e.approval === 'pending' ? st('waiting', 'Waiting for a director') : e.approval === 'refused' ? st('cancelled', 'Refused') : st('delivered', 'Counted'));
  el.innerHTML = `<h1>Expenses</h1>
    <div class="seg" role="tablist" aria-label="Period" style="grid-template-columns:repeat(3,1fr)">${[['today', 'Tonight'], ['week', '7 days'], ['month', 'This month']].map(([k, l]) => `<button type="button" class="mid ${k === period ? 'on' : ''}" data-per="${k}" role="tab" aria-selected="${k === period}">${l}</button>`).join('')}</div>
    <div class="nums"><div><span>Spent (${esc(m.period?.label || '')})</span><b>${money(total)}</b></div><div class="${waiting.length ? 'warn' : ''}"><span>Waiting for a director</span><b>${waiting.length}</b></div></div>
    <button class="big" id="exAdd">Add an expense</button><div id="exMsgTop"></div>
    <div class="cards">${list.map(e => `<div class="tcard ${e.removed || e.approval === 'refused' ? 'done' : e.approval === 'pending' ? 'warn' : ''}" style="cursor:default">
      <span class="row"><span class="t" style="font-size:18px">${esc(e.categoryLabel)}</span><span class="amt">${money(e.amountPesewas)}</span></span>
      <span>${esc(e.description || '')}</span>
      <span class="row"><span class="sub">${esc(e.date)} · ${esc(e.paidWith)} · ${esc(e.recordedByName || '')}</span>${state(e)}</span>
      ${e.removed ? `<span class="sub">Taken off by ${esc(e.removedByName)}: “${esc(e.removedReason)}”</span>` : ''}${e.decisionNote ? `<span class="sub">${esc(e.decidedByName)}: “${esc(e.decisionNote)}”</span>` : ''}
      ${e.canRemove ? `<span class="btn-row"><button class="mid" data-rm="${esc(e.id)}">Take it off</button></span>` : ''}</div>`).join('') || '<div class="empty-box"><b>No expenses</b>Tap “Add an expense” when money is spent.</div>'}</div>`;
  $$('[data-per]', el).forEach(b => b.onclick = () => expensesView(el, b.dataset.per));
  $('#exAdd', el).onclick = () => expenseSheet(m, r => { expensesView(el, period).then(() => say($('#exMsgTop', el), r?.needsApproval ? 'Saved. It’s above the limit, so it waits for a director.' : 'Expense saved.')); });
  $$('[data-rm]', el).forEach(b => b.onclick = async () => {
    const reason = prompt('Why take it off? (e.g. typed twice)'); if (!reason) return;
    try { await sapi('/api/ops/expenses/remove', { method: 'POST', body: { id: b.dataset.rm, reason } }); expensesView(el, period); } catch (e) { say($('#exMsgTop', el), e.message, 'bad'); }
  });
}

// ── Nights coming up (read only): what's on, tickets sold and left, tables booked ──
export async function nightsView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { nights } = await sapi('/api/ops/nights');
  const day = d => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Accra' });
  el.innerHTML = `<h1>Nights coming up</h1><p class="lead">What’s on, and how it’s selling. Nights are set up by Media.</p>
    <div class="cards">${nights.map(n => `<div class="tcard" style="cursor:default">
      <span class="row"><span class="t" style="font-size:20px">${esc(n.name)}</span><span class="sub">${esc(day(n.date))} · ${when(n.date)}</span></span>
      <span class="sub">${n.doors ? `Doors ${esc(n.doors)} · ` : ''}${esc(n.venue || '')}${n.onSite ? '' : ' · not on the website'}</span>
      <span class="row"><span><b>${n.ticketsSold}</b> tickets sold</span><span><b>${n.tablesBooked}</b> table${n.tablesBooked === 1 ? '' : 's'} booked</span></span>
      ${n.tickets.length ? `<div class="lines-list">${n.tickets.map(t => `<div class="ln"><span>${esc(t.name)} · ${money(t.pricePesewas)}</span><span>${t.sold} sold${t.left !== null ? ` · ${t.left} left` : ''}</span></div>`).join('')}</div>` : ''}
    </div>`).join('') || '<div class="empty-box"><b>No nights coming up</b>Media adds them on the website.</div>'}</div>`;
}

// ── Waiters, one by one (finance): each waiter's night and the report they submitted ──
export async function waitersView(el, date) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/waiters${date ? `?date=${encodeURIComponent(date)}` : ''}`), t = d.totals;
  el.innerHTML = `<h1>Waiters</h1>${dateBar(d.date, 'wDate')}
    <p class="lead">${d.waiters.length} waiter${d.waiters.length === 1 ? '' : 's'} worked${d.missing ? ` · <b>${d.missing} report${d.missing > 1 ? 's' : ''} missing</b>` : d.waiters.length ? ' · every report is in' : ''}.</p>
    <div class="nums"><div><span>Sales</span><b>${money(t.salesPesewas)}</b></div><div class="good"><span>Paid</span><b>${money(t.paidPesewas)}</b></div><div class="${t.unpaidPesewas ? 'bad' : ''}"><span>Unpaid</span><b>${money(t.unpaidPesewas)}</b></div><div><span>Cash taken</span><b>${money(t.cashCollectedPesewas)}</b></div><div><span>MoMo recorded</span><b>${money(t.momoRecordedPesewas)}</b></div><div class="${t.withYouPesewas ? 'warn' : ''}"><span>Drinks not delivered</span><b>${money(t.withYouPesewas)}</b></div></div>
    <div class="cards">${d.waiters.map(w => `<div class="tcard ${w.report ? (w.unpaidPesewas || w.withYouQty ? 'warn' : 'done') : 'warn'}" style="cursor:default">
      <span class="row"><span class="t" style="font-size:20px">${esc(w.name)}</span>${w.report ? st('delivered', `Report in ${when(w.report.at)}`) : st('waiting', 'No report yet')}</span>
      <div class="lines-list">
        <div class="ln"><span>Tables served</span><span>${w.tabs}</span></div>
        <div class="ln"><span>Sales</span><span>${money(w.salesPesewas)}</span></div>
        <div class="ln"><span>Paid</span><span>${money(w.paidPesewas)}</span></div>
        ${w.unpaidPesewas ? `<div class="ln"><span>Unpaid (${w.unpaidTabs.map(u => `Tab ${u.number}`).join(', ')})</span><span>${money(w.unpaidPesewas)}</span></div>` : ''}
        <div class="ln"><span>Cash they took</span><span>${money(w.cashCollectedPesewas)}</span></div>
        <div class="ln"><span>MoMo they recorded</span><span>${money(w.momoRecordedPesewas)}</span></div>
        ${w.withYouQty ? `<div class="ln"><span>Drinks not delivered (${w.withYou.map(x => `${x.qty} × ${esc(x.name)}`).join(', ')})</span><span>${money(w.withYouPesewas)}</span></div>` : ''}
        ${w.brokenQty ? `<div class="ln"><span>Broken (${w.brokenQty})</span><span>${money(w.brokenPesewas)}</span></div>` : ''}
        ${w.freeQty ? `<div class="ln"><span>Free drinks (${w.freeQty})</span><span>${money(w.freePesewas)}</span></div>` : ''}
        ${w.tipsPesewas ? `<div class="ln"><span>Tips (theirs)</span><span>${money(w.tipsPesewas)}</span></div>` : ''}
      </div>
      ${w.report?.explanation ? `<span class="sub">They wrote: “${esc(w.report.explanation)}”</span>` : ''}
    </div>`).join('') || '<div class="empty-box"><b>No waiters that night</b></div>'}</div>`;
  bindDate(el, v => waitersView(el, v), 'wDate');
}

// ── Night accounts (the bar manager; the Manager, directors and finance too) ──
// 1. count what's left → 2. what the drinks should bring → 3. what accounts for it → 4. each seller.
export async function accountsView(el, date, { onCount, onCash } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const a = await sapi(`/api/ops/accounts${date ? `?date=${encodeURIComponent(date)}` : ''}`), m = a.money;
  const line = (label, value, cls = '') => `<div class="ln ${cls}"><span>${label}</span><span>${money(value)}</span></div>`;
  const gap = a.missingAtBarPesewas + a.cashShortPesewas;
  const tone = s => (s === 'short' ? 'bad' : s === 'check' ? 'warn' : 'done');
  el.innerHTML = `<h1>Night accounts</h1>${dateBar(a.date, 'acDate')}
    <ol class="acc-steps">
      <li class="${a.steps.counted ? 'done' : ''}"><b>1. Count what’s left at the bar</b><span>${a.steps.counted ? `Done${a.bars.map(b => b.countedByName ? ` · ${esc(b.name)} by ${esc(b.countedByName)}` : '').join('')}` : 'Not yet: the money below is from the records until the bar counts.'}</span>${!a.steps.counted && onCount ? '<button class="mid" id="acCount">Count now</button>' : ''}</li>
      <li class="${a.steps.cashIn ? 'done' : ''}"><b>2. Collect everyone’s cash</b><span>${a.steps.cashIn ? 'Everyone has handed in their cash.' : 'Some cash isn’t counted or handed in yet (see below).'}</span>${!a.steps.cashIn && onCash ? '<button class="mid" id="acCash">Receive cash</button>' : ''}</li>
      <li class="done"><b>3. Check the result</b><span>Below.</span></li>
    </ol>
    <section class="pos-money">
      <div class="big-line"><span>The drinks should bring</span><b>${money(a.shouldMakePesewas)}</b></div>
      <div class="big-line good"><span>Received</span><b>${money(m.receivedPesewas)}</b></div>
      <div class="big-line ${m.owedPesewas ? 'bad' : ''}"><span>Customers still owe</span><b>${money(m.owedPesewas)}</b></div>
      <div class="big-line ${gap ? 'bad' : 'good'}"><span>Short</span><b>${money(gap)}</b></div>
      <p class="how">${gap ? `${a.missingAtBarPesewas ? `Drinks missing at the bar ${money(a.missingAtBarPesewas)}` : ''}${a.missingAtBarPesewas && a.cashShortPesewas ? ' · ' : ''}${a.cashShortPesewas ? `Cash missing ${money(a.cashShortPesewas)}` : ''}. Who it is: see the names below.` : 'Everything adds up.'}</p>
    </section>
    <details class="fold"><summary>How it adds up</summary><div class="lines-list">
      ${line('Drinks that left the bar (from the count), at today’s prices', a.shouldMakePesewas, 'total')}
      ${line('Cash recorded', m.cashPesewas)}${line('MoMo recorded (check on the MoMo statement)', m.momoPesewas)}${line('Paid online (confirmed by Paystack)', m.onlinePesewas)}
      ${line('Customers still owe', m.owedPesewas)}${m.freePesewas ? line('Free drinks (approved)', m.freePesewas) : ''}${m.brokenPesewas ? line('Broken by staff (recorded)', m.brokenPesewas) : ''}${m.discountsPesewas ? line('Discounts (approved)', m.discountsPesewas) : ''}${m.writtenOffPesewas ? line('Written off (approved)', m.writtenOffPesewas) : ''}${m.pendingReturnsPesewas ? line('On their way back to the bar', m.pendingReturnsPesewas) : ''}${m.stillAtBarPesewas ? line('Billed but still at the bar (taken off)', -m.stillAtBarPesewas) : ''}
      ${line('Drinks missing at the bar', a.missingAtBarPesewas, a.missingAtBarPesewas ? 'bad' : '')}
      ${a.extraAtBarPesewas ? line('More at the bar than the records', a.extraAtBarPesewas) : ''}${a.otherDifferencePesewas ? line('Other difference (price changes, unrecorded sales)', a.otherDifferencePesewas) : ''}
    </div></details>
    ${a.bars.filter(b => b.missing.length).map(b => `<div class="say bad"><b>${esc(b.name)}: drinks missing</b>${b.missing.map(x => `${x.qty} × ${esc(x.name)} (${money(x.valuePesewas)})`).join(', ')}. The bar explains these at the count.</div>`).join('')}
    <h2>Each person who sold tonight</h2>
    <div class="cards">${a.sellers.map(s => `<div class="tcard ${tone(s.state)}" style="cursor:default">
      <span class="row"><span class="t" style="font-size:20px">${esc(s.name)}</span>${st(s.state === 'short' ? 'cancelled' : s.state === 'check' ? 'waiting' : 'delivered', s.state === 'short' ? 'Not aligned' : s.state === 'check' ? 'To check' : 'All good')}</span>
      <div class="lines-list">
        ${line('Drinks taken from the bar', s.takenPesewas)}
        ${line('Paid in cash', s.cashPesewas)}${s.momoPesewas ? line('Paid by MoMo', s.momoPesewas) : ''}${s.onlinePesewas ? line('Paid online', s.onlinePesewas) : ''}
        ${s.owedPesewas ? line('Customers still owe', s.owedPesewas, 'bad') : ''}${s.freePesewas ? line('Free drinks', s.freePesewas) : ''}${s.brokenPesewas ? line('Broken', s.brokenPesewas) : ''}
        ${s.cash ? `<div class="ln"><span>Their cash: recorded ${money(s.cash.recordedPesewas)} · counted ${s.cash.countedPesewas == null ? '—' : money(s.cash.countedPesewas)} · handed in ${s.cash.receivedPesewas == null ? '—' : money(s.cash.receivedPesewas)}</span><span></span></div>` : ''}
      </div>
      ${s.flags.map(f => `<span class="sub acc-flag ${f.level}">${f.level === 'bad' ? '⚠ ' : ''}${esc(f.text)}</span>`).join('')}
    </div>`).join('') || '<div class="empty-box"><b>No sales recorded that night</b></div>'}</div>
    ${a.app ? `<p class="muted">App orders (QR): ${a.app.orders}, ${money(a.app.valuePesewas)}, all paid online before they were made.</p>` : ''}`;
  bindDate(el, v => accountsView(el, v, { onCount, onCash }), 'acDate');
  $('#acCount', el) && ($('#acCount', el).onclick = onCount);
  $('#acCash', el) && ($('#acCash', el).onclick = onCash);
}

// ── Tickets tonight (the Manager, the front office): sold online and at the gate, tables, came in ──
export async function ticketsView(el, date) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/tickets${date ? `?date=${encodeURIComponent(date)}` : ''}`), t = d.totals;
  el.innerHTML = `<h1>Tickets</h1>${dateBar(d.date, 'tkDate')}
    <div class="nums"><div><span>Tickets sold</span><b>${t.ticketsSold}</b></div><div class="good"><span>Tickets and tables</span><b>${money(t.valuePesewas)}</b></div><div><span>Came in</span><b>${t.cameIn}</b></div><div><span>Tables booked</span><b>${t.tablesBooked}</b></div></div>
    ${d.nights.map(n => `<div class="tcard" style="cursor:default"><span class="t" style="font-size:20px">${esc(n.name)}</span>
      <div class="lines-list">
        <div class="ln"><span>Online (paid on Paystack)</span><span>${n.online.tickets} · ${money(n.online.valuePesewas)}</span></div>
        <div class="ln"><span>At the gate: cash</span><span>${money(n.gate.cashPesewas)}</span></div>
        <div class="ln"><span>At the gate: MoMo</span><span>${money(n.gate.momoPesewas)}</span></div>
        <div class="ln"><span>At the gate: tickets</span><span>${n.gate.tickets}</span></div>
        ${n.guestList ? `<div class="ln"><span>Guest list (free)</span><span>${n.guestList}</span></div>` : ''}
        ${n.byType.map(x => `<div class="ln"><span>${esc(x.name)}</span><span>${x.sold} sold · ${money(x.valuePesewas)}</span></div>`).join('')}
        <div class="ln"><span>Tables booked (${n.tables.arrived} arrived)</span><span>${n.tables.booked} · ${money(n.tables.valuePesewas)}</span></div>
      </div>
      ${n.gate.sellers.length ? `<span class="sub">Sold at the gate by: ${n.gate.sellers.map(s => `${esc(s.name)} ${s.tickets} (cash ${money(s.cashPesewas)}, MoMo ${money(s.momoPesewas)})`).join(' · ')}</span>` : ''}
    </div>`).join('') || '<div class="empty-box"><b>No night on that date</b></div>'}`;
  bindDate(el, v => ticketsView(el, v), 'tkDate');
}

// ── Find an order: a table booking or tickets, by code, phone or name ──
export async function findOrderView(el, q = '') {
  el.innerHTML = `<h1>Find an order</h1><p class="lead">A table booking or tickets: type the code (e.g. TBL-AB12CD), the customer’s phone number, or their name.</p>
    <form id="foForm" class="sfield" style="display:grid;grid-template-columns:1fr auto;gap:8px" novalidate><input id="foQ" placeholder="TBL-…, 024…, or a name" value="${esc(q)}" autocomplete="off" aria-label="Code, phone or name"><button class="mid" type="submit">Find</button></form>
    <div id="foOut"></div>`;
  const run = async query => {
    const out = $('#foOut', el); out.innerHTML = '<div class="loading">Looking…</div>';
    try {
      const r = await sapi(`/api/ops/find-order?q=${encodeURIComponent(query)}`);
      out.innerHTML = r.orders.map(o => `<div class="tcard ${o.arrived ? 'done' : ''}" style="cursor:default">
        <span class="row"><span class="t" style="font-size:20px">${esc(o.name || 'Guest')}</span><span class="sub">${esc(o.code)}</span></span>
        <span><b>${esc(o.what)}</b> · ${esc(o.night)}${o.nightDate ? ` · ${esc(dayName(String(o.nightDate).slice(0, 10)))}` : ''}</span>
        ${o.bottles.length ? `<span>Bottles: ${o.bottles.map(b => `${b.quantity} × ${esc(b.name)}`).join(', ')}${o.kind === 'table' ? (o.bottlesServed ? ' · served' : ' · not served yet') : ''}</span>` : ''}
        <div class="lines-list"><div class="ln"><span>Paid</span><span>${money(o.amountPesewas)}</span></div><div class="ln"><span>How</span><span>${esc(o.paid)}</span></div>
          ${o.promo ? `<div class="ln"><span>Promo</span><span>${esc(o.promo)}</span></div>` : ''}<div class="ln"><span>Phone</span><span>…${esc(o.phoneLast4)}</span></div>
          ${o.kind === 'table' ? `<div class="ln"><span>Table</span><span>${o.tableNumber ? `Table ${esc(o.tableNumber)}` : 'No number yet'}${o.guestsArrived ? ` · ${o.guestsArrived} people in` : ''}</span></div>` : `<div class="ln"><span>Tickets</span><span>${o.tickets}</span></div>`}
          <div class="ln"><span>Arrived</span><span>${o.arrived ? when(o.arrivedAt) : 'Not yet'}</span></div><div class="ln"><span>Booked</span><span>${esc(String(o.bookedAt).slice(0, 10))}</span></div></div>
      </div>`).join('') || `<div class="empty-box"><b>Nothing found for “${esc(query)}”</b>Check the code or try the phone number.</div>`;
    } catch (e) { say(out, e.message, 'bad'); }
  };
  $('#foForm', el).onsubmit = ev => { ev.preventDefault(); const v = $('#foQ', el).value.trim(); if (v) run(v); };
  if (q) run(q); else $('#foQ', el).focus();
}
