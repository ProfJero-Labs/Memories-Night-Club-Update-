// Memories API — Cloudflare Worker. Firestore is the database; this Worker is the only thing that
// writes business data. See docs/ARCHITECTURE.md for the route map and role matrix.
import { cors, ok, fail, reply, throttled, allowedOrigin } from './lib/http.js';
import { logError } from './lib/log.js';
import { verifyStaff, requireRole, MONEY, DOOR } from './lib/auth.js';
import { smsRequest } from './lib/notify.js';
import { getSettings, publicEvents, eventBundle, calendar, createPrivateRequest, publicTicket } from './public.js';
import { initiateTicket, initiateTable, startInstallment, topupInstallment, lookupInstallments, textOrderCodes, textTicketLinks, resendTicketLink, startPhoneLookup, verifyPhoneLookup, NEUTRAL_PHONE_CODE, NEUTRAL_CODES, NEUTRAL_LINK, NEUTRAL_TICKETS, fulfill, checkoutStatus, forfeitStalePlans } from './checkout.js';
import { normalizePhone, normalizePlanCode } from './lib/util.js';
import { upsertRaffle, drawRaffle } from './raffle.js';
import { checkin, verifyTicket, doorSummary, doorSearch, seatTable, undoCheckin } from './door.js';
import * as admin from './admin.js';
import * as members from './members.js';
import * as bar from './bar.js';
import { reconcilePayments, health } from './reconcile.js';
import * as Sentry from '@sentry/cloudflare';
import { sentryOptions, reportError, routeGroup, isCritical, clientError, securitySignal } from './lib/monitor.js';

const enc = new TextEncoder();
const fromHex = s => Uint8Array.from(String(s).match(/.{2}/g) || [], x => parseInt(x, 16));
const body = async req => { try { return await req.json(); } catch { return {}; } };
const tooMany = (req, env) => fail(req, env, 'Too many attempts. Wait a minute and try again.', 429);
const last = p => decodeURIComponent(p.split('/').pop());

async function paystackWebhook(req, env, ctx) {
  const raw = await req.text();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.PAYSTACK_SECRET_KEY), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify']);
  const sig = req.headers.get('x-paystack-signature') || '';
  const valid = /^[0-9a-f]{128}$/i.test(sig) && await crypto.subtle.verify('HMAC', key, fromHex(sig), enc.encode(raw));
  if (!valid) { await later(ctx, securitySignal(env, 'webhook_forged')); return new Response('ignored', { status: 200 }); }
  const event = JSON.parse(raw);
  // fulfill() re-verifies with Paystack and is idempotent per reference, so redelivery is harmless.
  if (event.event === 'charge.success' && event.data?.reference) await fulfill(env, event.data.reference);
  return new Response('ok', { status: 200 });
}

