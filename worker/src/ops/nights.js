// The nights coming up, for the managers (and anyone running the floor): what's on, when the doors
// open, tickets sold and left per type, and tables booked. Read only: the website and the nights are
// changed by Media and the administrator, in the control room.
import { listDocs, queryWhere } from '../lib/firestore.js';
import { requireRole, NIGHTS_VIEW } from '../lib/auth.js';
import { FORBIDDEN } from './common.js';

export async function upcomingNights(env, user) {
  if (!requireRole(user, NIGHTS_VIEW)) return FORBIDDEN;
  const since = Date.now() - 12 * 3600e3; // tonight still shows until the morning after
  const events = (await listDocs(env, 'events')).filter(e => e.fields.date && new Date(e.fields.date).getTime() >= since && e.fields.active !== false)
    .sort((a, b) => new Date(a.fields.date) - new Date(b.fields.date)).slice(0, 12);
  const nights = [];
  for (const e of events) {
    const [types, packages, orders] = await Promise.all([
      queryWhere(env, 'ticket_types', [{ field: 'eventId', value: e.id }]),
      queryWhere(env, 'table_packages', [{ field: 'eventId', value: e.id }]),
      queryWhere(env, 'orders', [{ field: 'eventId', value: e.id }]),
    ]);
    const paid = orders.map(o => o.fields).filter(o => o.status === 'confirmed');
    const soldOf = tid => paid.filter(o => o.kind !== 'table' && o.ticketTypeId === tid).reduce((n, o) => n + Number(o.quantity || 0), 0);
    nights.push({
      id: e.id, name: e.fields.name || 'Night', date: e.fields.date, doors: e.fields.doors || '', venue: e.fields.venue || '',
      onSite: e.fields.visibility === 'public',
      tickets: types.filter(t => t.fields.active !== false).map(t => ({ name: t.fields.name || 'Ticket', pricePesewas: Number(t.fields.pricePesewas || 0), sold: soldOf(t.id), left: typeof t.fields.remaining === 'number' ? t.fields.remaining : null })),
      ticketsSold: paid.filter(o => o.kind !== 'table').reduce((n, o) => n + Number(o.quantity || 0), 0),
      tablesBooked: paid.filter(o => o.kind === 'table').length, tablePackages: packages.filter(p => p.fields.active !== false).length,
    });
  }
  return { nights };
}
