// bar.html: the bar's screen for scan-to-order. Paid orders only (Paystack confirmed), oldest
// first, with the pickup code big. Hand over against the code on the guest's phone. Refreshes
// every 5 seconds; nothing here moves money: "Can't make it" puts the order in Refunds.
import { $, $$, esc, money } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
const user = await requireStaff(['superAdmin', 'manager', 'eventManager', 'barStaff']);
staffHeader(user, 'Bar');
let station = sessionStorage.getItem('bar-station') || '', open = true, timer = null, data = null;
const flash = (t, bad = false) => { $('#msg').innerHTML = t ? `<div class="msg ${bad ? 'err' : ''}" role="status">${esc(t)}</div>` : ''; if (t && !bad) setTimeout(() => flash(''), 3500); };
const ago = d => { const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000)); return m < 1 ? 'just now' : `${m} min ago`; };

function draw() {
  const q = $('#find').value.trim().toUpperCase();
  const list = data.orders.filter(o => !q || o.pickupCode.startsWith(q));
  $('#n').textContent = `${data.orders.length}`;
  $('#orders').innerHTML = list.map(o => `<article class="ord ${q && o.pickupCode === q ? 'hit' : ''}"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><span class="code">${esc(o.pickupCode)}</span><span class="waited ${Date.now() - new Date(o.paidAt).getTime() > 10 * 60000 ? 'late' : ''}">${ago(o.paidAt)}</span></div>
    <ul>${o.lines.map(l => `<li><strong>${l.qty} ×</strong> ${esc(l.name)}</li>`).join('')}</ul><span class="foot-small">${money(o.totalPesewas)} paid · phone …${esc(o.phoneLast4)}</span>
    <div class="act"><button class="sbtn red" data-go="${esc(o.id)}">Hand over</button><button class="sbtn ghost" data-no="${esc(o.id)}">Can’t make it</button></div></article>`).join('') || `<p class="muted">${q ? 'No paid order with that code. Ask to see their phone: the code only shows once MoMo confirms.' : 'Nothing waiting.'}</p>`;
  $('#done').innerHTML = data.delivered.map(o => `<tr><td><strong>${esc(o.pickupCode)}</strong></td><td>${o.lines.map(l => `${l.qty} × ${esc(l.name)}`).join(', ')}</td><td>${ago(o.deliveredAt)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-row">None yet tonight.</td></tr>';
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
    if (!data.stations.length) { $('#orders').innerHTML = '<p class="muted">No bars set up yet. A manager adds them in the control room under Setup → Bar orders.</p>'; return; }
    station = data.stationId; open = data.open; sessionStorage.setItem('bar-station', station);
    $('#st').innerHTML = data.stations.map(s => `<option value="${esc(s.id)}" ${s.id === station ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    $('#open').textContent = open ? 'Pause app orders' : 'Take app orders';
    $('#state').innerHTML = open ? '<span class="pill green">Taking app orders</span>' : '<span class="pill red">Paused</span>';
    draw();
  } catch (e) { $('#state').innerHTML = `<span class="pill red">${esc(e.status === 0 ? 'No connection' : e.message)}</span>`; }
  timer = setTimeout(load, 5000);
}
$('#st').onchange = () => { station = $('#st').value; load(); };
$('#find').oninput = () => data && draw();
$('#open').onclick = async () => {
  if (open && !confirm('Pause app orders at this bar? Guests will be told to order at the bar.')) return;
  try { await sapi('/api/bar/station-open', { method: 'POST', body: { stationId: station, open: !open } }); load(); } catch (e) { flash(e.message, true); }
};
load();
