import { getDoc, listDocs, queryWhere, setDoc } from './lib/firestore.js';
import { now, id, clean, dateKey, normalizePhone, validEmail, firstName, cleanTicketColors } from './lib/util.js';
import { sendEmail } from './lib/notify.js';

// ── Site settings: the one place contact details and venue copy live ──
// Unknown production values (phone, email, map) default to empty and simply don't render until an
// admin fills them in. Venue, nights, doors, WhatsApp and the social handles come from the club.
// A field saved blank falls back to its default.
export const DEFAULT_SETTINGS = {
  venue: 'SamRit Hotel, Cape Coast', address: '', nightsLine: 'Friday + Saturday', doorsLine: 'Doors 10PM',
  phone: '', whatsapp: '0249050086', email: '', instagram: '@memoriesnightclub.gh', facebook: 'memoriesnightclub.gh', tiktok: '@memoriesnightclub.gh', mapUrl: '',
  heroImage: '', defaultLines: [], closedDates: [],
};
export const SETTINGS_FIELDS = { venue: 120, address: 200, nightsLine: 60, doorsLine: 60, phone: 30, whatsapp: 30, email: 120, instagram: 60, facebook: 60, tiktok: 60, mapUrl: 500, heroImage: 500 };

export async function getSettings(env) {
  const d = await getDoc(env, 'settings', 'site');
  const saved = Object.fromEntries(Object.entries(d?.fields || {}).filter(([, v]) => v !== ''));
  return { ...DEFAULT_SETTINGS, ...saved };
}

// An event's selectable "what should others know?" lines: the night's own list, else the site-wide
// default list, else none (the ticket then leads with the event name — no placeholder copy ships).
export const resolveLines = (event, settings) => {
  const own = (event?.ticketLines || []).filter(Boolean);
  return own.length ? own : (settings?.defaultLines || []).filter(Boolean);
};

const isLive = e => e && e.visibility === 'public' && e.active !== false;
// The night is still on sale until 8h after its start time (doors 10PM → sales close ~6AM).
export const isOver = e => new Date(e.date).getTime() + 8 * 3600e3 < Date.now();

export function publicEvent(id, f, settings) {
  return {
    id, name: f.name || '', date: f.date, doors: f.doors || '', venue: f.venue || settings?.venue || '',
    artwork: f.artwork || '', heroImage: f.heroImage || '', description: clean(f.description, 240),
    soldOut: f.soldOut === true, featured: f.featured === true,
    ticketStyle: f.ticketStyle || 'auto', ticketColors: cleanTicketColors(f.ticketColors),
  };
}

export async function publicEvents(env) {
  const [docs, settings] = await Promise.all([listDocs(env, 'events'), getSettings(env)]);
  return docs.filter(x => isLive(x.fields) && !isOver(x.fields))
    .map(x => publicEvent(x.id, x.fields, settings))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

export async function eventBundle(env, eventId) {
  const e = await getDoc(env, 'events', eventId);
  if (!e || !isLive(e.fields)) return null;
  const [tickets, tables, bottles, globalBottles, raffles, settings] = await Promise.all([
    queryWhere(env, 'ticket_types', [{ field: 'eventId', value: eventId }]),
    queryWhere(env, 'table_packages', [{ field: 'eventId', value: eventId }]),
    queryWhere(env, 'bottles', [{ field: 'eventId', value: eventId }]),
    queryWhere(env, 'bottles', [{ field: 'eventId', value: 'all' }]),
    queryWhere(env, 'raffles', [{ field: 'eventId', value: eventId }]),
    getSettings(env),
  ]);
  const stock = f => (typeof f.remaining === 'number' ? { soldOut: f.remaining <= 0, lastFew: f.remaining > 0 && f.remaining <= 10 } : { soldOut: false, lastFew: false });
  const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.pricePesewas - b.pricePesewas;
  const raffle = raffles.find(x => x.fields.public === true && x.fields.enabled === true);
  return {
    event: { ...publicEvent(eventId, e.fields, settings), over: isOver(e.fields) },
    lines: resolveLines(e.fields, settings),
    ticketTypes: tickets.filter(x => x.fields.active === true).map(x => ({ id: x.id, name: x.fields.name, pricePesewas: Number(x.fields.pricePesewas || 0), admits: Number(x.fields.admits || 1), description: clean(x.fields.description, 140), sortOrder: x.fields.sortOrder ?? 0, ...stock(x.fields) })).sort(bySort),
    tablePackages: tables.filter(x => x.fields.active === true).map(x => ({ id: x.id, name: x.fields.name, pricePesewas: Number(x.fields.pricePesewas || 0), capacity: Number(x.fields.capacity || 0), includes: clean(x.fields.description, 200), sortOrder: x.fields.sortOrder ?? 0, ...stock(x.fields) })).sort(bySort),
    bottles: [...bottles, ...globalBottles].filter(x => x.fields.active === true).map(x => ({ id: x.id, name: x.fields.name, category: x.fields.category || '', pricePesewas: Number(x.fields.pricePesewas || 0), ...stock(x.fields) })).sort((a, b) => a.category.localeCompare(b.category) || a.pricePesewas - b.pricePesewas),
    // Whitelisted: a drawn raffle's raw ticket id is a bearer token and never leaves the server.
    raffle: raffle ? {
      prize: raffle.fields.prize || '', status: raffle.fields.status || 'open',
      cap: Number(raffle.fields.cap) > 0 ? Number(raffle.fields.cap) : 20, spotsTaken: Number(raffle.fields.spotsTaken || 0),
      winner: raffle.fields.status === 'drawn' ? { name: raffle.fields.winnerDisplayName || 'Winner', code: raffle.fields.winnerDisplayCode || '' } : null,
    } : null,
  };
}

// ── Calendar: every Friday and Saturday exists as a slot, whether or not a night is booked ──
export async function calendar(env, weeks = 10) {
  const [events, held, settings] = await Promise.all([
    listDocs(env, 'events'),
    queryWhere(env, 'private_event_requests', [{ field: 'status', value: 'ACCEPTED' }]),
    getSettings(env),
  ]);
  const byDate = new Map();
  for (const e of events) {
    if (e.fields.active === false) continue;
    const k = dateKey(e.fields.date); if (!k) continue;
    const cur = byDate.get(k);
    if (e.fields.visibility === 'public') { if (!cur || cur.state !== 'event') byDate.set(k, { state: 'event', eventId: e.id, name: e.fields.name || '' }); }
    else if (!cur) byDate.set(k, { state: 'held' });
  }
  for (const r of held) { const k = r.fields.date; if (k && !byDate.has(k)) byDate.set(k, { state: 'held' }); }
  const closed = new Set(settings.closedDates || []);
  const days = [];
  const start = new Date(dateKey(now()) + 'T00:00:00Z');
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start.getTime() + i * 864e5), k = dateKey(d), dow = d.getUTCDay();
    const hit = byDate.get(k);
    if (hit) days.push({ date: k, ...hit });
    else if (dow === 5 || dow === 6) days.push({ date: k, state: closed.has(k) ? 'unavailable' : 'open' });
  }
  return { days };
}

