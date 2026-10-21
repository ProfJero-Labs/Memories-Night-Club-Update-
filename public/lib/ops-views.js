// Views shared by the manager (control room) and the finance officer (finance.html):
// Today's sales · Closing the night · Approvals · Products & prices · Stock & counts · Staff reports
// & cash · End-of-day reports · Who changed what. Each takes an element to draw into.
import { $, $$, esc } from '../app.js';
import { sapi } from '../staff.js';
import { sheet, say, st, busy, ghsIn, moneyField, money, when, dayName } from './ops-ui.js';

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
export async function salesView(el, date) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/sales${date ? `?date=${date}` : ''}`), t = d.totals;
  el.innerHTML = `<h1>Today’s sales</h1>${dateBar(d.date)}<p class="lead">${esc(dayName(d.date))} · ${d.night.status === 'closed' ? `closed by ${esc(d.night.closedByName || '')}` : 'open'}. A sale is a drink on a bill; money is what has actually been paid.</p>
    <div class="nums">
      <div><span>Sales</span><b>${money(t.salesPesewas)}</b></div><div class="good"><span>Money received</span><b>${money(t.paidPesewas)}</b></div>
      <div><span>MoMo / card (confirmed)</span><b>${money(t.digitalPesewas)}</b></div><div><span>Cash (recorded)</span><b>${money(t.cashPesewas)}</b></div>
      <div><span>MoMo to the club (recorded)</span><b>${money(t.momoPesewas || 0)}</b></div>
      <div class="${t.owedPesewas ? 'bad' : 'good'}"><span>Still owed (${t.unpaidTabs} bills)</span><b>${money(t.owedPesewas)}</b></div><div><span>Open tabs</span><b>${t.openTabs}</b></div>
      <div><span>Free drinks (${t.freeDrinksQty})</span><b>${money(t.freeDrinksPesewas)}</b></div><div><span>Discounts</span><b>${money(t.discountsPesewas)}</b></div>
      <div><span>Refunds</span><b>${money(t.refundsPesewas)}</b></div><div><span>Cancelled orders</span><b>${t.cancelledOrders}</b></div></div>
    ${d.unpaid.length ? `<h2>Unpaid bills</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tab</th><th>Table</th><th>Waiter</th><th class="num">Owed</th></tr></thead><tbody>${d.unpaid.map(u => `<tr><td>Tab ${u.number}</td><td>${esc(u.table)}</td><td>${esc(u.waiterName)}</td><td class="num">${money(u.balancePesewas)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h2>By waiter</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waiter</th><th class="num">Tabs</th><th class="num">Sales</th><th class="num">Paid</th><th class="num">Unpaid</th><th>Report</th></tr></thead><tbody>
      ${d.byWaiter.map(w => `<tr><td><strong>${esc(w.name)}</strong></td><td class="num">${w.tabs}</td><td class="num">${money(w.salesPesewas)}</td><td class="num">${money(w.paidPesewas)}</td><td class="num">${money(w.unpaidPesewas)}</td><td>${w.report === 'submitted' ? st('paid', 'In') : st('unpaid', 'Not yet')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">No waiter tabs yet.</td></tr>'}</tbody></table></div>
    <h2>By bar</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bar</th><th class="num">Orders</th><th class="num">Sales</th><th class="num">Paid</th></tr></thead><tbody>
      ${d.byStation.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${s.orders}</td><td class="num">${money(s.salesPesewas)}</td><td class="num">${money(s.paidPesewas)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-row">Nothing yet.</td></tr>'}</tbody></table></div>
    <h2>By payment</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>How</th><th class="num">Amount</th></tr></thead><tbody>${d.byMethod.map(m => `<tr><td>${esc(m.method)}</td><td class="num">${money(m.amountPesewas)}</td></tr>`).join('')}</tbody></table></div>
    ${d.momoPayments?.length ? `<h2>MoMo to check on the statement</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Transaction ID</th><th>Tab</th><th>From</th><th>Recorded by</th><th class="num">Amount</th></tr></thead><tbody>${d.momoPayments.map(m => `<tr><td><b>${esc(m.momoRef)}</b></td><td>Tab ${m.tabNumber}</td><td>${esc(m.momoFrom || '—')}</td><td>${esc(m.byName)} ${when(m.at)}</td><td class="num">${money(m.amountPesewas)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h2>By drink</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Sold</th><th class="num">Value</th></tr></thead><tbody>${d.byProduct.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td class="num">${money(p.valuePesewas)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-row">Nothing yet.</td></tr>'}</tbody></table></div>`;
  bindDate(el, v => salesView(el, v)); labelTables(el);
}

// ── Closing the night (manager) ──
export async function closingView(el, date, { canClose = false } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/closing${date ? `?date=${date}` : ''}`);
  const closed = d.night.status === 'closed';
  el.innerHTML = `<h1>Close the night</h1>${dateBar(d.date)}<p class="lead">${esc(dayName(d.date))}. Each step shows who has finished and what still needs doing.</p>
    <div class="stepbar">${d.steps.map(s => `<div class="${s.done ? 'done' : ''}"><span><b>${esc(s.label)}</b><small>${esc(s.detail)}</small></span>${s.done ? st('paid', 'Done') : st('unpaid', 'Waiting')}</div>`).join('')}</div>
    <div id="clMsg"></div>
    <h2>1. Waiters</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waiter</th><th class="num">Sales</th><th class="num">Not delivered</th><th class="num">Unpaid</th><th>Report</th></tr></thead><tbody>
      ${d.waiters.map(w => `<tr><td><strong>${esc(w.name)}</strong>${w.explanation ? `<br><small class="muted">“${esc(w.explanation)}”</small>` : ''}</td><td class="num">${money(w.salesPesewas)}</td><td class="num">${w.withYouQty ? `<span class="diff-neg">${w.withYouQty}</span>` : 0}</td><td class="num">${w.unpaidPesewas ? `<span class="diff-neg">${money(w.unpaidPesewas)}</span>` : money(0)}</td><td>${w.submitted ? st('paid', 'In') : st('unpaid', 'Not yet')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">No waiters worked tonight.</td></tr>'}</tbody></table></div>
    <h2>2. Bar stock</h2>${d.bars.map(b => `<div class="tcard ${!b.counted || b.differences.length ? 'warn' : 'done'}" style="cursor:default"><span class="row"><span class="t">${esc(b.name)}</span>${b.counted ? (b.reviewed ? st('paid', 'Reviewed') : st('ready', 'Counted')) : st('unpaid', 'Not counted')}</span>
      ${b.countedByName ? `<span class="sub">Counted by ${esc(b.countedByName)}</span>` : ''}
      ${b.differences.length ? `<span>${b.differences.map(x => `<b>${esc(x.name)}</b>: ${esc(diffWord(x.difference))}`).join('<br>')}</span>` : b.counted ? '<span class="sub">Everything matched.</span>' : ''}
      ${b.counted && !b.reviewed ? `<button class="mid" data-review="${esc(b.stationId)}">Mark reviewed</button>` : ''}</div>`).join('') || '<p class="muted">No bar activity tonight.</p>'}
    <h2>3. Cash</h2>${d.cash.map(c => `<div class="tcard ${c.differencePesewas ? 'warn' : 'done'}" style="cursor:default"><span class="row"><span class="t">${esc(c.name)}</span>${c.status === 'open' ? st('unpaid', 'Not counted') : c.status === 'reviewed' ? st('paid', 'Reviewed') : st('ready', 'Counted')}</span>
      <span class="sub">Should have ${money(c.expectedPesewas)}${c.countedPesewas != null ? ` · counted ${money(c.countedPesewas)}` : ''}</span>
      ${c.differencePesewas ? `<span class="diff-neg">${esc(cashWord(c.differencePesewas))}</span><span class="sub">“${esc(c.explanation)}”</span>` : ''}
      ${c.status === 'submitted' ? `<button class="mid" data-cash="${esc(c.id)}">Mark reviewed</button>` : ''}</div>`).join('') || '<p class="muted">Nobody took cash tonight.</p>'}
    <h2>4. Front office</h2>${d.frontOffice ? `<div class="say good"><b>Submitted by ${esc(d.frontOffice.name)}</b>${d.frontOffice.figures.ticketsChecked} tickets checked · ${d.frontOffice.figures.admitted} people in · ${d.frontOffice.figures.tablesArrived} of ${d.frontOffice.figures.tablesBooked} tables arrived · ${d.frontOffice.figures.openIssues} open issues${d.frontOffice.note ? `<br>“${esc(d.frontOffice.note)}”` : ''}</div>` : '<p class="muted">Not submitted yet.</p>'}
    <h2>5. Approvals</h2><p class="muted" style="margin:0">${d.pendingApprovals ? `${d.pendingApprovals} waiting: see Approvals.` : 'Nothing waiting.'}</p>
    ${closed ? `<div class="say good"><b>This night is closed</b>The end-of-day report is saved for finance.</div>` : canClose ? '<h2>6. Close the night</h2><p class="muted" style="margin:0">This prepares the end-of-day report, sends it to finance, and locks the night’s records.</p><button class="big" id="closeGo">Close the night and send the report</button>' : ''}`;
  bindDate(el, v => closingView(el, v, { canClose })); labelTables(el);
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
  const decide = async (id, approve) => { const note = approve ? '' : prompt('Why refuse? (optional)') ?? null; if (note === null) return; try { await sapi('/api/ops/approvals/decide', { method: 'POST', body: { id, approve, note } }); approvalsView(el); } catch (e) { say($('#apMsg', el), e.message, 'bad'); } };
  $$('[data-yes]', el).forEach(b => b.onclick = () => decide(b.dataset.yes, true));
  $$('[data-no]', el).forEach(b => b.onclick = () => decide(b.dataset.no, false));
}

// ── Products & prices ──
export async function productsView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { products, units } = await sapi('/api/ops/products');
  el.innerHTML = `<h1>Drinks and prices</h1><p class="lead">New orders use the price here. A bill already sent keeps its price. Every change is recorded with who made it.</p>
    <button class="big" id="pAdd">Add a drink</button><div id="pMsg"></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Selling</th><th class="num">Cost</th><th class="num">Low at</th><th>Status</th><th></th></tr></thead><tbody>
    ${products.map(p => `<tr><td><strong>${esc(p.name)}</strong><br><small class="muted">${esc(p.category)} · ${esc(p.unit)}${p.updatedByName ? ` · changed by ${esc(p.updatedByName)}` : ''}</small></td><td class="num">${money(p.pricePesewas)}</td><td class="num">${p.costPesewas ? money(p.costPesewas) : '—'}</td><td class="num">${p.lowStock || '—'}</td><td>${p.available ? st('paid', 'On sale') : st('cancelled', 'Finished')}</td><td class="actions"><button class="sbtn" data-edit="${esc(p.id)}">Change</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">No drinks yet.</td></tr>'}</tbody></table></div>`;
  const form = (p = null) => {
    const { box, close } = sheet(`<h2>${p ? `Change ${esc(p.name)}` : 'Add a drink'}</h2>
      <div class="sfield"><label for="pfN">Name</label><input id="pfN" maxlength="60" value="${esc(p?.name || '')}"></div>
      <div class="sfield"><label for="pfC">Group (e.g. Beer, Spirits, Soft)</label><input id="pfC" maxlength="30" value="${esc(p?.category || '')}"></div>
      <div class="sfield"><label for="pfU">Sold by the</label><select id="pfU">${units.map(u => `<option ${u === (p?.unit || 'bottle') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      ${moneyField('pfP', 'Selling price (GHS)', p ? String(p.pricePesewas / 100) : '')}${moneyField('pfK', 'Cost to the club (GHS, optional)', p?.costPesewas ? String(p.costPesewas / 100) : '')}
      <div class="sfield"><label for="pfL">Warn when stock is down to (optional)</label><input id="pfL" inputmode="numeric" value="${esc(p?.lowStock || '')}"></div>
      <label class="check"><input type="checkbox" id="pfT" ${p?.tracked === false ? '' : 'checked'}> Count it at the bar (bottles and cans)</label>
      <label class="check"><input type="checkbox" id="pfA" ${p?.available === false ? '' : 'checked'}> On sale tonight</label>
      <div id="pfM"></div><button class="big" id="pfGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#pfGo', box).onclick = async () => {
      const price = ghsIn($('#pfP', box).value), cost = $('#pfK', box).value ? ghsIn($('#pfK', box).value) : '';
      if (p && price !== p.pricePesewas && !confirm(`Change the price of ${p.name} from ${money(p.pricePesewas)} to ${money(price)}? New orders will use it.`)) return;
      try { await busy($('#pfGo', box), () => sapi('/api/ops/products', { method: 'POST', body: { id: p?.id, name: $('#pfN', box).value, category: $('#pfC', box).value, unit: $('#pfU', box).value, pricePesewas: price, costPesewas: cost, lowStock: $('#pfL', box).value, tracked: $('#pfT', box).checked, available: $('#pfA', box).checked } })); close(); productsView(el); }
      catch (e) { say($('#pfM', box), e.message, 'bad'); }
    };
  };
  $('#pAdd', el).onclick = () => form();
  $$('[data-edit]', el).forEach(b => b.onclick = () => form(products.find(x => x.id === b.dataset.edit)));
  labelTables(el);
}

// ── Stock & counts ──
export async function stockAdminView(el, date, stationId) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { stations, products } = await sapi('/api/ops/products');
  const sid = stationId || stations[0]?.id;
  if (!sid) { el.innerHTML = '<div class="empty-box"><b>No bars yet</b>Add one under Setup → Bar orders.</div>'; return; }
  const [s, dl] = await Promise.all([sapi(`/api/ops/stock?stationId=${encodeURIComponent(sid)}${date ? `&date=${date}` : ''}`), sapi(`/api/ops/stock/deliveries?stationId=${encodeURIComponent(sid)}`).catch(() => ({ deliveries: [] }))]);
  const dlState = x => (x.status === 'pending' ? st('unpaid', x.byBar ? 'Waiting for you to confirm' : 'Waiting for the bar to confirm') : x.status === 'rejected' ? st('cancelled', 'Didn’t arrive') : x.confirmedQty !== x.qty ? st('part_paid', `Bar counted ${x.confirmedQty}`) : st('paid', 'Confirmed'));
  el.innerHTML = `<h1>Stock</h1><div class="toolbar" style="margin:0">${stations.length > 1 ? `<select id="stSel">${stations.map(x => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<strong>${esc(s.station.name)}</strong>`}</div>${dateBar(s.date)}
    <p class="lead">Expected = opening + received + moved in + returned − handed out − broken − moved out.${s.closing ? ` Counted by ${esc(s.closing.byName)}${s.closing.reviewedByName ? `, reviewed by ${esc(s.closing.reviewedByName)}` : ''}.` : ' Not counted yet.'}</p>
    <button class="big" id="rcv">Record new stock</button><p class="muted" style="margin:0">New stock counts once the bar confirms it arrived. Stock the bar records needs your confirmation.</p><div id="stMsg"></div>
    ${dl.deliveries.length ? `<h2>New stock (last 7 days)</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Recorded</th><th>Recorded by</th><th>Status</th><th>Confirmed by</th><th></th></tr></thead><tbody>
      ${dl.deliveries.map(x => `<tr><td><strong>${esc(x.productName)}</strong>${x.supplier ? `<br><small class="muted">${esc(x.supplier)}${x.reference ? ` · ${esc(x.reference)}` : ''}</small>` : ''}</td><td class="num">${x.qty}</td><td>${esc(x.recordedByName)}<br><small class="muted">${when(x.recordedAt)}</small></td><td>${dlState(x)}${x.confirmNote ? `<br><small class="muted">${esc(x.confirmNote)}</small>` : ''}</td><td>${x.confirmedByName ? `${esc(x.confirmedByName)}<br><small class="muted">${when(x.confirmedAt)}</small>` : ''}</td>
        <td>${x.canConfirm ? `<button class="sbtn" data-dl="${esc(x.id)}">Confirm ${x.qty}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Opening</th><th class="num">Received</th><th class="num">Moved in</th><th class="num">Moved out</th><th class="num">Returned</th><th class="num">Handed out</th><th class="num">Free</th><th class="num">Broken</th><th class="num">Expected</th><th class="num">Counted</th><th>Difference</th></tr></thead><tbody>
    ${s.rows.map(r => `<tr><td><strong>${esc(r.name)}</strong>${r.low ? ` ${st('unpaid', 'Low')}` : ''}</td><td class="num">${r.opening}</td><td class="num">${r.received}</td><td class="num">${r.transferIn}</td><td class="num">${r.transferOut}</td><td class="num">${r.returns}</td><td class="num">${r.issued}</td><td class="num">${r.comps}</td><td class="num">${r.waste}</td><td class="num"><b>${r.expected}</b></td><td class="num">${r.counted ?? '—'}</td>
      <td>${r.difference ? `<span class="${r.difference < 0 ? 'diff-neg' : 'diff-pos'}">${esc(diffWord(r.difference))}</span><br><small class="muted">${esc(s.reasons[r.reason] || '')}${r.note ? ` · ${esc(r.note)}` : ''}</small>` : r.counted != null ? 'Matches' : ''}</td></tr>`).join('')}</tbody></table></div>
    ${s.closing && s.closing.status !== 'reviewed' ? '<button class="mid" id="rev">Mark this count reviewed</button>' : ''}`;
  bindDate(el, v => stockAdminView(el, v, sid));
  $('#stSel', el) && ($('#stSel', el).onchange = e => stockAdminView(el, s.date, e.target.value));
  $('#rev', el) && ($('#rev', el).onclick = async () => { try { await sapi('/api/ops/stock/review', { method: 'POST', body: { stationId: sid, date: s.date } }); stockAdminView(el, s.date, sid); } catch (e) { say($('#stMsg', el), e.message, 'bad'); } });
  $$('[data-dl]', el).forEach(b => b.onclick = async () => { try { await busy(b, () => sapi('/api/ops/stock/delivery', { method: 'POST', body: { id: b.dataset.dl, action: 'confirm' } })); stockAdminView(el, s.date, sid); } catch (e) { say($('#stMsg', el), e.message, 'bad'); } });
  $('#rcv', el).onclick = () => {
    const { box, close } = sheet(`<h2>New stock</h2><p class="muted" style="margin:0">The bar confirms it when it arrives; only then does it count.</p><div class="sfield"><label for="rvP">Drink</label><select id="rvP">${products.filter(p => p.tracked).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="rvB">Into which bar</label><select id="rvB">${stations.map(x => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="rvQ">How many</label><input id="rvQ" inputmode="numeric"></div><div class="sfield"><label for="rvS">Supplier</label><input id="rvS" maxlength="80"></div>
      <div class="sfield"><label for="rvR">Invoice or reference</label><input id="rvR" maxlength="60"></div>${moneyField('rvC', 'Cost of one (GHS)')}
      <div id="rvM"></div><button class="big" id="rvGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#rvGo', box).onclick = async () => { try { await busy($('#rvGo', box), () => sapi('/api/ops/stock/received', { method: 'POST', body: { productId: $('#rvP', box).value, stationId: $('#rvB', box).value, qty: Number($('#rvQ', box).value), supplier: $('#rvS', box).value, reference: $('#rvR', box).value, unitCostPesewas: $('#rvC', box).value ? ghsIn($('#rvC', box).value) : '' } })); close(); await stockAdminView(el, s.date, sid); say($('#stMsg', el), 'Saved. The bar confirms it when it arrives.'); } catch (e) { say($('#rvM', box), e.message, 'bad'); } };
  };
  labelTables(el);
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
  el.innerHTML = `<button class="link" id="back" style="justify-self:start">← All reports</button><h1>End of day · ${esc(dayName(r.date))}</h1>
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
    ${R.bars.map(b => `<h2>Bar stock · ${esc(b.station)}</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Opening</th><th class="num">Received</th><th class="num">Handed out</th><th class="num">Free</th><th class="num">Broken</th><th class="num">Expected</th><th class="num">Counted</th></tr></thead><tbody>${b.rows.map(rw => `<tr><td>${esc(rw.name)}</td><td class="num">${rw.opening}</td><td class="num">${rw.received + rw.transferIn + rw.returns}</td><td class="num">${rw.issued}</td><td class="num">${rw.comps}</td><td class="num">${rw.waste}</td><td class="num">${rw.expected}</td><td class="num">${rw.counted ?? '—'}${rw.difference ? ` <span class="${rw.difference < 0 ? 'diff-neg' : 'diff-pos'}">(${rw.difference > 0 ? '+' : ''}${rw.difference})</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`).join('')}
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
