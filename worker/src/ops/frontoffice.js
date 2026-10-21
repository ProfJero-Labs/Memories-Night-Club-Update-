// Front office and security: tonight's table bookings (arrivals, bottles to serve), incidents and
// handovers. No money reports, no stock.
//   incidents/{id}  businessDate, kind, note, people, status open|handed_over|resolved, by, byName,
//                   at, updates[{note, status, byName, at}]
import { getDoc, setDoc, queryWhere, listDocs } from '../lib/firestore.js';
import { now, id, clean, nightKey, firstName } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, bizDate, dateOr, who, audit } from './common.js';
import { tableCode } from '../lib/util.js';

const FRONT = ['superAdmin', 'director', 'manager', 'hrManager', 'eventManager', 'doorStaff', 'security'];
export const INCIDENT_KINDS = { fight: 'Fight or threat', refused: 'Refused entry', id: 'ID / age problem', fake_ticket: 'Fake or used ticket', lost: 'Lost or found item', medical: 'Medical', customer: 'Customer complaint', booking: 'Booking or payment problem', other: 'Other' };

// Tonight's table bookings: who, which table package, how many people, bottles already paid for.
// Waiters see it too, so the bottles a table booked get served.
export async function tablesTonight(env, user, { date } = {}) {
  if (!requireRole(user, [...FRONT, 'waitStaff', 'barStaff'])) return FORBIDDEN;
  const d = dateOr(date);
  const events = (await listDocs(env, 'events')).filter(e => e.fields.date && nightKey(e.fields.date) === d);
  const out = [];
  for (const e of events) {
    const orders = (await queryWhere(env, 'orders', [{ field: 'eventId', value: e.id }, { field: 'kind', value: 'table' }])).filter(o => o.fields.status === 'confirmed');
    for (const o of orders) {
      const pkg = o.fields.packageId ? await getDoc(env, 'table_packages', o.fields.packageId) : null;
      out.push({ orderId: o.id, code: tableCode(o.id), eventName: e.fields.name, name: o.fields.buyerName, firstName: firstName(o.fields.buyerName), phoneLast4: String(o.fields.buyerPhone || '').slice(-4),
        packageName: o.fields.packageName, capacity: Number(pkg?.fields?.capacity || 0), bottles: (o.fields.bottles || []).map(b => ({ name: b.name, quantity: b.quantity })),
        arrived: !!o.fields.arrivedAt, arrivedAt: o.fields.arrivedAt || null, guestsArrived: Number(o.fields.guestsArrived || 0), tableNumber: o.fields.tableNumber || '', bottlesServed: o.fields.bottlesServed === true });
    }
  }
  return { date: d, tables: out.sort((a, b) => Number(a.arrived) - Number(b.arrived) || a.name.localeCompare(b.name)) };
}

// Front office assigns or confirms a table number and how many arrived; waiters tick bottles served.
export async function updateTableBooking(env, b, user) {
  const o = await getDoc(env, 'orders', String(b?.orderId || ''));
  if (!o || o.fields.kind !== 'table') return { error: 'Booking not found.', status: 404 };
  const f = { ...o.fields };
  if (b.bottlesServed !== undefined) { if (!requireRole(user, [...FRONT, 'waitStaff', 'barStaff'])) return FORBIDDEN; f.bottlesServed = b.bottlesServed === true; f.bottlesServedByName = user.name || ''; f.bottlesServedAt = now(); }
  if (b.tableNumber !== undefined || b.guestsArrived !== undefined) {
    if (!requireRole(user, FRONT)) return FORBIDDEN;
    if (b.tableNumber !== undefined) f.tableNumber = clean(b.tableNumber, 20);
    if (b.guestsArrived !== undefined) { const n = Number(b.guestsArrived); if (!(Number.isInteger(n) && n >= 0 && n <= 50)) return { error: 'How many arrived? A number.' }; f.guestsArrived = n; }
  }
  await setDoc(env, 'orders', o.id, f);
  await audit(env, user, 'TABLE_BOOKING_UPDATED', { orderId: o.id, tableNumber: f.tableNumber || '', guestsArrived: f.guestsArrived ?? null, bottlesServed: f.bottlesServed ?? null });
  return { saved: true };
}

// ── Incidents ──
export async function addIncident(env, b, user) {
  if (!requireRole(user, FRONT)) return FORBIDDEN;
  if (!INCIDENT_KINDS[b?.kind]) return { error: 'Pick what happened.' };
  const note = clean(b.note, 600); if (!note) return { error: 'Write what happened, in a few words.' };
  const iid = id();
  await setDoc(env, 'incidents', iid, { businessDate: bizDate(), kind: b.kind, note, people: clean(b.people, 200), needsManager: b.needsManager === true, status: 'open', ...who(user), at: now(), updates: [] });
  await audit(env, user, 'INCIDENT_RECORDED', { incidentId: iid, kind: b.kind });
  return { id: iid };
}
export async function listIncidents(env, user, { date } = {}) {
  if (!requireRole(user, FRONT)) return FORBIDDEN;
  const d = dateOr(date);
  const tonight = await queryWhere(env, 'incidents', [{ field: 'businessDate', value: d }]);
  const open = (await queryWhere(env, 'incidents', [{ field: 'status', value: 'open' }])).concat(await queryWhere(env, 'incidents', [{ field: 'status', value: 'handed_over' }]));
  const all = [...new Map([...tonight, ...open].map(x => [x.id, { id: x.id, ...x.fields, label: INCIDENT_KINDS[x.fields.kind] }])).values()];
  return { incidents: all.sort((a, b) => String(b.at).localeCompare(String(a.at))), kinds: INCIDENT_KINDS };
}
export async function updateIncident(env, b, user) {
  if (!requireRole(user, FRONT)) return FORBIDDEN;
  const x = await getDoc(env, 'incidents', String(b?.id || ''));
  if (!x) return { error: 'Not found.', status: 404 };
  const status = ['open', 'handed_over', 'resolved'].includes(b.status) ? b.status : x.fields.status;
  const note = clean(b.note, 400);
  if (!note) return { error: status === 'handed_over' ? 'Write what the next shift needs to know.' : 'Add a short note.' };
  await setDoc(env, 'incidents', x.id, { ...x.fields, status, updates: [...(x.fields.updates || []), { note, status, byName: user.name || '', by: uidOf(user), at: now() }] });
  return { saved: true };
}
