import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { drawRaffle } from '../src/index.js';

test('two admins drawing the same raffle at once: exactly one wins, the other is told it is already drawn', async () => {
  const { store, env } = createMockEnv();
  store.seed('raffles', 'raffle1', { eventId: 'event1', prize: 'A magnum', cap: 20, spotsTaken: 3, enabled: true, status: 'open' });
  store.seed('raffle_entries', 'entryA', { raffleId: 'raffle1', eventId: 'event1', ticketId: 'ticketA', status: 'eligible' });
  store.seed('raffle_entries', 'entryB', { raffleId: 'raffle1', eventId: 'event1', ticketId: 'ticketB', status: 'eligible' });
  store.seed('raffle_entries', 'entryC', { raffleId: 'raffle1', eventId: 'event1', ticketId: 'ticketC', status: 'eligible' });

  const admin = { uid: 'staff-1', role: 'superAdmin' };
  const [a, b] = await Promise.all([
    drawRaffle(env, { raffleId: 'raffle1' }, admin),
    drawRaffle(env, { raffleId: 'raffle1' }, admin),
  ]);

  const results = [a, b];
  const wins = results.filter(r => r.success);
  const losses = results.filter(r => !r.success);

  assert.equal(wins.length, 1, 'exactly one draw call should succeed');
  assert.equal(losses.length, 1, 'the other should be rejected');
  assert.match(losses[0].error, /already been drawn/i);
  assert.ok(['ticketA', 'ticketB', 'ticketC'].includes(wins[0].winnerTicketId));

  const raffle = store.get('raffles', 'raffle1');
  assert.equal(raffle.fields.status, 'drawn');
  // The raffles doc is client-readable directly from Firestore (public site reads), and a ticket
  // doc's ID doubles as its bearer token (`allow get: if true` on /tickets/{id}) — so the raw
  // winnerTicketId must never land on this doc. Only the privacy-safe display name/code do.
  assert.equal(raffle.fields.winnerTicketId, undefined, 'the raw ticket token must never be stored on the public raffle doc');
  assert.equal(raffle.fields.winnerEntryId, undefined, 'internal entry id must never be stored on the public raffle doc');
  assert.equal(raffle.fields.drawnBy, undefined, 'staff uid must never be stored on the public raffle doc');
  assert.ok(raffle.fields.winnerDisplayName, 'a privacy-safe display name is stored for the public page');

  const winningEntry = store.list('raffle_entries').find(d => d.fields.ticketId === wins[0].winnerTicketId);
  assert.equal(winningEntry.fields.status, 'won', 'the winning entry is marked won in the locked-down raffle_entries collection');

  const auditLogs = store.list('audit_logs').filter(d => d.fields.raffleId === 'raffle1');
  assert.equal(auditLogs.length, 1, 'exactly one audit record, not one per attempt');
  assert.equal(auditLogs[0].fields.eligibleEntryCount, 3);
  assert.equal(auditLogs[0].fields.winnerTicketId, wins[0].winnerTicketId, 'the raw ticket id is preserved in the admin-only audit trail');
});

test('drawing an already-drawn raffle is rejected, not silently re-drawn', async () => {
  const { store, env } = createMockEnv();
  store.seed('raffles', 'raffle2', { eventId: 'event1', prize: 'x', cap: 20, spotsTaken: 1, enabled: true, status: 'drawn', winnerDisplayName: 'Z' });
  store.seed('raffle_entries', 'entryZ', { raffleId: 'raffle2', eventId: 'event1', ticketId: 'ticketZ', status: 'eligible' });

  const r = await drawRaffle(env, { raffleId: 'raffle2' }, { uid: 's1', role: 'superAdmin' });
  assert.equal(r.success, undefined);
  assert.match(r.error, /already been drawn/i);
});
