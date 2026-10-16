import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { reconcilePayments, health } from '../src/index.js';

const minsAgo = m => new Date(Date.now() - m * 60_000);
const ref = n => `MEM-1700000000000-AAAA000${n}`;

function setup() {
  const { store, env } = createMockEnv();
  env.ALERT_PHONES = '0240000001,0240000002';
  env.HEALTH_KEY = 'secret-health-key';
  store.paystackTransactions = [];
  store.seed('ticket_types', 'tt1', { eventId: 'e1', name: 'GA', pricePesewas: 5000, admits: 1, remaining: 10, active: true });
  return { store, env };
}
const pendingTicket = (reference, ageMin, extra = {}) => ({
  reference, kind: 'ticket', eventId: 'e1', eventName: 'Night', ticketTypeId: 'tt1', ticketTypeName: 'GA', admits: 1, quantity: 1,
  amountPesewas: 5000, buyerName: 'Ama', buyerPhone: '0240000009', buyerEmail: '', status: 'pending', createdAt: minsAgo(ageMin), shares: {}, ...extra,
});

test('a paid checkout with a missed webhook is fulfilled automatically, once, and the team is told', async () => {
  const { store, env } = setup();
  store.seed('pending_checkouts', ref(1), pendingTicket(ref(1), 20));
  store.setPaystack(ref(1), { status: 'success', currency: 'GHS', amount: 5000 });
  store.paystackTransactions = [{ reference: ref(1), amount: 5000 }];

  const out = await reconcilePayments(env);
  assert.equal(out.ok, true);
  assert.equal(out.recovered, 1);
  assert.equal(store.get('pending_checkouts', ref(1)).fields.status, 'issued');
  assert.equal(store.list('tickets').length, 1);
  assert.equal(store.get('ticket_types', 'tt1').fields.remaining, 9);
  assert.ok(store.sms.some(s => s.to === '0240000001' && /fixed automatically/.test(s.message)), 'owner is told');

  // Running again changes nothing: no second ticket, no second stock decrement, no second alert.
  const smsBefore = store.sms.length;
  await reconcilePayments(env);
  assert.equal(store.list('tickets').length, 1);
  assert.equal(store.get('ticket_types', 'tt1').fields.remaining, 9);
  assert.equal(store.sms.length, smsBefore);
});

test('an abandoned checkout (never paid) is left alone and nobody is texted', async () => {
  const { store, env } = setup();
  store.seed('pending_checkouts', ref(2), pendingTicket(ref(2), 30));
  store.setPaystack(ref(2), { status: 'abandoned' });
  const out = await reconcilePayments(env);
  assert.equal(out.recovered, 0);
  assert.equal(store.get('pending_checkouts', ref(2)).fields.status, 'pending');
  assert.equal(store.list('tickets').length, 0);
  assert.equal(store.sms.length, 0);
});

test('a checkout younger than 3 minutes is not touched yet (the webhook gets first go)', async () => {
  const { store, env } = setup();
  store.seed('pending_checkouts', ref(3), pendingTicket(ref(3), 1));
  store.setPaystack(ref(3), { status: 'success', currency: 'GHS', amount: 5000 });
  const out = await reconcilePayments(env);
  assert.equal(out.checked, 0);
  assert.equal(store.list('tickets').length, 0);
});

test('paid but sold out after payment cannot be fixed by a machine: it texts once, and only once', async () => {
  const { store, env } = setup();
  store.seed('ticket_types', 'tt1', { eventId: 'e1', name: 'GA', pricePesewas: 5000, admits: 1, remaining: 0, active: true });
  store.seed('pending_checkouts', ref(4), pendingTicket(ref(4), 15));
  store.setPaystack(ref(4), { status: 'success', currency: 'GHS', amount: 5000 });
  store.paystackTransactions = [{ reference: ref(4), amount: 5000 }];

  await reconcilePayments(env);
  const actionTexts = () => store.sms.filter(s => /ACTION NEEDED/.test(s.message));
  assert.equal(actionTexts().length, 2, 'both alert phones, one text each');
  assert.match(actionTexts()[0].message, /GHS 50\.00/);
  assert.equal(store.list('tickets').length, 0, 'no ticket invented');

  await reconcilePayments(env);
  assert.equal(actionTexts().length, 2, 'no repeat spam on the next run');
});

test('a successful Paystack payment with no record at all raises an alert', async () => {
  const { store, env } = setup();
  store.paystackTransactions = [{ reference: ref(5), amount: 12000 }, { reference: 'OTHER-123', amount: 999 }];
  await reconcilePayments(env);
  const texts = store.sms.filter(s => /ACTION NEEDED/.test(s.message));
  assert.equal(texts.length, 2);
  assert.match(texts[0].message, /GHS 120\.00/);
  assert.ok(!store.sms.some(s => /OTHER-123|9\.99/.test(s.message)), 'references this system did not create are ignored');
});

test('fully issued payments raise no alerts', async () => {
  const { store, env } = setup();
  store.seed('pending_checkouts', ref(6), pendingTicket(ref(6), 30, { status: 'issued', ticketIds: ['t'], orderId: 'o' }));
  store.paystackTransactions = [{ reference: ref(6), amount: 5000 }];
  await reconcilePayments(env);
  assert.equal(store.sms.length, 0);
});

test('heartbeat is pinged after a clean run and NOT pinged when the run fails', async () => {
  const { store, env } = setup();
  env.HEARTBEAT_URL = 'https://heartbeat.test/ping';
  const pings = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, o) => { if (String(url).startsWith('https://heartbeat.test')) { pings.push(url); return new Response('ok'); } return inner(url, o); };

  assert.equal((await reconcilePayments(env)).ok, true);
  assert.equal(pings.length, 1);

  store.paystackListDown = true;
  const out = await reconcilePayments(env);
  assert.equal(out.ok, false);
  assert.equal(pings.length, 1, 'silence is the signal');
  assert.ok(store.sms.some(s => /could not run/.test(s.message)), 'and a human is told');
  globalThis.fetch = inner;
});

test('health: shallow without the key, deep with it, 503 when a dependency is down', async () => {
  const { store, env } = setup();
  const get = key => health(new Request('https://x.test/api/health', { headers: key ? { 'x-health-key': key } : {} }), env);

  let r = await get(null);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });

  r = await get('wrong');
  assert.deepEqual(await r.json(), { ok: true }, 'wrong key reveals nothing');

  r = await get('secret-health-key');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).checks, { firestore: true, paystack: true });

  store.paystackListDown = true;
  r = await get('secret-health-key');
  assert.equal(r.status, 503);
  assert.equal((await r.json()).checks.paystack, false);
});
