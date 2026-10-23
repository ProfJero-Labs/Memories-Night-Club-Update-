// Staff sign in with phone + PIN. Managers add people by phone and the system texts each a starting
// PIN they can sign in with at once (and change later); wrong PINs lock; removing someone or
// changing their job applies at once.
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
const lastPin = (store, phone) => /PIN: (\d{4,6})/.exec(store.sms.filter(s => s.to === phone).at(-1).message)[1];
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  // The Human manager looks after the staff accounts.
  store.seed('users', 'mgr1', { name: 'Akos Manager', phone: '0240000001', role: 'hrManager' });
  return { store, env, MGR: { claims: { role: 'hrManager' }, uid: 'mgr1' } };
}
async function addWaiter(ctx, phone = '0245550101') {
  return call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'Efua Mensah', phone, role: 'waitStaff' } });
}

test('a manager adds a waiter by phone; the text has her PIN; she signs in with it at once and can change it', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245560000');
  assert.equal(r.status, 200, r.data.error); assert.equal(r.data.texted, true);
  const sms = ctx.store.sms.at(-1);
  assert.equal(sms.to, '0245560000'); assert.match(sms.message, /Waiter \/ waitress/); assert.match(sms.message, /login\.html/);
  const pin = lastPin(ctx.store, '0245560000');
  assert.match(pin, /^\d{4}$/); assert.equal(r.data.pin, pin, 'the manager sees the same PIN once, in case the text is lost');
  const rec = ctx.store.get('users', r.data.uid).fields;
  assert.ok(rec.pinHash && !JSON.stringify(rec).includes(`"${pin}"`), 'only a hash is kept');
  const ok = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245560000', pin } });
  assert.equal(ok.status, 200, ok.data.error);
  const t = decode(ok.data.token);
  assert.equal(t.uid, r.data.uid); assert.equal(t.claims.role, 'waitStaff'); assert.equal(t.aud, 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit');
  assert.ok(ctx.store.list('members').some(m => m.fields.staffUid === r.data.uid), 'staff are members');
  // Changing it is optional; the texted PIN keeps working until she does.
  const asHer = { claims: { role: 'waitStaff' }, uid: r.data.uid };
  assert.equal((await call(ctx.env, 'GET', '/api/ops/me', asHer)).data.pinStarter, true);
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245560000', pin } })).status, 200, 'still works the next night');
  assert.match((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: pin, pin: '1234' } })).data.error, /in a row/);
  assert.match((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: pin, pin: '7777' } })).data.error, /same number/);
  assert.equal((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: pin, pin: '2580' } })).status, 200);
  assert.equal((await call(ctx.env, 'GET', '/api/ops/me', asHer)).data.pinStarter, false);
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245560000', pin: '2580' } })).status, 200);
});

