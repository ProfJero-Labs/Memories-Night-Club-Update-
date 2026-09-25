// ═══════════════════════════════════════════════════════════════════
// MEMORIES ADMIN — Standalone (only depends on firebase.js + CDN)
// ═══════════════════════════════════════════════════════════════════

import { auth, signOut, onAuthStateChanged } from './firebase.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore,
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// ── Init Firestore (reuses the app firebase.js already initialized) ──
const app = getApps().length ? getApps()[0] : initializeApp(window.MEMORIES_CONFIG.firebase);
const db = getFirestore(app);

// ── Inline helpers (zero external deps) ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const money = n => `GHS ${(Number(n || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
const eventDate = e => {
  if (!e?.date) return '';
  const d = new Date(e.date);
  return d.toLocaleDateString('en-GH', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
};
const toLocalISO = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ═══════════════════════════════════════════════════════════════════
// CLOUDINARY UPLOAD — direct unsigned upload, no widget needed
// ═══════════════════════════════════════════════════════════════════
async function uploadToCloudinary(file) {
  const cfg = window.MEMORIES_CONFIG?.cloudinary;
  if (!cfg?.cloudName || !cfg?.uploadPreset) {
    throw new Error('Cloudinary not configured. Add cloudName and uploadPreset to config.js.');
  }

  // Validate
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG, WEBP).');
  }
  const maxBytes = 8 * 1024 * 1024; // 8 MB
  if (file.size > maxBytes) {
    throw new Error(`Image is too large (${(file.size/1024/1024).toFixed(1)} MB). Max 8 MB.`);
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', cfg.uploadPreset);
  if (cfg.folder) formData.append('folder', cfg.folder);

  const r = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || `Upload failed (${r.status})`);
  }

  const data = await r.json();
  if (!data.secure_url) throw new Error('Upload returned no URL.');
  return data.secure_url;
}

window.getFirebaseIdToken = async () => auth.currentUser?.getIdToken() || null;
window.getCurrentUser = () => auth.currentUser;

