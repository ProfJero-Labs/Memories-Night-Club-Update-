// The trial nights, cleared once: the nights before the first official night (24 October 2026) were
// practice. The super admin sees what would go first, then confirms.
// Chosen by night, not by role, so practice tabs opened by a manager, the event manager or the bar
// (quick sales) go too, and so do those of staff since removed, whatever their record says now.
//   gone   every tab from those nights and its orders (rounds), approvals on those tabs, and tips
//          on those tabs (kept in cash or paid out). For waiters and waitresses also: their cash
//          shifts, their night reports, their own requests, their other tips (kept or paid out) and
//          their tip payouts from those nights
//   kept   tabs a customer still owes, unless the admin ticks them as practice (debts can be real
//          money), tabs with a Paystack payment still in progress, tips still owed to someone (the
//          club holds that money), every stock move (the drinks left the bar: recount instead),
//          the payment ledger, other staff's cash shifts and reports, and the audit log
// Deletes can't be undone: export Firestore before running it.
import { listDocs, getDoc, commitTx, deleteWrite } from '../lib/firestore.js';
import { requireRole, ADMIN } from '../lib/auth.js';
import { FORBIDDEN, audit, ghs } from './common.js';

export const OFFICIAL_START = '2026-10-24';
const before = d => !!d && String(d).slice(0, 10) < OFFICIAL_START;
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);
const WAITER = 'waitStaff';

// clearOwed: ids of practice tabs closed as "owed" that the admin ticked to clear too.
async function plan(env, clearOwed = []) {
  const [tabs, rounds, approvals, cash, reports, tips, payouts, users] = await Promise.all(
    ['tabs', 'rounds', 'approvals', 'cash_sessions', 'staff_reports', 'tips', 'tip_payouts', 'users'].map(c => listDocs(env, c)));
  const pick = new Set(Array.isArray(clearOwed) ? clearOwed.map(String) : []);
  const gone = { tabs: [], rounds: [], approvals: [], cash_sessions: [], staff_reports: [], tips: [], tip_payouts: [] };
  const kept = { owedTabs: [], payingTabs: 0, owedTips: [] };
  const tabIds = new Set();
  for (const t of tabs.filter(t => before(t.fields.businessDate))) {
    if (t.fields.status === 'owed' && !pick.has(t.id)) { kept.owedTabs.push(t); continue; }
    const ref = t.fields.pending?.reference;
    if (ref && (await getDoc(env, 'pending_checkouts', ref))?.fields?.status === 'pending') { kept.payingTabs++; continue; }
    gone.tabs.push(t.id); tabIds.add(t.id);
  }
  // Waiters and waitresses: by their record now, and by what their old records say they were
  // (someone removed or moved to another role since still counts for the practice nights).
  const waiters = new Set(users.filter(u => u.fields.role === WAITER).map(u => u.id));
  for (const s of cash) if (s.fields.role === WAITER && before(s.fields.date)) waiters.add(s.fields.uid);
  for (const r of reports) if (r.fields.kind === 'waiter' && before(r.fields.date)) waiters.add(r.fields.uid);
  waiters.delete(undefined);

  gone.rounds = rounds.filter(r => tabIds.has(r.fields.tabId)).map(r => r.id);
  gone.approvals = approvals.filter(a => tabIds.has(a.fields.data?.tabId)
    || (before(a.fields.businessDate) && waiters.has(a.fields.requestedBy) && !a.fields.data?.tabId)).map(a => a.id);
  gone.cash_sessions = cash.filter(s => before(s.fields.date) && waiters.has(s.fields.uid)).map(s => s.id);
  gone.staff_reports = reports.filter(r => r.fields.kind === 'waiter' && before(r.fields.date)).map(r => r.id);
  const oldTips = tips.filter(x => (x.fields.tabId && tabIds.has(x.fields.tabId)) || (before(x.fields.businessDate) && waiters.has(x.fields.toUid)));
  gone.tips = oldTips.filter(x => x.fields.status !== 'owed').map(x => x.id);
  kept.owedTips = oldTips.filter(x => x.fields.status === 'owed');
  gone.tip_payouts = payouts.filter(p => before(p.fields.at) && waiters.has(p.fields.toUid)).map(p => p.id);

  const counts = Object.fromEntries(Object.entries(gone).map(([k, v]) => [k, v.length]));
  const owed = kept.owedTabs.map(t => ({ id: t.id, number: t.fields.number, date: t.fields.businessDate, customerName: t.fields.debt?.name || t.fields.customerName || '', waiterName: t.fields.waiterName || '', amountPesewas: Number(t.fields.debt?.amountPesewas || 0) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.number - b.number);
  return { gone, counts, waiters: waiters.size, owed, kept: { owedTabs: owed.length, owedTabsPesewas: sum(owed, o => o.amountPesewas), payingTabs: kept.payingTabs, owedTips: kept.owedTips.length, owedTipsPesewas: sum(kept.owedTips, x => x.fields.amountPesewas) } };
}

export async function trialResetPreview(env, user) {
  if (!requireRole(user, ADMIN)) return FORBIDDEN;
  const p = await plan(env);
  return { before: OFFICIAL_START, waiters: p.waiters, counts: p.counts, kept: p.kept, owed: p.owed };
}

export async function trialReset(env, b, user) {
  if (!requireRole(user, ADMIN)) return FORBIDDEN;
  if (b?.confirm !== 'RESET') return { error: 'Confirm the reset first.' };
  const p = await plan(env, b?.clearOwed);
  const clearedOwed = Array.isArray(b?.clearOwed) ? b.clearOwed.filter(x => p.gone.tabs.includes(String(x))).length : 0;
  const writes = Object.entries(p.gone).flatMap(([col, ids]) => ids.map(docId => deleteWrite(env, col, docId)));
  for (let i = 0; i < writes.length; i += 400) await commitTx(env, writes.slice(i, i + 400));
  await audit(env, user, 'WAITER_TRIAL_RESET', { before: OFFICIAL_START, ...p.counts, clearedOwedTabs: clearedOwed, keptOwedTabs: p.kept.owedTabs, keptPayingTabs: p.kept.payingTabs, keptOwedTips: p.kept.owedTips });
  const t = p.counts.tabs;
  return { done: true, before: OFFICIAL_START, counts: p.counts, kept: p.kept, message: `Cleared ${t} trial tab${t === 1 ? '' : 's'}.${p.kept.owedTabs ? ` ${p.kept.owedTabs} unpaid tab${p.kept.owedTabs === 1 ? '' : 's'} a customer owes (${ghs(p.kept.owedTabsPesewas)}) were kept.` : ''}${p.kept.owedTips ? ` ${p.kept.owedTips} tip${p.kept.owedTips === 1 ? '' : 's'} still owed to staff (${ghs(p.kept.owedTipsPesewas)}) were kept.` : ''} Recount the bar’s stock before the next night.` };
}
