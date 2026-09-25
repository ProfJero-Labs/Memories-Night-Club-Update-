import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillInstallment, drawRaffle, organiserOverview } from '../src/index.js';

// ── Installment top-up / completion SMS ──

test('a partial top-up SMS states the amount received and the remaining balance', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt1', { eventId: 'event1', name: 'VIP', pricePesewas: 10000, admits: 1, remaining: 5, active: true });
  store.seed('installment_plans', 'MEM-9001', {
    eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt1', ticketTypeName: 'VIP', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 0, buyerName: 'Ama', buyerPhone: '0555000111', buyerEmail: 'a@test.com',
    identityLine: 'FULLY ACTIVE.', status: 'active', payments: [],
  });
  store.seed('pending_checkouts', 'topA', { reference: 'topA', kind: 'installment_topup', planId: 'MEM-9001', amountPesewas: 3000, buyerEmail: 'a@test.com', status: 'pending' });
  store.setPaystack('topA', { status: 'success', currency: 'GHS', amount: 3000 });

  const r = await fulfillInstallment(env, 'topA');
  assert.equal(r.planComplete, false);
  assert.equal(store.sms.length, 1);
  assert.equal(store.sms[0].to, '0555000111');
  assert.match(store.sms[0].message, /GHS 30 received/);
  assert.match(store.sms[0].message, /Balance: GHS 70/);
  assert.equal(store.emails.length, 0, 'no email on a partial top-up, only on completion');
});

test('the completing top-up SMS+emails a ready-ticket message instead of a balance message', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt2', { eventId: 'event1', name: 'VIP', pricePesewas: 10000, admits: 1, remaining: 5, active: true });
  store.seed('installment_plans', 'MEM-9002', {
    eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt2', ticketTypeName: 'VIP', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 7000, buyerName: 'Ama', buyerPhone: '0555000222', buyerEmail: 'a@test.com',
    identityLine: 'FULLY ACTIVE.', status: 'active', payments: [{ reference: 'earlier', amountPesewas: 7000 }],
  });
  store.seed('pending_checkouts', 'topB', { reference: 'topB', kind: 'installment_topup', planId: 'MEM-9002', amountPesewas: 3000, buyerEmail: 'a@test.com', status: 'pending' });
  store.setPaystack('topB', { status: 'success', currency: 'GHS', amount: 3000 });

  const r = await fulfillInstallment(env, 'topB');
  assert.equal(r.planComplete, true);
  assert.equal(store.sms.length, 1);
  assert.match(store.sms[0].message, /Paid in full/);
  assert.doesNotMatch(store.sms[0].message, /Balance:/);
  assert.equal(store.emails.length, 1, 'completion also emails a ticket-ready notice');
});

test('a duplicate verify call for the same already-issued reference does not re-send SMS', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt3', { eventId: 'event1', name: 'VIP', pricePesewas: 10000, admits: 1, remaining: 5, active: true });
  store.seed('installment_plans', 'MEM-9003', {
    eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt3', ticketTypeName: 'VIP', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 0, buyerName: 'Ama', buyerPhone: '0555000333', buyerEmail: 'a@test.com',
    identityLine: 'FULLY ACTIVE.', status: 'active', payments: [],
  });
  store.seed('pending_checkouts', 'topC', { reference: 'topC', kind: 'installment_topup', planId: 'MEM-9003', amountPesewas: 3000, buyerEmail: 'a@test.com', status: 'pending' });
  store.setPaystack('topC', { status: 'success', currency: 'GHS', amount: 3000 });

  await fulfillInstallment(env, 'topC');
  assert.equal(store.sms.length, 1);
  // Simulates the webhook and a client poll both landing for the same reference.
  await fulfillInstallment(env, 'topC');
  assert.equal(store.sms.length, 1, 'the early-return on an already-issued reference must prevent a duplicate SMS');
});

// ── Raffle winner SMS ──

test('drawing a raffle SMS-notifies the winner using their order phone number', async () => {
  const { store, env } = createMockEnv();
  store.seed('raffles', 'raffleN1', { eventId: 'event1', prize: 'A magnum', cap: 20, spotsTaken: 1, enabled: true, status: 'open' });
  store.seed('tickets', 'ticketN1', { customerName: 'Ama Mensah', displayCode: 'MEM-N1N1N1', eventId: 'event1' });
  store.seed('orders', 'orderN1', { buyerPhone: '0555000444' });
  store.seed('raffle_entries', 'entryN1', { raffleId: 'raffleN1', eventId: 'event1', ticketId: 'ticketN1', orderId: 'orderN1', status: 'eligible' });

  const r = await drawRaffle(env, { raffleId: 'raffleN1' }, { uid: 'staff-1', role: 'superAdmin' });
  assert.equal(r.success, true);
  assert.equal(store.sms.length, 1);
  assert.equal(store.sms[0].to, '0555000444');
  assert.match(store.sms[0].message, /You won the raffle/);
  assert.match(store.sms[0].message, /Ama M\./);
});

// ── Organiser metrics ──

test('organiserOverview reports per-ticket-type breakdown, money owing, and raffle info — strictly scoped to the organiser\'s own event', async () => {
  const { store, env } = createMockEnv();
  store.seed('events', 'orgEvt1', { name: 'Organiser Night', date: '2026-01-01T22:00:00.000Z', organiserId: 'organiser-uid-1', visibility: 'public', active: true });
  store.seed('events', 'otherEvt', { name: 'Not Mine', date: '2026-01-01T22:00:00.000Z', organiserId: 'someone-else', visibility: 'public', active: true });
  store.seed('orders', 'ord1', { eventId: 'orgEvt1', kind: 'ticket', status: 'confirmed', ticketTypeName: 'VIP', quantity: 2, amountPesewas: 20000 });
  store.seed('orders', 'ord2', { eventId: 'orgEvt1', kind: 'ticket', status: 'confirmed', ticketTypeName: 'Standard', quantity: 1, amountPesewas: 5000 });
  store.seed('installment_plans', 'planOrg1', { eventId: 'orgEvt1', status: 'active', totalPesewas: 10000, paidPesewas: 4000 });
  store.seed('raffles', 'raffleOrg1', { eventId: 'orgEvt1', enabled: true, prize: 'Champagne', cap: 20, spotsTaken: 5, status: 'open' });

  const result = await organiserOverview(env, { uid: 'organiser-uid-1', role: 'organiser' });
  assert.equal(result.events.length, 1, 'only the organiser\'s own event is returned, not otherEvt');
  const e = result.events[0];
  assert.equal(e.eventId, 'orgEvt1');
  assert.deepEqual(e.ticketsSoldByType, { VIP: 2, Standard: 1 });
  assert.equal(e.moneyOwingPesewas, 6000);
  assert.equal(e.partialOrdersCount, 1);
  assert.equal(e.raffle.prize, 'Champagne');
  assert.equal(e.raffle.spotsTaken, 5);
});
