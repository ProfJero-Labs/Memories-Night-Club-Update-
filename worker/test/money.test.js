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

test('money in, money out, profit: drinks bought and sold, table bookings (tickets left out), expenses', async () => {
  const ctx = setup();
  ok(await ctx.call('POST', '/api/ops/stock/received', { who: ctx.F1, body: { stationId: 'main', productId: 'beer', qty: 24, totalCostPesewas: 28800 } }), 'finance buys 24 beers for GHS 288');
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 3 }], method: 'cash' } }), 'bar sells 3');
  // A table booked online tonight: GHS 100, of which the club's share is GHS 70. A ticket is left out.
  ctx.store.seed('orders', 'o1', { kind: 'table', status: 'confirmed', quantity: 1, amountPesewas: 10000, shares: { memoriesSharePesewas: 7000 }, createdAt: new Date().toISOString() });
  ctx.store.seed('orders', 't1', { kind: 'ticket', status: 'confirmed', quantity: 2, amountPesewas: 20000, shares: { memoriesSharePesewas: 14000 }, createdAt: new Date().toISOString() });

  // Finance sets how much one expense can be without a director (GHS 500).
  ok(await ctx.call('POST', '/api/ops/budget', { who: ctx.F1, body: { month: new Date().toISOString().slice(0, 7), lines: {}, expenseLimitPesewas: 50000 } }), 'limit');
  assert.equal((await ctx.call('POST', '/api/ops/expenses', { who: ctx.W1, body: { category: 'dj', description: 'DJ', amountPesewas: 20000 } })).status, 403, 'waiters don’t record expenses');
  assert.match((await ctx.call('POST', '/api/ops/expenses', { who: ctx.M1, body: { category: 'dj', amountPesewas: 20000 } })).data.error, /Say what it was/);
  const e = ok(await ctx.call('POST', '/api/ops/expenses', { who: ctx.M1, body: { category: 'dj', description: 'DJ Kofi, Saturday', amountPesewas: 20000, paidWith: 'momo' } }), 'manager adds');
  ok(await ctx.call('POST', '/api/ops/expenses', { who: ctx.F1, body: { category: 'power', description: 'ECG prepaid', amountPesewas: 5000 } }), 'finance adds');

  const m = ok(await ctx.call('GET', '/api/ops/money?period=today', { who: ctx.D1 }), 'director');
  assert.deepEqual([amount(m.moneyIn, 'drinks'), amount(m.moneyIn, 'tables'), amount(m.moneyIn, 'tickets')], [7500, 7000, undefined], 'no tickets');
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

