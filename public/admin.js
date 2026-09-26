// Control room. Every read and write goes through the Worker with the signed-in user's token;
// the Worker enforces roles, validation and audit logging. Uploads go to Firebase Storage.
import { esc, money, $, $$, shortDate } from './app.js';
import { requireStaff, staffHeader, sapi, compressImage, ghs, pes, when, ROLE_LABEL } from './staff.js';
import { uploadImage } from './firebase.js';

const CMS = ['superAdmin', 'manager', 'eventManager'], MONEY = ['superAdmin', 'manager'];
const user = await requireStaff(CMS);
staffHeader(user, 'Control room');
const can = roles => roles.includes(user.role);
const TABS = [
  ['overview', 'Overview', CMS], ['nights', 'Nights', CMS], ['bookings', 'Bookings', CMS], ['requests', 'Private nights', CMS],
  ['bits', 'Pay in bits', MONEY], ['bar', 'Bar menu', CMS], ['settings', 'Site settings', MONEY], ['staff', 'Staff', ['superAdmin']],
].filter(t => can(t[2]));
const panel = $('#panel');
const flash = (el, text, bad = false) => { el.innerHTML = `<div class="msg ${bad ? 'err' : ''}" role="status">${esc(text)}</div>`; if (!bad) setTimeout(() => { el.innerHTML = ''; }, 4000); };
const pill = (text, c) => `<span class="pill ${c}">${esc(text)}</span>`;
const fail = e => { panel.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; };
const val = id => $(id).value.trim();

