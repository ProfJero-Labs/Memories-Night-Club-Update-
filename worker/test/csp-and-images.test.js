// A7: no inline scripts (so the CSP can forbid them), exact API host in connect-src, and event
// images limited to this project's own Storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

const pub = new URL('../../public/', import.meta.url);

test('no page has an inline script or inline event handler', () => {
  for (const f of readdirSync(pub).filter(f => f.endsWith('.html'))) {
    const html = readFileSync(new URL(f, pub), 'utf8');
    for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\ssrc=/, `${f}: inline <script>`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${f}: inline event handler`);
  }
});

test('CSP: no unsafe-inline scripts; connect-src names the API host, not all of workers.dev', () => {
  const headers = readFileSync(new URL('_headers', pub), 'utf8');
  const csp = headers.match(/Content-Security-Policy: (.+)/)[1];
  const directive = name => csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' '));
  assert.doesNotMatch(directive('script-src'), /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(directive('connect-src'), /\*\.workers\.dev/);
  const apiBase = readFileSync(new URL('config.js', pub), 'utf8').match(/apiBase: '([^']+)'/)[1];
  assert.ok(directive('connect-src').includes(apiBase), 'the Worker host from config.js is allowed');
  assert.match(headers, /Strict-Transport-Security: max-age=\d+/);
  for (const page of ['/ticket.html', '/verify.html', '/admin.html', '/organiser.html', '/checkin.html', '/login.html']) {
    const block = headers.split(/\n(?=\/)/).find(b => b.startsWith(page + '\n'));
    assert.ok(block, `${page} has its own headers`);
    assert.match(block, /Referrer-Policy: no-referrer/, `${page} no-referrer`);
    assert.match(block, /X-Robots-Tag: noindex/, `${page} noindex`);
  }
});

test('event images must be this project’s own uploads; an image a night already has still saves', async () => {
  const { store, env } = createMockEnv();
  const token = await idToken({ role: 'manager' });
  const save = body => worker.fetch(new Request('https://api.test/api/admin/events', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'N', date: '2099-01-01T22:00:00Z', ...body }) }), env).then(async r => ({ status: r.status, data: await r.json() }));
  const own = `https://firebasestorage.googleapis.com/v0/b/${env.FIREBASE_PROJECT_ID}.firebasestorage.app/o/event-art%2F1-flyer.webp?alt=media&token=x`;
  const ok = await save({ artwork: own });
  assert.equal(ok.status, 200);
  for (const bad of ['https://evil.example/flyer.jpg', 'http://firebasestorage.googleapis.com/v0/b/x/o/event-art%2Fa', `https://firebasestorage.googleapis.com/v0/b/other-project.appspot.com/o/event-art%2Fa`, 'javascript:alert(1)'])
    assert.equal((await save({ artwork: bad })).status, 400, bad);
  // A night created before this rule with a foreign image can still be edited without re-uploading.
  store.seed('events', 'old', { name: 'Old', date: '2099-01-01T22:00:00Z', artwork: 'https://legacy.example/a.jpg', visibility: 'public', active: true });
  assert.equal((await save({ id: 'old', artwork: 'https://legacy.example/a.jpg' })).status, 200);
  assert.equal((await save({ id: 'old', artwork: 'https://legacy.example/b.jpg' })).status, 400);
});

test('a night’s ticket design is saved validated and served to the public event and ticket', async () => {
  const { store, env } = createMockEnv();
  const token = await idToken({ role: 'manager' });
  const save = body => worker.fetch(new Request('https://api.test/api/admin/events', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'N', date: '2099-01-01T22:00:00Z', visibility: 'public', ...body }) }), env).then(r => r.json());
  const { eventId } = await save({ ticketStyle: 'stamp', ticketColors: { accent: '#dba63e', dark: '#1f180a', light: '#f3ede2' } });
  let ev = store.get('events', eventId).fields;
  assert.equal(ev.ticketStyle, 'stamp'); assert.equal(ev.ticketColors.accent, '#dba63e');
  await save({ id: eventId, ticketStyle: 'not-a-style', ticketColors: { accent: 'javascript:1', dark: '#000000', light: '#ffffff' } });
  ev = store.get('events', eventId).fields;
  assert.equal(ev.ticketStyle, 'auto', 'unknown style falls back to auto');
  assert.equal(ev.ticketColors.accent, '#dba63e', 'bad colours are ignored, the good ones kept');
  const pub = await (await worker.fetch(new Request(`https://api.test/api/events/${eventId}`), env)).json();
  assert.equal(pub.event.ticketStyle, 'auto'); assert.equal(pub.event.ticketColors.dark, '#1f180a');
});
