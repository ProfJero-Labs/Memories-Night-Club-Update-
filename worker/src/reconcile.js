// Payment reconciliation and health check. Runs on a Cloudflare cron every 10 minutes.
//
// What it protects against: a guest pays on Paystack but never gets a ticket, because the webhook
// was missed, the Worker was briefly down, or they closed the browser before the return page ran.
//
// What it does, in order:
//   1. RECOVER. Finds checkouts still marked `pending` after a few minutes and runs the normal
//      fulfill() on them. fulfill() asks Paystack directly whether the charge succeeded and is
//      idempotent per reference, so this can never charge or issue twice. It only completes what
//      the guest already paid for.
//   2. CROSS-CHECK. Lists recent successful Paystack payments and confirms each has an issued
//      ticket/table/top-up. Anything paid but not issued (sold out after payment, amount mismatch,
//      missing record) cannot be fixed safely by a machine, so it texts a human instead.
//   3. HEARTBEAT. Pings an external monitor when the run finishes. If this job ever stops running,
//      the monitor notices the silence and calls you. That covers the job itself failing.
//
// It never refunds, never edits prices, never touches an order that is already issued.

import { googleAccessToken, parseFields, firestoreValue, getDoc, setDoc } from './lib/firestore.js';
import { fulfill } from './checkout.js';
import { alertOnce, reportError } from './lib/monitor.js';
import { logError } from './lib/log.js';

// ── Tuning knobs ──
const WINDOW_MS = 72 * 3600_000;          // how far back to look at checkouts
const SETTLE_MS = 3 * 60_000;             // give the webhook and return page 3 minutes first
const FRESH_MS = 2 * 3600_000;            // younger than this: retried on every run
const MAX_FULFIL_PER_RUN = 40;            // keeps one run well inside Worker limits
const PAYSTACK_LOOKBACK_MS = 6 * 3600_000; // how far back to list Paystack payments
const PAYSTACK_PAGES = 5;                 // up to 500 payments per run
const REF_PREFIX = 'MEM-';                // references this system creates (see paymentRef)

const ageOf = f => { const t = Date.parse(f.createdAt); return Number.isFinite(t) ? Date.now() - t : 0; };

// Firestore range query on createdAt. A single-field range needs no composite index.
async function recentCheckouts(env, sinceMs) {
  const token = await googleAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = { structuredQuery: {
    from: [{ collectionId: 'pending_checkouts' }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(new Date(sinceMs)) } },
    limit: 1000,
  } };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d)) throw new Error(`Firestore query failed (${r.status})`);
  return d.filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), fields: parseFields(x.document.fields) }));
}

async function paystackSuccesses(env, sinceMs) {
  const out = [];
  for (let page = 1; page <= PAYSTACK_PAGES; page++) {
    const qs = new URLSearchParams({ status: 'success', perPage: '100', page: String(page), from: new Date(sinceMs).toISOString() });
    const r = await fetch(`https://api.paystack.co/transaction?${qs}`, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.status || !Array.isArray(d.data)) throw new Error(`Paystack list failed (${r.status})`);
    out.push(...d.data);
    if (d.data.length < 100) break;
  }
  return out;
}

const short = ref => String(ref).slice(-10);

