// Tickets and table bookings, for the people running the night.
//   ticketsTonight: tickets sold for the night (online and at the gate, by type and how they were
//     paid), tables booked, and how many came in. For the Manager, the front office, the Event
//     manager and finance.
//   findOrder: any ticket or table order, by its code (TBL-…, a ticket code, the payment reference),
//     the customer's phone or their name: everything about it in one place (the night, what was
//     bought, bottles, paid how, arrived, table number). Phones show only the last four digits.
import { listDocs, queryWhere, queryRecent, getDoc } from '../lib/firestore.js';
import { nightKey, normalizePhone, tableCode } from '../lib/util.js';
import { requireRole } from '../lib/auth.js';
import { FORBIDDEN, dateOr } from './common.js';

export const TICKET_DESK = ['superAdmin', 'manager', 'eventManager', 'doorStaff', 'finance', 'hrManager'];
export const ORDER_FINDERS = ['superAdmin', 'director', 'manager', 'hrManager', 'eventManager', 'doorStaff', 'security', 'finance', 'barManager'];
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);

export async function ticketsTonight(env, user, { date } = {}) {
  if (!requireRole(user, TICKET_DESK)) return FORBIDDEN;
  const d = dateOr(date);
  const events = (await listDocs(env, 'events')).filter(e => e.fields.date && nightKey(e.fields.date) === d);
  const nights = [];
  for (const e of events) {
    const [orders, checkins] = await Promise.all([queryWhere(env, 'orders', [{ field: 'eventId', value: e.id }]), queryWhere(env, 'checkins', [{ field: 'eventId', value: e.id }])]);
    const paid = orders.map(o => o.fields).filter(o => o.status === 'confirmed');
    const tickets = paid.filter(o => o.kind !== 'table'), tables = paid.filter(o => o.kind === 'table');
    const gate = tickets.filter(o => o.channel === 'gate'), online = tickets.filter(o => o.channel !== 'gate' && o.kind !== 'comp');
    const comps = tickets.filter(o => o.kind === 'comp');
    const qty = xs => sum(xs, o => o.quantity || 1);
    const types = new Map();
    for (const o of tickets.filter(x => x.kind !== 'comp')) { const k = o.ticketTypeName || o.type || 'Ticket'; const t = types.get(k) || { name: k, sold: 0, valuePesewas: 0 }; t.sold += Number(o.quantity || 1); t.valuePesewas += Number(o.amountPesewas || 0); types.set(k, t); }
    const sellers = new Map();
    for (const o of gate) { const k = o.soldByName || 'Front office'; const s = sellers.get(k) || { name: k, tickets: 0, cashPesewas: 0, momoPesewas: 0 }; s.tickets += Number(o.quantity || 1); s[o.paidWith === 'momo' ? 'momoPesewas' : 'cashPesewas'] += Number(o.amountPesewas || 0); sellers.set(k, s); }
    const ci = checkins.map(c => c.fields).filter(c => !c.undoneAt);
    nights.push({
      eventId: e.id, name: e.fields.name || 'Night', date: e.fields.date,
      ticketsSold: qty(tickets.filter(o => o.kind !== 'comp')), ticketsValuePesewas: sum(tickets.filter(o => o.kind !== 'comp'), o => o.amountPesewas),
      online: { tickets: qty(online), valuePesewas: sum(online, o => o.amountPesewas) },
      gate: { tickets: qty(gate), cashPesewas: sum(gate.filter(o => o.paidWith !== 'momo'), o => o.amountPesewas), momoPesewas: sum(gate.filter(o => o.paidWith === 'momo'), o => o.amountPesewas), sellers: [...sellers.values()] },
      guestList: qty(comps), byType: [...types.values()].sort((a, b) => b.sold - a.sold),
      tables: { booked: tables.length, valuePesewas: sum(tables, o => o.amountPesewas), atGate: tables.filter(o => o.channel === 'gate').length, arrived: tables.filter(o => o.arrivedAt).length },
      cameIn: sum(ci, c => c.admits || 1),
    });
  }
  const t = k => sum(nights, n => k(n));
  return { date: d, nights, totals: { ticketsSold: t(n => n.ticketsSold), valuePesewas: t(n => n.ticketsValuePesewas) + t(n => n.tables.valuePesewas), gateCashPesewas: t(n => n.gate.cashPesewas), gateMomoPesewas: t(n => n.gate.momoPesewas), onlinePesewas: t(n => n.online.valuePesewas), tablesBooked: t(n => n.tables.booked), cameIn: t(n => n.cameIn) } };
}