// ── Event booking requests ("Book an event") ──
export const PRIVATE_TYPES = ['Corporate', 'Event organiser', 'Large group', 'Other'];
// Older types stay accepted so a page cached from before the rename doesn't fail.
const LEGACY_TYPES = ['Birthday', 'Concert', 'Private celebration'];
export async function createPrivateRequest(env, b) {
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone);
  const eventType = [...PRIVATE_TYPES, ...LEGACY_TYPES].includes(b?.eventType) ? b.eventType : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b?.date || '') ? b.date : null;
  const guests = Number(b?.guests);
  if (!eventType) return { error: 'Pick what you are planning.' };
  if (!date) return { error: 'Pick a date.' };
  if (!Number.isInteger(guests) || guests < 1 || guests > 3000) return { error: 'How many people are coming?' };
  if (!name) return { error: 'We need your name.' };
  if (!phone) return { error: 'That phone number doesn’t look right. Use a Ghana number, e.g. 024 123 4567.' };
  if (b?.email && !validEmail(b.email)) return { error: 'That email doesn’t look right.' };
  if (date <= dateKey(now())) return { error: 'Pick a date from tomorrow onwards.' };
  const { days } = await calendar(env, 60);
  const slot = days.find(d => d.date === date);
  if (slot && slot.state !== 'open') return { error: slot.state === 'event' ? `${slot.name} is on that night. Pick another date.` : 'That date is already taken. Pick another.' };
  const rid = id();
  await setDoc(env, 'private_event_requests', rid, {
    eventType, date, guests, name, phone, instagram: clean(b.instagram, 60).replace(/^@?/, b.instagram ? '@' : ''),
    email: clean(b.email, 120), message: clean(b.message, 500), status: 'NEW', createdAt: now(),
  });
  await sendEmail(env, env.STAFF_NOTIFY_EMAIL || env.BREVO_SENDER_EMAIL, 'New event booking request', [
    `${eventType} · ${date} · ${guests} guests`, `${name} · ${phone}${b.instagram ? ' · ' + clean(b.instagram, 60) : ''}`, clean(b.message, 500),
  ]);
  return { id: rid };
}

// ── Tickets as their holder sees them (the token is the credential) ──
export async function publicTicket(env, token) {
  const d = await getDoc(env, 'tickets', token);
  if (!d) return null;
  const t = d.fields;
  const [ev, raffles] = await Promise.all([getDoc(env, 'events', t.eventId), queryWhere(env, 'raffles', [{ field: 'eventId', value: t.eventId }])]);
  const raffle = raffles.find(x => x.fields.enabled === true && x.fields.public === true);
  return {
    token, firstName: firstName(t.customerName), type: t.type, admits: Number(t.admitCount || 1),
    eventId: t.eventId, eventName: ev?.fields?.name || t.eventName || '', eventDate: ev?.fields?.date || t.eventDate || '',
    doors: ev?.fields?.doors || '', venue: ev?.fields?.venue || '', artwork: ev?.fields?.artwork || '',
    ticketStyle: ev?.fields?.ticketStyle || 'auto', ticketColors: cleanTicketColors(ev?.fields?.ticketColors),
    identityLine: t.identityLine || '', displayCode: t.displayCode, status: t.revoked || t.cancelled ? 'cancelled' : t.status,
    inDraw: t.inDraw === true, comp: t.comp === true,
    raffle: raffle ? { prize: raffle.fields.prize || '', status: raffle.fields.status, winner: raffle.fields.status === 'drawn' ? { name: raffle.fields.winnerDisplayName, code: raffle.fields.winnerDisplayCode } : null } : null,
  };
}
