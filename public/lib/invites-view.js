// Invitations (e.g. Ladies Night): one screen, used in the control room and inside the directors',
// managers' and Human manager's own apps. In the order it's used:
//   1. Send invitations: pick the card (ladies' visa or gentlemen's pass), paste phone numbers.
//   2. Requests from the website (ladies only): read the answers, approve or decline.
//   3. Sent: who has a card, and who's in.
//   4. The card's wording and the website (folded away): name, line, perks, dress code, passes,
//      and whether ladies can ask on the website.
import { esc, $, $$, shortDate } from '../app.js';
import { sapi, when } from '../staff.js';

const PART = 20;
const pill = (text, c) => `<span class="pill ${c}">${esc(text)}</span>`;
const flash = (el, text, bad = false) => { el.innerHTML = `<div class="say ${bad ? 'bad' : 'good'}" role="status" style="margin-top:8px">${esc(text)}</div>`; if (!bad) setTimeout(() => { el.innerHTML = ''; }, 8000); };
const val = (root, sel) => $(sel, root).value.trim();

// Paste phone numbers, one per line. Include the person's name on the same line (before or
// after the number) and an optional passes count (1–2 digits) after the number:
//   024 123 4567
//   Ama Mensah 024 123 4567
//   024 123 4567 Kofi Boateng 3
//   0201112222 3
//   +233 55 123 4567, 2
export function parseInviteLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const tokens = line.split(/[\s,;\t]+/).filter(Boolean);
    // Collect any name tokens that appear before the phone number.
    let i = 0;
    const namePre = [];
    while (i < tokens.length && !/^\+?[\d-]+$/.test(tokens[i])) { namePre.push(tokens[i]); i++; }
    // Collect the phone's digit tokens.
    let digits = '', used = i;
    while (used < tokens.length && /^\+?[\d-]+$/.test(tokens[used])) {
      const want = (digits + tokens[used]).replace(/\D/g, '');
      if (digits && want.length > (/^233/.test(want) ? 12 : 10)) break;
      digits = want; used += 1;
      if (digits.length >= (/^233/.test(digits) ? 12 : 10)) break;
    }
    // Remaining tokens: passes count and any name suffix.
    const rest = tokens.slice(used);
    const passesToken = rest.find(t => /^\d{1,2}$/.test(t));
    const namePost = rest.filter(t => t !== passesToken && /[a-zA-Z]/.test(t));
    const nameArr = [...namePre, ...namePost];
    const name = nameArr.length ? nameArr.join(' ').replace(/[^a-zA-Z\s'\-.]/g, '').trim().slice(0, 60) : undefined;
    out.push({ phone: digits || line.slice(0, 20), ...(passesToken ? { passes: Number(passesToken) } : {}), ...(name ? { name } : {}) });
  }
  return out;
}

const STATUS = { sent: ['sent', 'green'], not_texted: ['made, text failed', 'amber'], added: ['passes added', 'green'], added_not_texted: ['passes added, text failed', 'amber'], already: ['already invited', 'grey'], duplicate: ['twice in the list', 'grey'], invalid: ['not sent', 'red'], declined: ['declined', 'grey'] };