export { alertOnce };
export async function reconcilePayments(env, scheduledTime = Date.now()) {
  const summary = { ok: true, checked: 0, recovered: 0, alerts: 0, errors: 0 };
  try {
    const sinceMs = Date.now() - WINDOW_MS;

    // 1. RECOVER paid-but-unfulfilled checkouts.
    const hourlyPass = new Date(scheduledTime).getUTCMinutes() < 10; // older ones only once an hour
    const first = await recentCheckouts(env, sinceMs);
    const latest = new Map(first.map(d => [d.id, d.fields]));   // read once per run; updated below as orders are fixed
    const due = first
      .filter(d => d.fields.status === 'pending')
      .filter(d => { const a = ageOf(d.fields); return a >= SETTLE_MS && (a < FRESH_MS || hourlyPass); })
      .sort((a, b) => ageOf(a.fields) - ageOf(b.fields))   // newest first: guests most likely still waiting
      .slice(0, MAX_FULFIL_PER_RUN);
    for (const d of due) {
      summary.checked++;
      try {
        const res = await fulfill(env, d.id);
        if (res && res.status === 'failed') { const fresh = await getDoc(env, 'pending_checkouts', d.id); if (fresh) latest.set(d.id, fresh.fields); }
        if (res && res.status === 'issued') {
          summary.recovered++;
          latest.set(d.id, { ...d.fields, status: 'issued' });
          if (await alertOnce(env, `recovered_${d.id}`, `MEMORIES: a paid order (${short(d.id)}) had no ticket. It was fixed automatically and the guest was texted.`)) summary.alerts++;
        }
      } catch (e) { summary.errors++; logError('reconcile fulfil failed', short(d.id), e); await reportError(env, 'reconcile.fulfil', e); }
    }

    // 2. CROSS-CHECK Paystack against Firestore, using the same read plus what step 1 changed.
    const paid = await paystackSuccesses(env, Date.now() - PAYSTACK_LOOKBACK_MS);
    for (const tx of paid) {
      const ref = tx.reference;
      if (!ref || !String(ref).startsWith(REF_PREFIX)) continue;
      const f = latest.has(ref) ? latest.get(ref) : (await getDoc(env, 'pending_checkouts', ref))?.fields;
      let problem = null;
      if (!f) problem = 'paid_no_record';
      else if (f.status === 'failed') problem = `paid_failed_${f.error || 'unknown'}`;
      else if (f.status === 'pending' && ageOf(f) >= SETTLE_MS) problem = 'paid_not_issued';
      if (problem && await alertOnce(env, `${problem}_${ref}`, `MEMORIES ACTION NEEDED: a guest paid GHS ${(Number(tx.amount) / 100).toFixed(2)} (ref ${short(ref)}) and did not get what they bought. Reason: ${problem.replace(/_/g, ' ')}. Check Admin > Payments.`)) summary.alerts++;
    }

    // 3. HEARTBEAT: only after a clean run, so silence means something is wrong.
    if (env.HEARTBEAT_URL) await fetch(env.HEARTBEAT_URL).catch(e => logError('heartbeat failed', e));
  } catch (e) {
    summary.ok = false; summary.errors++;
    logError('reconcilePayments failed', e);
    await reportError(env, 'reconcile.run', e);
    // One "the checker itself is broken" text per hour at most.
    await alertOnce(env, `run_failed_${Math.floor(Date.now() / 3600_000)}`, 'MEMORIES: the automatic payment check could not run. Payments still work, but nobody is watching them. Check Cloudflare logs.').catch(() => {});
  }
  // What the control room's System panel shows: when the last check ran and how it went.
  await setDoc(env, 'system', 'reconcile', { ...summary, at: new Date() }).catch(e => logError('reconcile status write failed', e));
  return summary;
}

// ── Health endpoint for the uptime monitor ──
// GET /api/health                      -> {ok:true}, proves the Worker is up (no secrets, no cost)
// GET /api/health + x-health-key: KEY  -> also proves Firestore and Paystack are reachable
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function health(req, env) {
  if (!env.HEALTH_KEY || req.headers.get('x-health-key') !== env.HEALTH_KEY) return json({ ok: true });
  const probe = async fn => { try { await fn(); return true; } catch { return false; } };
  const checks = {
    firestore: await probe(() => getDoc(env, 'settings', 'site')),
    paystack: await probe(async () => { const r = await fetch('https://api.paystack.co/transaction?perPage=1', { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } }); if (!r.ok) throw new Error(String(r.status)); }),
  };
  const ok = Object.values(checks).every(Boolean);
  return json({ ok, checks }, ok ? 200 : 503);
}
