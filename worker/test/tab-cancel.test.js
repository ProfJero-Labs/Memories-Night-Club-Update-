// A tab nothing was ordered on (or every order on it was cancelled) can be cancelled: by the waiter,
// or by itself when its last order is cancelled by the waiter or the bar. It leaves My tables and the
// night's open tabs, and stays on record. A tab with drinks or money on it can't be cancelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, available: true, tracked: false });
  const people = { w1: ['Efua Waiter', 'waitStaff'], w2: ['Kojo Waiter', 'waitStaff'], b1: ['Ama Bartender', 'barStaff'], m1: ['Akos Manager', 'manager'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.61.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call, W1: as('w1'), W2: as('w2'), B1: as('b1'), M1: as('m1') };
}
const ok = (r, what) => { assert.equal(r.status, 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const order = async (c, who = c.W1, tabId) => ok(await c.call('POST', '/api/ops/tabs/order', { who, body: { tabId, table: '4', lines: [{ productId: 'beer', qty: 2 }] } }), 'order');
const status = (c, id) => c.store.get('tabs', id).fields.status;
const myOpen = async (c, who = c.W1) => ok(await c.call('GET', '/api/ops/tabs', { who }), 'my tabs').tabs.filter(t => t.status === 'open').map(t => t.id);

test('a tab with nothing ordered is cancelled by its waiter; it leaves My tables and stays on record', async () => {
  const c = setup();
  const tab = ok(await c.call('POST', '/api/ops/tabs/open', { who: c.W1, body: { table: '7' } }), 'open');
  assert.deepEqual(await myOpen(c), [tab.id]);
  assert.equal((await c.call('POST', '/api/ops/tabs/cancel', { who: c.W2, body: { tabId: tab.id } })).status, 403, 'not another waiter');
  ok(await c.call('POST', '/api/ops/tabs/cancel', { who: c.W1, body: { tabId: tab.id } }), 'cancel');
  const f = c.store.get('tabs', tab.id).fields;
  assert.deepEqual([f.status, f.cancelledByName, f.cancelReason], ['cancelled', 'Efua Waiter', 'Nothing was ordered']);
  assert.deepEqual(await myOpen(c), [], 'gone from My tables');
  assert.ok(c.store.list('audit_logs').some(a => a.fields.action === 'TAB_CANCELLED' && a.fields.tabId === tab.id));
  assert.match((await c.call('POST', '/api/ops/tabs/cancel', { who: c.W1, body: { tabId: tab.id } })).data.error, /already finished/);
  assert.match((await c.call('POST', '/api/ops/tabs/round', { who: c.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 1 }] } })).data.error, /closed/i, 'no drinks on a cancelled tab');
});

test('the waiter cancels the only order before the bar starts it: the tab cancels itself', async () => {
  const c = setup();
  const o = await order(c);
  const r = ok(await c.call('POST', '/api/ops/tabs/round-action', { who: c.W1, body: { roundId: o.roundId, action: 'cancel' } }), 'cancel order');
  assert.equal(r.tabCancelled, true);
  assert.equal(status(c, o.tabId), 'cancelled');
  assert.equal(c.store.get('tabs', o.tabId).fields.cancelReason, 'Every order was cancelled');
});

test('the bar can’t make the only order: the tab cancels itself; with another order still on it, it stays', async () => {
  const c = setup();
  const o = await order(c);
  const second = await order(c, c.W1, o.tabId);
  ok(await c.call('POST', '/api/ops/bar/round', { who: c.B1, body: { roundId: o.roundId, action: 'cant_make' } }), 'cant make 1');
  assert.equal(status(c, o.tabId), 'open', 'one order is still on it');
  const r = ok(await c.call('POST', '/api/ops/bar/round', { who: c.B1, body: { roundId: second.roundId, action: 'cant_make' } }), 'cant make 2');
  assert.equal(r.tabCancelled, true);
  assert.equal(status(c, o.tabId), 'cancelled');
});

test('a tab with drinks or money on it can’t be cancelled', async () => {
  const c = setup();
  const o = await order(c);
  assert.match((await c.call('POST', '/api/ops/tabs/cancel', { who: c.W1, body: { tabId: o.tabId } })).data.error, /drinks on it/);
  // Every order cancelled, but money was taken (part payment before the cancel): close it instead.
  const t = c.store.get('tabs', o.tabId).fields;
  c.store.seed('tabs', o.tabId, { ...t, payments: [{ method: 'cash', amountPesewas: 1000 }] });
  ok(await c.call('POST', '/api/ops/tabs/round-action', { who: c.W1, body: { roundId: o.roundId, action: 'cancel' } }), 'cancel order');
  assert.equal(status(c, o.tabId), 'open', 'not cancelled by itself: money was taken');
  assert.match((await c.call('POST', '/api/ops/tabs/cancel', { who: c.W1, body: { tabId: o.tabId } })).data.error, /Money was taken/);
});

test('a pay link still being paid blocks the cancel; an old one that ended doesn’t', async () => {
  const c = setup();
  const tab = ok(await c.call('POST', '/api/ops/tabs/open', { who: c.W1, body: { table: '2' } }), 'open');
  const t = c.store.get('tabs', tab.id).fields;
  c.store.seed('tabs', tab.id, { ...t, pending: { reference: 'ref-live' } });
  c.store.seed('pending_checkouts', 'ref-live', { kind: 'tab', tabId: tab.id, status: 'pending' });
  assert.match((await c.call('POST', '/api/ops/tabs/cancel', { who: c.W1, body: { tabId: tab.id } })).data.error, /payment is in progress/);
  c.store.seed('pending_checkouts', 'ref-live', { kind: 'tab', tabId: tab.id, status: 'failed' });
  ok(await c.call('POST', '/api/ops/tabs/cancel', { who: c.M1, body: { tabId: tab.id } }), 'the manager cancels it');
  assert.equal(status(c, tab.id), 'cancelled');
});

test('a cancelled tab doesn’t count as open on the night’s close', async () => {
  const c = setup();
  const o = await order(c);
  ok(await c.call('POST', '/api/ops/tabs/round-action', { who: c.W1, body: { roundId: o.roundId, action: 'cancel' } }), 'cancel order');
  const d = ok(await c.call('GET', '/api/ops/closing', { who: c.M1 }), 'closing');
  assert.equal(d.steps.find(s => s.key === 'waiters').done, true, 'every tab closed');
});
