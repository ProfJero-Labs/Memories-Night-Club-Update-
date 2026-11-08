// Shared by the venue operations (tabs, bar, stock, cash, closing). A "business night" is named by
// the date it started, e.g. 2026-10-16. The club has no fixed closing time: a night stays open
// until the Manager (or a director) closes it, however late that is. Everything recorded while it's
// open belongs to it. Once it's closed, the next thing recorded starts a new night, named by that
// day's date.
//   config/night  { date, startedAt, after }: the night that's open now (see loadNight)
import { envKey, onResetCaches } from '../lib/envkey.js';
import { getDoc, setDoc } from '../lib/firestore.js';
import { now, id, nightKey, accraDayKey } from '../lib/util.js';
import { uidOf } from '../lib/auth.js';

export const FORBIDDEN = { error: 'You can’t do that with your role.', status: 403 };
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// The night that's open now. Read once per request (index.js calls loadNight first), so bizDate()
// can stay a plain call everywhere. Before the first stored night (or if it can't be read), the old
// rule names it: a moment before 4AM belongs to the evening before.
const NIGHT_TTL = 30e3;
let current = null; // { date, at, key }
onResetCaches(() => { current = null; });
export async function loadNight(env, { fresh = false } = {}) {
  if (!fresh && current && current.key === envKey(env) && Date.now() - current.at < NIGHT_TTL / 3) return current.date;
  let date;
  try {
    const cfg = (await getDoc(env, 'config', 'night'))?.fields;
    date = isDate(cfg?.date) ? cfg.date : null;
    if (!date) {
      date = nightKey(new Date());
      await setDoc(env, 'config', 'night', { date, startedAt: now() });
    } else if ((await nightState(env, date)).status === 'closed') {
      // Closed: the next night starts, named by today's date (if today's is the one closed, it stays).
      const next = accraDayKey(new Date());
      if (next > date) { await setDoc(env, 'config', 'night', { date: next, startedAt: now(), after: date }); date = next; }
    }
  } catch { date = current?.date || nightKey(new Date()); }
  current = { date, at: Date.now(), key: envKey(env) };
  return date;
}
// The night a payment belongs to: the night that was open when it was paid (stored on it), or for
// older records the clock rule.
export const paidNight = o => o?.businessDate || (o?.paidAt ? nightKey(o.paidAt) : '');
// A moment that just happened belongs to the open night; an old one (a late check) to its own.
export const nightAt = at => (Date.now() - new Date(at).getTime() < 2 * 3600e3 ? bizDate() : nightKey(at));
// With a moment: the old clock rule (for times before nights were stored). Without: the open night.
export const bizDate = d => (d ? nightKey(d) : current && Date.now() - current.at < NIGHT_TTL ? current.date : nightKey(new Date()));
export const dateOr = (s, d = bizDate()) => (isDate(s) ? s : d);
export const who = user => ({ by: uidOf(user), byName: user?.name || user?.email || '' });
export const ghs = p => `GHS ${(Number(p || 0) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}`;
export const int = v => (Number.isInteger(Number(v)) ? Number(v) : NaN);

export async function nightState(env, date) { return (await getDoc(env, 'shifts', date))?.fields || { status: 'open' }; }
// Closing a night is for the accounts only (the end-of-day report for finance): it never stops
// staff selling, paying or counting. A night can be closed at any time, and closed again later to
// bring the report up to date. Kept as a hook so callers stay unchanged.
export async function closedError() { return null; }
export const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user) || null, actorName: user?.name || '', ...data, timestamp: now() });
// Every price, cost and stock-level change: who, when, the old value and the new value.
export const logChange = (env, user, { kind, refId, refName, field, from, to, note = '' }) =>
  setDoc(env, 'change_log', id(), { kind, refId, refName, field, from: from ?? null, to: to ?? null, note, ...who(user), at: now(), businessDate: bizDate() });
