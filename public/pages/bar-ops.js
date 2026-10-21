// bar.html, the bartender's part: waiter orders (start → ready → hand to the waiter), drinks coming
// back from waiters, Sell (a quick sale over the counter: drinks → Cash or MoMo, tonight's sales,
// hand in my cash, my report), the bar's stock (confirm new stock, record new stock for finance to
// confirm, breakages, moves to another bar) and the closing count. The app-orders part (QR, pickup
// codes) is pages/bar.js; both follow the bar picked at the top.
import { $, $$, esc } from '../app.js';
import { requireStaff, sapi } from '../staff.js';
import { sheet, say, st, every, bottomNav, busy, ghsIn, moneyField, money, when } from '../lib/ops-ui.js';
import { drinkPicker, paySheet, handInCash } from '../lib/sell.js';

const user = await requireStaff(['superAdmin', 'director', 'manager', 'eventManager', 'barStaff']);
const canStock = ['superAdmin', 'director', 'manager', 'finance', 'barStaff'].includes(user.role);
let station = sessionStorage.getItem('bar-station') || '', view = 'orders', stop = null, seen = null;
const canSell = ['superAdmin', 'director', 'manager', 'barStaff'].includes(user.role);
const views = { orders: $('#vOrders'), sell: $('#vSell'), stock: $('#vStock'), count: $('#vCount') };
const nav = bottomNav([['orders', 'Orders'], ...(canSell ? [['sell', 'Sell']] : []), ['stock', 'Stock'], ['count', 'Count']], k => go(k));
document.addEventListener('bar-station', e => { if (e.detail !== station) { station = e.detail; seen = null; go(view); } });
const top = (t, kind = 'good') => say($('#msgTop'), t, kind);

function go(k) {
  view = k; nav.setActive(k);
  for (const [key, el] of Object.entries(views)) el.hidden = key !== k;
  if (stop) { stop(); stop = null; }
  if (k === 'orders') stop = every(5000, rounds);
  if (k === 'sell') sellView();
  if (k === 'stock') stockView();
  if (k === 'count') countView();
}

// ── Waiter orders ──
const nextBtn = r => (r.status === 'waiting' ? `<button class="mid" data-a="preparing" data-r="${esc(r.id)}">Start</button><button class="mid red" data-a="hand" data-r="${esc(r.id)}">Hand to ${esc(r.waiterName.split(' ')[0])}</button>`
  : r.status === 'preparing' ? `<button class="mid okc" data-a="ready" data-r="${esc(r.id)}">Ready</button><button class="mid red" data-a="hand" data-r="${esc(r.id)}">Hand to ${esc(r.waiterName.split(' ')[0])}</button>`
    : r.status === 'ready' ? `<button class="mid red" data-a="hand" data-r="${esc(r.id)}">Hand to ${esc(r.waiterName.split(' ')[0])}</button>` : '');
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
      ${r.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', ')} · ${when(r.takenAt)}
      <div class="btn-row" style="margin-top:8px"><button class="mid okc" data-a="confirm_taken" data-r="${esc(r.id)}">Confirm: they took them</button><button class="mid" data-a="not_taken" data-r="${esc(r.id)}">Not taken</button></div></div>`).join('');
  $('#handedList').innerHTML = d.handedOver?.length ? `<details class="fold"><summary>Handed over tonight (${d.handedOver.length})</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Tab</th><th>Drinks</th><th>Took them</th><th>Confirmed by</th></tr></thead><tbody>
      ${d.handedOver.map(r => `<tr><td>${when(r.handedAt)}</td><td>Tab ${r.tabNumber} · ${esc(r.table)}</td><td>${r.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', ')}</td><td>${esc(r.waiterName)}</td><td>${esc(r.handedByName)}${r.takenConfirmed ? ' <small class="muted">(waiter took them)</small>' : ''}</td></tr>`).join('')}</tbody></table></div></details>` : '';
  $('#returns').innerHTML = d.returns.length ? `<div class="say warn"><b>Drinks coming back</b>${d.returns.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:8px"><span>${esc(r.waiterName)} · Tab ${r.tabNumber}: ${r.lines.filter(l => l.returnPending).map(l => `${l.returnPending} × ${esc(l.name)}`).join(', ')}</span><button class="mid okc" data-back="${esc(r.id)}">Got them back</button></div>`).join('')}</div>` : '';
  $('#rounds').innerHTML = atBar.map(r => `<article class="ord" aria-label="Tab ${r.tabNumber}"><div class="head"><span class="code" style="font-size:40px">${esc(r.table)}</span><span class="waited">${when(r.createdAt)}</span></div>
      <span class="foot-small">Tab ${r.tabNumber} · ${esc(r.waiterName)}</span>
      <ul>${r.lines.map(l => `<li><b>${l.qty}×</b><span>${esc(l.name)}</span></li>`).join('')}</ul>${r.note ? `<span class="foot-small">${esc(r.note)}</span>` : ''}
      ${st(r.status, r.statusLabel)}
      <div class="btn-row">${nextBtn(r)}<button class="mid" data-a="cant_make" data-r="${esc(r.id)}">Can’t make it</button></div></article>`).join('')
    + waiting.map(r => `<article class="ord" style="opacity:.7"><div class="head"><span class="code" style="font-size:30px">${esc(r.table)}</span>${st('handed', 'With ' + r.waiterName.split(' ')[0])}</div><span class="foot-small">Tab ${r.tabNumber} · handed ${when(r.handedAt || r.createdAt)}</span></article>`).join('')
    || '<div class="bar-empty"><b>No waiter orders</b>They appear here by themselves.</div>';
  $$('[data-a]').forEach(b => b.onclick = () => act(b.dataset.r, b.dataset.a));
  $$('[data-back]').forEach(b => b.onclick = () => act(b.dataset.back, 'confirm_return'));
}
async function act(roundId, action) {
  let reason;
  if (action === 'cant_make') { reason = prompt('Why can’t the bar make it? (e.g. finished)'); if (reason === null) return; }
  try { await sapi('/api/ops/bar/round', { method: 'POST', body: { roundId, action, reason } }); top(action === 'hand' ? 'Handed over. It’s in the waiter’s drinks now.' : action === 'confirm_taken' ? 'Confirmed. It’s in the waiter’s drinks now, out of the bar’s stock.' : action === 'not_taken' ? 'Back on the bar’s list. Tell the waiter.' : action === 'confirm_return' ? 'Taken back into the bar’s stock.' : ''); rounds(); }
  catch (e) { top(e.message, 'bad'); }
}