test('wrong PINs: same message for unknown phones; 5 wrong locks for 15 minutes; "text me one" sends a new PIN that works', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245570101');
  const first = lastPin(ctx.store, '0245570101'), bad = first === '1357' ? '2468' : '1357';
  const unknown = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0209999999', pin: first } });
  const wrong = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: bad } });
  assert.equal(unknown.data.error, wrong.data.error, 'never says whether the phone is staff');
  for (let i = 0; i < 4; i++) await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: bad } });
  const locked = await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: first } });
  assert.equal(locked.status, 423); assert.match(locked.data.error, /Wait 15 minutes/);
  ctx.store.seed('users', r.data.uid, { ...ctx.store.get('users', r.data.uid).fields, pinSentAt: '', lockedUntil: '' });
  const sent = await call(ctx.env, 'POST', '/api/staff-auth/send-pin', { body: { phone: '0245570101' } });
  assert.equal(sent.data.sent, true);
  assert.deepEqual((await call(ctx.env, 'POST', '/api/staff-auth/send-pin', { body: { phone: '0209999999' } })).data, sent.data, 'same reply for strangers');
  const fresh = lastPin(ctx.store, '0245570101');
  // Asking for a new PIN can't lock anyone out: the old one works until the new one is used.
  if (fresh !== first) assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: first } })).status, 200, 'old PIN still works');
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570101', pin: fresh } })).status, 200, 'the texted PIN works');
  // Once used, the texted PIN replaces the old one.
  const r2 = await addWaiter(ctx, '0245570102'), old2 = r2.data.pin;
  await call(ctx.env, 'POST', '/api/staff-auth/send-pin', { body: { phone: '0245570102' } });
  const new2 = lastPin(ctx.store, '0245570102');
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570102', pin: new2 } })).status, 200);
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570102', pin: new2 } })).status, 200, 'and is now his PIN');
  if (new2 !== old2) assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570102', pin: old2 } })).status, 401, 'the old PIN is replaced');
  // A texted PIN expires after 30 minutes if unused.
  ctx.store.seed('users', r2.data.uid, { ...ctx.store.get('users', r2.data.uid).fields, pinSentAt: '' });
  await call(ctx.env, 'POST', '/api/staff-auth/send-pin', { body: { phone: '0245570102' } });
  const late = lastPin(ctx.store, '0245570102');
  ctx.store.seed('users', r2.data.uid, { ...ctx.store.get('users', r2.data.uid).fields, tempPinExpires: new Date(Date.now() - 1000).toISOString() });
  if (late !== new2) assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245570102', pin: late } })).status, 401, 'expired');
});

test('managers can add floor staff but not directors or finance; directors can; only the system admin makes admins; managers get 6-number PINs', async () => {
  const ctx = setup();
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'D', phone: '0245550102', role: 'director' } })).status, 403);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'F', phone: '0245550103', role: 'finance' } })).status, 403);
  for (const role of ['barStaff', 'cashier', 'security', 'doorStaff']) assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: role, phone: `02455502${10 + ['barStaff', 'cashier', 'security', 'doorStaff'].indexOf(role)}`, role } })).status, 200, role);
  ctx.store.seed('users', 'dir1', { name: 'Dee', phone: '0240000002', role: 'director' });
  const fin = await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'director' }, uid: 'dir1', body: { name: 'Fin Officer', phone: '0245550104', role: 'finance' } });
  assert.equal(fin.status, 200, fin.data.error);
  assert.match(fin.data.pin, /^\d{6}$/); assert.match(lastPin(ctx.store, '0245550104'), /^\d{6}$/);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'director' }, uid: 'dir1', body: { name: 'X', phone: '0245550105', role: 'superAdmin' } })).status, 403);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'waitStaff' }, body: { name: 'X', phone: '0245550106', role: 'waitStaff' } })).status, 403, 'a waiter can’t add staff');
  assert.match((await call(ctx.env, 'POST', '/api/admin/people/add', { ...ctx.MGR, body: { name: 'Dup', phone: '0245550104', role: 'barStaff' } })).data.error, /already uses that phone/);
  const list = await call(ctx.env, 'GET', '/api/admin/people', ctx.MGR);
  assert.ok(!list.data.staff.some(s => s.name === 'Fin Officer'), 'the Human manager sees only the staff he looks after');
  const dirList = await call(ctx.env, 'GET', '/api/admin/people', { claims: { role: 'director' }, uid: 'dir1' });
  assert.ok(dirList.data.staff.some(s => s.name === 'Fin Officer' && s.hasPin && s.pinStarter), 'a director sees everyone');
  assert.ok(!list.data.roles.some(r => ['director', 'finance', 'superAdmin', 'manager', 'hrManager', 'organiser'].includes(r.id)), 'the Human manager is only offered the staff jobs');
  assert.ok(['dj', 'mc', 'security'].every(r => list.data.roles.some(x => x.id === r)), 'including DJs and MCs');
  // The Manager (money and stock) no longer adds staff; the Event manager adds organisers only.
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'manager' }, body: { name: 'W', phone: '0245550107', role: 'waitStaff' } })).status, 403);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'eventManager' }, body: { name: 'W', phone: '0245550108', role: 'waitStaff' } })).status, 403);
  const org = await call(ctx.env, 'POST', '/api/admin/people/add', { claims: { role: 'eventManager' }, body: { name: 'Promo Org', phone: '0245550109', role: 'organiser' } });
  assert.equal(org.status, 200, org.data.error);
  const evl = await call(ctx.env, 'GET', '/api/admin/people', { claims: { role: 'eventManager' } });
  assert.ok(evl.data.staff.length && evl.data.staff.every(s => s.role === 'organiser'), 'the Event manager sees organisers only');
});