// ── Find an order: code, phone or name ──
export async function findOrder(env, user, q) {
  if (!requireRole(user, ORDER_FINDERS)) return FORBIDDEN;
  const raw = String(q || '').trim();
  if (raw.length < 3) return { error: 'Type at least 3 letters or numbers: the code (TBL-…), the phone number, or the name.' };
  const code = raw.toUpperCase().replace(/\s+/g, ''), phone = normalizePhone(raw), name = raw.toLowerCase();
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  const recent = (await queryRecent(env, 'orders', 'createdAt', since, 5000)).map(o => ({ id: o.id, ...o.fields }));
  let hits = [];
  const tbl = /^TBL-?([0-9A-Z]{4,})$/.exec(code);
  if (tbl) hits = recent.filter(o => tableCode(o.id) === `TBL-${tbl[1].slice(0, 6)}` || o.id.toUpperCase().startsWith(tbl[1]));
  if (!hits.length && phone) hits = recent.filter(o => o.buyerPhone === phone);
  if (!hits.length && /^[0-9A-Z-]{5,}$/.test(code)) {
    hits = recent.filter(o => String(o.reference || '').toUpperCase() === code || o.id.toUpperCase() === code || (o.ticketIds || []).some(t => t.toUpperCase().startsWith(code.replace(/^MEM-/, ''))));
    if (!hits.length) {
      const byCode = (await queryWhere(env, 'tickets', [{ field: 'displayCode', value: code }], { limit: 3 }))[0];
      if (byCode?.fields?.reference) hits = recent.filter(o => o.reference === byCode.fields.reference);
    }
  }
  if (!hits.length && /[a-z]/.test(name)) hits = recent.filter(o => String(o.buyerName || '').toLowerCase().includes(name));
  hits = hits.filter(o => ['confirmed', 'sold', 'held'].includes(o.status) || o.kind === 'table').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 15);
  const events = new Map();
  const out = [];
  for (const o of hits) {
    if (o.eventId && !events.has(o.eventId)) events.set(o.eventId, (await getDoc(env, 'events', o.eventId))?.fields || null);
    const ev = events.get(o.eventId);
    out.push({
      id: o.id, kind: o.kind === 'table' ? 'table' : o.kind === 'comp' ? 'guest list' : 'ticket', code: o.kind === 'table' ? tableCode(o.id) : (o.reference || o.id),
      status: o.status, night: ev?.name || o.eventName || '', nightDate: ev?.date || '',
      name: o.buyerName || '', phoneLast4: String(o.buyerPhone || '').slice(-4),
      what: o.kind === 'table' ? (o.packageName || 'Table') : `${o.quantity || 1} × ${o.ticketTypeName || 'Ticket'}`,
      bottles: (o.bottles || []).map(b => ({ name: b.name, quantity: b.quantity })),
      amountPesewas: Number(o.amountPesewas || 0), paid: o.channel === 'gate' ? `At the gate (${o.paidWith === 'momo' ? 'MoMo' : 'cash'}${o.soldByName ? `, by ${o.soldByName}` : ''})` : o.kind === 'comp' ? 'Guest list (free)' : o.paidInInstallments ? 'Online, paid in bits' : 'Online (Paystack)',
      promo: o.promo?.name ? `${o.promo.name}${o.promo.label ? ` (${o.promo.label})` : ''}` : '',
      bookedAt: o.createdAt || '', arrived: !!o.arrivedAt, arrivedAt: o.arrivedAt || '', tableNumber: o.tableNumber || '', guestsArrived: Number(o.guestsArrived || 0), bottlesServed: o.bottlesServed === true,
      tickets: (o.ticketIds || []).length,
    });
  }
  return { query: raw, orders: out };
}
