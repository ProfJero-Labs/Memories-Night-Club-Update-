// Reports unexpected browser errors on the public pages to the Worker, which forwards them to Sentry.
// First party only: no third-party script is loaded, so the Content-Security-Policy does not change.
//
// Deliberately quiet. Guests on slow or dropped connections are normal here, so network failures,
// errors from browser extensions and errors the API helper already handles are never reported.
// Only the path is sent, never the query string: ticket and order links carry secrets in it.
const CFG = window.MEMORIES_CONFIG || {};
const MAX_PER_PAGE_LOAD = 3;
const NOISE = /^script error\.?$|resizeobserver loop|failed to fetch|load failed|networkerror|network request failed|the operation was aborted|aborterror/i;

let sent = 0;
const seen = new Set();

function send(kind, message, source, line, col) {
  if (!CFG.apiBase || sent >= MAX_PER_PAGE_LOAD) return;
  const msg = String(message || '').slice(0, 300);
  if (!msg || NOISE.test(msg) || seen.has(kind + msg)) return;
  seen.add(kind + msg);
  sent++;
  const body = JSON.stringify({
    kind, message: msg, line: line || 0, col: col || 0,
    source: String(source || '').replace(location.origin, '').split('?')[0].slice(0, 120),
    page: location.pathname.slice(0, 80),
  });
  try { fetch(`${CFG.apiBase}/api/client-error`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); } catch { /* reporting must never break a page */ }
}

addEventListener('error', e => {
  if (e.filename && !String(e.filename).startsWith(location.origin)) return; // extensions, ad scripts
  send('error', e.message, e.filename, e.lineno, e.colno);
});

addEventListener('unhandledrejection', e => {
  const r = e.reason;
  if (r && typeof r.status === 'number') return; // ApiError: already shown to the guest, and 5xx are reported by the Worker
  send('rejection', r && r.message ? r.message : String(r));
});
