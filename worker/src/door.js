// Door check-in: the QR carries only a verify URL with the ticket token; the scanner sends the
// token here and the ticket is marked used inside a transaction, so a second scan always fails.
import { getDoc, batchGet, commitTx, updateWrite, parseFields, withTransaction, queryWhere } from './lib/firestore.js';
import { now, id, firstName, tableCode } from './lib/util.js';
import { requireRole, uidOf } from './lib/auth.js';

export const tokenFrom = raw => {
  const s = String(raw || '').trim();
  try { const u = new URL(s); return u.searchParams.get('token') || ''; } catch { return s; }
};

// Door staff can only admit against a chosen night: no "any night" mode on the server either.
// A ticket is identified by its token (scan / pasted link) or, from door search, by its display
// code within that night, so search results never need to carry the token.
export async function checkin(env, rawToken, user, { eventId, code } = {}) {
  if (!eventId) return { valid: false, code: 'no_event', message: 'PICK TONIGHT’S NIGHT FIRST' };
  let token = tokenFrom(rawToken);
  if (!token && code) {
    const hit = (await queryWhere(env, 'tickets', [{ field: 'eventId', value: String(eventId) }])).find(t => t.fields.displayCode === String(code).toUpperCase());
    if (!hit) return { valid: false, code: 'invalid', message: 'TICKET NOT VALID' };
    token = hit.id;
  }
  if (!/^[0-9A-Za-z_-]{1,100}$/.test(token)) return { valid: false, code: 'invalid', message: 'TICKET NOT VALID' };
  // Organisers may only check in tickets for their own nights.
  let organiserEvents = null;
  if (!requireRole(user, ['superAdmin', 'manager', 'eventManager', 'doorStaff'])) {
    if (user?.role !== 'organiser') return { valid: false, code: 'forbidden', message: 'NOT ALLOWED' };
    organiserEvents = true;
  }
  return withTransaction(env, async tx => {
    const f = (await batchGet(env, [`tickets/${token}`], tx)).find(x => x.found)?.found;
    if (!f) return { valid: false, code: 'invalid', message: 'TICKET NOT VALID' };
    const t = parseFields(f.fields);
    const summary = { firstName: firstName(t.customerName), eventName: t.eventName, type: t.type, admits: Number(t.admitCount || 1), displayCode: t.displayCode, comp: t.comp === true };
    if (organiserEvents) {
      const ev = await getDoc(env, 'events', t.eventId);
      if (!ev || ev.fields.organiserId !== uidOf(user)) return { valid: false, code: 'forbidden', message: 'NOT YOUR NIGHT', ticket: { eventName: t.eventName } };
    }
    if (eventId && t.eventId !== eventId) return { valid: false, code: 'wrong_night', message: 'WRONG NIGHT', ticket: summary };
    if (t.revoked || t.cancelled) return { valid: false, code: 'cancelled', message: 'TICKET CANCELLED', ticket: summary };
    if (t.status === 'used') return { valid: false, code: 'used', message: 'ALREADY CHECKED IN', ticket: { ...summary, checkedInAt: t.checkedInAt } };
    const when = now();
    await commitTx(env, [
      updateWrite(env, 'tickets', token, { ...t, status: 'used', checkedInAt: when, checkedInBy: uidOf(user) }),
      updateWrite(env, 'checkins', id(), { ticketId: token, eventId: t.eventId, admits: summary.admits, checkedInAt: when, checkedInBy: uidOf(user) }),
    ], tx);
    return { valid: true, code: 'ok', message: 'ENTRY CONFIRMED', ticket: summary };
  });
}

// Public check of a ticket's state (what the QR's URL opens on a guest's own phone).
export async function verifyTicket(env, rawToken) {
  const token = tokenFrom(rawToken);
  const d = /^[0-9A-Za-z_-]{1,100}$/.test(token) ? await getDoc(env, 'tickets', token) : null;
  if (!d) return { valid: false, code: 'invalid', message: 'THIS TICKET ISN’T VALID.' };
  const t = d.fields;
  if (t.revoked || t.cancelled) return { valid: false, code: 'cancelled', message: 'THIS TICKET WAS CANCELLED.' };
  if (t.status === 'used') return { valid: false, code: 'used', message: 'THIS TICKET HAS ALREADY BEEN USED.', ticket: { eventName: t.eventName, firstName: firstName(t.customerName), displayCode: t.displayCode } };
  return { valid: true, code: 'ok', message: 'VALID TICKET', ticket: { eventName: t.eventName, firstName: firstName(t.customerName), displayCode: t.displayCode, admits: Number(t.admitCount || 1) } };
}

