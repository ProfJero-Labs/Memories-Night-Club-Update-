// Membership: staff and members get in without a ticket after the door verifies them, by the
// rotating pass QR or by a gate code that appears in their app. No SMS anywhere in verification.
// Every staff account is a member. Every entry is the HR attendance log.
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
const step = () => Math.floor(Date.now() / 1000 / 30);
const qr = async (pass, s = step()) => `MP1.${pass.passId}.${s}.${await passSig(pass.secret, pass.passId, s)}`;
async function addKofi(env) {
  return call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { name: 'Kofi Mensah', phone: '024 555 0001', type: 'member', department: 'VIP', staffNo: 'M-014' } });
}
async function activate(env, mid) {
  const a = await call(env, 'POST', '/api/admin/members/activation', { claims: MANAGER, body: { id: mid } });
  return (await call(env, 'POST', '/api/members/activate', { body: { code: a.data.code, device: 'Tecno' } })).data;
}

test('managers add members (door staff can’t); one number, one member; nothing is texted', async () => {
  const { store, env } = createMockEnv();
  assert.equal((await call(env, 'POST', '/api/admin/members', { claims: DOOR, body: { name: 'X', phone: '0245550009' } })).status, 403);
  const r = await addKofi(env);
  assert.equal(r.status, 200, r.data.error);
  assert.equal(store.sms.length, 0, 'no SMS');
  const dup = await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { name: 'Someone Else', phone: '0245550001' } });
  assert.equal(dup.status, 400); assert.match(dup.data.error, /Kofi Mensah already has that number/);
});

test('activation: the manager’s one-time QR/link puts the pass on the member’s phone; it works once; no SMS', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const a = await call(env, 'POST', '/api/admin/members/activation', { claims: MANAGER, body: { id: mid } });
  assert.match(a.data.code, /^[0-9A-HJKMNP-TV-Z]{10}$/); assert.match(a.data.link, /member\.html\?activate=/);
  assert.equal(store.sms.length, 0, 'not texted unless the manager asks');
  const ok = await call(env, 'POST', '/api/members/activate', { body: { code: a.data.code.toLowerCase() } });
  assert.equal(ok.status, 200, ok.data.error);
  assert.match(ok.data.passId, /^[0-9a-f]{32}$/); assert.match(ok.data.secret, /^[0-9a-f]{64}$/);
  assert.equal(ok.data.member.name, 'Kofi Mensah'); assert.ok(!ok.text.includes('0245550001'), 'never the full phone');
  assert.equal((await call(env, 'POST', '/api/members/activate', { body: { code: a.data.code } })).status, 400, 'used once');
  assert.equal((await call(env, 'POST', '/api/members/activate', { body: { code: 'ABCDEFGHJK' } })).status, 400);
});

test('every staff account is a member: inviting staff creates the membership; their dashboard opens their pass; removing access suspends it', async () => {
  const { store, env } = createMockEnv();
  const boss = { role: 'superAdmin', admin: true };
  const inv = await call(env, 'POST', '/api/admin/staff/invite', { claims: boss, body: { email: 'ama@club.test', name: 'Ama Owusu', phone: '0245550002', role: 'doorStaff' } });
  assert.equal(inv.status, 200, inv.data.error);
  const m = store.list('members').find(x => x.fields.staffUid === inv.data.uid);
  assert.ok(m, 'membership created with the account');
  assert.equal(m.fields.type, 'staff'); assert.equal(m.fields.department, 'Door'); assert.equal(m.fields.phone, '0245550002');
  const pass = await call(env, 'POST', '/api/members/my-pass', { claims: { role: 'doorStaff' }, uid: inv.data.uid, body: {} });
  assert.equal(pass.status, 200, pass.data.error); assert.equal(pass.data.member.type, 'staff');
  assert.equal((await call(env, 'POST', '/api/members/my-pass', { claims: { role: 'barStaff' }, uid: 'not-linked', body: {} })).status, 404);
  await call(env, 'POST', '/api/admin/set-role', { claims: boss, body: { email: 'ama@club.test', role: 'none' } });
  assert.equal(store.get('members', m.id).fields.status, 'suspended');
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass.data) } })).data.code, 'invalid_pass', 'their pass stopped');
});

