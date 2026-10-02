// Local, offline run of the whole product: the static site in public/ plus the real Worker
// (worker/src/index.js) on the same origin, backed by an in-memory Firestore, a fake Paystack
// checkout page, and dev-signed Firebase ID tokens. Nothing here ships; it exists so every
// journey can be clicked through (and screenshotted) in a real browser without live credentials.
//
//   node dev/server.mjs            → http://localhost:8787
//   PORT=9000 SEED=empty node dev/server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockEnv, idToken } from '../worker/test/mock-firestore.js';
import worker from '../worker/src/index.js';
import { seed } from './seed.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, '..', 'public');
const PORT = Number(process.env.PORT || 8787);
const ORIGIN = `http://localhost:${PORT}`;

const { store, env } = createMockEnv();
Object.assign(env, { PUBLIC_SITE_URL: ORIGIN, ALLOWED_ORIGINS: ORIGIN, DEV_ALLOW_HTTP_ASSETS: '1' });
store.authUsers = [];
const uploads = new Map();
const checkouts = new Map(); // reference → {amount, callback_url}

// Paystack's initialize call: send the browser to our fake checkout page instead.
const mockFetch = store.fetch;
globalThis.fetch = store.fetch = async (url, options = {}) => {
  const u = new URL(url);
  if (u.hostname === 'api.paystack.co' && u.pathname === '/transaction/initialize') {
    const b = JSON.parse(options.body);
    checkouts.set(b.reference, { amount: b.amount, callback: b.callback_url });
    return new Response(JSON.stringify({ status: true, data: { authorization_url: `${ORIGIN}/dev/paystack?reference=${encodeURIComponent(b.reference)}` } }), { headers: { 'Content-Type': 'application/json' } });
  }
  return mockFetch(url, options);
};

if (process.env.SEED !== 'empty') seed(store, ORIGIN);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// Apply production's Content-Security-Policy (public/_headers) to pages, so tests catch violations.
const csp = (await readFile(path.join(pub, '_headers'), 'utf8')).match(/Content-Security-Policy: (.+)/)[1].replace("connect-src 'self'", "connect-src 'self' http://localhost:*");
const send = (res, status, body, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(type.startsWith('text/html') ? { 'Content-Security-Policy': csp } : {}) }); res.end(body); };
const readBody = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

const paystackPage = (ref, amount) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Paystack (test)</title>
<body style="font-family:system-ui;background:#f4f5f7;display:grid;place-items:center;min-height:100vh;margin:0">
<form method=post style="background:#fff;padding:28px;border-radius:10px;box-shadow:0 2px 12px #0002;width:min(340px,90vw)">
<p style="margin:0 0 4px;color:#555">Local test checkout</p><h2 style="margin:0 0 18px">GHS ${(amount / 100).toFixed(2)}</h2>
<input type=hidden name=reference value="${ref}">
<button name=outcome value=success style="width:100%;padding:14px;background:#0ba4db;color:#fff;border:0;border-radius:6px;font-size:16px">Pay</button>
<button name=outcome value=failed style="width:100%;padding:12px;margin-top:8px;background:none;border:1px solid #ccc;border-radius:6px">Decline</button></form>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, ORIGIN);
  try {
    if (u.pathname.startsWith('/api/')) {
      const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : await readBody(req);
      const r = await worker.fetch(new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, body }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    // Fake Paystack: approve/decline, fire the signed webhook like Paystack does, then redirect.
    if (u.pathname === '/dev/paystack') {
      const ref = u.searchParams.get('reference'), c = checkouts.get(ref);
      if (!c) return send(res, 404, 'unknown reference');
      if (req.method === 'GET') return send(res, 200, paystackPage(ref, c.amount));
      const form = new URLSearchParams((await readBody(req)).toString());
      const ok = form.get('outcome') === 'success';
      store.setPaystack(ref, { status: ok ? 'success' : 'failed', currency: 'GHS', amount: c.amount });
      if (ok) {
        const raw = JSON.stringify({ event: 'charge.success', data: { reference: ref } });
        const sig = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
        await worker.fetch(new Request(`${ORIGIN}/api/paystack/webhook`, { method: 'POST', headers: { 'x-paystack-signature': sig }, body: raw }), env);
      }
      res.writeHead(302, { Location: `${c.callback}${c.callback.includes('?') ? '&' : '?'}reference=${encodeURIComponent(ref)}&trxref=${encodeURIComponent(ref)}` }); res.end(); return;
    }
    // Dev sign-in: issues a real signed token the Worker verifies (see mock JWKS).
    if (u.pathname === '/dev/token' && req.method === 'POST') {
      const { email, password } = JSON.parse((await readBody(req)).toString() || '{}');
      const user = store.authUsers.find(x => x.email === String(email).toLowerCase());
      if (!user || password !== 'memories-dev') return send(res, 400, JSON.stringify({ code: 'auth/invalid-credential' }), 'application/json');
      const claims = store.claims?.[user.localId] || {};
      return send(res, 200, JSON.stringify({ uid: user.localId, email: user.email, claims, token: await idToken(claims, { projectId: env.FIREBASE_PROJECT_ID, uid: user.localId }) }), 'application/json');
    }
    if (u.pathname === '/dev/upload' && req.method === 'POST') {
      const key = `u${uploads.size + 1}`; uploads.set(key, { type: req.headers['content-type'], body: await readBody(req) });
      return send(res, 200, JSON.stringify({ url: `${ORIGIN}/dev/uploads/${key}` }), 'application/json');
    }
    if (u.pathname.startsWith('/dev/uploads/')) { const f = uploads.get(u.pathname.split('/').pop()); return f ? send(res, 200, f.body, f.type) : send(res, 404, ''); }
    if (u.pathname === '/dev/state') return send(res, 200, JSON.stringify({ sms: store.sms, emails: store.emails, docs: Object.fromEntries(store.docs) }), 'application/json');
    if (u.pathname.startsWith('/dev/fixtures/')) { const f = path.join(root, 'fixtures', path.basename(u.pathname)); return send(res, 200, await readFile(f), types[path.extname(f)]); }

    // Static site. config.js and firebase.js are swapped for local versions.
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    if (p === '/config.js') return send(res, 200, `window.MEMORIES_CONFIG={apiBase:'',firebase:{projectId:'${env.FIREBASE_PROJECT_ID}'}};`, 'text/javascript');
    if (p === '/firebase.js') return send(res, 200, await readFile(path.join(root, 'firebase-dev.js')), 'text/javascript');
    const file = path.join(pub, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(pub)) return send(res, 403, 'no');
    const ext = path.extname(file) || '.html';
    const data = await readFile(path.extname(file) ? file : file + '.html');
    send(res, 200, data, types[ext] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, '<h1>404</h1>');
    console.error(e); send(res, 500, 'dev server error');
  }
}).listen(PORT, () => console.log(`Memories dev → ${ORIGIN}   (staff logins: see dev/seed.mjs, password memories-dev)`));

export { store, env };