$('#tabs').innerHTML = TABS.map(([k, l]) => `<button role="tab" data-tab="${k}">${l}</button>`).join('') + '<a href="checkin.html">Door ↗</a>';
$$('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
let current = '';
function show(tab, arg) {
  current = tab + (arg ? `/${arg}` : '');
  if (location.hash.slice(1) !== current) location.hash = current;
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  panel.innerHTML = '<div class="loading">Loading…</div>';
  ({ overview, nights, night, bookings, requests, bits, bar, settings, staff })[tab](arg).catch(fail);
}

// ── Overview ──
async function overview() {
  const d = await sapi('/api/admin/overview');
  panel.innerHTML = `<h1>Tonight & next</h1>
    <div class="kpis"><div><span>Revenue (all confirmed)</span><b>${money(d.revenuePesewas)}</b></div><div><span>Owed on pay-in-bits</span><b>${money(d.owingPesewas)}</b></div>
      <div><span>Active pay-in-bits</span><b>${d.activePlans}</b></div><div><span>New private requests</span><b>${d.newRequests}</b></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Night</th><th>Date</th><th class="num">Tickets</th><th class="num">Comps</th><th class="num">Tables</th><th class="num">Revenue</th><th class="num">In the door</th><th></th></tr></thead><tbody>
    ${d.nights.map(n => `<tr><td><strong>${esc(n.name)}</strong> ${n.visibility === 'public' ? '' : pill('private', 'grey')}</td><td>${esc(shortDate(n.date))}</td><td class="num">${n.tickets}</td><td class="num">${n.comps}</td><td class="num">${n.tables}</td><td class="num">${money(n.revenuePesewas)}</td><td class="num">${n.checkins}</td>
      <td class="actions"><button class="sbtn" data-open="${esc(n.id)}">Open</button><a class="sbtn ghost" href="checkin.html?event=${encodeURIComponent(n.id)}">Door</a></td></tr>`).join('') || '<tr><td colspan="8" class="empty-row">No upcoming nights. Create one under Nights.</td></tr>'}
    </tbody></table></div>`;
  $$('[data-open]').forEach(b => b.onclick = () => show('nights', b.dataset.open));
}

// ── Nights ──
async function nights(id) {
  if (id) return night(id);
  const { events } = await sapi('/api/admin/events');
  const now = Date.now();
  panel.innerHTML = `<h1>Nights</h1><div class="toolbar"><button class="sbtn red" id="new">New night</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Night</th><th>Status</th><th></th></tr></thead><tbody>
    ${events.map(e => `<tr style="${new Date(e.date).getTime() < now - 12 * 3600e3 ? 'opacity:.55' : ''}"><td>${esc(shortDate(e.date))}</td><td><strong>${esc(e.name)}</strong></td>
      <td>${e.active === false ? pill('off', 'grey') : e.visibility === 'public' ? pill('live', 'green') : pill('private', 'amber')} ${e.soldOut ? pill('sold out', 'red') : ''} ${(e.ticketLines || []).length ? '' : pill('no lines', 'amber')} ${e.artwork ? '' : pill('no flyer', 'amber')}</td>
      <td class="actions"><button class="sbtn" data-edit="${esc(e.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty-row">No nights yet.</td></tr>'}</tbody></table></div>`;
  $('#new').onclick = () => night('new');
  $$('[data-edit]').forEach(b => b.onclick = () => show('nights', b.dataset.edit));
}

const localInput = iso => (iso ? new Date(iso).toISOString().slice(0, 16) : ''); // Ghana = UTC
async function night(id) {
  const isNew = id === 'new';
  const d = isNew ? { event: { visibility: 'private', active: true, doors: '10PM', venue: '', ticketLines: [] }, ticketTypes: [], tablePackages: [], raffle: null } : await sapi(`/api/admin/events/${encodeURIComponent(id)}`);
  const e = d.event; let lines = [...(e.ticketLines || [])];
  panel.innerHTML = `<div class="toolbar"><button class="sbtn ghost" id="back">← Nights</button>${isNew ? '' : `${e.visibility === 'public' && e.active !== false
  ? `<a class="sbtn ghost" target="_blank" href="event.html?id=${encodeURIComponent(e.id)}">Public page ↗</a>`
  : pill('private — not on the public site', 'amber')}<a class="sbtn ghost" href="checkin.html?event=${encodeURIComponent(e.id)}">Door ↗</a><a class="sbtn ghost" href="checkin.html?event=${encodeURIComponent(e.id)}">Door ↗</a>`}</div>
    <h1>${isNew ? 'New night' : esc(e.name)}</h1>
    <form class="card" id="evForm" novalidate>
      <div class="grid2">
        <div class="sfield"><label for="evName">Name</label><input id="evName" maxlength="80" value="${esc(e.name || '')}" required></div>
        <div class="sfield"><label for="evDate">Date & start time (Ghana time)</label><input id="evDate" type="datetime-local" value="${esc(localInput(e.date))}" required></div>
        <div class="sfield"><label for="evDoors">Doors</label><input id="evDoors" maxlength="40" value="${esc(e.doors || '')}" placeholder="10PM"></div>
        <div class="sfield"><label for="evVenue">Venue (blank = site venue)</label><input id="evVenue" maxlength="120" value="${esc(e.venue || '')}"></div>
      </div>
      <div class="sfield"><label for="evDesc">Two lines, max (optional)</label><textarea id="evDesc" maxlength="240" style="min-height:64px">${esc(e.description || '')}</textarea></div>
      <div class="grid2">
        <div class="img-drop"><div class="thumb" id="artThumb" style="background-image:url('${esc(e.artwork || '')}')"></div><div class="sfield"><label for="artFile">Flyer</label><input id="artFile" type="file" accept="image/jpeg,image/png,image/webp"><span class="hint">Portrait works best. Resized before upload.</span></div></div>
        <div class="img-drop"><div class="thumb wide" id="heroThumb" style="background-image:url('${esc(e.heroImage || '')}')"></div><div class="sfield"><label for="heroFile">Hero image (optional)</label><input id="heroFile" type="file" accept="image/jpeg,image/png,image/webp"></div></div>
      </div>
      <div class="toolbar" style="margin:0">
        <label class="check"><input type="checkbox" id="evPublic" ${e.visibility === 'public' ? 'checked' : ''}> On the public site</label>
        <label class="check"><input type="checkbox" id="evActive" ${e.active !== false ? 'checked' : ''}> Active</label>
        <label class="check"><input type="checkbox" id="evSold" ${e.soldOut ? 'checked' : ''}> Sold out</label>
        <label class="check"><input type="checkbox" id="evFeat" ${e.featured ? 'checked' : ''}> Lead on the homepage</label>
      </div>
      <div class="sfield"><label for="evOrg">Organiser (UID, optional)</label><input id="evOrg" value="${esc(e.organiserId || '')}" placeholder="Leave blank for club nights"><span class="hint">Their Firebase UID, shown when you grant them the Organiser role under Staff. They’ll see this night’s sales only.</span></div>
      <div>
        <h2 style="margin-top:6px">How are you showing up? <span class="kicker" id="lnCount"></span></h2>
        <p class="hint" style="margin:0 0 10px;color:var(--muted)">8 to 12 lines. Guests pick one; it’s the big type on their ticket. With no lines, the ticket leads with the night’s name.</p>
        <ol class="lines-ed" id="lines"></ol>
        <div class="toolbar" style="margin-top:8px"><input id="newLine" maxlength="48" placeholder="e.g. a line for this night" style="flex:1;min-width:200px"><button class="sbtn" type="button" id="addLine">Add line</button></div>
      </div>
      <div id="evMsg"></div>
      <div class="toolbar" style="margin:0"><button class="sbtn red" type="submit" id="save">${isNew ? 'Create night' : 'Save night'}</button>${!isNew && user.role === 'superAdmin' ? '<button class="sbtn ghost" type="button" id="del">Delete</button>' : ''}</div>
    </form>
    ${isNew ? '' : `<h2>Tickets</h2>${catalogTable('ticket-types', d.ticketTypes, e.id)}
    <h2>Tables</h2>${catalogTable('table-packages', d.tablePackages, e.id)}
    <h2>The draw</h2>${raffleCard(d.raffle, e.id)}
    <h2>Comps</h2>${compCard()}`}`;

  $('#back').onclick = () => show('nights');
  const art = { artwork: e.artwork || '', heroImage: e.heroImage || '' };
  const drawLines = () => {
    $('#lines').innerHTML = lines.map((l, i) => `<li><span class="kicker">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(l)}</span><span class="actions" style="display:flex;gap:4px">
      <button type="button" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button type="button" data-down="${i}" aria-label="Move down" ${i < lines.length - 1 ? '' : 'disabled'}>↓</button><button type="button" data-rm="${i}" aria-label="Remove">×</button></span></li>`).join('') || '<li><span></span><span class="muted">No lines yet.</span><span></span></li>';
    $('#lnCount').textContent = `${lines.length}/12`;
    $$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]]; drawLines(); });
    $$('[data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; [lines[i + 1], lines[i]] = [lines[i], lines[i + 1]]; drawLines(); });
    $$('[data-rm]').forEach(b => b.onclick = () => { lines.splice(+b.dataset.rm, 1); drawLines(); });
  };
  drawLines();
  const addLine = () => { const v = val('#newLine').toUpperCase(); if (!v) return; if (lines.length >= 12) return flash($('#evMsg'), 'Twelve lines is the max.', true); if (lines.includes(v)) return flash($('#evMsg'), 'That line is already there.', true); lines.push(v); $('#newLine').value = ''; drawLines(); };
  $('#addLine').onclick = addLine;
  $('#newLine').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); addLine(); } };
  for (const [input, key, thumb] of [['#artFile', 'artwork', '#artThumb'], ['#heroFile', 'heroImage', '#heroThumb']]) {
    $(input).onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      flash($('#evMsg'), 'Uploading…');
      try { art[key] = await uploadImage(await compressImage(f), f.name.replace(/\.\w+$/, '.webp')); $(thumb).style.backgroundImage = `url('${art[key]}')`; flash($('#evMsg'), 'Uploaded. Save the night to publish it.'); }
      catch (err) { flash($('#evMsg'), err.message || 'Upload failed.', true); }
    };
  }
  $('#evForm').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#save'); btn.disabled = true;
    try {
      const dt = val('#evDate');
      const r = await sapi('/api/admin/events', { method: 'POST', body: {
        id: isNew ? undefined : e.id, name: val('#evName'), date: dt ? `${dt}:00Z` : '', doors: val('#evDoors'), venue: val('#evVenue'), description: val('#evDesc'),
        artwork: art.artwork, heroImage: art.heroImage, ticketLines: lines, visibility: $('#evPublic').checked ? 'public' : 'private',
        active: $('#evActive').checked, soldOut: $('#evSold').checked, featured: $('#evFeat').checked, organiserId: val('#evOrg'),
      } });
      if (isNew) return show('nights', r.eventId);
      flash($('#evMsg'), 'Saved. The public site shows it now.');
    } catch (err) { flash($('#evMsg'), err.message, true); }
    btn.disabled = false;
  };
  $('#del') && ($('#del').onclick = async () => {
    if (!confirm(`Delete ${e.name}? Only possible if nothing has been sold.`)) return;
    try { await sapi(`/api/admin/events/${encodeURIComponent(e.id)}`, { method: 'DELETE' }); show('nights'); } catch (err) { flash($('#evMsg'), err.message, true); }
  });
  if (!isNew) { bindCatalog(() => night(id)); bindRaffle(d.raffle, e.id, () => night(id)); bindComp(e.id); }
}

