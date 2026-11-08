// A table's price is its minimum spend. At the club, a waiter links the table's bill to its booking:
// a table paid at the gate gets that payment as credit (never table price + drinks), and a table
// reserved online can't come to less than its minimum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };

function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('events', 'ev1', { name: 'Afrobeats Friday', date: new Date().toISOString(), active: true, visibility: 'public' });
  store.seed('table_packages', 'vip', { eventId: 'ev1', name: 'VIP table', pricePesewas: 300000, capacity: 8, remaining: 3, active: true });
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'magnum', { name: 'Magnum', category: 'Bottles', pricePesewas: 100000, costPesewas: 50000, available: true, tracked: true });
  store.seed('stock_moves', 'in-magnum', { productId: 'magnum', stationId: 'main', qty: 30, kind: 'received', businessDate: '2000-01-01' });
  const people = { door: ['Kofi Door', 'doorStaff'], w1: ['Efua Waiter', 'waitStaff'], w2: ['Yaa Waiter', 'waitStaff'], m1: ['Akos Manager', 'manager'], f1: ['Fiifi Finance', 'finance'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400007${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.99.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const gateTable = async (phone = '0245551234') => {
    ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', packageId: 'vip', phone, name: 'Kwame', method: 'cash' } }), 'gate sale');
    return store.list('orders').find(o => o.fields.channel === 'gate' && o.fields.buyerPhone === phone.replace(/\s/g, '')).id;
  };
  const order = (body, who = 'w1') => call('POST', '/api/ops/tabs/order', { who, body: { lines: [{ productId: 'magnum', qty: 1 }], ...body } });
  const bill = async tabId => ok(await call('GET', `/api/ops/tab?id=${tabId}`, { who: 'w1' }), 'tab').tab.bill;
  return { store, call, gateTable, order, bill };
}

test('a table paid at the gate: its payment counts towards the drinks, never table price + drinks', async () => {
  const { store, call, gateTable, order, bill } = setup();
  const orderId = await gateTable();
  assert.match(store.sms.at(-1).message, /minimum spend and counts towards your drinks/);
  // GHS 1,000 of drinks, under the GHS 3,000 paid at the gate: nothing more to pay.
  const o = ok(await order({ table: '5', bookingId: orderId }), 'order');
  let b = await bill(o.tabId);
  assert.deepEqual([b.grossPesewas, b.minimumTopUpPesewas, b.prepaidPesewas, b.totalPesewas, b.balancePesewas, b.status], [100000, 200000, 300000, 0, 0, 'paid'], 'GHS 2,000 of the minimum still to spend, already paid');
  assert.equal(store.get('orders', orderId).fields.tabId, o.tabId, 'the booking knows its bill');
  // Four bottles (GHS 4,000): only what's over the GHS 3,000 is owed.
  ok(await order({ tabId: o.tabId, lines: [{ productId: 'magnum', qty: 3 }] }), 'more');
  b = await bill(o.tabId);
  assert.deepEqual([b.grossPesewas, b.minimumTopUpPesewas, b.prepaidPesewas, b.totalPesewas, b.balancePesewas], [400000, 0, 300000, 100000, 100000]);
  // The night's money: the table once (GHS 3,000 at the gate) plus the GHS 1,000 over it, not GHS 7,000.
  const n = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'finance');
  assert.equal(n.sales.netProductPesewas, 400000);
  const invoice = (await import('../src/ops/tabs.js')).invoiceText({ PUBLIC_SITE_URL: 'https://memories.test' }, store.get('tabs', o.tabId).fields, b);
  assert.match(invoice, /Table paid at the gate -GHS 3,000/);
});

test('a reserved table (nothing paid yet): the bill is at least the minimum spend', async () => {
  const { store, call, order, bill } = setup();
  ok(await call('POST', '/api/table-reserve', { body: { eventId: 'ev1', packageId: 'vip', name: 'Efua Mensah', phone: '0551234567', arriveTime: new Date(Math.ceil(Date.now() / 18e5) * 18e5).toISOString().slice(11, 16) } }), 'reserve');
  const orderId = store.list('orders')[0].id;
  // Not seated yet: it can't be linked.
  assert.match((await order({ table: '7', bookingId: orderId })).data.error, /seated/);
  store.seed('orders', orderId, { ...store.get('orders', orderId).fields, arrivedAt: new Date().toISOString() }); // the door seats them
  const o = ok(await order({ table: '8', bookingId: orderId }), 'order');
  const b = await bill(o.tabId);
  assert.deepEqual([b.grossPesewas, b.minimumTopUpPesewas, b.prepaidPesewas, b.totalPesewas], [100000, 200000, 0, 300000]);
});

test('linking later, once per booking; a bill linked to another booking is refused', async () => {
  const { call, gateTable, order, bill } = setup();
  const a = await gateTable('0245550001'), c = await gateTable('0245550002');
  const t1 = ok(await order({ table: '1' }), 't1'), t2 = ok(await order({ table: '2' }, 'w2'), 't2');
  assert.equal((await bill(t1.tabId)).totalPesewas, 100000, 'not linked: an ordinary bill');
  ok(await call('POST', '/api/ops/tabs/booking', { who: 'w1', body: { tabId: t1.tabId, orderId: a } }), 'link');
  assert.equal((await bill(t1.tabId)).totalPesewas, 0);
  assert.match((await call('POST', '/api/ops/tabs/booking', { who: 'w2', body: { tabId: t2.tabId, orderId: a } })).data.error, /already on Tab/);
  assert.match((await call('POST', '/api/ops/tabs/booking', { who: 'w1', body: { tabId: t1.tabId, orderId: c } })).data.error, /already linked/);
  assert.equal((await call('POST', '/api/ops/tabs/booking', { who: 'w1', body: { tabId: t2.tabId, orderId: c } })).status, 403, 'not their table');
});
