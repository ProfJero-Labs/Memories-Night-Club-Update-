// Staff sign in with phone + PIN. Managers add people by phone; a code by text lets them choose
// their PIN; wrong PINs lock; removing someone or changing their job applies at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
async function call(env, method, path, { body, claims, uid } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.50.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (claims) headers.Authorization = `Bearer ${await idToken(claims, uid ? { uid } : undefined)}`;
  const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await r.text();
  return { status: r.status, text, data: JSON.parse(text || '{}') };
}
const decode = jwt => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const lastCode = (store, phone) => /code: (\d{6})/i.exec(store.sms.filter(s => s.to === phone).at(-1).message)[1];
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('users', 'mgr1', { name: 'Akos Manager', phone: '0240000001', role: 'manager' });
  return { store, env, MGR: { claims: { role: 'manager' }, uid: 'mgr1' } };
}
async function addWaiter(ctx, phone = '0245550101') {
  return call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'Efua Mensah', phone, role: 'waitStaff' } });
}

test('a manager adds a waiter by phone; the welcome text has a code; she chooses a PIN and is signed in', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245560000');
  assert.equal(r.status, 200, r.data.error); assert.equal(r.data.texted, true);
  const sms = ctx.store.sms.at(-1);
  assert.equal(sms.to, '0245560000'); assert.match(sms.message, /Waiter \/ waitress/); assert.match(sms.message, /4-number PIN/);
  const code = lastCode(ctx.store, '0245560000');
  assert.match((await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245560000', code, pin: '1234' } })).data.error, /in a row/);
  assert.match((await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245560000', code, pin: '7777' } })).data.error, /same number/);
  assert.match((await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245560000', code, pin: '12' } })).data.error, /4 numbers/);
  const set = await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245560000', code, pin: '2580' } });
  assert.equal(set.status, 200, set.data.error);
  const t = decode(set.data.token);
  assert.equal(t.uid, r.data.uid); assert.equal(t.claims.role, 'waitStaff'); assert.equal(t.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  const rec = ctx.store.get('users', r.data.uid).fields;
  assert.ok(rec.pinHash && rec.pinHash !== '2580' && !JSON.stringify(rec).includes('"2580"'), 'only a hash is kept');
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245560000', code, pin: '2580' } })).status, 400, 'the code works once');
  const ok = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245560000', pin: '2580' } });
  assert.equal(ok.status, 200); assert.equal(decode(ok.data.token).uid, r.data.uid);
  assert.ok(ctx.store.list('members').some(m => m.fields.staffUid === r.data.uid), 'staff are members');
});

test('wrong PINs: same message for unknown phones; 5 wrong locks for 15 minutes; a texted code unlocks', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245570101');
  await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245570101', code: lastCode(ctx.store, '0245570101'), pin: '2580' } });
  const unknown = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0209999999', pin: '2580' } });
  const wrong = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: '1111' } });
  assert.equal(unknown.data.error, wrong.data.error, 'never says whether the phone is staff');
  for (let i = 0; i < 4; i++) await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: '1111' } });
  const locked = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: '2580' } });
  assert.equal(locked.status, 423); assert.match(locked.data.error, /Wait 15 minutes/);
  ctx.store.seed('users', r.data.uid, { ...ctx.store.get('users', r.data.uid).fields, codeSentAt: '' });
  const sent = await call(ctx.env, 'POST', '/api/staff-auth/send-code', { body: { phone: '0245570101' } });
  assert.equal(sent.data.sent, true);
  assert.deepEqual((await call(ctx.env, 'POST', '/api/staff-auth/send-code', { body: { phone: '0209999999' } })).data, sent.data, 'same reply for strangers');
  const reset = await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245570101', code: lastCode(ctx.store, '0245570101'), pin: '3691' } });
  assert.equal(reset.status, 200, reset.data.error);
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: '3691' } })).status, 200);
});

