// Memories API — Cloudflare Worker. Firestore is the database; this Worker is the only thing that
// writes business data. See docs/ARCHITECTURE.md for the route map and role matrix.
import { cors, ok, fail, reply, throttled } from './lib/http.js';
import { verifyStaff, requireRole, MONEY, DOOR } from './lib/auth.js';
import { smsRequest } from './lib/notify.js';
import { getSettings, publicEvents, eventBundle, calendar, createPrivateRequest, publicTicket } from './public.js';
import { initiateTicket, initiateTable, startInstallment, topupInstallment, lookupInstallments, textOrderCodes, resendTicketLink, NEUTRAL_CODES, NEUTRAL_LINK, fulfill, checkoutStatus, forfeitStalePlans } from './checkout.js';
import { normalizePhone, normalizeOrderCode } from './lib/util.js';
import { upsertRaffle, drawRaffle } from './raffle.js';
import { checkin, verifyTicket } from './door.js';
import * as admin from './admin.js';

const enc = new TextEncoder();
const fromHex = s => Uint8Array.from(String(s).match(/.{2}/g) || [], x => parseInt(x, 16));
const body = async req => { try { return await req.json(); } catch { return {}; } };
const tooMany = (req, env) => fail(req, env, 'Too many attempts. Wait a minute and try again.', 429);
const last = p => decodeURIComponent(p.split('/').pop());

async function paystackWebhook(req, env) {
  const raw = await req.text();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PAYSTACK_SECRET_KEY), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify']);
  const sig = req.headers.get('x-paystack-signature') || '';
  const valid = /^[0-9a-f]{128}$/i.test(sig) && await crypto.subtle.verify('HMAC', key, fromHex(sig), enc.encode(raw));
  if (!valid) return new Response('ignored', { status: 200 });
  const event = JSON.parse(raw);
  // fulfill() re-verifies with Paystack and is idempotent per reference, so redelivery is harmless.
  if (event.event === 'charge.success' && event.data?.reference) await fulfill(env, event.data.reference);
  return new Response('ok', { status: 200 });
}

// Work that must not delay (or be visible in) the response. Tests pass no ctx, so it's awaited there.
const later = async (ctx, promise) => { const p = Promise.resolve(promise).catch(e => console.error('background task failed', e)); if (ctx?.waitUntil) ctx.waitUntil(p); else await p; };