// Editable rows for ticket types / table packages / bottles.
const CAT = {
  'ticket-types': { cols: [['name', 'Name'], ['price', 'Price (GHS)'], ['admits', 'Admits'], ['remaining', 'Left (blank = no limit)'], ['description', 'Note']] },
  'table-packages': { cols: [['name', 'Name'], ['price', 'Price (GHS)'], ['capacity', 'People'], ['remaining', 'Left (blank = no limit)'], ['description', 'What’s included']] },
  bottles: { cols: [['category', 'Category'], ['name', 'Name'], ['price', 'Price (GHS)'], ['remaining', 'Left (blank = no limit)']] },
};
function catalogTable(kind, rows, eventId) {
  const cell = (r, k) => { const v = k === 'price' ? ghs(r.pricePesewas) : r[k] ?? ''; return `<td><input data-k="${k}" value="${esc(v)}" ${['price', 'admits', 'capacity', 'remaining'].includes(k) ? 'inputmode="decimal"' : ''} aria-label="${k}"></td>`; };
  const row = r => `<tr data-row="${esc(r.id || '')}" data-kind="${kind}" data-event="${esc(eventId)}">${CAT[kind].cols.map(([k]) => cell(r, k)).join('')}
    <td><label class="check"><input type="checkbox" data-k="active" ${r.active !== false ? 'checked' : ''}> On</label></td>
    <td class="actions"><button class="sbtn" data-save>Save</button>${r.id ? '<button class="sbtn ghost" data-del>×</button>' : ''}</td></tr>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${CAT[kind].cols.map(([, l]) => `<th>${l}</th>`).join('')}<th></th><th></th></tr></thead>
    <tbody>${rows.map(row).join('')}${row({ active: true })}</tbody></table></div><div data-msg="${kind}"></div>`;
}
function bindCatalog(reload) {
  $$('tr[data-kind] [data-save]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), kind = tr.dataset.kind, get = k => $(`[data-k="${k}"]`, tr);
    const body = { id: tr.dataset.row || undefined, eventId: tr.dataset.event, active: get('active').checked };
    for (const [k] of CAT[kind].cols) { const v = get(k).value.trim(); if (k === 'price') body.pricePesewas = pes(v); else if (['admits', 'capacity'].includes(k)) body[k] = v === '' ? undefined : Number(v); else if (k === 'remaining') body.remaining = v === '' ? null : Number(v); else body[k] = v; }
    if (!tr.dataset.row && !body.name) return;
    try { await sapi(`/api/admin/${kind}`, { method: 'POST', body }); reload(); } catch (err) { flash($(`[data-msg="${kind}"]`), err.message, true); }
  });
  $$('tr[data-kind] [data-del]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'); if (!confirm('Remove this item?')) return;
    try { await sapi(`/api/admin/${tr.dataset.kind}/${encodeURIComponent(tr.dataset.row)}`, { method: 'DELETE' }); reload(); } catch (err) { flash($(`[data-msg="${tr.dataset.kind}"]`), err.message, true); }
  });
}

