// Exercises the real HTTP routing layer (worker's default-exported fetch handler) rather than
// calling internal functions directly — this is the same code path Cloudflare would run, just
// against the mock Firestore/Paystack backends instead of live ones (see mock-firestore.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';

function sign(secret, body) {
  return createHmac('sha512', secret).update(body).digest('hex');
}

test('Paystack webhook: a forged/invalid signature is ignored, does not fulfil anything', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt1', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 10, active: true });
  store.seed('pending_checkouts', 'refWebhook1', {
    reference: 'refWebhook1', kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt1',
    ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 5000,
    buyerName: 'Ama', buyerPhone: '0241234567', buyerEmail: 'a@test.com', identityLine: 'SAMPLE LINE TWO.', status: 'pending',
  });
  store.setPaystack('refWebhook1', { status: 'success', currency: 'GHS', amount: 5000 });

  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'refWebhook1' } });
  const req = new Request('https://worker.test/api/paystack/webhook', {
    method: 'POST',
    headers: { 'x-paystack-signature': 'not-a-real-signature-0000000000000000000000000000000000000000000000000000000000000000000000000000' },
    body,
  });

  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ignored');

  const pending = store.get('pending_checkouts', 'refWebhook1');
  assert.equal(pending.fields.status, 'pending', 'an invalid signature must not trigger fulfillment — status must stay pending');
  assert.equal(store.list('tickets').length, 0, 'no ticket should have been issued');
});

test('Paystack webhook: a missing signature header is ignored the same way', async () => {
  const { store, env } = createMockEnv();
  store.seed('pending_checkouts', 'refWebhook2', { reference: 'refWebhook2', kind: 'ticket', status: 'pending', amountPesewas: 5000 });
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'refWebhook2' } });
  const req = new Request('https://worker.test/api/paystack/webhook', { method: 'POST', body });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ignored');
  assert.equal(store.get('pending_checkouts', 'refWebhook2').fields.status, 'pending');
});

test('Paystack webhook: a correctly-signed payload IS processed (positive control — proves the test above is meaningful, not just always-broken)', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt2', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 10, active: true });
  store.seed('pending_checkouts', 'refWebhook3', {
    reference: 'refWebhook3', kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt2',
    ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 5000,
    buyerName: 'Ama', buyerPhone: '0241234567', buyerEmail: 'a@test.com', identityLine: 'SAMPLE LINE TWO.', status: 'pending',
  });
  store.setPaystack('refWebhook3', { status: 'success', currency: 'GHS', amount: 5000 });

  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'refWebhook3' } });
  const validSig = sign(env.PAYSTACK_SECRET_KEY, body);
  const req = new Request('https://worker.test/api/paystack/webhook', {
    method: 'POST',
    headers: { 'x-paystack-signature': validSig },
    body,
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  assert.equal(store.get('pending_checkouts', 'refWebhook3').fields.status, 'issued');
  assert.equal(store.list('tickets').length, 1);
});

test('checkout/initiate: a client-supplied price is ignored — the server recomputes it from ticket_types', async () => {
  const { store, env } = createMockEnv();
  store.seed('events', 'event1', { name: 'Test Night', visibility: 'public', active: true, date: '2099-01-01T00:00:00.000Z' });
  store.seed('ticket_types', 'tt3', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 10, active: true });

  const maliciousBody = JSON.stringify({
    eventId: 'event1', ticketTypeId: 'tt3', quantity: 1,
    buyerName: 'Attacker', buyerPhone: '0241234567', buyerEmail: 'attacker@test.com',
    callbackUrl: 'http://localhost:3000/payment-return.html',
    // None of these should have any effect — the server never reads a price from the request body.
    pricePesewas: 1, amountPesewas: 1, price: 1, total: 1,
  });
  const req = new Request('https://worker.test/api/checkout/initiate', { method: 'POST', body: maliciousBody });
  const res = await worker.fetch(req, env);
  const data = await res.json();
  assert.equal(data.success, true);

  const pending = store.get('pending_checkouts', data.reference);
  assert.equal(pending.fields.amountPesewas, 5000, 'the charge amount must come from ticket_types.pricePesewas (5000), never the client-supplied 1');
});

