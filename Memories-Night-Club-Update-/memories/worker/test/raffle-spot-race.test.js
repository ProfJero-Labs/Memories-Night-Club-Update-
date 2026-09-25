import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillTicket } from '../src/index.js';

test('two ticket buyers racing for the last raffle spot: exactly one gets in, the cap is never exceeded', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt1', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 100, active: true });
  store.seed('raffles', 'raffle1', { eventId: 'event1', prize: 'A magnum', cap: 5, spotsTaken: 4, enabled: true, status: 'open' });
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
  assert.equal(a.status, 'issued');
  assert.equal(b.status, 'issued', 'both tickets must still be issued — a full raffle never blocks a sale');

  const raffle = store.get('raffles', 'raffle1');
  assert.equal(raffle.fields.spotsTaken, 5, 'the cap must be reached, not exceeded');
  assert.equal(raffle.fields.status, 'closed', 'the raffle auto-closes once the cap is hit');

  const entries = store.list('raffle_entries').filter(e => e.fields.raffleId === 'raffle1');
  assert.equal(entries.length, 1, 'only one of the two orders should have taken the last spot');

  const tickets = store.list('tickets');
  assert.equal(tickets.length, 2, 'both tickets exist');
  const inDrawCount = tickets.filter(t => t.fields.inDraw).length;
  assert.equal(inDrawCount, 1, 'exactly one of the two orders is flagged in the draw');
});

test('a ticket bought once the raffle is already closed is not flagged in the draw', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'tt2', { eventId: 'event1', name: 'Standard', pricePesewas: 5000, admits: 1, remaining: 100, active: true });
  store.seed('raffles', 'raffle2', { eventId: 'event1', prize: 'x', cap: 5, spotsTaken: 5, enabled: true, status: 'closed' });
  store.seed('pending_checkouts', 'refC', {
    reference: 'refC', kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'tt2',
    ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 5000,
    buyerName: 'Ama', buyerPhone: '024', buyerEmail: 'a@test.com', identityLine: 'FULLY ACTIVE.', status: 'pending',
  });
  store.setPaystack('refC', { status: 'success', currency: 'GHS', amount: 5000 });

  const r = await fulfillTicket(env, 'refC');
  assert.equal(r.status, 'issued');
  const ticket = store.get('tickets', r.ticketIds[0]);
  assert.equal(ticket.fields.inDraw, false);
  assert.equal(store.get('raffles', 'raffle2').fields.spotsTaken, 5);
});