// Work that must not delay (or be visible in) the response. Tests pass no ctx, so it's awaited there.
const later = async (ctx, promise) => { const p = Promise.resolve(promise).catch(e => logError('background task failed', e)); if (ctx?.waitUntil) ctx.waitUntil(p); else await p; };

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
    const code = u.searchParams.get('code') || '';
    const phone = u.searchParams.get('phone') || '';
    // Code + the phone on the order. (Phone alone goes through a texted code: /phone-code.)
    if (await throttled(req, env, 'lookup', 'strict') || await throttled(req, env, 'lookup-code', 'strict', normalizePlanCode(code) || 'none') || await throttled(req, env, 'lookup-phone', 'strict', normalizePhone(phone) || 'none')) return tooMany(req, env);
    return ok(req, env, { plans: await lookupInstallments(env, { code, phone }) });
  }
  if (m === 'POST' && p === '/api/installments/phone-code') {
    const b = await body(req), ph = normalizePhone(b.phone);
    if (!ph) return fail(req, env, 'Use a Ghana number, e.g. 024 123 4567.');
    if (await throttled(req, env, 'phone-code', 'strict') || await throttled(req, env, 'phone-code-phone', 'strict', ph)) return tooMany(req, env);
    await later(ctx, startPhoneLookup(env, { phone: ph }));
    return ok(req, env, { message: NEUTRAL_PHONE_CODE });
  }
  if (m === 'POST' && p === '/api/installments/phone-verify') {
    const b = await body(req), ph = normalizePhone(b.phone);
    if (await throttled(req, env, 'phone-verify', 'strict') || await throttled(req, env, 'phone-verify-phone', 'strict', ph || 'none')) return tooMany(req, env);
    return reply(req, env, await verifyPhoneLookup(env, b));
  }
  if (m === 'POST' && p === '/api/installments/find') {
    const b = await body(req), ph = normalizePhone(b.phone);
    if (!ph) return fail(req, env, 'Use a Ghana number, e.g. 024 123 4567.');
    if (await throttled(req, env, 'find', 'strict') || await throttled(req, env, 'find-phone', 'strict', ph)) return tooMany(req, env);
    await later(ctx, textOrderCodes(env, { phone: ph }));
    return ok(req, env, { message: NEUTRAL_CODES });
  }
  if (m === 'POST' && p === '/api/tickets/find') {
    const b = await body(req), ph = normalizePhone(b.phone);
    if (!ph) return fail(req, env, 'Use a Ghana number, e.g. 024 123 4567.');
    if (await throttled(req, env, 'tickets-find', 'strict') || await throttled(req, env, 'tickets-find-phone', 'strict', ph)) return tooMany(req, env);
    await later(ctx, textTicketLinks(env, { phone: ph }));
    return ok(req, env, { message: NEUTRAL_TICKETS });
  }
  if (m === 'POST' && p === '/api/installments/resend-link') {
    const b = await body(req), ph = normalizePhone(b.phone), code = normalizePlanCode(b.planId);
    if (!ph || !code) return fail(req, env, 'Enter your order code and the phone number you used.');
    if (await throttled(req, env, 'resend', 'strict') || await throttled(req, env, 'resend-phone', 'strict', ph) || await throttled(req, env, 'resend-plan', 'strict', code)) return tooMany(req, env);
    await later(ctx, resendTicketLink(env, { planId: code, phone: ph }));
    return ok(req, env, { message: NEUTRAL_LINK });
  }
  if (m === 'POST' && p === '/api/checkout/verify') {
    if (await throttled(req, env, 'verify', 'standard')) return tooMany(req, env);
    const b = await body(req); if (!b.reference) return fail(req, env, 'Reference is required.');
    // Only the outcome: ticket links come from /api/checkout/status, and only with the buyer's claim.
    const r = await fulfill(env, String(b.reference));
    return ok(req, env, { status: r.status, kind: r.kind, error: r.error, planComplete: r.planComplete });
  }
  if (m === 'GET' && p === '/api/checkout/status') {
    const r = u.searchParams.get('reference'); if (!r) return fail(req, env, 'Reference is required.');
    if (await throttled(req, env, 'verify', 'standard')) return tooMany(req, env);
    const d = await checkoutStatus(env, r, req.headers.get('X-Checkout-Claim') || ''); return d ? ok(req, env, d) : fail(req, env, 'Not found.', 404);
  }
  if (m === 'GET' && p.startsWith('/api/tickets/')) {
    if (await throttled(req, env, 'ticket', 'standard')) return tooMany(req, env);
    const t = await publicTicket(env, last(p)); return t ? ok(req, env, { ticket: t }) : fail(req, env, 'Ticket not found.', 404);
  }
  if (m === 'GET' && p.startsWith('/api/verify/')) { if (await throttled(req, env, 'ticket', 'standard')) return tooMany(req, env); return ok(req, env, await verifyTicket(env, last(p))); }
  if (m === 'POST' && p === '/api/private-requests') { if (await throttled(req, env, 'private', 'strict')) return tooMany(req, env); return reply(req, env, await createPrivateRequest(env, await body(req))); }
  if (m === 'POST' && p === '/api/paystack/webhook') return paystackWebhook(req, env, ctx);
  // ── Scan to order (guests at the bar) ──
  if (m === 'GET' && p === '/api/guest/menu') { if (await throttled(req, env, 'menu', 'standard')) return tooMany(req, env); return reply(req, env, await bar.guestMenu(env, u.searchParams.get('station'))); }
  if (m === 'POST' && p === '/api/guest/counter/checkout') { if (await throttled(req, env, 'checkout', 'standard')) return tooMany(req, env); return reply(req, env, await bar.counterCheckout(env, await body(req))); }
  if (m === 'GET' && p.startsWith('/api/guest/counter/')) {
    if (await throttled(req, env, 'counter-poll', 'standard')) return tooMany(req, env);
    const o = await bar.guestOrder(env, last(p), r => fulfill(env, r)); return o ? ok(req, env, o) : fail(req, env, 'Order not found.', 404);
  }
  if (m === 'GET' && p.startsWith('/api/guest/receipt/')) {
    if (await throttled(req, env, 'ticket', 'standard')) return tooMany(req, env);
    const r = await bar.receipt(env, last(p)); return r ? ok(req, env, { receipt: r }) : fail(req, env, 'Receipt not found.', 404);
  }
  // ── Member pass (the member's own phone) ──
  if (m === 'POST' && p === '/api/members/activate') {
    if (await throttled(req, env, 'pass-activate', 'strict')) return tooMany(req, env);
    return reply(req, env, await members.activatePass(env, await body(req), req.headers.get('CF-Connecting-IP')));
  }
  if (m === 'POST' && p === '/api/members/pass-status') { if (await throttled(req, env, 'pass-status', 'standard')) return tooMany(req, env); return ok(req, env, await members.passStatus(env, (await body(req)).qr)); }
  if (m === 'GET' && p === '/api/health') return health(req, env);
  if (m === 'POST' && p === '/api/client-error') { if (await throttled(req, env, 'client-error', 'strict')) return tooMany(req, env); return reply(req, env, await clientError(req, env, allowedOrigin)); }

  // ── Staff (Firebase ID token with a role claim) ──
  if (!p.startsWith('/api/admin/') && !p.startsWith('/api/members/door/') && !p.startsWith('/api/bar/') && !['/api/members/my-pass', '/api/members/my-gate'].includes(p) && !['/api/checkin', '/api/checkin/undo', '/api/door/events', '/api/door/summary', '/api/door/search', '/api/send-sms', '/api/balance'].includes(p)) return fail(req, env, 'Not found.', 404);
  const user = await verifyStaff(req, env);
  if (!user) return fail(req, env, 'Sign in again.', 401);

  if (m === 'POST' && p === '/api/checkin') {
    if (!requireRole(user, DOOR)) return fail(req, env, 'Forbidden.', 403);
    if (await throttled(req, env, 'checkin', 'standard')) return tooMany(req, env);
    const b = await body(req);
    if (b.table) { if (!b.eventId) return ok(req, env, { valid: false, code: 'no_event', message: 'PICK TONIGHT’S NIGHT FIRST' }); return ok(req, env, await seatTable(env, user, String(b.eventId), b.table)); }
    if (!b.token && !b.code) return fail(req, env, 'Scan or enter a ticket.');
    return ok(req, env, await checkin(env, b.token || '', user, { eventId: b.eventId || null, code: b.code || null }));
  }
  if (m === 'POST' && p === '/api/checkin/undo') {
    if (!requireRole(user, DOOR)) return fail(req, env, 'Forbidden.', 403);
    if (await throttled(req, env, 'checkin', 'standard')) return tooMany(req, env);
    return reply(req, env, await undoCheckin(env, user, (await body(req)).checkinId));
  }
  // ── The bar's screen ──
  if (m === 'GET' && p === '/api/bar/queue') return reply(req, env, await bar.barQueue(env, user, u.searchParams.get('stationId')));
  if (m === 'POST' && p === '/api/bar/order') return reply(req, env, await bar.barUpdate(env, user, await body(req)));
  if (m === 'POST' && p === '/api/bar/station-open') return reply(req, env, await bar.setStationOpen(env, user, await body(req)));
  // ── A staff member's own pass and gate code (their sign-in is the proof) ──
  if (m === 'POST' && p === '/api/members/my-pass') return reply(req, env, await members.staffPass(env, user, await body(req)));
  if (m === 'GET' && p === '/api/members/my-gate') return reply(req, env, await members.myGate(env, user));
  // ── Members at the gate ──
  if (m === 'POST' && p.startsWith('/api/members/door/')) {
    if (await throttled(req, env, 'member-door', 'standard')) return tooMany(req, env);
    const b = await body(req), ip = req.headers.get('CF-Connecting-IP');
    if (p === '/api/members/door/pass') return reply(req, env, await members.doorVerifyPass(env, user, b.qr, ip));
    if (p === '/api/members/door/request-code' || p === '/api/members/door/send-code') return reply(req, env, await members.doorRequestCode(env, user, b.phone));
    if (p === '/api/members/door/confirm') return reply(req, env, await members.doorConfirmCode(env, user, b, ip));
  }
  if (m === 'GET' && p === '/api/door/summary') { if (!requireRole(user, DOOR)) return fail(req, env, 'Forbidden.', 403); return reply(req, env, await doorSummary(env, user, u.searchParams.get('eventId'))); }
  if (m === 'GET' && p === '/api/door/search') {
    if (!requireRole(user, DOOR)) return fail(req, env, 'Forbidden.', 403);
    if (await throttled(req, env, 'door-search', 'standard')) return tooMany(req, env);
    return reply(req, env, await doorSearch(env, user, u.searchParams.get('eventId'), u.searchParams.get('q')));
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
  if (m === 'GET' && p === '/api/admin/refunds') return reply(req, env, await admin.listRefunds(env, user));
  if (m === 'POST' && p === '/api/admin/refunds/mark') return reply(req, env, await admin.markRefunded(env, await body(req), user));
  if (m === 'GET' && p === '/api/admin/installments') return reply(req, env, await admin.adminInstallments(env, user));
  if (m === 'POST' && p === '/api/admin/installments/resend-sms') { if (await throttled(req, env, 'sms', 'strict')) return tooMany(req, env); return reply(req, env, await admin.resendInstallmentSms(env, await body(req), user)); }
  if (m === 'GET' && p === '/api/admin/settings') { if (!requireRole(user, MONEY)) return fail(req, env, 'Forbidden.', 403); return ok(req, env, { settings: await getSettings(env) }); }
  if (m === 'POST' && p === '/api/admin/settings') return reply(req, env, await admin.updateSettings(env, await body(req), user));
  if (m === 'GET' && p === '/api/admin/organisers') return reply(req, env, await admin.listOrganisers(env, user));
  if (m === 'GET' && p === '/api/admin/staff') return reply(req, env, await admin.listStaff(env, user));
  if (m === 'POST' && p === '/api/admin/set-role') return reply(req, env, await admin.setRole(env, await body(req), user));
  if (m === 'POST' && p === '/api/admin/staff/invite') {
    if (await throttled(req, env, 'invite', 'strict')) return tooMany(req, env);
    return reply(req, env, await admin.inviteStaff(env, await body(req), user));
  }
  if (m === 'GET' && p === '/api/admin/organiser/overview') return reply(req, env, await admin.organiserOverview(env, user));

  if (m === 'GET' && p === '/api/admin/bar-setup') return reply(req, env, await bar.barSetup(env, user));
  if (m === 'POST' && p === '/api/admin/bar-stations') return reply(req, env, await bar.upsertStation(env, await body(req), user));
  if (m === 'POST' && p === '/api/admin/menu-items') return reply(req, env, await bar.upsertMenuItem(env, await body(req), user));
  if (m === 'GET' && p === '/api/admin/members') return reply(req, env, await members.listMembers(env, user));
  if (m === 'POST' && p === '/api/admin/members') return reply(req, env, await members.upsertMember(env, await body(req), user));
  if (m === 'POST' && p === '/api/admin/members/activation') return reply(req, env, await members.createActivation(env, await body(req), user));
  if (m === 'GET' && p === '/api/admin/attendance') return reply(req, env, await members.attendance(env, { days: u.searchParams.get('days'), memberId: u.searchParams.get('memberId') }, user));
  if (m === 'GET' && p === '/api/admin/system') return reply(req, env, await admin.systemStatus(env, user));
  if (m === 'GET' && p === '/api/admin/payments') return reply(req, env, await admin.listPendingCheckouts(env, { sinceMs: Number(u.searchParams.get('sinceMs')) || 0 }, user));

  // ── Settlements ──
  if (m === 'POST' && p === '/api/admin/settlements') return reply(req, env, await admin.recordSettlement(env, await body(req), user));
  if (m === 'GET'  && p === '/api/admin/settlements') return reply(req, env, await admin.listSettlements(env, { organizerId: u.searchParams.get('organizerId'), eventId: u.searchParams.get('eventId') }, user));

  return fail(req, env, 'Not found.', 404);
}

