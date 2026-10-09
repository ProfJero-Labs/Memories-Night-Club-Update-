export function cors(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allow = origin && allowed.includes(origin) ? origin : (allowed[0] || '');
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Checkout-Claim', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Vary': 'Origin' };
}
export const json = (req, env, data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req, env), ...extra } });
export const ok = (req, env, data = {}) => json(req, env, { success: true, ...data });
export const fail = (req, env, message, status = 400) => json(req, env, { success: false, error: message }, status);
// Route helper: a handler returns {error,status} or a payload.
export const reply = (req, env, r) => (r && r.error ? fail(req, env, r.error, r.status || 400) : ok(req, env, r));
export const allowedOrigin = (url, env) => {
  try { return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).includes(new URL(url).origin); } catch { return false; }
};

// ── Abuse protection ──
// Primary: Cloudflare's Workers Rate Limiting binding (see wrangler.toml, RL_STRICT / RL_STANDARD),
// which is counted at Cloudflare's edge per key. Fallback when the binding isn't configured (local
// dev, tests): a per-isolate sliding window, which only slows down a single noisy client.
const buckets = new Map();
const LIMITS = { strict: { binding: 'RL_STRICT', limit: 10 }, standard: { binding: 'RL_STANDARD', limit: 60 } };
function rateLimitedKey(k, limit, windowMs) {
  const t = Date.now();
  const fresh = (buckets.get(k) || []).filter(x => t - x < windowMs);
  if (fresh.length >= limit) { buckets.set(k, fresh); return true; }
  fresh.push(t); buckets.set(k, fresh);
  if (buckets.size > 5000) buckets.clear();
  return false;
}
export function rateLimited(req, key, limit, windowMs) {
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
  const k = `${key}:${ip}`, t = Date.now();
  const fresh = (buckets.get(k) || []).filter(x => t - x < windowMs);
  if (fresh.length >= limit) { buckets.set(k, fresh); return true; }
  fresh.push(t); buckets.set(k, fresh);
  if (buckets.size > 5000) buckets.clear();
  return false;
}
// Limits per client IP by default; pass `subject` to limit per something else too (a phone
// number, an order code), so rotating IPs doesn't help against one target.
export async function throttled(req, env, key, tier = 'standard', subject) {
  const { binding, limit } = LIMITS[tier];
  const who = subject ?? (req.headers.get('CF-Connecting-IP') || 'unknown');
  if (env[binding]?.limit) {
    try { const { success } = await env[binding].limit({ key: `${key}:${who}` }); return !success; } catch { /* fall through */ }
  }
  return subject === undefined ? rateLimited(req, key, limit, 60000) : rateLimitedKey(`${key}:${who}`, limit, 60000);
}
