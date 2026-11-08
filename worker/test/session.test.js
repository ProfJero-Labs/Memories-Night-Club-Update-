// Staff sessions without Firebase (lib/session.js): the Worker signs and checks its own token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';
import { signSession } from '../src/lib/session.js';
import { forgetStaffRecord } from '../src/lib/auth.js';

const SECRET = 'a-long-test-secret-for-sessions-0123456789';
let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  Object.assign(env, { AUTH_BACKEND: 'own', APP_JWT_SECRET: SECRET });
  store.seed('users', 'u1', { name: 'Efua', role: 'waitStaff', phone: '0245550001' });
  store.seed('users', 'm1', { name: 'Akos', role: 'manager', phone: '0245550002' });
  const call = async (method, path, token, body) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.44.${Math.floor(++ip / 250)}.${ip % 250}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, env, call };
}

test('a signed session token opens the staff screens; the role comes from the staff record, not the token', async () => {
  const { env, call } = setup();
  const token = await signSession(env, 'u1', 'waitStaff');
  const me = await call('GET', '/api/ops/me', token);
  assert.equal(me.status, 200); assert.equal(me.data.role, 'waitStaff');
  // A token that claims more than the record says gets only what the record says.
  const greedy = await new SignJWT({ uid: 'u1', role: 'superAdmin', admin: true }).setProtectedHeader({ alg: 'HS256' }).setIssuer('memories-staff').setSubject('u1').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  assert.equal((await call('GET', '/api/ops/me', greedy)).data.role, 'waitStaff');
});

test('forged, expired, foreign or missing tokens are refused', async () => {
  const { call } = setup();
  const enc = s => new TextEncoder().encode(s);
  const make = (secret, { iss = 'memories-staff', exp = '1h' } = {}) => new SignJWT({ uid: 'u1' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(iss).setSubject('u1').setIssuedAt().setExpirationTime(exp).sign(enc(secret));
  assert.equal((await call('GET', '/api/ops/me', null)).status, 401, 'no token');
  assert.equal((await call('GET', '/api/ops/me', await make('some-other-secret-0123456789abcdef'))).status, 401, 'signed with another key');
  assert.equal((await call('GET', '/api/ops/me', await make(SECRET, { iss: 'someone-else' }))).status, 401, 'another issuer');
  assert.equal((await call('GET', '/api/ops/me', await make(SECRET, { exp: '-1m' }))).status, 401, 'expired');
  assert.equal((await call('GET', '/api/ops/me', (await make(SECRET)).slice(0, -3) + 'abc')).status, 401, 'tampered');
  assert.equal((await call('GET', '/api/ops/me', 'not.a.token')).status, 401);
});

test('removing someone, or signing them out everywhere, stops their old tokens at once', async () => {
  const { store, env, call } = setup();
  const old = await signSession(env, 'u1', 'waitStaff');
  assert.equal((await call('GET', '/api/ops/me', old)).status, 200);
  // Signed out everywhere: tokens made before that moment stop; a fresh sign-in works.
  store.seed('users', 'u1', { ...store.get('users', 'u1').fields, sessionsFrom: new Date(Date.now() + 5000) });
  forgetStaffRecord(env, 'u1'); // (the staff record is saved for 10 seconds; a change in this Worker clears it)
  assert.equal((await call('GET', '/api/ops/me', old)).status, 401, 'the old token stopped');
  // Removed: no access whatever the token says.
  store.seed('users', 'u1', { ...store.get('users', 'u1').fields, sessionsFrom: '', removed: true });
  forgetStaffRecord(env, 'u1');
  assert.equal((await call('GET', '/api/ops/me', await signSession(env, 'u1', 'waitStaff'))).status, 401, 'removed');
});

test('phone + PIN sign-in hands back a session token; the page refreshes it with /api/ops/session', async () => {
  const { store, env, call } = setup();
  const { sendNewPin } = await import('../src/staffauth.js');
  await sendNewPin(env, { phone: '0245550001' });
  const pin = /PIN: (\d{4,6})/.exec(store.sms.at(-1).message)[1];
  const r = await call('POST', '/api/staff-auth/sign-in', null, { phone: '0245550001', pin });
  assert.equal(r.status, 200, r.data.error); assert.equal(r.data.own, true); assert.equal(r.data.role, 'waitStaff');
  const again = await call('POST', '/api/ops/session', r.data.token);
  assert.equal(again.status, 200); assert.equal(again.data.role, 'waitStaff');
  assert.equal((await call('GET', '/api/ops/me', again.data.token)).status, 200, 'the fresh token works');
});

test('the old email invite is switched off with a plain explanation', async () => {
  const { env, call } = setup();
  const boss = await signSession(env, 'm1', 'manager');
  const r = await call('POST', '/api/admin/set-role', boss, { email: 'a@b.co', role: 'manager' });
  assert.ok([403, 410].includes(r.status));
  const { setRole } = await import('../src/admin.js');
  const out = await setRole(env, { email: 'a@b.co', role: 'manager' }, { uid: 'x', role: 'superAdmin', admin: true });
  assert.equal(out.status, 410); assert.match(out.error, /phone number and a PIN/);
});

test('with no separate session secret, one is derived from the Supabase service key (one secret to set, not two)', async () => {
  const { env, call } = setup();
  delete env.APP_JWT_SECRET; env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_a-long-service-key-for-the-test-0123456789';
  const token = await signSession(env, 'u1', 'waitStaff');
  assert.equal((await call('GET', '/api/ops/me', token)).status, 200);
  env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_a-different-service-key-0123456789abcdef';
  assert.equal((await call('GET', '/api/ops/me', token)).status, 401, 'a different key signs differently');
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  await assert.rejects(signSession(env, 'u1', 'waitStaff'), /SUPABASE_SERVICE_ROLE_KEY is not set/);
});
