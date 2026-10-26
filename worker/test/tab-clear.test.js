// Clearing tabs left open after a night (src/ops/tab-clear.js), and deleting a drink added twice
// (src/ops/stock.js deleteProduct with mergeInto).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { bizDate } from '../src/ops/common.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  const people = { f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'], m1: ['Akos Manager', 'manager'], w1: ['Kojo Waiter', 'waitStaff'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400007${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.96.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const line = (productId, qty, unitPesewas = 5000) => ({ lineId: `${productId}-l`, productId, name: productId, unitPesewas, qty });

function seedNight(store, date) {
  const tab = (tid, n, payments = []) => store.seed('tabs', tid, { number: n, businessDate: date, stationId: 'main', table: `T${n}`, waiterUid: 'w1', waiterName: 'Kojo Waiter', status: 'open', payments, discounts: [] });
  tab('paid', 1, [{ id: 'p1', method: 'cash', amountPesewas: 5000 }]);
  store.seed('rounds', 'r-paid', { tabId: 'paid', businessDate: date, stationId: 'main', waiterUid: 'w1', lines: [line('beer', 1)], status: 'received' });
  tab('owes', 2);
  store.seed('rounds', 'r-owes', { tabId: 'owes', businessDate: date, stationId: 'main', waiterUid: 'w1', lines: [line('beer', 2)], status: 'handed' });
  store.seed('rounds', 'r-never', { tabId: 'owes', businessDate: date, stationId: 'main', waiterUid: 'w1', lines: [line('beer', 3)], status: 'waiting' });
}

test('director and finance clear tabs left open after a night; nothing is deleted', async () => {
  const { store, call } = setup();
  seedNight(store, '2026-10-20');
  store.seed('tabs', 'tonight', { number: 9, businessDate: bizDate(), stationId: 'main', waiterUid: 'w1', waiterName: 'Kojo Waiter', status: 'open', payments: [], discounts: [] });

  for (const who of ['m1', 'w1']) assert.equal((await call('POST', '/api/ops/tabs/clear', { who, body: { date: '2026-10-20', reason: 'x' } })).status, 403, `${who} can’t`);
  const list = ok(await call('GET', '/api/ops/tabs/stale', { who: 'd1' }), 'stale');
  assert.deepEqual(list.nights.map(n => [n.date, n.tabs.length, n.unpaidPesewas]), [['2026-10-20', 2, 25000]], 'only past nights; tonight is not listed');
  assert.match((await call('POST', '/api/ops/tabs/clear', { who: 'f1', body: { date: bizDate(), reason: 'x' } })).data.error, /isn’t over/);
  assert.match((await call('POST', '/api/ops/tabs/clear', { who: 'f1', body: { date: '2026-10-20', reason: '' } })).data.error, /Say why/);

  const r = ok(await call('POST', '/api/ops/tabs/clear', { who: 'f1', body: { date: '2026-10-20', reason: 'Trial night' } }), 'clear');
  assert.equal(r.cleared, 2);
  assert.equal(r.unpaidPesewas, 10000, 'only the drinks handed over are owed');
  assert.equal(store.get('tabs', 'paid').fields.status, 'closed');
  const owes = store.get('tabs', 'owes').fields;
  assert.deepEqual([owes.status, owes.writeOffReason, owes.clearedByName], ['written_off', 'Trial night', 'Esi Finance']);
  assert.equal(store.get('rounds', 'r-never').fields.status, 'cancelled', 'never handed over: cancelled');
  assert.equal(store.get('rounds', 'r-owes').fields.status, 'delivered');
  assert.equal(store.get('tabs', 'tonight').fields.status, 'open', 'tonight’s tab untouched');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'TABS_CLEARED' && a.fields.actorName === 'Esi Finance'));
  assert.deepEqual(ok(await call('GET', '/api/ops/tabs/stale', { who: 'd1' }), 'stale').nights, []);
  assert.deepEqual(ok(await call('GET', '/api/ops/tabs', { who: 'w1' }), 'waiter').tabs.map(t => t.id), ['tonight'], 'gone from the waiter’s screen');
});

test('a drink added twice is deleted and what the bar holds of it moves to the one kept', async () => {
  const { store, call } = setup();
  store.seed('menu_items', 'smirn', { name: 'Smirnoff', category: 'Spirits', unit: 'bottle', pricePesewas: 30000, costPesewas: 20000, available: true, tracked: true });
  store.seed('menu_items', 'smirn2', { name: 'Smirnoff', category: 'Spirits', unit: 'bottle', pricePesewas: 30000, costPesewas: 20000, available: true, tracked: true });
  ok(await call('POST', '/api/ops/stock/set-level', { who: 'f1', body: { productId: 'smirn', stationId: 'main', qty: 10, reason: 'count' } }), 'set');
  ok(await call('POST', '/api/ops/stock/set-level', { who: 'f1', body: { productId: 'smirn2', stationId: 'main', qty: 4, reason: 'count' } }), 'set');
  assert.match((await call('POST', '/api/ops/products/delete', { who: 'f1', body: { id: 'smirn2', reason: 'Added twice' } })).data.error, /still has 4 Smirnoff/);
  assert.match((await call('POST', '/api/ops/products/delete', { who: 'f1', body: { id: 'smirn2', reason: 'Added twice', mergeInto: 'smirn2' } })).data.error, /Pick the drink to keep/);
  const r = ok(await call('POST', '/api/ops/products/delete', { who: 'f1', body: { id: 'smirn2', reason: 'Added twice', mergeInto: 'smirn' } }), 'delete');
  assert.deepEqual([r.deleted, r.moved, r.mergedInto], [true, 4, 'Smirnoff']);
  assert.equal(store.get('menu_items', 'smirn2').fields.deleted, true);
  const sheet = ok(await call('GET', '/api/ops/stock?stationId=main', { who: 'f1' }), 'sheet');
  assert.equal(sheet.rows.find(x => x.productId === 'smirn').expected, 14, 'the bottles are not lost');
  assert.equal(ok(await call('GET', '/api/ops/products', { who: 'f1' }), 'products').products.filter(p => p.name === 'Smirnoff').length, 1);
});

test('a drink on a stuck order from a past night can be deleted once that night’s tabs are cleared', async () => {
  const { store, call } = setup();
  store.seed('menu_items', 'dup', { name: 'Smirnoff', category: 'Spirits', unit: 'bottle', pricePesewas: 30000, costPesewas: 20000, available: true, tracked: false });
  store.seed('tabs', 't', { number: 1, businessDate: '2026-10-18', stationId: 'main', waiterUid: 'w1', waiterName: 'Kojo Waiter', status: 'open', payments: [], discounts: [] });
  store.seed('rounds', 'stuck', { tabId: 't', businessDate: '2026-10-18', stationId: 'main', waiterUid: 'w1', lines: [line('dup', 1)], status: 'taken' });
  assert.match((await call('POST', '/api/ops/products/delete', { who: 'f1', body: { id: 'dup', reason: 'Added twice' } })).data.error, /on an order/);
  ok(await call('POST', '/api/ops/tabs/clear', { who: 'd1', body: { date: '2026-10-18', reason: 'Trial night' } }), 'clear');
  ok(await call('POST', '/api/ops/products/delete', { who: 'f1', body: { id: 'dup', reason: 'Added twice' } }), 'delete');
});
