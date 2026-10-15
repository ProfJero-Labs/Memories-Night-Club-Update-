// Ticket promos: a night runs a deal for a while, for everyone or only for those with a code.
//   percent   e.g. 25% off each ticket                     value: 1–90 (percent)
//   amount    e.g. GHS 20 off each ticket                  value: pesewas off each ticket
//   bundle    e.g. "Buy 4, pay for 3" (group deals)         buy: 2–10, pay: 1..buy-1
// A promo can be limited to some ticket types, to a time window (early bird: until Friday 6PM),
// and to the first N tickets. With no code it's automatic: everyone sees and gets the promo price.
// With a code (an influencer's, a radio campaign's) only buyers who enter it get it, so the club
// can see which campaign brought which sales. One promo per order: the best one for the buyer.
//
// The Worker always prices the order. The promo is recorded on the order, the pay-in-bits plan
// and the payment, and counted when the ticket is issued (`usedCount`, `discountGivenPesewas`).
// A paid order is always honoured, so a promo can go a few tickets over its limit if several
// people pay for the last ones at the same moment.
//
// Collection (server only): promos/{id}
//   eventId, name, kind, value, buy, pay, ticketTypeIds[], startsAt, endsAt, limit, code,
//   active, usedCount, discountGivenPesewas, createdAt, updatedAt, createdBy
import { getDoc, setDoc, queryWhere } from './lib/firestore.js';
import { now, id, clean, money } from './lib/util.js';
import { promoDiscount as discountFor, promoText as promoLabel, PROMO_MIN_ORDER_PESEWAS } from '../../public/lib/shared.js';
import { requireRole, CMS, uidOf } from './lib/auth.js';

const FORBIDDEN = { error: 'Forbidden.', status: 403 };
const KINDS = ['percent', 'amount', 'bundle'];
export const MIN_ORDER_PESEWAS = PROMO_MIN_ORDER_PESEWAS; // Paystack's smallest charge (GHS 1); free tickets are comps
export const normalizeCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

// ── The maths (shared with the pages, so the price shown is the price charged) ──
export { promoDiscount as discountFor, promoText as promoLabel } from '../../public/lib/shared.js';
const left = p => (Number(p.limit) > 0 ? Math.max(0, Number(p.limit) - Number(p.usedCount || 0)) : null);
// Running right now (switched on, inside its window, not used up)?
export function isLive(p, at = Date.now()) {
  if (p.active === false) return false;
  if (p.startsAt && new Date(p.startsAt).getTime() > at) return false;
  if (p.endsAt && new Date(p.endsAt).getTime() <= at) return false;
  return left(p) !== 0;
}
const appliesTo = (p, ticketTypeId) => !(p.ticketTypeIds || []).length || p.ticketTypeIds.includes(ticketTypeId);

export async function livePromos(env, eventId) {
  return (await queryWhere(env, 'promos', [{ field: 'eventId', value: eventId }])).map(d => ({ id: d.id, ...d.fields })).filter(p => isLive(p));
}

// The best promo for this order: automatic ones, plus the code's one if the buyer gave a code.
// Returns { promo, discountPesewas } or { promo: null }; `codeError` if a code was given but doesn't work.
export function bestPromo(promos, { ticketTypeId, unit, qty, code }) {
  const c = normalizeCode(code);
  let best = null, codeError = '';
  const consider = p => {
    const room = left(p);
    if (room !== null && room < qty) return 'only';
    const off = discountFor(p, unit, qty);
    if (off > 0 && (!best || off > best.discountPesewas)) best = { promo: p, discountPesewas: off };
    return off > 0 ? 'ok' : 'none';
  };
  for (const p of promos) if (!p.code && appliesTo(p, ticketTypeId)) consider(p);
  if (c) {
    const p = promos.find(x => x.code && x.code === c);
    if (!p) codeError = 'That promo code isn’t valid for this night.';
    else if (!appliesTo(p, ticketTypeId)) codeError = 'That promo code doesn’t cover this ticket.';
    else {
      const r = consider(p);
      if (r === 'only') codeError = `That promo has only ${left(p)} ticket${left(p) === 1 ? '' : 's'} left.`;
      else if (r === 'none') codeError = p.kind === 'bundle' ? `That promo needs ${p.buy} tickets in one order.` : 'That promo code doesn’t lower this price.';
    }
  }
  return { ...(best || { promo: null, discountPesewas: 0 }), codeError };
}

