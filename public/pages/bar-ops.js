// bar.html, the bartender's part, one job per tab: Orders (waiter orders as tickets: start → ready →
// hand to the waiter; drinks coming back), Sell (a quick sale over the counter: drinks → Cash or
// MoMo, nothing else), Stock (one line per drink, tap for details and breakages, moves, finished;
// confirm and record new stock; the opening and closing counts) and My shift (what I sold, tips,
// hand in my cash, my report). The app-orders part (QR, pickup codes, the ⚙ settings) is
// pages/bar.js; both follow the bar picked there.
import { $, $$, esc } from '../app.js';
import { requireStaff, sapi } from '../staff.js';
import { sheet, say, st, every, bottomNav, busy, ghsIn, moneyField, money, when, ask } from '../lib/ops-ui.js';
import { drinkPicker, paySheet, handInCash, tipSheet, tipSaid } from '../lib/sell.js';

const user = await requireStaff(['superAdmin', 'director', 'manager', 'eventManager', 'barStaff']);
const canStock = ['superAdmin', 'director', 'manager', 'finance', 'barStaff'].includes(user.role);
let station = sessionStorage.getItem('bar-station') || '', view = 'orders', stop = null, seen = null;
const canSell = ['superAdmin', 'director', 'manager', 'barStaff'].includes(user.role);
const views = { orders: $('#vOrders'), sell: $('#vSell'), waiters: $('#vWaiters'), stock: $('#vStock'), shift: $('#vShift') };
// Four jobs, four tabs. The counts (the stock I met, the closing count) live under Stock.
const nav = bottomNav([['orders', 'Orders'], ...(canSell ? [['sell', 'Sell']] : []), ['waiters', 'Waiters'], ['stock', 'Stock'], ...(canSell ? [['shift', 'My shift']] : [])], k => go(k));
document.addEventListener('bar-station', e => { if (e.detail !== station) { station = e.detail; seen = null; go(view); } });
const top = (t, kind = 'good') => say($('#msgTop'), t, kind);
$('#msgTop').onclick = () => { $('#msgTop').innerHTML = ''; }; // a tap clears a message

// A screen inside Stock (a count): ← and the phone's back button both return to the stock list.
let sub = false;
addEventListener('popstate', () => { if (sub && !history.state?.barSub) { sub = false; if (view === 'stock') stockView(); } });
const openSub = () => { if (!sub) { sub = true; history.pushState({ barSub: 1, inApp: 1 }, ''); } scrollTo(0, 0); };
const leaveSub = () => { if (sub && history.state?.barSub) history.back(); else { sub = false; stockView(); } };
const subBar = title => `<div class="sub-back"><button type="button" class="back-btn" data-subback aria-label="Back to stock">←<span>Stock</span></button><b style="font:400 22px/1 var(--display);text-transform:uppercase">${esc(title)}</b></div>`;
const bindSub = el => $$('[data-subback]', el).forEach(b => b.onclick = leaveSub);

function go(k) {
  if (sub) { sub = false; if (history.state?.barSub) history.replaceState({ inApp: 1 }, ''); }
  view = k; nav.setActive(k);
  for (const [key, el] of Object.entries(views)) el.hidden = key !== k;
  if (stop) { stop(); stop = null; }
  if (k === 'orders') stop = every(5000, rounds);
  if (k === 'sell') sellView();
  if (k === 'waiters') stop = every(15000, waitersView);
  if (k === 'stock') stockView();
  if (k === 'shift') shiftView();
}
const lines = r => r.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', ');

