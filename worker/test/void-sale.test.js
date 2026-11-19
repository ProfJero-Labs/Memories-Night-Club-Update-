// Voiding a sale and test mode: a cash sale that never really happened can be taken back (by a
// manager or director, with a reason), and a practice session can be cleared in one go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('events', 'ev1', { name: 'Afrobeats Friday', date: new Date().toISOString(), active: true, visibility: 'public', organiserId: 'org1' });
  store.seed('ticket_types', 'reg', { eventId: 'ev1', name: 'Regular', pricePesewas: 8000, doorPricePesewas: 10000, admits: 1, remaining: 50, active: true });
  const people = { door: ['Kofi Door', 'doorStaff'], mgr: ['Akos Manager', 'manager'], dir: ['Dede Director', 'director'], w1: ['Efua Waiter', 'waitStaff'], org1: ['Ama Organiser', 'organiser'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `0240000${Object.keys(people).indexOf(uid)}00` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.97.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const sell = (call, extra = {}) => call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 2, phone: '0245551234', name: 'Kwame', method: 'cash', ...extra } });

test('voiding a cash door sale: out of the seller’s cash and the door numbers, tickets dead, tickets back on sale', async () => {
  const { store, call } = setup();
  const sale = ok(await sell(call), 'sell');
  assert.equal(store.get('ticket_types', 'reg').fields.remaining, 48);
  const orderId = store.list('orders').find(o => o.fields.channel === 'gate').id;

  const list = ok(await call('GET', '/api/ops/sales/door', { who: 'mgr' }), 'door sales');
  assert.deepEqual([list.sales.length, list.sales[0].canVoid, list.sales[0].amountPesewas], [1, true, 20000]);

  const v = ok(await call('POST', '/api/ops/sales/void', { who: 'mgr', body: { kind: 'gate', id: orderId, reason: 'Test run, no money' } }), 'void');
  assert.equal(v.voided, true);
  const o = store.get('orders', orderId).fields;
  assert.deepEqual([o.status, o.voidReason, o.voidedByName], ['voided', 'Test run, no money', 'Akos Manager']);
  assert.equal(store.get('tickets', sale.ticketIds[0]).fields.cancelled, true);
  assert.equal(store.list('checkins').length, 0, 'the check-in is taken back');
  assert.equal(store.get('ticket_types', 'reg').fields.remaining, 50, 'back on sale');
  assert.equal(store.list('cash_sessions')[0].fields.payments.length, 0, 'not in the seller’s cash');
  const night = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'night');
  assert.deepEqual([night.sales.cashPesewas, night.sales.people], [0, 0], 'not in the door’s numbers');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'SALE_VOIDED' && a.fields.reason === 'Test run, no money'));
  assert.match((await call('POST', '/api/ops/sales/void', { who: 'mgr', body: { kind: 'gate', id: orderId, reason: 'again' } })).data.error, /already voided/);
});

test('who may void, and what can’t be voided', async () => {
  const { store, call } = setup();
  ok(await sell(call), 'sell');
  const orderId = store.list('orders').find(o => o.fields.channel === 'gate').id;
  for (const who of ['door', 'w1', 'org1']) assert.equal((await call('POST', '/api/ops/sales/void', { who, body: { kind: 'gate', id: orderId, reason: 'no money' } })).status, 403, who);
  assert.match((await call('POST', '/api/ops/sales/void', { who: 'mgr', body: { kind: 'gate', id: orderId, reason: '' } })).data.error, /Say why/);
  assert.equal(store.get('orders', orderId).fields.status, 'confirmed', 'nothing changed');
  // A MoMo door sale: real money moved through Paystack, so it is refunded, not voided.
  store.seed('orders', 'm1', { ...store.get('orders', orderId).fields, paidWith: 'momo', reference: 'ref1' });
  assert.match((await call('POST', '/api/ops/sales/void', { who: 'mgr', body: { kind: 'gate', id: 'm1', reason: 'no money' } })).data.error, /Paystack/);
});

