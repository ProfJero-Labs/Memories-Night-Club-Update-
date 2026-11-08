// What to carry over from the old Firebase database to the new Supabase one when the club moves: only the
// club's setup, never anything that was sold or counted.
//
//   COPIED   menu_items (drinks: names, categories, prices), bar_stations (so printed QR cards keep working),
//            users (staff: names, phones, roles; their PINs are dropped, they text themselves a new one),
//            members that belong to staff (so staff still walk in without a ticket),
//            events that haven't happened yet, with their ticket_types, table_packages and bottles.
//   NOT COPIED   tabs, rounds, orders, tickets, payments, ledger, wallet payments, cash, stock moves and
//            counts, expenses, payroll, reviews, logs: all the test sales and counts. (Stock starts from an
//            opening count on the new database.)
//
// planSetupCopy reads (through the two readers it is given, so it can be tested without a database) and
// returns what it would write; nothing is written here.
export const PIN_FIELDS = ['pinHash', 'pinSalt', 'pinSetAt', 'pinStarter', 'pinFails', 'lockedUntil', 'pinLocked', 'tempPinHash', 'tempPinSalt', 'tempPinExpires', 'pinSentAt', 'sessionsFrom', 'lastSignInAt'];
const EVENT_GRACE_MS = 8 * 3600e3; // a night counts as upcoming until 8 hours after it starts (like the site)

export async function planSetupCopy({ listDocs, queryWhere }, { keepPins = false, withSettings = false, now = Date.now() } = {}) {
  const plan = [], notes = [];
  const add = (col, docs, label, map = f => f) => { for (const d of docs) plan.push({ col, id: d.id, fields: map(d.fields), label: label(d.fields) }); };

  add('menu_items', await listDocs('menu_items'), f => `${f.name || '(no name)'}${f.category ? ` · ${f.category}` : ''}${f.pricePesewas ? ` · GHS ${(f.pricePesewas / 100).toFixed(2)}` : ''}`);
  add('bar_stations', await listDocs('bar_stations'), f => f.name || '(bar)');

  const users = (await listDocs('users')).filter(d => d.fields.removed !== true);
  add('users', users, f => `${f.name || '(no name)'} · ${f.admin === true ? 'superAdmin' : f.role || 'no role'} · ${f.phone || 'no phone'}`,
    f => (keepPins ? f : Object.fromEntries(Object.entries(f).filter(([k]) => !PIN_FIELDS.includes(k)))));
  const staffIds = new Set(users.map(d => d.id));
  add('members', (await listDocs('members')).filter(m => m.fields.staffUid && staffIds.has(m.fields.staffUid)), f => `${f.name || '(staff member)'} (staff pass)`);

  const events = (await listDocs('events')).filter(e => e.fields.date && e.fields.active !== false && new Date(e.fields.date).getTime() + EVENT_GRACE_MS > now);
  add('events', events, f => `${f.name || '(event)'} · ${String(f.date).slice(0, 16).replace('T', ' ')}`);
  let sawAllBottles = false;
  for (const e of events) {
    add('ticket_types', await queryWhere('ticket_types', [{ field: 'eventId', value: e.id }]), f => `${f.name || '(ticket)'} · GHS ${((f.pricePesewas || 0) / 100).toFixed(2)} · ${typeof f.remaining === 'number' ? `${f.remaining} left` : 'no limit'} (${e.fields.name})`);
    add('table_packages', await queryWhere('table_packages', [{ field: 'eventId', value: e.id }]), f => `${f.name || '(table)'} · GHS ${((f.pricePesewas || 0) / 100).toFixed(2)} · ${typeof f.remaining === 'number' ? `${f.remaining} left` : 'no limit'} (${e.fields.name})`);
    add('bottles', await queryWhere('bottles', [{ field: 'eventId', value: e.id }]), f => `${f.name || '(bottle)'} · GHS ${((f.pricePesewas || 0) / 100).toFixed(2)} (${e.fields.name})`);
    if (!sawAllBottles) { sawAllBottles = true; add('bottles', await queryWhere('bottles', [{ field: 'eventId', value: 'all' }]), f => `${f.name || '(bottle)'} · every night`); }
  }
  if (!events.length) notes.push('No upcoming event was found (an event with a date still ahead that is switched on).');
  if (withSettings) add('settings', [{ id: 'site', fields: (await listDocs('settings')).find(d => d.id === 'site')?.fields }].filter(d => d.fields), () => 'the club details (venue, phones, social links)');
  // "Left" counts were reduced by test sales: say so, so they're checked before tickets go on sale.
  if (plan.some(p => (p.col === 'ticket_types' || p.col === 'table_packages') && typeof p.fields.remaining === 'number')) notes.push('"left" on tickets and tables is what the old database shows now (test sales may have reduced it): check those numbers in the admin before tickets go on sale.');
  return { plan, notes };
}

// How many of each kind, for the summary and the check after writing.
export const countsOf = plan => plan.reduce((o, p) => { o[p.col] = (o[p.col] || 0) + 1; return o; }, {});
