// Shared by the venue operations (tabs, bar, stock, cash, closing). A "business night" runs from
// the evening until 4AM the next morning and is named by its evening's date, e.g. 2026-10-16.
// Once a manager closes a night its records are locked: corrections go through an approval.
import { getDoc, setDoc } from '../lib/firestore.js';
import { now, id, nightKey } from '../lib/util.js';
import { uidOf } from '../lib/auth.js';

export const FORBIDDEN = { error: 'You can’t do that with your role.', status: 403 };
export const bizDate = (d = new Date()) => nightKey(d);
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export const dateOr = (s, d = bizDate()) => (isDate(s) ? s : d);
export const who = user => ({ by: uidOf(user), byName: user?.name || user?.email || '' });
export const ghs = p => `GHS ${(Number(p || 0) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}`;
export const int = v => (Number.isInteger(Number(v)) ? Number(v) : NaN);

export async function nightState(env, date) { return (await getDoc(env, 'shifts', date))?.fields || { status: 'open' }; }
export async function closedError(env, date) {
  return (await nightState(env, date)).status === 'closed' ? { error: `The night of ${date} is closed. Ask a manager to record a correction.`, status: 409 } : null;
}
export const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user) || null, actorName: user?.name || '', ...data, timestamp: now() });
// Every price, cost and stock-level change: who, when, the old value and the new value.
export const logChange = (env, user, { kind, refId, refName, field, from, to, note = '' }) =>
  setDoc(env, 'change_log', id(), { kind, refId, refName, field, from: from ?? null, to: to ?? null, note, ...who(user), at: now(), businessDate: bizDate() });
