// Reviews: what customers say about the club, and the monthly performance review of each staff member.
//
//   reviews/{id}        a customer's review (no sign-in): rating 1–5, comment, name?, phone?, source
//                       bill|qr|table|site, night, status new → handled (by the Manager or the Human
//                       manager, with a note). A low rating (1–2) is flagged as a complaint.
//                       The directors read them all; the Manager and the Human manager follow up.
//   perf_reviews/{YYYY-MM}__{uid}  scores (1–5 each), comment, byName, at; the staff member reads it
//                       on My page and can reply. The Human manager writes them; directors read them.
import { getDoc, setDoc, queryRecent, queryWhere, listDocs } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, nightKey } from '../lib/util.js';
import { requireRole, uidOf, STAFF_ROLES, CUSTOMER_CARE } from '../lib/auth.js';
import { ROLE_NAMES } from '../staffauth.js';
import { FORBIDDEN, bizDate, audit, int } from './common.js';

const SOURCES = { bill: 'After paying a table bill', qr: 'After a QR order', table: 'Table card', site: 'Website' };
const HANDLERS = ['superAdmin', 'manager', 'hrManager'];
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const avg = arr => (arr.length ? Math.round(sum(arr, r => r.rating) / arr.length * 10) / 10 : null);

// ── Customer reviews ──
export async function leaveReview(env, b) {
  const rating = int(b?.rating);
  if (!(rating >= 1 && rating <= 5)) return { error: 'Tap a star rating from 1 to 5.' };
  const comment = clean(b?.comment, 1000), phone = b?.phone ? normalizePhone(b.phone) : '';
  if (b?.phone && !phone) return { error: 'That phone number doesn’t look right, or leave it blank.' };
  const rid = id();
  await setDoc(env, 'reviews', rid, { rating, comment, name: clean(b?.name, 60), phone, source: SOURCES[b?.source] ? b.source : 'site', ref: clean(b?.ref, 64), night: bizDate(), at: now(), status: 'new', complaint: rating <= 2 });
  return { thanks: true };
}

export async function listReviews(env, user, { days = 30 } = {}) {
  if (!requireRole(user, CUSTOMER_CARE)) return FORBIDDEN;
  const d = Math.min(365, Math.max(1, int(days) || 30));
  const rows = (await queryRecent(env, 'reviews', 'at', new Date(Date.now() - d * 864e5), 1000)).map(x => ({ id: x.id, ...x.fields }));
  const byNight = new Map();
  for (const r of rows) { const n = byNight.get(r.night) || { night: r.night, count: 0, total: 0 }; n.count += 1; n.total += r.rating; byNight.set(r.night, n); }
  return {
    days: d, count: rows.length, average: avg(rows), tonight: avg(rows.filter(r => r.night === bizDate())),
    stars: [5, 4, 3, 2, 1].map(s => ({ stars: s, count: rows.filter(r => r.rating === s).length })),
    open: rows.filter(r => r.status === 'new' && r.complaint).length,
    byNight: [...byNight.values()].map(n => ({ night: n.night, count: n.count, average: Math.round(n.total / n.count * 10) / 10 })).sort((a, b) => b.night.localeCompare(a.night)).slice(0, 14),
    reviews: rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200).map(r => ({ id: r.id, rating: r.rating, comment: r.comment, name: r.name, phone: r.phone, source: SOURCES[r.source], at: r.at, night: r.night, complaint: r.complaint, status: r.status, handledByName: r.handledByName || '', handledNote: r.handledNote || '' })),
    canHandle: !!requireRole(user, HANDLERS),
  };
}

export async function handleReview(env, b, user) {
  if (!requireRole(user, HANDLERS)) return { error: 'The Manager or the Human manager follows up reviews.', status: 403 };
  const r = await getDoc(env, 'reviews', String(b?.id || '')); if (!r) return { error: 'Review not found.', status: 404 };
  const note = clean(b?.note, 500); if (!note) return { error: 'Say what was done, e.g. “Called her, offered a free table next Friday”.' };
  await setDoc(env, 'reviews', r.id, { ...r.fields, status: 'handled', handledBy: uidOf(user), handledByName: user.name || '', handledAt: now(), handledNote: note });
  await audit(env, user, 'REVIEW_HANDLED', { reviewId: r.id });
  return { handled: true };
}