const STAFF_PATH = /^\/api\/(admin|checkin|door|members\/door|bar)(\/|$)|^\/api\/(send-sms|balance)$/;
const handler = {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req, env) });
    try {
      const res = await route(req, env, ctx);
      // Probing looks like a run of refusals from one address; a guest having a bad night doesn't.
      const ip = req.headers.get('CF-Connecting-IP') || 'unknown', path = new URL(req.url).pathname;
      if ((res.status === 401 || res.status === 403) && STAFF_PATH.test(path)) await later(ctx, securitySignal(env, 'staff_denied', ip));
      else if (res.status === 429) await later(ctx, securitySignal(env, 'rate_limited', ip));
      return res;
    }
    catch (e) {
      const path = new URL(req.url).pathname;
      logError('request failed', `${req.method} ${path}`, e);
      // Sentry gets every unexpected error; a payment-path failure also texts the team (throttled).
      await later(ctx, reportError(env, `${req.method} ${routeGroup(path)}`, e, { critical: isCritical(path) }));
      return fail(req, env, 'Something went wrong on our side. Try again.', 500);
    }
  },
  async scheduled(event, env, ctx) {
    // Two crons (wrangler.toml): every 10 minutes the payment reconciliation, daily the forfeit sweep.
    if (event.cron === '*/10 * * * *') ctx.waitUntil(reconcilePayments(env, event.scheduledTime));
    else ctx.waitUntil(forfeitStalePlans(env).catch(e => { logError('forfeitStalePlans failed', e); return reportError(env, 'cron.forfeitStalePlans', e); }));
  },
};

