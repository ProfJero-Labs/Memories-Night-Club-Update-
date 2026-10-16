// A8: nothing sensitive reaches the Worker's logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { redact } from '../src/lib/log.js';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';

const TOKEN = '0123456789abcdef'.repeat(4);

test('redact: tokens, document paths, order codes, phones, keys and bearer tokens', () => {
  const out = redact(new Error(`No document to update: projects/p/databases/(default)/documents/tickets/${TOKEN} for 0241234567 / +233551112222 plan MEM-7K3QX-9WP2M MEM-AB1234 sk_live_abc123 xkeysib-deadbeef-1 Bearer eyJhbGciOi.x.y /api/tickets/${TOKEN}`));
  for (const secret of [TOKEN, '0241234567', '233551112222', '7K3QX', 'AB1234', 'sk_live_abc123', 'xkeysib-deadbeef', 'eyJhbGciOi']) assert.ok(!out.includes(secret), `leaked ${secret}: ${out}`);
  assert.match(out, /024\*\*\*4567/);
});

test('the Worker logs only through the redacting logger', () => {
  const dirs = ['../src/', '../src/lib/'];
  for (const d of dirs) for (const f of readdirSync(new URL(d, import.meta.url)).filter(f => f.endsWith('.js') && f !== 'log.js'))
    assert.doesNotMatch(readFileSync(new URL(d + f, import.meta.url), 'utf8'), /console\.(log|error|warn|info|debug)\(/, `${d}${f} logs directly`);
});

test('a failing request logs the route without the ticket token', async () => {
  const { store, env } = createMockEnv();
  const lines = []; const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error(`boom documents/tickets/${TOKEN}`); };
  try { await worker.fetch(new Request(`https://api.test/api/tickets/${TOKEN}`, { headers: { 'CF-Connecting-IP': '10.2.2.2' } }), env); }
  finally { console.error = orig; globalThis.fetch = origFetch; }
  assert.ok(lines.length, 'something was logged');
  assert.ok(lines.every(l => !l.includes(TOKEN)), lines.join('\n'));
});