test('checkout/initiate: a browser-supplied callback URL is ignored; Paystack gets the Worker’s own return page', async () => {
  const { store, env } = createMockEnv();
  store.seed('events', 'event1', { name: 'Test Night', visibility: 'public', active: true, date: '2099-01-01T00:00:00.000Z' });
  store.seed('ticket_types', 'tt4', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 10, active: true });

  const body = JSON.stringify({
    eventId: 'event1', ticketTypeId: 'tt4', quantity: 1,
    buyerName: 'Attacker', buyerPhone: '0241234567', buyerEmail: 'attacker@test.com',
    callbackUrl: 'https://evil-phishing-site.example/steal', callback_url: 'https://evil-phishing-site.example/steal',
  });
  const res = await worker.fetch(new Request('https://worker.test/api/checkout/initiate', { method: 'POST', body }), env);
  assert.equal(res.status, 200);
  assert.equal(store.paystackInits.length, 1);
  assert.equal(store.paystackInits[0].callback_url, `${env.PUBLIC_SITE_URL}/payment-return.html`);
  assert.ok(!JSON.stringify(store.paystackInits).includes('evil'), 'the supplied URL never reaches Paystack');
});

test('checkout, tables and pay-in-bits all use the Worker’s return page; no PUBLIC_SITE_URL means no payments', async () => {
  const { store, env } = createMockEnv();
  store.seed('events', 'event1', { name: 'Test Night', visibility: 'public', active: true, date: '2099-01-01T00:00:00.000Z' });
  store.seed('ticket_types', 'tt5', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 10, active: true });
  store.seed('table_packages', 'pk1', { eventId: 'event1', name: 'Booth', pricePesewas: 200000, capacity: 6, remaining: 2, active: true });
  const post = (path, b) => worker.fetch(new Request(`https://worker.test${path}`, { method: 'POST', body: JSON.stringify({ ...b, callbackUrl: 'https://evil.example/x' }) }), env);
  const who = { buyerName: 'Ama', buyerPhone: '0241234567' };
  assert.equal((await post('/api/checkout/initiate', { eventId: 'event1', ticketTypeId: 'tt5', quantity: 1, ...who })).status, 200);
  assert.equal((await post('/api/installments/start', { eventId: 'event1', ticketTypeId: 'tt5', quantity: 1, ...who, depositPesewas: 1000, acknowledged: true })).status, 200);
  assert.equal((await post('/api/table-checkout/initiate', { eventId: 'event1', packageId: 'pk1', name: 'Ama', phone: '0241234567' })).status, 200);
  assert.equal(store.paystackInits.length, 3);
  for (const i of store.paystackInits) assert.equal(i.callback_url, `${env.PUBLIC_SITE_URL}/payment-return.html`);
  delete env.PUBLIC_SITE_URL;
  const off = await post('/api/checkout/initiate', { eventId: 'event1', ticketTypeId: 'tt5', quantity: 1, ...who });
  assert.equal(off.status, 503);
  assert.equal(store.paystackInits.length, 3, 'nothing sent to Paystack');
});

test('admin routes reject a request with no Authorization header at all', async () => {
  const { env } = createMockEnv();
  for (const [method, path] of [
    ['GET', '/api/admin/overview'], ['POST', '/api/admin/events'], ['POST', '/api/admin/raffle/draw'],
    ['POST', '/api/admin/set-role'], ['GET', '/api/admin/organiser/overview'], ['POST', '/api/checkin'],
  ]) {
    const req = new Request(`https://worker.test${path}`, { method, body: method === 'POST' ? '{}' : undefined });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 401, `${method} ${path} must 401 with no auth header`);
  }
});

test('admin routes reject a garbage/expired-looking bearer token the same way (verifyStaff fails closed)', async () => {
  const { env } = createMockEnv();
  const req = new Request('https://worker.test/api/admin/overview', { headers: { Authorization: 'Bearer not-a-real-jwt' } });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 401);
});
