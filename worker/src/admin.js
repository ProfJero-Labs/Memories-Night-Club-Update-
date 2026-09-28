// Staff operations. Every write the admin console makes comes through here: role-checked,
// validated, and audit-logged. The browser never writes Firestore directly.
import { getDoc, setDoc, deleteDoc, listDocs, queryWhere, commitTx, updateWrite, withTransaction, googleAccessToken } from './lib/firestore.js';
import { now, id, clean, normalizePhone, ticketToken, displayCode, dateKey, firstName } from './lib/util.js';
import { requireRole, CMS, MONEY, STAFF_ROLES, uidOf } from './lib/auth.js';
import { sendSms, sendEmail, siteUrl } from './lib/notify.js';
import { getSettings, DEFAULT_SETTINGS, SETTINGS_FIELDS, isOver } from './public.js';
import { openRaffleForEvent, raffleSpotWrites } from './raffle.js';
import { balanceMessage } from './checkout.js';

const FORBIDDEN = { error: 'Forbidden.', status: 403 };
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user), ...data, timestamp: now() });
const httpsUrl = (s, env) => { const v = clean(s, 500); return !v || (env?.DEV_ALLOW_HTTP_ASSETS ? /^https?:\/\// : /^https:\/\//).test(v) ? v : null; };
// Flyers and hero images must be files uploaded to this project's own Storage (event-art/), so a
// night can't be pointed at an image on someone else's server. An image a night already has is
// kept as it is, so older data still saves. Dev (DEV_ALLOW_HTTP_ASSETS) accepts the local uploads.
const ownImage = (s, env, previous = '') => {
  const v = clean(s, 1000);
  if (!v || v === previous) return v;
  if (env?.DEV_ALLOW_HTTP_ASSETS) return /^https?:\/\//.test(v) ? v : null;
  const project = env?.FIREBASE_PROJECT_ID;
  const buckets = [env?.FIREBASE_STORAGE_BUCKET, `${project}.firebasestorage.app`, `${project}.appspot.com`].filter(Boolean);
  return buckets.some(bk => v.startsWith(`https://firebasestorage.googleapis.com/v0/b/${bk}/o/event-art%2F`)) ? v : null;
};
const intOrNull = v => (v === null || v === '' || v === undefined ? null : Number(v));

// The table tiers the BUILD_PLAN seeds every new night with. All editable per night.
export const DEFAULT_TABLE_PACKAGES = [
  { name: 'Table', pricePesewas: 200000, sortOrder: 1 },
  { name: 'Floor Table', pricePesewas: 350000, sortOrder: 2 },
  { name: 'Birthday Table', pricePesewas: 450000, sortOrder: 3 },
];

// ── Overview ──
export async function adminOverview(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const [events, orders, checkins, requests, plans] = await Promise.all([listDocs(env, 'events'), listDocs(env, 'orders'), listDocs(env, 'checkins'), queryWhere(env, 'private_event_requests', [{ field: 'status', value: 'NEW' }]), queryWhere(env, 'installment_plans', [{ field: 'status', value: 'active' }])]);
  const upcoming = events.filter(e => e.fields.active !== false && !isOver(e.fields)).sort((a, b) => new Date(a.fields.date) - new Date(b.fields.date));
  const confirmed = orders.filter(o => o.fields.status === 'confirmed');
  const nights = upcoming.slice(0, 6).map(e => {
    const mine = confirmed.filter(o => o.fields.eventId === e.id);
    return {
      id: e.id, name: e.fields.name, date: e.fields.date, visibility: e.fields.visibility,
      tickets: mine.filter(o => o.fields.kind === 'ticket').reduce((s, o) => s + Number(o.fields.quantity || 0), 0),
      comps: mine.filter(o => o.fields.kind === 'comp').reduce((s, o) => s + Number(o.fields.quantity || 1), 0),
      tables: mine.filter(o => o.fields.kind === 'table').length,
      revenuePesewas: mine.reduce((s, o) => s + Number(o.fields.amountPesewas || 0), 0),
      checkins: checkins.filter(c => c.fields.eventId === e.id).length,
    };
  });
  return {
    nights, newRequests: requests.length, activePlans: plans.length,
    owingPesewas: plans.reduce((s, p) => s + Math.max(0, Number(p.fields.totalPesewas) - Number(p.fields.paidPesewas || 0)), 0),
    revenuePesewas: confirmed.reduce((s, o) => s + Number(o.fields.amountPesewas || 0), 0),
  };
}

// ── Nights ──
export async function listEvents(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const events = (await listDocs(env, 'events')).map(x => ({ id: x.id, ...x.fields })).sort((a, b) => new Date(b.date) - new Date(a.date));
  return { events };
}

export async function eventDetail(env, eventId, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const e = await getDoc(env, 'events', eventId);
  if (!e) return { error: 'Night not found.', status: 404 };
  const [tickets, tables, bottles, raffles, entries] = await Promise.all(['ticket_types', 'table_packages', 'bottles', 'raffles'].map(c => queryWhere(env, c, [{ field: 'eventId', value: eventId }])).concat(queryWhere(env, 'raffle_entries', [{ field: 'eventId', value: eventId }])));
  const rows = xs => xs.map(x => ({ id: x.id, ...x.fields })).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.pricePesewas - b.pricePesewas);
  const raffle = raffles[0] ? { id: raffles[0].id, ...raffles[0].fields, entryCount: entries.length } : null;
  return { event: { id: e.id, ...e.fields }, ticketTypes: rows(tickets), tablePackages: rows(tables), bottles: rows(bottles), raffle };
}

export async function upsertEvent(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const name = clean(b?.name, 80);
  const date = b?.date && !isNaN(new Date(b.date)) ? new Date(b.date).toISOString() : null;
  if (!name) return { error: 'Give the night a name.' };
  if (!date) return { error: 'Set the date and start time.' };
  const lines = (Array.isArray(b.ticketLines) ? b.ticketLines : []).map(l => clean(l, 48)).filter(Boolean);
  if (lines.length > 12) return { error: 'Keep it to 12 lines or fewer.' };
  if (new Set(lines.map(l => l.toUpperCase())).size !== lines.length) return { error: 'Two of the lines are the same.' };
  const eventId = b.id ? String(b.id) : id();
  const existing = b.id ? await getDoc(env, 'events', eventId) : null;
  if (b.id && !existing) return { error: 'Night not found.', status: 404 };
  const artwork = ownImage(b.artwork, env, existing?.fields?.artwork), heroImage = ownImage(b.heroImage, env, existing?.fields?.heroImage);
  if (artwork === null || heroImage === null) return { error: 'Upload images here in the control room (links to other sites aren’t allowed).' };
  const data = {
    name, date, doors: clean(b.doors, 40), venue: clean(b.venue, 120), description: clean(b.description, 240),
    artwork, heroImage, ticketLines: lines, visibility: b.visibility === 'public' ? 'public' : 'private',
    active: b.active !== false, soldOut: b.soldOut === true, featured: b.featured === true,
    organiserId: clean(b.organiserId, 128) || null, updatedAt: now(), createdAt: existing?.fields?.createdAt || now(),
  };
  await setDoc(env, 'events', eventId, { ...(existing?.fields || {}), ...data });
  if (!existing) {
    for (const p of DEFAULT_TABLE_PACKAGES) await setDoc(env, 'table_packages', id(), { eventId, ...p, capacity: 0, remaining: null, active: true, description: '', createdAt: now() });
  }
  await audit(env, user, existing ? 'EVENT_UPDATED' : 'EVENT_CREATED', { eventId, name });
  return { eventId };
}

export async function deleteEvent(env, eventId, user) {
  if (!requireRole(user, ['superAdmin'])) return FORBIDDEN;
  const sold = await queryWhere(env, 'orders', [{ field: 'eventId', value: eventId }], { limit: 1 });
  if (sold.length) return { error: 'This night has sales. Switch it off instead of deleting it.' };
  for (const col of ['ticket_types', 'table_packages', 'bottles', 'raffles']) for (const d of await queryWhere(env, col, [{ field: 'eventId', value: eventId }])) await deleteDoc(env, col, d.id);
  await deleteDoc(env, 'events', eventId);
  await audit(env, user, 'EVENT_DELETED', { eventId });
  return {};
}

// ── Ticket types, table packages, bottles ──
const CATALOG = {
  ticket_types: { fields: ['name', 'pricePesewas', 'admits', 'remaining', 'active', 'description', 'sortOrder'], minPrice: 1 },
  table_packages: { fields: ['name', 'pricePesewas', 'capacity', 'remaining', 'active', 'description', 'sortOrder'], minPrice: 1 },
  bottles: { fields: ['name', 'pricePesewas', 'category', 'remaining', 'active'], minPrice: 1 },
};
export async function upsertCatalog(env, col, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const spec = CATALOG[col]; if (!spec) return { error: 'Unknown collection.' };
  const eventId = col === 'bottles' && (!b?.eventId || b.eventId === 'all') ? 'all' : String(b?.eventId || '');
  if (!eventId) return { error: 'Pick a night.' };
  if (eventId !== 'all' && !(await getDoc(env, 'events', eventId))) return { error: 'Night not found.', status: 404 };
  const docId = b.id ? String(b.id) : id();
  const existing = b.id ? await getDoc(env, col, docId) : null;
  if (b.id && (!existing || existing.fields.eventId !== eventId)) return { error: 'Item not found.', status: 404 };
  const d = { ...(existing?.fields || {}) };
  if (b.name !== undefined) d.name = clean(b.name, 60);
  if (!d.name) return { error: 'Add a name.' };
  if (b.pricePesewas !== undefined) d.pricePesewas = Number(b.pricePesewas);
  if (!Number.isInteger(d.pricePesewas) || d.pricePesewas < spec.minPrice) return { error: 'Add a price above zero.' };
  if (spec.fields.includes('admits')) { d.admits = b.admits === undefined ? (d.admits || 1) : Number(b.admits); if (!Number.isInteger(d.admits) || d.admits < 1 || d.admits > 20) return { error: 'Admits must be 1 to 20.' }; }
  if (spec.fields.includes('capacity') && b.capacity !== undefined) { d.capacity = Number(b.capacity || 0); if (!Number.isInteger(d.capacity) || d.capacity < 0) return { error: 'Capacity must be a whole number.' }; }
  if (b.remaining !== undefined) { d.remaining = intOrNull(b.remaining); if (d.remaining !== null && (!Number.isInteger(d.remaining) || d.remaining < 0)) return { error: 'Quantity left must be a whole number, or blank for no limit.' }; }
  if (b.active !== undefined) d.active = b.active === true;
  if (b.description !== undefined) d.description = clean(b.description, 200);
  if (b.category !== undefined) d.category = clean(b.category, 40);
  if (b.sortOrder !== undefined) d.sortOrder = Number(b.sortOrder) || 0;
  d.eventId = eventId; d.updatedAt = now(); d.createdAt = existing?.fields?.createdAt || now();
  if (d.active === undefined) d.active = true;
  await setDoc(env, col, docId, d);
  await audit(env, user, 'CATALOG_UPSERT', { collection: col, id: docId, eventId, name: d.name, pricePesewas: d.pricePesewas });
  return { id: docId };
}
export async function deleteCatalog(env, col, docId, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  if (!CATALOG[col]) return { error: 'Unknown collection.' };
  await deleteDoc(env, col, docId);
  await audit(env, user, 'CATALOG_DELETE', { collection: col, id: docId });
  return {};
}
export async function listBottles(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  return { bottles: (await queryWhere(env, 'bottles', [{ field: 'eventId', value: 'all' }])).map(x => ({ id: x.id, ...x.fields })).sort((a, b) => String(a.category).localeCompare(String(b.category)) || a.pricePesewas - b.pricePesewas) };
}

// ── Orders & bookings ──
export async function listOrders(env, q, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const filters = [];
  if (q.eventId) filters.push({ field: 'eventId', value: q.eventId });
  if (q.kind) filters.push({ field: 'kind', value: q.kind });
  const docs = filters.length ? await queryWhere(env, 'orders', filters) : await listDocs(env, 'orders');
  return { orders: docs.map(x => { const o = { id: x.id, ...x.fields }; delete o.ticketIds; return o; }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) };
}

// ── Comps: free entry issued by staff, recorded against who issued it ──
export async function issueComp(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const name = clean(b?.name, 80), phone = b?.phone ? normalizePhone(b.phone) : '';
  const admits = Number(b?.admits || 1);
  if (!b?.eventId) return { error: 'Pick a night.' };
  if (!name) return { error: 'Who is the comp for?' };
  if (phone === null) return { error: 'That phone number doesn’t look right.' };
  if (!Number.isInteger(admits) || admits < 1 || admits > 10) return { error: 'A comp admits 1 to 10 people.' };
  const ev = await getDoc(env, 'events', b.eventId);
  if (!ev) return { error: 'Night not found.', status: 404 };
  const token = ticketToken(), orderId = id(), issuedBy = uidOf(user);
  const wantDraw = b.inDraw === true;
  const res = await withTransaction(env, async tx => {
    const raffle = wantDraw ? await openRaffleForEvent(env, tx, b.eventId) : null;
    await commitTx(env, [
      updateWrite(env, 'tickets', token, { customerName: name, phone: phone || '', phoneLast4: (phone || '').slice(-4), type: 'Comp', admitCount: admits, eventId: b.eventId, eventName: ev.fields.name || '', identityLine: '', reference: orderId, displayCode: displayCode(token), status: 'valid', revoked: false, cancelled: false, comp: true, issuedBy, compNote: clean(b.note, 200), inDraw: !!raffle, issuedAt: now() }),
      updateWrite(env, 'orders', orderId, { orderId, kind: 'comp', eventId: b.eventId, eventName: ev.fields.name || '', quantity: 1, admits, amountPesewas: 0, buyerName: name, buyerPhone: phone || '', status: 'confirmed', issuedBy, note: clean(b.note, 200), inDraw: !!raffle, ticketIds: [token], createdAt: now() }),
      ...raffleSpotWrites(env, raffle, b.eventId, token, orderId),
    ], tx);
    return { inDraw: !!raffle };
  });
  await audit(env, user, 'COMP_ISSUED', { eventId: b.eventId, orderId, admits, inDraw: res.inDraw, name });
  const link = siteUrl(env, `/ticket.html?token=${token}`);
  const texted = phone ? await sendSms(env, phone, `MEMORIES\n${firstName(name)}, you're on the list for ${ev.fields.name}.\nYour ticket: ${link}`) : false;
  return { token, link, inDraw: res.inDraw, drawRequestedButFull: wantDraw && !res.inDraw, texted };
}

// ── Event booking requests ──
export async function listRequests(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  return { requests: (await listDocs(env, 'private_event_requests')).map(x => ({ id: x.id, ...x.fields })).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) };
}
export async function updatePrivateRequest(env, requestId, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const existing = await getDoc(env, 'private_event_requests', requestId);
  if (!existing) return { error: 'Request not found.', status: 404 };
  const status = ['NEW', 'ACCEPTED', 'DECLINED'].includes(b?.status) ? b.status : existing.fields.status;
  const note = b?.note !== undefined ? clean(b.note, 2000) : (existing.fields.note || '');
  if (status === 'ACCEPTED' && existing.fields.status !== 'ACCEPTED') {
    const clash = (await queryWhere(env, 'private_event_requests', [{ field: 'status', value: 'ACCEPTED' }])).find(r => r.fields.date === existing.fields.date && r.id !== requestId);
    const events = (await listDocs(env, 'events')).find(e => e.fields.active !== false && dateKey(e.fields.date) === existing.fields.date);
    if (clash) return { error: 'Another event is already held on that date.' };
    if (events) return { error: `${events.fields.name} is already on that date.` };
  }
  await setDoc(env, 'private_event_requests', requestId, { ...existing.fields, status, note, updatedAt: now(), updatedBy: uidOf(user) });
  await audit(env, user, 'PRIVATE_REQUEST_UPDATED', { requestId, status, from: existing.fields.status });
  // The guest hears about a real decision once; note edits and repeats send nothing.
  if (status !== existing.fields.status && (status === 'ACCEPTED' || status === 'DECLINED')) {
    const msg = status === 'ACCEPTED'
      ? `MEMORIES\nYour event on ${existing.fields.date} is held. We'll call you to lock in the details.`
      : `MEMORIES\nWe can't hold ${existing.fields.date} for your event. Reply or call us and we'll find another date.`;
    await sendSms(env, existing.fields.phone, msg);
    await sendEmail(env, existing.fields.email, status === 'ACCEPTED' ? 'Your Memories event date is held' : 'About your Memories event booking', msg.split('\n').slice(1));
  }
  return {};
}