test('at the gate, the live pass QR verifies the member and logs the entry; a screenshot goes stale; a forged QR fails', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  const r = await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, uid: 'door-1', body: { qr: await qr(pass) } });
  assert.equal(r.data.valid, true); assert.equal(r.data.message, 'MEMBER VERIFIED');
  assert.equal(store.list('member_entries')[0].fields.method, 'pass');
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass, step() - 5) } })).data.code, 'stale_pass');
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: `MP1.${pass.passId}.${step()}.${'A'.repeat(16)}` } })).data.code, 'invalid_pass');
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: { role: 'organiser' }, body: { qr: await qr(pass) } })).status, 403, 'organisers don’t verify club staff');
  assert.equal(store.list('member_entries').length, 1);
});

test('at the gate by phone: the code appears in the member’s app (never by SMS); they say it; the door enters it', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0209999999' } })).data.code, 'not_member');
  const req = await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '024 555 0001' } });
  assert.equal(req.data.sent, true); assert.equal(req.data.firstName, 'Kofi'); assert.match(req.data.message, /their app/i);
  assert.equal(store.sms.length, 0, 'no SMS');
  const onPhone = await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } });
  const code = onPhone.data.gate.code;
  assert.match(code, /^\d{6}$/);
  assert.ok(!req.text.includes(code), 'the door never sees the code; the member has to say it');
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550001', code: wrong } })).data.code, 'wrong_code');
  const ok = await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550001', code } });
  assert.equal(ok.data.valid, true);
  assert.equal(store.list('member_entries')[0].fields.method, 'code');
  assert.equal((await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } })).data.gate, null, 'used up');
});

test('a staff member (e.g. an organiser) sees their gate code on their own dashboard', async () => {
  const { store, env } = createMockEnv();
  const boss = { role: 'superAdmin', admin: true };
  const inv = await call(env, 'POST', '/api/admin/staff/invite', { claims: boss, body: { email: 'org@club.test', name: 'Yaw Org', phone: '0245550003', role: 'organiser' } });
  assert.equal((await call(env, 'GET', '/api/members/my-gate', { claims: { role: 'organiser' }, uid: inv.data.uid })).data.gate, null);
  await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550003' } });
  const mine = await call(env, 'GET', '/api/members/my-gate', { claims: { role: 'organiser' }, uid: inv.data.uid });
  assert.match(mine.data.gate.code, /^\d{6}$/);
  const ok = await call(env, 'POST', '/api/members/door/confirm', { claims: DOOR, body: { phone: '0245550003', code: mine.data.gate.code } });
  assert.equal(ok.data.message, 'STAFF VERIFIED');
  assert.equal(store.sms.filter(s => s.to === '0245550003' && /code/i.test(s.message) && !/Password/.test(s.message)).length, 0, 'no verification SMS');
});

test('suspending a member stops the pass and the phone route at once; an expired membership is refused', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { id: mid, name: 'Kofi Mensah', phone: '0245550001', status: 'suspended' } });
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass) } })).data.code, 'invalid_pass');
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'suspended');
  await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { id: mid, name: 'Kofi Mensah', phone: '0245550001', status: 'active', validUntil: '2020-01-31' } });
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'expired');
  assert.equal(store.list('member_entries').length, 0);
});

test('HR attendance: entries per person and nights present, managers only', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass) } });
  assert.equal((await call(env, 'GET', '/api/admin/attendance', { claims: DOOR })).status, 403);
  const a = await call(env, 'GET', '/api/admin/attendance?days=30', { claims: MANAGER });
  assert.equal(a.data.entries.length, 1); assert.deepEqual(a.data.people.map(p => [p.name, p.nights]), [['Kofi Mensah', 1]]);
  assert.ok(!a.text.includes('0245550001'));
  const list = await call(env, 'GET', '/api/admin/members', { claims: MANAGER });
  assert.ok(Array.isArray(list.data.unlinkedStaff), 'staff accounts without a membership are listed for linking');
  assert.equal(store.sms.length, 0);
});
