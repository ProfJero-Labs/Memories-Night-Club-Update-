// Finance's month (budget, bills due, paying them), the manager's payments of the night with the
// details of each, the night's top customers, and a QR customer seeing their own night.
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
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('stock_moves', 'seed', { productId: 'beer', stationId: 'main', qty: 100, kind: 'received', businessDate: '2000-01-01' });
  const people = { b1: ['Ama Bartender', 'barStaff'], w1: ['Efua Waiter', 'waitStaff'], m1: ['Akos Manager', 'manager'], f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400000${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.90.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call, B1: as('b1'), W1: as('w1'), M1: as('m1'), F1: as('f1'), D1: as('d1') };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };

test('finance sets the month: budget, bills due (salaries, rent, a supplier owed); paying one is an expense; the director sees what’s due', async () => {
  const ctx = setup();
  const month = nightKey(new Date()).slice(0, 7);
  const later = `${month}-28`, past = `${month}-01`;
  assert.equal((await ctx.call('POST', '/api/ops/bills', { who: ctx.M1, body: { payee: 'Staff', category: 'staff', amountPesewas: 100, dueDate: later } })).status, 403, 'only finance');
  assert.equal((await ctx.call('POST', '/api/ops/budget', { who: ctx.D1, body: { month, lines: { staff: 100 } } })).status, 403, 'the director looks, finance sets');
  ok(await ctx.call('POST', '/api/ops/budget', { who: ctx.F1, body: { month, lines: { staff: 800000, rent: 300000, drinks: 500000, dj: '' } } }), 'budget');
  const sal = ok(await ctx.call('POST', '/api/ops/bills', { who: ctx.F1, body: { payee: 'Staff salaries', category: 'staff', amountPesewas: 800000, dueDate: later } }), 'salaries');
  ok(await ctx.call('POST', '/api/ops/bills', { who: ctx.F1, body: { payee: 'Landlord', description: 'Rent', category: 'rent', amountPesewas: 300000, dueDate: past } }), 'rent (overdue)');
  const sup = ok(await ctx.call('POST', '/api/ops/bills', { who: ctx.F1, body: { payee: 'Guinness Ghana', category: 'supplier', amountPesewas: 150000, dueDate: later } }), 'supplier owed');
  assert.match((await ctx.call('POST', '/api/ops/bills', { who: ctx.F1, body: { payee: 'X', category: 'rent', amountPesewas: 100 } })).data.error, /date/);

  let b = ok(await ctx.call('GET', `/api/ops/budget?month=${month}`, { who: ctx.D1 }), 'director');
  assert.equal(b.canEdit, false);
  assert.deepEqual([b.budget.totalPesewas, b.totals.billsPesewas, b.totals.duePesewas, b.totals.overdue], [1600000, 1250000, 1250000, past < nightKey(new Date()) ? 1 : 0]);

  // Every payment needs a director first; either director can approve.
  assert.match((await ctx.call('POST', '/api/ops/bills/pay', { who: ctx.F1, body: { id: sal.id, amountPesewas: 400000 } })).data.error, /director must approve/);
  const todo = ok(await ctx.call('GET', '/api/ops/to-approve', { who: ctx.D1 }), 'to approve');
  assert.equal(todo.items.filter(i => i.kind === 'bill').length, 3);
  assert.equal((await ctx.call('POST', '/api/ops/approve', { who: ctx.F1, body: { kind: 'bill', id: sal.id, approve: true } })).status, 403, 'finance can’t approve');
  for (const bid of [sal.id, sup.id]) ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'bill', id: bid, approve: true } }), 'director approves');
  // Pay half the salaries now: an expense (Money out); the supplier bill isn't (the drinks were counted when bought).
  ok(await ctx.call('POST', '/api/ops/bills/pay', { who: ctx.F1, body: { id: sal.id, amountPesewas: 400000, paidWith: 'bank' } }), 'half salaries');
  assert.match((await ctx.call('POST', '/api/ops/bills/pay', { who: ctx.F1, body: { id: sal.id, amountPesewas: 500000 } })).data.error, /Only 4,?000 cedis/);
  ok(await ctx.call('POST', '/api/ops/bills/pay', { who: ctx.F1, body: { id: sup.id } }), 'supplier in full');
  b = ok(await ctx.call('GET', `/api/ops/budget?month=${month}`, { who: ctx.F1 }), 'finance');
  assert.deepEqual([b.totals.paidPesewas, b.totals.duePesewas], [550000, 700000]);
  assert.deepEqual(b.bills.find(x => x.id === sal.id).state, 'part_paid');
  assert.deepEqual(b.budget.lines.find(l => l.category === 'staff').spentPesewas, 400000, 'budget against spent');
  const m = ok(await ctx.call('GET', '/api/ops/money?period=month', { who: ctx.D1 }), 'money');
  assert.equal(m.totals.outPesewas, 400000, 'salaries paid count; the supplier payment doesn’t count twice');
  assert.match((await ctx.call('POST', '/api/ops/bills/remove', { who: ctx.F1, body: { id: sal.id, reason: 'x' } })).data.error, /paid already/);
});

