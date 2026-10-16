// A1/A2: the public pay-in-bits lookup never hands out ticket credentials, and can't be used to
// learn whether a phone number or order exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';
import { orderCode, normalizeOrderCode } from '../src/lib/util.js';

let ipSeq = 0;
async function call(env, method, path, { body, ip } = {}) {
  const headers = { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip || `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}` };
  const res = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, text: await res.clone().text(), data: await res.json().catch(() => ({})) };
}
const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
function seed(store) {
  store.seed('installment_plans', 'MEM-7K3QX-9WP2M', {
    eventId: 'n1', eventName: 'Afrobeats Friday', eventDate: '2026-10-02T22:00:00Z', ticketTypeId: 't1', ticketTypeName: 'Regular', admits: 1, quantity: 1,
    totalPesewas: 15000, paidPesewas: 15000, buyerName: 'Ama Owusu', firstName: 'Ama', buyerPhone: '0241234567', identityLine: 'LINE', status: 'completed', ticketIds: [TOKEN], payments: [],
  });
  store.seed('installment_plans', 'MEM-AB1234', {
    eventId: 'n1', eventName: 'Afrobeats Friday', totalPesewas: 15000, paidPesewas: 5000, buyerName: 'Kofi', buyerPhone: '0551112222', status: 'active', payments: [],
  });
}

test('order codes: 10 Crockford characters, unpredictable; typing slips are forgiven; old codes still match', () => {
  const codes = new Set(Array.from({ length: 2000 }, orderCode));
  assert.equal(codes.size, 2000);
  for (const c of codes) assert.match(c, /^MEM-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.equal(normalizeOrderCode('mem 7k3qx 9wp2m'), 'MEM-7K3QX-9WP2M');
  assert.equal(normalizeOrderCode('7K3QX9WP2M'), 'MEM-7K3QX-9WP2M');
  assert.equal(normalizeOrderCode('MEM-7K3QX-9WP2O'), 'MEM-7K3QX-9WP20', 'O read as zero');
  assert.equal(normalizeOrderCode('MEM-AB1234'), 'MEM-AB1234', 'legacy code unchanged');
  assert.equal(normalizeOrderCode('MEM-12'), null);
  assert.equal(normalizeOrderCode('<script>'), null);
});

test('lookup needs the code AND the phone on the order; it shows the order but no ticket id, link, QR data or phone', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const r = await call(env, 'GET', '/api/installments/lookup?code=mem-7k3qx-9wp2m&phone=024%20123%204567');
  assert.equal(r.status, 200);
  const [p] = r.data.plans;
  assert.deepEqual(Object.keys(p).sort(), ['deadline', 'eventDate', 'eventName', 'firstName', 'paidPesewas', 'planId', 'remainingPesewas', 'status', 'ticketReady', 'totalPesewas']);
  assert.equal(p.ticketReady, true);
  for (const leak of [TOKEN, 'ticket.html', 'token', '0241234567', '4567', 'Owusu']) assert.ok(!r.text.includes(leak), `response contains ${leak}`);
  const legacy = await call(env, 'GET', '/api/installments/lookup?code=MEM-AB1234&phone=0551112222');
  assert.equal(legacy.data.plans[0].remainingPesewas, 10000);
  for (const q of ['code=MEM-7K3QX-9WP2M', 'code=MEM-7K3QX-9WP2M&phone=0209999999', 'phone=0241234567']) {
    assert.deepEqual((await call(env, 'GET', `/api/installments/lookup?${q}`)).data.plans, [], `${q} shows nothing`);
  }
});

test('phone alone: a 6-digit code is texted to that phone; the right code shows the orders, wrong ones run out', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const known = await call(env, 'POST', '/api/installments/phone-code', { body: { phone: '0241234567' } });
  const unknown = await call(env, 'POST', '/api/installments/phone-code', { body: { phone: '0209999999' } });
  assert.equal(known.text, unknown.text, 'same reply either way');
  assert.equal(store.sms.length, 1); assert.equal(store.sms[0].to, '0241234567');
  const code = /(\d{6})/.exec(store.sms[0].message)[1];
  assert.ok(!JSON.stringify(store.get('phone_sessions', '0241234567').fields).includes(code), 'stored hashed');
  const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
  assert.equal((await call(env, 'POST', '/api/installments/phone-verify', { body: { phone: '0241234567', code: wrong } })).status, 400);
  const ok = await call(env, 'POST', '/api/installments/phone-verify', { body: { phone: '0241234567', code } });
  assert.equal(ok.status, 200); assert.equal(ok.data.plans[0].planId, 'MEM-7K3QX-9WP2M');
  assert.ok(!ok.text.includes(TOKEN));
  assert.equal((await call(env, 'POST', '/api/installments/phone-verify', { body: { phone: '0241234567', code } })).status, 400, 'a code works once');

  await call(env, 'POST', '/api/installments/phone-code', { body: { phone: '0241234567' } });
  const code2 = /(\d{6})/.exec(store.sms.at(-1).message)[1];
  const bad = String((Number(code2) + 1) % 1000000).padStart(6, '0');
  for (let i = 0; i < 5; i++) await call(env, 'POST', '/api/installments/phone-verify', { body: { phone: '0241234567', code: bad } });
  assert.equal((await call(env, 'POST', '/api/installments/phone-verify', { body: { phone: '0241234567', code: code2 } })).status, 400, 'after 5 wrong tries even the right code is dead');
});

