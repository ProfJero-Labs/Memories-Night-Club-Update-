// The trial nights cleared once: the super admin sees what would go, then confirms.
// Every tab from the practice nights (whoever opened it), plus the waiters' own records from those
// nights. Debts stay unless ticked; payments in progress, tips still owed, stock moves and other
// staff's cash shifts stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

const OLD = '2026-10-20', NEW = '2026-10-24';
function setup() {
  const { store, env } = createMockEnv();
  const people = { w1: 'waitStaff', w2: 'waitStaff', b1: 'barStaff', m1: 'manager', sa: 'superAdmin', x1: '' };
  for (const [uid, role] of Object.entries(people)) store.seed('users', uid, { name: uid, role, ...(['w2', 'x1'].includes(uid) ? { removed: true } : {}) });
  const tab = (tid, waiterUid, businessDate, extra = {}) => { store.seed('tabs', tid, { number: 1, waiterUid, businessDate, status: 'closed', payments: [], discounts: [], ...extra }); store.seed('rounds', `r_${tid}`, { tabId: tid, waiterUid, status: 'delivered', lines: [] }); };
  tab('old1', 'w1', OLD); tab('old2', 'w2', OLD, { status: 'open' }); tab('new1', 'w1', NEW);
  tab('debt', 'w1', OLD, { status: 'owed' }); tab('paying', 'w1', OLD, { pending: { reference: 'ref1' } });
  tab('bar', 'b1', OLD, { quick: true });
  tab('mgr', 'm1', OLD, { status: 'open' });
  tab('gone1', 'x1', OLD, { status: 'open' });   // a waiter removed through "set role → none" (role is now '')
  tab('debt2', 'w1', OLD, { status: 'owed', number: 7, debt: { name: 'Practice Kofi', amountPesewas: 4000 } });
  store.seed('pending_checkouts', 'ref1', { kind: 'tab', tabId: 'paying', status: 'pending' });
  store.seed('approvals', 'a1', { kind: 'discount', status: 'pending', data: { tabId: 'old1' }, requestedBy: 'm1', businessDate: OLD });
  store.seed('approvals', 'a2', { kind: 'cash_out', status: 'approved', data: { sessionId: `${OLD}__w1` }, requestedBy: 'w1', businessDate: OLD });
  store.seed('approvals', 'a3', { kind: 'discount', status: 'pending', data: { tabId: 'new1' }, requestedBy: 'w1', businessDate: NEW });
  store.seed('approvals', 'a4', { kind: 'discount', status: 'pending', data: { tabId: 'debt' }, requestedBy: 'w1', businessDate: OLD });
  store.seed('cash_sessions', `${OLD}__x1`, { date: OLD, uid: 'x1', role: 'waitStaff' });
  store.seed('cash_sessions', `${OLD}__w1`, { date: OLD, uid: 'w1', role: 'waitStaff' });
  store.seed('cash_sessions', `${NEW}__w1`, { date: NEW, uid: 'w1', role: 'waitStaff' });
  store.seed('cash_sessions', `${OLD}__b1`, { date: OLD, uid: 'b1', role: 'barStaff' });
  store.seed('staff_reports', `${OLD}__w1`, { date: OLD, uid: 'w1', kind: 'waiter' });
  store.seed('tips', 't1', { toUid: 'w1', businessDate: OLD, status: 'cash', amountPesewas: 500 });
  store.seed('tips', 't2', { toUid: 'w1', businessDate: OLD, status: 'owed', amountPesewas: 2000 });
  store.seed('tips', 't3', { toUid: 'b1', businessDate: OLD, status: 'cash', amountPesewas: 500 });
  store.seed('tips', 't4', { toUid: 'b1', tabId: 'bar', businessDate: OLD, status: 'cash', amountPesewas: 300 });
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

test('the preview deletes nothing; the reset clears every practice tab and the waiters’ records, and keeps the rest', async () => {
  const { store, call } = setup();
  const pre = await call('GET', '/api/ops/trial-reset', { who: 'sa' });
  assert.equal(pre.status, 200);
  assert.deepEqual(pre.data.counts, { tabs: 5, rounds: 5, approvals: 2, cash_sessions: 2, staff_reports: 1, tips: 2, tip_payouts: 1 });
  assert.deepEqual(pre.data.kept, { owedTabs: 2, owedTabsPesewas: 4000, payingTabs: 1, owedTips: 1, owedTipsPesewas: 2000 });
  assert.deepEqual(pre.data.owed.map(o => o.id).sort(), ['debt', 'debt2'], 'the debts are listed so the admin can tick practice ones');
  assert.equal(pre.data.owed.find(o => o.id === 'debt2').customerName, 'Practice Kofi');
  assert.equal(store.list('tabs').length, 9, 'the preview deletes nothing');

  assert.match((await call('POST', '/api/ops/trial-reset', { who: 'sa', body: {} })).data.error, /Confirm/);
  // debt2 is ticked as practice; new1 is from an official night, so ticking it does nothing.
  const r = await call('POST', '/api/ops/trial-reset', { who: 'sa', body: { confirm: 'RESET', clearOwed: ['debt2', 'new1'] } });
  assert.equal(r.status, 200);
  assert.deepEqual(ids(store, 'tabs'), ['debt', 'new1', 'paying'], 'manager, bar and removed staff’s practice tabs go too');
  assert.deepEqual(ids(store, 'rounds'), ['r_debt', 'r_new1', 'r_paying']);
  assert.deepEqual(ids(store, 'approvals'), ['a3', 'a4'], 'a request on a kept debt stays with it');
  assert.deepEqual(ids(store, 'cash_sessions'), [`${OLD}__b1`, `${NEW}__w1`], 'the bar’s cash shift stays');
  assert.deepEqual(ids(store, 'staff_reports'), []);
  assert.deepEqual(ids(store, 'tips'), ['t2', 't3'], 'a tip on a cleared tab goes; owed tips and the bar’s other tips stay');
  assert.deepEqual(ids(store, 'tip_payouts'), []);
  assert.deepEqual(ids(store, 'stock_moves'), ['m1'], 'stock is never touched');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'WAITER_TRIAL_RESET'));

  const again = await call('GET', '/api/ops/trial-reset', { who: 'sa' });
  assert.ok(Object.values(again.data.counts).every(n => n === 0), 'nothing left to clear');
  assert.deepEqual(again.data.owed.map(o => o.id), ['debt'], 'the unticked debt is still there to decide on');
});
