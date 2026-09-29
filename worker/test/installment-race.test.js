import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillInstallment } from '../src/index.js';

test('two top-up payments verified at once: both amounts land (no lost update), ticket issued exactly once', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt1', { eventId: 'event1', name: 'VIP', pricePesewas: 10000, admits: 1, remaining: 5, active: true });
  store.seed('installment_plans', 'MEM-1234', {
    eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt1', ticketTypeName: 'VIP', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 0, buyerName: 'Ama', buyerPhone: '024', buyerEmail: 'a@test.com',
    identityLine: 'SAMPLE LINE TWO.', status: 'active', payments: [],
  });
  // Two separate real charges, each individually within the (stale) remaining balance at the
  // moment they were initiated, together crossing the total — exactly the scenario the plan
  // accepts an overpayment for, and exactly what must never issue two tickets.
  store.seed('pending_checkouts', 'topupA', { reference: 'topupA', kind: 'installment_topup', planId: 'MEM-1234', amountPesewas: 7000, buyerEmail: 'a@test.com', status: 'pending' });
  store.seed('pending_checkouts', 'topupB', { reference: 'topupB', kind: 'installment_topup', planId: 'MEM-1234', amountPesewas: 7000, buyerEmail: 'a@test.com', status: 'pending' });
  store.setPaystack('topupA', { status: 'success', currency: 'GHS', amount: 7000 });
  store.setPaystack('topupB', { status: 'success', currency: 'GHS', amount: 7000 });

  const [a, b] = await Promise.all([fulfillInstallment(env, 'topupA'), fulfillInstallment(env, 'topupB')]);
  const results = [a, b];

  assert.ok(results.every(r => r.status === 'issued'), 'both individual payments must be accepted (neither is a duplicate)');
  const completions = results.filter(r => r.planComplete);
  assert.equal(completions.length, 1, 'the plan should complete exactly once, on whichever payment crosses the total');
  assert.deepEqual(a.ticketIds.length ? a.ticketIds : b.ticketIds, completions[0].ticketIds);

  const plan = store.get('installment_plans', 'MEM-1234');
  assert.equal(plan.fields.paidPesewas, 14000, 'both payments must be reflected — no lost update');
  assert.equal(plan.fields.status, 'completed');
  assert.equal(plan.fields.payments.length, 2);

  assert.equal(store.list('tickets').length, 1, 'exactly one ticket, not one per payment');
  assert.equal(store.list('orders').length, 1);
  assert.equal(store.get('ticket_types', 'tt1').fields.remaining, 4, 'stock decremented exactly once, at completion');
});

test('a top-up on a plan that is already complete does not re-issue a ticket', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt2', { eventId: 'event1', name: 'VIP', pricePesewas: 10000, admits: 1, remaining: 5, active: true });
  store.seed('installment_plans', 'MEM-5555', {
    eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt2', ticketTypeName: 'VIP', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 10000, buyerName: 'Ama', buyerPhone: '024', buyerEmail: 'a@test.com',
    identityLine: 'SAMPLE LINE TWO.', status: 'completed', payments: [{ reference: 'earlier', amountPesewas: 10000 }],
    ticketIds: ['existingTicket'], orderId: 'order1',
  });
  store.seed('pending_checkouts', 'lateRef', { reference: 'lateRef', kind: 'installment_topup', planId: 'MEM-5555', amountPesewas: 500, buyerEmail: 'a@test.com', status: 'pending' });
  store.setPaystack('lateRef', { status: 'success', currency: 'GHS', amount: 500 });

  // topupInstallment() would normally refuse this before payment; fulfillInstallment is the
  // last line of defense if a stray charge for an already-complete plan is verified anyway.
  const r = await fulfillInstallment(env, 'lateRef');
  assert.equal(r.status, 'issued');
  assert.equal(r.planComplete, false, 'a plan already complete must not be reported as newly-completing');
  assert.equal(store.list('tickets').length, 0, 'no extra ticket for the stray payment');
});
