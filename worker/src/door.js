// Door check-in: the QR carries only a verify URL with the ticket token; the scanner sends the
// token here and the ticket is marked used inside a transaction, so a second scan always fails.
import { getDoc, batchGet, commitTx, updateWrite, parseFields, withTransaction } from './lib/firestore.js';
import { now, id, firstName } from './lib/util.js';
import { requireRole, uidOf } from './lib/auth.js';

export const tokenFrom = raw => {
  const s = String(raw || '').trim();
  try { const u = new URL(s); return u.searchParams.get('token') || ''; } catch { return s; }
};

export async function checkin(env, rawToken, user, { eventId } = {}) {
  const token = tokenFrom(rawToken);
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
