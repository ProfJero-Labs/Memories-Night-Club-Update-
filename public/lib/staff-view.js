// Staff (managers, directors, the administrator): add someone and the system texts their PIN;
// change their job; send a new PIN; remove. Shared by the control room and the night screen.
import { esc, $, $$ } from '../app.js';
import { sapi, when } from '../staff.js';
import { labelTables } from './ops-views.js';

const flash = (el, text, bad = false) => { el.innerHTML = `<div class="msg ${bad ? 'err' : ''}" role="status">${esc(text)}</div>`; if (!bad) setTimeout(() => { el.innerHTML = ''; }, 4000); };
const pill = (text, c) => `<span class="pill ${c}">${esc(text)}</span>`;
const val = id => $(id).value.trim();

export async function staffView(el, user, notice) {
  const { staff: list, roles } = await sapi('/api/admin/people');
  const roleOpts = sel => `<option value="" ${sel ? '' : 'selected'} disabled>Pick their job</option>${roles.map(r => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}`;
  const may = r => roles.some(x => x.id === r);
  const last = s => (s.lastSignInAt ? when(s.lastSignInAt) : s.hasPin ? 'Not yet' : 'No PIN yet');
  const noPin = list.filter(s => !s.hasPin && may(s.role) && s.uid !== user.uid);
  el.innerHTML = `<h1>Staff</h1>
    <p class="muted" style="margin-top:-6px">Add your staff once: they keep their access every night. Each person gets their own PIN by text and signs in with their phone number and that PIN. They can change it later if they want. Everyone here is also a member: they get in with the app, never a ticket.</p>
    <div id="pinCards"></div>
    ${noPin.length ? `<div class="card" style="display:grid;gap:8px"><strong>${noPin.length} staff ${noPin.length === 1 ? 'has' : 'have'} no PIN yet</strong><span class="muted">${noPin.map(s => esc(s.name || s.email)).join(', ')}</span><div><button class="sbtn red" id="sendAll">Text PINs to everyone without one</button></div></div>` : ''}
    <form class="card" id="addForm" novalidate><h2 style="margin:0">Add a staff member</h2>
      <div class="grid2">
        <div class="sfield"><label for="aName">Full name</label><input id="aName" maxlength="80" autocomplete="off"></div>
        <div class="sfield"><label for="aPhone">Phone number (they sign in with it)</label><input id="aPhone" type="tel" inputmode="tel" placeholder="024 123 4567"></div>
        <div class="sfield"><label for="aRole">Job</label><select id="aRole">${roleOpts('')}</select></div>
        <label class="check" style="align-self:end"><input type="checkbox" id="aCash"> Can collect cash from customers</label>
      </div>
      <div><button class="sbtn red" type="submit" id="aBtn">Add and text their PIN</button></div><div id="addMsg"></div>
    </form>
    <details class="fold"><summary>What each job can do</summary><dl class="role-key">
      <dt>Director</dt><dd>Money and reports: tonight’s sales, ticket money, refunds, end-of-day reports, members. Adds managers and finance officers.</dd>
      <dt>Manager</dt><dd>Runs the night: tables, money expected and received, approvals, closing the night, drinks & prices, stock, staff.</dd>
      <dt>Finance officer</dt><dd>Prices, stock received, money, staff reports and the end-of-day report.</dd>
      <dt>Events manager</dt><dd>Nights, tickets, tables, promos and bar setup.</dd>
      <dt>Front office</dt><dd>Tickets at the entrance, table bookings and arrivals, customer issues.</dd>
      <dt>Security</dt><dd>Checks tickets at the entrance and records incidents.</dd>
      <dt>Bartender</dt><dd>Prepares orders, hands drinks to waiters, records breakages, counts stock.</dd>
      <dt>Waiter / waitress</dt><dd>Opens tabs for tables, sends rounds to the bar, shares bills, “My report”.</dd>
      <dt>Cashier</dt><dd>Takes cash payments and counts the cash at the end of the shift.</dd>
      <dt>Organiser</dt><dd>An outside organiser: their own nights only.</dd>
      <dt>System admin</dt><dd>Everything technical: the site, nights, tickets, settings, system. Makes other admins.</dd></dl></details>
    <div id="sMsg"></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Job</th><th>Phone</th><th>Last signed in</th><th></th></tr></thead><tbody>
    ${list.map(s => `<tr data-uid="${esc(s.uid)}"><td><strong>${esc(s.name || s.email)}</strong>${s.locked ? ` ${pill('PIN locked', 'red')}` : ''}${s.canCollectCash ? `<br><small class="muted">Collects cash</small>` : ''}</td><td>${esc(s.roleName)}</td><td>${s.phone ? esc(s.phone) : pill('add phone', 'amber')}</td><td>${esc(last(s))}</td>
      <td class="actions">${may(s.role) && s.uid !== user.uid ? `<button class="sbtn" data-edit>Change</button><button class="sbtn ghost" data-pin>${s.hasPin ? 'Send a new PIN' : 'Send PIN'}</button><button class="sbtn ghost" data-rm>Remove</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">No staff yet.</td></tr>'}</tbody></table></div>`;
  const one = el => list.find(x => x.uid === el.closest('tr').dataset.uid);
  $('#addForm').onsubmit = async ev => {
    ev.preventDefault();
    const role = $('#aRole').value;
    if (!role) return flash($('#addMsg'), 'Pick their job.', true);
    if (['superAdmin', 'director'].includes(role) && !confirm(`Give ${val('#aName') || 'this person'} the ${roles.find(r => r.id === role).name} job? They’ll be able to change almost everything.`)) return;
    $('#aBtn').disabled = true;
    try {
      const r = await sapi('/api/admin/people/add', { method: 'POST', body: { name: val('#aName'), phone: val('#aPhone'), role, canCollectCash: $('#aCash').checked } });
      await staffView(el, user, { pins: [r] }); $('#aName').focus();
    } catch (e) { flash($('#addMsg'), e.message, true); $('#aBtn').disabled = false; }
  };
  $$('[data-edit]').forEach(b => b.onclick = () => {
    const s = one(b);
    const box = document.createElement('div'); box.className = 'sheet-back';
    box.innerHTML = `<form class="sheet" novalidate><h2>Change ${esc(s.name)}</h2>
      <div class="sfield"><label for="eName">Full name</label><input id="eName" maxlength="80" value="${esc(s.name)}"></div>
      <div class="sfield"><label for="ePhone">Phone number</label><input id="ePhone" type="tel" value="${esc(s.phone)}"></div>
      <div class="sfield"><label for="eRole">Job</label><select id="eRole">${roleOpts(s.role)}</select></div>
      <label class="check"><input type="checkbox" id="eCash" ${s.canCollectCash ? 'checked' : ''}> Can collect cash from customers</label>
      <div id="eMsg"></div><div class="toolbar" style="margin:0"><button class="sbtn red" type="submit">Save</button><button class="sbtn ghost" type="button" id="eClose">Cancel</button></div></form>`;
    document.body.append(box);
    box.querySelector('#eClose').onclick = () => box.remove();
    box.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      try { await sapi('/api/admin/people/update', { method: 'POST', body: { uid: s.uid, name: box.querySelector('#eName').value, phone: box.querySelector('#ePhone').value, role: box.querySelector('#eRole').value, canCollectCash: box.querySelector('#eCash').checked } }); box.remove(); staffView(el, user, { text: `Saved. ${s.name}’s new job works on their next tap.` }); }
      catch (e) { box.querySelector('#eMsg').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
    };
  });
  $$('[data-pin]').forEach(b => b.onclick = async () => {
    const s = one(b);
    if (s.hasPin && !confirm(`Send ${s.name} a new PIN? Their old PIN stops working and the new one is texted to them.`)) return;
    try { const r = await sapi('/api/admin/people/reset-pin', { method: 'POST', body: { uid: s.uid } }); staffView(el, user, { pins: [r] }); }
    catch (e) { flash($('#sMsg'), e.message, true); }
  });
  $$('[data-rm]').forEach(b => b.onclick = async () => {
    const s = one(b);
    if (!confirm(`Remove ${s.name}? They can’t sign in any more, from any phone, starting now. Their past work keeps their name.`)) return;
    try { await sapi('/api/admin/people/remove', { method: 'POST', body: { uid: s.uid } }); staffView(el, user, { text: `${s.name} removed.` }); }
    catch (e) { flash($('#sMsg'), e.message, true); }
  });
  if ($('#sendAll')) $('#sendAll').onclick = async () => {
    if (!confirm(`Text a PIN to ${noPin.length} staff?`)) return;
    $('#sendAll').disabled = true;
    try { const r = await sapi('/api/admin/people/send-pins', { method: 'POST' }); staffView(el, user, { pins: r.sent, skipped: r.skipped }); }
    catch (e) { flash($('#sMsg'), e.message, true); $('#sendAll').disabled = false; }
  };
  labelTables(el);
  if (notice?.text) flash($('#sMsg'), notice.text);
  // New PINs stay on screen until the page changes, so the manager can read one out if a text
  // doesn't arrive. They are shown only here, once: the system keeps no copy.
  if (notice?.pins) $('#pinCards').innerHTML = `<div class="card pincards" role="status"><strong>PINs sent</strong>
    ${notice.pins.map(r => `<div class="pinrow"><span>${esc(r.name)}</span><b class="pinnum">${esc(r.pin)}</b><small class="${r.texted ? 'muted' : 'warn'}">${r.texted ? `Texted to ${esc(r.phoneHint)}` : 'The text didn’t send: give them this PIN yourself'}</small></div>`).join('') || '<span class="muted">Nobody needed one.</span>'}
    ${(notice.skipped || []).map(x => `<small class="warn">${esc(x.name)}: not sent (${esc(x.why)})</small>`).join('')}
    <small class="muted">They sign in with their phone number and this PIN. This list disappears when you leave the page.</small></div>`;
}

