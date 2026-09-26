// BUILD_PLAN acceptance tests and the security fixes from the review, driven through the real
// router (worker.fetch) with real signed Firebase ID tokens wherever roles matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker, { fulfillTicket, fulfillInstallment, issueComp, calendar, createPrivateRequest, publicTicket } from '../src/index.js';

const ORIGIN = 'http://localhost:3000';
const FUTURE = '2099-06-05T22:00:00.000Z';
async function call(env, method, path, { body, token } = {}) {
  const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
function seedNight(store, id = 'night1', extra = {}) {
  store.seed('events', id, { name: 'Afrobeats Friday', date: FUTURE, doors: '10PM', venue: 'SamRit Hotel', visibility: 'public', active: true, ticketLines: ['SAMPLE LINE TWO.', 'SAMPLE LINE THREE.'], ...extra });
  store.seed('ticket_types', `${id}-std`, { eventId: id, name: 'Standard', pricePesewas: 15000, admits: 1, remaining: 200, active: true });
}
function seedPaid(store, ref, eventId = 'night1', name = 'Kofi Boateng') {
  store.seed('pending_checkouts', ref, { reference: ref, kind: 'ticket', eventId, eventName: 'Afrobeats Friday', ticketTypeId: `${eventId}-std`, ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 15000, buyerName: name, buyerPhone: '0241234567', buyerEmail: '', identityLine: 'SAMPLE LINE TWO.', status: 'pending' });
  store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 15000 });
}

// ── Access control ──

