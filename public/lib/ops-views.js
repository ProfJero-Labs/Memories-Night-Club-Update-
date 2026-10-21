// Views shared by the manager and director (night.html) and the finance officer (finance.html):
// Money (in, out, profit; expenses) · Today's sales · Closing the night · Approvals · Products &
// prices · Stock & counts · Staff reports & cash · End-of-day reports · Who changed what. Each takes
// an element to draw into.
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
// Finance sets the selling price and the cost price; everyone else with access only looks.
export async function productsView(el, { canEdit = true } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { products, units } = await sapi('/api/ops/products');
  const noCost = products.filter(p => !p.costPesewas).length;
  el.innerHTML = `<h1>Drinks and prices</h1><p class="lead">${canEdit ? 'You set the selling price and the cost price (what the club pays for one), so the director sees the profit.' : 'Finance sets the prices.'} A bill already sent keeps its price. Every change is recorded with who made it.</p>
    ${canEdit ? '<button class="big" id="pAdd">Add a drink</button>' : ''}<div id="pMsg"></div>
    ${noCost && canEdit ? `<div class="say warn"><b>${noCost} drink${noCost > 1 ? 's have' : ' has'} no cost price</b>Add it, or the profit on ${noCost > 1 ? 'them' : 'it'} can’t be worked out.</div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Selling</th><th class="num">Cost</th><th class="num">Made on one</th><th>Status</th><th></th></tr></thead><tbody>
    ${products.map(p => `<tr><td><strong>${esc(p.name)}</strong><br><small class="muted">${esc(p.category)} · ${esc(p.unit)}${p.updatedByName ? ` · changed by ${esc(p.updatedByName)}` : ''}</small></td><td class="num">${money(p.pricePesewas)}</td><td class="num">${p.costPesewas ? money(p.costPesewas) : st('unpaid', 'Missing')}</td><td class="num">${p.costPesewas ? money(p.pricePesewas - p.costPesewas) : '—'}</td><td>${p.available ? st('paid', 'On sale') : st('cancelled', 'Finished')}</td><td class="actions">${canEdit ? `<button class="sbtn" data-edit="${esc(p.id)}">Change</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">No drinks yet.</td></tr>'}</tbody></table></div>`;
  const form = (p = null) => {
    const { box, close } = sheet(`<h2>${p ? `Change ${esc(p.name)}` : 'Add a drink'}</h2>
      <div class="sfield"><label for="pfN">Name</label><input id="pfN" maxlength="60" value="${esc(p?.name || '')}"></div>
      <div class="sfield"><label for="pfC">Group (e.g. Beer, Spirits, Soft)</label><input id="pfC" maxlength="30" value="${esc(p?.category || '')}"></div>
      <div class="sfield"><label for="pfU">Sold by the</label><select id="pfU">${units.map(u => `<option ${u === (p?.unit || 'bottle') ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      ${moneyField('pfP', 'Selling price (GHS)', p ? String(p.pricePesewas / 100) : '')}${moneyField('pfK', 'Cost price: what the club pays for one (GHS)', p?.costPesewas ? String(p.costPesewas / 100) : '')}
      <div class="sfield"><label for="pfL">Warn when stock is down to (optional)</label><input id="pfL" inputmode="numeric" value="${esc(p?.lowStock || '')}"></div>
      <label class="check"><input type="checkbox" id="pfT" ${p?.tracked === false ? '' : 'checked'}> Count it at the bar (bottles and cans)</label>
      <label class="check"><input type="checkbox" id="pfA" ${p?.available === false ? '' : 'checked'}> On sale tonight</label>
      <div id="pfM"></div><button class="big" id="pfGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#pfGo', box).onclick = async () => {
      const price = ghsIn($('#pfP', box).value), cost = $('#pfK', box).value !== '' ? ghsIn($('#pfK', box).value) : '';
      if (p && price !== p.pricePesewas && !confirm(`Change the price of ${p.name} from ${money(p.pricePesewas)} to ${money(price)}? New orders will use it.`)) return;
      try { await busy($('#pfGo', box), () => sapi('/api/ops/products', { method: 'POST', body: { id: p?.id, name: $('#pfN', box).value, category: $('#pfC', box).value, unit: $('#pfU', box).value, pricePesewas: price, costPesewas: cost, lowStock: $('#pfL', box).value, tracked: $('#pfT', box).checked, available: $('#pfA', box).checked } })); close(); productsView(el); }
      catch (e) { say($('#pfM', box), e.message, 'bad'); }
    };
  };
  $('#pAdd', el) && ($('#pAdd', el).onclick = () => form());
  $$('[data-edit]', el).forEach(b => b.onclick = () => form(products.find(x => x.id === b.dataset.edit)));
  labelTables(el);
}

// ── Stock & counts ──
export async function stockAdminView(el, date, stationId, { role = '' } = {}) {
  const buyer = ['finance', 'director', 'superAdmin'].includes(role), explainer = ['manager', 'director', 'superAdmin'].includes(role);
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { stations, products } = await sapi('/api/ops/products');
  const sid = stationId || stations[0]?.id;
  if (!sid) { el.innerHTML = '<div class="empty-box"><b>No bars yet</b>Add one under Setup → Bar orders.</div>'; return; }
  const [s, dl] = await Promise.all([sapi(`/api/ops/stock?stationId=${encodeURIComponent(sid)}${date ? `&date=${date}` : ''}`), sapi(`/api/ops/stock/deliveries?stationId=${encodeURIComponent(sid)}`).catch(() => ({ deliveries: [] }))]);
  const dlState = x => (x.status === 'pending' ? st('unpaid', x.byBar ? 'Waiting for finance or the manager' : 'Waiting for the bar to confirm') : x.status === 'rejected' ? st('cancelled', 'Didn’t arrive') : x.purchase ? st('paid', 'Bought: in stock') : x.confirmedQty !== x.qty ? st('part_paid', `Bar counted ${x.confirmedQty}`) : st('paid', 'Confirmed by the bar'));
  const oc = s.openingCount;
  el.innerHTML = `<h1>Stock</h1><div class="toolbar" style="margin:0">${stations.length > 1 ? `<select id="stSel">${stations.map(x => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<strong>${esc(s.station.name)}</strong>`}</div>${dateBar(s.date)}
    <p class="lead">Expected = opening + received + moved in + returned − handed out − broken − moved out.${s.closing ? ` Counted by ${esc(s.closing.byName)}${s.closing.reviewedByName ? `, reviewed by ${esc(s.closing.reviewedByName)}` : ''}.` : ' Not counted yet.'}</p>
    ${oc ? `<div class="say ${oc.differences.length && !oc.explanation ? 'warn' : 'good'}"><b>Bar’s count when it opened (${esc(oc.byName)}, ${when(oc.at)})</b>${oc.differences.length ? oc.differences.map(x => `${esc(x.name)}: system ${x.expected}, bar found ${x.counted} (${Math.abs(x.difference)} ${x.difference < 0 ? 'fewer' : 'more'})`).join('<br>') : 'Everything matched.'}
      ${oc.explanation ? `<br><b style="margin-top:6px">Manager: ${esc(oc.explanation)}</b><small>${esc(oc.explainedByName)}</small>` : oc.differences.length ? `<br>${explainer ? '<button class="mid" id="explain" style="margin-top:8px">Explain the difference</button>' : 'Waiting for the manager to explain.'}` : ''}</div>` : '<p class="muted" style="margin:0">The bar hasn’t counted tonight’s stock yet. Sales go on; the count is compared when it comes in.</p>'}
    <button class="big" id="rcv">${buyer ? 'Record drinks bought' : 'Add new stock'}</button><p class="muted" style="margin:0">${buyer ? 'Drinks you record are in the bar’s stock straight away.' : 'The bar confirms it when it arrives; finance sees it.'}</p><div id="stMsg"></div>
    ${dl.deliveries.length ? `<h2>New stock (last 7 days)</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Recorded</th><th>Recorded by</th><th>Status</th><th>Confirmed by</th><th></th></tr></thead><tbody>
      ${dl.deliveries.map(x => `<tr><td><strong>${esc(x.productName)}</strong>${x.supplier ? `<br><small class="muted">${esc(x.supplier)}${x.reference ? ` · ${esc(x.reference)}` : ''}</small>` : ''}</td><td class="num">${x.qty}</td><td>${esc(x.recordedByName)}<br><small class="muted">${when(x.recordedAt)}</small></td><td>${dlState(x)}${x.confirmNote ? `<br><small class="muted">${esc(x.confirmNote)}</small>` : ''}</td><td>${x.confirmedByName ? `${esc(x.confirmedByName)}<br><small class="muted">${when(x.confirmedAt)}</small>` : ''}</td>
        <td>${x.canConfirm ? `<button class="sbtn" data-dl="${esc(x.id)}">Confirm ${x.qty}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Opening</th><th class="num">Received</th><th class="num">Moved in</th><th class="num">Moved out</th><th class="num">Returned</th><th class="num">Handed out</th><th class="num">Free</th><th class="num">Broken</th><th class="num">Expected</th><th class="num">Counted</th><th>Difference</th></tr></thead><tbody>
    ${s.rows.map(r => `<tr><td><strong>${esc(r.name)}</strong>${r.low ? ` ${st('unpaid', 'Low')}` : ''}</td><td class="num">${r.opening}</td><td class="num">${r.received}</td><td class="num">${r.transferIn}</td><td class="num">${r.transferOut}</td><td class="num">${r.returns}</td><td class="num">${r.issued}</td><td class="num">${r.comps}</td><td class="num">${r.waste}</td><td class="num"><b>${r.expected}</b></td><td class="num">${r.counted ?? '—'}</td>
      <td>${r.difference ? `<span class="${r.difference < 0 ? 'diff-neg' : 'diff-pos'}">${esc(diffWord(r.difference))}</span><br><small class="muted">${esc(s.reasons[r.reason] || '')}${r.note ? ` · ${esc(r.note)}` : ''}</small>` : r.counted != null ? 'Matches' : ''}</td></tr>`).join('')}</tbody></table></div>
    ${s.closing && s.closing.status !== 'reviewed' ? '<button class="mid" id="rev">Mark this count reviewed</button>' : ''}`;
  bindDate(el, v => stockAdminView(el, v, sid, { role }));
  $('#stSel', el) && ($('#stSel', el).onchange = e => stockAdminView(el, s.date, e.target.value, { role }));
  $('#rev', el) && ($('#rev', el).onclick = async () => { try { await sapi('/api/ops/stock/review', { method: 'POST', body: { stationId: sid, date: s.date } }); stockAdminView(el, s.date, sid, { role }); } catch (e) { say($('#stMsg', el), e.message, 'bad'); } });
  $('#explain', el) && ($('#explain', el).onclick = () => explainSheet({ ...oc, stationId: sid, stationName: s.station.name, date: s.date }, () => stockAdminView(el, s.date, sid, { role })));
  $$('[data-dl]', el).forEach(b => b.onclick = async () => { try { await busy(b, () => sapi('/api/ops/stock/delivery', { method: 'POST', body: { id: b.dataset.dl, action: 'confirm' } })); stockAdminView(el, s.date, sid, { role }); } catch (e) { say($('#stMsg', el), e.message, 'bad'); } });
  $('#rcv', el).onclick = () => {
    const { box, close } = sheet(`<h2>${buyer ? 'Drinks bought' : 'New stock'}</h2><p class="muted" style="margin:0">${buyer ? 'It goes into the bar’s stock straight away.' : 'The bar confirms it when it arrives; only then does it count.'}</p><div class="sfield"><label for="rvP">Drink</label><select id="rvP">${products.filter(p => p.tracked).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="rvB">Into which bar</label><select id="rvB">${stations.map(x => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="rvQ">How many</label><input id="rvQ" inputmode="numeric"></div><div class="sfield"><label for="rvS">Supplier</label><input id="rvS" maxlength="80"></div>
      <div class="sfield"><label for="rvR">Receipt or invoice number</label><input id="rvR" maxlength="60"></div>${moneyField('rvC', buyer ? 'Total paid (GHS)' : 'Total paid (GHS, if you know it)')}
      <div id="rvM"></div><button class="big" id="rvGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#rvGo', box).onclick = async () => { try { await busy($('#rvGo', box), () => sapi('/api/ops/stock/received', { method: 'POST', body: { productId: $('#rvP', box).value, stationId: $('#rvB', box).value, qty: Number($('#rvQ', box).value), supplier: $('#rvS', box).value, reference: $('#rvR', box).value, totalCostPesewas: $('#rvC', box).value ? ghsIn($('#rvC', box).value) : '' } })); close(); await stockAdminView(el, s.date, sid, { role }); say($('#stMsg', el), buyer ? 'Saved. It’s in the bar’s stock.' : 'Saved. The bar confirms it when it arrives.'); } catch (e) { say($('#rvM', box), e.message, 'bad'); } };
  };
  labelTables(el);
}

// ── Money: is the club making money? Tonight / this week / this month ──
export async function moneyView(el, period = 'today') {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const [m, due] = await Promise.all([sapi(`/api/ops/money?period=${encodeURIComponent(period)}`), sapi('/api/ops/budget').catch(() => null)]);
  const t = m.totals, d = m.drinks, profit = t.profitPesewas >= 0;
  const rows = list => list.filter(r => r.amountPesewas).map(r => `<div class="ln"><span>${esc(r.label)}</span><span>${money(r.amountPesewas)}</span></div>`).join('') || '<div class="ln"><span class="muted">Nothing yet</span></div>';
  el.innerHTML = `<h1>Money</h1>
    <div class="seg" role="radiogroup" aria-label="Period" style="grid-template-columns:repeat(3,minmax(0,1fr))">${[['today', 'Tonight'], ['week', 'This week'], ['month', 'This month']].map(([k, l]) => `<button type="button" class="mid ${k === m.period.key ? 'on' : ''}" data-per="${k}" role="radio" aria-checked="${k === m.period.key}">${l}</button>`).join('')}</div>
    <div class="pos-money">
      <div class="big-line good"><span>Money in</span><b>${money(t.inPesewas)}</b></div>
      <div class="big-line bad"><span>Money out</span><b>${money(t.outPesewas)}</b></div>
      <div class="big-line ${profit ? 'good' : 'bad'}"><span>${profit ? 'Profit' : 'Loss'}</span><b>${money(Math.abs(t.profitPesewas))}</b></div>
    </div>
    ${due ? `<a class="pos-row" href="#budget" style="text-decoration:none"><span class="where">Bills this month<small>${due.totals.overdue ? `${due.totals.overdue} overdue · ` : ''}${money(due.totals.paidPesewas)} paid of ${money(due.totals.billsPesewas)}</small></span><span class="amt">${money(due.totals.duePesewas)}<small style="display:block">still to pay</small></span></a>` : ''}
    ${m.canAddExpense ? '<button class="big" id="addExp">Add an expense</button>' : ''}<div id="mMsg"></div>
    <h2>Money in</h2><div class="lines-list">${rows(m.moneyIn)}<div class="ln total"><span>Total</span><span>${money(t.inPesewas)}</span></div></div>
    ${d.unpaidPesewas ? `<p class="muted" style="margin:0">Not counted yet: ${money(d.unpaidPesewas)} of drinks still unpaid on open tables.</p>` : ''}
    <h2>Money out</h2><div class="lines-list">${rows(m.moneyOut)}<div class="ln total"><span>Total</span><span>${money(t.outPesewas)}</span></div></div>
    <h2>Drinks</h2><div class="nums">
      <div><span>Sold</span><b>${money(d.soldPesewas)}</b></div><div><span>What they cost us</span><b>${money(d.costPesewas)}</b></div>
      <div class="${d.profitPesewas >= 0 ? 'good' : 'bad'}"><span>Made on drinks</span><b>${money(d.profitPesewas)}</b></div></div>
    ${d.missingCost.length ? `<p class="muted" style="margin:0">No cost entered for: ${d.missingCost.map(esc).join(', ')}. Finance can add it under Drinks &amp; prices.</p>` : ''}
    ${d.rows.length ? `<details class="fold"><summary>By drink</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Sold</th><th class="num">Money</th><th class="num">Cost</th><th class="num">Made</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty}</td><td class="num">${money(r.salesPesewas)}</td><td class="num">${money(r.costPesewas)}</td><td class="num">${money(r.profitPesewas)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    ${m.byNight.length > 1 ? `<details class="fold"><summary>Night by night</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Night</th><th class="num">In</th><th class="num">Out</th><th class="num">Profit</th></tr></thead><tbody>
      ${m.byNight.map(r => `<tr><td>${esc(dayName(r.date))}</td><td class="num">${money(r.inPesewas)}</td><td class="num">${money(r.outPesewas)}</td><td class="num">${r.profitPesewas < 0 ? '−' : ''}${money(Math.abs(r.profitPesewas))}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    <details class="fold" ${m.expenses.length ? 'open' : ''}><summary>Expenses (${m.expenses.filter(e => !e.removed).length})</summary>
      ${m.expenses.length ? `<div class="lines-list">${m.expenses.map(e => `<div class="ln" style="${e.removed ? 'opacity:.55' : ''}"><span><b>${esc(e.description)}</b><br><small class="muted">${esc(e.categoryLabel)} · ${esc(dayName(e.date))} · ${esc(e.paidWith)} · ${esc(e.recordedByName)}${e.removed ? ` · taken off by ${esc(e.removedByName)}: ${esc(e.removedReason)}` : ''}</small></span>
        <span>${e.removed ? `<s>${money(e.amountPesewas)}</s>` : money(e.amountPesewas)}${e.canRemove ? `<br><button class="sbtn" data-rmexp="${esc(e.id)}">Take off</button>` : ''}</span></div>`).join('')}</div>` : '<p class="muted">No expenses recorded.</p>'}</details>
    ${m.purchases.length ? `<details class="fold"><summary>Drinks bought (${m.purchases.length})</summary><div class="lines-list">${m.purchases.map(x => `<div class="ln"><span><b>${x.qty} × ${esc(x.productName)}</b><br><small class="muted">${esc(dayName(x.date))} · ${esc(x.recordedByName)}${x.supplier ? ` · ${esc(x.supplier)}` : ''}</small></span><span>${money(x.costPesewas)}</span></div>`).join('')}</div></details>` : ''}`;
  $$('[data-per]', el).forEach(b => b.onclick = () => moneyView(el, b.dataset.per));
  $('#addExp', el) && ($('#addExp', el).onclick = () => expenseSheet(m, () => moneyView(el, m.period.key)));
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
      await busy($('#exGo', box), () => sapi('/api/ops/expenses', { method: 'POST', body: { category: $('#exCat', box).value, description: $('#exDesc', box).value, amountPesewas: ghsIn($('#exAmt', box).value), paidWith: $('#exPaid', box).value, date: $('#exDate', box).value } }));
      close(); done?.();
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
  const stateLabel = { due: ['unpaid', 'Due'], overdue: ['cancelled', 'Overdue'], part_paid: ['part_paid', 'Part paid'], paid: ['paid', 'Paid'], removed: ['empty', 'Taken off'] };
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
    <h2>Bills</h2>
    ${b.bills.length ? `<div class="lines-list">${b.bills.map(x => `<div class="ln" style="${x.state === 'removed' ? 'opacity:.5' : ''}"><span><b>${esc(x.payee)}</b>${x.description ? ` · ${esc(x.description)}` : ''}<br><small class="muted">${esc(x.categoryLabel)} · due ${esc(dayName(x.dueDate))}${x.paidPesewas && x.state !== 'paid' ? ` · ${money(x.paidPesewas)} paid` : ''}${x.removedReason ? ` · ${esc(x.removedReason)}` : ''}</small><br>${st(...stateLabel[x.state])}</span>
      <span>${money(x.state === 'paid' ? x.amountPesewas : x.leftPesewas || x.amountPesewas)}${b.canEdit && x.leftPesewas ? `<br><button class="sbtn" data-pay="${esc(x.id)}">Pay</button>${!x.paidPesewas ? ` <button class="sbtn" data-rmb="${esc(x.id)}">Take off</button>` : ''}` : ''}</span></div>`).join('')}</div>` : `<p class="muted">No bills for ${esc(b.label)}${b.canEdit ? ' yet. Add salaries, rent, suppliers owed…' : '.'}</p>`}
    <h2>Budget against spending</h2>
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
      ${Object.entries(b.categories).map(([k, v]) => moneyField(`bg_${k}`, v, have[k] ? String(have[k] / 100) : '')).join('')}
      <div class="sfield"><label for="bgN">Note (optional)</label><input id="bgN" maxlength="300" value="${esc(bud.note)}"></div>
      <div id="bgM"></div><button class="big" id="bgGo">Save budget</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Budget' });
    $('#bgGo', box).onclick = async () => {
      const lines = Object.fromEntries(Object.keys(b.categories).map(k => [k, $(`#bg_${k}`, box).value === '' ? '' : ghsIn($(`#bg_${k}`, box).value)]));
      try { await busy($('#bgGo', box), () => sapi('/api/ops/budget', { method: 'POST', body: { month: b.month, lines, note: $('#bgN', box).value } })); close(); again(); } catch (e) { say($('#bgM', box), e.message, 'bad'); }
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
    const reason = prompt('Why take this bill off?'); if (!reason) return;
    try { await sapi('/api/ops/bills/remove', { method: 'POST', body: { id: x.dataset.rmb, reason } }); again(); } catch (e) { say($('#bMsg', el), e.message, 'bad'); }
  });
  labelTables(el);
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
      ${d.payments.length ? `<div class="pos-tables">${d.payments.map((p, i) => `<button type="button" class="pos-row" data-pay="${i}"><span class="where">${when(p.at)} · ${esc(p.where)}<small>${esc(p.methodLabel)} · served by ${esc(p.servedByName || '—')}${p.customerName ? ` · ${esc(p.customerName)}` : ''}</small></span><span class="amt">${money(p.amountPesewas)}${p.refund ? st('cancelled', 'refund') : ''}</span></button>`).join('')}</div>` : '<p class="muted">No payments yet tonight.</p>'}`}`;
  $$('[data-tabv]', el).forEach(b => b.onclick = () => paymentsView(el, { tab: b.dataset.tabv }));
  $$('[data-pay]', el).forEach(b => b.onclick = () => {
    const p = d.payments[Number(b.dataset.pay)];
    sheet(`<h2>${money(p.amountPesewas)} · ${when(p.at)}</h2>
      <div class="lines-list">
        <div class="ln"><span>How it was paid</span><span>${esc(p.methodLabel)}</span></div>
        ${p.momoRef ? `<div class="ln"><span>Reference</span><span>${esc(p.momoRef)}</span></div>` : ''}
        <div class="ln"><span>Payment taken by</span><span>${esc(p.takenByName || '—')}</span></div>
        <div class="ln"><span>Served by</span><span>${esc(p.servedByName || '—')}</span></div>
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