async function route(req, env, ctx) {
  const u = new URL(req.url), p = u.pathname, m = req.method;

  // ── Public ──
  if (m === 'GET' && p === '/api/events') return ok(req, env, { events: await publicEvents(env) });
  if (m === 'GET' && p.startsWith('/api/events/')) { const d = await eventBundle(env, last(p)); return d ? ok(req, env, d) : fail(req, env, 'Event not found.', 404); }
  if (m === 'GET' && p === '/api/settings') { const s = await getSettings(env); delete s.closedDates; delete s.updatedAt; return ok(req, env, { settings: s }); }
  if (m === 'GET' && p === '/api/calendar') return ok(req, env, await calendar(env, Math.min(26, Math.max(1, Number(u.searchParams.get('weeks')) || 10))));
  if (m === 'POST' && p === '/api/checkout/initiate') { if (await throttled(req, env, 'checkout', 'standard')) return tooMany(req, env); return reply(req, env, await initiateTicket(env, await body(req))); }
  if (m === 'POST' && p === '/api/table-checkout/initiate') { if (await throttled(req, env, 'checkout', 'standard')) return tooMany(req, env); return reply(req, env, await initiateTable(env, await body(req))); }
  if (m === 'POST' && p === '/api/installments/start') { if (await throttled(req, env, 'checkout', 'standard')) return tooMany(req, env); return reply(req, env, await startInstallment(env, await body(req))); }
  if (m === 'POST' && p === '/api/installments/topup') { if (await throttled(req, env, 'checkout', 'standard')) return tooMany(req, env); return reply(req, env, await topupInstallment(env, await body(req))); }
  if (m === 'GET' && p === '/api/installments/lookup') {
    // By order code only. A ?phone= lookup (older cached pages) gets nothing back: see /find.
    const code = u.searchParams.get('code') || '';
    if (await throttled(req, env, 'lookup', 'strict') || await throttled(req, env, 'lookup-code', 'strict', code.toUpperCase().replace(/\W/g, '').slice(0, 20))) return tooMany(req, env);
    if (!code) return ok(req, env, { plans: [] });
    return ok(req, env, { plans: await lookupInstallments(env, { code }) });
  }
  // Lost code / lost ticket link: always the same reply, and the text goes out after the response
  // so timing doesn't reveal whether anything matched.
  if (m === 'POST' && p === '/api/installments/find') {
    const b = await body(req), ph = normalizePhone(b.phone);
    if (!ph) return fail(req, env, 'Use a Ghana number, e.g. 024 123 4567.');
    if (await throttled(req, env, 'find', 'strict') || await throttled(req, env, 'find-phone', 'strict', ph)) return tooMany(req, env);
    await later(ctx, textOrderCodes(env, { phone: ph }));
    return ok(req, env, { message: NEUTRAL_CODES });
  }
  if (m === 'POST' && p === '/api/installments/resend-link') {
    const b = await body(req), ph = normalizePhone(b.phone), code = normalizeOrderCode(b.planId);
    if (!ph || !code) return fail(req, env, 'Enter your order code and the phone number you used.');
    if (await throttled(req, env, 'resend', 'strict') || await throttled(req, env, 'resend-phone', 'strict', ph) || await throttled(req, env, 'resend-plan', 'strict', code)) return tooMany(req, env);
    await later(ctx, resendTicketLink(env, { planId: code, phone: ph }));
    return ok(req, env, { message: NEUTRAL_LINK });
  }
  if (m === 'POST' && p === '/api/checkout/verify') {
    if (await throttled(req, env, 'verify', 'standard')) return tooMany(req, env);
    const b = await body(req); if (!b.reference) return fail(req, env, 'Reference is required.');
    return ok(req, env, await fulfill(env, String(b.reference)));
  }
  if (m === 'GET' && p === '/api/checkout/status') {
    const r = u.searchParams.get('reference'); if (!r) return fail(req, env, 'Reference is required.');
    const d = await checkoutStatus(env, r); return d ? ok(req, env, d) : fail(req, env, 'Not found.', 404);
  }
  if (m === 'GET' && p.startsWith('/api/tickets/')) {
    if (await throttled(req, env, 'ticket', 'standard')) return tooMany(req, env);
    const t = await publicTicket(env, last(p)); return t ? ok(req, env, { ticket: t }) : fail(req, env, 'Ticket not found.', 404);
  }
  if (m === 'GET' && p.startsWith('/api/verify/')) { if (await throttled(req, env, 'ticket', 'standard')) return tooMany(req, env); return ok(req, env, await verifyTicket(env, last(p))); }
  if (m === 'POST' && p === '/api/private-requests') { if (await throttled(req, env, 'private', 'strict')) return tooMany(req, env); return reply(req, env, await createPrivateRequest(env, await body(req))); }
  if (m === 'POST' && p === '/api/paystack/webhook') return paystackWebhook(req, env);

  // ── Staff (Firebase ID token with a role claim) ──
  if (!p.startsWith('/api/admin/') && !['/api/checkin', '/api/door/events', '/api/send-sms', '/api/balance'].includes(p)) return fail(req, env, 'Not found.', 404);
  const user = await verifyStaff(req, env);
  if (!user) return fail(req, env, 'Sign in again.', 401);

  if (m === 'POST' && p === '/api/checkin') {
    if (!requireRole(user, DOOR)) return fail(req, env, 'Forbidden.', 403);
    if (await throttled(req, env, 'checkin', 'standard')) return tooMany(req, env);
    const b = await body(req); if (!b.token) return fail(req, env, 'Scan or enter a ticket.');
    return ok(req, env, await checkin(env, b.token, user, { eventId: b.eventId || null }));
  }
  if (m === 'GET' && p === '/api/door/events') { if (!requireRole(user, DOOR)) return fail(req, env, 'Forbidden.', 403); return ok(req, env, await admin.doorEvents(env, user)); }
  if ((p === '/api/send-sms' || p === '/api/admin/sms/send') && m === 'POST') {
    if (!requireRole(user, MONEY)) return fail(req, env, 'Forbidden.', 403);
    if (await throttled(req, env, 'sms', 'strict')) return tooMany(req, env);
    const r = await smsRequest(env, '/send-sms', { method: 'POST', body: await req.text() });
    return new Response(await r.text(), { status: r.status, headers: { ...cors(req, env), 'Content-Type': 'application/json' } });
  }
  if ((p === '/api/balance' || p === '/api/admin/sms/balance') && m === 'GET') {
    if (!requireRole(user, MONEY)) return fail(req, env, 'Forbidden.', 403);
    const r = await smsRequest(env, '/balance', { method: 'GET' });
    return new Response(await r.text(), { status: r.status, headers: { ...cors(req, env), 'Content-Type': 'application/json' } });
  }

  if (m === 'GET' && p === '/api/admin/me') return ok(req, env, { uid: user.uid, email: user.email || '', role: user.admin === true ? 'superAdmin' : user.role });
  if (m === 'GET' && p === '/api/admin/overview') return reply(req, env, await admin.adminOverview(env, user));
  if (m === 'GET' && p === '/api/admin/events') return reply(req, env, await admin.listEvents(env, user));
  if (m === 'GET' && p.startsWith('/api/admin/events/')) return reply(req, env, await admin.eventDetail(env, last(p), user));
  if (m === 'POST' && p === '/api/admin/events') return reply(req, env, await admin.upsertEvent(env, await body(req), user));
  if (m === 'DELETE' && p.startsWith('/api/admin/events/')) return reply(req, env, await admin.deleteEvent(env, last(p), user));
  const catalog = { 'ticket-types': 'ticket_types', 'table-packages': 'table_packages', bottles: 'bottles' };
  for (const [slug, col] of Object.entries(catalog)) {
    if (m === 'POST' && p === `/api/admin/${slug}`) return reply(req, env, await admin.upsertCatalog(env, col, await body(req), user));
    if (m === 'DELETE' && p.startsWith(`/api/admin/${slug}/`)) return reply(req, env, await admin.deleteCatalog(env, col, last(p), user));
  }
  if (m === 'GET' && p === '/api/admin/bottles') return reply(req, env, await admin.listBottles(env, user));
  if (m === 'GET' && p === '/api/admin/orders') return reply(req, env, await admin.listOrders(env, { eventId: u.searchParams.get('eventId'), kind: u.searchParams.get('kind') }, user));
  if (m === 'POST' && p === '/api/admin/comps') return reply(req, env, await admin.issueComp(env, await body(req), user));
  if (m === 'POST' && p === '/api/admin/raffles') return reply(req, env, await upsertRaffle(env, await body(req), user));
  if (m === 'POST' && p === '/api/admin/raffle/draw') { if (await throttled(req, env, 'draw', 'strict')) return tooMany(req, env); return reply(req, env, await drawRaffle(env, await body(req), user)); }
  if (m === 'GET' && p === '/api/admin/requests') return reply(req, env, await admin.listRequests(env, user));
  if (m === 'POST' && p.startsWith('/api/admin/requests/')) return reply(req, env, await admin.updatePrivateRequest(env, last(p), await body(req), user));
  if (m === 'GET' && p === '/api/admin/installments') return reply(req, env, await admin.adminInstallments(env, user));
  if (m === 'POST' && p === '/api/admin/installments/resend-sms') { if (await throttled(req, env, 'sms', 'strict')) return tooMany(req, env); return reply(req, env, await admin.resendInstallmentSms(env, await body(req), user)); }
  if (m === 'GET' && p === '/api/admin/settings') { if (!requireRole(user, MONEY)) return fail(req, env, 'Forbidden.', 403); return ok(req, env, { settings: await getSettings(env) }); }
  if (m === 'POST' && p === '/api/admin/settings') return reply(req, env, await admin.updateSettings(env, await body(req), user));
  if (m === 'GET' && p === '/api/admin/staff') return reply(req, env, await admin.listStaff(env, user));
  if (m === 'POST' && p === '/api/admin/set-role') return reply(req, env, await admin.setRole(env, await body(req), user));
  if (m === 'GET' && p === '/api/admin/organiser/overview') return reply(req, env, await admin.organiserOverview(env, user));
  return fail(req, env, 'Not found.', 404);
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    try { return await route(req, env, ctx); }
    catch (e) { console.error(e); return fail(req, env, 'Something went wrong on our side. Try again.', 500); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(forfeitStalePlans(env).catch(e => console.error('forfeitStalePlans failed', e)));
  },
};

// Exposed for the test suite.
export { checkin, verifyTicket, drawRaffle, upsertRaffle, forfeitStalePlans, getSettings, calendar, createPrivateRequest, eventBundle, publicTicket };
export { fulfillTicket, fulfillTable, fulfillInstallment, startInstallment, topupInstallment, initiateTicket, initiateTable, startInstallmentTopup, lookupInstallments } from './checkout.js';
export { withTransaction, listDocs, queryWhere } from './lib/firestore.js';
export { requireRole } from './lib/auth.js';
export { rateLimited } from './lib/http.js';
export { setRole, organiserOverview, updateSettings, updatePrivateRequest, adminInstallments, issueComp, upsertEvent, upsertCatalog, adminOverview, listEvents, listOrders } from './admin.js';