test('"Text PINs to everyone": staff without a PIN get one; staff with a PIN, without a phone, or above the manager are left alone', async () => {
  const ctx = setup();
  ctx.store.seed('users', 'old1', { name: 'Old Bar', phone: '0245530001', role: 'barStaff' });
  ctx.store.seed('users', 'old2', { name: 'Old Door', phone: '0245530002', role: 'doorStaff' });
  ctx.store.seed('users', 'old3', { name: 'No Phone', email: 'np@x.test', role: 'cashier' });
  ctx.store.seed('users', 'old4', { name: 'Old Finance', phone: '0245530004', role: 'finance' });
  ctx.store.seed('users', 'gone', { name: 'Gone', phone: '0245530005', role: 'barStaff', removed: true });
  const had = await addWaiter(ctx, '0245530006'); const smsBefore = ctx.store.sms.length;
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/send-pins', { claims: { role: 'waitStaff' }, uid: had.data.uid })).status, 403);
  const r = await call(ctx.env, 'POST', '/api/admin/people/send-pins', ctx.MGR);
  assert.equal(r.status, 200, r.data.error);
  assert.deepEqual(r.data.sent.map(x => x.name).sort(), ['Old Bar', 'Old Door']);
  assert.deepEqual(r.data.skipped.map(x => x.name).sort(), ['No Phone', 'Old Finance']);
  assert.equal(ctx.store.sms.length, smsBefore + 2);
  for (const [phone, x] of [['0245530001', r.data.sent.find(y => y.name === 'Old Bar')]]) {
    assert.equal(lastPin(ctx.store, phone), x.pin);
    assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone, pin: x.pin } })).status, 200);
  }
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/send-pins', ctx.MGR)).data.sent.length, 0, 'a second tap sends nothing');
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
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245590303', pin: r.data.pin } })).status, 401);
  assert.equal(ctx.store.list('members').find(m => m.fields.staffUid === r.data.uid).fields.status, 'suspended');
  assert.ok(ctx.store.get('users', r.data.uid), 'the record stays so past work keeps its name');
});

test('a manager sends a new PIN (the old one stops); nobody can read a PIN back from the system', async () => {
  const ctx = setup();
  const r = await addWaiter(ctx, '0245510040');
  const asHer = { claims: { role: 'waitStaff' }, uid: r.data.uid };
  assert.equal((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: r.data.pin, pin: '4826' } })).status, 200);
  assert.match((await call(ctx.env, 'POST', '/api/ops/change-pin', { ...asHer, body: { current: '0000', pin: '4827' } })).data.error, /current PIN/);
  const reset = await call(ctx.env, 'POST', '/api/admin/people/reset-pin', { ...ctx.MGR, body: { uid: r.data.uid } });
  assert.equal(reset.data.texted, true); assert.equal(reset.data.pin, lastPin(ctx.store, '0245510040'));
  if (reset.data.pin !== '4826') assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245510040', pin: '4826' } })).status, 401, 'the old PIN stops working');
  assert.equal((await call(ctx.env, 'POST', '/api/staff-auth/sign-in', { body: { phone: '0245510040', pin: reset.data.pin } })).status, 200);
  const list = await call(ctx.env, 'GET', '/api/admin/people', ctx.MGR);
  assert.ok(!list.text.includes('pinHash') && !list.text.includes(reset.data.pin), 'the staff list never carries a PIN');
  assert.ok(ctx.store.list('audit_logs').some(a => a.fields.action === 'STAFF_PIN_RESET'));
});

