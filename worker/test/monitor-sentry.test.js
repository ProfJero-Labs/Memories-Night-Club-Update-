// Runs in its own file so Sentry starts from a clean process, exactly like a fresh Worker isolate
// with a DSN set. (Mixing it with tests that call the Worker without a DSN makes Sentry's global
// state order-dependent, which cannot happen in production.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
const ORIGIN = 'http://localhost:3000';
const checkoutBody = JSON.stringify({ eventId: 'e1', ticketTypeId: 'tt1', quantity: 1, buyerName: 'Ama', buyerPhone: '0241234567' });
const post = (path, body) => new Request(`https://api.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body });

test('with a DSN set, the real Sentry envelope is sent and contains no secrets', async () => {
  const { store, env } = createMockEnv();
  env.SENTRY_DSN = 'https://publickey@o1.ingest.sentry.io/1';
  env.ALERT_PHONES = '';
  const envelopes = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    if (String(url).includes('ingest.sentry.io')) { envelopes.push(typeof o.body === 'string' ? o.body : Buffer.from(o.body).toString()); return new Response('{}', { status: 200 }); }
    if (String(url).includes('firestore.googleapis.com')) throw new Error(`No document: tickets/${TOKEN} for 0241234567 sk_live_abc123`);
    return inner(url, o);
  };
  const pending = [];
  const ctx = { waitUntil: p => pending.push(Promise.resolve(p).catch(() => {})) };
  try {
    const r = await worker.fetch(post('/api/checkout/initiate', checkoutBody), env, ctx);
    assert.equal(r.status, 500);
    await Promise.all(pending);
    for (let i = 0; i < 20 && !envelopes.length; i++) await new Promise(res => setTimeout(res, 50));
  } finally { globalThis.fetch = inner; }

  assert.ok(envelopes.length >= 1, 'Sentry received an event');
  const all = envelopes.join('\n');
  assert.match(all, /"where":"POST \/api\/checkout"/, 'tagged with the route group');
  for (const secret of [TOKEN, '0241234567', 'sk_live_abc123', 'tickets/' + TOKEN]) assert.ok(!all.includes(secret), `Sentry payload leaked ${secret}`);
});
