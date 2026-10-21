// The director's money: money in (drinks paid, the club's share of tickets and tables), money out
// (drinks bought, expenses), profit; drinks sold against what they cost. Expenses by the manager
// and finance; taken off with a reason, never deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  const people = { b1: ['Ama Bartender', 'barStaff'], w1: ['Efua Waiter', 'waitStaff'], m1: ['Akos Manager', 'manager'], f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400000${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.80.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call, B1: as('b1'), W1: as('w1'), M1: as('m1'), F1: as('f1'), D1: as('d1') };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const amount = (rows, key) => rows.find(r => r.key === key)?.amountPesewas;

test('money in, money out, profit: drinks bought and sold, the club’s ticket share, expenses', async () => {
  const ctx = setup();
  ok(await ctx.call('POST', '/api/ops/stock/received', { who: ctx.F1, body: { stationId: 'main', productId: 'beer', qty: 24, totalCostPesewas: 28800 } }), 'finance buys 24 beers for GHS 288');
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 3 }], method: 'cash' } }), 'bar sells 3');
  // A ticket bought online tonight: GHS 100, of which the club's share is GHS 70.
  ctx.store.seed('orders', 'o1', { kind: 'ticket', status: 'confirmed', quantity: 1, amountPesewas: 10000, shares: { memoriesSharePesewas: 7000 }, createdAt: new Date().toISOString() });
  ctx.store.seed('orders', 'comp', { kind: 'ticket', status: 'confirmed', quantity: 1, amountPesewas: 0, createdAt: new Date().toISOString() });

  assert.equal((await ctx.call('POST', '/api/ops/expenses', { who: ctx.W1, body: { category: 'dj', description: 'DJ', amountPesewas: 20000 } })).status, 403, 'waiters don’t record expenses');
  assert.match((await ctx.call('POST', '/api/ops/expenses', { who: ctx.M1, body: { category: 'dj', amountPesewas: 20000 } })).data.error, /Say what it was/);
  const e = ok(await ctx.call('POST', '/api/ops/expenses', { who: ctx.M1, body: { category: 'dj', description: 'DJ Kofi, Saturday', amountPesewas: 20000, paidWith: 'momo' } }), 'manager adds');
  ok(await ctx.call('POST', '/api/ops/expenses', { who: ctx.F1, body: { category: 'power', description: 'ECG prepaid', amountPesewas: 5000 } }), 'finance adds');

  const m = ok(await ctx.call('GET', '/api/ops/money?period=today', { who: ctx.D1 }), 'director');
  assert.deepEqual([amount(m.moneyIn, 'drinks'), amount(m.moneyIn, 'tickets'), amount(m.moneyIn, 'tables')], [7500, 7000, 0]);
  assert.deepEqual([amount(m.moneyOut, 'drinks_bought'), amount(m.moneyOut, 'dj'), amount(m.moneyOut, 'power')], [28800, 20000, 5000]);
  assert.deepEqual([m.totals.inPesewas, m.totals.outPesewas, m.totals.profitPesewas], [14500, 53800, -39300]);
  assert.deepEqual([m.drinks.soldPesewas, m.drinks.costPesewas, m.drinks.profitPesewas], [7500, 3600, 3900], '3 beers: sold GHS 75, cost GHS 36');
  assert.match(m.summary, /GHS 393 loss/);
  assert.equal(m.byNight.length, 1);

  // Taken off: with a reason, kept on record, out of the totals.
  assert.match((await ctx.call('POST', '/api/ops/expenses/remove', { who: ctx.M1, body: { id: e.id } })).data.error, /Say why/);
  ok(await ctx.call('POST', '/api/ops/expenses/remove', { who: ctx.M1, body: { id: e.id, reason: 'Entered twice' } }), 'removed');
  const m2 = ok(await ctx.call('GET', '/api/ops/money?period=week', { who: ctx.F1 }), 'finance');
  assert.equal(m2.totals.outPesewas, 33800);
  assert.deepEqual([m2.expenses.find(x => x.id === e.id).removed, m2.expenses.find(x => x.id === e.id).removedReason], [true, 'Entered twice']);
  assert.equal((await ctx.call('GET', '/api/ops/money', { who: ctx.W1 })).status, 403, 'waiters don’t see the club’s money');
});
