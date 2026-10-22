// bar.html: the bar's screen for scan-to-order. Paid orders only (Paystack confirmed), oldest
// first, with the pickup code big. Hand over against the code on the guest's phone. Refreshes
// every 5 seconds; nothing here moves money. Paid orders are only cancelled by the Manager (a refund).
import { $, $$, esc, money } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { openQrMaker } from '../lib/qrcard.js';
import { ask, sheet } from '../lib/ops-ui.js';
const user = await requireStaff(['superAdmin', 'director', 'manager', 'eventManager', 'barStaff']);
staffHeader(user, 'Bar');
// The guest has paid: only the Manager can cancel it (a refund). Nothing sells past zero, so the drinks are there.
const canCancel = ['superAdmin', 'manager'].includes(user.role);
let station = sessionStorage.getItem('bar-station') || '', open = true, timer = null, data = null, seen = null;
let sound = localStorage.getItem('bar-sound') === '1';
const flash = (t, bad = false) => { $('#msg').innerHTML = t ? `<div class="msg ${bad ? 'err' : ''}" role="status">${esc(t)}</div>` : ''; if (t && !bad) setTimeout(() => flash(''), 3500); };
const ago = d => { const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };
const late = o => Date.now() - new Date(o.paidAt).getTime() > 10 * 60000;
const table = o => (o.spot ? `Table ${o.spot.replace(/^table\s*/i, '')}` : '');
// A short beep when a new paid order lands (opt-in: browsers only allow sound after a tap).
let ctx;
const beep = () => { try { ctx ||= new AudioContext(); const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .35); o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .35); } catch { /* no audio */ } };

function draw() {
  const q = $('#find').value.trim().toUpperCase();
  const list = data.orders.filter(o => !q || o.pickupCode.startsWith(q));
  const lateN = data.orders.filter(late).length;
  // The code box only shows when there's an order to find (or a code is being typed).
  $('#findBox').hidden = !data.orders.length && !q;
  $('#aCount').innerHTML = data.orders.length ? `${data.orders.length} waiting${lateN ? ` · <span class="hot">${lateN} over 10 min</span>` : ''}` : (data.delivered.length ? `${data.delivered.length} handed over` : '');
  $('#orders').innerHTML = list.map(o => `<article class="ord ${q && o.pickupCode === q ? 'hit' : ''} ${late(o) ? 'late' : ''}" aria-label="Order ${esc(o.pickupCode)}"><div class="head"><span class="code">${esc(o.pickupCode)}</span><span class="waited">${ago(o.paidAt)}</span></div>
    ${o.spot ? `<span class="spot">${esc(table(o))}</span>` : ''}
    <ul>${o.lines.map(l => `<li><b>${l.qty}×</b><span>${esc(l.name)}</span></li>`).join('')}</ul><span class="note-small">${money(o.totalPesewas)} paid · phone …${esc(o.phoneLast4)}</span>
    <button class="big step" data-go="${esc(o.id)}">Hand over</button>${canCancel ? `<div class="more"><button type="button" data-no="${esc(o.id)}">Cancel and refund</button></div>` : '<span class="note-small">Paid: it can’t be cancelled here. A problem? Call the Manager.</span>'}</article>`).join('')
    || (q ? '<p class="none"><b>No match.</b> No paid order with that code. Ask to see their phone: the code only shows once MoMo confirms.</p>' : `<p class="none">${open ? 'None waiting. Paid orders appear here by themselves.' : 'Paused: guests order at the bar.'}</p>`);
  $('#doneWrap').hidden = !data.delivered.length;
  $('#done').innerHTML = data.delivered.map(o => `<tr><td data-label="Code"><strong>${esc(o.pickupCode)}</strong></td><td data-label="Table">${esc(table(o)) || '—'}</td><td data-label="Drinks">${o.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', ')}</td><td data-label="When">${ago(o.deliveredAt)}</td></tr>`).join('');
  $$('[data-go]').forEach(b => b.onclick = () => act(b.dataset.go, 'deliver'));
  $$('[data-no]').forEach(b => b.onclick = async () => { const why = await ask({ title: 'Cancel a paid order', label: 'This guest has paid. Only cancel if it truly can’t be served. Why?', quick: ['Bottle broke', 'Finished', 'Guest left'], send: 'Cancel and refund', danger: true }); if (why) act(b.dataset.no, 'refund', why); });
}
async function act(orderId, action, reason) {
  try {
    await sapi('/api/bar/order', { method: 'POST', body: { orderId, action, reason } });
    flash(action === 'deliver' ? 'Handed over.' : 'Marked for a refund. A manager will see it under Refunds.');
    $('#find').value = ''; load();
  } catch (e) { flash(e.message, true); load(); }
}
// The status line on every tab: the bar's name and whether app orders are on. Tap it for the settings.
const drawStatus = () => {
  const s = data?.stations?.find(x => x.id === station);
  $('#stName').textContent = s?.name || 'Bar';
  $('#state').innerHTML = open ? '<span class="lamp">App orders on</span>' : '<span class="lamp off">App orders paused</span>';
};
async function load() {
  clearTimeout(timer);
  try {
    data = await sapi(`/api/bar/queue?stationId=${encodeURIComponent(station)}`);
    if (!data.stations.length) { $('#orders').innerHTML = '<p class="none"><b>No bars yet.</b> A manager adds them in the control room under Setup → Bar orders.</p>'; return; }
    if (data.stationId !== station) seen = null;
    station = data.stationId; open = data.open; sessionStorage.setItem('bar-station', station); document.dispatchEvent(new CustomEvent('bar-station', { detail: station }));
    const fresh = data.orders.filter(o => seen && !seen.has(o.id));
    if (fresh.length) { if (sound) beep(); navigator.vibrate?.(200); document.title = `(${data.orders.length}) Bar · Memories`; }
    seen = new Set(data.orders.map(o => o.id));
    drawStatus(); if (setBox) drawSettings();
    draw();
  } catch (e) { $('#state').innerHTML = `<span class="lamp off">${esc(e.status === 0 ? 'No connection' : e.message)}</span>`; }
  timer = setTimeout(load, 5000);
}