// ── Waiters: what this bar has given each waiter tonight, tab by tab, and what's still unpaid ──
let waitersData = null;
async function waitersView(alive = () => true) {
  const el = views.waiters;
  const d = await sapi(`/api/ops/bar/waiters?stationId=${encodeURIComponent(station)}`);
  if (!alive()) return;
  waitersData = d;
  const total = d.waiters.reduce((n, w) => n + w.givenPesewas, 0), unpaid = d.waiters.reduce((n, w) => n + w.unpaidPesewas, 0);
  el.innerHTML = `<h1 style="margin:0">Waiters</h1><p class="lead" style="margin:0">Drinks ${esc(d.stationName || 'this bar')} has given each waiter tonight. Tap a name for their tables.</p>
    <div class="hero-row"><div class="hero"><span>Given to waiters</span><b>${money(total)}</b></div><div class="hero ${unpaid ? 'bad' : 'good'}"><span>Still unpaid</span><b>${money(unpaid)}</b></div></div>
    <div class="rows">${d.waiters.map(w => `<button class="row-btn" type="button" data-w="${esc(w.uid)}"><span class="t">${esc(w.name)}</span>
      <span class="s">${w.givenQty} drink${w.givenQty === 1 ? '' : 's'} · ${w.tabs.length} table${w.tabs.length === 1 ? '' : 's'}${w.openTabs ? ` (${w.openTabs} open)` : ''}${w.unpaidPesewas ? ` · ${money(w.unpaidPesewas)} unpaid` : ' · all paid'}${w.notConfirmedQty ? ` · ${w.notConfirmedQty} not confirmed yet` : ''}</span>
      <span class="r">${money(w.givenPesewas)}</span></button>`).join('') || '<div class="empty-box"><b>Nothing given to waiters yet tonight</b></div>'}</div>`;
  $$('[data-w]', el).forEach(b => b.onclick = () => waiterSheet(b.dataset.w));
}
function waiterSheet(uid) {
  const w = waitersData?.waiters.find(x => x.uid === uid); if (!w) return;
  sheet(`<h2>${esc(w.name)}</h2>
    <div class="hero-row"><div class="hero"><span>Given tonight</span><b>${money(w.givenPesewas)}</b></div><div class="hero ${w.unpaidPesewas ? 'bad' : 'good'}"><span>Unpaid on open tables</span><b>${money(w.unpaidPesewas)}</b></div></div>
    ${w.tabs.map(t => `<div class="tcard ${t.status !== 'open' ? 'done' : t.balancePesewas ? 'warn' : ''}" style="cursor:default">
      <span class="row"><span class="t" style="font-size:20px">${t.quick ? 'Quick sale' : `Tab ${t.number} · ${esc(t.table === 'Walk-in' ? 'no table' : `table ${t.table}`)}`}</span>${st(t.payStatus, t.status === 'open' ? t.payLabel : t.status === 'closed' ? 'Closed' : t.payLabel)}</span>
      <span>${t.given.map(l => `<b>${l.qty} ×</b> ${esc(l.name)} <small class="muted">${money(l.amountPesewas)}</small>`).join('<br>')}</span>
      <span class="sub">From this bar ${money(t.givenPesewas)} · bill ${money(t.totalPesewas)} · paid ${money(t.paidPesewas)}${t.balancePesewas ? ` · <b>${money(t.balancePesewas)} to pay</b>` : ''} · last ${when(t.lastAt)}</span></div>`).join('')}
    <button class="big ghost" data-close>Close</button>`, { label: w.name, full: true });
}

