// The waiters' trial nights cleared once: the super admin sees what would go, then confirms.
// Waiters only, nights before the first official night only; debts, payments in progress, tips
// still owed, stock moves and other staff stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

const OLD = '2026-10-20', NEW = '2026-10-24';
function setup() {
  const { store, env } = createMockEnv();
  const people = { w1: 'waitStaff', w2: 'waitStaff', b1: 'barStaff', m1: 'manager', sa: 'superAdmin' };
  for (const [uid, role] of Object.entries(people)) store.seed('users', uid, { name: uid, role, ...(uid === 'w2' ? { removed: true } : {}) });
  const tab = (tid, waiterUid, businessDate, extra = {}) => { store.seed('tabs', tid, { number: 1, waiterUid, businessDate, status: 'closed', payments: [], discounts: [], ...extra }); store.seed('rounds', `r_${tid}`, { tabId: tid, waiterUid, status: 'delivered', lines: [] }); };
  tab('old1', 'w1', OLD); tab('old2', 'w2', OLD, { status: 'open' }); tab('new1', 'w1', NEW);
  tab('debt', 'w1', OLD, { status: 'owed' }); tab('paying', 'w1', OLD, { pending: { reference: 'ref1' } });
  tab('bar', 'b1', OLD);
  store.seed('pending_checkouts', 'ref1', { kind: 'tab', tabId: 'paying', status: 'pending' });
  store.seed('approvals', 'a1', { kind: 'discount', status: 'pending', data: { tabId: 'old1' }, requestedBy: 'm1', businessDate: OLD });
  store.seed('approvals', 'a2', { kind: 'cash_out', status: 'approved', data: { sessionId: `${OLD}__w1` }, requestedBy: 'w1', businessDate: OLD });
  store.seed('approvals', 'a3', { kind: 'discount', status: 'pending', data: { tabId: 'new1' }, requestedBy: 'w1', businessDate: NEW });
  store.seed('cash_sessions', `${OLD}__w1`, { date: OLD, uid: 'w1', role: 'waitStaff' });
  store.seed('cash_sessions', `${NEW}__w1`, { date: NEW, uid: 'w1', role: 'waitStaff' });
  store.seed('cash_sessions', `${OLD}__b1`, { date: OLD, uid: 'b1', role: 'barStaff' });
  store.seed('staff_reports', `${OLD}__w1`, { date: OLD, uid: 'w1', kind: 'waiter' });
  store.seed('tips', 't1', { toUid: 'w1', businessDate: OLD, status: 'cash', amountPesewas: 500 });
  store.seed('tips', 't2', { toUid: 'w1', businessDate: OLD, status: 'owed', amountPesewas: 2000 });
  store.seed('tips', 't3', { toUid: 'b1', businessDate: OLD, status: 'cash', amountPesewas: 500 });
  store.seed('tip_payouts', 'p1', { toUid: 'w1', at: `${OLD}T23:00:00.000Z`, amountPesewas: 1000 });
  store.seed('stock_moves', 'm1', { productId: 'beer', qty: -2, kind: 'issue', businessDate: OLD });
  let ip = 0;
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.98.0.${++ip}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ids = (store, col) => store.list(col).map(d => d.id).sort();

test('only the super admin can see or run the waiters’ trial reset', async () => {
  const { call } = setup();
  for (const who of ['m1', 'w1']) {
    assert.equal((await call('GET', '/api/ops/trial-reset', { who })).status, 403);
    assert.equal((await call('POST', '/api/ops/trial-reset', { who, body: { confirm: 'RESET' } })).status, 403);
  }
});

test('the preview deletes nothing; the reset clears the waiters’ trial nights and keeps the rest', async () => {
  const { store, call } = setup();
  const pre = await call('GET', '/api/ops/trial-reset', { who: 'sa' });
  assert.equal(pre.status, 200);
  assert.deepEqual(pre.data.counts, { tabs: 2, rounds: 2, approvals: 2, cash_sessions: 1, staff_reports: 1, tips: 1, tip_payouts: 1 });
  assert.deepEqual(pre.data.kept, { owedTabs: 1, payingTabs: 1, owedTips: 1, owedTipsPesewas: 2000 });
  assert.equal(store.list('tabs').length, 6, 'the preview deletes nothing');

  assert.match((await call('POST', '/api/ops/trial-reset', { who: 'sa', body: {} })).data.error, /Confirm/);
  const r = await call('POST', '/api/ops/trial-reset', { who: 'sa', body: { confirm: 'RESET' } });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(store, 'tabs'), ['bar', 'debt', 'new1', 'paying']);
  assert.deepEqual(ids(store, 'rounds'), ['r_bar', 'r_debt', 'r_new1', 'r_paying']);
  assert.deepEqual(ids(store, 'approvals'), ['a3']);
  assert.deepEqual(ids(store, 'cash_sessions'), [`${OLD}__b1`, `${NEW}__w1`]);
  assert.deepEqual(ids(store, 'staff_reports'), []);
  assert.deepEqual(ids(store, 'tips'), ['t2', 't3']);
  assert.deepEqual(ids(store, 'tip_payouts'), []);
  assert.deepEqual(ids(store, 'stock_moves'), ['m1'], 'stock is never touched');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'WAITER_TRIAL_RESET'));

  const again = await call('GET', '/api/ops/trial-reset', { who: 'sa' });
  assert.ok(Object.values(again.data.counts).every(n => n === 0), 'nothing left to clear');
});
