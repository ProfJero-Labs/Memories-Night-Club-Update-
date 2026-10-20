// Membership: staff and members get in without a ticket or QR: the door types their number and a
// gate code appears in their app; they read it out. No SMS anywhere in verification.
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
// Members and attendance are the directors' (and the administrator's); managers run the night.
const MANAGER = { role: 'director' }, DOOR = { role: 'doorStaff' };
const step = () => Math.floor(Date.now() / 1000 / 30);
const qr = async (pass, s = step()) => `MP1.${pass.passId}.${s}.${await passSig(pass.secret, pass.passId, s)}`;
async function addKofi(env) {
  return call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { name: 'Kofi Mensah', phone: '024 555 0001', type: 'member', department: 'VIP', staffNo: 'M-014' } });
}
// At the gate: the door types the number, the code shows in the member's app, the door enters it.
async function viaApp(env, pass, phone, claims = DOOR) {
  const req = await call(env, 'POST', '/api/members/door/request-code', { claims, body: { phone } });
  if (!req.data.sent) return req.data;
  const code = (await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } })).data.gate.code;
  return (await call(env, 'POST', '/api/members/door/confirm', { claims, body: { phone, code } })).data;
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
  assert.equal((await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass.data) } })).data.valid, false, 'their pass stopped');
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550002' } })).data.code, 'suspended');
});

test('at the gate there is no QR route: members are verified only through the app; organisers can’t verify club staff', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  assert.equal((await call(env, 'POST', '/api/members/door/pass', { claims: DOOR, body: { qr: await qr(pass) } })).status, 404, 'no pass-QR verification');
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: { role: 'organiser' }, body: { phone: '0245550001' } })).status, 403);
  const ok = await viaApp(env, pass, '0245550001');
  assert.equal(ok.valid, true); assert.equal(ok.message, 'MEMBER VERIFIED');
  assert.equal(store.list('member_entries')[0].fields.method, 'code');
  const old = (await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass, step() - 5) } })).data;
  assert.equal(old.reason, 'clock'); assert.equal(old.gate, undefined, 'an old signature only gets the time, never a code'); assert.equal(old.member, undefined);
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
  assert.equal((await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } })).data.valid, false);
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'suspended');
  await call(env, 'POST', '/api/admin/members', { claims: MANAGER, body: { id: mid, name: 'Kofi Mensah', phone: '0245550001', status: 'active', validUntil: '2020-01-31' } });
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'expired');
  assert.equal(store.list('member_entries').length, 0);
});

test('HR attendance: entries per person and nights present, managers only', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  await viaApp(env, pass, '0245550001');
  assert.equal((await call(env, 'GET', '/api/admin/attendance', { claims: DOOR })).status, 403);
  const a = await call(env, 'GET', '/api/admin/attendance?days=30', { claims: MANAGER });
  assert.equal(a.data.entries.length, 1); assert.deepEqual(a.data.people.map(p => [p.name, p.nights]), [['Kofi Mensah', 1]]);
  assert.ok(!a.text.includes('0245550001'));
  const list = await call(env, 'GET', '/api/admin/members', { claims: MANAGER });
  assert.ok(Array.isArray(list.data.unlinkedStaff), 'staff accounts without a membership are listed for linking');
  assert.equal(store.sms.length, 0);
});

test('a manager can delete a member: the pass stops, the door says not a member, attendance history stays; door staff can’t delete', async () => {
  const { store, env } = createMockEnv();
  const { data: { id: mid } } = await addKofi(env);
  const pass = await activate(env, mid);
  await viaApp(env, pass, '0245550001');
  assert.equal((await call(env, 'POST', '/api/admin/members/delete', { claims: DOOR, body: { id: mid } })).status, 403);
  const del = await call(env, 'POST', '/api/admin/members/delete', { claims: MANAGER, body: { id: mid } });
  assert.equal(del.status, 200, del.data.error); assert.equal(del.data.deleted, true);
  assert.ok(!store.get('members', mid), 'record gone');
  assert.equal((await call(env, 'POST', '/api/members/pass-status', { body: { qr: await qr(pass) } })).data.valid, false);
  assert.equal((await call(env, 'POST', '/api/members/door/request-code', { claims: DOOR, body: { phone: '0245550001' } })).data.code, 'not_member');
  assert.equal(store.list('member_entries').length, 1, 'history kept');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'MEMBER_DELETED'));
  assert.equal((await call(env, 'POST', '/api/admin/members/delete', { claims: MANAGER, body: { id: mid } })).status, 404);
});

test('new roles: a director runs People like a manager; a waitress works the bar screen; both are members automatically', async () => {
  const { store, env } = createMockEnv();
  const boss = { role: 'superAdmin', admin: true };
  for (const [email, role, dept] of [['dir@club.test', 'director', 'Directors'], ['wait@club.test', 'waitStaff', 'Floor (waitstaff)']]) {
    const inv = await call(env, 'POST', '/api/admin/staff/invite', { claims: boss, body: { email, name: `Test ${role}`, phone: role === 'director' ? '0245550011' : '0245550012', role } });
    assert.equal(inv.status, 200, inv.data.error);
    const m = store.list('members').find(x => x.fields.staffUid === inv.data.uid);
    assert.equal(m.fields.type, 'staff'); assert.equal(m.fields.department, dept);
  }
  assert.equal((await call(env, 'GET', '/api/admin/members', { claims: { role: 'director' } })).status, 200);
  assert.equal((await call(env, 'GET', '/api/admin/members', { claims: { role: 'waitStaff' } })).status, 403);
  assert.equal((await call(env, 'GET', '/api/bar/queue', { claims: { role: 'waitStaff' } })).status, 200);
  assert.equal((await call(env, 'POST', '/api/admin/staff/invite', { claims: { role: 'director' }, body: { email: 'x@club.test', name: 'X', phone: '0245550013', role: 'manager' } })).status, 403, 'only a super admin manages staff');
});

test('older staff accounts with a phone become members in one tap; removed staff and those without a phone are left', async () => {
  const { store, env } = createMockEnv();
  store.seed('users', 'old1', { email: 'a@club.test', name: 'Old Door', phone: '0245550301', role: 'doorStaff' });
  store.seed('users', 'old2', { email: 'b@club.test', role: 'barStaff' });
  store.seed('users', 'gone', { email: 'c@club.test', name: 'Gone', phone: '0245550302', role: '', removed: true });
  const r = await call(env, 'POST', '/api/admin/members/link-staff', { claims: MANAGER, body: {} });
  assert.deepEqual([r.data.made, r.data.noPhone], [1, 1]);
  assert.equal(store.list('members').find(m => m.fields.staffUid === 'old1').fields.type, 'staff');
  assert.equal((await call(env, 'POST', '/api/admin/members/link-staff', { claims: DOOR, body: {} })).status, 403);
});
