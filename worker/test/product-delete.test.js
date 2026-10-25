// Finance deletes a drink the club no longer sells. It leaves the menu, the bar and the QR menu,
// but the record is kept (marked deleted, with who and why) so past sheets and reports stay right.
// Refused while a bar still has some, or new stock of it is waiting to be confirmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
const TOKEN = 'a'.repeat(32);
function setup() {
  const { store, env } = createMockEnv();
  store.seed('bar_stations', 'main', { name: 'Main bar', token: TOKEN, open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('menu_items', 'old', { name: 'Old wine', category: 'Wine', unit: 'bottle', pricePesewas: 9000, costPesewas: 5000, available: true, tracked: true });
  const people = { f1: ['Esi Finance', 'finance'], m1: ['Akos Manager', 'manager'], b1: ['Ama Bartender', 'barStaff'], d1: ['Nana Director', 'director'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400007${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.95.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const del = (call, who, id, reason = 'we don’t sell it any more') => call('POST', '/api/ops/products/delete', { who, body: { id, reason } });

test('only finance deletes a drink, with a reason; it leaves every menu but the record is kept', async () => {
  const { store, call } = setup();
  for (const who of ['m1', 'b1', 'd1']) assert.equal((await del(call, who, 'old')).status, 403, `${who} can’t`);
  assert.match((await del(call, 'f1', 'old', '')).data.error, /Say why/);
  assert.equal((await del(call, 'f1', 'nope')).status, 404);
  assert.equal(ok(await del(call, 'f1', 'old'), 'delete').deleted, true);
  assert.equal((await del(call, 'f1', 'old')).status, 404, 'already deleted');

  const f = store.get('menu_items', 'old').fields;
  assert.deepEqual([f.deleted, f.available, f.deletedByName, f.deleteReason, f.name], [true, false, 'Esi Finance', 'we don’t sell it any more', 'Old wine'], 'kept, marked deleted');
  const ids = d => d.map(x => x.id ?? x.productId);
  assert.deepEqual(ids(ok(await call('GET', '/api/ops/products', { who: 'f1' }), 'products').products), ['beer']);
  assert.deepEqual(ids(ok(await call('GET', `/api/guest/menu?station=${TOKEN}`), 'qr menu').items), ['beer']);
  assert.ok(!ids(ok(await call('GET', '/api/ops/stock?stationId=main', { who: 'f1' }), 'sheet').rows).includes('old'), 'not on the sheet: it had nothing');

  assert.match((await call('POST', '/api/ops/products', { who: 'f1', body: { id: 'old', name: 'Old wine', pricePesewas: 9000, costPesewas: 5000 } })).data.error, /was deleted/);
  assert.equal((await call('POST', '/api/ops/products/available', { who: 'b1', body: { id: 'old', available: true } })).status, 404, 'can’t be put back on sale');
  assert.match((await call('POST', '/api/ops/stock/received', { who: 'f1', body: { stationId: 'main', productId: 'old', qty: 6, totalCostPesewas: 30000 } })).data.error, /Pick the drink/);
  const log = ok(await call('GET', '/api/ops/changes', { who: 'f1' }), 'changes').changes;
  assert.ok(log.some(c => c.kind === 'product_deleted' && c.refName === 'Old wine' && c.note === 'we don’t sell it any more' && c.byName === 'Esi Finance'));
});

test('refused while a bar still has some; once set to 0 it can go, and tonight’s sheet still shows it', async () => {
  const { call } = setup();
  ok(await call('POST', '/api/ops/stock/received', { who: 'f1', body: { stationId: 'main', productId: 'old', qty: 6, totalCostPesewas: 30000 } }), 'buy');
  assert.match((await del(call, 'f1', 'old')).data.error, /Main bar still has 6 Old wine/);
  ok(await call('POST', '/api/ops/stock/set-level', { who: 'f1', body: { stationId: 'main', productId: 'old', qty: 0, reason: 'sent back to the supplier' } }), 'set 0');
  ok(await del(call, 'f1', 'old'), 'delete');
  const row = ok(await call('GET', '/api/ops/stock?stationId=main', { who: 'f1' }), 'sheet').rows.find(r => r.productId === 'old');
  assert.ok(row, 'tonight’s sheet keeps it: stock moved tonight');
  assert.equal(row.expected, 0);
});

test('refused while new stock of it waits to be confirmed', async () => {
  const { call } = setup();
  const id = ok(await call('POST', '/api/ops/stock/received', { who: 'b1', body: { stationId: 'main', productId: 'old', qty: 6 } }), 'bar records').id;
  assert.match((await del(call, 'f1', 'old')).data.error, /waiting to be confirmed/);
  ok(await call('POST', '/api/ops/stock/fix', { who: 'f1', body: { id, action: 'remove', reason: 'never came' } }), 'remove entry');
  ok(await del(call, 'f1', 'old'), 'delete');
});

test('refused while it is on an order the bar hasn’t handed over yet', async () => {
  const { store, call } = setup();
  store.seed('rounds', 'r1', { stationId: 'main', status: 'waiting', businessDate: '2026-10-24', lines: [{ productId: 'old', qty: 1 }] });
  assert.match((await del(call, 'f1', 'old')).data.error, /hasn’t handed over/);
  store.seed('rounds', 'r1', { stationId: 'main', status: 'delivered', businessDate: '2026-10-24', lines: [{ productId: 'old', qty: 1 }] });
  store.seed('counter_orders', 'q1', { stationId: 'main', status: 'paid', lines: [{ itemId: 'old', qty: 1 }] });
  assert.match((await del(call, 'f1', 'old')).data.error, /waiting for pickup/);
  store.seed('counter_orders', 'q1', { stationId: 'main', status: 'collected', lines: [{ itemId: 'old', qty: 1 }] });
  ok(await del(call, 'f1', 'old'), 'delete');
});