// ── Worker admin API — everything that mutates server-side state (raffle draws, role grants)
// goes through here, never through a direct Firestore write from the browser. ──
async function adminApi(path, options = {}) {
  const token = await auth.currentUser?.getIdToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${window.MEMORIES_CONFIG.apiBase}${path}`, { ...options, headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) throw new Error(d.error || 'Request failed.');
  return d;
}

console.log('🔵 ADMIN.JS v4 — Standalone');

// ═══════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════
const root = document.querySelector('#adminApp');
const nav = `<aside class="admin-nav"><a class="brand" href="index.html">MEMORIES</a><div class="eyebrow">CONTROL ROOM</div><button data-tab="overview">Overview</button><button data-tab="events">Events</button><button data-tab="tickets">Tickets</button><button data-tab="tables">Tables</button><button data-tab="raffle">Raffle</button><button data-tab="requests">Private nights</button><button data-tab="installments">Installments</button><button data-tab="settings">Settings</button><button data-tab="staff">Staff</button><a href="verify.html">Door check</a><button id="logout" class="btn ghost">Sign out</button></aside>`;
root.innerHTML = `<div class="admin-shell">${nav}<main class="admin-main"><div id="panel"></div></main></div>`;
const panel = document.querySelector('#panel');

function layout(title, sub = '') {
  return `<div class="eyebrow">MEMORIES · CONTROL ROOM</div><h1 class="display admin-title">${esc(title)}</h1>${sub ? `<p class="admin-sub">${esc(sub)}</p>` : ''}<div id="tabBody"></div>`;
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════
async function overviewTab() {
  panel.innerHTML = layout('TONIGHT', 'The operational view of what is happening.');
  const body = document.querySelector('#tabBody');
  try {
    // tickets/orders/checkins/private_event_requests are staff-only collections that only a
    // superAdmin custom claim can read directly per firestore.rules — everyone else (manager,
    // eventManager, doorStaff) only gets there through the Worker, which checks the role claim
    // itself, so this whole tab goes through /api/admin/overview instead of the client SDK.
    const d = await adminApi('/api/admin/overview');
    const events = (d.events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    body.innerHTML = `
      <div class="admin-cards">
        <div class="metric"><span>Tickets</span><strong>${d.tickets || 0}</strong></div>
        <div class="metric"><span>Check-ins</span><strong>${d.checkins || 0}</strong></div>
        <div class="metric"><span>Orders</span><strong>${d.orders || 0}</strong></div>
        <div class="metric"><span>Private requests</span><strong>${d.privateRequests || 0}</strong></div>
      </div>
      <section class="admin-section">
        <div class="section-head"><h2 class="display">UPCOMING NIGHTS</h2><button class="btn red" data-tab="events">MANAGE EVENTS</button></div>
        ${events.length ? events.map(e => `<div class="admin-row"><div><strong>${esc(e.name)}</strong><small>${esc(eventDate(e))} · ${esc(e.venue || 'Cape Coast')}</small></div><span class="status ${e.active ? 'success' : ''}">${e.active ? 'LIVE' : 'OFF'}</span></div>`).join('') : '<div class="empty">No public events.</div>'}
      </section>`;
    bindTabs();
  } catch (e) {
    console.error('Overview error:', e);
    body.innerHTML = `<div class="status error">${esc(e.message)}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════
let currentEvents = [];

async function eventsTab() {
  panel.innerHTML = layout('NIGHTS', 'Create and control the nights guests see.');
  const body = document.querySelector('#tabBody');
  try {
    const snap = await getDocs(collection(db, 'events'));
    currentEvents = [];
    snap.forEach(d => currentEvents.push({ id: d.id, ...d.data() }));
    currentEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    body.innerHTML = `
      <div class="admin-toolbar"><button class="btn red" id="newEvent">NEW NIGHT</button></div>
      <div class="admin-list">
        ${currentEvents.length ? currentEvents.map(e => `
          <article class="admin-row">
            <div><strong>${esc(e.name)}</strong><small>${esc(eventDate(e))} · ${esc(e.venue || 'Cape Coast')} · ${esc(e.visibility || 'private')}</small></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn small" data-catalog="${esc(e.id)}">TICKETS / TABLES</button>
              <button class="btn small" data-edit-event="${esc(e.id)}">EDIT</button>
              <button class="btn small" data-delete-event="${esc(e.id)}">DELETE</button>
            </div>
          </article>
        `).join('') : '<div class="empty">No events yet.</div>'}
      </div>
      <div id="modal"></div>`;

    document.querySelector('#newEvent').onclick = () => eventForm();
    document.querySelectorAll('[data-edit-event]').forEach(b => b.onclick = () => eventForm(currentEvents.find(e => e.id === b.dataset.editEvent)));
    document.querySelectorAll('[data-catalog]').forEach(b => b.onclick = () => catalogForm(currentEvents.find(e => e.id === b.dataset.catalog)));
    document.querySelectorAll('[data-delete-event]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this event and its catalog items?')) return;
      try {
        const id = b.dataset.deleteEvent;
        const [tt, tp, bt] = await Promise.all([
          getDocs(query(collection(db, 'ticket_types'), where('eventId', '==', id))),
          getDocs(query(collection(db, 'table_packages'), where('eventId', '==', id))),
          getDocs(query(collection(db, 'bottles'), where('eventId', '==', id))),
        ]);
        await Promise.all([
          ...tt.docs.map(d => deleteDoc(d.ref)),
          ...tp.docs.map(d => deleteDoc(d.ref)),
          ...bt.docs.map(d => deleteDoc(d.ref)),
        ]);
        await deleteDoc(doc(db, 'events', id));
        eventsTab();
      } catch (err) { alert(err.message); }
    });
  } catch (e) {
    console.error('Events error:', e);
    body.innerHTML = `<div class="status error">${esc(e.message)}</div>`;
  }
}

