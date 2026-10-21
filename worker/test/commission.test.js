// Commissions: 10% of a table deal over GHS 3,000 to the person who brought it, seen by the director,
// named by the waiter/manager/finance, paid by finance (one expense per payout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { nightKey } from '../src/lib/util.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'champ', { name: 'Champagne', category: 'Wine', unit: 'bottle', pricePesewas: 100000, costPesewas: 50000, available: true, tracked: true });
  store.seed('stock_moves', 'seed', { productId: 'champ', stationId: 'main', qty: 100, kind: 'received', businessDate: '2000-01-01' });
  const people = { b1: ['Ama Bartender', 'barStaff'], w1: ['Efua Waiter', 'waitStaff'], m1: ['Akos Manager', 'manager'], f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400000${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.95.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call, B1: as('b1'), W1: as('w1'), M1: as('m1'), F1: as('f1'), D1: as('d1') };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };

async function tableSpending(ctx, bottles, body = {}) {
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: 'VIP 1', ...body } }), 'open');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'champ', qty: bottles }] } }), 'round');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.id, action: 'hand' } }), 'hand');
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: tab.id, method: 'cash', amountPesewas: bottles * 100000 } }), 'paid');
  return tab;
}

test('a table over GHS 3,000 earns 10% for whoever brought it; the director sees it; finance pays it as one expense', async () => {
  const ctx = setup();
  const month = nightKey(new Date()).slice(0, 7);
  // In the club: GHS 4,000 (named by the waiter), and GHS 3,000 exactly (not over the line).
  const big = await tableSpending(ctx, 4, { broughtByName: 'Kojo Promoter', broughtByPhone: '0244999888' });
  await tableSpending(ctx, 3, { broughtByName: 'Kojo Promoter', broughtByPhone: '0244999888' });
  // Booked online: GHS 5,000, nobody named yet; and a small booking that doesn't count.
  ctx.store.seed('orders', 'bk1', { kind: 'table', status: 'confirmed', packageName: 'VIP Booth', eventName: 'Afro Friday', buyerName: 'Abena', amountPesewas: 500000, createdAt: new Date().toISOString() });
  ctx.store.seed('orders', 'bk2', { kind: 'table', status: 'confirmed', packageName: 'Table', amountPesewas: 200000, createdAt: new Date().toISOString() });
  ctx.store.seed('orders', 'tk1', { kind: 'ticket', status: 'confirmed', amountPesewas: 900000, createdAt: new Date().toISOString() });

  let c = ok(await ctx.call('GET', `/api/ops/commissions?month=${month}`, { who: ctx.D1 }), 'director sees');
  assert.deepEqual(c.deals.map(d => [d.kind, d.amountPesewas, d.commissionPesewas]).sort(), [['booking', 500000, 50000], ['tab', 400000, 40000]]);
  assert.deepEqual([c.totals.owedPesewas, c.totals.unassigned, c.totals.unassignedPesewas], [40000, 1, 50000]);
  assert.deepEqual([c.people[0].name, c.people[0].owedPesewas, c.canPay], ['Kojo Promoter', 40000, false]);

  // The manager names who brought the booking.
  assert.equal((await ctx.call('POST', '/api/ops/commissions/assign', { who: ctx.W1, body: { kind: 'booking', id: 'bk1', name: 'X' } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/commissions/assign', { who: ctx.M1, body: { kind: 'booking', id: 'bk1', name: 'Kojo Promoter', phone: '024 499 9888' } }), 'assign');
  c = ok(await ctx.call('GET', `/api/ops/commissions?month=${month}`, { who: ctx.D1 }), 'again');
  assert.deepEqual([c.people.length, c.people[0].deals, c.people[0].owedPesewas], [1, 2, 90000], 'same person by phone');

  // Finance pays Kojo: both deals marked paid, one expense of GHS 900 under Commissions.
  assert.equal((await ctx.call('POST', '/api/ops/commissions/pay', { who: ctx.D1, body: { month, key: c.people[0].key } })).status, 403, 'the director looks; finance pays');
  assert.match((await ctx.call('POST', '/api/ops/commissions/pay', { who: ctx.F1, body: { month, key: c.people[0].key } })).data.error, /director must approve/);
  ok(await ctx.call('POST', '/api/ops/commissions/request', { who: ctx.F1, body: { month, key: c.people[0].key } }), 'finance asks');
  const todo = ok(await ctx.call('GET', '/api/ops/to-approve', { who: ctx.D1 }), 'director list');
  const item = todo.items.find(i => i.kind === 'commission');
  assert.equal(item.amountPesewas, 90000);
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'commission', id: item.id, approve: true } }), 'director approves');
  const paid = ok(await ctx.call('POST', '/api/ops/commissions/pay', { who: ctx.F1, body: { month, key: c.people[0].key, paidWith: 'momo' } }), 'pay');
  assert.deepEqual([paid.amountPesewas, paid.deals], [90000, 2]);
  assert.match((await ctx.call('POST', '/api/ops/commissions/pay', { who: ctx.F1, body: { month, key: c.people[0].key } })).data.error, /Nothing is owed/);
  c = ok(await ctx.call('GET', `/api/ops/commissions?month=${month}`, { who: ctx.F1 }), 'after');
  assert.deepEqual([c.totals.owedPesewas, c.totals.paidPesewas], [0, 90000]);
  assert.match((await ctx.call('POST', '/api/ops/commissions/assign', { who: ctx.M1, body: { kind: 'tab', id: big.id, name: 'Someone else' } })).data.error, /already paid/);
  const m = ok(await ctx.call('GET', '/api/ops/money?period=month', { who: ctx.D1 }), 'money');
  assert.equal(m.moneyOut.find(x => x.key === 'commission').amountPesewas, 90000, 'a payout counts in Money out');
});
