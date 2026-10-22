// Staff (managers, directors, the administrator): one calm list, one line per person, grouped by
// job. "+ Add staff" opens the form in a panel; tapping a person opens their details and what can
// be done (change job/name/phone, send a new PIN, collect cash, a director's share, remove).
// Shared by the control room, the night screen and the Human manager.
import { esc, $, $$ } from '../app.js';
import { sapi, when } from '../staff.js';
import { sheet, say, busy } from './ops-ui.js';

// Jobs in the order people think of them (the boss first, outside organisers last).
const ORDER = ['superAdmin', 'director', 'manager', 'hrManager', 'finance', 'eventManager', 'doorStaff', 'security', 'barStaff', 'waitStaff', 'cashier', 'dj', 'mc', 'organiser'];
const rank = r => { const i = ORDER.indexOf(r); return i < 0 ? 99 : i; };
const plural = n => (n === 1 ? '1 person' : `${n} people`);
const digits = s => String(s || '').replace(/\D/g, '').replace(/^233/, '0');
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const day = d => new Date(d).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

const ROLE_KEY = `<details class="fold"><summary>What each job can do</summary><dl class="role-key">
  <dt>Director</dt><dd>The club’s money: profit, their share, bills, salaries, commissions, reviews. Approves every payment. Adds managers and finance officers.</dd>
  <dt>Manager</dt><dd>Purchases, sales, stock and counts, cash from the staff, customers, approvals, closing the night.</dd>
  <dt>Human manager</dt><dd>The floor and customers (tables, reviews, complaints) and the people: staff accounts, members, salaries, bonuses, loans, notices, feedback, reviews.</dd>
  <dt>Finance officer</dt><dd>Prices and costs, purchases, money, bills and budget, paying (once a director approves), end-of-day report.</dd>
  <dt>Event manager</dt><dd>Nights, tickets, promos, bookings, organiser accounts, table service and discounts.</dd>
  <dt>DJ / MC</dt><dd>Their page: notices, team messages, pay slips, feedback.</dd>
  <dt>Front office</dt><dd>Tickets at the entrance, table bookings and arrivals, customer issues.</dd>
  <dt>Security</dt><dd>Checks tickets at the entrance and records incidents.</dd>
  <dt>Bartender</dt><dd>Prepares orders, hands drinks to waiters, records breakages, counts stock.</dd>
  <dt>Waiter / waitress</dt><dd>Opens tabs for tables, sends rounds to the bar, shares bills, “My report”.</dd>
  <dt>Cashier</dt><dd>Takes cash payments and counts the cash at the end of the shift.</dd>
  <dt>Organiser</dt><dd>An outside organiser: their own nights only.</dd>
  <dt>System admin</dt><dd>Everything technical: the site, nights, tickets, settings, system. Makes other admins.</dd></dl></details>`;

