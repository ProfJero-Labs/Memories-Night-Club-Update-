import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { checkin } from '../src/index.js';

test('a transaction under permanent contention gives up after 5 attempts instead of retrying forever', async () => {
  const { store, env } = createMockEnv();
  store.seed('tickets', 'tokX', { customerName: 'Ama', eventId: 'event1', status: 'valid', revoked: false, cancelled: false });

  let commitAttempts = 0;
  // Simulate a competing writer landing between this transaction's read and its own commit,
  // every single time — so this transaction can never win, and the retry loop must eventually
  // stop instead of spinning forever.
  store.onCommitAttempt = () => {
    commitAttempts++;
    const k = store.key('tickets', 'tokX');
    store.versions.set(k, (store.versions.get(k) || 0) + 1);
  };

  await assert.rejects(() => checkin(env, 'tokX', { uid: 'door-1', role: 'doorStaff' }, { eventId: 'event1' }));
  assert.equal(commitAttempts, 5, 'exactly 5 commit attempts — the documented cap, neither fewer nor unbounded');
});
