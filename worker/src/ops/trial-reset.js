// The waiters' trial nights, cleared once: the nights before the first official night (24 October
// 2026) were practice. The super admin sees what would go first, then confirms.
// Waiters and waitresses only (role waitStaff, including those since removed), nights before the
// cutoff only:
//   gone   their tabs and those tabs' rounds, approvals on those tabs (and their own requests),
//          their cash shifts, their night reports, tips they kept or were paid, and tip payouts
//   kept   tabs a customer still owes (debts are real money), tabs with a Paystack payment still
//          in progress, tips still owed to them (the club holds that money), every stock move (the
//          drinks left the bar), the payment ledger, other staff, and the audit log
import { queryWhere, getDoc, commitTx, deleteWrite } from '../lib/firestore.js';
import { requireRole, ADMIN } from '../lib/auth.js';
import { FORBIDDEN, audit, ghs } from './common.js';

export const OFFICIAL_START = '2026-10-24';
const before = d => !!d && String(d).slice(0, 10) < OFFICIAL_START;
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);

async function plan(env) {
  const waiters = await queryWhere(env, 'users', [{ field: 'role', value: 'waitStaff' }]);
  const gone = { tabs: [], rounds: [], approvals: [], cash_sessions: [], staff_reports: [], tips: [], tip_payouts: [] };
  const kept = { owedTabs: 0, payingTabs: 0, owedTips: [] };
  const tabIds = new Set();
  for (const w of waiters) {
    const uid = w.id;
    const [tabs, rounds, approvals, cash, reports, tips, payouts] = await Promise.all([
      queryWhere(env, 'tabs', [{ field: 'waiterUid', value: uid }]),
      queryWhere(env, 'rounds', [{ field: 'waiterUid', value: uid }]),
      queryWhere(env, 'approvals', [{ field: 'requestedBy', value: uid }]),
      queryWhere(env, 'cash_sessions', [{ field: 'uid', value: uid }]),
      queryWhere(env, 'staff_reports', [{ field: 'uid', value: uid }]),
      queryWhere(env, 'tips', [{ field: 'toUid', value: uid }]),
      queryWhere(env, 'tip_payouts', [{ field: 'toUid', value: uid }]),
    ]);
    for (const t of tabs.filter(t => before(t.fields.businessDate))) {
      if (t.fields.status === 'owed') { kept.owedTabs++; continue; }
      const ref = t.fields.pending?.reference;
      if (ref && (await getDoc(env, 'pending_checkouts', ref))?.fields?.status === 'pending') { kept.payingTabs++; continue; }
      gone.tabs.push(t.id); tabIds.add(t.id);
    }
    gone.rounds.push(...rounds.filter(r => tabIds.has(r.fields.tabId)).map(r => r.id));
    gone.approvals.push(...approvals.filter(a => before(a.fields.businessDate) && (!a.fields.data?.tabId || tabIds.has(a.fields.data.tabId))).map(a => a.id));
    gone.cash_sessions.push(...cash.filter(s => before(s.fields.date)).map(s => s.id));
    gone.staff_reports.push(...reports.filter(r => r.fields.kind === 'waiter' && before(r.fields.date)).map(r => r.id));
    const oldTips = tips.filter(x => before(x.fields.businessDate));
    gone.tips.push(...oldTips.filter(x => x.fields.status !== 'owed').map(x => x.id));
    kept.owedTips.push(...oldTips.filter(x => x.fields.status === 'owed'));
    gone.tip_payouts.push(...payouts.filter(p => before(p.fields.at)).map(p => p.id));
  }
  // A manager's pending discount or write-off on one of those tabs would have nothing to apply to.
  const pending = await queryWhere(env, 'approvals', [{ field: 'status', value: 'pending' }]);
  for (const a of pending) if (tabIds.has(a.fields.data?.tabId) && !gone.approvals.includes(a.id)) gone.approvals.push(a.id);
  const counts = Object.fromEntries(Object.entries(gone).map(([k, v]) => [k, v.length]));
  return { gone, counts, waiters: waiters.length, kept: { owedTabs: kept.owedTabs, payingTabs: kept.payingTabs, owedTips: kept.owedTips.length, owedTipsPesewas: sum(kept.owedTips, x => x.fields.amountPesewas) } };
}

export async function trialResetPreview(env, user) {
  if (!requireRole(user, ADMIN)) return FORBIDDEN;
  const p = await plan(env);
  return { before: OFFICIAL_START, waiters: p.waiters, counts: p.counts, kept: p.kept };
}

export async function trialReset(env, b, user) {
  if (!requireRole(user, ADMIN)) return FORBIDDEN;
  if (b?.confirm !== 'RESET') return { error: 'Confirm the reset first.' };
  const p = await plan(env);
  const writes = Object.entries(p.gone).flatMap(([col, ids]) => ids.map(docId => deleteWrite(env, col, docId)));
  for (let i = 0; i < writes.length; i += 400) await commitTx(env, writes.slice(i, i + 400));
  await audit(env, user, 'WAITER_TRIAL_RESET', { before: OFFICIAL_START, ...p.counts, keptOwedTabs: p.kept.owedTabs, keptPayingTabs: p.kept.payingTabs, keptOwedTips: p.kept.owedTips });
  return { done: true, before: OFFICIAL_START, counts: p.counts, kept: p.kept, message: `Cleared ${p.counts.tabs} trial tab${p.counts.tabs === 1 ? '' : 's'}.${p.kept.owedTips ? ` ${p.kept.owedTips} tip${p.kept.owedTips === 1 ? '' : 's'} still owed to them (${ghs(p.kept.owedTipsPesewas)}) were kept.` : ''}` };
}
