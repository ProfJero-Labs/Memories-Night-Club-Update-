// bar.html: the bar's screen for scan-to-order. Paid orders only (Paystack confirmed), oldest
// first, with the pickup code big. Hand over against the code on the guest's phone. Refreshes
// every 5 seconds; nothing here moves money: "Can't make it" puts the order in Refunds.
import { $, $$, esc, money } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { openQrMaker } from '../lib/qrcard.js';
const user = await requireStaff(['superAdmin', 'manager', 'eventManager', 'barStaff']);
staffHeader(user, 'Bar');
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
  $('#sWait b').textContent = data.orders.length;
  $('#sLate b').textContent = data.orders.filter(late).length; $('#sLate').classList.toggle('hot', data.orders.some(late));
  $('#sDone').textContent = data.delivered.length;
  $('#orders').innerHTML = list.map(o => `<article class="ord ${q && o.pickupCode === q ? 'hit' : ''} ${late(o) ? 'late' : ''}" aria-label="Order ${esc(o.pickupCode)}"><div class="head"><span class="code">${esc(o.pickupCode)}</span><span class="waited">${ago(o.paidAt)}</span></div>
    ${o.spot ? `<span class="spot">${esc(table(o))}</span>` : ''}
    <ul>${o.lines.map(l => `<li><b>${l.qty}×</b><span>${esc(l.name)}</span></li>`).join('')}</ul><span class="foot-small">${money(o.totalPesewas)} paid · phone …${esc(o.phoneLast4)}</span>
    <div class="act"><button class="sbtn red" data-go="${esc(o.id)}">Hand over</button><button class="sbtn ghost" data-no="${esc(o.id)}">Can’t make it</button></div></article>`).join('')
    || (q ? '<div class="bar-empty"><b>No match</b>No paid order with that code. Ask to see their phone: the code only shows once MoMo confirms.</div>' : '<div class="bar-empty"><b>All clear</b>New paid orders appear here by themselves.</div>');
  $('#done').innerHTML = data.delivered.map(o => `<tr><td><strong>${esc(o.pickupCode)}</strong></td><td>${esc(table(o)) || '—'}</td><td>${o.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', ')}</td><td>${ago(o.deliveredAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-row">None yet tonight.</td></tr>';
  $$('[data-go]').forEach(b => b.onclick = () => act(b.dataset.go, 'deliver'));
  $$('[data-no]').forEach(b => b.onclick = () => { const why = prompt('Why can’t the bar make it? (e.g. out of tequila)'); if (why !== null) act(b.dataset.no, 'refund', why); });
}
async function act(orderId, action, reason) {
  try {
    await sapi('/api/bar/order', { method: 'POST', body: { orderId, action, reason } });
    flash(action === 'deliver' ? 'Handed over.' : 'Marked for a refund. A manager will see it under Refunds.');
    $('#find').value = ''; load();
  } catch (e) { flash(e.message, true); load(); }
}
async function load() {
  clearTimeout(timer);
  try {
    data = await sapi(`/api/bar/queue?stationId=${encodeURIComponent(station)}`);
    if (!data.stations.length) { $('#orders').innerHTML = '<div class="bar-empty"><b>No bars yet</b>A manager adds them in the control room under Setup → Bar orders.</div>'; $('#qr').hidden = true; return; }
    if (data.stationId !== station) seen = null;
    station = data.stationId; open = data.open; sessionStorage.setItem('bar-station', station);
    const fresh = data.orders.filter(o => seen && !seen.has(o.id));
    if (fresh.length) { if (sound) beep(); navigator.vibrate?.(200); document.title = `(${data.orders.length}) Bar · Memories`; }
    seen = new Set(data.orders.map(o => o.id));
    $('#st').innerHTML = data.stations.map(s => `<option value="${esc(s.id)}" ${s.id === station ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#open').textContent = open ? 'Pause app orders' : 'Take app orders';
    $('#state').innerHTML = open ? '<span class="pill green">Taking app orders</span>' : '<span class="pill red">Paused: guests order at the bar</span>';
    draw();
  } catch (e) { $('#state').innerHTML = `<span class="pill red">${esc(e.status === 0 ? 'No connection' : e.message)}</span>`; }
  timer = setTimeout(load, 5000);
}
$('#qr').onclick = () => data?.stations?.length && openQrMaker(data.stations, station);
const drawSound = () => { $('#sound').textContent = sound ? 'Sound on' : 'Sound off'; $('#sound').setAttribute('aria-pressed', String(sound)); };
$('#sound').onclick = () => { sound = !sound; localStorage.setItem('bar-sound', sound ? '1' : '0'); drawSound(); if (sound) beep(); };
drawSound();
$('#st').onchange = () => { station = $('#st').value; load(); };
$('#find').oninput = () => data && draw();
$('#open').onclick = async () => {
  if (open && !confirm('Pause app orders at this bar? Guests will be told to order at the bar.')) return;
  try { await sapi('/api/bar/station-open', { method: 'POST', body: { stationId: station, open: !open } }); load(); } catch (e) { flash(e.message, true); }
};
load();
