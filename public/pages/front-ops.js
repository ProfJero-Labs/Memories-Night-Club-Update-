// checkin.html, the rest of the front office and security screen (the entrance itself is
// pages/checkin.js): Tables (tonight's bookings: arrived, table number, how many people), Issues
// (incidents and handovers to the next shift) and Report (front office's end-of-night check).
// Security sees Entrance and Issues only. No money reports, no stock.
import { $, $$, esc } from '../app.js';
import { requireStaff, sapi } from '../staff.js';
import { sheet, say, st, every, bottomNav, busy, when, ask } from '../lib/ops-ui.js';

const user = await requireStaff(['superAdmin', 'director', 'manager', 'eventManager', 'doorStaff', 'security', 'organiser']);
const isFront = user.role !== 'security';
const views = { entrance: $('#vEntrance'), tables: $('#vTables'), issues: $('#vIssues'), report: $('#vReport') };
const items = isFront ? [['entrance', 'Entrance'], ['tables', 'Tables'], ['issues', 'Issues'], ['report', 'Report']] : [['entrance', 'Entrance'], ['issues', 'Issues']];
let stop = null;
// Organisers only use the entrance for their own night: no extra sections.
const nav = user.role === 'organiser' ? { setActive() {} } : bottomNav(items, k => go(k));
function go(k) {
  nav.setActive(k); if (stop) { stop(); stop = null; }
  for (const [key, el] of Object.entries(views)) el.hidden = key !== k;
  scrollTo(0, 0);
  if (k === 'tables') stop = every(15000, tables);
  if (k === 'issues') issues();
  if (k === 'report') report();
}

