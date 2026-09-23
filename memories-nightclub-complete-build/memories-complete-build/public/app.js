// ═══════════════════════════════════════════════════════════════════
// MEMORIES — Public app.js (customer side)
// Reads go to Firestore directly. Only payments + SMS use the Worker.
// ═══════════════════════════════════════════════════════════════════

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, runTransaction, serverTimestamp,
  increment,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// ── Firebase init (safe to call multiple times) ──
const cfg = window.MEMORIES_CONFIG;
if (!cfg?.firebase) throw new Error('MEMORIES_CONFIG.firebase missing in config.js');

const app = getApps().length ? getApps()[0] : initializeApp(cfg.firebase);
export const db = getFirestore(app);

// ── Worker base URL ──
const API = (cfg.apiBase || '').replace(/\/$/, '');

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
export const money = n => `GHS ${(Number(n || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`;
export const qs = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[c]));
export const params = new URLSearchParams(location.search);

export function toast(msg) {
  const t = qs('.toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3200);
}

export function art(url, title = 'MEMORIES') {
  return url
    ? `<img src="${esc(url)}" alt="${esc(title)}">`
    : `<div class="art-fallback">${esc((title || 'M').slice(0, 1))}</div>`;
}

export function eventDate(e) {
  if (!e?.date) return '';
  const d = new Date(e.date);
  return d.toLocaleDateString('en-GH', {
    weekday: 'short', day: '2-digit', month: 'short',
  }).toUpperCase();
}

export function eventTime(e) {
  return e?.doors || '10PM';
}

// ═══════════════════════════════════════════════════════════════════
// WORKER API — only for payments (has secrets)
// ═══════════════════════════════════════════════════════════════════
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = await window.getFirebaseIdToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(API + path, { ...options, headers });
  const data = await r.json().catch(() => ({ success: false, error: 'Invalid server response.' }));
  if (!r.ok && !data.success) throw new Error(data.error || 'Request failed.');
  return data;
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS (direct Firestore)
// ═══════════════════════════════════════════════════════════════════
export async function getEvents() {
  const snap = await getDocs(query(
    collection(db, 'events'),
    where('visibility', '==', 'public'),
    where('active', '==', true)
  ));
  const events = [];
  snap.forEach(d => events.push({ id: d.id, ...d.data() }));
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { success: true, events };
}

export async function getEvent(id) {
  if (!id || id === 'null' || id === 'undefined') throw new Error('Event not found.');

  const eSnap = await getDoc(doc(db, 'events', id));
  if (!eSnap.exists()) throw new Error('Event not found.');
  const event = { id: eSnap.id, ...eSnap.data() };

  const [ttSnap, tpSnap, bSnap, rSnap] = await Promise.all([
    getDocs(query(collection(db, 'ticket_types'), where('eventId', '==', id), where('active', '==', true))),
    getDocs(query(collection(db, 'table_packages'), where('eventId', '==', id), where('active', '==', true))),
    getDocs(query(collection(db, 'bottles'), where('eventId', '==', id), where('active', '==', true))),
    getDocs(query(collection(db, 'raffles'), where('eventId', '==', id), where('enabled', '==', true))),
  ]);

  const ticketTypes = []; ttSnap.forEach(d => ticketTypes.push({ id: d.id, ...d.data() }));
  const tablePackages = []; tpSnap.forEach(d => tablePackages.push({ id: d.id, ...d.data() }));
  const bottles = []; bSnap.forEach(d => bottles.push({ id: d.id, ...d.data() }));

  let raffle = null;
  rSnap.forEach(d => {
    const r = d.data();
    if (r.public === true && !raffle) raffle = { id: d.id, ...r };
  });

  return { success: true, event, ticketTypes, tablePackages, bottles, raffle };
}

// ═══════════════════════════════════════════════════════════════════
// TICKET (public read by token)
// ═══════════════════════════════════════════════════════════════════
export async function getTicket(token) {
  if (!token) throw new Error('No ticket token');
  const tSnap = await getDoc(doc(db, 'tickets', token));
  if (!tSnap.exists()) throw new Error('Ticket not found.');
  const t = tSnap.data();

  let event = {};
  if (t.eventId) {
    const eSnap = await getDoc(doc(db, 'events', t.eventId));
    if (eSnap.exists()) event = eSnap.data();
  }

  return {
    success: true,
    ticket: {
      ticketId: token,
      customerName: t.customerName,
      type: t.type,
      admitCount: t.admitCount,
      identityLine: t.identityLine,
      status: t.status,
      revoked: t.revoked,
      cancelled: t.cancelled,
      displayCode: t.displayCode,
      eventId: t.eventId,
      eventName: t.eventName,
      eventDate: event.date,
      eventVenue: event.venue,
      eventDoors: event.doors,
    },
  };
}

export async function verifyTicket(token) {
  if (!token) return { valid: false, message: 'No token' };
  const snap = await getDoc(doc(db, 'tickets', token));
  if (!snap.exists()) return { valid: false, message: 'Ticket not found.' };
  const t = snap.data();
  const valid = t.status === 'valid' && !t.revoked && !t.cancelled;
  return {
    success: true,
    valid,
    message: valid ? 'VALID TICKET'
           : t.status === 'used' ? 'TICKET ALREADY USED'
           : 'TICKET NOT VALID',
    ticket: {
      eventName: t.eventName,
      customerName: t.customerName,
      status: t.status,
      displayCode: t.displayCode,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// CHECK-IN (requires signed-in door staff)
// ═══════════════════════════════════════════════════════════════════
export async function checkinTicket(token) {
  if (!token) throw new Error('Token required');

  const user = window.getCurrentUser?.();
  if (!user) throw new Error('Sign in required to check in tickets.');

  const result = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'tickets', token);
    const snap = await tx.get(ref);

    if (!snap.exists()) throw new Error('Ticket not found.');
    const t = snap.data();

    if (t.revoked) throw new Error('This ticket has been revoked.');
    if (t.cancelled) throw new Error('This ticket has been cancelled.');
    if (t.status === 'used') throw new Error('TICKET ALREADY USED');

    const when = serverTimestamp();
    tx.update(ref, {
      status: 'used',
      checkedInAt: when,
      checkedInBy: user.uid,
    });

    const checkinRef = doc(collection(db, 'checkins'));
    tx.set(checkinRef, {
      ticketId: token,
      eventId: t.eventId,
      checkedInAt: when,
      checkedInBy: user.uid,
    });

    return { customerName: t.customerName, eventName: t.eventName };
  });

  return {
    success: true,
    valid: true,
    message: 'ENTRY CONFIRMED',
    ticket: result,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PRIVATE NIGHT REQUEST (public create)
// ═══════════════════════════════════════════════════════════════════
export async function submitPrivateRequest(payload) {
  await addDoc(collection(db, 'private_event_requests'), {
    ...payload,
    guests: Number(payload.guests || 0),
    status: 'NEW',
    createdAt: serverTimestamp(),
  });
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
// RAFFLE ENTRY
// ═══════════════════════════════════════════════════════════════════
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function enterRaffle(raffleId, ticketToken) {
  if (!raffleId || !ticketToken) throw new Error('Ticket and raffle required');

  const entryId = await sha256Hex(`${raffleId}:${ticketToken}`);
  const entryRef = doc(db, 'raffle_entries', entryId);
  const existing = await getDoc(entryRef);
  if (existing.exists()) return { success: true, alreadyEntered: true, entryId };

  const [raffleSnap, ticketSnap] = await Promise.all([
    getDoc(doc(db, 'raffles', raffleId)),
    getDoc(doc(db, 'tickets', ticketToken)),
  ]);
  if (!raffleSnap.exists()) throw new Error('Raffle not found.');
  if (!ticketSnap.exists()) throw new Error('Ticket not found.');

  const raffle = raffleSnap.data();
  const ticket = ticketSnap.data();

  if (raffle.enabled !== true || raffle.status === 'drawn') throw new Error('Raffle is not active.');
  if (ticket.status !== 'valid' || ticket.revoked || ticket.cancelled) throw new Error('Ticket not eligible.');
  if (raffle.eventId !== ticket.eventId) throw new Error('Ticket is for a different event.');

  await setDoc(entryRef, {
    raffleId,
    eventId: raffle.eventId,
    ticketId: ticketToken,
    status: 'eligible',
    createdAt: serverTimestamp(),
  });

  return { success: true, entryId };
}

// ═══════════════════════════════════════════════════════════════════
// LAYOUT — nav + footer
// ═══════════════════════════════════════════════════════════════════
export function shell(active = '') {
  return `<header class="nav"><div class="wrap" style="width:100%;display:flex;align-items:center;justify-content:space-between"><a class="brand" href="index.html">MEMORIES</a><nav class="navlinks"><a href="nights.html">Nights</a><a href="tables.html">Tables</a><a href="private.html">Private</a><a href="nights.html#tickets">Get Tickets</a></nav><button class="menu" aria-label="Menu" onclick="document.querySelector('.navlinks').classList.toggle('open')">☰</button></div></header>`;
}

export function footer() {
  return `<footer class="footer"><div class="wrap footer-grid"><div><div class="brand">MEMORIES</div><p>Some nights become stories. Find the next one in Cape Coast.</p></div><div><div class="eyebrow">Explore</div><p><a href="nights.html">Nights</a><br><a href="tables.html">Tables</a><br><a href="private.html">Private Night</a></p></div><div><div class="eyebrow">Social</div><p>@memoriesnightclub.gh<br>Cape Coast, Ghana</p></div></div><div class="wrap" style="margin-top:35px;font-size:11px">© ${new Date().getFullYear()} Memories Night Club</div></footer>`;
}

// ═══════════════════════════════════════════════════════════════════
// Re-export commonly used Firestore functions
// ═══════════════════════════════════════════════════════════════════
export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, runTransaction, serverTimestamp, increment,
};