test('logged-out caller cannot reach any admin route, SMS, or check-in', async () => {
  const { env } = createMockEnv();
  for (const [m, p] of [['GET', '/api/admin/overview'], ['GET', '/api/admin/events'], ['POST', '/api/send-sms'], ['GET', '/api/balance'], ['POST', '/api/admin/sms/send'], ['POST', '/api/checkin'], ['POST', '/api/admin/comps'], ['POST', '/api/admin/set-role']]) {
    const r = await call(env, m, p, { body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${m} ${p} must be 401 without a token`);
  }
});

test('a brand-new signup (valid Firebase token, no role claim) cannot open admin', async () => {
  const { env } = createMockEnv();
  const token = await idToken({});
  const r = await call(env, 'GET', '/api/admin/overview', { token });
  assert.equal(r.status, 401);
});

test('a token for a different Firebase project is rejected', async () => {
  const { env } = createMockEnv();
  const token = await idToken({ admin: true, role: 'superAdmin' }, { projectId: 'someone-elses-project' });
  assert.equal((await call(env, 'GET', '/api/admin/overview', { token })).status, 401);
});

test('organiser cannot see club-wide data or other nights; sees only their own', async () => {
  const { store, env } = createMockEnv();
  seedNight(store, 'mine', { organiserId: 'org-A' });
  seedNight(store, 'theirs', { organiserId: 'org-B' });
  store.seed('orders', 'o1', { eventId: 'theirs', kind: 'ticket', status: 'confirmed', quantity: 3, amountPesewas: 45000 });
  const tokenA = await idToken({ role: 'organiser' }, { uid: 'org-A' });
  for (const p of ['/api/admin/overview', '/api/admin/events', '/api/admin/events/theirs', '/api/admin/orders', '/api/admin/requests', '/api/admin/installments', '/api/admin/settings']) {
    assert.equal((await call(env, 'GET', p, { token: tokenA })).status, 403, `organiser must get 403 on ${p}`);
  }
  for (const [p, body] of [['/api/admin/events', { name: 'x', date: FUTURE }], ['/api/admin/ticket-types', { eventId: 'mine', name: 'x', pricePesewas: 1 }], ['/api/admin/raffles', { eventId: 'mine', prize: 'x', cap: 99 }]]) {
    assert.equal((await call(env, 'POST', p, { token: tokenA, body })).status, 403, `organiser must not write ${p}`);
  }
  const own = await call(env, 'GET', '/api/admin/organiser/overview', { token: tokenA });
  assert.equal(own.status, 200);
  assert.deepEqual(own.data.events.map(e => e.eventId), ['mine']);
});

test('organiser can check in their own night only', async () => {
  const { store, env } = createMockEnv();
  seedNight(store, 'mine', { organiserId: 'org-A' });
  seedNight(store, 'theirs', { organiserId: 'org-B' });
  store.seed('tickets', 'tokenmine0000000000000001', { customerName: 'Ama K', eventId: 'mine', eventName: 'Mine', status: 'valid' });
  store.seed('tickets', 'tokentheirs00000000000001', { customerName: 'Yaw K', eventId: 'theirs', eventName: 'Theirs', status: 'valid' });
  const token = await idToken({ role: 'organiser' }, { uid: 'org-A' });
  const other = await call(env, 'POST', '/api/checkin', { token, body: { token: 'tokentheirs00000000000001' } });
  assert.equal(other.data.valid, false);
  assert.equal(store.get('tickets', 'tokentheirs00000000000001').fields.status, 'valid', 'the other organiser’s ticket is untouched');
  const own = await call(env, 'POST', '/api/checkin', { token, body: { token: 'tokenmine0000000000000001' } });
  assert.equal(own.data.valid, true);
});

test('door staff can check in but cannot read money or edit the site', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  const token = await idToken({ role: 'doorStaff' });
  assert.equal((await call(env, 'GET', '/api/admin/overview', { token })).status, 403);
  assert.equal((await call(env, 'POST', '/api/admin/settings', { token, body: { phone: '0200000000' } })).status, 403);
  assert.equal((await call(env, 'GET', '/api/door/events', { token })).status, 200);
});

// ── Check-in ──

test('check-in: valid → confirmed, second scan → already checked in, junk → not valid, wrong night flagged', async () => {
  const { store, env } = createMockEnv();
  seedNight(store); seedNight(store, 'night2');
  store.seed('tickets', 'aaaabbbbccccdddd1111', { customerName: 'Esi Mensah', eventId: 'night1', eventName: 'Afrobeats Friday', status: 'valid' });
  const token = await idToken({ role: 'doorStaff' });
  const url = 'https://memoriesnightclub.com/verify.html?token=aaaabbbbccccdddd1111';
  const wrong = await call(env, 'POST', '/api/checkin', { token, body: { token: url, eventId: 'night2' } });
  assert.equal(wrong.data.code, 'wrong_night');
  const first = await call(env, 'POST', '/api/checkin', { token, body: { token: url, eventId: 'night1' } });
  assert.equal(first.data.message, 'ENTRY CONFIRMED');
  assert.equal(first.data.ticket.firstName, 'Esi');
  const again = await call(env, 'POST', '/api/checkin', { token, body: { token: url } });
  assert.equal(again.data.message, 'ALREADY CHECKED IN');
  const junk = await call(env, 'POST', '/api/checkin', { token, body: { token: 'not-a-real-ticket' } });
  assert.equal(junk.data.message, 'TICKET NOT VALID');
});

// ── Checkout integrity ──

test('a guest can pick one of the night’s lines or write their own, kept short enough for the ticket', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  const base = { eventId: 'night1', ticketTypeId: 'night1-std', quantity: 1, buyerName: 'Kofi', buyerPhone: '024 123 4567', callbackUrl: `${ORIGIN}/payment-return.html` };
  const none = await call(env, 'POST', '/api/checkout/initiate', { body: { ...base, identityLine: '   ' } });
  assert.equal(none.status, 400, 'a night with lines needs a picked or written line');
  assert.equal(store.list('pending_checkouts').length, 0);
  const good = await call(env, 'POST', '/api/checkout/initiate', { body: { ...base, identityLine: 'SAMPLE LINE THREE.' } });
  assert.equal(good.status, 200);
  const p = store.get('pending_checkouts', good.data.reference).fields;
  assert.equal(p.identityLine, 'SAMPLE LINE THREE.');
  assert.equal(p.buyerPhone, '0241234567', 'phone stored in the SMS worker’s 0XXXXXXXXX format');
  const own = await call(env, 'POST', '/api/checkout/initiate', { body: { ...base, identityLine: '  Birthday\n girl   in the  building, finally here at last!!  ' } });
  assert.equal(own.status, 200);
  const line = store.get('pending_checkouts', own.data.reference).fields.identityLine;
  assert.equal(line, 'Birthday girl in the building, finally h');
  assert.ok(line.length <= 40);
});

test('a night with no lines configured sells tickets with no line (never placeholder copy)', async () => {
  const { store, env } = createMockEnv();
  seedNight(store, 'night1', { ticketLines: [] });
  const r = await call(env, 'POST', '/api/checkout/initiate', { body: { eventId: 'night1', ticketTypeId: 'night1-std', quantity: 1, buyerName: 'Kofi', buyerPhone: '0241234567', identityLine: '', callbackUrl: `${ORIGIN}/x` } });
  assert.equal(r.status, 200);
  assert.equal(store.get('pending_checkouts', r.data.reference).fields.identityLine, '');
});

test('tables: the charge is the package plus bottles, from Firestore — never the browser', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  store.seed('table_packages', 'pkg1', { eventId: 'night1', name: 'Floor Table', pricePesewas: 350000, active: true, remaining: 3 });
  store.seed('bottles', 'b1', { eventId: 'all', name: 'House bottle', pricePesewas: 60000, active: true });
  const r = await call(env, 'POST', '/api/table-checkout/initiate', { body: { eventId: 'night1', packageId: 'pkg1', name: 'Ama', phone: '0551234567', bottles: [{ id: 'b1', quantity: 2, pricePesewas: 1 }], amountPesewas: 1, callbackUrl: `${ORIGIN}/payment-return.html` } });
  assert.equal(r.status, 200);
  assert.equal(store.get('pending_checkouts', r.data.reference).fields.amountPesewas, 350000 + 2 * 60000);
});

test('the same Paystack reference verified twice (webhook + page) issues one ticket and sends one SMS', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  seedPaid(store, 'refDup');
  const [a, b] = await Promise.all([fulfillTicket(env, 'refDup'), fulfillTicket(env, 'refDup')]);
  assert.deepEqual(a.ticketIds, b.ticketIds);
  assert.equal(store.list('tickets').length, 1);
  assert.equal(store.list('orders').length, 1);
  assert.equal(store.sms.length, 1, 'one confirmation text, not two');
  assert.equal(store.sms[0].sender, 'MEMORIES');
});

// ── The draw ──

test('order 20 is in the draw, order 21 is not; a partial order never is', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  store.seed('raffles', 'evt_night1', { eventId: 'night1', prize: 'Club prize', cap: 20, spotsTaken: 0, enabled: true, public: true, status: 'open' });
  // A pay-in-bits order that has paid something but not all of it.
  store.seed('installment_plans', 'MEM-AB1234', { eventId: 'night1', eventName: 'Afrobeats Friday', ticketTypeId: 'night1-std', ticketTypeName: 'Standard', admits: 1, quantity: 1, totalPesewas: 15000, paidPesewas: 0, buyerName: 'Part Payer', buyerPhone: '0200000000', identityLine: 'SAMPLE LINE TWO.', status: 'active', payments: [] });
  store.seed('pending_checkouts', 'part1', { reference: 'part1', kind: 'installment_topup', planId: 'MEM-AB1234', amountPesewas: 5000, status: 'pending' });
  store.setPaystack('part1', { status: 'success', currency: 'GHS', amount: 5000 });
  await fulfillInstallment(env, 'part1');
  assert.equal(store.list('raffle_entries').length, 0, 'a partial payment takes no spot');
  assert.equal(store.list('tickets').length, 0, 'and gets no ticket');

  const results = [];
  for (let i = 1; i <= 21; i++) { seedPaid(store, `r${i}`, 'night1', `Guest ${i}`); results.push(await fulfillTicket(env, `r${i}`)); }
  const inDraw = results.map(r => store.get('tickets', r.ticketIds[0]).fields.inDraw);
  assert.equal(inDraw.slice(0, 20).every(Boolean), true, 'orders 1–20 are in');
  assert.equal(inDraw[20], false, 'order 21 is not');
  const raffle = store.get('raffles', 'evt_night1').fields;
  assert.equal(raffle.spotsTaken, 20);
  assert.equal(raffle.status, 'closed');

  const bundle = await call(env, 'GET', '/api/events/night1');
  assert.equal(bundle.data.raffle.spotsTaken, 20);
  assert.equal(JSON.stringify(bundle.data).includes(results[0].ticketIds[0]), false, 'no ticket token on the public event payload');
});

test('only the ticket that holds the spot says "in the draw" on a multi-ticket order', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  store.seed('raffles', 'evt_night1', { eventId: 'night1', prize: 'x', cap: 20, spotsTaken: 0, enabled: true, public: true, status: 'open' });
  store.seed('pending_checkouts', 'multi', { reference: 'multi', kind: 'ticket', eventId: 'night1', eventName: 'N', ticketTypeId: 'night1-std', ticketTypeName: 'Standard', admits: 1, quantity: 3, amountPesewas: 45000, buyerName: 'Group', buyerPhone: '0241234567', identityLine: '', status: 'pending' });
  store.setPaystack('multi', { status: 'success', currency: 'GHS', amount: 45000 });
  const r = await fulfillTicket(env, 'multi');
  assert.deepEqual(r.ticketIds.map(t => store.get('tickets', t).fields.inDraw), [true, false, false]);
  assert.equal(store.get('raffles', 'evt_night1').fields.spotsTaken, 1);
});

test('comps: recorded against who issued them, out of the draw unless marked in', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  store.seed('raffles', 'evt_night1', { eventId: 'night1', prize: 'x', cap: 20, spotsTaken: 0, enabled: true, public: true, status: 'open' });
  const mgr = { uid: 'mgr-1', role: 'manager' };
  const plain = await issueComp(env, { eventId: 'night1', name: 'Table of Six', admits: 6 }, mgr);
  const t = store.get('tickets', plain.token).fields;
  assert.equal(t.comp, true); assert.equal(t.issuedBy, 'mgr-1'); assert.equal(t.admitCount, 6); assert.equal(t.inDraw, false);
  const marked = await issueComp(env, { eventId: 'night1', name: 'Special Guest', inDraw: true }, mgr);
  assert.equal(marked.inDraw, true);
  assert.equal(store.get('raffles', 'evt_night1').fields.spotsTaken, 1);
  assert.equal((await issueComp(env, { eventId: 'night1', name: 'x' }, { uid: 'd', role: 'doorStaff' })).status, 403);
});

// ── Calendar & private nights ──

test('calendar: every Friday/Saturday exists; event, held and open states come from Firestore', async () => {
  const { store, env } = createMockEnv();
  const { days } = await calendar(env, 4);
  const today = new Date().toISOString().slice(0, 10);
  const fridays = days.filter(d => d.date > today && new Date(d.date + 'T00:00:00Z').getUTCDay() === 5);
  assert.ok(fridays.length >= 2, 'Fridays exist with no events at all');
  assert.ok(days.every(d => d.state === 'open'));
  const [eventDay, heldDay] = [fridays[0].date, fridays[1].date];
  store.seed('events', 'e1', { name: 'Confirmed Night', date: `${eventDay}T22:00:00.000Z`, visibility: 'public', active: true });
  store.seed('private_event_requests', 'q1', { date: heldDay, status: 'ACCEPTED' });
  const after = (await calendar(env, 4)).days;
  assert.deepEqual(after.find(d => d.date === eventDay), { date: eventDay, state: 'event', eventId: 'e1', name: 'Confirmed Night' });
  assert.equal(after.find(d => d.date === heldDay).state, 'held');
  const r = await createPrivateRequest(env, { eventType: 'Birthday', date: eventDay, guests: 20, name: 'Adwoa', phone: '0241112222' });
  assert.match(r.error, /Confirmed Night/, 'a date with a public event is not offered for a private night');
  const ok = await createPrivateRequest(env, { eventType: 'Birthday', date: fridays[2]?.date || after.at(-1).date, guests: 20, name: 'Adwoa', phone: '0241112222', instagram: 'adwoa' });
  assert.equal(ok.error, undefined);
  assert.equal(store.list('private_event_requests').find(x => x.fields.name === 'Adwoa').fields.status, 'NEW', 'a request is not confirmed until admin accepts');
});

// ── Privacy / XSS ──

test('the public ticket shows a first name only, and staff emails escape guest input', async () => {
  const { store, env } = createMockEnv();
  seedNight(store);
  seedPaid(store, 'refP', 'night1', 'Abena <script>alert(1)</script> Owusu');
  const r = await fulfillTicket(env, 'refP');
  const t = await publicTicket(env, r.ticketIds[0]);
  assert.equal(t.firstName, 'Abena');
  assert.equal(JSON.stringify(t).includes('Owusu'), false);
  assert.equal(JSON.stringify(t).includes('0241234567'), false, 'no phone on the public ticket');
  let html = '';
  globalThis.fetch = (orig => async (url, o) => { if (String(url).includes('brevo')) html = JSON.parse(o.body).html; return orig(url, o); })(globalThis.fetch);
  const fridays = (await calendar(env, 4)).days.filter(d => d.state === 'open');
  await createPrivateRequest(env, { eventType: 'Other', date: fridays.at(-1).date, guests: 5, name: '<img src=x onerror=alert(1)>', phone: '0241112222' });
  assert.ok(html.includes('&lt;img'), 'guest input is escaped in the staff email');
  assert.equal(html.includes('<img'), false);
});

test('ticket tokens cannot be enumerated: short or guessed ids find nothing and verify is rate limited', async () => {
  const { env } = createMockEnv();
  const ip = { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.9' };
  let limited = false;
  for (let i = 0; i < 70; i++) {
    const res = await worker.fetch(new Request(`https://api.test/api/verify/${i.toString(16).padStart(8, '0')}`, { headers: ip }), env);
    if (res.status === 429) { limited = true; break; }
    assert.equal((await res.json()).valid, false);
  }
  assert.ok(limited, 'the verify endpoint throttles a single client guessing tokens');
});
