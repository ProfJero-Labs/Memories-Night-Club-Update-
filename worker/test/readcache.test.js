// The short shared read cache: the list screens that every phone keeps refreshing share their reads
// for a few seconds. Payments, stock checks and every write always read fresh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup(extraEnv = {}) {
  const { store, env } = createMockEnv();
  Object.assign(env, extraEnv);
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('settings', 'commercial', {});
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('stock_moves', 'in', { productId: 'beer', stationId: 'main', qty: 5, kind: 'received', businessDate: '2000-01-01' });
  const people = { w1: 'waitStaff', b1: 'barStaff', m1: 'manager' };
  for (const [uid, role] of Object.entries(people)) store.seed('users', uid, { name: uid, role, phone: '0240000000' });
  const orig = globalThis.fetch; let reads = [];
  globalThis.fetch = async (u, o) => { const url = String(u); if (url.includes('firestore.googleapis.com') && !url.includes(':commit') && !url.includes(':beginTransaction')) reads.push(url.includes(':runQuery') ? `query:${JSON.parse(o.body).structuredQuery.from[0].collectionId}` : `get:${url.split('/documents/')[1]?.split('/')[0] || url.split('/').pop()}`); return orig(u, o); };
  const call = async (method, path, who, { body, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.99.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers, Authorization: `Bearer ${await idToken({ role: people[who] }, { uid: who })}` };
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const count = what => reads.filter(x => x === what).length;
  const mark = () => { reads = []; };
  return { store, env, call, count, mark };
}
const order = (call, who, table, qty = 1) => call('POST', '/api/ops/tabs/order', who, { body: { table, stationId: 'main', lines: [{ productId: 'beer', qty }] } });

test('two phones refreshing the tabs list within a few seconds share one set of reads', async () => {
  const { call, count, mark } = setup();
  assert.equal((await order(call, 'w1', '1')).status, 200);
  mark(); const a = await call('GET', '/api/ops/tabs?all=1', 'm1');
  const firstReads = count('query:tabs') + count('query:rounds');
  mark(); const b = await call('GET', '/api/ops/tabs?all=1', 'm1');
  assert.deepEqual(b.data, a.data, 'the same answer');
  assert.ok(firstReads >= 2, `the first refresh reads tabs and rounds (${firstReads})`);
  assert.equal(count('query:tabs') + count('query:rounds'), 0, 'the second reads none of them again');
});

test('the person’s own change shows at once; so does anyone’s in this Worker; a change made elsewhere shows with x-fresh or after the few seconds', async () => {
  const { store, call } = setup();
  assert.equal((await call('GET', '/api/ops/tabs?all=1', 'm1')).data.tabs.length, 0);
  assert.equal((await order(call, 'w1', '1')).status, 200);
  assert.equal((await call('GET', '/api/ops/tabs?all=1', 'm1')).data.tabs.length, 1, 'a write here clears the saved answers');
  // Another Worker writes a tab (simulated by seeding straight into the database).
  store.seed('tabs', 'elsewhere', { number: 9, businessDate: store.get('tabs', store.list('tabs')[0].id).fields.businessDate, table: '9', status: 'open', payments: [], discounts: [], waiterUid: 'w1', waiterName: 'w1', billToken: 'x'.repeat(32), createdAt: new Date().toISOString() });
  assert.equal((await call('GET', '/api/ops/tabs?all=1', 'm1')).data.tabs.length, 1, 'within the few seconds: the saved answer');
  assert.equal((await call('GET', '/api/ops/tabs?all=1', 'm1', { headers: { 'X-Fresh': '1' } })).data.tabs.length, 2, 'x-fresh reads the database');
});

test('payments and stock checks never use it: the last bottle can’t be sold twice because of an old answer', async () => {
  const { store, call } = setup();
  assert.equal((await call('GET', '/api/ops/products?stationId=main', 'w1')).status, 200); // the list screen saves its reads
  // Another Worker sells four of the five beers (simulated).
  store.seed('stock_moves', 'sold4', { productId: 'beer', stationId: 'main', qty: -4, kind: 'issue', businessDate: new Date().toISOString().slice(0, 10) });
  const r = await order(call, 'w1', '2', 3);
  assert.equal(r.status, 400, 'refused on the real count, not the saved one');
  assert.match(r.data.error, /Only 1|left/i);
});

test('READ_CACHE=off turns it off', async () => {
  const { call, count, mark } = setup({ READ_CACHE: 'off' });
  await order(call, 'w1', '1');
  await call('GET', '/api/ops/tabs?all=1', 'm1');
  mark(); await call('GET', '/api/ops/tabs?all=1', 'm1');
  assert.ok(count('query:tabs') >= 1, 'reads again');
});

test('every request no longer re-reads the open night, the staff record or the payment settings', async () => {
  const { call, count, mark } = setup();
  await call('GET', '/api/ops/tabs?all=1', 'm1'); // the first one fills the saved answers
  mark();
  for (let i = 0; i < 3; i++) await call('GET', '/api/ops/tab?id=none', 'w1');
  assert.equal(count('get:config'), 0, 'the open night is saved for a few seconds');
  assert.ok(count('get:users') <= 1, `the staff record is saved for a few seconds (${count('get:users')})`);
  assert.equal(count('get:shifts'), 0, 'so is whether the night is closed');
});