// ── Tables tonight ──
async function tables() {
  const el = views.tables, { tables: list } = await sapi('/api/ops/tables');
  const arrived = list.filter(t => t.arrived).length;
  el.innerHTML = `<h1 style="font:400 30px/1 var(--display);text-transform:uppercase;margin:0">Tables tonight</h1><p class="lead">${arrived} of ${list.length} arrived. Seat a table from the Entrance screen (scan or search its code), then set its number here.</p><div id="tMsg"></div>
    <div class="cards">${list.map(t => `<div class="tcard ${t.arrived ? 'done' : 'warn'}" style="cursor:default"><span class="row"><span class="t">${esc(t.name)}</span>${t.arrived ? st('delivered', `Arrived ${when(t.arrivedAt)}`) : st('waiting', 'Not here yet')}</span>
      <span class="sub">${esc(t.code)} · ${esc(t.packageName)}${t.capacity ? ` · up to ${t.capacity} people` : ''} · phone …${esc(t.phoneLast4)}</span>
      ${t.bottles.length ? `<span class="sub">Bottles paid: ${t.bottles.map(b => `${b.quantity} × ${esc(b.name)}`).join(', ')}${t.bottlesServed ? ' (served)' : ''}</span>` : ''}
      <span class="row"><span>${t.tableNumber ? `Table <b>${esc(t.tableNumber)}</b>` : 'No table number yet'}${t.guestsArrived ? ` · ${t.guestsArrived} people in` : ''}</span><button class="mid" data-set="${esc(t.orderId)}">Set table / people</button></span></div>`).join('') || '<div class="empty-box"><b>No table bookings tonight</b></div>'}</div>`;
  $$('[data-set]', el).forEach(b => b.onclick = () => {
    const t = list.find(x => x.orderId === b.dataset.set);
    const { box, close } = sheet(`<h2>${esc(t.name)}</h2><div class="sfield"><label for="tbN">Table number</label><input id="tbN" maxlength="20" value="${esc(t.tableNumber)}"></div>
      <div class="sfield"><label for="tbG">How many people came</label><input id="tbG" inputmode="numeric" value="${esc(t.guestsArrived || '')}"></div><div id="tbM"></div><button class="big" id="tbGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#tbGo', box).onclick = async () => { try { await busy($('#tbGo', box), () => sapi('/api/ops/tables', { method: 'POST', body: { orderId: t.orderId, tableNumber: $('#tbN', box).value, guestsArrived: $('#tbG', box).value === '' ? undefined : Number($('#tbG', box).value) } })); close(); tables(); } catch (e) { say($('#tbM', box), e.message, 'bad'); } };
  });
}

// ── Issues ──
async function issues() {
  const el = views.issues; el.innerHTML = '<div class="loading">Loading…</div>';
  const { incidents, kinds } = await sapi('/api/ops/incidents');
  el.innerHTML = `<h1 style="font:400 30px/1 var(--display);text-transform:uppercase;margin:0">Issues</h1><p class="lead">Anything that happened, and what the next shift or the manager needs to know.</p>
    <button class="big" id="iAdd">Record an issue</button><div id="iMsg"></div>
    <div class="cards">${incidents.map(x => `<div class="tcard ${x.status === 'resolved' ? 'done' : 'warn'}" style="cursor:default"><span class="row"><span class="t" style="font-size:20px">${esc(x.label)}</span>${st(x.status === 'resolved' ? 'delivered' : x.status === 'handed_over' ? 'handed' : 'waiting', x.status === 'resolved' ? 'Sorted' : x.status === 'handed_over' ? 'Handed over' : 'Open')}</span>
      <span>${esc(x.note)}</span>${x.people ? `<span class="sub">Who: ${esc(x.people)}</span>` : ''}<span class="sub">${esc(x.byName)} · ${esc(x.businessDate)} ${when(x.at)}${x.needsManager ? ' · manager needed' : ''}</span>
      ${x.updates.map(u => `<span class="sub">→ ${esc(u.byName)} ${when(u.at)}: ${esc(u.note)}</span>`).join('')}
      ${x.status !== 'resolved' ? `<span class="btn-row"><button class="mid" data-up="${esc(x.id)}" data-s="handed_over">Hand over</button><button class="mid okc" data-up="${esc(x.id)}" data-s="resolved">Sorted</button></span>` : ''}</div>`).join('') || '<div class="empty-box"><b>No issues</b>Quiet is good.</div>'}</div>`;
  $('#iAdd', el).onclick = () => {
    const { box, close } = sheet(`<h2>Record an issue</h2><div class="sfield"><label for="inK">What happened</label><select id="inK">${Object.entries(kinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="inN">Write what happened</label><textarea id="inN" rows="3" maxlength="600"></textarea></div><div class="sfield"><label for="inP">Who was involved (optional)</label><input id="inP" maxlength="200"></div>
      <label class="check"><input type="checkbox" id="inM"> The manager needs to see this</label><div id="inMsg"></div><button class="big" id="inGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#inGo', box).onclick = async () => { try { await busy($('#inGo', box), () => sapi('/api/ops/incidents', { method: 'POST', body: { kind: $('#inK', box).value, note: $('#inN', box).value, people: $('#inP', box).value, needsManager: $('#inM', box).checked } })); close(); issues(); } catch (e) { say($('#inMsg', box), e.message, 'bad'); } };
  };
  $$('[data-up]', el).forEach(b => b.onclick = async () => {
    const note = await ask(b.dataset.s === 'handed_over' ? { title: 'Hand it over', label: 'What does the next shift need to know?', send: 'Hand over' } : { title: 'Sorted', label: 'How was it sorted?', quick: ['Calmed down', 'Asked to leave', 'Manager handled it', 'Paid in full'], send: 'Mark sorted' }); if (!note) return;
    try { await sapi('/api/ops/incidents/update', { method: 'POST', body: { id: b.dataset.up, status: b.dataset.s, note } }); issues(); } catch (e) { say($('#iMsg', el), e.message, 'bad'); }
  });
}

// ── Front office report ──
async function report() {
  const el = views.report; el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi('/api/ops/front-report'), f = d.figures;
  el.innerHTML = `<h1 style="font:400 30px/1 var(--display);text-transform:uppercase;margin:0">End of night</h1><p class="lead">Check the numbers, hand over open issues, then submit.</p>
    <div class="nums"><div><span>Tickets checked</span><b>${f.ticketsChecked}</b></div><div><span>People in</span><b>${f.admitted}</b></div><div><span>Tables arrived</span><b>${f.tablesArrived} / ${f.tablesBooked}</b></div><div class="${f.openIssues ? 'warn' : 'good'}"><span>Open issues</span><b>${f.openIssues}</b></div></div>
    ${d.submitted ? `<div class="say good"><b>Submitted by ${esc(d.submitted.byName)} at ${when(d.submitted.at)}</b>${esc(d.submitted.note || '')}</div>` : `
      <div class="sfield"><label for="frN">Anything the manager should know</label><textarea id="frN" rows="3" maxlength="600"></textarea></div><div id="frM"></div><button class="big" id="frGo">Submit front office report</button>`}`;
  $('#frGo', el) && ($('#frGo', el).onclick = async () => { try { await busy($('#frGo', el), () => sapi('/api/ops/front-report', { method: 'POST', body: { note: $('#frN', el).value } })); report(); } catch (e) { say($('#frM', el), e.message, 'bad'); } });
}

go('entrance');
