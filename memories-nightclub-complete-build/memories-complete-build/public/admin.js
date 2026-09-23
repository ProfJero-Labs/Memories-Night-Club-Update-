// ═══════════════════════════════════════════════════════════════════
// MEMORIES ADMIN — Standalone (only depends on firebase.js + CDN)
// ═══════════════════════════════════════════════════════════════════

import { auth, signOut, onAuthStateChanged } from './firebase.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, runTransaction, serverTimestamp,
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

console.log('🔵 ADMIN.JS v4 — Standalone');

// ═══════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════
const root = document.querySelector('#adminApp');
const nav = `<aside class="admin-nav"><a class="brand" href="index.html">MEMORIES</a><div class="eyebrow">CONTROL ROOM</div><button data-tab="overview">Overview</button><button data-tab="events">Events</button><button data-tab="tickets">Tickets</button><button data-tab="tables">Tables</button><button data-tab="raffle">Raffle</button><button data-tab="requests">Private nights</button><a href="verify.html">Door check</a><button id="logout" class="btn ghost">Sign out</button></aside>`;
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
    const [eventsSnap, ticketsSnap, ordersSnap, checkinsSnap, requestsSnap] = await Promise.all([
      getDocs(query(collection(db, 'events'), where('visibility', '==', 'public'), where('active', '==', true))),
      getDocs(collection(db, 'tickets')),
      getDocs(collection(db, 'orders')),
      getDocs(collection(db, 'checkins')),
      getDocs(collection(db, 'private_event_requests')),
    ]);

    const events = [];
    eventsSnap.forEach(d => events.push({ id: d.id, ...d.data() }));
    events.sort((a, b) => new Date(a.date) - new Date(b.date));

    body.innerHTML = `
      <div class="admin-cards">
        <div class="metric"><span>Tickets</span><strong>${ticketsSnap.size}</strong></div>
        <div class="metric"><span>Check-ins</span><strong>${checkinsSnap.size}</strong></div>
        <div class="metric"><span>Orders</span><strong>${ordersSnap.size}</strong></div>
        <div class="metric"><span>Private requests</span><strong>${requestsSnap.size}</strong></div>
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
    const [ttSnap, evSnap] = await Promise.all([getDocs(collection(db, 'ticket_types')), getDocs(collection(db, 'events'))]);
    const names = {}; evSnap.forEach(d => names[d.id] = d.data().name || d.id);
    const rows = []; ttSnap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    body.innerHTML = `<div class="admin-list">${rows.length ? rows.map(t => `<div class="admin-row"><div><strong>${esc(t.name)}</strong><small>${esc(names[t.eventId] || t.eventId)} · ${money(t.pricePesewas)} · ${t.remaining ?? '∞'} remaining</small></div></div>`).join('') : '<div class="empty">No ticket types.</div>'}</div>`;
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

async function tablesTab() {
  panel.innerHTML = layout('TABLES', 'Packages and availability.');
  const body = document.querySelector('#tabBody');
  try {
    const [tpSnap, evSnap] = await Promise.all([getDocs(collection(db, 'table_packages')), getDocs(collection(db, 'events'))]);
    const names = {}; evSnap.forEach(d => names[d.id] = d.data().name || d.id);
    const rows = []; tpSnap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    body.innerHTML = `<div class="admin-list">${rows.length ? rows.map(t => `<div class="admin-row"><div><strong>${esc(t.name)}</strong><small>${esc(names[t.eventId] || t.eventId)} · ${money(t.pricePesewas)} · ${t.remaining ?? '∞'} remaining</small></div></div>`).join('') : '<div class="empty">No table packages.</div>'}</div>`;
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

async function raffleTab() {
  panel.innerHTML = layout('RAFFLE', 'Eligibility, entries and the draw.');
  const body = document.querySelector('#tabBody');
  try {
    const [raffleSnap, entrySnap, evSnap] = await Promise.all([
      getDocs(collection(db, 'raffles')),
      getDocs(collection(db, 'raffle_entries')),
      getDocs(collection(db, 'events')),
    ]);
    const names = {}; evSnap.forEach(d => names[d.id] = d.data().name || d.id);
    const entriesByRaffle = {};
    entrySnap.forEach(d => { const r = d.data().raffleId; entriesByRaffle[r] = (entriesByRaffle[r] || 0) + 1; });
    const raffles = []; raffleSnap.forEach(d => raffles.push({ id: d.id, ...d.data() }));

    body.innerHTML = `<div class="admin-list">${raffles.length ? raffles.map(r => `
      <div class="admin-row">
        <div><strong>${esc(r.title || r.prize || 'Raffle')}</strong><small>${esc(names[r.eventId] || r.eventId)} · ${esc(r.status || 'open')} · ${entriesByRaffle[r.id] || 0} entries</small></div>
        ${r.status === 'drawn' ? `<span class="status success">WINNER ${esc(r.winnerTicketId || '')}</span>` : `<button class="btn red" data-draw="${esc(r.id)}">DRAW</button>`}
      </div>`).join('') : '<div class="empty">No raffles yet.</div>'}</div>`;

    document.querySelectorAll('[data-draw]').forEach(b => b.onclick = async () => {
      if (!confirm('Draw this raffle now?')) return;
      try {
        const raffleId = b.dataset.draw;
        const winner = await runTransaction(db, async (tx) => {
          const raffleRef = doc(db, 'raffles', raffleId);
          const snap = await tx.get(raffleRef);
          if (!snap.exists()) throw new Error('Raffle not found.');
          if (snap.data().status === 'drawn') throw new Error('Already drawn.');
          const entriesSnap = await getDocs(query(collection(db, 'raffle_entries'), where('raffleId', '==', raffleId), where('status', '==', 'eligible')));
          if (entriesSnap.empty) throw new Error('No eligible entries.');
          const docs = entriesSnap.docs;
          const pick = docs[Math.floor(Math.random() * docs.length)];
          tx.update(raffleRef, {
            status: 'drawn',
            winnerTicketId: pick.data().ticketId,
            winnerEntryId: pick.id,
            drawnAt: serverTimestamp(),
            drawnBy: auth.currentUser?.uid || null,
          });
          return pick.data().ticketId;
        });
        alert(`Winner: ${winner}`);
        raffleTab();
      } catch (err) { alert(err.message); }
    });
  } catch (e) { body.innerHTML = `<div class="status error">${esc(e.message)}</div>`; }
}

async function requestsTab() {
  panel.innerHTML = layout('PRIVATE NIGHTS', 'Requests from guests.');
  const body = document.querySelector('#tabBody');
  try {
    const snap = await getDocs(collection(db, 'private_event_requests'));
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    body.innerHTML = `<div class="admin-list">${rows.length ? rows.map(r => `<article class="admin-row"><div><strong>${esc(r.name)}</strong><small>${esc(r.phone)} · ${esc(r.email)} · ${esc(r.eventType || 'Private night')} · ${esc(r.date || '')}</small><p>${esc(r.message || '')}</p></div><span class="status">${esc(r.status || 'NEW')}</span></article>`).join('') : '<div class="empty">No private requests.</div>'}</div>`;
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
  return overviewTab();
}
function bindTabs() { document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab)); }
bindTabs();
document.querySelector('#logout').onclick = () => signOut(auth).then(() => location.href = 'login.html');
onAuthStateChanged(auth, user => { if (!user) { location.href = 'login.html'; return; } show('overview'); });