// ── Sell: a quick sale over the counter ──
async function sellView() {
  const el = views.sell; el.innerHTML = '<div class="loading">Loading…</div>';
  let p; try { if (!station) station = (await sapi('/api/ops/products')).stations[0]?.id || ''; p = await sapi(`/api/ops/products?stationId=${encodeURIComponent(station)}`); } catch (e) { el.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  const sid = station || p.stations[0]?.id;
  const box = document.createElement('div'), mine = document.createElement('div');
  el.innerHTML = ''; el.append(box, mine);
  drinkPicker(box, p.products, {
    title: 'Sell', top: '<p class="lead" style="margin:0">The customer pays you now. Pick the drinks, then Cash or MoMo.</p>', button: n => `Customer pays · ${n}`,
    onSend: async (lines, total) => {
      paySheet(total, async pay => {
        await sapi('/api/ops/quick-sale', { method: 'POST', body: { lines, stationId: sid, fromBar: true, ...pay } });
        top(`${pay.method === 'momo' ? 'MoMo' : 'Cash'} ${money(total)} recorded. Serve the drinks.`);
        sellView();
      }, { title: 'Sell' });
    },
  });
  // Tonight: what I sold, my cash and MoMo, hand in my cash, my report.
  let r; try { r = await sapi('/api/ops/my-report'); } catch { return; }
  const f = r.figures;
  mine.innerHTML = `<h2>My sales tonight</h2><div class="nums">
      <div><span>I sold</span><b>${money(f.salesPesewas)}</b></div><div class="good"><span>Cash with me</span><b>${money(f.cashCollectedPesewas)}</b></div><div class="good"><span>MoMo I took</span><b>${money(f.momoRecordedPesewas)}</b></div></div>
    <h2>Hand in my cash</h2><div id="cashIn"></div>
    <h2>My report</h2>${r.submitted ? `<div class="say good"><b>Report submitted at ${when(r.submitted.at)}</b>Thank you.</div>` : '<div class="sfield"><label for="brWhy">Anything to explain? (optional)</label><textarea id="brWhy" rows="2" maxlength="600"></textarea></div><div id="brMsg"></div><button class="big ghost" id="brGo">Submit my report</button>'}`;
  handInCash($('#cashIn', mine), sapi);
  $('#brGo', mine) && ($('#brGo', mine).onclick = async () => {
    try { await busy($('#brGo', mine), () => sapi('/api/ops/my-report', { method: 'POST', body: { explanation: $('#brWhy', mine).value } }), 'Submitting…'); sellView(); }
    catch (e) { say($('#brMsg', mine), e.message, 'bad'); }
  });
}

// ── Stock ──
async function stockView() {
  const el = views.stock; el.innerHTML = '<div class="loading">Loading…</div>';
  let s, p, dl;
  try { [s, p] = await Promise.all([sapi(`/api/ops/stock?stationId=${encodeURIComponent(station)}`), sapi(`/api/ops/products?stationId=${encodeURIComponent(station)}`)]); } catch (e) { el.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  dl = canStock ? await sapi(`/api/ops/stock/deliveries?stationId=${encodeURIComponent(s.station.id)}`).catch(() => null) : null;
  nav.setDot('stock', dl?.forMe || 0);
  const pend = (dl?.deliveries || []).filter(x => x.status === 'pending');
  el.innerHTML = `<h2 style="margin:0">${esc(s.station.name)}: stock now</h2>
    ${s.openingCount ? `<div class="say ${s.openingCount.differences.length ? 'warn' : 'good'}"><b>You counted at ${when(s.openingCount.at)} (${esc(s.openingCount.byName)})</b>${s.openingCount.differences.length ? `${s.openingCount.differences.map(x => `${esc(x.name)}: found ${x.counted}, system said ${x.expected}`).join('<br>')}<br>${s.openingCount.explanation ? `Manager: ${esc(s.openingCount.explanation)}` : 'The manager has been asked to explain.'}` : 'Everything matched the system.'}</div>`
      : '<div class="say warn"><b>Count the stock you met</b>Count every bottle when you arrive. You can sell before you finish: the count is checked against the system when you submit it.</div><button class="big" id="openCount">Count the stock I met</button>'}
    ${pend.length ? `<div class="say warn"><b>New stock to confirm</b>Count it when it reaches the bar. It only adds to the bar’s stock once confirmed.
      ${pend.map(x => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px"><span><b>${x.qty} × ${esc(x.productName)}</b><br><small>From ${esc(x.recordedByName)} · ${when(x.recordedAt)}${x.supplier ? ` · ${esc(x.supplier)}` : ''}</small></span>
        ${x.canConfirm ? `<span class="btn-row"><button class="mid okc" data-dl="${esc(x.id)}" data-q="${x.qty}">Got ${x.qty}</button><button class="mid" data-dlx="${esc(x.id)}" data-q="${x.qty}">Different number</button></span>` : '<small>Waiting for finance or a manager to confirm</small>'}</div>`).join('')}</div>` : ''}
    <div class="btn-row">${canStock ? '<button class="mid red" id="recv">New stock arrived</button><button class="mid warn" id="waste">Broken / spilled</button><button class="mid" id="move">Move to another bar</button>' : ''}</div>
    <div id="sMsg"></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Drink</th><th class="num">Should be here</th><th class="num">Handed out</th><th class="num">In</th><th class="num">Broken</th><th>Tonight</th></tr></thead><tbody>
    ${s.rows.map(r => { const pr = p.products.find(x => x.id === r.productId); return `<tr><td><strong>${esc(r.name)}</strong>${r.low ? ` ${st('unpaid', 'Running low')}` : ''}</td><td class="num"><b>${r.expected}</b></td><td class="num">${r.issued}</td><td class="num">${r.received + r.transferIn + r.returns}</td><td class="num">${r.waste}</td>
      <td>${canStock ? `<button class="sbtn ${pr?.available ? '' : 'red'}" data-avail="${esc(r.productId)}" data-v="${pr?.available ? '0' : '1'}">${pr?.available ? 'Mark finished' : 'Back on sale'}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
  const products = p.products.filter(x => x.tracked), stations = p.stations;
  const pick = (id) => `<div class="sfield"><label for="${id}">Drink</label><select id="${id}">${products.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>`;
  $('#openCount', el) && ($('#openCount', el).onclick = () => countForm(s, 'opening'));
  const decide = async body => { await sapi('/api/ops/stock/delivery', { method: 'POST', body }); stockView(); top(body.action === 'reject' ? 'Marked as not arrived.' : 'Confirmed. It’s in the bar’s stock now.'); };
  $$('[data-dl]', el).forEach(b => b.onclick = async () => { try { await busy(b, () => decide({ id: b.dataset.dl, action: 'confirm' })); } catch (e) { top(e.message, 'bad'); } });
  $$('[data-dlx]', el).forEach(b => b.onclick = () => {
    const { box, close } = sheet(`<h2>How many arrived?</h2><p class="muted" style="margin:0">${b.dataset.q} were recorded.</p>
      <div class="sfield"><label for="dlQ">How many you counted (0 if none came)</label><input id="dlQ" inputmode="numeric"></div>
      <div class="sfield"><label for="dlN">What happened</label><input id="dlN" maxlength="200" placeholder="e.g. 2 short in the crate"></div>
      <div id="dlM"></div><button class="big" id="dlGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#dlGo', box).onclick = async () => {
      const q = Number($('#dlQ', box).value);
      try { await busy($('#dlGo', box), () => decide(q === 0 && $('#dlQ', box).value !== '' ? { id: b.dataset.dlx, action: 'reject', note: $('#dlN', box).value } : { id: b.dataset.dlx, action: 'confirm', qty: $('#dlQ', box).value, note: $('#dlN', box).value })); close(); }
      catch (e) { say($('#dlM', box), e.message, 'bad'); }
    };
  });
  $$('[data-avail]', el).forEach(b => b.onclick = async () => { try { await sapi('/api/ops/products/available', { method: 'POST', body: { id: b.dataset.avail, available: b.dataset.v === '1' } }); stockView(); top(b.dataset.v === '1' ? 'Back on sale.' : 'Marked finished: waiters and the QR menu show it as finished.'); } catch (e) { top(e.message, 'bad'); } });
  $('#recv', el) && ($('#recv', el).onclick = () => {
    const { box, close } = sheet(`<h2>New stock arrived</h2><p class="muted" style="margin:0">Finance or a manager confirms it before it counts.</p>${pick('rvP')}<div class="sfield"><label for="rvQ">How many came</label><input id="rvQ" inputmode="numeric"></div>
      <div class="sfield"><label for="rvS">Supplier (optional)</label><input id="rvS" maxlength="80"></div><div class="sfield"><label for="rvR">Invoice or waybill number (optional)</label><input id="rvR" maxlength="60"></div>
      ${moneyField('rvC', 'Cost of one (GHS, optional)')}<div id="rvM"></div><button class="big" id="rvGo">Save delivery</button><button class="big ghost" data-close>Cancel</button>`);
    $('#rvGo', box).onclick = async () => { try { await busy($('#rvGo', box), () => sapi('/api/ops/stock/received', { method: 'POST', body: { stationId: s.station.id, productId: $('#rvP', box).value, qty: Number($('#rvQ', box).value), supplier: $('#rvS', box).value, reference: $('#rvR', box).value, unitCostPesewas: $('#rvC', box).value ? ghsIn($('#rvC', box).value) : '' } })); close(); stockView(); top('Saved. Finance or a manager must confirm it before it counts.'); } catch (e) { say($('#rvM', box), e.message, 'bad'); } };
  });
  $('#waste', el) && ($('#waste', el).onclick = () => {
    const { box, close } = sheet(`<h2>Broken or spilled</h2>${pick('wsP')}<div class="sfield"><label for="wsQ">How many</label><input id="wsQ" inputmode="numeric" value="1"></div>
      <div class="sfield"><label for="wsR">What happened</label><select id="wsR">${Object.entries(s.wasteReasons).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="wsN">Note (optional)</label><input id="wsN" maxlength="200"></div><div id="wsM"></div><button class="big" id="wsGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#wsGo', box).onclick = async () => { try { await busy($('#wsGo', box), () => sapi('/api/ops/stock/waste', { method: 'POST', body: { stationId: s.station.id, productId: $('#wsP', box).value, qty: Number($('#wsQ', box).value), reason: $('#wsR', box).value, note: $('#wsN', box).value } })); close(); stockView(); top('Saved.'); } catch (e) { say($('#wsM', box), e.message, 'bad'); } };
  });
  $('#move', el) && ($('#move', el).onclick = () => {
    const others = stations.filter(x => x.id !== s.station.id);
    if (!others.length) return say($('#sMsg', el), 'There’s only one bar.', 'warn');
    const { box, close } = sheet(`<h2>Move to another bar</h2>${pick('mvP')}<div class="sfield"><label for="mvQ">How many</label><input id="mvQ" inputmode="numeric"></div>
      <div class="sfield"><label for="mvT">To which bar</label><select id="mvT">${others.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div><div id="mvM"></div><button class="big" id="mvGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#mvGo', box).onclick = async () => { try { await busy($('#mvGo', box), () => sapi('/api/ops/stock/transfer', { method: 'POST', body: { productId: $('#mvP', box).value, qty: Number($('#mvQ', box).value), fromStationId: s.station.id, toStationId: $('#mvT', box).value } })); close(); stockView(); top('Moved.'); } catch (e) { say($('#mvM', box), e.message, 'bad'); } };
  });
}

// ── Count (closing; or the first opening count) ──
async function countView() {
  const el = views.count; el.innerHTML = '<div class="loading">Loading…</div>';
  let s; try { s = await sapi(`/api/ops/stock?stationId=${encodeURIComponent(station)}`); } catch (e) { el.innerHTML = `<div class="say bad">${esc(e.message)}</div>`; return; }
  if (s.closing) {
    const diffs = s.rows.filter(r => r.difference);
    el.innerHTML = `<h2 style="margin:0">Closing count · ${esc(s.station.name)}</h2><div class="say good"><b>Count submitted by ${esc(s.closing.byName)} at ${when(s.closing.at)}</b>${s.closing.reviewedByName ? `Reviewed by ${esc(s.closing.reviewedByName)}.` : 'The manager or finance will review it.'}</div>
      ${diffs.length ? `<div class="say warn"><b>Differences</b>${diffs.map(r => `${esc(r.name)}: ${Math.abs(r.difference)} ${r.difference < 0 ? 'fewer' : 'more'} than expected (${esc(s.reasons[r.reason] || r.reason)})`).join('<br>')}</div>` : '<div class="say good">Everything matched.</div>'}
      <p class="foot-small">To change a submitted count, ask a manager: corrections are approved and the first count is kept.</p>`;
    return;
  }
  countForm(s, 'closing');
}
function countForm(s, kind) {
  const el = kind === 'closing' ? views.count : views.stock;
  el.innerHTML = `<h2 style="margin:0">${kind === 'closing' ? 'Closing count' : 'Opening count'} · ${esc(s.station.name)}</h2>
    <p class="lead">Count every bottle and can in the bar. Enter what you count. The system shows any difference straight away.${kind === 'opening' ? ' You don’t need to explain differences now: the manager does.' : ''}</p>
    <form id="cf" novalidate><div class="lines-list">${s.rows.map(r => `<div class="ln" data-p="${esc(r.productId)}" style="flex-wrap:wrap;align-items:center"><span style="flex:1;min-width:140px"><b>${esc(r.name)}</b><br><small data-diff></small></span>
      <input data-n inputmode="numeric" aria-label="${esc(r.name)} counted" style="width:90px;font-size:20px;text-align:center" autocomplete="off">
      <select data-r hidden aria-label="Why" style="flex-basis:100%;margin-top:6px"><option value="">Why is it different?</option>${Object.entries(s.reasons).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <input data-note hidden placeholder="Note (optional)" maxlength="200" style="flex-basis:100%;margin-top:6px"></div>`).join('')}</div>
    <div id="cfMsg"></div><div class="dock"><button class="big" type="submit" id="cfGo">Submit ${kind} count</button></div></form>`;
  const rows = new Map(s.rows.map(r => [r.productId, r]));
  $$('[data-p]', el).forEach(row => {
    const r = rows.get(row.dataset.p), n = $('[data-n]', row);
    n.oninput = () => {
      if (n.value === '') { $('[data-diff]', row).textContent = ''; return; }
      const d = Number(n.value) - r.expected, bad = d !== 0;
      $('[data-diff]', row).innerHTML = bad ? `<span class="${d < 0 ? 'diff-neg' : 'diff-pos'}">${Math.abs(d)} ${d < 0 ? 'fewer' : 'more'} than expected (${r.expected})</span>` : 'Matches';
      $('[data-r]', row).hidden = !bad || kind !== 'closing'; $('[data-note]', row).hidden = !bad;
    };
  });
  $('#cf', el).onsubmit = async ev => {
    ev.preventDefault();
    const lines = $$('[data-p]', el).map(row => ({ productId: row.dataset.p, counted: $('[data-n]', row).value === '' ? null : Number($('[data-n]', row).value), reason: $('[data-r]', row).value, note: $('[data-note]', row).value }));
    if (!confirm(kind === 'closing' ? 'Submit the closing count? You can’t change it after (a manager can approve a correction).' : 'Submit the count of the stock you met? You can’t change it after.')) return;
    try { const r = await busy($('#cfGo', el), () => sapi('/api/ops/stock/count', { method: 'POST', body: { stationId: s.station.id, kind, lines } }), 'Submitting…'); top(r.differences?.length ? `Count submitted with ${r.differences.length} difference${r.differences.length > 1 ? 's' : ''}. The manager ${kind === 'opening' ? 'will explain' : 'will review'}.` : 'Count submitted. Everything matched.'); kind === 'closing' ? countView() : stockView(); }
    catch (e) { say($('#cfMsg', el), e.message, 'bad'); }
  };
}

go('orders');