test('voiding a tab: its drinks cancelled, its cash out of the seller’s session, status voided; a Paystack tab is refused', async () => {
  const { store, call } = setup();
  const date = new Date().toISOString().slice(0, 10);
  store.seed('cash_sessions', `${date}__w1`, { date, uid: 'w1', name: 'Efua Waiter', role: 'waitStaff', status: 'open', payments: [{ id: 'p1', tabId: 't1', tabNumber: 1, amountPesewas: 5000, at: new Date().toISOString() }], movements: [] });
  store.seed('tabs', 't1', { number: 1, businessDate: date, status: 'closed', waiterUid: 'w1', waiterName: 'Efua Waiter', payments: [{ id: 'p1', method: 'cash', amountPesewas: 5000, sessionId: `${date}__w1`, by: 'w1' }], discounts: [], createdAt: new Date().toISOString() });
  store.seed('rounds', 'r1', { tabId: 't1', status: 'delivered', lines: [{ lineId: 'l1', productId: 'p', name: 'Beer', unitPesewas: 2500, qty: 2 }], createdAt: new Date().toISOString() });
  store.seed('tabs', 't2', { number: 2, businessDate: date, status: 'closed', waiterUid: 'w1', payments: [{ id: 'p2', method: 'digital', amountPesewas: 3000 }], discounts: [], createdAt: new Date().toISOString() });

  assert.match((await call('POST', '/api/ops/sales/void', { who: 'dir', body: { kind: 'tab', id: 't2', reason: 'test' } })).data.error, /Paystack/);
  ok(await call('POST', '/api/ops/sales/void', { who: 'dir', body: { kind: 'tab', id: 't1', reason: 'Test run' } }), 'void tab');
  const t = store.get('tabs', 't1').fields;
  assert.deepEqual([t.status, t.payments.length, t.voidedPayments.length, t.voidReason], ['voided', 0, 1, 'Test run']);
  assert.equal(store.get('rounds', 'r1').fields.status, 'cancelled');
  assert.equal(store.get('cash_sessions', `${date}__w1`).fields.payments.length, 0);
});

test('test mode: sales are stamped, no SMS, no MoMo prompt; "clear test sales" voids them all and leaves real ones', async () => {
  const { store, call } = setup();
  assert.equal(ok(await call('GET', '/api/ops/test-mode', { who: 'mgr' }), 'status').on, false);
  assert.equal((await call('POST', '/api/ops/test-mode', { who: 'door', body: { on: true } })).status, 403);
  const real = ok(await sell(call, { quantity: 1 }), 'real sale'); // before test mode
  const smsBefore = store.sms.length;
  ok(await call('POST', '/api/ops/test-mode', { who: 'mgr', body: { on: true } }), 'on');
  ok(await sell(call), 'test sale');
  assert.equal(store.sms.length, smsBefore, 'no text to a real phone');
  assert.match((await sell(call, { method: 'momo' })).data.error, /Test mode is on/);
  assert.equal((store.paystackCharges || []).length, 0, 'no MoMo prompt sent');
  const gate = store.list('orders').filter(o => o.fields.channel === 'gate');
  assert.deepEqual(gate.map(o => !!o.fields.test).sort(), [false, true]);
  const s = ok(await call('GET', '/api/ops/test-mode', { who: 'mgr' }), 'status on');
  assert.deepEqual([s.on, s.testDoorSales, s.testPesewas], [true, 1, 20000]);

  assert.match((await call('POST', '/api/ops/sales/clear-test', { who: 'mgr', body: {} })).data.error, /Confirm/);
  const r = ok(await call('POST', '/api/ops/sales/clear-test', { who: 'mgr', body: { confirm: 'CLEAR' } }), 'clear');
  assert.equal(r.cleared, 1);
  const after = store.list('orders').filter(o => o.fields.channel === 'gate');
  assert.deepEqual(after.map(o => o.fields.status).sort(), ['confirmed', 'voided'], 'the real sale stays');
  assert.equal(store.get('ticket_types', 'reg').fields.remaining, 49, 'only the real ticket is sold');
  assert.equal(store.get('tickets', real.ticketIds[0]).fields.cancelled, false);
  ok(await call('POST', '/api/ops/test-mode', { who: 'mgr', body: { on: false } }), 'off');
  const live = ok(await sell(call, { quantity: 1 }), 'live again');
  assert.ok(live.test !== true);
  assert.ok(store.sms.length > smsBefore, 'texts are back on');
});