// ── Settings (behind ⚙): which bar, pause app orders, table QR codes, sound ──
let setBox = null;
function drawSettings() {
  const many = data?.stations?.length > 1;
  $('.sheet-body', setBox).innerHTML = `
    ${many ? `<div class="sfield"><label for="st">Which bar</label><select id="st">${data.stations.map(s => `<option value="${esc(s.id)}" ${s.id === station ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
    <div class="stat-rows"><div><span>App orders (guests pay by QR)</span><b>${open ? '<span class="lamp">On</span>' : '<span class="lamp off">Paused</span>'}</b></div></div>
    <button class="big ghost" id="open" type="button">${open ? 'Pause app orders' : 'Take app orders'}</button>
    <button class="big ghost" id="qr" type="button" ${data?.stations?.length ? '' : 'hidden'}>Table QR codes</button>
    <button class="big ghost" id="sound" type="button" aria-pressed="${sound}">${sound ? 'Sound for new orders: on' : 'Sound for new orders: off'}</button>
    <div id="setMsg"></div>`;
  const box = setBox;
  $('#st', box) && ($('#st', box).onchange = () => { station = $('#st', box).value; load(); document.dispatchEvent(new CustomEvent('bar-station', { detail: station })); });
  $('#qr', box).onclick = () => { const st = data.stations; close(); openQrMaker(st, station); };
  $('#sound', box).onclick = () => { sound = !sound; localStorage.setItem('bar-sound', sound ? '1' : '0'); drawSettings(); if (sound) beep(); };
  $('#open', box).onclick = async () => {
    if (open && !confirm('Pause app orders at this bar? Guests will be told to order at the bar.')) return;
    try { await sapi('/api/bar/station-open', { method: 'POST', body: { stationId: station, open: !open } }); await load(); } catch (e) { $('#setMsg', box).innerHTML = `<div class="say bad" role="alert">${esc(e.message)}</div>`; }
  };
}
let close = () => {};
$('#barSet').onclick = () => {
  const s = sheet('<h2>Bar settings</h2><div class="sheet-body" style="display:grid;gap:12px"></div><button class="big" data-close>Done</button>', { label: 'Bar settings' });
  setBox = s.box; close = s.close; drawSettings();
  new MutationObserver((_, o) => { if (!document.body.contains(s.box)) { o.disconnect(); if (setBox === s.box) setBox = null; } }).observe(document.body, { childList: true });
};
$('#find').oninput = () => data && draw();
load();