test('two directors (35% and 65%): each sees the profit and their own share; only the system admin sets shares', async () => {
  const { store, env } = createMockEnv();
  store.seed('users', 'd1', { name: 'Nana Director', role: 'director', phone: '0240000101', sharePct: 0 });
  store.seed('users', 'd2', { name: 'Kwame Director', role: 'director', phone: '0240000102' });
  store.seed('users', 'f1', { name: 'Esi Finance', role: 'finance', phone: '0240000103' });
  let n = 0;
  const call = async (method, path, who, body) => {
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.81.0.${++n}`, Authorization: `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}` }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const ADMIN = { uid: 'adm', role: 'superAdmin' }, D1 = { uid: 'd1', role: 'director' }, D2 = { uid: 'd2', role: 'director' }, F1 = { uid: 'f1', role: 'finance' };
  assert.equal((await call('POST', '/api/admin/people/update', D1, { uid: 'd1', sharePct: 100 })).status, 403, 'a director can’t set shares');
  assert.equal((await call('POST', '/api/admin/people/update', ADMIN, { uid: 'd1', sharePct: 35 })).status, 200);
  assert.match((await call('POST', '/api/admin/people/update', ADMIN, { uid: 'd2', sharePct: 70 })).data.error, /more than 100/);
  assert.equal((await call('POST', '/api/admin/people/update', ADMIN, { uid: 'd2', sharePct: 65 })).status, 200);
  assert.equal((await call('POST', '/api/ops/budget', F1, { month: new Date().toISOString().slice(0, 7), lines: {}, expenseLimitPesewas: 200000 })).status, 200);
  assert.equal((await call('POST', '/api/ops/expenses', F1, { category: 'rent', description: 'Rent', amountPesewas: 100000 })).status, 200);
  const m1 = (await call('GET', '/api/ops/money?period=today', D1)).data, m2 = (await call('GET', '/api/ops/money?period=today', D2)).data;
  assert.deepEqual(m1.owners.map(o => [o.name, o.pct, o.profitPesewas]), [['Kwame Director', 65, -65000], ['Nana Director', 35, -35000]]);
  assert.deepEqual([m1.myShare.pct, m1.myShare.profitPesewas, m2.myShare.pct], [35, -35000, 65]);
  assert.equal((await call('GET', '/api/ops/money?period=today', F1)).data.myShare, null);
});

test('the expense limit finance sets in the budget: at or under it counts at once; above it waits for a director; no limit set, every expense waits', async () => {
  const { store, env } = createMockEnv();
  for (const [uid, name, role] of [['m1', 'Akos Manager', 'manager'], ['f1', 'Esi Finance', 'finance'], ['d1', 'Nana Director', 'director']]) store.seed('users', uid, { name, role, phone: `024000020${uid.slice(1)}` });
  let n = 0;
  const call = async (method, path, who, body) => {
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.82.0.${++n}`, Authorization: `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}` }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const M1 = { uid: 'm1', role: 'manager' }, F1 = { uid: 'f1', role: 'finance' }, D1 = { uid: 'd1', role: 'director' };
  const month = new Date().toISOString().slice(0, 7);
  const first = (await call('POST', '/api/ops/expenses', M1, { category: 'supplies', description: 'Ice', amountPesewas: 5000 })).data;
  assert.equal(first.needsApproval, true, 'no limit yet: a director approves');
  assert.equal((await call('POST', '/api/ops/budget', M1, { month, lines: {}, expenseLimitPesewas: 30000 })).status, 403, 'finance sets the limit');
  assert.equal((await call('POST', '/api/ops/budget', F1, { month, lines: {}, expenseLimitPesewas: 30000 })).status, 200);
  assert.equal((await call('POST', '/api/ops/expenses', M1, { category: 'supplies', description: 'Ice', amountPesewas: 30000 })).data.needsApproval, false, 'at the limit: counts at once');
  const big = (await call('POST', '/api/ops/expenses', M1, { category: 'repairs', description: 'Generator repair', amountPesewas: 90000 })).data;
  assert.equal(big.needsApproval, true);
  let m = (await call('GET', '/api/ops/money?period=today', D1)).data;
  assert.deepEqual([m.totals.outPesewas, m.totals.waiting, m.totals.waitingPesewas], [30000, 2, 95000], 'waiting expenses don’t count yet');
  const todo = (await call('GET', '/api/ops/to-approve', D1)).data.items.filter(i => i.kind === 'expense');
  assert.equal(todo.length, 2);
  assert.equal((await call('POST', '/api/ops/approve', D1, { kind: 'expense', id: big.id, approve: true })).status, 200);
  assert.match((await call('POST', '/api/ops/approve', D1, { kind: 'expense', id: first.id, approve: false })).data.error, /Say why/);
  assert.equal((await call('POST', '/api/ops/approve', D1, { kind: 'expense', id: first.id, approve: false, note: 'Ice is in the bar budget' })).status, 200);
  m = (await call('GET', '/api/ops/money?period=today', D1)).data;
  assert.deepEqual([m.totals.outPesewas, m.totals.waiting], [120000, 0]);
  assert.equal(m.expenses.find(e => e.id === first.id).approval, 'refused');
  assert.equal((await call('GET', `/api/ops/budget?month=${month}`, D1)).data.budget.limitInForcePesewas, 30000);
});