function raffleCard(r, eventId) {
  const drawn = r?.status === 'drawn';
  return `<div class="card">
    ${r ? `<div class="toolbar" style="margin:0">${pill(r.status, r.status === 'open' ? 'green' : r.status === 'drawn' ? 'amber' : 'grey')}<span>${r.spotsTaken || 0} of ${r.cap} spots taken · ${r.entryCount} entries</span>${drawn ? `<strong>Won by ${esc(r.winnerDisplayName)} (${esc(r.winnerDisplayCode)})</strong>` : ''}</div>` : '<p class="muted" style="margin:0">No draw for this night yet.</p>'}
    <div class="grid2"><div class="sfield"><label for="rPrize">Prize</label><input id="rPrize" maxlength="140" value="${esc(r?.prize || '')}" ${drawn ? 'disabled' : ''}></div>
      <div class="sfield"><label for="rCap">Spots (first N fully-paid online tickets)</label><input id="rCap" type="number" min="1" max="500" value="${esc(r?.cap || 20)}" ${drawn ? 'disabled' : ''}></div></div>
    ${drawn ? '' : `<div class="toolbar" style="margin:0"><label class="check"><input type="checkbox" id="rOn" ${r?.enabled !== false ? 'checked' : ''}> Draw is running</label>${r && r.status !== 'drawn' ? `<label class="check"><input type="checkbox" id="rClosed" ${r.status === 'closed' ? 'checked' : ''}> Closed to new entries</label>` : ''}</div>
    <p class="hint" style="margin:0;color:var(--muted)">Before a prize of real value goes live, confirm with the club that it’s framed as a promotion attached to the ticket (Ghana lottery law, see BUILD_PLAN).</p>
    <div class="toolbar" style="margin:0"><button class="sbtn" id="rSave">${r ? 'Save draw' : 'Start a draw'}</button>${r && r.entryCount ? '<button class="sbtn red" id="rDraw">Draw the winner</button>' : ''}</div>`}
    <div id="rMsg"></div></div>`;
}
function bindRaffle(r, eventId, reload) {
  $('#rSave') && ($('#rSave').onclick = async () => {
    try { await sapi('/api/admin/raffles', { method: 'POST', body: { eventId, prize: val('#rPrize'), cap: Number(val('#rCap')), enabled: $('#rOn').checked, status: $('#rClosed')?.checked ? 'closed' : 'open' } }); reload(); }
    catch (err) { flash($('#rMsg'), err.message, true); }
  });
  $('#rDraw') && ($('#rDraw').onclick = async () => {
    if (!confirm(`Draw the winner from ${r.entryCount} entries? This can’t be undone.`)) return;
    try { await sapi('/api/admin/raffle/draw', { method: 'POST', body: { raffleId: r.id } }); reload(); }
    catch (err) { flash($('#rMsg'), err.message, true); }
  });
}

