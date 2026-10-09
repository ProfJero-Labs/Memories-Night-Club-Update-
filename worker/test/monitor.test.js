import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import worker from '../src/index.js';
import { scrubEvent, routeGroup, isCritical } from '../src/lib/monitor.js';

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
const ORIGIN = 'http://localhost:3000';

// Makes every Firestore call fail with an error that quotes secrets, like a real outage can.
function breakFirestore() {
  const inner = globalThis.fetch;
  globalThis.fetch = (url, o) => String(url).includes('firestore.googleapis.com')
    ? Promise.reject(new Error(`No document: projects/p/databases/(default)/documents/tickets/${TOKEN} for 0241234567 sk_live_abc123`))
    : inner(url, o);
  return () => { globalThis.fetch = inner; };
}
const checkoutBody = JSON.stringify({ eventId: 'e1', ticketTypeId: 'tt1', quantity: 1, buyerName: 'Ama', buyerPhone: '0241234567' });
const post = (path, body, headers = {}) => new Request(`https://api.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body });
const sms = store => store.sms.filter(s => /MEMORIES ALERT/.test(s.message));

test('scrubEvent strips request, user, breadcrumbs and secrets from messages and transaction names', () => {
  const out = scrubEvent({
    request: { url: `https://x/api/tickets/${TOKEN}`, headers: { authorization: 'Bearer abc.def' } },
    user: { ip_address: '1.2.3.4' }, extra: { phone: '0241234567' }, tags: { url: 'x', where: 'ok' },
    breadcrumbs: [{ message: `GET firestore tickets/${TOKEN}` }],
    transaction: `GET /api/tickets/${TOKEN}`,
    exception: { values: [{ type: 'Error', value: `No document: tickets/${TOKEN} for 0241234567 sk_live_abc123 MEM-7K3QX-9WP2M` }] },
  });
  const all = JSON.stringify(out);
  for (const secret of [TOKEN, '0241234567', 'sk_live_abc123', 'MEM-7K3QX-9WP2M', 'Bearer abc', '1.2.3.4']) assert.ok(!all.includes(secret), `leaked ${secret}`);
  assert.equal(out.request, undefined);
  assert.deepEqual(out.breadcrumbs, []);
  assert.equal(out.tags.where, 'ok', 'useful tags survive');
});

test('route helpers keep ids out and flag only payment paths as critical', () => {
  assert.equal(routeGroup(`/api/tickets/${TOKEN}`), '/api/tickets');
  assert.equal(routeGroup('/api/checkout/initiate'), '/api/checkout');
  for (const p of ['/api/checkout/initiate', '/api/checkout/verify', '/api/table-checkout/initiate', '/api/installments/start', '/api/paystack/webhook']) assert.ok(isCritical(p), p);
  for (const p of ['/api/events', '/api/settings', '/api/checkin', '/api/admin/orders', '/api/health']) assert.ok(!isCritical(p), p);
});

test('a failing payment route texts the team once, then stays quiet for 15 minutes', async () => {
  const { store, env } = createMockEnv();
  env.ALERT_PHONES = '0240000001,0240000002';
  env.PUBLIC_SITE_URL = 'https://memoriesnightclub.test';
  const restore = breakFirestore();
  try {
    const r1 = await worker.fetch(post('/api/checkout/initiate', checkoutBody), env);
    assert.equal(r1.status, 500);
    assert.deepEqual((await r1.json()).error, 'Something went wrong on our side. Try again.', 'guest sees a calm message, never the cause');
    assert.equal(sms(store).length, 2, 'one text per alert phone');
    assert.ok(!sms(store).some(s => /0241234567|sk_live|tickets\//.test(s.message)), 'the text carries no secrets');

    await worker.fetch(post('/api/checkout/initiate', checkoutBody), env);
    assert.equal(sms(store).length, 2, 'no second text inside the window');
  } finally { restore(); }
});

test('a failing non-payment route reports to Sentry only and sends no text', async () => {
  const { store, env } = createMockEnv();
  env.ALERT_PHONES = '0240000001';
  const restore = breakFirestore();
  try {
    const r = await worker.fetch(new Request('https://api.test/api/events', { headers: { Origin: ORIGIN } }), env);
    assert.equal(r.status, 500);
    assert.equal(sms(store).length, 0);
  } finally { restore(); }
});

test('client-error endpoint: accepts a clean report, ignores foreign origins and oversize bodies, never errors', async () => {
  const { env } = createMockEnv();
  const good = JSON.stringify({ kind: 'error', message: 'x is not a function', page: '/checkout.html', source: '/pages/checkout.js', line: 10, col: 4 });
  let r = await worker.fetch(post('/api/client-error', good), env);
  assert.equal(r.status, 200);
  r = await worker.fetch(post('/api/client-error', good, { Origin: 'https://evil.example' }), env);
  assert.equal(r.status, 200, 'silently ignored, no signal to a prober');
  r = await worker.fetch(post('/api/client-error', JSON.stringify({ message: 'x'.repeat(5000) })), env);
  assert.equal(r.status, 200);
  r = await worker.fetch(post('/api/client-error', 'not json'), env);
  assert.equal(r.status, 200);
});

test('browser reporter: sends real bugs from our own scripts, skips noise, caps volume, strips the query string', async () => {
  const handlers = {}, calls = [];
  globalThis.window = { MEMORIES_CONFIG: { apiBase: 'https://api.test' } };
  globalThis.location = { origin: 'https://site.test', pathname: '/ticket.html', search: `?token=${TOKEN}` };
  globalThis.addEventListener = (type, fn) => { handlers[type] = fn; };
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return new Response('{}'); };
  try {
    await import('../../public/lib/report.js?t=' + Date.now());
    handlers.error({ message: 'Script error.', filename: '' });                                           // noise
    handlers.error({ message: 'boom', filename: 'chrome-extension://abc/x.js' });                          // not ours
    handlers.error({ message: 'Failed to fetch', filename: 'https://site.test/app.js' });                  // connectivity
    handlers.unhandledrejection({ reason: Object.assign(new Error('CONNECTION DROPPED'), { status: 0 }) }); // ApiError
    assert.equal(calls.length, 0, 'none of the noise was sent');

    handlers.error({ message: 'x is not a function', filename: 'https://site.test/pages/ticket.js?v=3', lineno: 12, colno: 5 });
    handlers.error({ message: 'x is not a function', filename: 'https://site.test/pages/ticket.js', lineno: 12, colno: 5 }); // duplicate
    handlers.error({ message: 'second bug', filename: 'https://site.test/app.js', lineno: 1, colno: 1 });
    handlers.error({ message: 'third bug', filename: 'https://site.test/app.js', lineno: 2, colno: 1 });
    handlers.error({ message: 'fourth bug', filename: 'https://site.test/app.js', lineno: 3, colno: 1 });     // over the cap
    assert.equal(calls.length, 3, 'deduped and capped at 3 per page load');
    assert.equal(calls[0].url, 'https://api.test/api/client-error');
    assert.equal(calls[0].body.page, '/ticket.html');
    assert.equal(calls[0].body.source, '/pages/ticket.js');
    assert.ok(!JSON.stringify(calls).includes(TOKEN), 'the secret in the query string is never sent');
  } finally { globalThis.fetch = inner; delete globalThis.window; delete globalThis.location; delete globalThis.addEventListener; }
});
