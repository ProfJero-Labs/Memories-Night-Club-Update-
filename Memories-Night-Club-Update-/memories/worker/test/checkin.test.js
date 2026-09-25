import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { checkin } from '../src/index.js';

test('two door staff scanning the same ticket at once: exactly one check-in is recorded', async () => {
  const { store, env } = createMockEnv();
  store.seed('tickets', 'tok123', {
    customerName: 'Ama', type: 'Standard', admitCount: 1, eventId: 'event1',
    status: 'valid', revoked: false, cancelled: false,
  });

  const doorA = { uid: 'door-a', role: 'doorStaff' };
  const doorB = { uid: 'door-b', role: 'doorStaff' };
  const [a, b] = await Promise.all([
    checkin(env, 'tok123', doorA),
    checkin(env, 'tok123', doorB),
  ]);

  const results = [a, b];
  const valid = results.filter(r => r.valid);
  const rejected = results.filter(r => !r.valid);

  assert.equal(valid.length, 1, 'exactly one scan should confirm entry');
  assert.equal(rejected.length, 1, 'the other should see it already used, not a crash or a silent double entry');
  assert.equal(rejected[0].message, 'TICKET ALREADY USED');

  const ticket = store.get('tickets', 'tok123');
  assert.equal(ticket.fields.status, 'used');

  const checkinDocs = store.list('checkins').filter(d => d.fields.ticketId === 'tok123');
  assert.equal(checkinDocs.length, 1, 'exactly one checkins record, not one per attempt');
  assert.equal(checkinDocs[0].fields.checkedInBy, valid[0] === a ? 'door-a' : 'door-b');
});

test('a revoked ticket is refused even under concurrent scans', async () => {
  const { store, env } = createMockEnv();
  store.seed('tickets', 'tokRevoked', { customerName: 'X', eventId: 'event1', status: 'valid', revoked: true, cancelled: false });
  const [a, b] = await Promise.all([
    checkin(env, 'tokRevoked', { uid: 'd1' }),
    checkin(env, 'tokRevoked', { uid: 'd2' }),
  ]);
  assert.equal(a.valid, false);
  assert.equal(b.valid, false);
  assert.equal(store.list('checkins').length, 0);
});