// notice: { text } a confirmation to show, { pins, skipped } PINs just given out, { q } the search.
export async function staffView(el, user, notice = {}) {
  const { staff: list, roles } = await sapi('/api/admin/people');
  const onlyOrganisers = user.role === 'eventManager';
  const noun = onlyOrganisers ? 'organiser' : 'staff';
  const roleOpts = sel => `<option value="" ${sel ? '' : 'selected'} disabled>Pick their job</option>${roles.map(r => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}`;
  const may = s => roles.some(x => x.id === s.role) && s.uid !== user.uid;
  const seen = s => (s.lastSignInAt ? `signed in ${day(s.lastSignInAt)}` : s.hasPin ? 'not signed in yet' : 'no PIN yet');
  const noPin = list.filter(s => !s.hasPin && may(s));
  const again = extra => staffView(el, user, { q: q(), ...extra });
  const q = () => $('#sQ', el)?.value ?? notice.q ?? '';

  el.innerHTML = `<div class="staffv">
    <h1>${onlyOrganisers ? 'Organisers' : 'Staff'}</h1>
    <p class="lead muted">${plural(list.length)}. Tap someone to change their job or send a new PIN.</p>
    <div id="pinCards"></div>
    <div id="sMsg"></div>
    ${roles.length ? `<button type="button" class="big add-btn" id="addBtn">+ Add ${noun}</button>` : ''}
    ${noPin.length ? `<div class="say warn staff-nopin"><b>${noPin.length} ${noPin.length === 1 ? 'person has' : 'people have'} no PIN yet</b><span>${noPin.map(s => esc(s.name || s.email)).join(', ')}</span><button type="button" class="sbtn" id="sendAll">Text them their PINs</button></div>` : ''}
    ${list.length > 8 ? `<input type="search" class="searchbox" id="sQ" placeholder="Search name, job or phone" aria-label="Search staff" autocomplete="off" value="${esc(notice.q || '')}">` : ''}
    <div id="sList"></div></div>`;

  // ── The list ──
  const row = s => {
    const flag = s.locked ? '<span class="pill red">PIN locked</span>' : !s.hasPin && may(s) ? '<span class="pill amber">No PIN</span>' : !s.phone ? '<span class="pill amber">No phone</span>' : '';
    const sub = [s.uid === user.uid ? 'You' : '', s.canCollectCash ? 'Collects cash' : '', s.sharePct ? `${s.sharePct}% share` : '', seen(s)].filter(Boolean).join(' · ');
    return `<button type="button" class="row-btn" data-person="${esc(s.uid)}"><span class="t">${esc(s.name || s.email)}</span><span class="s">${esc(sub.charAt(0).toUpperCase() + sub.slice(1))}</span><span class="r">${flag}</span></button>`;
  };
  const drawList = () => {
    const words = fold(q()).split(/\s+/).filter(Boolean);
    const hit = s => { const hay = `${fold(s.name)} ${fold(s.email)} ${fold(s.roleName)} ${digits(s.phone)}`; return words.every(w => hay.includes(w) || (/\d/.test(w) && digits(s.phone).includes(digits(w)))); };
    const shown = list.filter(hit);
    const groups = [...new Set(shown.map(s => s.role))].sort((a, b) => rank(a) - rank(b));
    $('#sList', el).innerHTML = !list.length ? `<p class="muted">No ${noun} yet. Tap “+ Add ${noun}” to add the first one.</p>`
      : !shown.length ? `<p class="muted" role="status">No one called “${esc(q().trim())}”.</p>`
      : groups.map(r => { const g = shown.filter(s => s.role === r); return `<h2 class="group-h">${esc(g[0].roleName)} · ${g.length}</h2><div class="rows">${g.map(row).join('')}</div>`; }).join('');
    $$('[data-person]', el).forEach(b => b.onclick = () => person(list.find(s => s.uid === b.dataset.person)));
  };
  if ($('#sQ', el)) $('#sQ', el).oninput = drawList;
  drawList();

  // ── Add someone ──
  if ($('#addBtn', el)) $('#addBtn', el).onclick = () => {
    const { box, close } = sheet(`<form id="addForm" novalidate style="display:grid;gap:14px"><h2>Add ${noun}</h2>
      <div class="sfield"><label for="aName">Full name</label><input id="aName" maxlength="80" autocomplete="off" autocapitalize="words"></div>
      <div class="sfield"><label for="aPhone">Phone number (they sign in with it)</label><input id="aPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="024 123 4567"></div>
      <div class="sfield"><label for="aRole">Job</label><select id="aRole">${roleOpts(roles.length === 1 ? roles[0].id : '')}</select></div>
      <label class="check"><input type="checkbox" id="aCash"> Can collect cash from customers</label>
      <p class="muted" style="margin:0">We text them a PIN. They sign in with their phone number and that PIN, and keep their access every night.</p>
      ${onlyOrganisers ? '' : ROLE_KEY}
      <div id="addMsg"></div>
      <div class="sheet-dock"><button class="big" type="submit" id="aBtn">Add and text their PIN</button></div></form>`, { label: `Add ${noun}` });
    const v = id => $(id, box).value.trim();
    $('#addForm', box).onsubmit = ev => {
      ev.preventDefault();
      const role = $('#aRole', box).value;
      if (!v('#aName')) { say($('#addMsg', box), 'Add their name.', 'bad'); return $('#aName', box).focus(); }
      if (!v('#aPhone')) { say($('#addMsg', box), 'Add their phone number, e.g. 024 123 4567.', 'bad'); return $('#aPhone', box).focus(); }
      if (!role) { say($('#addMsg', box), 'Pick their job.', 'bad'); return $('#aRole', box).focus(); }
      if (['superAdmin', 'director'].includes(role) && !confirm(`Give ${v('#aName')} the ${roles.find(r => r.id === role).name} job? They’ll be able to change almost everything.`)) return;
      busy($('#aBtn', box), async () => {
        try {
          const r = await sapi('/api/admin/people/add', { method: 'POST', body: { name: v('#aName'), phone: v('#aPhone'), role, canCollectCash: $('#aCash', box).checked } });
          close(); await again({ pins: [r] });
        } catch (e) { say($('#addMsg', box), e.message, 'bad'); }
      }, 'Adding…');
    };
  };

  // ── One person: their details, then what can be done ──
  function person(s) {
    const can = may(s);
    const { box, close } = sheet('<div class="pbody" style="display:grid;gap:14px"></div>', { label: s.name || 'Staff member' });
    const body = $('.pbody', box);
    const msg = (t, k) => say($('#pMsg', box), t, k);
    const done = async extra => { close(); await again(extra); };
    const fact = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
    const details = () => {
      body.innerHTML = `<h2>${esc(s.name || s.email)}</h2>
        <dl class="pfacts">
          ${fact('Job', esc(s.roleName))}
          ${fact('Phone', s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : '<span class="pill amber">No phone yet</span>')}
          ${fact('Last signed in', esc(s.lastSignInAt ? when(s.lastSignInAt) : s.hasPin ? 'Not yet' : 'No PIN yet'))}
          ${s.locked ? fact('PIN', '<span class="pill red">Locked: send a new PIN</span>') : ''}
          ${s.role === 'director' ? fact('Share of the club', esc(`${s.sharePct || 0}%`)) : ''}
        </dl>
        ${can ? `<label class="check"><input type="checkbox" id="pCash" ${s.canCollectCash ? 'checked' : ''}> Can collect cash from customers</label>
        <div class="rows">
          <button type="button" class="row-btn" data-edit><span class="t">Change name, phone or job</span><span class="s">${esc(s.roleName)}</span><span class="r"></span></button>
          <button type="button" class="row-btn" data-pin><span class="t">${s.hasPin ? 'Send a new PIN' : 'Send PIN'}</span><span class="s">${s.hasPin ? 'Their old PIN stops working' : 'Texted to their phone'}</span><span class="r"></span></button>
        </div>
        <div id="pinAsk"></div>
        <div id="pMsg"></div>
        <button type="button" class="big ghost staff-rm" data-rm>Remove ${esc(s.name || 'them')}</button>`
        : `<p class="muted">${s.uid === user.uid ? 'This is you. Ask another manager to change your job.' : `Your job can’t change a ${esc(s.roleName)}. Ask a director or the system admin.`}</p>`}`;
      if (!can) return;
      $('#pCash', box).onchange = async e => {
        const on = e.target.checked; e.target.disabled = true;
        try { await sapi('/api/admin/people/update', { method: 'POST', body: { uid: s.uid, canCollectCash: on } }); s.canCollectCash = on; msg(on ? `${s.name} can collect cash now.` : `${s.name} no longer collects cash.`); drawList(); }
        catch (err) { e.target.checked = !on; msg(err.message, 'bad'); }
        finally { e.target.disabled = false; }
      };
      $('[data-edit]', box).onclick = edit;
      $('[data-pin]', box).onclick = () => {
        const go = async btn => busy(btn, async () => {
          try { const r = await sapi('/api/admin/people/reset-pin', { method: 'POST', body: { uid: s.uid } }); await done({ pins: [r] }); }
          catch (err) { msg(err.message, 'bad'); }
        }, 'Sending…');
        if (!s.hasPin) return go($('[data-pin]', box));
        // Someone with a PIN: one more tap to be sure (their old PIN stops working).
        $('#pinAsk', box).innerHTML = `<div class="say warn"><b>Send ${esc(s.name)} a new PIN?</b>Their old PIN stops working now and the new one is texted to them.</div><button type="button" class="big" id="pinGo" style="margin-top:10px">Send the new PIN</button>`;
        $('#pinGo', box).onclick = () => go($('#pinGo', box));
        $('#pinGo', box).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      $('[data-rm]', box).onclick = async () => {
        if (!confirm(`Remove ${s.name}? They can’t sign in any more, from any phone, starting now. Their past work keeps their name.`)) return;
        await busy($('[data-rm]', box), async () => {
          try { await sapi('/api/admin/people/remove', { method: 'POST', body: { uid: s.uid } }); await done({ text: `${s.name} removed.` }); }
          catch (err) { msg(err.message, 'bad'); }
        }, 'Removing…');
      };
    };
    const edit = () => {
      const share = s.role === 'director' && user.role === 'superAdmin';
      body.innerHTML = `<form id="eForm" novalidate style="display:grid;gap:14px"><h2>Change ${esc(s.name)}</h2>
        <div class="sfield"><label for="eName">Full name</label><input id="eName" maxlength="80" autocapitalize="words" value="${esc(s.name)}"></div>
        <div class="sfield"><label for="ePhone">Phone number</label><input id="ePhone" type="tel" inputmode="tel" value="${esc(s.phone)}"></div>
        <div class="sfield"><label for="eRole">Job</label><select id="eRole">${roleOpts(s.role)}</select></div>
        ${share ? `<div class="sfield"><label for="eShare">Their share of the club (%)</label><input id="eShare" inputmode="decimal" value="${esc(s.sharePct ?? '')}" placeholder="e.g. 35"></div>` : ''}
        ${onlyOrganisers ? '' : ROLE_KEY}
        <div id="pMsg"></div>
        <div class="sheet-dock" style="display:grid;gap:6px"><button class="big" type="submit" id="eSave">Save</button><button type="button" class="link" id="eBack" style="justify-self:center;background:none;border:0;color:var(--paper)">Cancel</button></div></form>`;
      $('#eName', box).focus();
      $('#eBack', box).onclick = details;
      $('#eForm', box).onsubmit = ev => {
        ev.preventDefault();
        const role = $('#eRole', box).value;
        busy($('#eSave', box), async () => {
          try {
            await sapi('/api/admin/people/update', { method: 'POST', body: { uid: s.uid, name: $('#eName', box).value, phone: $('#ePhone', box).value, role, ...($('#eShare', box) ? { sharePct: $('#eShare', box).value } : {}) } });
            await done({ text: role !== s.role ? `Saved. ${s.name}’s new job works on their next tap.` : `Saved ${$('#eName', box).value.trim() || s.name}.` });
          } catch (err) { msg(err.message, 'bad'); }
        });
      };
    };
    details();
  }

  // ── Everyone without a PIN: one tap to see who, a second to send ──
  if ($('#sendAll', el)) $('#sendAll', el).onclick = e => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.className = 'sbtn red'; b.textContent = `Yes, text ${noPin.length} PIN${noPin.length === 1 ? '' : 's'} now`; return; }
    busy(b, async () => {
      try { const r = await sapi('/api/admin/people/send-pins', { method: 'POST' }); await again({ pins: r.sent, skipped: r.skipped }); }
      catch (err) { say($('#sMsg', el), err.message, 'bad'); }
    }, 'Sending…');
  };

  if (notice.text) say($('#sMsg', el), notice.text);
  // New PINs stay on screen until the page changes, so the manager can read one out if a text
  // doesn't arrive. They are shown only here, once: the system keeps no copy.
  if (notice.pins) $('#pinCards', el).innerHTML = `<div class="card pincards" role="status"><strong>PINs sent</strong>
    ${notice.pins.map(r => `<div class="pinrow"><span>${esc(r.name)}</span><b class="pinnum">${esc(r.pin)}</b><small class="${r.texted ? 'muted' : 'warn'}">${r.texted ? `Texted to ${esc(r.phoneHint)}` : 'The text didn’t send: give them this PIN yourself'}</small></div>`).join('') || '<span class="muted">Nobody needed one.</span>'}
    ${(notice.skipped || []).map(x => `<small class="warn">${esc(x.name)}: not sent (${esc(x.why)})</small>`).join('')}
    <small class="muted">They sign in with their phone number and this PIN. This list disappears when you leave the page.</small></div>`;
}
