// Error reporting and alerting. Two channels, on purpose:
//   Sentry  every unexpected error, with the stack trace, so a fix can be found fast.
//   SMS     only failures on a payment path, straight from the Worker, so a human hears within
//           seconds even if Sentry, email or the Sentry app is not being watched at 1am.
//
// Nothing here may ever break a request: every function swallows its own failures.
import * as Sentry from '@sentry/cloudflare';
import { redact, logError } from './log.js';
import { createDoc } from './firestore.js';
import { sendSms, sendEmail } from './notify.js';

// ── Privacy ──
// A ticket's document id is its bearer token, and Firestore/Paystack errors can quote paths,
// phone numbers and keys. Nothing may leave for a third party without passing through here.
export function scrubEvent(event) {
  delete event.request;           // URLs carry ticket tokens; headers carry auth
  delete event.user;
  delete event.extra;
  event.breadcrumbs = [];         // outgoing fetch breadcrumbs include Firestore document paths
  if (event.tags) delete event.tags.url;
  if (event.message) event.message = redact(event.message);
  if (event.logentry?.message) event.logentry.message = redact(event.logentry.message);
  for (const v of event.exception?.values || []) if (v.value) v.value = redact(v.value);
  if (event.transaction) event.transaction = redact(event.transaction).replace(/\/[A-Za-z0-9_-]{20,}/g, '/[id]');
  return event;
}

// Sentry is a no-op until SENTRY_DSN is set, so this ships safely before the account exists.
export const sentryOptions = env => ({
  dsn: env.SENTRY_DSN,
  environment: env.SENTRY_ENVIRONMENT || 'production',
  release: env.CF_VERSION_METADATA?.id,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
  beforeBreadcrumb: () => null,
});

// ── Alerts to people ──
async function notifyPeople(env, text) {
  const phones = String(env.ALERT_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  await Promise.all([
    ...phones.map(p => sendSms(env, p, text)),
    env.ALERT_EMAIL ? sendEmail(env, env.ALERT_EMAIL, 'Memories alert', [text]) : null,
  ].filter(Boolean));
}

// Each problem is alerted once: the `recon_alerts` document id is the dedupe key and createDoc
// fails with 409 if it exists. If the dedupe write fails for another reason, send anyway: a
// duplicate text is better than a missed one.
export async function alertOnce(env, key, text) {
  try { await createDoc(env, 'recon_alerts', key, { key, text, at: new Date() }); }
  catch (e) { if (e && e.status === 409) return false; logError('alert dedupe failed', e); }
  await notifyPeople(env, text);
  return true;
}

// ── Error reporting ──
// The route group (/api/checkout) is used instead of the full path so an id in the URL never
// reaches an alert, a tag or a transaction name.
export const routeGroup = path => String(path).split('/').slice(0, 3).join('/') || '/';
export const isCritical = path => /^\/api\/(checkout|table-checkout|installments|paystack)(\/|$)/.test(path);

const lastText = new Map();           // per-isolate floor, so an outage cannot become a flood of texts
const TEXT_EVERY_MS = 15 * 60_000;

export async function reportError(env, where, err, { critical = false } = {}) {
  try { Sentry.withScope(scope => { scope.setTag('where', where); scope.setTag('critical', String(critical)); Sentry.captureException(err); }); }
  catch (e) { logError('sentry capture failed', e); }
  if (!critical) return false;
  const now = Date.now();
  if (now - (lastText.get(where) || 0) < TEXT_EVERY_MS) return false;
  lastText.set(where, now);
  if (lastText.size > 200) lastText.clear();
  const bucket = Math.floor(now / TEXT_EVERY_MS);
  const hhmm = new Date(now).toISOString().slice(11, 16);
  try {
    return await alertOnce(env, `err_${where.replace(/[^A-Za-z0-9]+/g, '_')}_${bucket}`,
      `MEMORIES ALERT ${hhmm}: ${where} is failing. Guests may be unable to pay or get tickets. Details in Sentry.`);
  } catch (e) { logError('critical alert failed', e); return false; }
}

export const reportMessage = (where, text, level = 'warning') => {
  try { Sentry.withScope(scope => { scope.setTag('where', where); Sentry.captureMessage(redact(text), level); }); } catch { /* never break a request */ }
};

// ── Errors from guests' browsers (public/lib/report.js) ──
// Same-origin only, tiny, rate limited by the caller, and never texts anyone. Query strings are
// not accepted at all: ticket and order links carry secrets in them.
const clip = (v, n) => String(v ?? '').slice(0, n);
export async function clientError(req, env, allowed) {
  if (!allowed(req.headers.get('Origin') || '', env)) return {};
  let raw = ''; try { raw = await req.text(); } catch { return {}; }
  if (!raw || raw.length > 2000) return {};
  let b; try { b = JSON.parse(raw); } catch { return {}; }
  const message = redact(clip(b.message, 300)), page = clip(b.page, 80).split('?')[0].split('#')[0];
  if (!message) return {};
  try {
    Sentry.withScope(scope => {
      scope.setTag('where', 'browser'); scope.setTag('page', page); scope.setTag('kind', b.kind === 'rejection' ? 'rejection' : 'error');
      scope.setTag('source', `${clip(b.source, 100).split('?')[0]}:${Number(b.line) || 0}:${Number(b.col) || 0}`);
      scope.setFingerprint(['browser', page, message]);
      Sentry.captureMessage(`Browser error on ${page}: ${message}`, 'error');
    });
  } catch (e) { logError('client error capture failed', e); }
  return {};
}

// ── Security signals ──
// Things that look like someone probing the system rather than a guest having a bad night. Each
// kind alerts the team at most once an hour (alertOnce), and goes to Sentry as a warning. Counting
// is per Worker isolate, so thresholds are conservative floors, not exact global counts. Texts never
// carry the IP, a phone number or a token.
const SIGNALS = {
  webhook_forged: { threshold: 1, text: n => `MEMORIES SECURITY: a payment notice with a bad signature reached the API (${n} in 10 min). It was ignored and nothing was issued. If it repeats, someone is trying to fake payments.` },
  staff_denied: { threshold: 15, text: n => `MEMORIES SECURITY: ${n} refused staff requests from one address in 10 minutes. Someone may be guessing sign-ins or probing the control room.` },
  member_code_guessing: { threshold: 10, text: n => `MEMORIES SECURITY: ${n} wrong member gate codes from one address in 10 minutes. Someone may be guessing codes at the door.` },
  rate_limited: { threshold: 60, text: n => `MEMORIES SECURITY: one address hit the rate limits ${n} times in 10 minutes. Possible scraping or a scripted attack.` },
};
const hits = new Map();
const WINDOW = 10 * 60_000;
export function countHit(key, now = Date.now()) {
  const fresh = (hits.get(key) || []).filter(t => now - t < WINDOW);
  fresh.push(now); hits.set(key, fresh);
  if (hits.size > 5000) hits.clear();
  return fresh.length;
}
export async function securitySignal(env, kind, who = 'all') {
  const s = SIGNALS[kind]; if (!s) return false;
  const n = countHit(`${kind}:${who}`);
  if (n !== s.threshold) return false;   // alert when the threshold is crossed, not on every hit after
  const text = s.text(n);
  reportMessage(`security.${kind}`, text, 'warning');
  try { return await alertOnce(env, `sec_${kind}_${Math.floor(Date.now() / 3600_000)}`, text); }
  catch (e) { logError('security alert failed', e); return false; }
}
