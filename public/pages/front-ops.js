// checkin.html, the rest of the front office, security and organiser screen (the entrance itself
// is pages/checkin.js; the gate views are lib/gate-views.js):
//   Front office: Entrance, Sell (tickets and tables, cash or MoMo), Check, Tables, More (Issues,
//     End of night, Counts).
//   Security: Check (paid? member? table? VIP?), Entrance, Issues.
//   Organisers: their own night's Entrance, Check and Counts.
import { $, $$, esc } from '../app.js';
import { requireStaff, sapi } from '../staff.js';
import { sheet, say, st, every, bottomNav, busy, when, ask, backBar, bindBackBar } from '../lib/ops-ui.js';
import { sellView, checkView, tableStock, countsView } from '../lib/gate-views.js';

const user = await requireStaff(['superAdmin', 'director', 'manager', 'eventManager', 'doorStaff', 'security', 'organiser']);
const role = user.role;
const views = { entrance: $('#vEntrance'), sell: $('#vSell'), check: $('#vCheck'), counts: $('#vCounts'), tables: $('#vTables'), issues: $('#vIssues'), report: $('#vReport') };
const items = role === 'security' ? [['check', 'Check'], ['entrance', 'Entrance'], ['issues', 'Issues']]
  : role === 'organiser' ? [['entrance', 'Entrance'], ['check', 'Check'], ['counts', 'Counts']]
  : [['entrance', 'Entrance'], ['sell', 'Sell'], ['check', 'Check'], ['tables', 'Tables'], ['more', 'More']];
const tabs = items.map(i => i[0]).filter(k => k !== 'more');
const subs = role === 'security' || role === 'organiser' ? [] : ['issues', 'report', 'counts'];
const home = tabs[0];
let stop = null, current = '';
const nav = bottomNav(items, k => { if (k === 'more') more(); else location.hash = k; });
function more() {
  const { box, close } = sheet(`<h2>More</h2><div class="rows">
    <button class="row-btn" type="button" data-more="counts"><span class="t">Counts</span><span class="s">Who came in tonight and how: online, gate, tables, members</span></button>
    <button class="row-btn" type="button" data-more="issues"><span class="t">Issues</span><span class="s">Incidents and handovers</span></button>
    <button class="row-btn" type="button" data-more="report"><span class="t">End of night</span><span class="s">The front office report for the Manager</span></button></div>`, { label: 'More' });
  $$('[data-more]', box).forEach(b => b.onclick = () => { close(); setTimeout(() => { location.hash = b.dataset.more; }, 0); });
}
// Shown again when a gate view changes (a sale, a hold): the view the person is on.
const refresh = () => go(current, true);
function go(k, again = false) {
  if (![...tabs, ...subs].includes(k)) k = home;
  current = k;
  nav.setActive(tabs.includes(k) ? k : 'more'); if (stop) { stop(); stop = null; }
  for (const [key, el] of Object.entries(views)) el.hidden = key !== k;
  $('#nightBox').hidden = ['issues', 'report'].includes(k);
  if (!again) scrollTo(0, 0);
  const el = views[k], fail = e => { el.innerHTML = `${subs.includes(k) ? backBar() : ''}<div class="say bad">${esc(e.status === 0 ? 'No connection. Pull down to try again.' : e.message)}</div>`; bindBackBar(el); };
  const back = () => { if (subs.includes(k)) { el.insertAdjacentHTML('afterbegin', backBar('', home)); bindBackBar(el); } };
  if (k === 'sell') stop = every(20000, () => sellView(el, sapi, { onSold: refresh }).catch(fail));
  if (k === 'check' && !again) checkView(el, sapi);
  if (k === 'counts') stop = every(30000, () => countsView(el, sapi).then(back).catch(fail));
  if (k === 'tables') stop = every(15000, tables);
  if (k === 'issues') issues().then(back).catch(fail);
  if (k === 'report') report().then(back).catch(fail);
}
addEventListener('hashchange', () => go(location.hash.slice(1)));
// A different night: the gate views show that night.
$('#ev').addEventListener('change', () => { if (['sell', 'counts', 'tables'].includes(current)) refresh(); if (current === 'check') checkView(views.check, sapi); });
$('#ev').addEventListener('night-ready', () => { if (['sell', 'counts', 'tables'].includes(current)) refresh(); });

// ── Tables tonight ──
async function tables() {
  const el = views.tables, { tables: list } = await sapi('/api/ops/tables');
  const arrived = list.filter(t => t.arrived).length;
  el.innerHTML = `<h1 style="font:400 30px/1 var(--display);text-transform:uppercase;margin:0">Tables tonight</h1><div id="tStock" style="display:grid;gap:10px"></div><div class="group-h">Booked tonight</div><p class="lead">${arrived} of ${list.length} arrived. Seat a table from the Entrance screen (scan or search its code), then set its number here.</p><div id="tMsg"></div>
    <div class="cards">${list.map(t => `<div class="tcard ${t.arrived ? 'done' : 'warn'}" style="cursor:default"><span class="row"><span class="t">${esc(t.name)}</span>${t.arrived ? st('delivered', `Arrived ${when(t.arrivedAt)}`) : st('waiting', 'Not here yet')}</span>
      <span class="sub">${esc(t.code)} · ${esc(t.packageName)}${t.capacity ? ` · up to ${t.capacity} people` : ''} · phone …${esc(t.phoneLast4)}</span>
      ${t.bottles.length ? `<span class="sub">Bottles paid: ${t.bottles.map(b => `${b.quantity} × ${esc(b.name)}`).join(', ')}${t.bottlesServed ? ' (served)' : ''}</span>` : ''}
      <span class="row"><span>${t.tableNumber ? `Table <b>${esc(t.tableNumber)}</b>` : 'No table number yet'}${t.guestsArrived ? ` · ${t.guestsArrived} people in` : ''}</span><button class="mid" data-set="${esc(t.orderId)}">Set table / people</button></span></div>`).join('') || '<div class="empty-box"><b>No table bookings tonight</b></div>'}</div>`;
  await tableStock($('#tStock', el), sapi, { onChange: refresh }).catch(() => {});
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

go(location.hash.slice(1) || home);
