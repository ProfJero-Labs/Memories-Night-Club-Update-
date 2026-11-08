// What moves to the new database: the club's setup (drinks, bars, staff, the upcoming event), never sales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { listDocs, queryWhere } from '../src/lib/firestore.js';
import { planSetupCopy, countsOf, PIN_FIELDS } from '../src/lib/setup-copy.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
function seeded() {
  const { store, env } = createMockEnv();
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', pricePesewas: 2500, costPesewas: 1200 });
  store.seed('menu_items', 'gin', { name: 'Gin', category: 'Bottles', pricePesewas: 90000 });
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('users', 'u1', { name: 'Efua', role: 'waitStaff', phone: '0245550001', pinHash: 'x', pinSalt: 'y', pinFails: 2, lockedUntil: 'z', sessionsFrom: 'q', sharePct: 0 });
  store.seed('users', 'd1', { name: 'Nana', role: 'director', phone: '0245550002', pinHash: 'x', sharePct: 35 });
  store.seed('users', 'gone', { name: 'Left', role: 'waitStaff', phone: '0245550003', removed: true });
  store.seed('members', 'm-staff', { name: 'Efua', staffUid: 'u1' });
  store.seed('members', 'm-guest', { name: 'A Guest', phone: '0209999999' });
  store.seed('events', 'fri14', { name: 'Friday 14th', date: '2026-11-14T22:00:00Z', active: true, artwork: 'https://res.cloudinary.com/x/flyer.webp' });
  store.seed('events', 'old', { name: 'Last month', date: '2026-10-10T22:00:00Z', active: true });
  store.seed('events', 'off', { name: 'Switched off', date: '2026-11-21T22:00:00Z', active: false });
  store.seed('ticket_types', 'reg', { eventId: 'fri14', name: 'Regular', pricePesewas: 8000, remaining: 90 });
  store.seed('ticket_types', 'oldreg', { eventId: 'old', name: 'Old', pricePesewas: 5000 });
  store.seed('table_packages', 'vip', { eventId: 'fri14', name: 'VIP table', pricePesewas: 300000, remaining: 2 });
  store.seed('bottles', 'b1', { eventId: 'fri14', name: 'Magnum', pricePesewas: 150000 });
  store.seed('bottles', 'ball', { eventId: 'all', name: 'House bottle', pricePesewas: 60000 });
  // The test sales: none of this may move.
  store.seed('tabs', 't1', { number: 1 }); store.seed('rounds', 'r1', { tabId: 't1' }); store.seed('orders', 'o1', { kind: 'ticket' });
  store.seed('tickets', 'k1', { eventId: 'fri14' }); store.seed('payment_ledger', 'p1', { amountPesewas: 100 }); store.seed('stock_moves', 's1', { qty: 5 });
  store.seed('cash_sessions', 'c1', {}); store.seed('expenses', 'e1', {}); store.seed('audit_logs', 'a1', {});
  return { env, readers: { listDocs: c => listDocs(env, c), queryWhere: (c, f) => queryWhere(env, c, f) } };
}

test('only the setup moves: drinks, bars, staff (no removed ones), staff passes, and the upcoming event with its tickets, tables and bottles', async () => {
  const { readers } = seeded();
  const { plan, notes } = await planSetupCopy(readers, { now: NOW });
  assert.deepEqual(countsOf(plan), { menu_items: 2, bar_stations: 1, users: 2, members: 1, events: 1, ticket_types: 1, table_packages: 1, bottles: 2 });
  assert.deepEqual(plan.filter(p => p.col === 'events').map(p => p.id), ['fri14'], 'not last month’s, not the switched-off one');
  assert.deepEqual(plan.filter(p => p.col === 'members').map(p => p.id), ['m-staff'], 'staff passes only, not guests');
  assert.ok(!plan.some(p => p.id === 'gone'), 'a removed staff member stays behind');
  assert.ok(!plan.some(p => ['tabs', 'rounds', 'orders', 'tickets', 'payment_ledger', 'stock_moves', 'cash_sessions', 'expenses', 'audit_logs'].includes(p.col)), 'no test sales, counts or logs');
  assert.equal(plan.find(p => p.id === 'fri14').fields.artwork, 'https://res.cloudinary.com/x/flyer.webp', 'the flyer link comes with it (the picture itself stays on Cloudinary)');
  assert.ok(notes.some(n => /left/.test(n)), 'warns that "left" counts may have been reduced by test sales');
});

test('staff PINs and sign-in state are dropped (new PINs), but their share and roles stay; --keep-pins keeps them', async () => {
  const { readers } = seeded();
  const { plan } = await planSetupCopy(readers, { now: NOW });
  const efua = plan.find(p => p.id === 'u1').fields, nana = plan.find(p => p.id === 'd1').fields;
  for (const k of PIN_FIELDS) { assert.ok(!(k in efua), `${k} dropped`); assert.ok(!(k in nana), `${k} dropped`); }
  assert.deepEqual([efua.name, efua.role, efua.phone, nana.role, nana.sharePct], ['Efua', 'waitStaff', '0245550001', 'director', 35]);
  const kept = (await planSetupCopy(readers, { now: NOW, keepPins: true })).plan.find(p => p.id === 'u1').fields;
  assert.equal(kept.pinHash, 'x');
});

test('no upcoming event: it says so', async () => {
  const { readers } = seeded();
  const { plan, notes } = await planSetupCopy(readers, { now: Date.parse('2027-01-01T00:00:00Z') });
  assert.equal(plan.filter(p => p.col === 'events').length, 0);
  assert.ok(notes.some(n => /No upcoming event/.test(n)));
});
