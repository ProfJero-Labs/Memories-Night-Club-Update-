// Tables are reserved online with no payment (owner's rule, November 2026): the customer gives the
// time they'll arrive; the table is held for an hour after it; no-shows lose the hold, nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { arrivalFor } from '../src/checkout.js';

function setup() {
  const { store, env } = createMockEnv();
  store.seed('events', 'fri', { name: 'Friday', date: '2099-01-01T22:00:00Z', active: true, visibility: 'public' });
  store.seed('table_packages', 'vip', { eventId: 'fri', name: 'VIP Table', pricePesewas: 300000, capacity: 8, remaining: 1, active: true });
  store.seed('users', 'm1', { name: 'Akos Manager', role: 'manager', phone: '0240001111' });
  let ip = 0;
  const call = async (method, path, body, role) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.77.0.${++ip}` };
    if (role) headers.Authorization = `Bearer ${await idToken({ role })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const reserve = (b = {}) => call('POST', '/api/table-reserve', { eventId: 'fri', packageId: 'vip', name: 'Efua Mensah', phone: '0551234567', arriveTime: '23:30', ...b });
  const seat = code => call('POST', '/api/checkin', { table: code, eventId: 'fri' }, 'doorStaff').then(r => r.data);
  return { store, env, call, reserve, seat };
}

test('the arrival time is on the night: after midnight counts as the early hours; outside the night is refused', () => {
  const start = '2099-01-01T22:00:00Z';
  assert.equal(arrivalFor(start, '23:30'), '2099-01-01T23:30:00.000Z');
  assert.equal(arrivalFor(start, '01:00'), '2099-01-02T01:00:00.000Z');
  assert.equal(arrivalFor(start, '22:00'), '2099-01-01T22:00:00.000Z');
  for (const bad of ['21:00', '05:00', '', '25:00', 'soon']) assert.equal(arrivalFor(start, bad), null, bad);
});

test('reserving a table: no payment, the table is held, the customer is told when it’s held until', async () => {
  const { store, reserve } = setup();
  const r = await reserve();
  assert.equal(r.status, 200, r.data.error);
  assert.equal(r.data.reserved, true);
  assert.equal(store.paystackInits.length, 0, 'nothing sent to Paystack');
  const o = store.list('orders')[0].fields;
  assert.deepEqual([o.kind, o.status, o.reservation, o.amountPesewas, o.arriveAt, o.holdUntil], ['table', 'confirmed', true, 0, '2099-01-01T23:30:00.000Z', '2099-01-02T00:30:00.000Z']);
  assert.equal(store.get('table_packages', 'vip').fields.remaining, 0, 'the table is held');
  const sms = store.sms.find(s => s.to.endsWith('551234567'));
  assert.match(sms.message, /Table reserved/);
  assert.match(sms.message, /Nothing to pay now/);
  assert.match(sms.message, /until 12:30/i);
  assert.ok(store.sms.some(s => s.to.endsWith('240001111') && /table reserved/i.test(s.message) && /not paid/.test(s.message)), 'the Manager is told');
});

test('the table price is its minimum spend: picked drinks count towards it, and a drink not on the menu can be asked for', async () => {
  const { store, reserve } = setup();
  store.seed('bottles', 'hen', { eventId: 'all', name: 'Hennessy VS', pricePesewas: 120000, active: true });
  store.seed('bottles', 'moet', { eventId: 'fri', name: 'Moët', pricePesewas: 90000, active: true });
  store.seed('bottles', 'gone', { eventId: 'fri', name: 'Old bottle', pricePesewas: 50000, active: false });
  const r = await reserve({ bottles: [{ id: 'hen', quantity: 1, pricePesewas: 1 }, { id: 'moet', quantity: 1 }], drinkRequest: '  A bottle of Don Julio 1942  ' });
  assert.equal(r.status, 200, r.data.error);
  assert.deepEqual([r.data.minSpendPesewas, r.data.drinksPesewas, r.data.billPesewas], [300000, 210000, 300000], 'under the minimum: the bill is the minimum, not table + drinks');
  const o = store.list('orders')[0].fields;
  assert.deepEqual([o.amountPesewas, o.minSpendPesewas, o.drinksPesewas, o.billPesewas, o.drinkRequest], [0, 300000, 210000, 300000, 'A bottle of Don Julio 1942']);
  assert.deepEqual(o.bottles.map(b => [b.name, b.quantity, b.unitPricePesewas]), [['Hennessy VS', 1, 120000], ['Moët', 1, 90000]], 'prices from the menu, not the browser');
  const sms = store.sms.find(s => s.to.endsWith('551234567')).message;
  assert.match(sms, /Minimum spend GHS 3,000/);
  assert.match(sms, /GHS 900 left to spend/);
  assert.match(sms, /Don Julio 1942/);
  assert.ok(store.sms.some(s => s.to.endsWith('240001111') && /Request: A bottle of Don Julio 1942/.test(s.message)), 'the Manager sees the request');
  // A bottle no longer on the menu is refused.
  assert.match((await reserve({ phone: '0201112222', bottles: [{ id: 'gone', quantity: 1 }] })).data.error, /isn’t available/);
});

test('drinks over the minimum: the drinks are the bill', async () => {
  const { store, reserve } = setup();
  store.seed('bottles', 'hen', { eventId: 'all', name: 'Hennessy VS', pricePesewas: 120000, active: true });
  const r = await reserve({ bottles: [{ id: 'hen', quantity: 3 }] });
  assert.equal(r.status, 200, r.data.error);
  assert.deepEqual([r.data.minSpendPesewas, r.data.drinksPesewas, r.data.billPesewas], [300000, 360000, 360000]);
  assert.doesNotMatch(store.sms.find(s => s.to.endsWith('551234567')).message, /left to spend/);
});

test('refused: no arrival time, a full night, a second table on the same phone; the old pay-online page is asked to refresh', async () => {
  const { store, call, reserve } = setup();
  assert.match((await reserve({ arriveTime: '' })).data.error, /time you’ll arrive/);
  assert.match((await reserve({ name: '' })).data.error, /name/);
  assert.equal((await reserve()).status, 200);
  assert.match((await reserve()).data.error, /already has a table/);
  assert.match((await reserve({ phone: '0201112222' })).data.error, /fully booked/);
  const old = await call('POST', '/api/table-checkout/initiate', { eventId: 'fri', packageId: 'vip', name: 'Ama', phone: '0241234567' });
  assert.equal(old.status, 410);
  assert.match(old.data.error, /no payment/);
  assert.equal(store.paystackInits.length, 0);
});

test('at the door: seated within the hold; after it, the table is freed; a late arrival is seated only if one is still free', async () => {
  const { store, reserve, seat, call } = setup();
  const code = (await reserve()).data.code;
  const ok = await seat(code);
  assert.equal(ok.code, 'seated');
  assert.match(ok.ticket.note, /pay at the club/);

  // A second reservation whose hold has passed with nobody here.
  store.seed('table_packages', 'vip', { ...store.get('table_packages', 'vip').fields, remaining: 1 });
  const late = (await reserve({ phone: '0209998888', name: 'Kofi Late' })).data.code;
  const lateId = store.list('orders').find(o => o.fields.buyerName === 'Kofi Late').id;
  store.seed('orders', lateId, { ...store.get('orders', lateId).fields, holdUntil: '2000-01-01T00:00:00.000Z' });
  const view = await call('GET', '/api/ops/tables?date=2099-01-01', null, 'manager');
  assert.match(view.data.tables.find(t => t.name === 'Kofi Late').holdLine, /Hold ended/);
  // Another table is sold at the gate meanwhile: nothing free when Kofi arrives.
  await seat('TBL-NOPE');
  assert.equal(store.get('table_packages', 'vip').fields.remaining, 1, 'freed when the hold ended');
  assert.equal(store.get('orders', lateId).fields.released, true);
  store.seed('table_packages', 'vip', { ...store.get('table_packages', 'vip').fields, remaining: 0 });
  const full = await seat(late);
  assert.equal(full.code, 'hold_ended');
  // A table frees up: now he's seated, and it's taken again.
  store.seed('table_packages', 'vip', { ...store.get('table_packages', 'vip').fields, remaining: 1 });
  assert.equal((await seat(late)).code, 'seated');
  assert.equal(store.get('table_packages', 'vip').fields.remaining, 0);
  assert.equal(store.get('orders', lateId).fields.released, false);
});

test('staff screens say which tables are reserved (pay at the club) and which were paid online; a paid booking from before is honoured at the door', async () => {
  const { store, reserve, seat, call } = setup();
  await reserve();
  store.seed('orders', 'paidbook01', { kind: 'table', status: 'confirmed', eventId: 'fri', eventName: 'Friday', packageId: 'vip', packageName: 'VIP Table', amountPesewas: 300000, buyerName: 'Paid Before', buyerPhone: '0277777777', createdAt: '2098-12-30T10:00:00Z' });
  assert.equal((await seat('TBL-PAIDBO')).code, 'seated');
  const t = await call('GET', '/api/ops/tables?date=2099-01-01', null, 'manager');
  assert.deepEqual(t.data.tables.map(x => x.holdLine).sort(), ['Paid online', 'Reserved: pays at the club · arriving 11:30 PM, held until 12:30 AM'].sort());
});