test('managers can add floor staff but not directors or finance; directors can; only the system admin makes admins; managers need 6-number PINs', async () => {
  const ctx = setup();
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'D', phone: '0245550102', role: 'director' } })).status, 403);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'F', phone: '0245550103', role: 'finance' } })).status, 403);
  for (const role of ['barStaff', 'cashier', 'security', 'doorStaff']) assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: role, phone: `02455502${10 + ['barStaff', 'cashier', 'security', 'doorStaff'].indexOf(role)}`, role } })).status, 200, role);
  ctx.store.seed('users', 'dir1', { name: 'Dee', phone: '0240000002', role: 'director' });
  const fin = await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'director' }, uid: 'dir1', body: { name: 'Fin Officer', phone: '0245550104', role: 'finance' } });
  assert.equal(fin.status, 200, fin.data.error);
  assert.match(ctx.store.sms.at(-1).message, /6-number PIN/);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'director' }, uid: 'dir1', body: { name: 'X', phone: '0245550105', role: 'superAdmin' } })).status, 403);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'waitStaff' }, body: { name: 'X', phone: '0245550106', role: 'waitStaff' } })).status, 403, 'a waiter can’t add staff');
  assert.match((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'Dup', phone: '0245550104', role: 'barStaff' } })).data.error, /already uses that phone/);
  const list = await call(ctx.env, 'GET', '/api/admin/people', ctx.MGR);
  assert.ok(list.data.staff.some(s => s.name === 'Fin Officer' && !s.hasPin));
  assert.ok(!list.data.roles.some(r => ['director', 'finance', 'superAdmin'].includes(r.id)), 'a manager is only offered roles they may give');
});

test('removing someone or changing their job applies on the very next request, even with an unexpired token', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245590303');
  const asHer = { claims: { role: 'waitStaff' }, uid: r.data.uid };
  assert.equal((await call(ctx.env, 'GET', '/api/ops/me', asHer)).data.role, 'waitStaff');
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/update', { ...ctx.MGR, body: { uid: r.data.uid, role: 'barStaff' } })).status, 200);
  assert.equal((await call(ctx.env, 'GET', '/api/ops/me', asHer)).data.role, 'barStaff', 'the new job, without signing in again');
  assert.equal((await call(ctx.env, 'GET', '/api/bar/queue', asHer)).status, 200);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/remove', { ...ctx.MGR, body: { uid: r.data.uid } })).status, 200);
  assert.equal((await call(ctx.env, 'GET', '/api/ops/me', asHer)).status, 401, 'removed: no access at once');
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245590303', pin: '2580' } })).status, 401);
  assert.equal(ctx.store.list('members').find(m => m.fields.staffUid === r.data.uid).fields.status, 'suspended');
  assert.ok(ctx.store.get('users', r.data.uid), 'the record stays so past work keeps its name');
});

test('a manager resets a PIN (texted code); staff change their own PIN; nobody can see a PIN', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245510040');
  await call(ctx.env, 'POST', '/api/staff-auth/set-pin', { body: { phone: '0245510040', code: lastCode(ctx.store, '0245510040'), pin: '2580' } });
  const asHer = { claims: { role: 'waitStaff' }, uid: r.data.uid };
  assert.match((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: '0000', pin: '4826' } })).data.error, /current PIN/);
  assert.equal((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: '2580', pin: '4826' } })).status, 200);
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245510040', pin: '4826' } })).status, 200);
  const reset = await call(ctx.env, 'POST', '/api/admin/people/reset-pin', { ...ctx.MGR, body: { uid: r.data.uid } });
  assert.equal(reset.data.texted, true);
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245510040', pin: '4826' } })).data.code, 'no_pin', 'the old PIN stops working');
  const list = await call(ctx.env, 'GET', '/api/admin/people', ctx.MGR);
  assert.ok(!list.text.includes('pinHash') && !list.text.includes('codeHash'));
  assert.ok(ctx.store.list('audit_logs').some(a => a.fields.action === 'STAFF_PIN_RESET'));
});
