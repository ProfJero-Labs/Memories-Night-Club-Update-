import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillTicket } from '../src/index.js';

test('two buyers racing for the last ticket: exactly one gets it, stock never goes negative', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt1', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 1, active: true });
  store.seed('pending_checkouts', 'refA', {
    reference: 'refA', kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt1',
    ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 5000,
    buyerName: 'Ama', buyerPhone: '024', buyerEmail: 'a@test.com', identityLine: 'FULLY ACTIVE.', status: 'pending',
  });
  store.seed('pending_checkouts', 'refB', {
    reference: 'refB', kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt1',
    ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 5000,
    buyerName: 'Kwame', buyerPhone: '025', buyerEmail: 'k@test.com', identityLine: 'FULLY ACTIVE.', status: 'pending',
  });
  store.setPaystack('refA', { status: 'success', currency: 'GHS', amount: 5000 });
  store.setPaystack('refB', { status: 'success', currency: 'GHS', amount: 5000 });

  const [a, b] = await Promise.all([fulfillTicket(env, 'refA'), fulfillTicket(env, 'refB')]);
  const results = [a, b];
  const issued = results.filter(r => r.status === 'issued');
  const failed = results.filter(r => r.status === 'failed');

  assert.equal(issued.length, 1, 'exactly one buyer should get a ticket');
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /sold out/i);

  const tt = store.get('ticket_types', 'tt1');
  assert.equal(tt.fields.remaining, 0, 'stock must land at exactly 0, never negative or double-decremented');

  const allTickets = store.list('tickets');
  assert.equal(allTickets.length, 1, 'exactly one ticket document, not one per attempt');

  const orders = store.list('orders');
  assert.equal(orders.length, 1);
});

test('same reference verified twice (e.g. webhook + client polling both land) issues only one ticket', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt2', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 5, active: true });
  store.seed('pending_checkouts', 'refC', {
    reference: 'refC', kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt2',
    ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 5000,
    buyerName: 'Ama', buyerPhone: '024', buyerEmail: 'a@test.com', identityLine: 'FULLY ACTIVE.', status: 'pending',
  });
  store.setPaystack('refC', { status: 'success', currency: 'GHS', amount: 5000 });

  const [a, b] = await Promise.all([fulfillTicket(env, 'refC'), fulfillTicket(env, 'refC')]);
  assert.equal(a.status, 'issued');
  assert.equal(b.status, 'issued');
  assert.deepEqual(a.ticketIds, b.ticketIds, 'both callers must see the same ticket, not two different ones');
  assert.equal(store.list('tickets').length, 1);
  assert.equal(store.get('ticket_types', 'tt2').fields.remaining, 4);
});