// ── Waiter orders: a ticket each, with one big next step (Start → Ready → Hand over) ──
const first = r => esc(r.waiterName.split(' ')[0]);
function ticketActs(r) {
  const hand = `data-a="hand" data-r="${esc(r.id)}"`;
  // Paid quick sales can't be cancelled by the bar (only a manager): no "Can't make it" for them.
  const cant = r.quick && !['superAdmin', 'manager'].includes(user.role) ? '' : `<button type="button" data-a="cant_make" data-r="${esc(r.id)}">Can’t make it</button>`;
  if (r.status === 'ready') return `<button class="big step" ${hand}>Hand to ${first(r)}</button>${cant ? `<div class="more">${cant}</div>` : ''}`;
  const step = r.status === 'waiting' ? `<button class="mid step" data-a="preparing" data-r="${esc(r.id)}">Start</button>` : `<button class="mid okc step" data-a="ready" data-r="${esc(r.id)}">Ready</button>`;
  return `${step}<div class="more"><button type="button" ${hand}>Hand to ${first(r)} now</button>${cant}</div>`;
}
async function rounds() {
  const d = await sapi(`/api/ops/bar/rounds?stationId=${encodeURIComponent(station)}`);
  if (canStock) sapi(`/api/ops/stock/deliveries?stationId=${encodeURIComponent(d.stationId || station)}`).then(x => nav.setDot('stock', x.forMe || 0)).catch(() => {});
  const taken = d.rounds.filter(r => r.status === 'taken');
  const atBar = d.rounds.filter(r => !['handed', 'taken'].includes(r.status)), waiting = d.rounds.filter(r => r.status === 'handed');
  const fresh = atBar.filter(r => seen && !seen.has(r.id)); if (fresh.length) navigator.vibrate?.(200);
  seen = new Set(atBar.map(r => r.id));
  $('#rCount').textContent = atBar.length ? `${atBar.length} to make` : '';
  nav.setDot('orders', atBar.length + taken.length);
  // A waiter took drinks without a "Hand over" tap: the bar confirms (then they leave the stock).
  $('#taken').innerHTML = taken.map(r => `<div class="say warn" role="status"><b>${esc(r.waiterName)} says they took Tab ${r.tabNumber} (${esc(r.table)})</b>
      ${lines(r)} · ${when(r.takenAt)}
      <div class="btn-row" style="margin-top:10px"><button class="mid okc" data-a="confirm_taken" data-r="${esc(r.id)}">Confirm: they took them</button><button class="mid" data-a="not_taken" data-r="${esc(r.id)}">Not taken</button></div></div>`).join('');
  $('#returns').innerHTML = d.returns.length ? `<div class="say warn"><b>Drinks coming back</b>${d.returns.map(r => `<div class="ret"><span>${esc(r.waiterName)} · Tab ${r.tabNumber}: ${r.lines.filter(l => l.returnPending).map(l => `${l.returnPending} × ${esc(l.name)}`).join(', ')}</span><button class="mid okc" data-back="${esc(r.id)}">Got them back</button></div>`).join('')}</div>` : '';
  $('#rounds').innerHTML = atBar.map(r => `<article class="ord s-${esc(r.status)}" aria-label="Tab ${r.tabNumber}"><div class="head"><span class="tbl-name">${esc(r.table)}</span><span class="waited">${when(r.createdAt)}</span></div>
      <div class="head"><span class="who">Tab ${r.tabNumber} · ${esc(r.waiterName)}</span>${st(r.status, r.statusLabel)}</div>
      <ul>${r.lines.map(l => `<li><b>${l.qty}×</b><span>${esc(l.name)}</span></li>`).join('')}</ul>${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}
      ${ticketActs(r)}</article>`).join('')
    || '<p class="none">None right now. They appear here by themselves.</p>';
  // Handed over, waiting for the waiter to say "delivered": one quiet line each.
  $('#withWaiters').innerHTML = waiting.length ? `<p class="group-h">With waiters (${waiting.length})</p><div class="stat-rows">${waiting.map(r => `<div><span>${esc(r.table)} · Tab ${r.tabNumber}</span><span class="muted">${first(r)} · ${when(r.handedAt || r.createdAt)}</span></div>`).join('')}</div>` : '';
  $('#handedList').innerHTML = d.handedOver?.length ? `<details class="fold"><summary>Waiter orders handed over tonight (${d.handedOver.length})</summary><div class="stat-rows">
      ${d.handedOver.map(r => `<div style="display:grid;gap:2px"><b style="font-size:16px">${when(r.handedAt)} · ${esc(r.table)} · Tab ${r.tabNumber}</b><span>${lines(r)}</span><span class="muted" style="font-size:14px">Took them: ${esc(r.waiterName)} · Confirmed by ${esc(r.handedByName)}${r.takenConfirmed ? ' (waiter took them)' : ''}</span></div>`).join('')}</div></details>` : '';
  $$('[data-a]').forEach(b => b.onclick = () => act(b.dataset.r, b.dataset.a));
  $$('[data-back]').forEach(b => b.onclick = () => act(b.dataset.back, 'confirm_return'));
}
async function act(roundId, action) {
  let reason;
  if (action === 'cant_make') { reason = await ask({ title: 'Can’t make it', label: 'Why? The waiter sees this.', quick: ['Finished', 'Bottle broke', 'Ice finished', 'Wrong order'], send: 'Tell the waiter', danger: true }); if (reason === null) return; }
  try { await sapi('/api/ops/bar/round', { method: 'POST', body: { roundId, action, reason } }); top(action === 'hand' ? 'Handed over. It’s in the waiter’s drinks now.' : action === 'confirm_taken' ? 'Confirmed. It’s in the waiter’s drinks now, out of the bar’s stock.' : action === 'not_taken' ? 'Back on the bar’s list. Tell the waiter.' : action === 'confirm_return' ? 'Taken back into the bar’s stock.' : action === 'cant_make' ? 'The waiter has been told.' : ''); rounds(); }
  catch (e) { top(e.message, 'bad'); }
}