// el: where to draw. eventId: the night to open (else the one taking requests, else the next).
// onNight(id): called when another night is picked (to keep it in the address).
export async function invitesView(el, { eventId = '', onNight } = {}) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const { nights } = await sapi('/api/admin/invites/nights');
  if (!nights.length) { el.innerHTML = '<h1>Invitations</h1><p class="muted">No nights coming up. Add the night first (control room → Nights).</p>'; return; }
  const ev = nights.find(n => n.id === eventId) || nights.find(n => n.invitation.open) || nights[0], inv = ev.invitation;
  el.innerHTML = `<h1>Invitations</h1>
    <p class="muted" style="margin-top:-8px">Free entry by text: ladies get the red visa (with ${esc(inv.perk || 'the perks')}), gentlemen a black Memories card to witness the night. At the door they give their phone number; it lets them in <b>once</b>.</p>
    <div class="sfield"><label for="ivNight">Night</label><select id="ivNight">${nights.map(n => `<option value="${esc(n.id)}" ${n.id === ev.id ? 'selected' : ''}>${esc(n.name)} · ${esc(shortDate(n.date))}${n.pending ? ` · ${n.pending} waiting` : ''}</option>`).join('')}</select></div>

    <h2>Send invitations</h2>
    <div class="card">
      <div class="sfield"><label for="ivStyle">Which card</label><select id="ivStyle"><option value="her">Ladies: the red visa (${esc(inv.perk || 'no perks set')})</option><option value="him">Gentlemen: the black Memories card, a pass to witness (no free drinks)</option></select></div>
      <div class="sfield"><label for="ivPasses2">Passes for this batch</label><input id="ivPasses2" type="number" min="1" max="20" value="${inv.passes}" style="width:80px"><span class="hint">How many passes each person in this send gets. Type a different number after someone’s phone to override theirs individually.</span></div>
      <div class="sfield"><label for="ivList">Phone numbers, one per line</label>
        <textarea id="ivList" rows="7" placeholder="024 123 4567&#10;Ama Mensah 0201112222&#10;0241234567 Kofi Mensah 3&#10;+233 55 123 4567"></textarea>
        <span class="hint">Include a name before or after the number; a 1–2 digit count sets that person’s passes (otherwise ${inv.passes}). <span id="ivCount"></span></span>
        <div style="margin-top:6px"><button class="sbtn" type="button" id="ivLoadContacts">Load guest list</button> <span id="ivContactCount" class="muted" style="font-size:13px"></span></div></div>
      <div class="sfield"><label for="ivAgain">Someone already invited</label><select id="ivAgain"><option value="skip">Leave them as they are</option><option value="add">Add these passes to their invitation (texted again)</option></select></div>
      <div class="toolbar"><button class="sbtn red" type="button" id="ivSend">Send invitations</button><button class="sbtn" type="button" id="ivPreview">See the cards</button></div>
      <div id="ivMsgBox" role="status"></div><div id="ivResults"></div><div id="ivPreviewBox" style="margin-top:12px"></div>
    </div>

    <h2>Requests from the website <span class="kicker" id="ivPending"></span></h2><div id="ivReq"><div class="loading">Loading…</div></div>
    <h2>Sent <span class="kicker" id="ivTotals"></span></h2><div id="ivSent"><div class="loading">Loading…</div></div>
    <details class="card" style="margin-top:8px"><summary><b>Send reminder to all invited</b></summary>
      <div style="margin-top:10px">
        <div class="sfield"><label for="ivRemindText">Message (optional — leave blank for the default reminder)</label>
          <textarea id="ivRemindText" rows="3" placeholder="Leave blank to use the default reminder text"></textarea></div>
        <div class="toolbar"><button class="sbtn" type="button" id="ivRemind">Send reminder</button></div>
        <div id="ivRemindResult" role="status"></div>
      </div>
    </details>

    <details class="card" style="margin-top:18px"><summary><b>The card’s wording and the website</b> <span class="muted">${inv.open ? '· ladies can ask on the website' : '· website requests are off'}</span></summary>
      <div class="grid2" style="margin-top:12px">
        <div class="sfield"><label for="ivTitle">Name on the card</label><input id="ivTitle" maxlength="40" value="${esc(inv.title)}"></div>
        <div class="sfield"><label for="ivTag">Line under it (ladies)</label><input id="ivTag" maxlength="60" value="${esc(inv.tagline)}"></div>
        <div class="sfield"><label for="ivPerk">What it comes with (ladies)</label><input id="ivPerk" maxlength="60" value="${esc(inv.perk)}" placeholder="e.g. Free drinks till 12AM"></div>
        <div class="sfield"><label for="ivDress">Dress code</label><input id="ivDress" maxlength="60" value="${esc(inv.dress)}" placeholder="e.g. Strict dress code"></div>
        <div class="sfield"><label for="ivPasses">Passes per invitation</label><input id="ivPasses" type="number" min="1" max="20" value="${inv.passes}"><span class="hint">How many people one invitation lets in.</span></div>
      </div>
      <label class="check"><input type="checkbox" id="ivOpen" ${inv.open ? 'checked' : ''}> Let ladies ask for an invitation on the website</label>
      ${inv.open ? `<p class="hint" style="margin:6px 0 0">The page: <a href="${esc(ev.applyUrl)}" target="_blank" rel="noopener">${esc(ev.applyUrl)}</a> (also a button on the night’s page). <button class="sbtn" type="button" id="ivCopy">Copy link</button></p>` : ''}
      <div class="toolbar"><button class="sbtn red" type="button" id="ivSave">Save</button></div><div id="ivSaveMsg"></div>
    </details>`;

  $('#ivNight', el).onchange = () => { const id = $('#ivNight', el).value; if (onNight) onNight(id); else invitesView(el, { eventId: id, onNight }); };
  const wording = () => ({ eventId: ev.id, open: $('#ivOpen', el).checked, title: val(el, '#ivTitle'), tagline: val(el, '#ivTag'), perk: val(el, '#ivPerk'), dress: val(el, '#ivDress'), passes: Number(val(el, '#ivPasses') || 1) });
  $('#ivSave', el).onclick = async () => {
    try { await sapi('/api/admin/invites/settings', { method: 'POST', body: wording() }); await invitesView(el, { eventId: ev.id, onNight }); flash($('#ivMsgBox', el), 'Saved.'); }
    catch (err) { flash($('#ivSaveMsg', el), err.message, true); }
  };
  $('#ivCopy', el) && ($('#ivCopy', el).onclick = async () => { try { await navigator.clipboard.writeText(ev.applyUrl); $('#ivCopy', el).textContent = 'Copied'; } catch { prompt('Copy this link:', ev.applyUrl); } });
  $('#ivPreview', el).onclick = async () => {
    const s = wording(), { visaCanvas, visaPost } = await import('./visa.js');
    const base = { phoneLast4: '4567', eventName: ev.name, date: ev.date, venue: ev.venue, admits: s.passes, status: 'valid' };
    const her = { ...base, invite: { title: s.title || ev.name, tagline: s.tagline, perk: s.perk, dress: s.dress, style: 'her' } };
    const him = { ...base, invite: { title: s.title || ev.name, tagline: `A pass to witness ${s.title || ev.name}`, perk: '', dress: s.dress, style: 'him' } };
    const [c1, p1, c2] = await Promise.all([visaCanvas(her), visaPost(her), visaCanvas(him)]);
    const img = (c, alt, w = '100%') => `<img src="${c.toDataURL('image/png')}" alt="${alt}" style="width:${w};max-width:100%;height:auto">`;
    $('#ivPreviewBox', el).innerHTML = `<div style="display:grid;gap:10px;max-width:420px"><p class="hint" style="margin:0"><b>Ladies:</b> the card, and the post her Share button makes (number hidden):</p>${img(c1, 'The ladies’ card')}${img(p1, 'The ladies’ post', '300px')}
      <p class="hint" style="margin:10px 0 0"><b>Gentlemen:</b> the pass (Download only):</p>${img(c2, 'The gentlemen’s pass')}</div>`;
  };
  const count = () => { const n = parseInviteLines($('#ivList', el).value).length; $('#ivCount', el).textContent = n ? `${n} number${n > 1 ? 's' : ''}.` : ''; };
  $('#ivList', el).oninput = count;
  const report = (results, box) => {
    const good = results.filter(r => ['sent', 'added', 'declined'].includes(r.status)).length, bad = results.filter(r => !['sent', 'added', 'declined'].includes(r.status));
    box.innerHTML = `<div class="say ${bad.length ? 'warn' : 'good'}" role="status" style="margin-top:8px"><b>${good} sent${bad.length ? `, ${bad.length} to check` : ' — all done'}.</b></div>${bad.length ? `<div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><tbody>${bad.map(r => `<tr><td>${esc(r.phone || '')}</td><td>${pill(STATUS[r.status]?.[0] || r.status, STATUS[r.status]?.[1] || 'grey')}</td><td>${esc(r.message || '')}${r.link ? ` <a href="${esc(r.link)}" target="_blank" rel="noopener">card link</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  };
  const load = async () => {
    const d = await sapi(`/api/admin/invites?eventId=${encodeURIComponent(ev.id)}`);
    $('#ivTotals', el).textContent = d.totals.invitations ? `${d.totals.invitations} cards · ${d.totals.passes} passes · ${d.totals.in} in` : '';
    $('#ivSent', el).innerHTML = d.sent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Phone</th><th>Name</th><th>Card</th><th class="num">Passes</th><th>At the door</th></tr></thead><tbody>
      ${d.sent.map(x => `<tr><td>${esc(x.phone)}</td><td>${esc(x.name || '')}</td><td>${x.style === 'him' ? 'Gentleman' : 'Lady'}</td><td class="num">${x.passes}</td><td>${x.status === 'used' ? pill(`in ${when(x.checkedInAt)}`, 'green') : x.status === 'cancelled' ? pill('cancelled', 'red') : pill('not yet', 'grey')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">None sent yet.</p>';
    const pending = d.requests.filter(r => r.status === 'pending'), done = d.requests.filter(r => r.status !== 'pending');
    $('#ivPending', el).textContent = pending.length ? `${pending.length} waiting` : '';
    $('#ivReq', el).innerHTML = `${pending.length ? `<div class="toolbar"><label class="check" style="margin:0"><input type="checkbox" id="ivAll"> Select all</label><button class="sbtn ok" type="button" data-decide="approve">Approve selected</button><button class="sbtn" type="button" data-decide="decline">Decline selected</button></div>
      <div class="cards">${pending.map(r => `<label class="tcard" style="cursor:pointer;display:grid;gap:6px"><span class="row" style="display:flex;justify-content:space-between;gap:10px"><span><input type="checkbox" data-req="${esc(r.id)}"> <b>${esc(r.name || r.phone)}</b>${r.name ? ` · ${esc(r.phone)}` : ''}${r.instagram ? ` · <a href="https://instagram.com/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener">@${esc(r.instagram)}</a>` : ''}</span><span class="muted">${esc(when(r.createdAt))}</span></span>
        ${r.answers.map(x => `<span><span class="muted">${esc(x.q)}</span><br>${esc(x.a)}</span>`).join('')}</label>`).join('')}</div>`
      : `<p class="muted" style="margin:0">${inv.open ? 'No requests waiting.' : 'Website requests are off: turn them on under “The card’s wording and the website” below.'}</p>`}
      ${done.length ? `<details style="margin-top:10px"><summary>${done.length} decided</summary><div class="tbl-wrap"><table class="tbl"><tbody>${done.map(r => `<tr><td>${esc(r.name || r.phone)}</td><td>${r.name ? `<span class="muted">${esc(r.phone)}</span>` : ''}</td><td>${pill(r.status, r.status === 'approved' ? 'green' : 'grey')}</td><td>${esc(r.decidedByName)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}<div id="ivReqMsg"></div>`;
    $('#ivAll', el) && ($('#ivAll', el).onchange = e => $$('[data-req]', el).forEach(c => { c.checked = e.target.checked; }));
    $$('[data-decide]', el).forEach(btn => btn.onclick = async () => {
      const ids = $$('[data-req]', el).filter(c => c.checked).map(c => c.dataset.req);
      if (!ids.length) return flash($('#ivReqMsg', el), 'Tick at least one request.', true);
      const approve = btn.dataset.decide === 'approve';
      if (!confirm(approve ? `Approve ${ids.length} and text each their card?` : `Decline ${ids.length}? (No text is sent.)`)) return;
      btn.disabled = true; const results = [];
      try { for (let i = 0; i < ids.length; i += PART) results.push(...(await sapi('/api/admin/invites/decide', { method: 'POST', body: { eventId: ev.id, ids: ids.slice(i, i + PART), decision: btn.dataset.decide } })).results); }
      catch (err) { flash($('#ivReqMsg', el), err.message, true); }
      await load(); report(results, $('#ivReqMsg', el));
    });
  };
  $('#ivSend', el).onclick = async () => {
    const batchPasses = Math.max(1, Number($('#ivPasses2', el).value) || inv.passes);
    const rows = parseInviteLines($('#ivList', el).value).map(r => r.passes ? r : { ...r, passes: batchPasses }), style = $('#ivStyle', el).value;
    if (!rows.length) return flash($('#ivMsgBox', el), 'Paste at least one phone number.', true);
    if (!confirm(`Send ${rows.length} ${style === 'him' ? 'gentlemen’s pass' : 'ladies’ invitation'}${rows.length > 1 ? 'es' : ''} for ${ev.name} by text?`.replace('invitationes', 'invitations'))) return;
    const btn = $('#ivSend', el); btn.disabled = true; const results = [];
    try {
      for (let i = 0; i < rows.length; i += PART) {
        btn.textContent = `Sending ${Math.min(i + PART, rows.length)} of ${rows.length}…`;
        results.push(...(await sapi('/api/admin/invites', { method: 'POST', body: { eventId: ev.id, rows: rows.slice(i, i + PART), ifInvited: $('#ivAgain', el).value, style } })).results);
      }
    } catch (err) { flash($('#ivMsgBox', el), `${err.message} (${results.length} of ${rows.length} done).`, true); }
    btn.disabled = false; btn.textContent = 'Send invitations';
    report(results, $('#ivResults', el));
    $('#ivList', el).value = results.filter(r => r.status === 'invalid').map(r => r.phone).join('\n'); count();
    load();
  };
  await load();

  // Load guest list contact count badge, then wire up "Load guest list" button.
  sapi('/api/admin/invites/contacts').then(({ total }) => {
    const badge = $('#ivContactCount', el);
    if (badge) badge.textContent = total ? `· ${total} saved` : '';
  }).catch(() => {});
  $('#ivLoadContacts', el).onclick = async () => {
    const btn = $('#ivLoadContacts', el);
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const { contacts } = await sapi('/api/admin/invites/contacts');
      $('#ivList', el).value = contacts.map(c => c.name ? `${c.name} ${c.phone}` : c.phone).join('\n');
      $('#ivList', el).dispatchEvent(new Event('input'));
    } catch (err) { flash($('#ivMsgBox', el), err.message, true); }
    btn.disabled = false; btn.textContent = 'Load guest list';
  };

  $('#ivRemind', el).onclick = async () => {
    const btn = $('#ivRemind', el);
    const msg = val(el, '#ivRemindText');
    if (!confirm('Send a reminder text to all invited guests who haven\'t checked in yet?')) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const r = await sapi('/api/admin/invites/remind', { method: 'POST', body: { eventId: ev.id, ...(msg ? { message: msg } : {}) } });
      flash($('#ivRemindResult', el), `Reminder sent to ${r.sent} guest${r.sent !== 1 ? 's' : ''}${r.failed ? ` (${r.failed} failed)` : ''}.`);
    } catch (err) { flash($('#ivRemindResult', el), err.message, true); }
    btn.disabled = false; btn.textContent = 'Send reminder';
  };
}
