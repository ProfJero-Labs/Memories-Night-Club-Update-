// Scan to order: prices from the server, one payment per basket, the pickup code only after
// Paystack confirms, the bar hands over once, and "can't make it" lands in Refunds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker, { reconcilePayments } from '../src/index.js';

const TOKEN = 'c'.repeat(32);
let ip = 0;
async function call(env, method, path, { body, claims } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.30.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (claims) headers.Authorization = `Bearer ${await idToken(claims)}`;
  const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, text: await r.clone().text(), data: await r.json().catch(() => ({})) };
}
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memoriesnightclub.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: TOKEN, open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', pricePesewas: 2500, available: true });
  store.seed('menu_items', 'shot', { name: 'Tequila shot', category: 'Shots', pricePesewas: 3000, available: true });
  store.seed('menu_items', 'gone', { name: 'Champagne flute', category: 'Wine', pricePesewas: 9000, available: false });
  return { store, env };
}
const BAR = { role: 'barStaff' };
const basket = (extra = {}) => ({ station: TOKEN, items: [{ itemId: 'beer', qty: 2 }, { itemId: 'shot', qty: 1 }], phone: '024 123 4567', clientId: 'a1b2c3d4-0000-4000-8000-000000000001', ...extra });
async function payFor(store, env) {
  const r = await call(env, 'POST', '/api/guest/counter/checkout', { body: basket() });
  const ref = store.list('pending_checkouts')[0].id;
  store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 8000 });
  return { orderId: r.data.orderId, ref };
}

test('the menu: by station QR, unavailable drinks marked, unknown or retired QR refused', async () => {
  const { env } = setup();
  const m = await call(env, 'GET', `/api/guest/menu?station=${TOKEN}`);
  assert.equal(m.data.station.name, 'Main bar'); assert.equal(m.data.open, true);
  assert.equal(m.data.items.find(i => i.id === 'gone').available, false);
  assert.equal((await call(env, 'GET', `/api/guest/menu?station=${'d'.repeat(32)}`)).status, 404);
});

test('checkout prices from the server, ignores a price from the phone, and one basket is one payment', async () => {
  const { store, env } = setup();
  const r = await call(env, 'POST', '/api/guest/counter/checkout', { body: basket({ items: [{ itemId: 'beer', qty: 2, pricePesewas: 1 }, { itemId: 'shot', qty: 1 }] }) });
  assert.equal(r.status, 200, r.data.error);
  assert.equal(store.paystackInits[0].amount, 8000, '2 × 25 + 30 = GHS 80');
  assert.match(store.paystackInits[0].callback_url, /\/counter\.html$/);
  const again = await call(env, 'POST', '/api/guest/counter/checkout', { body: basket() });
  assert.equal(again.data.orderId, r.data.orderId, 'a double tap returns the same order');
  assert.equal(store.paystackInits.length, 1, 'and never starts a second payment');
  assert.equal((await call(env, 'POST', '/api/guest/counter/checkout', { body: basket({ items: [{ itemId: 'gone', qty: 1 }], clientId: 'a1b2c3d4-0000-4000-8000-000000000002' }) })).status, 400);
  assert.equal((await call(env, 'POST', '/api/guest/counter/checkout', { body: basket({ items: [{ itemId: 'beer', qty: 21 }], clientId: 'a1b2c3d4-0000-4000-8000-000000000003' }) })).status, 400);
});

test('no pickup code until Paystack confirms; polling confirms it; the guest is texted the code and a receipt', async () => {
  const { store, env } = setup();
  const r = await call(env, 'POST', '/api/guest/counter/checkout', { body: basket() });
  const ref = store.list('pending_checkouts')[0].id;
  store.setPaystack(ref, { status: 'ongoing' }); // the MoMo prompt is on the guest's phone
  let o = await call(env, 'GET', `/api/guest/counter/${r.data.orderId}`);
  assert.equal(o.data.status, 'pending_payment'); assert.equal(o.data.pickupCode, undefined, 'MoMo not confirmed: no code');
  store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 8000 });
  o = await call(env, 'GET', `/api/guest/counter/${r.data.orderId}`);
  assert.equal(o.data.status, 'paid'); assert.match(o.data.pickupCode, /^[2-9A-HJKMNP-Z]{4}$/);
  assert.ok(!o.text.includes('0241234567'), 'no phone on the order page');
  assert.match(store.sms.at(-1).message, new RegExp(`Pickup code: ${o.data.pickupCode}`));
  const rc = await call(env, 'GET', `/api/guest/receipt/${o.data.receiptCode}`);
  assert.equal(rc.data.receipt.totalPesewas, 8000);
  assert.equal(store.list('counter_orders').length, 1);
});

