// Ticket promos: the Worker prices every order; automatic promos show to everyone, code promos only
// to those with the code; limits, windows and ticket types hold; usage is counted when issued.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { discountFor, bestPromo } from '../src/promos.js';

const FUTURE = '2099-10-02T22:00:00.000Z';
let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  store.seed('events', 'n1', { name: 'Afrobeats Friday', visibility: 'public', active: true, date: FUTURE });
  store.seed('ticket_types', 'reg', { eventId: 'n1', name: 'Regular', pricePesewas: 10000, admits: 1, remaining: 100, active: true });
  store.seed('ticket_types', 'vip', { eventId: 'n1', name: 'VIP', pricePesewas: 30000, admits: 1, remaining: 50, active: true });
  const call = async (method, path, { body, claims } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.40.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (claims) headers.Authorization = `Bearer ${await idToken(claims)}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    return { status: r.status, text, data: JSON.parse(text || '{}') };
  };
  return { store, env, call };
}
const MANAGER = { role: 'manager' };
const addPromo = (ctx, body) => ctx.call('POST', '/api/admin/promos', { claims: MANAGER, body: { eventId: 'n1', ...body } });
const buy = (ctx, extra = {}) => ctx.call('POST', '/api/checkout/initiate', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 1, buyerName: 'Ama', buyerPhone: '0241234567', ...extra } });

test('the maths: percent, amount, group deal; never below GHS 1 to pay', () => {
  assert.equal(discountFor({ kind: 'percent', value: 25 }, 10000, 2), 5000);
  assert.equal(discountFor({ kind: 'amount', value: 2000 }, 10000, 3), 6000);
  assert.equal(discountFor({ kind: 'bundle', buy: 4, pay: 3 }, 10000, 4), 10000);
  assert.equal(discountFor({ kind: 'bundle', buy: 4, pay: 3 }, 10000, 3), 0, 'not enough for the deal');
  assert.equal(discountFor({ kind: 'bundle', buy: 2, pay: 1 }, 10000, 5), 20000, 'two pairs');
  assert.equal(discountFor({ kind: 'amount', value: 50000 }, 10000, 1), 9900, 'GHS 1 left to pay');
  const b = bestPromo([{ id: 'a', kind: 'percent', value: 10 }, { id: 'b', kind: 'amount', value: 3000 }], { ticketTypeId: 'reg', unit: 10000, qty: 1 });
  assert.equal(b.promo.id, 'b', 'the better deal for the buyer');
});

test('an automatic promo: shown on the night with its price; the order is charged the promo price and records it; usage counted when issued', async () => {
  const ctx = setup();
  const p = await addPromo(ctx, { name: 'Early bird', kind: 'percent', value: 20, limit: 50 });
  assert.equal(p.status, 200, p.data.error);
  const ev = await ctx.call('GET', '/api/events/n1');
  assert.equal(ev.data.promo.promos[0].label, '20% off');
  assert.equal(ev.data.promo.prices.reg.pricePesewas, 8000);
  assert.equal(ev.data.promo.hasCodes, false);
  const list = await ctx.call('GET', '/api/events');
  assert.equal(list.data.events[0].fromPesewas, 8000, '"From" shows the promo price'); assert.equal(list.data.events[0].promo.label, '20% off');

  const q = await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'vip', quantity: 2 } });
  assert.deepEqual([q.data.fullPesewas, q.data.totalPesewas, q.data.promo.name], [60000, 48000, 'Early bird']);

  const r = await buy(ctx, { quantity: 2, ticketTypeId: 'vip' });
  assert.equal(r.status, 200, r.data.error);
  assert.equal(ctx.store.paystackInits.at(-1).amount, 48000, 'Paystack is asked for the promo price');
  const pending = ctx.store.get('pending_checkouts', r.data.reference).fields;
  assert.deepEqual([pending.promo.name, pending.promo.discountPesewas, pending.promo.fullPesewas], ['Early bird', 12000, 60000]);
  ctx.store.setPaystack(r.data.reference, { status: 'success', currency: 'GHS', amount: 48000 });
  await ctx.call('POST', '/api/checkout/verify', { body: { reference: r.data.reference } });
  const order = ctx.store.list('orders').find(o => o.fields.reference === r.data.reference).fields;
  assert.equal(order.amountPesewas, 48000); assert.equal(order.promo.name, 'Early bird');
  const promo = ctx.store.get('promos', p.data.id).fields;
  assert.equal(promo.usedCount, 2); assert.equal(promo.discountGivenPesewas, 12000);
});

test('a code promo: secret on public pages; only buyers with the code get it; a wrong code is refused, not silently ignored', async () => {
  const ctx = setup();
  await addPromo(ctx, { name: 'Kofi’s fans', kind: 'amount', value: 3000, code: 'kofi-30' });
  const ev = await ctx.call('GET', '/api/events/n1');
  assert.equal(ev.data.promo.hasCodes, true); assert.equal(ev.data.promo.promos.length, 0);
  assert.ok(!ev.text.includes('KOFI30'), 'the code never reaches the page');
  assert.equal((await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 1 } })).data.totalPesewas, 10000);
  const q = await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 1, promoCode: 'kofi30' } });
  assert.equal(q.data.totalPesewas, 7000);
  const bad = await buy(ctx, { promoCode: 'NOPE' });
  assert.equal(bad.status, 400); assert.match(bad.data.error, /isn’t valid/);
  assert.equal((await buy(ctx, { promoCode: 'KOFI30' })).status, 200);
  assert.equal(ctx.store.paystackInits.at(-1).amount, 7000);
});

test('limits, windows, ticket types and switching off all hold; a group deal needs the group', async () => {
  const ctx = setup();
  const vipOnly = await addPromo(ctx, { name: 'VIP week', kind: 'percent', value: 50, ticketTypeIds: ['vip'] });
  assert.equal((await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 1 } })).data.promo, null, 'not on Regular');
  await addPromo(ctx, { id: vipOnly.data.id, name: 'VIP week', kind: 'percent', value: 50, ticketTypeIds: ['vip'], active: false });
  assert.equal((await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'vip', quantity: 1 } })).data.promo, null, 'switched off');

  await addPromo(ctx, { name: 'Ended', kind: 'percent', value: 30, endsAt: '2020-01-01T00:00:00Z' });
  await addPromo(ctx, { name: 'Not yet', kind: 'percent', value: 30, startsAt: '2099-01-01T00:00:00Z' });
  assert.equal((await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 1 } })).data.promo, null, 'outside its window');

  const last = await addPromo(ctx, { name: 'First 2', kind: 'amount', value: 1000, limit: 2, code: 'FIRST' });
  assert.match((await buy(ctx, { quantity: 3, promoCode: 'FIRST' })).data.error, /only 2 tickets left/);
  ctx.store.seed('promos', last.data.id, { ...ctx.store.get('promos', last.data.id).fields, usedCount: 2 });
  assert.match((await buy(ctx, { promoCode: 'FIRST' })).data.error, /isn’t valid/, 'used up: no longer running');

  await addPromo(ctx, { name: 'Squad', kind: 'bundle', buy: 4, pay: 3, code: 'SQUAD' });
  assert.match((await buy(ctx, { quantity: 2, promoCode: 'SQUAD' })).data.error, /needs 4 tickets/);
  assert.equal((await ctx.call('POST', '/api/checkout/quote', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 4, promoCode: 'SQUAD' } })).data.totalPesewas, 30000);
});

test('pay in bits keeps the promo price it started with, and counts the promo when the ticket is issued', async () => {
  const ctx = setup();
  const p = await addPromo(ctx, { name: 'Early bird', kind: 'amount', value: 2000 });
  const start = await ctx.call('POST', '/api/installments/start', { body: { eventId: 'n1', ticketTypeId: 'reg', quantity: 1, buyerName: 'Ama', buyerPhone: '0241234567', depositPesewas: 8000, acknowledged: true } });
  assert.equal(start.status, 200, start.data.error);
  const plan = ctx.store.get('installment_plans', start.data.planId).fields;
  assert.equal(plan.totalPesewas, 8000); assert.equal(plan.promo.name, 'Early bird');
  const ref = ctx.store.list('pending_checkouts').find(x => x.fields.planId === start.data.planId).id;
  ctx.store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 8000 });
  await ctx.call('POST', '/api/checkout/verify', { body: { reference: ref } });
  assert.equal(ctx.store.get('installment_plans', start.data.planId).fields.status, 'completed');
  assert.equal(ctx.store.get('promos', p.data.id).fields.usedCount, 1);
});

test('only the control room runs promos; bad promos are refused with a clear reason; codes are unique per night', async () => {
  const ctx = setup();
  assert.equal((await ctx.call('POST', '/api/admin/promos', { claims: { role: 'doorStaff' }, body: { eventId: 'n1', name: 'X', kind: 'percent', value: 10 } })).status, 403);
  assert.equal((await ctx.call('GET', '/api/admin/promos?eventId=n1', { claims: { role: 'organiser' } })).status, 403);
  assert.match((await addPromo(ctx, { name: 'Free', kind: 'percent', value: 100 })).data.error, /comps/);
  assert.match((await addPromo(ctx, { name: 'Too much', kind: 'amount', value: 10000, ticketTypeIds: ['reg'] })).data.error, /as much as the ticket/);
  assert.match((await addPromo(ctx, { name: 'Bad', kind: 'bundle', buy: 3, pay: 3 })).data.error, /group deal/);
  assert.match((await addPromo(ctx, { name: 'Back', kind: 'percent', value: 10, startsAt: '2099-02-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z' })).data.error, /end after/);
  assert.equal((await addPromo(ctx, { name: 'A', kind: 'percent', value: 10, code: 'MEM10' })).status, 200);
  assert.match((await addPromo(ctx, { name: 'B', kind: 'percent', value: 15, code: 'mem10' })).data.error, /already used/);
  const list = await ctx.call('GET', '/api/admin/promos?eventId=n1', { claims: { role: 'director' } });
  assert.equal(list.data.promos.length, 1); assert.equal(list.data.promos[0].code, 'MEM10');
  assert.ok(ctx.store.list('audit_logs').some(a => a.fields.action === 'PROMO_ADDED'));
});
