// A5: every staff route, independently of the UI. For each route: no token → 401, a signed-in
// account with no staff role → 401, and every staff role outside the allowed set → 403. Allowed
// roles must get past authorization (any status other than 401/403). docs/AUTHZ.md mirrors this.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

const ALL = ['superAdmin', 'manager', 'eventManager', 'doorStaff', 'organiser'];
const CMS = ['superAdmin', 'manager', 'eventManager'];
const MONEY = ['superAdmin', 'manager'];
const SUPER = ['superAdmin'];

export const MATRIX = [
  ['POST', '/api/checkin', ALL, { token: 'x' }],
  ['GET', '/api/door/events', ALL],
  ['GET', '/api/door/summary?eventId=e1', ALL.filter(r => r !== 'organiser')],
  ['GET', '/api/door/search?eventId=e1&q=am', ALL.filter(r => r !== 'organiser')],
  ['POST', '/api/send-sms', MONEY, { recipients: [], message: 'x' }],
  ['GET', '/api/balance', MONEY],
  ['POST', '/api/admin/sms/send', MONEY, { recipients: [], message: 'x' }],
  ['GET', '/api/admin/sms/balance', MONEY],
  ['GET', '/api/admin/me', ALL],
  ['GET', '/api/admin/overview', CMS],
  ['GET', '/api/admin/events', CMS],
  ['GET', '/api/admin/events/e1', CMS],
  ['POST', '/api/admin/events', CMS, { name: 'N', date: '2099-01-01T22:00:00Z' }],
  ['DELETE', '/api/admin/events/e1', SUPER],
  ['POST', '/api/admin/ticket-types', CMS, { eventId: 'e1', name: 'T', pricePesewas: 1000 }],
  ['DELETE', '/api/admin/ticket-types/t1', CMS],
  ['POST', '/api/admin/table-packages', CMS, { eventId: 'e1', name: 'P', pricePesewas: 1000 }],
  ['DELETE', '/api/admin/table-packages/p1', CMS],
  ['POST', '/api/admin/bottles', CMS, { name: 'B', pricePesewas: 1000 }],
  ['DELETE', '/api/admin/bottles/b1', CMS],
  ['GET', '/api/admin/bottles', CMS],
  ['GET', '/api/admin/orders', CMS],
  ['POST', '/api/admin/comps', CMS, { eventId: 'e1', name: 'Guest' }],
  ['POST', '/api/admin/raffles', CMS, { eventId: 'e1', prize: 'x', cap: 5 }],
  ['POST', '/api/admin/raffle/draw', CMS, { raffleId: 'r1' }],
  ['GET', '/api/admin/requests', CMS],
  ['POST', '/api/admin/requests/q1', CMS, { note: 'x' }],
  ['GET', '/api/admin/installments', MONEY],
  ['POST', '/api/admin/installments/resend-sms', MONEY, { planId: 'MEM-AB1234' }],
  ['GET', '/api/admin/settings', MONEY],
  ['POST', '/api/admin/settings', MONEY, { venue: 'x' }],
  ['GET', '/api/admin/staff', SUPER],
  ['POST', '/api/admin/set-role', SUPER, { email: 'a@b.c', role: 'doorStaff' }],
  ['GET', '/api/admin/organiser/overview', ['organiser', 'superAdmin']],
];

function seed(store) {
  store.seed('events', 'e1', { name: 'Night', date: '2099-01-01T22:00:00Z', visibility: 'public', active: true, organiserId: 'someone-else' });
  store.seed('ticket_types', 't1', { eventId: 'e1', name: 'T', pricePesewas: 1000, active: true });
}
async function call(env, method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return res.status;
}

for (const [method, path, allowed, body] of MATRIX) {
  test(`authz ${method} ${path}: allowed ${allowed.join(', ')}`, async () => {
    const { store, env } = createMockEnv(); seed(store);
    assert.equal(await call(env, method, path, null, body), 401, 'no token');
    assert.equal(await call(env, method, path, 'not-a-jwt', body), 401, 'garbage token');
    assert.equal(await call(env, method, path, await idToken({}), body), 401, 'signed in, no staff role');
    assert.equal(await call(env, method, path, await idToken({ role: 'superAdmin' }, { projectId: 'other-project' }), body), 401, 'token for another Firebase project');
    for (const role of ALL) {
      const claims = role === 'superAdmin' ? { role, admin: true } : { role };
      const status = await call(env, method, path, await idToken(claims), body);
      if (allowed.includes(role)) assert.ok(![401, 403].includes(status), `${role} should be allowed, got ${status}`);
      else assert.equal(status, 403, `${role} should be forbidden`);
    }
  });
}

test('set-role: a manager cannot grant roles; a superAdmin cannot demote themselves; every change is audited', async () => {
  const { store, env } = createMockEnv();
  store.authUsers = [{ email: 'boss@x.com', localId: 'boss' }, { email: 'door@x.com', localId: 'door1' }];
  const post = async (token, body) => { const r = await worker.fetch(new Request('https://api.test/api/admin/set-role', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env); return { status: r.status, data: await r.json() }; };
  const mgr = await idToken({ role: 'manager' }, { uid: 'mgr' });
  assert.equal((await post(mgr, { email: 'door@x.com', role: 'superAdmin' })).status, 403, 'manager cannot grant superAdmin');
  assert.equal((await post(mgr, { email: 'mgr@x.com', role: 'superAdmin' })).status, 403, 'manager cannot raise themselves');
  const boss = await idToken({ role: 'superAdmin', admin: true }, { uid: 'boss' });
  const self = await post(boss, { email: 'boss@x.com', role: 'manager' });
  assert.equal(self.status, 400); assert.match(self.data.error, /your own/i);
  assert.equal(store.claimUpdates, undefined, 'no claim written for the refused changes');
  assert.equal((await post(boss, { email: 'door@x.com', role: 'doorStaff' })).status, 200);
  assert.deepEqual(store.claims.door1, { role: 'doorStaff', admin: false }, 'admin:true only comes with superAdmin');
  const logs = store.list('audit_logs').map(d => d.fields);
  assert.equal(logs.length, 1); assert.equal(logs[0].action, 'ROLE_SET'); assert.equal(logs[0].actorUid, 'boss'); assert.equal(logs[0].targetUid, 'door1');
});

test('organiser: door and overview only for their own nights', async () => {
  const { store, env } = createMockEnv(); seed(store);
  store.seed('tickets', 'a'.repeat(64), { eventId: 'e1', eventName: 'Night', customerName: 'Ama', status: 'valid', admitCount: 1 });
  const org = await idToken({ role: 'organiser' }, { uid: 'org-1' });
  const res = await worker.fetch(new Request('https://api.test/api/checkin', { method: 'POST', headers: { Authorization: `Bearer ${org}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(64), eventId: 'e1' }) }), env);
  const d = await res.json();
  assert.equal(d.valid, false); assert.equal(d.code, 'forbidden');
  assert.equal(store.get('tickets', 'a'.repeat(64)).fields.status, 'valid', 'not admitted');
  const ov = await (await worker.fetch(new Request('https://api.test/api/admin/organiser/overview', { headers: { Authorization: `Bearer ${org}` } }), env)).json();
  assert.equal(JSON.stringify(ov).includes('"e1"'), false, 'another organiser’s night is not listed');
});