// ── Sell: a quick sale over the counter. Nothing else on this screen. ──
async function sellView() {
  const el = views.sell; el.innerHTML = '<div class="loading">Loading…</div>';
  let p; try { if (!station) station = (await sapi('/api/ops/products')).stations[0]?.id || ''; p = await sapi(`/api/ops/products?stationId=${encodeURIComponent(station)}`); } catch (e) { el.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  const sid = station || p.stations[0]?.id;
  drinkPicker(el, p.products, {
    title: 'Sell', top: '<p class="lead" style="margin:0">The customer pays you now. Pick the drinks, then Cash or MoMo.</p>', button: n => `Customer pays · ${n}`,
    onSend: async (lines, total) => {
      paySheet(total, async pay => {
        const r = await sapi('/api/ops/quick-sale', { method: 'POST', body: { lines, stationId: sid, fromBar: true, ...pay } });
        top(`${pay.method === 'momo' ? 'MoMo' : 'Cash'} ${money(total)} recorded.${tipSaid(r)} Serve the drinks.`);
        sellView();
      }, { title: 'Sell', sapi, tipFor: user.uid });
    },
  });
}

// ── My shift: what I sold, my tips, hand in my cash, my report ──
async function shiftView() {
  const el = views.shift; el.innerHTML = '<div class="loading">Loading…</div>';
  let r; try { r = await sapi('/api/ops/my-report'); } catch (e) { el.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  const f = r.figures;
  el.innerHTML = `<h1 style="margin:0">My shift</h1>
    <div class="hero"><span>I sold tonight</span><b>${money(f.salesPesewas)}</b></div>
    <div class="hero-row" style="margin-top:10px"><div class="hero good"><span>Cash with me</span><b>${money(f.cashCollectedPesewas)}</b></div><div class="hero"><span>MoMo I took</span><b>${money(f.momoRecordedPesewas)}</b></div></div>
    <div class="rows" style="margin-top:10px"><button type="button" class="row-btn" id="tipOnly"><span class="t">Record a tip</span><span class="s">A tip without a bill · my tips tonight ${money(f.tipsPesewas || 0)}</span><span class="r"></span></button></div>
    <h2 class="shift-h">Hand in my cash</h2><div id="cashIn" style="display:grid;gap:12px;margin-top:10px"></div>
    <h2 class="shift-h">My report</h2><div style="display:grid;gap:12px;margin-top:10px">${r.submitted ? `<div class="say good"><b>Report submitted at ${when(r.submitted.at)}</b>Thank you.</div>` : '<div class="sfield"><label for="brWhy">Anything to explain? (optional)</label><textarea id="brWhy" rows="2" maxlength="600"></textarea></div><div id="brMsg"></div><button class="big ghost" id="brGo">Submit my report</button>'}</div>`;
  handInCash($('#cashIn', el), sapi);
  $('#tipOnly', el).onclick = () => tipSheet(sapi, user.uid, m => { top(m); shiftView(); });
  $('#brGo', el) && ($('#brGo', el).onclick = async () => {
    try { await busy($('#brGo', el), () => sapi('/api/ops/my-report', { method: 'POST', body: { explanation: $('#brWhy', el).value } }), 'Submitting…'); shiftView(); }
    catch (e) { say($('#brMsg', el), e.message, 'bad'); }
  });
}

// ── Stock: one line per drink; tap one for its details and what you can do with it ──
async function stockView() {
  const el = views.stock; el.innerHTML = '<div class="loading">Loading…</div>';
  let s, p, dl;
  try { [s, p] = await Promise.all([sapi(`/api/ops/stock?stationId=${encodeURIComponent(station)}`), sapi(`/api/ops/products?stationId=${encodeURIComponent(station)}`)]); } catch (e) { el.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  dl = canStock ? await sapi(`/api/ops/stock/deliveries?stationId=${encodeURIComponent(s.station.id)}`).catch(() => null) : null;
  nav.setDot('stock', dl?.forMe || 0);
  const pend = (dl?.deliveries || []).filter(x => x.status === 'pending');
  const prod = id => p.products.find(x => x.id === id);
  const oc = s.openingCount;
  const cats = [...new Set(s.rows.map(r => r.category))];
  const rowHtml = r => { const pr = prod(r.productId), out = pr && !pr.available;
    return `<button type="button" class="row-btn" data-row="${esc(r.productId)}" data-name="${esc(r.name.toLowerCase())}"><span class="t">${esc(r.name)}${out ? '<span class="tag out">Finished</span>' : r.low ? '<span class="tag low">Running low</span>' : ''}</span><span class="s">Should be here</span><span class="r"><b>${r.expected}</b></span></button>`; };
  el.innerHTML = `<h1 style="margin:0">Stock</h1>
    ${pend.length ? `<div class="say warn"><b>New stock to confirm</b>Count it when it reaches the bar. It only adds to the bar’s stock once confirmed.
      ${pend.map(x => `<div style="display:grid;gap:8px;margin-top:12px"><span><b style="display:inline">${x.qty} × ${esc(x.productName)}</b><br><small>From ${esc(x.recordedByName)} · ${when(x.recordedAt)}${x.supplier ? ` · ${esc(x.supplier)}` : ''}</small></span>
        ${x.canConfirm ? `<span class="btn-row"><button class="mid okc" data-dl="${esc(x.id)}" data-q="${x.qty}">Got ${x.qty}</button><button class="mid" data-dlx="${esc(x.id)}" data-q="${x.qty}">Different number</button></span>` : '<small>Waiting for finance or a manager to confirm</small>'}</div>`).join('')}</div>` : ''}
    ${oc ? '' : '<div class="say warn"><b>Count the stock you met</b>Count every bottle when you arrive. You can sell before you finish.</div><button class="big" id="openCount">Count the stock I met</button>'}
    ${s.rows.length > 8 ? '<input class="searchbox" id="sFind" type="search" placeholder="Find a drink" aria-label="Find a drink" autocomplete="off">' : ''}
    <div id="sMsg"></div>
    <div id="sList">${cats.map(c => `<p class="group-h">${esc(c)}</p><div class="rows">${s.rows.filter(r => r.category === c).map(rowHtml).join('')}</div>`).join('') || '<p class="none">No drinks are counted at this bar.</p>'}</div>
    <p class="group-h">More</p><div class="rows">
      ${canStock ? '<button type="button" class="row-btn" id="recv"><span class="t">New stock arrived</span><span class="s">Record a delivery. Finance or a manager confirms it.</span><span class="r"></span></button>' : ''}
      ${oc ? `<button type="button" class="row-btn" id="ocView"><span class="t">Stock I met</span><span class="s">Counted at ${when(oc.at)} · ${oc.differences.length ? `${oc.differences.length} different` : 'everything matched'}</span><span class="r"></span></button>` : ''}
      <button type="button" class="row-btn" id="closeCount"><span class="t">Closing count</span><span class="s">${s.closing ? `Submitted by ${esc(s.closing.byName)} at ${when(s.closing.at)}` : 'At the end of the night'}</span><span class="r"></span></button>
    </div>`;
  const products = p.products.filter(x => x.tracked), stations = p.stations;
  const pick = (id) => `<div class="sfield"><label for="${id}">Drink</label><select id="${id}">${products.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>`;
  $('#sFind', el) && ($('#sFind', el).oninput = () => { const q = $('#sFind', el).value.trim().toLowerCase(); $$('[data-row]', el).forEach(b => { b.hidden = !!q && !b.dataset.name.includes(q); }); $$('#sList .rows', el).forEach(g => { const any = $$('[data-row]', g).some(b => !b.hidden); g.hidden = !any; g.previousElementSibling.hidden = !any; }); });
  $('#openCount', el) && ($('#openCount', el).onclick = () => countForm(s, 'opening'));
  $('#closeCount', el).onclick = () => (s.closing ? closingDone(s) : countForm(s, 'closing'));
  $('#ocView', el) && ($('#ocView', el).onclick = () => sheet(`<h2>Stock I met</h2><div class="say ${oc.differences.length ? 'warn' : 'good'}"><b>Counted at ${when(oc.at)} (${esc(oc.byName)})</b>${oc.differences.length ? `${oc.differences.map(x => `${esc(x.name)}: found ${x.counted}, system said ${x.expected}`).join('<br>')}<br>${oc.explanation ? `Manager: ${esc(oc.explanation)}` : 'The manager has been asked to explain.'}` : 'Everything matched the system.'}</div><button class="big ghost" data-close>Close</button>`, { label: 'Stock I met' }));
  const decide = async body => { await sapi('/api/ops/stock/delivery', { method: 'POST', body }); stockView(); top(body.action === 'reject' ? 'Marked as not arrived.' : 'Confirmed. It’s in the bar’s stock now.'); };
  $$('[data-dl]', el).forEach(b => b.onclick = async () => { try { await busy(b, () => decide({ id: b.dataset.dl, action: 'confirm' })); } catch (e) { top(e.message, 'bad'); } });
  $$('[data-dlx]', el).forEach(b => b.onclick = () => {
    const { box, close } = sheet(`<h2>How many arrived?</h2><p class="muted" style="margin:0">${b.dataset.q} were recorded.</p>
      <div class="sfield"><label for="dlQ">How many you counted (0 if none came)</label><input id="dlQ" inputmode="numeric" pattern="[0-9]*"></div>
      <div class="sfield"><label for="dlN">What happened</label><input id="dlN" maxlength="200" placeholder="e.g. 2 short in the crate"></div>
      <div id="dlM"></div><button class="big" id="dlGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#dlGo', box).onclick = async () => {
      const q = Number($('#dlQ', box).value);
      try { await busy($('#dlGo', box), () => decide(q === 0 && $('#dlQ', box).value !== '' ? { id: b.dataset.dlx, action: 'reject', note: $('#dlN', box).value } : { id: b.dataset.dlx, action: 'confirm', qty: $('#dlQ', box).value, note: $('#dlN', box).value })); close(); }
      catch (e) { say($('#dlM', box), e.message, 'bad'); }
    };
  });
  // One drink: the numbers behind "should be here", then what can be done with it.
  $$('[data-row]', el).forEach(b => b.onclick = () => {
    const r = s.rows.find(x => x.productId === b.dataset.row), pr = prod(r.productId), others = stations.filter(x => x.id !== s.station.id);
    const { box, close } = sheet(`<h2>${esc(r.name)}</h2>
      <div class="hero"><span>Should be here</span><b>${r.expected}</b></div>
      <div class="stat-rows"><div><span>At the start of the night</span><b>${r.opening}</b></div><div><span>Came in (deliveries, moves, returns)</span><b>${r.received + r.transferIn + r.returns}</b></div><div><span>Handed out</span><b>${r.issued}</b></div>${r.transferOut ? `<div><span>Moved to another bar</span><b>${r.transferOut}</b></div>` : ''}<div><span>Broken or spilled</span><b>${r.waste}</b></div></div>
      ${canStock ? `<div style="display:grid;gap:10px"><button class="big ghost" data-do="waste">Broken or spilled</button>${others.length ? '<button class="big ghost" data-do="move">Move to another bar</button>' : ''}
        ${pr ? `<button class="big ghost" data-avail="${esc(r.productId)}" data-v="${pr.available ? '0' : '1'}">${pr.available ? 'Mark finished' : 'Back on sale'}</button><p class="hint" style="margin:0">${pr.available ? 'Finished: waiters and the QR menu show it can’t be ordered.' : 'It’s marked finished now.'}</p>` : ''}</div>` : ''}`, { label: r.name });
    $$('[data-do]', box).forEach(x => x.onclick = () => { close(); (x.dataset.do === 'waste' ? wasteSheet : moveSheet)(r); });
    $$('[data-avail]', box).forEach(x => x.onclick = async () => { try { await busy(x, () => sapi('/api/ops/products/available', { method: 'POST', body: { id: x.dataset.avail, available: x.dataset.v === '1' } })); close(); stockView(); top(x.dataset.v === '1' ? 'Back on sale.' : 'Marked finished: waiters and the QR menu show it as finished.'); } catch (e) { top(e.message, 'bad'); } });
  });
  const fixed = r => `<p class="lead" style="margin:0"><b>${esc(r.name)}</b> · ${r.expected} should be here</p>`;
  const wasteSheet = r => {
    const { box, close } = sheet(`<h2>Broken or spilled</h2>${fixed(r)}<div class="sfield"><label for="wsQ">How many</label><input id="wsQ" inputmode="numeric" pattern="[0-9]*" value="1"></div>
      <div class="sfield"><label for="wsR">What happened</label><select id="wsR">${Object.entries(s.wasteReasons).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="wsN">Note (optional)</label><input id="wsN" maxlength="200"></div><div id="wsM"></div><button class="big" id="wsGo">Save</button>`, { label: 'Broken or spilled' });
    $('#wsGo', box).onclick = async () => { try { await busy($('#wsGo', box), () => sapi('/api/ops/stock/waste', { method: 'POST', body: { stationId: s.station.id, productId: r.productId, qty: Number($('#wsQ', box).value), reason: $('#wsR', box).value, note: $('#wsN', box).value } })); close(); stockView(); top('Saved.'); } catch (e) { say($('#wsM', box), e.message, 'bad'); } };
  };
  const moveSheet = r => {
    const others = stations.filter(x => x.id !== s.station.id);
    const { box, close } = sheet(`<h2>Move to another bar</h2>${fixed(r)}<div class="sfield"><label for="mvQ">How many</label><input id="mvQ" inputmode="numeric" pattern="[0-9]*"></div>
      <div class="sfield"><label for="mvT">To which bar</label><select id="mvT">${others.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div><div id="mvM"></div><button class="big" id="mvGo">Move</button>`, { label: 'Move to another bar' });
    $('#mvGo', box).onclick = async () => { try { await busy($('#mvGo', box), () => sapi('/api/ops/stock/transfer', { method: 'POST', body: { productId: r.productId, qty: Number($('#mvQ', box).value), fromStationId: s.station.id, toStationId: $('#mvT', box).value } })); close(); stockView(); top('Moved.'); } catch (e) { say($('#mvM', box), e.message, 'bad'); } };
  };
  $('#recv', el) && ($('#recv', el).onclick = () => {
    const { box, close } = sheet(`<h2>New stock arrived</h2><p class="muted" style="margin:0">Finance or a manager confirms it before it counts.</p>${pick('rvP')}<div class="sfield"><label for="rvQ">How many came</label><input id="rvQ" inputmode="numeric" pattern="[0-9]*"></div>
      <div class="sfield"><label for="rvS">Supplier (optional)</label><input id="rvS" maxlength="80"></div><div class="sfield"><label for="rvR">Invoice or waybill number (optional)</label><input id="rvR" maxlength="60"></div>
      ${moneyField('rvC', 'Cost of one (GHS, optional)')}<div id="rvM"></div><button class="big" id="rvGo">Save delivery</button>`, { label: 'New stock arrived' });
    $('#rvGo', box).onclick = async () => { try { await busy($('#rvGo', box), () => sapi('/api/ops/stock/received', { method: 'POST', body: { stationId: s.station.id, productId: $('#rvP', box).value, qty: Number($('#rvQ', box).value), supplier: $('#rvS', box).value, reference: $('#rvR', box).value, unitCostPesewas: $('#rvC', box).value ? ghsIn($('#rvC', box).value) : '' } })); close(); stockView(); top('Saved. Finance or a manager must confirm it before it counts.'); } catch (e) { say($('#rvM', box), e.message, 'bad'); } };
  });
}

// ── Counts (the stock I met; the closing count), inside Stock ──
function closingDone(s) {
  const el = views.stock; openSub();
  const diffs = s.rows.filter(r => r.difference);
  el.innerHTML = `${subBar('Closing count')}<div class="say good"><b>Count submitted by ${esc(s.closing.byName)} at ${when(s.closing.at)}</b>${s.closing.reviewedByName ? `Reviewed by ${esc(s.closing.reviewedByName)}.` : 'The manager or finance will review it.'}</div>
    ${diffs.length ? `<div class="say warn"><b>Differences</b>${diffs.map(r => `${esc(r.name)}: ${Math.abs(r.difference)} ${r.difference < 0 ? 'fewer' : 'more'} than expected (${esc(s.reasons[r.reason] || r.reason)})`).join('<br>')}</div>` : '<div class="say good">Everything matched.</div>'}
    <p class="hint">To change a submitted count, ask a manager: corrections are approved and the first count is kept.</p>`;
  bindSub(el);
}
function countForm(s, kind) {
  const el = views.stock; openSub();
  const total = s.rows.length;
  el.innerHTML = `${subBar(kind === 'closing' ? 'Closing count' : 'Stock I met')}
    <p class="lead" style="margin:0">Count every bottle and can at ${esc(s.station.name)}. Type what you count.${kind === 'opening' ? ' You don’t need to explain differences: the manager does.' : ''}</p>
    <form id="cf" novalidate style="display:grid;gap:12px"><div class="count-list">${s.rows.map(r => `<div class="count-row" data-p="${esc(r.productId)}"><span class="nm">${esc(r.name)}<small>Should be ${r.expected}</small></span>
      <input data-n type="text" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" aria-label="${esc(r.name)} counted" autocomplete="off">
      <span data-diff></span>
      <select data-r hidden aria-label="Why is it different?"><option value="">Why is it different?</option>${Object.entries(s.reasons).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <input data-note hidden placeholder="Note (optional)" aria-label="Note (optional)" maxlength="200"></div>`).join('')}</div>
    <div id="cfMsg"></div><div class="dock"><div class="progress"><span id="cfProg">0 of ${total} counted</span><span class="bar"><i id="cfBar"></i></span></div><button class="big" type="submit" id="cfGo">Submit ${kind === 'closing' ? 'closing' : ''} count</button></div></form>`;
  bindSub(el);
  const rows = new Map(s.rows.map(r => [r.productId, r]));
  const progress = () => { const n = $$('[data-n]', el).filter(x => x.value !== '').length; $('#cfProg', el).textContent = `${n} of ${total} counted`; $('#cfBar', el).style.width = `${total ? (n / total) * 100 : 0}%`; };
  $$('[data-p]', el).forEach(row => {
    const r = rows.get(row.dataset.p), n = $('[data-n]', row);
    n.oninput = () => {
      n.value = n.value.replace(/[^0-9]/g, '');
      row.classList.toggle('done', n.value !== ''); progress();
      if (n.value === '') { $('[data-diff]', row).textContent = ''; $('[data-r]', row).hidden = true; $('[data-note]', row).hidden = true; return; }
      const d = Number(n.value) - r.expected, bad = d !== 0;
      $('[data-diff]', row).innerHTML = bad ? `<span class="${d < 0 ? 'diff-neg' : 'diff-pos'}">${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'} than expected (${r.expected})</span>` : '<span class="muted">Matches</span>';
      $('[data-r]', row).hidden = !bad || kind !== 'closing'; $('[data-note]', row).hidden = !bad;
    };
    // "Next" on the keypad moves to the next drink.
    n.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const all = $$('[data-n]', el), i = all.indexOf(n); (all[i + 1] || $('#cfGo', el)).focus(); } };
  });
  $('#cf', el).onsubmit = async ev => {
    ev.preventDefault();
    const lines = $$('[data-p]', el).map(row => ({ productId: row.dataset.p, counted: $('[data-n]', row).value === '' ? null : Number($('[data-n]', row).value), reason: $('[data-r]', row).value, note: $('[data-note]', row).value }));
    if (!confirm(kind === 'closing' ? 'Submit the closing count? You can’t change it after (a manager can approve a correction).' : 'Submit the count of the stock you met? You can’t change it after.')) return;
    try { const r = await busy($('#cfGo', el), () => sapi('/api/ops/stock/count', { method: 'POST', body: { stationId: s.station.id, kind, lines } }), 'Submitting…'); top(r.differences?.length ? `Count submitted with ${r.differences.length} difference${r.differences.length > 1 ? 's' : ''}. The manager ${kind === 'opening' ? 'will explain' : 'will review'}.` : 'Count submitted. Everything matched.'); leaveSub(); }
    catch (e) { say($('#cfMsg', el), e.message, 'bad'); }
  };
}

go('orders');