// ── Pay-in-bits orders ──
export async function adminInstallments(env, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const plans = await listDocs(env, 'installment_plans');
  return { plans: plans.map(p => { const x = { id: p.id, ...p.fields }; delete x.ticketIds; return x; }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) };
}
export async function resendInstallmentSms(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const plan = await getDoc(env, 'installment_plans', String(b?.planId || ''));
  if (!plan) return { error: 'Order not found.', status: 404 };
  const P = plan.fields;
  const msg = P.status === 'completed'
    ? `MEMORIES\nOrder ${plan.id} is paid in full. Your ticket: ${siteUrl(env, `/ticket.html?token=${(P.ticketIds || [])[0]}`)}`
    : balanceMessage(env, plan.id, 0, Number(P.totalPesewas) - Number(P.paidPesewas || 0));
  const sent = await sendSms(env, P.buyerPhone, msg);
  await audit(env, user, 'INSTALLMENT_SMS_RESENT', { planId: plan.id, sent });
  return sent ? {} : { error: 'The text didn’t send. Check the SMS balance.', status: 502 };
}

// ── Settings ──
export async function updateSettings(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const cur = await getSettings(env);
  const data = {};
  for (const [k, max] of Object.entries(SETTINGS_FIELDS)) if (b?.[k] !== undefined) data[k] = clean(b[k], max);
  if (data.mapUrl && httpsUrl(data.mapUrl, env) === null) return { error: 'Links must start with https://' };
  if (data.heroImage !== undefined && ownImage(data.heroImage, env, cur.heroImage) === null) return { error: 'Upload the hero image here in the control room.' };
  if (b?.defaultLines !== undefined) {
    const lines = (Array.isArray(b.defaultLines) ? b.defaultLines : []).map(l => clean(l, 48)).filter(Boolean);
    if (lines.length > 12) return { error: 'Keep it to 12 lines or fewer.' };
    data.defaultLines = lines;
  }
  if (b?.closedDates !== undefined) data.closedDates = (Array.isArray(b.closedDates) ? b.closedDates : []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 200);
  const next = { ...DEFAULT_SETTINGS, ...cur, ...data, updatedAt: now() };
  await setDoc(env, 'settings', 'site', next);
  await audit(env, user, 'SETTINGS_UPDATED', { fields: Object.keys(data) });
  return { settings: next };
}