test('a declined payment says so (nothing taken); a wrong amount is never honoured and becomes a refund owed', async () => {
  const { store, env } = setup();
  const r = await call(env, 'POST', '/api/guest/counter/checkout', { body: basket() });
  store.setPaystack(store.list('pending_checkouts')[0].id, { status: 'failed' });
  assert.equal((await call(env, 'GET', `/api/guest/counter/${r.data.orderId}`)).data.status, 'payment_failed');
  store.setPaystack(store.list('pending_checkouts')[0].id, { status: 'success', currency: 'GHS', amount: 100 });
  const o = await call(env, 'GET', `/api/guest/counter/${r.data.orderId}`);
  assert.equal(o.data.status, 'refund_due'); assert.equal(o.data.pickupCode, undefined, 'no drinks for a wrong amount');
  const refunds = await call(env, 'GET', '/api/admin/refunds', { claims: { role: 'manager' } });
  assert.ok(refunds.data.refunds.some(x => x.source === 'counter' && x.id === r.data.orderId));
});

test('the bar: paid orders queue oldest first; hand over once; "can’t make it" goes to Refunds and can be marked refunded', async () => {
  const { store, env } = setup();
  const { orderId } = await payFor(store, env);
  await call(env, 'GET', `/api/guest/counter/${orderId}`);
  assert.equal((await call(env, 'GET', '/api/bar/queue', { claims: { role: 'organiser' } })).status, 403);
  const q = await call(env, 'GET', '/api/bar/queue', { claims: BAR });
  assert.equal(q.data.orders.length, 1); assert.equal(q.data.orders[0].phoneLast4, '4567');
  assert.ok(!q.text.includes('0241234567'));
  assert.equal((await call(env, 'POST', '/api/bar/order', { claims: BAR, body: { orderId, action: 'deliver' } })).data.status, 'delivered');
  assert.equal((await call(env, 'POST', '/api/bar/order', { claims: BAR, body: { orderId, action: 'deliver' } })).status, 400, 'once only');
  assert.equal((await call(env, 'GET', '/api/bar/queue', { claims: BAR })).data.delivered.length, 1);

  const second = await call(env, 'POST', '/api/guest/counter/checkout', { body: basket({ clientId: 'a1b2c3d4-0000-4000-8000-000000000009' }) });
  const ref2 = store.list('pending_checkouts').find(p => p.fields.orderId === second.data.orderId).id;
  store.setPaystack(ref2, { status: 'success', currency: 'GHS', amount: 8000 });
  await call(env, 'GET', `/api/guest/counter/${second.data.orderId}`);
  await call(env, 'POST', '/api/bar/order', { claims: BAR, body: { orderId: second.data.orderId, action: 'refund', reason: 'out of tequila' } });
  const refunds = await call(env, 'GET', '/api/admin/refunds', { claims: { role: 'manager' } });
  const owed = refunds.data.refunds.find(x => x.source === 'counter');
  assert.equal(owed.amountPesewas, 8000); assert.equal(owed.reason, 'out of tequila');
  assert.equal((await call(env, 'POST', '/api/admin/refunds/mark', { claims: { role: 'manager' }, body: { source: 'counter', id: second.data.orderId, note: 'MoMo reversal 123' } })).status, 200);
  assert.equal(store.get('counter_orders', second.data.orderId).fields.status, 'refunded');
});

test('a paused bar takes no app orders; bar staff can pause and reopen it', async () => {
  const { env } = setup();
  assert.equal((await call(env, 'POST', '/api/bar/station-open', { claims: BAR, body: { stationId: 'main', open: false } })).data.open, false);
  assert.equal((await call(env, 'GET', `/api/guest/menu?station=${TOKEN}`)).data.open, false);
  assert.equal((await call(env, 'POST', '/api/guest/counter/checkout', { body: basket() })).status, 400);
  await call(env, 'POST', '/api/bar/station-open', { claims: BAR, body: { stationId: 'main', open: true } });
  assert.equal((await call(env, 'POST', '/api/guest/counter/checkout', { body: basket() })).status, 200);
});

test('a bar payment whose page was closed is completed by the reconciliation job', async () => {
  const { store, env } = setup();
  const { orderId, ref } = await payFor(store, env);
  store.seed('pending_checkouts', ref, { ...store.get('pending_checkouts', ref).fields, createdAt: new Date(Date.now() - 10 * 60_000) });
  const out = await reconcilePayments(env);
  assert.equal(out.recovered, 1);
  assert.equal(store.get('counter_orders', orderId).fields.status, 'paid');
});