test('starting PINs are never easy ones', async () => {
  const { starterPin, pinProblem } = await import('../src/staffauth.js');
  for (let i = 0; i < 300; i++) { const p = starterPin('waitStaff'); assert.match(p, /^\d{4}$/); assert.equal(pinProblem(p, 'waitStaff'), ''); }
  assert.match(starterPin('manager'), /^\d{6}$/);
});

test('the system admin adds and changes anyone: manager, director, finance, another admin', async () => {
  const ctx = setup();
  ctx.store.seed('users', 'adm1', { name: 'Sys Admin', phone: '0240000009', role: 'superAdmin', admin: true });
  const ADM = { claims: { role: 'superAdmin', admin: true }, uid: 'adm1' };
  const roles = (await call(ctx.env, 'GET', '/api/admin/people', ADM)).data.roles.map(r => r.id);
  for (const r of ['superAdmin', 'director', 'manager', 'finance', 'waitStaff']) assert.ok(roles.includes(r), `offered ${r}`);
  const added = {};
  for (const [i, role] of ['manager', 'director', 'finance', 'superAdmin'].entries()) {
    const r = await call(ctx.env, 'POST', '/api/admin/people/add', { ...ADM, body: { name: `New ${role}`, phone: `024554000${i}`, role } });
    assert.equal(r.status, 200, `${role}: ${r.data.error}`); assert.match(r.data.pin, /^\d{6}$/); added[role] = r.data.uid;
  }
  const up = await call(ctx.env, 'POST', '/api/admin/people/update', { ...ADM, body: { uid: added.manager, name: 'Kweku Manager', phone: '0245549999', role: 'director' } });
  assert.equal(up.status, 200, up.data.error);
  const rec = ctx.store.get('users', added.manager).fields;
  assert.equal(rec.name, 'Kweku Manager'); assert.equal(rec.phone, '0245549999'); assert.equal(rec.role, 'director');
  assert.equal((await call(ctx.env, 'POST', '/api/admin/people/reset-pin', { ...ADM, body: { uid: added.finance } })).status, 200);
  assert.equal(ctx.store.get('users', added.superAdmin).fields.admin, true);
});

test('Media: the Human manager adds them (on payroll); they run the website and the nights; the Event manager no longer does', async () => {
  const ctx = setup();
  ctx.store.seed('users', 'hr1', { name: 'Hannah HR', phone: '0240000005', role: 'hrManager' });
  const HR = { claims: { role: 'hrManager' }, uid: 'hr1' };
  const r = await call(ctx.env, 'POST', '/api/admin/people/add', { ...HR, body: { name: 'Kwame Media', phone: '0245550321', role: 'media' } });
  assert.equal(r.status, 200, r.data.error);
  assert.match(ctx.store.sms.at(-1).message, /Media/);
  const asMedia = { claims: { role: 'media' }, uid: r.data.uid };
  const night = await call(ctx.env, 'POST', '/api/admin/events', { ...asMedia, body: { name: 'Media Night', date: '2099-03-01T22:00:00Z' } });
  assert.equal(night.status, 200, night.data.error);
  assert.equal((await call(ctx.env, 'POST', '/api/admin/events', { claims: { role: 'eventManager' }, body: { name: 'X', date: '2099-03-02T22:00:00Z' } })).status, 403, 'the Event manager no longer edits the website');
  assert.equal((await call(ctx.env, 'POST', '/api/admin/settings', { ...asMedia, body: { venue: 'x' } })).status, 403, 'site settings stay the administrator’s');
  assert.equal((await call(ctx.env, 'GET', '/api/admin/overview', asMedia)).status, 403, 'ticket money is the Event manager’s');
  assert.equal((await call(ctx.env, 'POST', '/api/checkin', { ...asMedia, body: { token: 'x' } })).status, 403, 'not the door');
  const pay = await call(ctx.env, 'POST', '/api/ops/pay/details', { ...HR, body: { uid: r.data.uid, salaryPesewas: 200000 } });
  assert.equal(pay.status, 200, `Media is paid through the Human manager: ${pay.data.error || ''}`);
});