// Sentry wraps the handler only when SENTRY_DSN is set (and a real execution context exists), so
// without a DSN the Worker runs exactly as before and the tests exercise the bare handler.
const instrumented = Sentry.withSentry(sentryOptions, handler);
export default {
  fetch: (req, env, ctx) => (env.SENTRY_DSN && ctx ? instrumented.fetch(req, env, ctx) : handler.fetch(req, env, ctx)),
  scheduled: (event, env, ctx) => (env.SENTRY_DSN && ctx ? instrumented.scheduled(event, env, ctx) : handler.scheduled(event, env, ctx)),
};

// Exposed for the test suite.
export { checkin, verifyTicket, drawRaffle, upsertRaffle, forfeitStalePlans, getSettings, calendar, createPrivateRequest, eventBundle, publicTicket };
export { reconcilePayments, health };
export { fulfillTicket, fulfillTable, fulfillInstallment, startInstallment, topupInstallment, initiateTicket, initiateTable, startInstallmentTopup, lookupInstallments, textTicketLinks } from './checkout.js';
export { withTransaction, listDocs, queryWhere } from './lib/firestore.js';
export { requireRole } from './lib/auth.js';
export { rateLimited } from './lib/http.js';
export { setRole, inviteStaff, recordSettlement, listSettlements, listPendingCheckouts, organiserOverview, updateSettings, updatePrivateRequest, adminInstallments, issueComp, upsertEvent, upsertCatalog, adminOverview, listEvents, listOrders } from './admin.js';