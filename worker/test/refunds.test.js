// Refunds owed: every case the payment flows flag shows up once, with the right amount, and can
// be marked refunded only with a note (audited).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

function seed(store) {
  store.seed('pending_checkouts', 'ref-ticket', { kind: 'ticket', eventName: 'Fri', buyerName: 'Ama', buyerPhone: '0241234567', amountPesewas: 15000, status: 'failed', error: 'sold_out_after_payment', refundStatus: 'manual_required', createdAt: '2026-10-01T10:00:00Z' });
  store.seed('pending_checkouts', 'ref-table', { kind: 'table', eventName: 'Fri', name: 'Kofi', phone: '0551112222', amountPesewas: 200000, status: 'failed', error: 'table_sold_out_after_payment', refundStatus: 'manual_required' });
  // A sold-out plan: listed once, for everything paid (its last top-up is not listed separately).
  store.seed('installment_plans', 'MEM-SOLD0-OUT00', { eventName: 'Fri', buyerName: 'Esi', buyerPhone: '0209998888', totalPesewas: 15000, paidPesewas: 15000, status: 'sold_out' });
  store.seed('pending_checkouts', 'ref-last-topup', { kind: 'installment_topup', planId: 'MEM-SOLD0-OUT00', amountPesewas: 5000, status: 'failed', error: 'sold_out_after_payment', refundStatus: 'manual_required' });
  store.seed('installment_plans', 'MEM-OVER0-PAID0', { eventName: 'Sat', buyerName: 'Yaw', buyerPhone: '0501231234', totalPesewas: 10000, paidPesewas: 12000, overpaidPesewas: 2000, status: 'completed' });
  store.seed('pending_checkouts', 'ref-done', { kind: 'ticket', amountPesewas: 999, refundStatus: 'refunded' });
}
const call = async (env, method, path, body, claims = { role: 'manager' }) => {
  const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: { Authorization: `Bearer ${await idToken(claims, { uid: 'mgr-1' })}` }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, data: await r.json() };
};

test('refunds owed: tickets/tables after sell-out, sold-out plans (whole amount), overpayments', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const { data } = await call(env, 'GET', '/api/admin/refunds');
  const rows = Object.fromEntries(data.refunds.map(r => [`${r.source}:${r.id}`, r.amountPesewas]));
  assert.deepEqual(rows, { 'checkout:ref-ticket': 15000, 'checkout:ref-table': 200000, 'plan:MEM-SOLD0-OUT00': 15000, 'overpay:MEM-OVER0-PAID0': 2000 });
  assert.equal(data.totalPesewas, 232000);
  assert.equal(data.refunds.find(r => r.id === 'ref-table').buyerName, 'Kofi');
});

test('mark refunded needs a note, works once, and is audited', async () => {
  const { store, env } = createMockEnv(); seed(store);
  assert.equal((await call(env, 'POST', '/api/admin/refunds/mark', { source: 'checkout', id: 'ref-ticket', note: ' ' })).status, 400);
  assert.equal((await call(env, 'POST', '/api/admin/refunds/mark', { source: 'checkout', id: 'ref-ticket', note: 'Paystack refund RF-1' })).status, 200);
  assert.equal((await call(env, 'POST', '/api/admin/refunds/mark', { source: 'checkout', id: 'ref-ticket', note: 'again' })).status, 400, 'not twice');
  assert.equal((await call(env, 'POST', '/api/admin/refunds/mark', { source: 'plan', id: 'MEM-SOLD0-OUT00', note: 'MoMo back' })).status, 200);
  assert.equal((await call(env, 'POST', '/api/admin/refunds/mark', { source: 'overpay', id: 'MEM-OVER0-PAID0', note: 'cash' })).status, 200);
  assert.equal(store.get('installment_plans', 'MEM-OVER0-PAID0').fields.status, 'completed', 'the paid ticket stays valid');
  const left = (await call(env, 'GET', '/api/admin/refunds')).data.refunds.map(r => r.id);
  assert.deepEqual(left, ['ref-table']);
  const logs = store.list('audit_logs').map(d => d.fields);
  assert.equal(logs.length, 3); assert.ok(logs.every(l => l.action === 'REFUND_MARKED' && l.actorUid === 'mgr-1' && l.note));
});
