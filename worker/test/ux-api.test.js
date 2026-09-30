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
