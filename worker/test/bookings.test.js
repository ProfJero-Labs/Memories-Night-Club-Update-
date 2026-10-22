// Table bookings reach the team: a booking for a coming night shows on every serving screen from the
// moment it's paid (not only on the night), and the event managers and managers are texted who booked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker, { fulfillTable } from '../src/index.js';

function setup() {
  const { store, env } = createMockEnv();
  store.seed('events', 'tonight', { name: 'Tonight', date: new Date().toISOString(), active: true });
  store.seed('events', 'fri', { name: 'Afrobeats Friday', date: new Date(Date.now() + 3 * 864e5).toISOString(), active: true });
  store.seed('events', 'far', { name: 'Far away', date: new Date(Date.now() + 60 * 864e5).toISOString(), active: true });
  store.seed('table_packages', 'p1', { eventId: 'fri', name: 'Floor Table', pricePesewas: 350000, capacity: 8, remaining: 3, active: true });
  store.seed('users', 'em', { name: 'Esi Events', role: 'eventManager', phone: '0240000101' });
  store.seed('users', 'mg', { name: 'Kojo Manager', role: 'manager', phone: '0240000102' });
  store.seed('users', 'mg2', { name: 'Quiet Manager', role: 'manager', phone: '0240000103', bookingAlerts: false });
  store.seed('users', 'w1', { name: 'Efua Waiter', role: 'waitStaff', phone: '0240000104' });
  store.seed('pending_checkouts', 'refT', { reference: 'refT', kind: 'table', eventId: 'fri', eventName: 'Afrobeats Friday', packageId: 'p1', packageName: 'Floor Table', bottles: [{ id: 'b1', name: 'Dev Vodka', quantity: 2 }], amountPesewas: 350000, buyerName: 'Ama Mensah', buyerPhone: '0551234567', status: 'pending' });
  store.seed('bottles', 'b1', { name: 'Dev Vodka', pricePesewas: 90000, active: true });
  store.setPaystack('refT', { status: 'success', currency: 'GHS', amount: 350000 });
  const get = async (path, uid, role) => {
    const r = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${await idToken({ role }, { uid })}` } }), env);
    return { status: r.status, data: await r.json() };
  };
  return { store, env, get };
}

test('a table booked for a coming night is on the waiter’s and front office’s screens straight away', async () => {
  const { env, get } = setup();
  const r = await fulfillTable(env, 'refT');
  assert.equal(r.status, 'issued');
  for (const [uid, role] of [['w1', 'waitStaff'], ['mg', 'manager'], ['em', 'eventManager']]) {
    const d = (await get('/api/ops/tables', uid, role)).data;
    assert.equal(d.tables.length, 0, 'not tonight');
    assert.equal(d.upcoming.length, 1, `${role} sees the coming booking`);
    const b = d.upcoming[0];
    assert.deepEqual([b.name, b.packageName, b.eventName, b.phoneLast4, b.capacity], ['Ama Mensah', 'Floor Table', 'Afrobeats Friday', '4567', 8]);
    assert.equal(b.code, `TBL-${r.orderId.slice(0, 6).toUpperCase()}`);
  }
});

test('the event managers and managers are texted who booked (not anyone who turned it off, not waiters)', async () => {
  const { store, env } = setup();
  await fulfillTable(env, 'refT');
  const to = store.sms.map(s => s.to || s.phone);
  const alerts = store.sms.filter(s => /table booked/.test(s.message));
  assert.equal(alerts.length, 2, `two alerts, got ${JSON.stringify(to)}`);
  assert.match(alerts[0].message, /Floor Table · Afrobeats Friday/);
  assert.match(alerts[0].message, /Ama Mensah · 0551234567/);
  assert.match(alerts[0].message, /2 x Dev Vodka/);
  // Paid twice (webhook and return page): one booking, one set of alerts.
  await fulfillTable(env, 'refT');
  assert.equal(store.sms.filter(s => /table booked/.test(s.message)).length, 2);
});