// ── Staff ──
export async function listStaff(env, user) {
  if (!requireRole(user, ['superAdmin'])) return FORBIDDEN;
  return { staff: (await listDocs(env, 'users')).map(x => ({ uid: x.id, email: x.fields.email, role: x.fields.role, updatedAt: x.fields.updatedAt })) };
}
async function identity(env, path, body) {
  const token = await googleAccessToken(env, 'https://www.googleapis.com/auth/identitytoolkit');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || 'Identity Toolkit call failed');
  return d;
}
// Staff accounts are created in the Firebase console (public sign-up stays off); this grants or
// removes a role. 'none' strips all claims.
export async function setRole(env, b, user) {
  if (!requireRole(user, ['superAdmin'])) return FORBIDDEN;
  const email = clean(b?.email, 120).toLowerCase(), role = String(b?.role || '');
  if (!email || !(STAFF_ROLES.includes(role) || role === 'none')) return { error: 'A valid email and role are required.' };
  const account = ((await identity(env, 'accounts:lookup', { email: [email] })).users || [])[0];
  if (!account) return { error: 'No account with that email. Create it in Firebase Authentication first.', status: 404 };
  if (account.localId === uidOf(user) && role !== 'superAdmin') return { error: 'You can’t remove your own super admin role.' };
  const claims = role === 'none' ? {} : { role, admin: role === 'superAdmin' };
  await identity(env, 'accounts:update', { localId: account.localId, customAttributes: JSON.stringify(claims) });
  if (role === 'none') await deleteDoc(env, 'users', account.localId).catch(() => {});
  else await setDoc(env, 'users', account.localId, { email, role, admin: claims.admin, updatedAt: now() });
  await audit(env, user, 'ROLE_SET', { targetUid: account.localId, targetEmail: email, role });
  return { uid: account.localId, email, role };
}

