// Fails if a real credential is committed. CI also runs a history-aware scanner (TruffleHog) on
// every push/PR; this catches it earlier, offline, on `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const PATTERNS = [
  [/xkeysib-[0-9a-f]{20,}/i, 'Brevo API key'],
  [/\bsk_live_[0-9A-Za-z]{10,}/, 'Paystack live secret key'],
  [/\bsk_test_[0-9A-Za-z]{20,}/, 'Paystack test secret key'],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\s*(?:\\n)?[A-Za-z0-9+/]{40}/, 'private key'],
  [/"private_key_id"\s*:\s*"[0-9a-f]{20,}"/, 'Google service-account file'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key'],
  [/\bghp_[0-9A-Za-z]{30,}/, 'GitHub token'],
];

test('no credentials in tracked files', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(f => f && !/\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(f));
  const hits = [];
  for (const f of files) {
    let src; try { src = readFileSync(new URL(f, root), 'utf8'); } catch { continue; }
    for (const [re, what] of PATTERNS) if (re.test(src)) hits.push(`${f}: ${what}`);
  }
  assert.deepEqual(hits, []);
});