function eventForm(e = {}) {
  const m = document.querySelector('#modal');
  let currentArtwork = e.artwork || ''; // track uploaded URL across the form's lifetime

  m.innerHTML = `
    <div class="modal"><div class="modal-card">
      <div class="section-head"><h2 class="display">${e.id ? 'EDIT NIGHT' : 'NEW NIGHT'}</h2><button class="btn ghost" id="close">CLOSE</button></div>
      <div class="form-grid">
        <div class="field full"><label>Name</label><input id="en" value="${esc(e.name || '')}"></div>
        <div class="field"><label>Date / time</label><input id="ed" type="datetime-local" value="${e.date ? toLocalISO(new Date(e.date)) : ''}"></div>
        <div class="field"><label>Doors</label><input id="edo" value="${esc(e.doors || '10PM')}"></div>
        <div class="field"><label>Venue</label><input id="ev" value="${esc(e.venue || 'Samrit Hotel · Cape Coast')}"></div>

        <div class="field full">
          <label>Event Artwork</label>
          <input type="file" id="eaFile" accept="image/*" style="display:none">
          <div id="eaDrop" class="artwork-drop">
            ${currentArtwork
              ? `<img src="${esc(currentArtwork)}" alt="Artwork" class="artwork-preview" id="eaPreview">
                 <div class="artwork-hint">Click to change image</div>`
              : `<div class="artwork-empty">
                   <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                   <strong>Click to upload image</strong>
                   <span>JPG, PNG or WEBP · max 8 MB</span>
                 </div>`}
          </div>
          ${currentArtwork ? `<button type="button" class="btn ghost small" id="eaRemove" style="margin-top:8px">REMOVE IMAGE</button>` : ''}
          <div id="eaStatus" style="margin-top:8px;font-size:12px;color:var(--muted);min-height:16px"></div>
        </div>

        <div class="field"><label>Visibility</label><select id="evis"><option value="public">public</option><option value="private">private</option></select></div>
        <div class="field"><label>Featured</label><select id="efea"><option value="false">no</option><option value="true">yes</option></select></div>
        <div class="field"><label>Organiser UID</label><input id="eorg" value="${esc(e.organiserId || '')}" placeholder="Firebase UID"></div>
        <div class="field"><label>Organiser Email</label><input id="eorgEmail" value="${esc(e.organiserEmail || '')}" placeholder="organiser@example.com"></div>
        <div class="field full"><label>Identity lines</label><textarea id="elines">${esc((e.ticketLines || ['FULLY ACTIVE.', 'CAPE COAST, LOCKED IN.', 'I CAME DRESSED.', 'OUTSIDE, CORRECT.', 'FULL REPPING.', 'I’M NOT MISSING THIS.']).join('\n'))}</textarea></div>
      </div>
      <button class="btn red" id="saveEvent">SAVE NIGHT</button>
      <div id="formMsg"></div>
    </div></div>`;

  if (e.visibility) document.querySelector('#evis').value = e.visibility;
  document.querySelector('#efea').value = e.featured === true ? 'true' : 'false';
  document.querySelector('#close').onclick = () => m.innerHTML = '';

  // ── Artwork upload wiring ──
  const drop = document.querySelector('#eaDrop');
  const fileInput = document.querySelector('#eaFile');
  const status = document.querySelector('#eaStatus');

  function refreshPreview() {
    if (currentArtwork) {
      drop.innerHTML = `<img src="${esc(currentArtwork)}" alt="Artwork" class="artwork-preview" id="eaPreview">
                        <div class="artwork-hint">Click to change image</div>`;
    } else {
      drop.innerHTML = `<div class="artwork-empty">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                          <strong>Click to upload image</strong>
                          <span>JPG, PNG or WEBP · max 8 MB</span>
                        </div>`;
    }
    // Show/hide remove button
    const existingRemove = document.querySelector('#eaRemove');
    if (currentArtwork && !existingRemove) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'eaRemove';
      btn.className = 'btn ghost small';
      btn.style.marginTop = '8px';
      btn.textContent = 'REMOVE IMAGE';
      btn.onclick = () => { currentArtwork = ''; refreshPreview(); };
      drop.parentElement.appendChild(btn);
    }
    if (!currentArtwork && existingRemove) existingRemove.remove();
  }

  drop.onclick = () => { if (!fileInput.disabled) fileInput.click(); };

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    status.textContent = `Uploading "${file.name}" (${(file.size/1024).toFixed(0)} KB)…`;
    drop.style.pointerEvents = 'none';
    drop.style.opacity = '0.6';

    try {
      const url = await uploadToCloudinary(file);
      currentArtwork = url;
      refreshPreview();
      status.textContent = `✓ Uploaded successfully`;
      setTimeout(() => { status.textContent = ''; }, 3000);
    } catch (err) {
      console.error('Upload failed:', err);
      status.innerHTML = `<span style="color:#ed4356">✗ ${esc(err.message)}</span>`;
    } finally {
      drop.style.pointerEvents = '';
      drop.style.opacity = '';
      fileInput.value = ''; // reset so same file can be re-picked
    }
  };

  // ── Save ──
  document.querySelector('#saveEvent').onclick = async () => {
    const b = document.querySelector('#saveEvent');
    const err = document.querySelector('#formMsg');
    err.innerHTML = '';
    b.disabled = true;

    try {
      const name = document.querySelector('#en').value.trim();
      const dateVal = document.querySelector('#ed').value;
      if (!name) throw new Error('Name is required.');
      if (!dateVal) throw new Error('Date/time is required.');

      const data = {
        name,
        date: new Date(dateVal).toISOString(),
        doors: document.querySelector('#edo').value.trim() || '10PM',
        venue: document.querySelector('#ev').value.trim() || 'Cape Coast',
        artwork: currentArtwork,
        visibility: document.querySelector('#evis').value,
        featured: document.querySelector('#efea').value === 'true',
        organiserId: document.querySelector('#eorg').value.trim() || null,
        ticketLines: document.querySelector('#elines').value.split('\n').map(x => x.trim()).filter(Boolean),
        active: true,
        updatedAt: serverTimestamp(),
      };

      if (e.id) {
        await updateDoc(doc(db, 'events', e.id), data);
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(db, 'events'), data);
      }
      m.innerHTML = '';
      eventsTab();
    } catch (ex) {
      console.error('Save error:', ex);
      err.innerHTML = `<div class="status error">${esc(ex.message)}</div>`;
      b.disabled = false;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// CATALOG
// ═══════════════════════════════════════════════════════════════════
async function catalogForm(e) {
  if (!e) return;
  const m = document.querySelector('#modal');
  m.innerHTML = `
    <div class="modal"><div class="modal-card">
      <div class="section-head"><div><h2 class="display">${esc(e.name)}</h2><p class="eyebrow">${esc(eventDate(e))}</p></div><button class="btn ghost" id="close">CLOSE</button></div>
      <div style="display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap">
        <button class="btn red small" data-cat="tickets">TICKETS</button>
        <button class="btn small" data-cat="tables">TABLES</button>
        <button class="btn small" data-cat="bottles">BOTTLES</button>
      </div>
      <div id="catBody"></div>
    </div></div>`;
  document.querySelector('#close').onclick = () => m.innerHTML = '';
  const catBody = document.querySelector('#catBody');

  async function loadList(col) {
    const snap = await getDocs(query(collection(db, col), where('eventId', '==', e.id)));
    const items = []; snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    return items;
  }

  async function renderTickets() {
    catBody.innerHTML = '<div class="status">Loading…</div>';
    const list = await loadList('ticket_types');
    catBody.innerHTML = `
      <h3 class="display" style="font-size:28px;margin:0 0 14px">TICKET TYPES</h3>
      ${list.length ? list.map(t => `<div class="bottle-row"><div><strong>${esc(t.name)}</strong><small>${money(t.pricePesewas)} · Admits ${t.admits || 1} · ${t.remaining ?? '∞'} remaining</small></div><button class="btn small" data-del="ticket_types" data-id="${esc(t.id)}">DELETE</button></div>`).join('') : '<div class="empty" style="padding:24px">No ticket types yet.</div>'}
      <div class="form-grid" style="margin-top:26px">
        <div class="field full"><label>Name</label><select id="ttName"><option>Standard</option><option>VIP</option><option>VVIP</option><option>Guest</option></select></div>
        <div class="field"><label>Price (pesewas)</label><input id="ttPrice" type="number" min="1" value="5000"></div>
        <div class="field"><label>Admits</label><input id="ttAdmits" type="number" min="1" value="1"></div>
        <div class="field full"><label>Quantity available</label><input id="ttRemaining" type="number" min="0" value="100"></div>
        <div class="field full"><label>Description</label><input id="ttDesc"></div>
      </div>
      <button class="btn red" id="addTt" style="margin-top:14px">ADD TICKET TYPE</button>`;
    document.querySelector('#addTt').onclick = async () => {
      try {
        await addDoc(collection(db, 'ticket_types'), {
          eventId: e.id,
          name: document.querySelector('#ttName').value,
          pricePesewas: Number(document.querySelector('#ttPrice').value),
          admits: Number(document.querySelector('#ttAdmits').value),
          remaining: Number(document.querySelector('#ttRemaining').value),
          description: document.querySelector('#ttDesc').value,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        renderTickets();
      } catch (err) { alert(err.message); }
    };
  }

  async function renderTables() {
    catBody.innerHTML = '<div class="status">Loading…</div>';
    const list = await loadList('table_packages');
    catBody.innerHTML = `
      <h3 class="display" style="font-size:28px;margin:0 0 14px">TABLE PACKAGES</h3>
      ${list.length ? list.map(t => `<div class="bottle-row"><div><strong>${esc(t.name)}</strong><small>${money(t.pricePesewas)} · ${t.remaining ?? '∞'} remaining</small></div><button class="btn small" data-del="table_packages" data-id="${esc(t.id)}">DELETE</button></div>`).join('') : '<div class="empty" style="padding:24px">No table packages yet.</div>'}
      <div class="form-grid" style="margin-top:26px">
        <div class="field full"><label>Name</label><input id="tpName" placeholder="e.g. VIP Table for 6"></div>
        <div class="field"><label>Price (pesewas)</label><input id="tpPrice" type="number" min="1" value="50000"></div>
        <div class="field"><label>Quantity available</label><input id="tpRemaining" type="number" min="0" value="5"></div>
        <div class="field full"><label>Capacity (people)</label><input id="tpCapacity" type="number" min="1" value="6"></div>
        <div class="field full"><label>Description</label><input id="tpDesc"></div>
      </div>
      <button class="btn red" id="addTp" style="margin-top:14px">ADD TABLE PACKAGE</button>`;
    document.querySelector('#addTp').onclick = async () => {
      try {
        await addDoc(collection(db, 'table_packages'), {
          eventId: e.id,
          name: document.querySelector('#tpName').value,
          pricePesewas: Number(document.querySelector('#tpPrice').value),
          remaining: Number(document.querySelector('#tpRemaining').value),
          capacity: Number(document.querySelector('#tpCapacity').value),
          description: document.querySelector('#tpDesc').value,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        renderTables();
      } catch (err) { alert(err.message); }
    };
  }

  async function renderBottles() {
    catBody.innerHTML = '<div class="status">Loading…</div>';
    const list = await loadList('bottles');
    catBody.innerHTML = `
      <h3 class="display" style="font-size:28px;margin:0 0 14px">BOTTLES</h3>
      ${list.length ? list.map(t => `<div class="bottle-row"><div><strong>${esc(t.name)}</strong><small>${money(t.pricePesewas)} · ${t.remaining ?? '∞'} remaining</small></div><button class="btn small" data-del="bottles" data-id="${esc(t.id)}">DELETE</button></div>`).join('') : '<div class="empty" style="padding:24px">No bottles yet.</div>'}
      <div class="form-grid" style="margin-top:26px">
        <div class="field full"><label>Name</label><input id="btName" placeholder="e.g. Hennessy VS"></div>
        <div class="field"><label>Price (pesewas)</label><input id="btPrice" type="number" min="1" value="45000"></div>
        <div class="field"><label>Quantity available</label><input id="btRemaining" type="number" min="0" value="10"></div>
        <div class="field full"><label>Category</label><input id="btCategory" placeholder="spirits / wine / champagne"></div>
      </div>
      <button class="btn red" id="addBt" style="margin-top:14px">ADD BOTTLE</button>`;
    document.querySelector('#addBt').onclick = async () => {
      try {
        await addDoc(collection(db, 'bottles'), {
          eventId: e.id,
          name: document.querySelector('#btName').value,
          pricePesewas: Number(document.querySelector('#btPrice').value),
          remaining: Number(document.querySelector('#btRemaining').value),
          category: document.querySelector('#btCategory').value,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        renderBottles();
      } catch (err) { alert(err.message); }
    };
  }

  m.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    m.querySelectorAll('[data-cat]').forEach(x => x.classList.remove('red'));
    b.classList.add('red');
    if (b.dataset.cat === 'tickets') renderTickets();
    else if (b.dataset.cat === 'tables') renderTables();
    else renderBottles();
  });

  catBody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    if (!confirm('Delete this item?')) return;
    try {
      await deleteDoc(doc(db, btn.dataset.del, btn.dataset.id));
      const active = m.querySelector('[data-cat].red');
      if (active) active.click();
    } catch (err) { alert(err.message); }
  });

  renderTickets();
  m.querySelector('[data-cat="tickets"]').classList.add('red');
}

// ═══════════════════════════════════════════════════════════════════
// TICKETS / TABLES / RAFFLE / REQUESTS
// ═══════════════════════════════════════════════════════════════════
async function ticketsTab() {
  panel.innerHTML = layout('TICKETS', 'All ticket types across events.');
  const body = document.querySelector('#tabBody');
  try {
    const d = await adminApi('/api/admin/catalog');
    const rows = d.ticketTypes || [];
    body.innerHTML = `<div class="admin-list">${rows.length ? rows.map(t => `<div class="admin-row"><div><strong>${esc(t.name)}</strong><small>${esc(t.eventName || t.eventId)} · ${money(t.pricePesewas)} · ${t.remaining ?? '∞'} remaining</small></div></div>`).join('') : '<div class="empty">No ticket types.</div>'}</div>`;
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

async function tablesTab() {
  panel.innerHTML = layout('TABLES', 'Packages and availability.');
  const body = document.querySelector('#tabBody');
  try {
    const d = await adminApi('/api/admin/catalog');
    const rows = d.tablePackages || [];
    body.innerHTML = `<div class="admin-list">${rows.length ? rows.map(t => `<div class="admin-row"><div><strong>${esc(t.name)}</strong><small>${esc(t.eventName || t.eventId)} · ${money(t.pricePesewas)} · ${t.remaining ?? '∞'} remaining</small></div></div>`).join('') : '<div class="empty">No table packages.</div>'}</div>`;
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

async function raffleTab() {
  panel.innerHTML = layout('RAFFLE', 'Spots fill automatically as tickets sell. The draw is manual.');
  const body = document.querySelector('#tabBody');
  try {
    // Both raffles and their entry counts come from the Worker — raffle_entries is not
    // client-readable (firestore.rules denies it outright), so this never goes to Firestore directly.
    const [raffleData, eventData] = await Promise.all([
      adminApi('/api/admin/raffles'),
      adminApi('/api/admin/events'),
    ]);
    const raffles = raffleData.raffles || [];
    const events = eventData.events || [];

    body.innerHTML = `
      <div class="admin-list">${raffles.length ? raffles.map(r => {
        const cap = Number(r.cap) > 0 ? Number(r.cap) : 20;
        const spotsTaken = Number(r.spotsTaken || 0);
        return `<div class="admin-row">
          <div><strong>${esc(r.title || r.prize || 'Raffle')}</strong><small>${esc(r.eventName || r.eventId)} · ${esc(r.status || 'open')} · ${spotsTaken} of ${cap} spots · ${r.entryCount || 0} eligible entries</small></div>
          ${r.status === 'drawn' ? `<span class="status success">WINNER ${esc(r.winnerDisplayName || '')}${r.winnerDisplayCode ? ` #${esc(r.winnerDisplayCode)}` : ''}</span>` : `<button class="btn red" data-draw="${esc(r.id)}">DRAW</button>`}
        </div>`;
      }).join('') : '<div class="empty">No raffles yet.</div>'}</div>
      <section class="admin-section" style="margin-top:30px">
        <h2 class="display" style="font-size:28px">START A RAFFLE</h2>
        <div class="form-grid">
          <div class="field full"><label>Night</label><select id="rfEvent">${events.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Prize</label><input id="rfPrize" placeholder="e.g. A magnum of Moët"></div>
          <div class="field"><label>Spot cap</label><input id="rfCap" type="number" min="1" value="20"></div>
          <div class="field full"><button class="btn red" id="rfCreate">CREATE RAFFLE</button></div>
        </div>
        <div id="rfMsg" style="margin-top:12px"></div>
      </section>`;

    document.querySelectorAll('[data-draw]').forEach(b => b.onclick = async () => {
      if (!confirm('Draw this raffle now?')) return;
      try {
        const raffleId = b.dataset.draw;
        const d = await adminApi('/api/admin/raffle/draw', {
          method: 'POST',
          body: JSON.stringify({ raffleId }),
        });
        alert(`Winner: ${d.winnerDisplayName || d.winnerTicketId}`);
        raffleTab();
      } catch (err) { alert(err.message); }
    });

    document.querySelector('#rfCreate').onclick = async () => {
      const msg = document.querySelector('#rfMsg');
      const eventId = document.querySelector('#rfEvent').value;
      const prize = document.querySelector('#rfPrize').value.trim();
      const cap = Number(document.querySelector('#rfCap').value);
      if (!eventId || !prize) { msg.innerHTML = '<div class="status error">Pick a night and enter a prize.</div>'; return; }
      try {
        await adminApi('/api/admin/raffles', { method: 'POST', body: JSON.stringify({ eventId, prize, cap }) });
        raffleTab();
      } catch (err) { msg.innerHTML = `<div class="status error">${esc(err.message)}</div>`; }
    };
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

function requestStatusBadge(status) {
  const s = status || 'NEW';
  const cls = s === 'ACCEPTED' ? 'success' : s === 'DECLINED' ? 'error' : '';
  return `<span class="status ${cls}">${esc(s)}</span>`;
}

async function requestsTab() {
  panel.innerHTML = layout('PRIVATE NIGHTS', 'Requests from guests. Open one to accept, decline, or leave a note.');
  const body = document.querySelector('#tabBody');
  try {
    // private_event_requests denies client reads outright in firestore.rules (no admin()
    // exception either) — same reasoning as overviewTab, so this goes through the Worker.
    const d = await adminApi('/api/admin/requests');
    const rows = (d.requests || []).slice();
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const render = (openId = null) => {
      body.innerHTML = `<div class="admin-list">${rows.length ? rows.map(r => `
        <article class="admin-row" style="flex-direction:column;align-items:stretch">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer" data-toggle="${esc(r.id)}">
            <div><strong>${esc(r.name)}</strong><small>${esc(r.phone)} · ${esc(r.email)} · ${esc(r.eventType || 'Private night')} · ${esc(r.date || '')}</small></div>
            ${requestStatusBadge(r.status)}
          </div>
          ${openId === r.id ? `
            <div style="margin-top:14px;border-top:1px solid var(--line,#333);padding-top:14px">
              <p style="color:var(--muted)">${esc(r.message || 'No message.')}</p>
              <p style="color:var(--muted);font-size:12px">${r.guests ? `${esc(String(r.guests))} guests · ` : ''}Requested ${esc(r.date || 'no date given')}</p>
              <div class="field full"><label>Note (staff only)</label><textarea id="noteFor-${esc(r.id)}" rows="3">${esc(r.note || '')}</textarea></div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
                <button class="btn red" data-accept="${esc(r.id)}">ACCEPT</button>
                <button class="btn ghost" data-decline="${esc(r.id)}">DECLINE</button>
                <button class="btn ghost" data-savenote="${esc(r.id)}">SAVE NOTE</button>
              </div>
              <div id="reqMsg-${esc(r.id)}" style="margin-top:10px"></div>
            </div>` : ''}
        </article>`).join('') : '<div class="empty">No private requests.</div>'}</div>`;

      document.querySelectorAll('[data-toggle]').forEach(el => el.onclick = () => render(openId === el.dataset.toggle ? null : el.dataset.toggle));

      const update = async (id, payload) => {
        const msg = document.querySelector(`#reqMsg-${CSS.escape(id)}`);
        try {
          await adminApi(`/api/admin/requests/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(payload) });
          const row = rows.find(r => r.id === id);
          if (row) Object.assign(row, payload);
          render(id);
        } catch (err) { if (msg) msg.innerHTML = `<div class="status error">${esc(err.message)}</div>`; }
      };
      document.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => update(b.dataset.accept, { status: 'ACCEPTED', note: document.querySelector(`#noteFor-${CSS.escape(b.dataset.accept)}`)?.value || '' }));
      document.querySelectorAll('[data-decline]').forEach(b => b.onclick = () => { if (confirm('Decline this request?')) update(b.dataset.decline, { status: 'DECLINED', note: document.querySelector(`#noteFor-${CSS.escape(b.dataset.decline)}`)?.value || '' }); });
      document.querySelectorAll('[data-savenote]').forEach(b => b.onclick = () => update(b.dataset.savenote, { note: document.querySelector(`#noteFor-${CSS.escape(b.dataset.savenote)}`)?.value || '' }));
    };
    render();
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

// ═══════════════════════════════════════════════════════════════════
// STAFF — grant roles by email (superAdmin only; enforced server-side)
// ═══════════════════════════════════════════════════════════════════
async function staffTab() {
  panel.innerHTML = layout('STAFF', 'Grant staff roles by email. Super admin only.');
  const body = document.querySelector('#tabBody');
  body.innerHTML = `
    <div class="form-grid" style="max-width:520px">
      <div class="field full"><label>Staff email</label><input id="roleEmail" type="email" placeholder="name@example.com"></div>
      <div class="field full"><label>Role</label>
        <select id="roleSelect">
          <option value="doorStaff">Door staff</option>
          <option value="eventManager">Event manager</option>
          <option value="manager">Manager</option>
          <option value="superAdmin">Super admin</option>
          <option value="organiser">Organiser</option>
        </select>
      </div>
      <div class="field full"><button class="btn red" id="setRole">GRANT ROLE</button></div>
    </div>
    <div id="roleMsg" style="margin-top:16px"></div>
    <p style="color:var(--muted);margin-top:24px;font-size:12px;max-width:520px">
      The person must already have a Firebase Auth account with this email. Role changes take
      effect the next time they sign in. Granting "Organiser" only sets their role — link them to
      a specific night from the Events tab using the UID shown below.
    </p>`;
  document.querySelector('#setRole').onclick = async () => {
    const btn = document.querySelector('#setRole');
    const msg = document.querySelector('#roleMsg');
    const email = document.querySelector('#roleEmail').value.trim();
    const role = document.querySelector('#roleSelect').value;
    if (!email) { msg.innerHTML = '<div class="status error">Enter an email address.</div>'; return; }
    btn.disabled = true;
    msg.innerHTML = '';
    try {
      const d = await adminApi('/api/admin/set-role', { method: 'POST', body: JSON.stringify({ email, role }) });
      msg.innerHTML = `<div class="status success">${esc(email)} is now ${esc(role)}. UID: <code>${esc(d.uid)}</code></div>`;
    } catch (err) {
      msg.innerHTML = `<div class="status error">${esc(err.message)}</div>`;
    }
    btn.disabled = false;
  };
}

// ═══════════════════════════════════════════════════════════════════
// INSTALLMENTS — payment-plan visibility, resend SMS. Every state change (top-ups,
// completion, forfeiture) is still driven only by the transactional Worker paths that
// process real Paystack payments — nothing here writes plan state directly.
// ═══════════════════════════════════════════════════════════════════
async function installmentsTab() {
  panel.innerHTML = layout('INSTALLMENTS', 'Payment plans — customer, balance, status, and payment history.');
  const body = document.querySelector('#tabBody');
  try {
    const d = await adminApi('/api/admin/installments');
    const plans = d.plans || [];

    const render = (openId = null) => {
      body.innerHTML = `<div class="admin-list">${plans.length ? plans.map(p => {
        const remaining = Number(p.totalPesewas || 0) - Number(p.paidPesewas || 0);
        const statusCls = p.status === 'completed' ? 'success' : p.status === 'forfeited' ? 'error' : '';
        return `<article class="admin-row" style="flex-direction:column;align-items:stretch">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer" data-toggle="${esc(p.id)}">
            <div><strong>${esc(p.buyerName)}</strong><small>${esc(p.buyerPhone)} · ${esc(p.eventName)} · Order ${esc(p.id)}</small></div>
            <div style="text-align:right"><span class="status ${statusCls}">${esc(p.status || 'active').toUpperCase()}</span><br><small>${money(p.paidPesewas)} / ${money(p.totalPesewas)}</small></div>
          </div>
          ${openId === p.id ? `
            <div style="margin-top:14px;border-top:1px solid var(--line,#333);padding-top:14px">
              <p style="color:var(--muted)">${esc(p.ticketTypeName || 'Ticket')} × ${p.quantity || 1} · Balance owing: ${money(remaining)}</p>
              <p style="color:var(--muted);font-size:12px">${esc(p.buyerEmail || '')} · Created ${p.createdAt ? new Date(p.createdAt).toLocaleString('en-GH') : ''}</p>
              <p style="color:var(--muted);font-size:12px">Ticket status: ${p.status === 'completed' ? `Issued (${(p.ticketIds || []).length} ticket${(p.ticketIds || []).length === 1 ? '' : 's'})` : p.status === 'forfeited' ? 'Forfeited — event date passed before plan completed' : 'Not yet issued — plan still active'}</p>
              <div style="margin-top:10px"><strong style="font-size:12px;letter-spacing:.05em">PAYMENT HISTORY</strong>
                <div style="margin-top:6px">${(p.payments || []).length ? p.payments.map(pay => `<div style="font-size:13px;color:var(--muted)">${money(pay.amountPesewas)} — ${pay.paidAt ? new Date(pay.paidAt).toLocaleString('en-GH') : ''} — <code>${esc(pay.reference || '')}</code></div>`).join('') : '<div class="empty">No payments yet.</div>'}</div>
              </div>
              ${p.status !== 'forfeited' ? `<div style="margin-top:14px"><button class="btn ghost" data-resend="${esc(p.id)}">RESEND SMS</button></div>` : ''}
              <div id="planMsg-${esc(p.id)}" style="margin-top:10px"></div>
            </div>` : ''}
        </article>`;
      }).join('') : '<div class="empty">No payment plans yet.</div>'}</div>`;

      document.querySelectorAll('[data-toggle]').forEach(el => el.onclick = () => render(openId === el.dataset.toggle ? null : el.dataset.toggle));
      document.querySelectorAll('[data-resend]').forEach(b => b.onclick = async () => {
        const msg = document.querySelector(`#planMsg-${CSS.escape(b.dataset.resend)}`);
        b.disabled = true;
        try {
          await adminApi('/api/admin/installments/resend-sms', { method: 'POST', body: JSON.stringify({ planId: b.dataset.resend }) });
          if (msg) msg.innerHTML = '<div class="status success">SMS sent.</div>';
        } catch (err) { if (msg) msg.innerHTML = `<div class="status error">${esc(err.message)}</div>`; }
        b.disabled = false;
      });
    };
    render();
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS — single source of truth for contact info shown across the public site
// ═══════════════════════════════════════════════════════════════════
async function settingsTab() {
  panel.innerHTML = layout('SETTINGS', 'Contact info shown across the public site. Changes apply everywhere immediately.');
  const body = document.querySelector('#tabBody');
  try {
    const r = await fetch(`${window.MEMORIES_CONFIG.apiBase}/api/settings`);
    const s = (await r.json())?.settings || {};
    const fields = [
      ['phone', 'Phone'], ['email', 'Email'], ['instagram', 'Instagram'],
      ['whatsapp', 'WhatsApp'], ['venue', 'Venue'], ['doorsLine', 'Doors line'], ['address', 'Address'],
    ];
    body.innerHTML = `
      <div class="form-grid" style="max-width:520px">
        ${fields.map(([key, label]) => `<div class="field full"><label>${esc(label)}</label><input id="set-${key}" value="${esc(s[key] || '')}"></div>`).join('')}
        <div class="field full"><button class="btn red" id="saveSettings">SAVE</button></div>
      </div>
      <div id="setMsg" style="margin-top:16px"></div>`;
    document.querySelector('#saveSettings').onclick = async () => {
      const msg = document.querySelector('#setMsg');
      const payload = Object.fromEntries(fields.map(([key]) => [key, document.querySelector(`#set-${key}`).value.trim()]));
      try {
        await adminApi('/api/admin/settings', { method: 'POST', body: JSON.stringify(payload) });
        msg.innerHTML = '<div class="status success">Saved.</div>';
      } catch (err) { msg.innerHTML = `<div class="status error">${esc(err.message)}</div>`; }
    };
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER + AUTH
// ═══════════════════════════════════════════════════════════════════
async function show(tab) {
  if (tab === 'events') return eventsTab();
  if (tab === 'tickets') return ticketsTab();
  if (tab === 'tables') return tablesTab();
  if (tab === 'raffle') return raffleTab();
  if (tab === 'requests') return requestsTab();
  if (tab === 'installments') return installmentsTab();
  if (tab === 'settings') return settingsTab();
  if (tab === 'staff') return staffTab();
  return overviewTab();
}
function bindTabs() { document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab)); }
bindTabs();
document.querySelector('#logout').onclick = () => signOut(auth).then(() => location.href = 'login.html');
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = 'login.html'; return; }
  const result = await user.getIdTokenResult().catch(() => null);
  if (result?.claims?.role === 'organiser') { location.href = 'organiser.html'; return; }
  show('overview');
});