// ── Organiser: read-only view of their own nights ──
export async function organiserOverview(env, user) {
  if (!requireRole(user, ['organiser', 'superAdmin'])) return FORBIDDEN;
  const uid = uidOf(user);
  const events = (await listDocs(env, 'events')).filter(e => e.fields.organiserId === uid).sort((a, b) => new Date(b.fields.date) - new Date(a.fields.date));
  const results = [];
  for (const e of events) {
    const [orders, checkins, plans, raffles] = await Promise.all(['orders', 'checkins', 'installment_plans', 'raffles'].map(c => queryWhere(env, c, [{ field: 'eventId', value: e.id }])));
    const confirmed = orders.filter(o => o.fields.status === 'confirmed');
    const ticketOrders = confirmed.filter(o => o.fields.kind === 'ticket');
    const byType = {};
    for (const o of ticketOrders) byType[o.fields.ticketTypeName || 'Ticket'] = (byType[o.fields.ticketTypeName || 'Ticket'] || 0) + Number(o.fields.quantity || 0);
    const active = plans.filter(p => p.fields.status === 'active');
    const r = raffles.find(x => x.fields.enabled === true) || raffles[0];
    results.push({
      eventId: e.id, eventName: e.fields.name, date: e.fields.date, visibility: e.fields.visibility, active: e.fields.active !== false,
      ticketsSold: ticketOrders.reduce((s, o) => s + Number(o.fields.quantity || 0), 0), ticketsSoldByType: byType,
      tablesSold: confirmed.filter(o => o.fields.kind === 'table').length,
      revenuePesewas: confirmed.reduce((s, o) => s + Number(o.fields.amountPesewas || 0), 0),
      moneyOwingPesewas: active.reduce((s, p) => s + Math.max(0, Number(p.fields.totalPesewas || 0) - Number(p.fields.paidPesewas || 0)), 0),
      partialOrdersCount: active.length,
      checkins: checkins.reduce((s, c) => s + Number(c.fields.admits || 1), 0),
      raffle: r ? { prize: r.fields.prize, cap: Number(r.fields.cap) > 0 ? Number(r.fields.cap) : 20, spotsTaken: Number(r.fields.spotsTaken || 0), status: r.fields.status, winner: r.fields.status === 'drawn' ? { name: r.fields.winnerDisplayName || 'Winner', code: r.fields.winnerDisplayCode || '' } : null } : null,
    });
  }
  return { events: results };
}

// Nights a door device can pick from: today's and upcoming ones (organisers: only their own).
export async function doorEvents(env, user) {
  const all = await listDocs(env, 'events');
  const mine = user.role === 'organiser' && user.admin !== true ? all.filter(e => e.fields.organiserId === uidOf(user)) : all;
  return { events: mine.filter(e => e.fields.active !== false && new Date(e.fields.date).getTime() + 12 * 3600e3 > Date.now()).map(e => ({ id: e.id, name: e.fields.name, date: e.fields.date })).sort((a, b) => new Date(a.date) - new Date(b.date)) };
}
