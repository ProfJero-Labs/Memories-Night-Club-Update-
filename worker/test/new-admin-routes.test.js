import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { getSettings, updateSettings, updatePrivateRequest, adminInstallments, rateLimited } from '../src/index.js';

// ── Site settings ──

test('getSettings returns defaults when no settings doc exists yet', async () => {
  const { env } = createMockEnv();
  const s = await getSettings(env);
  assert.equal(s.venue, 'SamRit Hotel, Cape Coast');
  assert.equal(s.phone, '');
});

test('updateSettings is forbidden for a non-admin role', async () => {
  const { env } = createMockEnv();
  const r = await updateSettings(env, { phone: '0555555555' }, { uid: 'u1', role: 'doorStaff' });
  assert.equal(r.error, 'Forbidden.');
  assert.equal(r.status, 403);
});

test('updateSettings applies only the whitelisted fields, and getSettings reflects the change', async () => {
  const { env } = createMockEnv();
  const r = await updateSettings(env, {
    phone: '0555555555', email: 'hello@memoriesnightclub.gh', notAllowed: 'should be ignored',
  }, { uid: 'staff-1', role: 'manager' });
  assert.equal(r.error, undefined);

  const s = await getSettings(env);
  assert.equal(s.phone, '0555555555');
  assert.equal(s.email, 'hello@memoriesnightclub.gh');
  assert.equal(s.notAllowed, undefined, 'a field outside the whitelist must never be written');
});

// ── Private-night request workflow ──

test('updatePrivateRequest is forbidden for a role below eventManager', async () => {
  const { env } = createMockEnv();
  const r = await updatePrivateRequest(env, 'req1', { status: 'ACCEPTED' }, { uid: 'u1', role: 'doorStaff' });
  assert.equal(r.error, 'Forbidden.');
  assert.equal(r.status, 403);
});

test('accepting a request SMS+emails the customer exactly once, not on a second identical call', async () => {
  const { store, env } = createMockEnv();
  store.seed('private_event_requests', 'req1', {
    name: 'Ama', phone: '0555000111', email: 'ama@example.com',
    eventType: 'Launch', status: 'NEW', createdAt: new Date().toISOString(),
  });
  const admin = { uid: 'staff-1', role: 'manager' };

  const r1 = await updatePrivateRequest(env, 'req1', { status: 'ACCEPTED' }, admin);
  assert.equal(r1.error, undefined);
  assert.equal(store.sms.length, 1, 'one SMS on the actual status change');
  assert.equal(store.sms[0].to, '0555000111');
  assert.equal(store.emails.length, 1, 'one email on the actual status change');

  // Calling again with the same status (e.g. a duplicate/retry) must not re-notify —
  // status !== existing.fields.status is false the second time.
  const r2 = await updatePrivateRequest(env, 'req1', { status: 'ACCEPTED' }, admin);
  assert.equal(r2.error, undefined);
  assert.equal(store.sms.length, 1, 'no duplicate SMS on a repeat call with the same status');
  assert.equal(store.emails.length, 1, 'no duplicate email on a repeat call with the same status');
});

test('declining a request notifies the customer with the decline message', async () => {
  const { store, env } = createMockEnv();
  store.seed('private_event_requests', 'req2', {
    name: 'Kwame', phone: '0555000222', email: 'kwame@example.com',
    eventType: 'Corporate', status: 'NEW', createdAt: new Date().toISOString(),
  });
  const r = await updatePrivateRequest(env, 'req2', { status: 'DECLINED' }, { uid: 'staff-1', role: 'superAdmin' });
  assert.equal(r.error, undefined);
  assert.equal(store.sms.length, 1);
  assert.match(store.sms[0].message, /can't hold/i);
});

test('adding a note without changing status does not send any notification', async () => {
  const { store, env } = createMockEnv();
  store.seed('private_event_requests', 'req3', {
    name: 'Yaw', phone: '0555000333', email: 'yaw@example.com',
    eventType: 'Reunion', status: 'NEW', createdAt: new Date().toISOString(),
  });
  const r = await updatePrivateRequest(env, 'req3', { note: 'Following up by phone Friday.' }, { uid: 'staff-1', role: 'eventManager' });
  assert.equal(r.error, undefined);
  assert.equal(store.sms.length, 0);
  assert.equal(store.emails.length, 0);
  const doc = store.get('private_event_requests', 'req3');
  assert.equal(doc.fields.note, 'Following up by phone Friday.');
  assert.equal(doc.fields.status, 'NEW', 'status is untouched when only the note is updated');
});

test('updatePrivateRequest 404s for a request that does not exist', async () => {
  const { env } = createMockEnv();
  const r = await updatePrivateRequest(env, 'ghost', { status: 'ACCEPTED' }, { uid: 'staff-1', role: 'superAdmin' });
  assert.equal(r.error, 'Request not found.');
  assert.equal(r.status, 404);
});

// ── Installments admin view ──

test('adminInstallments lists every plan, newest first', async () => {
  const { store, env } = createMockEnv();
  store.seed('installment_plans', 'MEM-OLD1', { buyerName: 'Old Plan', createdAt: '2024-01-01T00:00:00.000Z', status: 'active' });
  store.seed('installment_plans', 'MEM-NEW1', { buyerName: 'New Plan', createdAt: '2025-06-01T00:00:00.000Z', status: 'active' });

  const d = await adminInstallments(env, { uid: 'm1', role: 'manager' });
  assert.equal(d.plans.length, 2);
  assert.equal(d.plans[0].id, 'MEM-NEW1', 'newest plan first');
  assert.equal(d.plans[1].id, 'MEM-OLD1');
});

// ── Rate limiting (best-effort, per-isolate) ──

test('rateLimited allows requests under the limit and blocks once the limit is hit', () => {
  const req = new Request('https://worker.test/x', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  const key = `test-key-${Date.now()}`;
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimited(req, key, 3, 60000), false, `request ${i + 1} of 3 should be allowed`);
  }
  assert.equal(rateLimited(req, key, 3, 60000), true, 'the 4th request over a limit of 3 should be blocked');
});

test('rateLimited tracks different IPs and different keys independently', () => {
  const reqA = new Request('https://worker.test/x', { headers: { 'CF-Connecting-IP': '203.0.113.10' } });
  const reqB = new Request('https://worker.test/x', { headers: { 'CF-Connecting-IP': '203.0.113.20' } });
  const key = `test-independent-${Date.now()}`;
  assert.equal(rateLimited(reqA, key, 1, 60000), false);
  assert.equal(rateLimited(reqA, key, 1, 60000), true, 'same IP, same key, over limit — blocked');
  assert.equal(rateLimited(reqB, key, 1, 60000), false, 'different IP, same key — its own bucket, not blocked');
});