function compCard() {
  return `<form class="card" id="compForm" novalidate><div class="grid2">
    <div class="sfield"><label for="cName">Name</label><input id="cName" maxlength="80"></div>
    <div class="sfield"><label for="cPhone">Phone (optional, gets the ticket link)</label><input id="cPhone" type="tel"></div>
    <div class="sfield"><label for="cAdmits">Admits</label><input id="cAdmits" type="number" min="1" max="10" value="1"></div>
    <div class="sfield"><label for="cNote">Why (for the record)</label><input id="cNote" maxlength="200"></div></div>
    <label class="check"><input type="checkbox" id="cDraw"> Put this comp in the draw (only if there’s a spot)</label>
    <div><button class="sbtn red" type="submit">Issue comp</button></div><div id="cMsg"></div></form>`;
}
function bindComp(eventId) {
  $('#compForm').onsubmit = async ev => {
    ev.preventDefault();
    try {
      const r = await sapi('/api/admin/comps', { method: 'POST', body: { eventId, name: val('#cName'), phone: val('#cPhone'), admits: Number(val('#cAdmits')), note: val('#cNote'), inDraw: $('#cDraw').checked } });
      $('#cMsg').innerHTML = `<div class="msg">Comp issued${r.texted ? ' and texted' : ''}${r.inDraw ? ', in the draw' : r.drawRequestedButFull ? '. The draw was full, so it’s not in it' : ''}. Ticket: <a href="${esc(r.link)}" target="_blank">${esc(r.link)}</a></div>`;
      $('#compForm').reset();
    } catch (err) { flash($('#cMsg'), err.message, true); }
  };
}

