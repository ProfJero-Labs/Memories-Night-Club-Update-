// Sentry's monthly allowance: the same problem is reported once per window, with a count of what
// was held back; different problems are never held back by each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentryGate, heldNote, resetSentryGate } from '../src/lib/sentry-gate.js';

test('the same problem goes once per window, then says how many were held back', () => {
  resetSentryGate();
  const t0 = 1_000_000;
  assert.deepEqual(sentryGate('sms:status 500', 600_000, t0), { held: 0 });
  for (let i = 1; i <= 12; i++) assert.equal(sentryGate('sms:status 500', 600_000, t0 + i * 1000), null);
  const next = sentryGate('sms:status 500', 600_000, t0 + 600_001);
  assert.deepEqual(next, { held: 12 });
  assert.equal(heldNote(next), ' (+12 more since the last report)');
  assert.equal(heldNote({ held: 0 }), '');
});

test('different problems are reported independently', () => {
  resetSentryGate();
  assert.ok(sentryGate('err:/api/checkout:TypeError:x', 300_000, 1));
  assert.ok(sentryGate('err:/api/tickets:TypeError:x', 300_000, 2));
  assert.ok(sentryGate('browser:ticket.html:boom', 600_000, 3));
  assert.equal(sentryGate('err:/api/checkout:TypeError:x', 300_000, 4), null);
});
