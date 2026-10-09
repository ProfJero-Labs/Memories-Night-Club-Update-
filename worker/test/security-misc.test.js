import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillTicket, requireRole } from '../src/index.js';

// ── Ticket token entropy — can a ticket be found by guessing? ──
test('ticket tokens are high-entropy and pairwise unique across many issuances', async () => {
  const { store, env } = createMockEnv();
  store.seed('ticket_types', 'ttBulk', { eventId: 'event1', name: 'Standard', pricePesewas: 1000, admits: 1, remaining: 500, active: true });

  const tokens = [];
  for (let i = 0; i < 200; i++) {
    const ref = `bulkref${i}`;
    store.seed('pending_checkouts', ref, {
      reference: ref, kind: 'ticket', eventId: 'event1', eventName: 'Test Night', ticketTypeId: 'ttBulk',
      ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 1000,
      buyerName: `Guest ${i}`, buyerPhone: '024', buyerEmail: `g${i}@test.com`, identityLine: 'SAMPLE LINE TWO.', status: 'pending',
    });
    store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 1000 });
    const r = await fulfillTicket(env, ref);
    tokens.push(...r.ticketIds);
  }

  assert.equal(tokens.length, 200);
  assert.equal(new Set(tokens).size, 200, 'no two tokens collided across 200 issuances');
  for (const t of tokens) {
    assert.match(t, /^[0-9a-f]{64}$/, 'each token is 64 lowercase hex chars (two concatenated UUIDv4s, no dashes)');
  }
  // Each token is two crypto.randomUUID() values concatenated: each UUIDv4 carries 122 bits of
  // real randomness (6 bits are fixed version/variant markers), so a token carries ~244 bits.
  // A ticket can only be looked up by its exact token (GET /api/tickets/:token, or QR containing
  // the verify URL) — guessing or enumerating one in any practical timeframe is infeasible; this
  // is a mathematical property of crypto.randomUUID(), not something a runtime test can add
  // confidence to beyond confirming the actual output shape and uniqueness above.
});

// ── requireRole() — the function every admin-only Worker route gates on ──
test('requireRole: superAdmin (admin:true) always passes, regardless of which roles are listed', () => {
  assert.equal(requireRole({ admin: true, role: 'doorStaff' }, ['superAdmin']), true);
  assert.equal(requireRole({ admin: true }, ['manager', 'eventManager']), true);
});

test('requireRole: a plain role claim only passes for routes that list it', () => {
  assert.equal(requireRole({ role: 'doorStaff' }, ['superAdmin', 'manager', 'doorStaff']), true);
  assert.equal(requireRole({ role: 'doorStaff' }, ['superAdmin', 'manager']), false, 'doorStaff must not pass a route that only lists superAdmin/manager (e.g. event/catalog edits)');
  assert.equal(requireRole({ role: 'organiser' }, ['superAdmin', 'manager', 'eventManager']), false, 'organiser must not pass ordinary admin routes');
});

test('requireRole: no user, no claims, or an unrecognised role all fail closed', () => {
  assert.equal(requireRole(null, ['superAdmin']), false);
  assert.equal(requireRole({}, ['superAdmin']), false);
  assert.equal(requireRole({ role: 'made-up-role' }, ['superAdmin', 'manager', 'eventManager', 'doorStaff']), false);
  assert.equal(requireRole({ admin: false, role: 'superAdmin' }, ['manager']), false, 'the string "superAdmin" as a role claim, without also being in the allowed list, does not bypass anything');
});
