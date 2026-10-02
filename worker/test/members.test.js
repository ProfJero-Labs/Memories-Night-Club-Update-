// Membership: staff and members get in without a ticket after the door verifies them, by the
// rotating pass QR or by a code texted to their phone. Every entry is the HR attendance log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { passSig } from '../src/members.js';

let ip = 0;
async function call(env, method, path, { body, claims, uid } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.20.${Math.floor(++ip / 250)}.${ip % 250}` };
  if (claims) headers.Authorization = `Bearer ${await idToken(claims, uid ? { uid } : undefined)}`;
  const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, text: await r.clone().text(), data: await r.json().catch(() => ({})) };
}
const MANAGER = { role: 'manager' }, DOOR = { role: 'doorStaff' };
const lastCode = store => /(\d{6})/.exec(store.sms.at(-1).message)[1];
const step = () => Math.floor(Date.now() / 1000 / 30);
async function addKofi(env) {
  return call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { name: 'Kofi Mensah', phone: '024 555 0001', type: 'staff', department: 'Bar', position: 'Barman', staffNo: 'MEM-S-014' } });
}
async function signIn(env, store) {
  await call(env, 'POST', '/api/members/pass-code', { body: { phone: '0245550001' } });
  return (await call(env, 'POST', '/api/members/pass', { body: { phone: '0245550001', code: lastCode(store), device: 'Tecno' } })).data;
}
const qr = async (pass, s = step()) => `MP1.${pass.passId}.${s}.${await passSig(pass.secret, pass.passId, s)}`;

test('managers add members (door staff can’t); the member is texted the pass link; one number, one member', async () => {
  const { store, env } = createMockEnv();
  assert.equal((await call(env, 'POST', '/api/admin/members', { claims: DOOR, body: { name: 'X', phone: '0245550009' } })).status, 403);
  const r = await addKofi(env);
  assert.equal(r.status, 200, r.data.error); assert.equal(r.data.texted, true);
  assert.match(store.sms.at(-1).message, /member\.html/);
  assert.equal(store.sms.at(-1).to, '0245550001');
  const dup = await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { name: 'Someone Else', phone: '0245550001' } });
  assert.equal(dup.status, 400); assert.match(dup.data.error, /Kofi Mensah already has that number/);
  const list = await call(env, 'GET', '/api/admin/members', { claims: MANAGER });
  assert.equal(list.data.members[0].department, 'Bar');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'MEMBER_ADDED'));
});

test('the pass: signing in needs a code texted to the member’s phone; unknown numbers get the same reply and no text', async () => {
  const { store, env } = createMockEnv(); await addKofi(env);
  const before = store.sms.length;
  const known = await call(env, 'POST', '/api/members/pass-code', { body: { phone: '0245550001' } });
  const unknown = await call(env, 'POST', '/api/members/pass-code', { body: { phone: '0209999999' } });
  assert.equal(known.text, unknown.text);
  assert.equal(store.sms.length, before + 1);
  const wrong = String((Number(lastCode(store)) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call(env, 'POST', '/api/members/pass', { body: { phone: '0245550001', code: wrong } })).status, 400);
  const ok = await call(env, 'POST', '/api/members/pass', { body: { phone: '0245550001', code: lastCode(store) } });
  assert.equal(ok.status, 200);
  assert.match(ok.data.passId, /^[0-9a-f]{32}$/); assert.match(ok.data.secret, /^[0-9a-f]{64}$/);
  assert.equal(ok.data.member.name, 'Kofi Mensah'); assert.equal(ok.data.member.phoneHint, '024***0001');
  assert.ok(!ok.text.includes('0245550001'), 'never the full phone');
});

test('at the gate, the live pass QR verifies the member and logs the entry; a screenshot goes stale; a forged QR fails', async () => {
  const { store, env } = createMockEnv(); await addKofi(env);
  const pass = await signIn(env, store);
  const r = await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, uid: 'door-1', body: { qr: await qr(pass) } });
  assert.equal(r.data.valid, true); assert.equal(r.data.message, 'STAFF VERIFIED'); assert.equal(r.data.member.position, 'Barman');
  const e = store.list('member_entries');
  assert.equal(e.length, 1); assert.equal(e[0].fields.method, 'pass'); assert.equal(e[0].fields.by, 'door-1');

  const old = await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass, step() - 5) } });
  assert.equal(old.data.code, 'stale_pass', 'a 2½-minute-old screenshot is refused');
  const forged = `MP1.${pass.passId}.${step()}.${'A'.repeat(16)}`;
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: forged } })).data.code, 'invalid_pass');
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: { role: 'organiser' }, body: { qr: await qr(pass) } })).status, 403, 'organisers don’t verify club staff');
  assert.equal(store.list('member_entries').length, 1, 'only the real scan was logged');
});

test('at the gate by phone: the door texts the member a code, the member says it, the door enters it', async () => {
  const { store, env } = createMockEnv(); await addKofi(env);
  const none = await call(env, 'POST', '/api/members/door/send-code', { claims: DOOR, body: { phone: '0209999999' } });
  assert.equal(none.data.code, 'not_member', 'the door is told plainly: they need a ticket');
  const sent = await call(env, 'POST', '/api/members/door/send-code', { claims: DOOR, body: { phone: '024 555 0001' } });
  assert.equal(sent.data.sent, true); assert.equal(sent.data.firstName, 'Kofi');
  assert.equal(store.sms.at(-1).to, '0245550001'); assert.match(store.sms.at(-1).message, /Say it to the door/);
  const code = lastCode(store);
  assert.ok(!sent.text.includes(code), 'the door never sees the code; the member has to say it');
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550001', code: wrong } })).data.code, 'wrong_code');
  const ok = await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550001', code } });
  assert.equal(ok.data.valid, true); assert.equal(ok.data.member.name, 'Kofi Mensah');
  assert.equal(store.list('member_entries')[0].fields.method, 'code');
  assert.equal((await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550001', code } })).data.valid, false, 'a code works once');
});

test('suspending a member stops the pass and the phone route at once; an expired membership is refused', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await signIn(env, store);
  await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { id: mid, name: 'Kofi Mensah', phone: '0245550001', type: 'staff', status: 'suspended' } });
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass) } })).data.code, 'invalid_pass', 'passes retired on suspension');
  assert.equal((await call(env, 'POST', '/api/members/door/send-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'suspended');
  await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { id: mid, name: 'Kofi Mensah', phone: '0245550001', type: 'staff', status: 'active', validUntil: '2020-01-31' } });
  assert.equal((await call(env, 'POST', '/api/members/door/send-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'expired');
  assert.equal(store.list('member_entries').length, 0);
});

test('the pass checks itself online: still valid, and when it was last verified at the gate', async () => {
  const { store, env } = createMockEnv(); await addKofi(env);
  const pass = await signIn(env, store);
  let s = await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } });
  assert.equal(s.data.valid, true); assert.equal(s.data.lastEntry, null);
  await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass) } });
  s = await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } });
  assert.ok(s.data.lastEntry);
  assert.equal((await call(env, 'POST', '/api/members/pass-status', { body: { qr: 'MP1.nonsense' } })).data.valid, false);
});

test('HR attendance: entries per person and nights present, managers only', async () => {
  const { store, env } = createMockEnv(); await addKofi(env);
  await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { name: 'Ama Owusu', phone: '0245550002', type: 'member' } });
  const pass = await signIn(env, store);
  await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass) } });
  await call(env, 'POST', '/api/members/door/send-code', { claims: DOOR, body: { phone: '0245550002' } });
  await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550002', code: lastCode(store) } });
  assert.equal((await call(env, 'GET', '/api/admin/attendance', { claims: DOOR })).status, 403);
  const a = await call(env, 'GET', '/api/admin/attendance?days=30', { claims: MANAGER });
  assert.equal(a.data.entries.length, 2);
  assert.deepEqual(a.data.people.map(p => [p.name, p.nights]).sort(), [['Ama Owusu', 1], ['Kofi Mensah', 1]]);
  assert.ok(!a.text.includes('0245550002'), 'no phone numbers in the attendance log');
});
