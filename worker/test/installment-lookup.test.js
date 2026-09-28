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

test('lookup by code shows the order but no ticket id, link, QR data or phone', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const r = await call(env, 'GET', '/api/installments/lookup?code=mem-7k3qx-9wp2m');
  assert.equal(r.status, 200);
  const [p] = r.data.plans;
  assert.deepEqual(Object.keys(p).sort(), ['eventDate', 'eventName', 'firstName', 'paidPesewas', 'planId', 'remainingPesewas', 'status', 'ticketReady', 'totalPesewas']);
  assert.equal(p.ticketReady, true);
  assert.equal(p.remainingPesewas, 0);
  for (const leak of [TOKEN, 'ticket.html', 'token', '0241234567', '4567', 'Owusu']) assert.ok(!r.text.includes(leak), `response contains ${leak}`);
  const legacy = await call(env, 'GET', '/api/installments/lookup?code=MEM-AB1234');
  assert.equal(legacy.data.plans[0].remainingPesewas, 10000);
});

test('lookup by phone (older pages) returns nothing', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const r = await call(env, 'GET', '/api/installments/lookup?phone=0241234567');
  assert.deepEqual(r.data.plans, []);
  assert.ok(!r.text.includes(TOKEN));
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