// What's stored on the order, the plan and the payment: enough to report on, nothing secret.
export const promoRecord = (best, fullPesewas) => (best?.promo ? { id: best.promo.id, name: best.promo.name, code: best.promo.code || '', label: promoLabel(best.promo), discountPesewas: best.discountPesewas, fullPesewas } : null);

// For the public pages: automatic promos only (codes stay secret), the promo price per ticket
// type for one ticket, and whether this night has any code promos (to show "Have a code?").
export function publicPromos(promos, ticketTypes) {
  const auto = promos.filter(p => !p.code);
  return {
    promos: auto.map(p => ({ id: p.id, name: p.name, label: promoLabel(p), kind: p.kind, value: Number(p.value || 0), buy: Number(p.buy || 0), pay: Number(p.pay || 0), endsAt: p.endsAt || null, left: left(p), ticketTypeIds: p.ticketTypeIds || [] })),
    hasCodes: promos.some(p => p.code),
    // For each ticket type, its best automatic price for a single ticket (bundles need more than one).
    prices: Object.fromEntries(ticketTypes.map(t => {
      const b = bestPromo(auto, { ticketTypeId: t.id, unit: t.pricePesewas, qty: 1 });
      return [t.id, b.promo ? { pricePesewas: t.pricePesewas - b.discountPesewas, promoId: b.promo.id } : null];
    }).filter(([, v]) => v)),
  };
}

// ── Public quote: the checkout shows the exact price, with or without a code ──
export async function quote(env, { eventId, ticketTypeId, quantity, code }) {
  const qty = Number(quantity);
  if (!eventId || !ticketTypeId || !Number.isInteger(qty) || qty < 1 || qty > 6) return { error: 'Pick a ticket.' };
  const tt = await getDoc(env, 'ticket_types', String(ticketTypeId));
  if (!tt || tt.fields.eventId !== eventId || tt.fields.active !== true) return { error: 'This ticket is no longer available.' };
  const unit = Number(tt.fields.pricePesewas || 0), full = unit * qty;
  const b = bestPromo(await livePromos(env, eventId), { ticketTypeId: tt.id, unit, qty, code });
  return { fullPesewas: full, totalPesewas: full - b.discountPesewas, promo: b.promo ? { name: b.promo.name, label: promoLabel(b.promo), discountPesewas: b.discountPesewas, code: !!b.promo.code } : null, codeError: b.codeError || undefined };
}

// ── Control room ──
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user), ...data, timestamp: now() });
const view = d => ({ id: d.id, ...d.fields, label: promoLabel(d.fields), live: isLive(d.fields), left: left(d.fields), usedCount: Number(d.fields.usedCount || 0), discountGivenPesewas: Number(d.fields.discountGivenPesewas || 0) });

export async function listPromos(env, user, eventId) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  if (!eventId) return { error: 'Pick a night.' };
  const docs = await queryWhere(env, 'promos', [{ field: 'eventId', value: String(eventId) }]);
  return { promos: docs.map(view).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) };
}