test('copy last month: the same bills, unpaid, due on the same day; not copied twice', async () => {
  const ctx = setup();
  const month = nightKey(new Date()).slice(0, 7);
  const [y, mo] = month.split('-').map(Number), prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  ctx.store.seed('bills', 'old1', { month: prev, payee: 'Staff salaries', category: 'staff', amountPesewas: 800000, dueDate: `${prev}-25`, payments: [{ amountPesewas: 800000 }], removed: false });
  ctx.store.seed('bills', 'old2', { month: prev, payee: 'Guinness Ghana', category: 'supplier', amountPesewas: 150000, dueDate: `${prev}-10`, payments: [], removed: false });
  ctx.store.seed('budgets', prev, { month: prev, lines: { staff: 800000 } });
  const c1 = ok(await ctx.call('POST', '/api/ops/bills/copy', { who: ctx.F1, body: { month } }), 'copy');
  assert.deepEqual([c1.copied, c1.budget], [1, true], 'salaries copied; the supplier bill isn’t (it’s owed for drinks bought)');
  const c2 = ok(await ctx.call('POST', '/api/ops/bills/copy', { who: ctx.F1, body: { month } }), 'again');
  assert.deepEqual([c2.copied, c2.budget], [0, false]);
  const b = ok(await ctx.call('GET', `/api/ops/budget?month=${month}`, { who: ctx.D1 }), 'month');
  assert.deepEqual(b.bills.map(x => [x.payee, x.dueDate, x.paidPesewas]), [['Staff salaries', `${month}-25`, 0]]);
});

test('the manager sees every payment tonight with what was bought, who served and how it was paid; top customers; a QR customer sees their own night', async () => {
  const ctx = setup();
  // A table that pays by MoMo from the customer's phone.
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '7', customerName: 'Kwesi' } }), 'table');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 4 }] } }), 'round');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.id, action: 'hand' } }), 'hand');
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: tab.id, method: 'momo', amountPesewas: 10000, momoRef: '11223344', momoFrom: '0244111222' } }), 'momo');
  // A cash sale at the bar, with the customer's phone.
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 1 }], method: 'cash', customerPhone: '0244111222' } }), 'bar cash');
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 2 }], method: 'cash' } }), 'no phone');
  // A QR order paid from the same phone.
  const qr = await ctx.call('POST', '/api/guest/counter/checkout', { body: { station: 'a'.repeat(32), items: [{ itemId: 'beer', qty: 2 }], phone: '0244111222' } });
  ctx.store.setPaystack(ctx.store.list('pending_checkouts').at(-1).id, { status: 'success', currency: 'GHS', amount: 5000 });
  await ctx.call('GET', `/api/guest/counter/${qr.data.orderId}`);

  assert.equal((await ctx.call('GET', '/api/ops/payments', { who: ctx.W1 })).status, 403, 'not for waiters');
  const p = ok(await ctx.call('GET', '/api/ops/payments', { who: ctx.M1 }), 'payments');
  assert.equal(p.payments.length, 4);
  assert.equal(p.totalPesewas, 10000 + 2500 + 5000 + 5000);
  const momo = p.payments.find(x => x.method === 'momo');
  assert.deepEqual([momo.servedByName, momo.takenByName, momo.where, momo.customerName, momo.momoRef, momo.lines[0].qty, momo.lines[0].name, momo.wholeBill], ['Efua Waiter', 'Efua Waiter', 'Table 7', 'Kwesi', '11223344', 4, 'Club beer', true]);
  const bar = p.payments.find(x => x.method === 'cash' && x.customerPhone);
  assert.deepEqual([bar.where, bar.servedByName, bar.lines[0].qty], ['At the bar', 'Ama Bartender', 1]);
  const q = p.payments.find(x => x.method === 'qr');
  assert.deepEqual([q.servedByName, q.amountPesewas], ['Not collected yet', 5000]);
  // Top customer: Kwesi, by phone, across the table, the bar and QR.
  assert.deepEqual([p.customers[0].name, p.customers[0].phone, p.customers[0].spentPesewas, p.customers[0].visits], ['Kwesi', '0244111222', 17500, 3]);
  assert.equal(p.noPhonePesewas, 5000);
  // The QR customer sees their own night (everything from their phone), by their order.
  const n = ok(await ctx.call('GET', `/api/guest/counter-night/${qr.data.orderId}`), 'my night');
  assert.equal(n.totalPesewas, 17500);
  assert.equal(n.items.length, 3);
  assert.equal(n.phoneHint, '024***1222');
  assert.equal((await ctx.call('GET', `/api/guest/counter-night/${'f'.repeat(32)}`)).status, 404);
});
