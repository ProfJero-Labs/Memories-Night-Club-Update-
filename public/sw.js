// Memories Pass service worker. Its one job: the member pass (member.html) opens with no signal.
// Only the files the pass needs are cached; everything else on the site, and every API call, goes
// to the network untouched. Bump VERSION when any file in SHELL changes.
const VERSION = 'memories-pass-v1';
const SHELL = ['/member.html', '/pages/member.js', '/app.js', '/lib/shared.js', '/lib/report.js', '/ticket-art.js', '/vendor/qrcode.min.js',
  '/styles.css', '/config.js', '/manifest.webmanifest', '/assets/logo-sm.webp', '/assets/icon-192.png'];
const PASS_PAGES = ['/member', '/member.html'];

// Cloudflare Pages redirects /member.html → /member; a redirected response can't answer a page
// load from cache, so store a clean copy.
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
  // The pass page: the network first (it may have changed), the saved copy when offline.
  if (req.mode === 'navigate' && PASS_PAGES.includes(url.pathname)) {
    e.respondWith(fetch(req).then(async r => { if (r.ok) (await caches.open(VERSION)).put('/member.html', await clean(r.clone())); return r; })
      .catch(async () => (await caches.match('/member.html')) || Response.error()));
    return;
  }
  // The pass's own files: the saved copy at once, refreshed in the background.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(url.pathname);
      const fresh = fetch(req).then(async r => { if (r.ok) await c.put(url.pathname, await clean(r.clone())); return r; }).catch(() => hit);
      return hit || fresh;
    }));
  }
});