export async function upsertPromo(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const existing = b?.id ? await getDoc(env, 'promos', String(b.id)) : null;
  if (b?.id && !existing) return { error: 'Promo not found.', status: 404 };
  const eventId = existing?.fields?.eventId || String(b?.eventId || '');
  const ev = await getDoc(env, 'events', eventId);
  if (!ev) return { error: 'Pick a night.' };
  const name = clean(b.name, 40); if (!name) return { error: 'Name the promo, e.g. Early bird.' };
  const kind = KINDS.includes(b.kind) ? b.kind : null; if (!kind) return { error: 'Pick the kind of promo.' };
  const value = Math.round(Number(b.value) || 0), buy = Math.round(Number(b.buy) || 0), pay = Math.round(Number(b.pay) || 0);
  if (kind === 'percent' && !(value >= 1 && value <= 90)) return { error: 'A percentage off is 1 to 90. For free tickets, give comps.' };
  if (kind === 'amount' && !(value >= 100)) return { error: 'Take at least GHS 1 off.' };
  if (kind === 'bundle' && !(buy >= 2 && buy <= 6 && pay >= 1 && pay < buy)) return { error: 'For a group deal: buy 2 to 6, pay for fewer (e.g. buy 4, pay for 3). Orders are up to 6 tickets.' };
  const types = (Array.isArray(b.ticketTypeIds) ? b.ticketTypeIds : []).map(String).slice(0, 20);
  if (types.length) {
    const own = (await queryWhere(env, 'ticket_types', [{ field: 'eventId', value: eventId }])).map(t => t.id);
    if (types.some(t => !own.includes(t))) return { error: 'Pick ticket types from this night.' };
    if (kind === 'amount') {
      const cheapest = Math.min(...(await queryWhere(env, 'ticket_types', [{ field: 'eventId', value: eventId }])).filter(t => types.includes(t.id)).map(t => Number(t.fields.pricePesewas || 0)));
      if (value >= cheapest) return { error: `That’s as much as the ticket (${money(cheapest)}). For free tickets, give comps.` };
    }
  }
  const when = v => (v ? (Number.isNaN(new Date(v).getTime()) ? null : new Date(v).toISOString()) : '');
  const startsAt = when(b.startsAt), endsAt = when(b.endsAt);
  if (startsAt === null || endsAt === null) return { error: 'Check the start and end times.' };
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The promo must end after it starts.' };
  const limit = b.limit === '' || b.limit == null ? 0 : Math.round(Number(b.limit));
  if (!(limit >= 0 && limit <= 100000)) return { error: 'The limit is a number of tickets (or blank for no limit).' };
  const code = normalizeCode(b.code);
  if (b.code && code.length < 3) return { error: 'A code needs at least 3 letters or numbers, e.g. KOFI20.' };
  if (code) {
    const clash = (await queryWhere(env, 'promos', [{ field: 'eventId', value: eventId }])).find(p => p.fields.code === code && p.id !== existing?.id);
    if (clash) return { error: `${code} is already used for “${clash.fields.name}” on this night.` };
  }
  const pid = existing?.id || id();
  const fields = {
    ...(existing?.fields || {}), eventId, name, kind,
    value: kind === 'bundle' ? 0 : value, buy: kind === 'bundle' ? buy : 0, pay: kind === 'bundle' ? pay : 0,
    ticketTypeIds: types, startsAt, endsAt, limit, code, active: b.active !== false,
    usedCount: Number(existing?.fields?.usedCount || 0), discountGivenPesewas: Number(existing?.fields?.discountGivenPesewas || 0),
    updatedAt: now(), createdAt: existing?.fields?.createdAt || now(), createdBy: existing?.fields?.createdBy || uidOf(user),
  };
  await setDoc(env, 'promos', pid, fields);
  await audit(env, user, existing ? 'PROMO_UPDATED' : 'PROMO_ADDED', { promoId: pid, eventId, kind, code: code || null, active: fields.active });
  return { id: pid };
}

// Counted when the ticket is issued, inside the issuing transaction (see checkout.js).
export const promoCountFields = (fields, qty, discountPesewas) => ({ ...fields, usedCount: Number(fields.usedCount || 0) + qty, discountGivenPesewas: Number(fields.discountGivenPesewas || 0) + discountPesewas, lastUsedAt: now() });
