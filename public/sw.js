// Memories app service worker. Two jobs, nothing more:
//   1. The member pass (member.html) opens with no signal: its files are kept on the phone.
//   2. Any other page that can't load offline shows a branded "you're offline" page instead of
//      the browser's error.
// API calls and everything else go straight to the network, untouched. Paths are relative to
// wherever the site is served from. Bump VERSION when any file in SHELL changes.
const VERSION = 'memories-app-v3';
const at = p => new URL(p, self.registration.scope).pathname;
const SHELL = ['member.html', 'offline.html', 'pages/member.js', 'app.js', 'lib/shared.js', 'lib/report.js', 'lib/install.js', 'ticket-art.js',
  'vendor/qrcode.min.js', 'styles.css', 'config.js', 'manifest.webmanifest', 'assets/logo-sm.webp', 'assets/icon-192.png'].map(at);
const PASS = [at('member'), at('member.html')];

// Cloudflare Pages redirects x.html → x; a redirected response can't answer a page load, so keep a clean copy.
const clean = async res => (res.redirected ? new Response(await res.blob(), { status: res.status, headers: res.headers }) : res);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    for (const url of SHELL) { try { const r = await fetch(url, { cache: 'reload' }); if (r.ok) await c.put(url, await clean(r)); } catch { /* next install retries */ } }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    const isPass = PASS.includes(url.pathname);
    e.respondWith(fetch(req).then(async r => { if (isPass && r.ok) (await caches.open(VERSION)).put(at('member.html'), await clean(r.clone())); return r; })
      .catch(async () => (await caches.match(isPass ? at('member.html') : at('offline.html'))) || Response.error()));
    return;
  }
  // The pass's files: always the network first (so an update shows at once), the saved copy offline.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(c => fetch(req)
      .then(async r => { if (r.ok) await c.put(url.pathname, await clean(r.clone())); return r; })
      .catch(async () => (await c.match(url.pathname)) || Response.error())));
  }
});