// ── Bookings (tickets, tables, comps) ──
async function bookings() {
  const [{ events }] = await Promise.all([sapi('/api/admin/events')]);
  panel.innerHTML = `<h1>Bookings</h1><div class="toolbar"><select id="fEv"><option value="">All nights</option>${events.map(e => `<option value="${esc(e.id)}">${esc(shortDate(e.date))} · ${esc(e.name)}</option>`).join('')}</select>
    <select id="fKind"><option value="">Everything</option><option value="table">Tables</option><option value="ticket">Tickets</option><option value="comp">Comps</option></select></div><div id="list"></div>`;
  const load = async () => {
    const q = new URLSearchParams(); if (val('#fEv')) q.set('eventId', val('#fEv')); if (val('#fKind')) q.set('kind', val('#fKind'));
    $('#list').innerHTML = '<div class="loading">Loading…</div>';
    const { orders } = await sapi(`/api/admin/orders?${q}`);
    $('#list').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Night</th><th>Who</th><th>Phone</th><th>What</th><th class="num">Paid</th><th></th></tr></thead><tbody>
      ${orders.map(o => `<tr><td>${esc(when(o.createdAt))}</td><td>${esc(o.eventName)}</td><td>${esc(o.buyerName)}</td><td>${o.buyerPhone ? `<a href="tel:${esc(o.buyerPhone)}">${esc(o.buyerPhone)}</a>` : ''}</td>
        <td>${o.kind === 'table' ? `<strong>${esc(o.packageName)}</strong>${(o.bottles || []).map(b => `<br><small>${b.quantity} × ${esc(b.name)}</small>`).join('')}` : o.kind === 'comp' ? `Comp · admits ${o.admits}${o.note ? `<br><small>${esc(o.note)}</small>` : ''}` : `${o.quantity} × ${esc(o.ticketTypeName)}${o.paidInInstallments ? ' <small>(in bits)</small>' : ''}`}</td>
        <td class="num">${money(o.amountPesewas)}</td><td>${o.kind === 'table' ? pill('table', 'amber') : o.kind === 'comp' ? pill('comp', 'grey') : pill('ticket', 'green')} ${o.inDraw ? pill('draw', 'amber') : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-row">Nothing yet.</td></tr>'}</tbody></table></div>`;
  };
  $('#fEv').onchange = $('#fKind').onchange = () => load().catch(fail);
  await load();
}

// ── Private night requests ──
async function requests() {
  const { requests: rs } = await sapi('/api/admin/requests');
  panel.innerHTML = `<h1>Private nights</h1><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>What</th><th>Who</th><th class="num">Guests</th><th>Status</th><th></th></tr></thead><tbody>
    ${rs.map(r => `<tr><td><strong>${esc(r.date)}</strong></td><td>${esc(r.eventType)}</td><td>${esc(r.name)}</td><td class="num">${esc(r.guests)}</td>
      <td>${pill(r.status, r.status === 'ACCEPTED' ? 'green' : r.status === 'DECLINED' ? 'grey' : 'amber')}</td><td class="actions"><button class="sbtn" data-open="${esc(r.id)}">Open</button></td></tr>
      <tr class="expand" id="x-${esc(r.id)}" hidden><td colspan="6"><div class="grid2">
        <div style="display:grid;gap:6px"><div><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>${r.instagram ? ` · <a href="https://instagram.com/${esc(r.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(r.instagram)}</a>` : ''}${r.email ? ` · ${esc(r.email)}` : ''}</div>
          <div>${esc(r.message || '—')}</div><small class="muted">Received ${esc(when(r.createdAt))}</small></div>
        <div class="sfield"><label for="n-${esc(r.id)}">Staff note (never shown to the guest)</label><textarea id="n-${esc(r.id)}">${esc(r.note || '')}</textarea></div></div>
        <div class="toolbar" style="margin:12px 0 0"><button class="sbtn ok" data-set="ACCEPTED" data-id="${esc(r.id)}">Accept &amp; hold the date</button><button class="sbtn" data-set="DECLINED" data-id="${esc(r.id)}">Decline</button><button class="sbtn ghost" data-set="" data-id="${esc(r.id)}">Save note</button></div><div id="m-${esc(r.id)}"></div></td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">No requests yet.</td></tr>'}</tbody></table></div>`;
  $$('[data-open]').forEach(b => b.onclick = () => { const x = $(`#x-${b.dataset.open}`); x.hidden = !x.hidden; });
  $$('[data-set]').forEach(b => b.onclick = async () => {
    const id = b.dataset.id, body = { note: $(`#n-${id}`).value };
    if (b.dataset.set) { if (!confirm(b.dataset.set === 'ACCEPTED' ? 'Accept and text the guest?' : 'Decline and text the guest?')) return; body.status = b.dataset.set; }
    try { await sapi(`/api/admin/requests/${encodeURIComponent(id)}`, { method: 'POST', body }); if (b.dataset.set) requests().catch(fail); else flash($(`#m-${id}`), 'Note saved.'); }
    catch (err) { flash($(`#m-${id}`), err.message, true); }
  });
}

// ── Pay in bits ──
async function bits() {
  const { plans } = await sapi('/api/admin/installments');
  panel.innerHTML = `<h1>Pay in bits</h1><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Order</th><th>Who</th><th>Night</th><th class="num">Paid</th><th class="num">Owing</th><th>Status</th><th></th></tr></thead><tbody>
    ${plans.map(p => `<tr><td><strong>${esc(p.id)}</strong><br><small class="muted">${esc(when(p.createdAt))}</small></td><td>${esc(p.buyerName)}<br><a href="tel:${esc(p.buyerPhone)}">${esc(p.buyerPhone)}</a></td><td>${esc(p.eventName)}<br><small>${p.quantity} × ${esc(p.ticketTypeName)}</small></td>
      <td class="num">${money(p.paidPesewas)} / ${money(p.totalPesewas)}</td><td class="num">${money(Math.max(0, p.totalPesewas - p.paidPesewas))}</td>
      <td>${pill(p.status, p.status === 'completed' ? 'green' : p.status === 'active' ? 'amber' : 'grey')}${p.overpaidPesewas ? ` ${pill(`overpaid ${money(p.overpaidPesewas)}`, 'red')}` : ''}</td>
      <td class="actions"><button class="sbtn" data-hist="${esc(p.id)}">Payments</button>${['active', 'completed'].includes(p.status) ? `<button class="sbtn" data-sms="${esc(p.id)}">Resend text</button>` : ''}</td></tr>
      <tr class="expand" id="h-${esc(p.id)}" hidden><td colspan="7">${(p.payments || []).map(x => `<div>${esc(when(x.paidAt))} · ${money(x.amountPesewas)} · <small>${esc(x.reference)}</small>${x.note ? ` · ${pill(x.note.replace(/_/g, ' '), 'red')}` : ''}</div>`).join('') || 'No payments yet.'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-row">No pay-in-bits orders yet.</td></tr>'}</tbody></table></div><div id="bMsg"></div>`;
  $$('[data-hist]').forEach(b => b.onclick = () => { const x = $(`#h-${b.dataset.hist}`); x.hidden = !x.hidden; });
  $$('[data-sms]').forEach(b => b.onclick = async () => { b.disabled = true; try { await sapi('/api/admin/installments/resend-sms', { method: 'POST', body: { planId: b.dataset.sms } }); flash($('#bMsg'), `Text sent for ${b.dataset.sms}.`); } catch (err) { flash($('#bMsg'), err.message, true); } b.disabled = false; });
}

// ── Bar menu (bottles available on every night) ──
async function bar() {
  const { bottles } = await sapi('/api/admin/bottles');
  panel.innerHTML = `<h1>Bar menu</h1><p class="muted" style="margin-top:-8px">Bottles guests can add to a table, on every night. Use the club’s real names and prices.</p>${catalogTable('bottles', bottles, 'all')}`;
  bindCatalog(() => bar().catch(fail));
}

// ── Site settings ──
async function settings() {
  const { settings: s } = await sapi('/api/admin/settings');
  const f = (k, label, hint = '', type = 'text') => `<div class="sfield"><label for="s-${k}">${label}</label><input id="s-${k}" type="${type}" value="${esc(s[k] || '')}">${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  panel.innerHTML = `<h1>Site settings</h1><form class="card" id="sForm" novalidate>
    <p class="muted" style="margin:0">One place for the details the whole site shows. Blank fields simply don’t appear.</p>
    <div class="grid2">${f('venue', 'Venue')}${f('address', 'Address line')}${f('nightsLine', 'Nights line', 'e.g. Friday + Saturday')}${f('doorsLine', 'Doors line', 'e.g. Doors 10PM')}
      ${f('phone', 'Public phone', 'Confirm the real number before filling this in.', 'tel')}${f('whatsapp', 'WhatsApp number', '', 'tel')}${f('email', 'Public email', '', 'email')}${f('instagram', 'Instagram handle', '@handle')}
      ${f('mapUrl', 'Map link', 'Google Maps share link. Blank = search for the venue.', 'url')}</div>
    <div class="img-drop"><div class="thumb wide" id="heroT" style="background-image:url('${esc(s.heroImage || '')}')"></div><div class="sfield"><label for="heroF">Homepage hero image (optional)</label><input id="heroF" type="file" accept="image/jpeg,image/png,image/webp"></div></div>
    <div class="grid2"><div class="sfield"><label for="s-lines">Default lines (one per line)</label><textarea id="s-lines" style="min-height:160px">${esc((s.defaultLines || []).join('\n'))}</textarea><span class="hint">Used for any night without its own lines.</span></div>
      <div class="sfield"><label for="s-closed">Closed dates (YYYY-MM-DD, one per line)</label><textarea id="s-closed" style="min-height:160px">${esc((s.closedDates || []).join('\n'))}</textarea><span class="hint">Shown as closed on the calendar; can’t be requested.</span></div></div>
    <div><button class="sbtn red" type="submit">Save settings</button></div><div id="sMsg"></div></form>`;
  let hero = s.heroImage || '';
  $('#heroF').onchange = async ev => { const file = ev.target.files[0]; if (!file) return; try { hero = await uploadImage(await compressImage(file, 2000), 'hero.webp'); $('#heroT').style.backgroundImage = `url('${hero}')`; } catch (err) { flash($('#sMsg'), err.message, true); } };
  $('#sForm').onsubmit = async ev => {
    ev.preventDefault();
    const body = Object.fromEntries(['venue', 'address', 'nightsLine', 'doorsLine', 'phone', 'whatsapp', 'email', 'instagram', 'mapUrl'].map(k => [k, val(`#s-${k}`)]));
    body.heroImage = hero; body.defaultLines = $('#s-lines').value.split('\n').map(x => x.trim().toUpperCase()).filter(Boolean); body.closedDates = $('#s-closed').value.split(/\s+/).filter(Boolean);
    try { await sapi('/api/admin/settings', { method: 'POST', body }); flash($('#sMsg'), 'Saved. Live on the site now.'); } catch (err) { flash($('#sMsg'), err.message, true); }
  };
}

// ── Staff ──
async function staff() {
  const { staff: list } = await sapi('/api/admin/staff');
  panel.innerHTML = `<h1>Staff</h1><form class="card" id="roleForm" novalidate>
    <p class="muted" style="margin:0">Create the account in Firebase Console → Authentication first (public sign-up is off), then give it a role here. It takes effect at their next sign-in.</p>
    <div class="grid2"><div class="sfield"><label for="rEmail">Email</label><input id="rEmail" type="email"></div>
      <div class="sfield"><label for="rRole">Role</label><select id="rRole">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="none">Remove access</option></select></div></div>
    <div><button class="sbtn red" type="submit">Save role</button></div><div id="roleMsg"></div></form>
    <h2>Who has access</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Email</th><th>Role</th><th>UID (for organiser nights)</th></tr></thead><tbody>
    ${list.map(x => `<tr><td>${esc(x.email)}</td><td>${esc(ROLE_LABEL[x.role] || x.role)}</td><td><code>${esc(x.uid)}</code></td></tr>`).join('') || '<tr><td colspan="3" class="empty-row">No staff recorded yet.</td></tr>'}</tbody></table></div>
    <p class="hint" style="color:var(--muted)">Super admin: everything. Manager: everything but staff. Event manager: nights, bookings, private nights, comps, the draw. Door: check-in only. Organiser: their own nights’ numbers and door.</p>`;
  $('#roleForm').onsubmit = async ev => {
    ev.preventDefault();
    try { const r = await sapi('/api/admin/set-role', { method: 'POST', body: { email: val('#rEmail'), role: val('#rRole') } }); flash($('#roleMsg'), `${r.email} → ${ROLE_LABEL[r.role] || 'no access'}.`); setTimeout(() => staff().catch(fail), 900); }
    catch (err) { flash($('#roleMsg'), err.message, true); }
  };
}

function fromHash() {
  const [tab, arg] = location.hash.slice(1).split('/');
  if (location.hash.slice(1) === current && current) return;
  show(TABS.some(t => t[0] === tab) ? tab : 'overview', arg);
}
window.addEventListener('hashchange', fromHash);
fromHash();
