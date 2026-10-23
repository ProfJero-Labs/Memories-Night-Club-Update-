// Finance fixes stock mistakes: deletes an entry made twice, changes a wrong number (or what was
// paid), or sets the number of a drink in a bar. Nothing is erased: the entry keeps who fixed it,
// when and why; the bar's stock and the money report are put right; it's all in the change log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  const people = { f1: ['Esi Finance', 'finance'], m1: ['Akos Manager', 'manager'], b1: ['Ama Bartender', 'barStaff'], bm: ['Bimpe Bar Manager', 'barManager'], d1: ['Nana Director', 'director'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400006${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.94.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const expected = async call => ok(await call('GET', '/api/ops/stock?stationId=main', { who: 'f1' }), 'sheet').rows.find(r => r.productId === 'beer').expected;
const buy = async (call, qty, cost) => ok(await call('POST', '/api/ops/stock/received', { who: 'f1', body: { stationId: 'main', productId: 'beer', qty, totalCostPesewas: cost } }), 'buy').id;

test('a purchase entered twice: finance deletes one; stock and money are put right; the entry is kept, marked deleted', async () => {
  const { store, call } = setup();
  await buy(call, 24, 28800);
  const twice = await buy(call, 24, 28800);
  assert.equal(await expected(call), 48);
  assert.match((await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id: twice, action: 'remove' } })).data.error, /Say why/);
  for (const who of ['m1', 'b1', 'bm']) assert.equal((await call('POST', '/api/ops/stock/fix', { who, body: { id: twice, action: 'remove', reason: 'x' } })).status, 403, `${who} can’t`);
  const r = ok(await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id: twice, action: 'remove', reason: 'entered twice' } }), 'delete');
  assert.deepEqual([r.removed, r.stockChange], [true, -24]);
  assert.equal(await expected(call), 24, 'the bar’s stock is right again');
  const d = store.get('stock_deliveries', twice).fields;
  assert.deepEqual([d.status, d.removedByName, d.removeReason], ['removed', 'Esi Finance', 'entered twice'], 'kept, marked deleted');
  assert.match((await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id: twice, action: 'remove', reason: 'again' } })).data.error, /Already deleted/);
  const list = ok(await call('GET', '/api/ops/stock/deliveries?stationId=main', { who: 'f1' }), 'list');
  assert.equal(list.deliveries.find(x => x.id === twice).canFix, false);
  assert.equal(list.canFix, true);
  const money = ok(await call('GET', '/api/ops/money?period=today', { who: 'd1' }), 'money');
  assert.equal(money.moneyOut.find(x => x.key === 'drinks_bought').amountPesewas, 28800, 'paid for once');
  const log = ok(await call('GET', '/api/ops/changes', { who: 'f1' }), 'changes').changes;
  assert.ok(log.some(c => /deleted/.test(c.field) && c.note === 'entered twice' && c.byName === 'Esi Finance'));
});

test('a wrong number: finance changes it (and what was paid); stock moves by the difference; the old number is kept', async () => {
  const { store, call } = setup();
  const id = await buy(call, 240, 28800);
  assert.match((await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id, qty: 0, reason: 'typo' } })).data.error, /delete it/);
  assert.match((await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id, qty: 240, reason: 'typo' } })).data.error, /Nothing changed/);
  const r = ok(await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id, qty: 24, totalCostPesewas: 30000, reason: 'typed 240, it was 24' } }), 'change');
  assert.deepEqual([r.changed, r.qty, r.stockChange], [true, 24, -216]);
  assert.equal(await expected(call), 24);
  const d = store.get('stock_deliveries', id).fields;
  assert.deepEqual([d.qty, d.confirmedQty, d.totalCostPesewas, d.unitCostPesewas, d.edits[0].fromQty, d.edits[0].fromCostPesewas], [24, 24, 30000, 1250, 240, 28800]);
  const money = ok(await call('GET', '/api/ops/money?period=today', { who: 'd1' }), 'money');
  assert.equal(money.moneyOut.find(x => x.key === 'drinks_bought').amountPesewas, 30000);
});

test('stock the bar recorded, not confirmed yet: finance can correct the number before it counts, or delete it', async () => {
  const { store, call } = setup();
  const id = ok(await call('POST', '/api/ops/stock/received', { who: 'b1', body: { stationId: 'main', productId: 'beer', qty: 60 } }), 'bar records').id;
  ok(await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id, qty: 6, reason: 'one crate, not ten' } }), 'change');
  assert.equal(await expected(call), 0, 'nothing in stock until confirmed');
  assert.equal(store.get('stock_deliveries', id).fields.qty, 6);
  ok(await call('POST', '/api/ops/stock/delivery', { who: 'm1', body: { id, action: 'confirm' } }), 'confirm');
  assert.equal(await expected(call), 6);
  const other = ok(await call('POST', '/api/ops/stock/received', { who: 'b1', body: { stationId: 'main', productId: 'beer', qty: 6 } }), 'again').id;
  assert.equal(ok(await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id: other, action: 'remove', reason: 'same crate' } }), 'delete').stockChange, 0);
  assert.equal((await call('POST', '/api/ops/stock/delivery', { who: 'm1', body: { id: other, action: 'confirm' } })).status, 400, 'a deleted entry can’t be confirmed');
  assert.equal(await expected(call), 6);
});

test('finance sets the number of a drink in the bar; the correction shows on the sheet and in the night’s accounts', async () => {
  const { call } = setup();
  await buy(call, 24, 28800);
  assert.match((await call('POST', '/api/ops/stock/set-level', { who: 'f1', body: { stationId: 'main', productId: 'beer', qty: 20 } })).data.error, /Say why/);
  assert.equal((await call('POST', '/api/ops/stock/set-level', { who: 'm1', body: { stationId: 'main', productId: 'beer', qty: 20, reason: 'x' } })).status, 403);
  const r = ok(await call('POST', '/api/ops/stock/set-level', { who: 'f1', body: { stationId: 'main', productId: 'beer', qty: 20, reason: 'recounted the store' } }), 'set');
  assert.deepEqual([r.from, r.qty, r.stockChange], [24, 20, -4]);
  const row = ok(await call('GET', '/api/ops/stock?stationId=main', { who: 'f1' }), 'sheet').rows.find(x => x.productId === 'beer');
  assert.deepEqual([row.received, row.corrections, row.expected], [24, -4, 20]);
  assert.equal(ok(await call('POST', '/api/ops/stock/set-level', { who: 'f1', body: { stationId: 'main', productId: 'beer', qty: 20, reason: 'same' } }), 'same').unchanged, true);
  const acc = ok(await call('GET', '/api/ops/accounts', { who: 'f1' }), 'accounts');
  assert.equal(acc.shouldMakePesewas, 0, 'a correction isn’t drinks sold');
});
