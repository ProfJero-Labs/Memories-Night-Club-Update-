// Who gets ticket links over the web. The Paystack reference is on staff screens, receipts and
// every ticket of an order, so it must not be enough on its own: only the browser that started a
// pay-in-full checkout (it holds the claim) is shown the tokens. Everyone else is told the links
// went by text. The draw winner's ticket code never reaches a public page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import worker, { publicTicket } from '../src/index.js';

const FUTURE = '2099-10-02T22:00:00.000Z';
let ipSeq = 0;
function setup() {
  const { store, env } = createMockEnv();
  store.seed('events', 'n1', { name: 'Afrobeats Friday', visibility: 'public', active: true, date: FUTURE });
  store.seed('ticket_types', 't1', { eventId: 'n1', name: 'Regular', pricePesewas: 10000, admits: 1, remaining: 50, active: true });
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await worker.fetch(new Request(`https://worker.test${path}`, { method, headers: { 'CF-Connecting-IP': `10.8.0.${++ipSeq % 250}`, ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await res.text();
    return { status: res.status, text, data: JSON.parse(text || '{}') };
  };
  return { store, env, call };
}

async function buyGroup({ store, call }) {
  const init = await call('POST', '/api/checkout/initiate', { body: { eventId: 'n1', ticketTypeId: 't1', quantity: 3, buyerName: 'Ama Mensah', buyerPhone: '0241234567' } });
  assert.equal(init.status, 200, init.data.error);
  assert.match(init.data.claim, /^[0-9a-f]{64}$/, 'the buyer’s browser gets a claim');
  store.setPaystack(init.data.reference, { status: 'success', currency: 'GHS', amount: 30000 });
  return init.data;
}

test('the claim is stored only as a hash, never in plain form', async () => {
  const ctx = setup();
  const { reference, claim } = await buyGroup(ctx);
  const saved = ctx.store.get('pending_checkouts', reference).fields;
  assert.match(saved.claimHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(saved).includes(claim));
});

test('verify reports the outcome but never hands out ticket tokens', async () => {
  const ctx = setup();
  const { reference } = await buyGroup(ctx);
  const v = await ctx.call('POST', '/api/checkout/verify', { body: { reference } });
  assert.equal(v.data.status, 'issued');
  const tokens = ctx.store.get('pending_checkouts', reference).fields.ticketIds;
  assert.equal(tokens.length, 3);
  for (const t of tokens) assert.ok(!v.text.includes(t), 'no token in the verify reply');
});

test('status with the buyer’s claim returns the tickets; the reference alone (a friend, staff) gets none', async () => {
  const ctx = setup();
  const { reference, claim } = await buyGroup(ctx);
  await ctx.call('POST', '/api/checkout/verify', { body: { reference } });
  const tokens = ctx.store.get('pending_checkouts', reference).fields.ticketIds;

  const buyer = await ctx.call('GET', `/api/checkout/status?reference=${reference}`, { headers: { 'X-Checkout-Claim': claim } });
  assert.deepEqual(buyer.data.tickets.map(t => t.token), tokens);

  for (const headers of [{}, { 'X-Checkout-Claim': 'f'.repeat(64) }, { 'X-Checkout-Claim': '' }]) {
    const other = await ctx.call('GET', `/api/checkout/status?reference=${reference}`, { headers });
    assert.equal(other.data.status, 'issued');
    assert.deepEqual(other.data.tickets, []);
    assert.equal(other.data.ticketCount, 3);
    assert.equal(other.data.phoneHint, '024***4567');
    for (const t of tokens) assert.ok(!other.text.includes(t), 'no token without the claim');
    assert.ok(!other.text.includes('0241234567'), 'never the full phone');
  }
});

test('a ticket never exposes its payment reference to the public', async () => {
  const ctx = setup();
  const { reference } = await buyGroup(ctx);
  await ctx.call('POST', '/api/checkout/verify', { body: { reference } });
  const [token] = ctx.store.get('pending_checkouts', reference).fields.ticketIds;
  const t = await ctx.call('GET', `/api/tickets/${token}`);
  assert.equal(t.status, 200);
  assert.ok(!t.text.includes(reference));
});

test('the payment that completes pay in bits never returns ticket tokens (it may be a helper paying)', async () => {
  const ctx = setup();
  ctx.store.seed('installment_plans', 'MEM-7K3QX-9WP2M', {
    eventId: 'n1', eventName: 'Afrobeats Friday', eventDate: FUTURE, ticketTypeId: 't1', ticketTypeName: 'Regular', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 7000, buyerName: 'Ama Mensah', buyerPhone: '0241234567', status: 'active', payments: [],
  });
  const top = await ctx.call('POST', '/api/installments/topup', { body: { planId: 'MEM-7K3QX-9WP2M', amountPesewas: 3000 } });
  assert.equal(top.status, 200, top.data.error);
  assert.equal(top.data.claim, undefined);
  ctx.store.setPaystack(top.data.reference, { status: 'success', currency: 'GHS', amount: 3000 });
  const v = await ctx.call('POST', '/api/checkout/verify', { body: { reference: top.data.reference } });
  assert.equal(v.data.planComplete, true);
  const [token] = ctx.store.get('installment_plans', 'MEM-7K3QX-9WP2M').fields.ticketIds;
  const s = await ctx.call('GET', `/api/checkout/status?reference=${top.data.reference}`);
  assert.deepEqual(s.data.tickets, []);
  assert.equal(s.data.phoneHint, '024***4567');
  assert.ok(!v.text.includes(token) && !s.text.includes(token));
  assert.equal(ctx.store.sms.at(-1).to, '0241234567', 'the ticket goes by text to the phone on the order');
  assert.ok(ctx.store.sms.at(-1).message.includes(token));
});

test('pay in bits: the phone that started the order opens its ticket after the last payment; a helper does not', async () => {
  const ctx = setup();
  const start = await ctx.call('POST', '/api/installments/start', { body: { eventId: 'n1', ticketTypeId: 't1', quantity: 1, buyerName: 'Ama Mensah', buyerPhone: '0241234567', depositPesewas: 4000, acknowledged: true } });
  assert.equal(start.status, 200, start.data.error);
  assert.match(start.data.claim, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(ctx.store.get('installment_plans', start.data.planId).fields).includes(start.data.claim), 'stored as a hash only');
  ctx.store.setPaystack(start.data.reference, { status: 'success', currency: 'GHS', amount: 4000 });
  await ctx.call('POST', '/api/checkout/verify', { body: { reference: start.data.reference } });
  const top = await ctx.call('POST', '/api/installments/topup', { body: { planId: start.data.planId, amountPesewas: 6000 } });
  ctx.store.setPaystack(top.data.reference, { status: 'success', currency: 'GHS', amount: 6000 });
  await ctx.call('POST', '/api/checkout/verify', { body: { reference: top.data.reference } });
  const [token] = ctx.store.get('installment_plans', start.data.planId).fields.ticketIds;
  const owner = await ctx.call('GET', `/api/checkout/status?reference=${top.data.reference}`, { headers: { 'X-Checkout-Claim': start.data.claim } });
  assert.deepEqual(owner.data.tickets.map(t => t.token), [token]);
  const helper = await ctx.call('GET', `/api/checkout/status?reference=${top.data.reference}`);
  assert.deepEqual(helper.data.tickets, []);
  assert.ok(!helper.text.includes(token));
});

test('the draw winner’s ticket code stays off public pages; only the winner’s own ticket says it won', async () => {
  const { store, env, call } = setup();
  store.seed('tickets', 'w'.repeat(64), { customerName: 'Kofi Boateng', eventId: 'n1', eventName: 'Afrobeats Friday', displayCode: 'MEM-ABC123', status: 'valid' });
  store.seed('tickets', 'x'.repeat(64), { customerName: 'Esi Owusu', eventId: 'n1', eventName: 'Afrobeats Friday', displayCode: 'MEM-DEF456', status: 'valid' });
  store.seed('raffles', 'evt_n1', { eventId: 'n1', prize: 'Bottle', cap: 20, spotsTaken: 2, enabled: true, public: true, status: 'drawn', winnerDisplayName: 'Kofi B.', winnerDisplayCode: 'MEM-ABC123' });

  const page = await call('GET', '/api/events/n1');
  assert.equal(page.data.raffle.winner.name, 'Kofi B.');
  assert.ok(!page.text.includes('MEM-ABC123'), 'no winning code on the event page');

  const other = await publicTicket(env, 'x'.repeat(64));
  assert.equal(other.raffle.youWon, false);
  assert.ok(!JSON.stringify(other).includes('MEM-ABC123'), 'another guest’s ticket never sees the winning code');

  const winner = await publicTicket(env, 'w'.repeat(64));
  assert.equal(winner.raffle.youWon, true);
});
