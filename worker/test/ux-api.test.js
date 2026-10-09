// What the public pages need to keep a guest's next step obvious (see docs/ux-debt.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';

const FUTURE = '2099-10-02T22:00:00.000Z';
const get = async (env, path) => (await worker.fetch(new Request(`https://worker.test${path}`, { headers: { 'CF-Connecting-IP': '10.6.0.1' } }), env)).json();

test('the nights list carries the cheapest ticket still on sale, for "Get tickets · from GHS 100"', async () => {
  const { store, env } = createMockEnv();
  store.seed('events', 'n1', { name: 'Afrobeats Friday', visibility: 'public', active: true, date: FUTURE });
  store.seed('events', 'n2', { name: 'No tickets yet', visibility: 'public', active: true, date: FUTURE });
  store.seed('ticket_types', 'early', { eventId: 'n1', name: 'Early bird', pricePesewas: 7000, remaining: 0, active: true });
  store.seed('ticket_types', 'reg', { eventId: 'n1', name: 'Regular', pricePesewas: 10000, remaining: 20, active: true });
  store.seed('ticket_types', 'vip', { eventId: 'n1', name: 'VIP', pricePesewas: 30000, remaining: null, active: true });
  store.seed('ticket_types', 'off', { eventId: 'n1', name: 'Hidden', pricePesewas: 500, active: false });
  const { events } = await get(env, '/api/events');
  assert.equal(events.find(e => e.id === 'n1').fromPesewas, 10000, 'sold-out and switched-off tickets are skipped');
  assert.equal(events.find(e => e.id === 'n2').fromPesewas, null);
});

test('lost your ticket: same reply for any number; links go only to that phone, only for nights still to come', async () => {
  const { store, env } = createMockEnv();
  const post = async (phone, ip) => {
    const res = await worker.fetch(new Request('https://worker.test/api/tickets/find', { method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ phone }) }), env);
    return { status: res.status, text: await res.text() };
  };
  store.seed('events', 'soon', { name: 'Afrobeats Friday', visibility: 'public', active: true, date: FUTURE });
  store.seed('events', 'gone', { name: 'Last Month', visibility: 'public', active: true, date: '2020-01-01T22:00:00.000Z' });
  const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), OLD = 'c'.repeat(64), OTHER = 'd'.repeat(64);
  store.seed('orders', 'o1', { kind: 'ticket', status: 'confirmed', eventId: 'soon', buyerPhone: '0241234567', ticketIds: [T1, T2] });
  store.seed('orders', 'o2', { kind: 'ticket', status: 'confirmed', eventId: 'gone', buyerPhone: '0241234567', ticketIds: [OLD] });
  store.seed('orders', 'o3', { kind: 'ticket', status: 'confirmed', eventId: 'soon', buyerPhone: '0551112222', ticketIds: [OTHER] });

  const known = await post('+233 24 123 4567', '10.5.0.1');
  const unknown = await post('0209999999', '10.5.0.2');
  assert.equal(known.status, 200); assert.equal(known.text, unknown.text, 'the page can’t tell who has tickets');
  assert.equal(store.sms.length, 1);
  assert.equal(store.sms[0].to, '0241234567');
  for (const t of [T1, T2]) assert.ok(store.sms[0].message.includes(t));
  assert.ok(!store.sms[0].message.includes(OLD), 'nights that have passed are left out');
  assert.ok(!store.sms[0].message.includes(OTHER), 'never someone else’s ticket');
  for (const t of [T1, T2, OLD, OTHER]) assert.ok(!known.text.includes(t), 'no link on the page itself');

  const bad = await post('12345', '10.5.0.3');
  assert.equal(bad.status, 400);
});

test('lost your ticket is rate limited per phone, whatever the IP', async () => {
  const { env } = createMockEnv();
  let last;
  for (let i = 0; i < 12; i++) last = await worker.fetch(new Request('https://worker.test/api/tickets/find', { method: 'POST', headers: { 'CF-Connecting-IP': `10.4.0.${i}` }, body: JSON.stringify({ phone: '0241234567' }) }), env);
  assert.equal(last.status, 429);
});

test('the overview shows a 7-day checkout funnel: started, paid, left at Paystack, failed', async () => {
  const { store, env } = createMockEnv();
  const { adminOverview } = await import('../src/index.js');
  const ago = min => new Date(Date.now() - min * 60e3).toISOString();
  store.seed('pending_checkouts', 'a', { status: 'issued', createdAt: ago(60) });
  store.seed('pending_checkouts', 'b', { status: 'issued', createdAt: ago(600) });
  store.seed('pending_checkouts', 'c', { status: 'failed', createdAt: ago(90) });
  store.seed('pending_checkouts', 'd', { status: 'pending', createdAt: ago(45) });
  store.seed('pending_checkouts', 'e', { status: 'pending', createdAt: ago(2) });
  store.seed('pending_checkouts', 'old', { status: 'issued', createdAt: ago(8 * 1440) });
  const d = await adminOverview(env, { role: 'manager' });
  assert.deepEqual(d.funnel, { started: 5, paid: 2, failed: 1, abandoned: 1, waiting: 1 });
});