// Is this staff member allowed to see this night at the door?
async function doorNight(env, user, eventId) {
  const ev = eventId ? await getDoc(env, 'events', String(eventId)) : null;
  if (!ev) return null;
  if (!requireRole(user, ['superAdmin', 'manager', 'eventManager', 'doorStaff']) && ev.fields.organiserId !== uidOf(user)) return null;
  return ev;
}

// The real headcount for a night, from the tickets themselves (every phone at the door sees the
// same numbers). admitted/expected count people (a ticket can admit more than one).
export async function doorSummary(env, user, eventId) {
  const ev = await doorNight(env, user, eventId); if (!ev) return { error: 'Not your night.', status: 403 };
  const tickets = (await queryWhere(env, 'tickets', [{ field: 'eventId', value: ev.id }])).map(t => t.fields).filter(t => !t.revoked && !t.cancelled);
  const heads = list => list.reduce((n, t) => n + Number(t.admitCount || 1), 0);
  return { eventId: ev.id, admitted: heads(tickets.filter(t => t.status === 'used')), expected: heads(tickets), comps: heads(tickets.filter(t => t.comp === true)), tickets: tickets.length };
}

// A table booking arriving: found in door search (name, last 4 digits, TBL- code), seated once.
export async function seatTable(env, user, eventId, code) {
  const ev = await doorNight(env, user, eventId); if (!ev) return { valid: false, code: 'forbidden', message: 'NOT YOUR NIGHT' };
  const want = String(code || '').toUpperCase();
  const hit = (await queryWhere(env, 'orders', [{ field: 'eventId', value: ev.id }, { field: 'kind', value: 'table' }])).find(o => tableCode(o.id) === want && o.fields.status === 'confirmed');
  if (!hit) return { valid: false, code: 'invalid', message: 'TABLE NOT FOUND' };
  return withTransaction(env, async tx => {
    const f = (await batchGet(env, [`orders/${hit.id}`], tx)).find(x => x.found)?.found;
    const o = parseFields(f.fields);
    const summary = { firstName: firstName(o.buyerName), eventName: o.eventName, type: o.packageName || 'Table', displayCode: tableCode(hit.id), table: true };
    if (o.arrivedAt) return { valid: false, code: 'table_used', message: 'TABLE ALREADY SEATED', ticket: { ...summary, checkedInAt: o.arrivedAt } };
    const when = now();
    await commitTx(env, [updateWrite(env, 'orders', hit.id, { ...o, arrivedAt: when, arrivedBy: uidOf(user) })], tx);
    return { valid: true, code: 'seated', message: 'TABLE SEATED', ticket: summary };
  });
}

// Find a guest at the door by first name, ticket code or the last 4 digits of their phone.
// Returns what the door needs to recognise them; never the token or the full phone number.
// Table bookings for the night come back too, marked as tables.
export async function doorSearch(env, user, eventId, q) {
  const ev = await doorNight(env, user, eventId); if (!ev) return { error: 'Not your night.', status: 403 };
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return { results: [] };
  const code = s.replace(/^mem-?/, ''), tcode = s.replace(/^tbl-?/, '');
  const tables = (await queryWhere(env, 'orders', [{ field: 'eventId', value: ev.id }, { field: 'kind', value: 'table' }]))
    .filter(o => o.fields.status === 'confirmed')
    .filter(o => String(o.fields.buyerName || '').toLowerCase().includes(s) || (/^\d{4}$/.test(s) && String(o.fields.buyerPhone || '').slice(-4) === s)
      || (tcode.length >= 3 && tableCode(o.id).toLowerCase().replace(/^tbl-/, '').startsWith(tcode)))
    .slice(0, 10)
    .map(o => ({ table: true, code: tableCode(o.id), firstName: firstName(o.fields.buyerName), phoneLast4: String(o.fields.buyerPhone || '').slice(-4), type: o.fields.packageName || 'Table', admits: 1, status: o.fields.arrivedAt ? 'used' : 'valid' }));
  const results = (await queryWhere(env, 'tickets', [{ field: 'eventId', value: ev.id }])).map(t => t.fields)
    .filter(t => firstName(t.customerName).toLowerCase().startsWith(s) || String(t.customerName || '').toLowerCase().includes(s)
      || (code.length >= 3 && String(t.displayCode || '').toLowerCase().replace(/^mem-/, '').startsWith(code))
      || (/^\d{4}$/.test(s) && t.phoneLast4 === s))
    .slice(0, 20)
    .map(t => ({ code: t.displayCode, firstName: firstName(t.customerName), phoneLast4: t.phoneLast4 || '', type: t.type || '', admits: Number(t.admitCount || 1), status: t.revoked || t.cancelled ? 'cancelled' : t.status, comp: t.comp === true }));
  return { results: [...tables, ...results] };
}