// ── Staff performance reviews (monthly) ──
export const PERF_SCORES = { punctual: 'On time and present', attitude: 'Attitude and teamwork', customers: 'Care for customers', work: 'Quality of work', rules: 'Follows the rules' };
const PERF_HR = ['superAdmin', 'hrManager'], PERF_SEE = ['superAdmin', 'director', 'hrManager'];
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const monthLabel = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const perfView = (d, f) => ({ id: d, uid: f.uid, name: f.name, roleName: ROLE_NAMES[f.role] || '', month: f.month, label: monthLabel(f.month), scores: Object.entries(PERF_SCORES).map(([k, label]) => ({ key: k, label, score: f.scores?.[k] || 0 })),
  overall: f.overall, comment: f.comment || '', byName: f.byName, at: f.at, reply: f.reply || '', repliedAt: f.repliedAt || '' });

export async function perfReviews(env, user, { month } = {}) {
  if (!requireRole(user, PERF_SEE)) return FORBIDDEN;
  const m = isMonth(month) ? month : bizDate().slice(0, 7);
  const [users, done] = await Promise.all([listDocs(env, 'users'), queryWhere(env, 'perf_reviews', [{ field: 'month', value: m }])]);
  const byUid = Object.fromEntries(done.map(d => [d.fields.uid, perfView(d.id, d.fields)]));
  const staff = users.filter(u => !u.fields.removed && STAFF_ROLES.includes(u.fields.role) && !['organiser', 'superAdmin', 'director'].includes(u.fields.role) && u.fields.admin !== true)
    .map(u => ({ uid: u.id, name: u.fields.name || '', roleName: ROLE_NAMES[u.fields.role] || '', review: byUid[u.id] || null })).sort((a, b) => a.name.localeCompare(b.name));
  return { month: m, label: monthLabel(m), scores: PERF_SCORES, staff, done: staff.filter(s => s.review).length, canWrite: !!requireRole(user, PERF_HR) };
}

export async function writePerf(env, b, user) {
  if (!requireRole(user, PERF_HR)) return { error: 'The Human manager writes performance reviews.', status: 403 };
  const m = isMonth(b?.month) ? b.month : bizDate().slice(0, 7), u = await getDoc(env, 'users', String(b?.uid || ''));
  if (!u || u.fields.removed) return { error: 'Staff member not found.', status: 404 };
  if (u.id === uidOf(user)) return { error: 'A director reviews you, not yourself.' };
  const scores = {};
  for (const k of Object.keys(PERF_SCORES)) { const s = int(b?.scores?.[k]); if (!(s >= 1 && s <= 5)) return { error: `Score “${PERF_SCORES[k]}” from 1 to 5.` }; scores[k] = s; }
  const overall = Math.round(sum(Object.values(scores), x => x) / Object.keys(scores).length * 10) / 10;
  const docId = `${m}__${u.id}`, old = (await getDoc(env, 'perf_reviews', docId))?.fields || {};
  await setDoc(env, 'perf_reviews', docId, { ...old, uid: u.id, name: u.fields.name || '', role: u.fields.role, month: m, scores, overall, comment: clean(b?.comment, 1000), by: uidOf(user), byName: user.name || '', at: now() });
  await audit(env, user, 'PERF_REVIEW_WRITTEN', { targetUid: u.id, month: m, overall });
  return { saved: true, overall };
}

export async function myPerf(env, user) {
  if (!user || !STAFF_ROLES.includes(user.role)) return FORBIDDEN;
  const rows = await queryWhere(env, 'perf_reviews', [{ field: 'uid', value: uidOf(user) }]);
  return { reviews: rows.map(d => perfView(d.id, d.fields)).sort((a, b) => b.month.localeCompare(a.month)) };
}
export async function replyPerf(env, b, user) {
  const d = await getDoc(env, 'perf_reviews', String(b?.id || ''));
  if (!d || d.fields.uid !== uidOf(user)) return { error: 'Review not found.', status: 404 };
  const reply = clean(b?.reply, 1000); if (!reply) return { error: 'Write your reply.' };
  await setDoc(env, 'perf_reviews', d.id, { ...d.fields, reply, repliedAt: now() });
  return { saved: true };
}
export { nightKey };