test('new orders get readable codes from the night (NOSADDAYS-001, -002); typing slips are forgiven', async () => {
  const { normalizePlanCode, eventSlug } = await import('../src/lib/util.js');
  assert.equal(eventSlug('No Sad Days!'), 'NOSADDAYS');
  assert.equal(normalizePlanCode('nosaddays 1'), 'NOSADDAYS-001');
  assert.equal(normalizePlanCode('NOSADDAYS-012'), 'NOSADDAYS-012');
  assert.equal(normalizePlanCode('mem 7k3qx 9wp2m'), 'MEM-7K3QX-9WP2M', 'legacy codes still work');
  assert.equal(normalizePlanCode('<script>'), null);
  const { store, env } = createMockEnv();
  store.seed('events', 'n1', { name: 'No Sad Days', visibility: 'public', active: true, date: '2099-10-02T22:00:00Z' });
  store.seed('ticket_types', 't1', { eventId: 'n1', name: 'Regular', pricePesewas: 10000, remaining: 50, active: true });
  const start = () => call(env, 'POST', '/api/installments/start', { body: { eventId: 'n1', ticketTypeId: 't1', quantity: 1, buyerPhone: '0241234567', depositPesewas: 2000, acknowledged: true } });
  assert.equal((await start()).data.planId, 'NOSADDAYS-001');
  assert.equal((await start()).data.planId, 'NOSADDAYS-002');
});

test('lost code: same reply for a known and an unknown number; only the known one gets a text', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const known = await call(env, 'POST', '/api/installments/find', { body: { phone: '+233 24 123 4567' } });
  const unknown = await call(env, 'POST', '/api/installments/find', { body: { phone: '0209999999' } });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.equal(known.text, unknown.text);
  assert.equal(store.sms.length, 1);
  assert.equal(store.sms[0].to, '0241234567');
  assert.match(store.sms[0].message, /MEM-7K3QX-9WP2M/);
  assert.ok(!store.sms[0].message.includes(TOKEN), 'codes only, not ticket links');
});

test('text me the link: same reply for right and wrong phone; link only goes to the phone on the order', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const right = await call(env, 'POST', '/api/installments/resend-link', { body: { planId: 'MEM-7K3QX-9WP2M', phone: '024 123 4567' } });
  const wrong = await call(env, 'POST', '/api/installments/resend-link', { body: { planId: 'MEM-7K3QX-9WP2M', phone: '0209999999' } });
  const noPlan = await call(env, 'POST', '/api/installments/resend-link', { body: { planId: 'MEM-00000-00000', phone: '0241234567' } });
  const unpaid = await call(env, 'POST', '/api/installments/resend-link', { body: { planId: 'MEM-AB1234', phone: '0551112222' } });
  assert.equal(right.text, wrong.text); assert.equal(right.text, noPlan.text); assert.equal(right.text, unpaid.text);
  for (const r of [right, wrong, noPlan, unpaid]) assert.ok(!r.text.includes(TOKEN));
  assert.equal(store.sms.length, 1, 'only the matching, paid order gets a text');
  assert.equal(store.sms[0].to, '0241234567');
  assert.match(store.sms[0].message, new RegExp(`/ticket\\.html\\?token=${TOKEN}`));
});

test('rate limits: one phone and one order code are limited even across many IPs', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await call(env, 'POST', '/api/installments/resend-link', { body: { planId: 'MEM-7K3QX-9WP2M', phone: '0209999999' } })).status);
  assert.ok(statuses.includes(429), 'per-order limit kicks in');
  const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await call(env, 'GET', '/api/installments/lookup?code=MEM-AB1234')).status);
  assert.ok(codes.includes(429), 'per-code lookup limit kicks in');
  const same = [];
  for (let i = 0; i < 14; i++) same.push((await call(env, 'POST', '/api/installments/find', { body: { phone: '0241234567' }, ip: '10.1.1.1' })).status);
  assert.ok(same.includes(429), 'per-IP limit kicks in');
});

test('pay in bits needs the ticked acknowledgement; the policy version and time are stored', async () => {
  const { store, env } = createMockEnv();
  store.seed('events', 'n1', { name: 'Fri', date: '2099-01-01T22:00:00Z', visibility: 'public', active: true });
  store.seed('ticket_types', 't1', { eventId: 'n1', name: 'Regular', pricePesewas: 15000, admits: 1, remaining: 10, active: true });
  const base = { eventId: 'n1', ticketTypeId: 't1', quantity: 1, buyerName: 'Ama', buyerPhone: '0241234567', depositPesewas: 1000 };
  for (const ack of [undefined, false, 'true', 1]) {
    const r = await call(env, 'POST', '/api/installments/start', { body: { ...base, acknowledged: ack } });
    assert.equal(r.status, 400, `acknowledged=${ack}`);
  }
  assert.equal(store.list('installment_plans').length, 0);
  const ok = await call(env, 'POST', '/api/installments/start', { body: { ...base, acknowledged: true } });
  assert.equal(ok.status, 200);
  const plan = store.list('installment_plans')[0].fields;
  assert.equal(plan.policyVersion, '2026-09-forfeit-at-start');
  assert.ok(plan.acknowledgedAt);
});
