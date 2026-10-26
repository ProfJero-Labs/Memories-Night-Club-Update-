// Clearing tabs left open after a night is over: the director, finance or the administrator.
// Waiters see every open tab on their screen until it's closed, so a tab forgotten on a past night
// (or left from the trial nights) stays there for good otherwise.
//
// Only nights already over (business date before tonight's). For each open tab:
//   orders not handed over yet (waiting, being made, ready, or "taken" but not confirmed by the
//   bar) are cancelled: no drink left the bar, so stock is right as it is
//   orders handed over are marked delivered (their drinks left the bar's stock when handed)
//   the tab closes: as closed if nothing is owed, or as written off (with the reason) if something
//   is, so the night's accounts still show the unpaid amount
// Nothing is deleted: who cleared it, when and why are kept on the tab, and in the audit log.
import { queryWhere, commitTx, updateWrite } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, bizDate, isDate, ghs } from './common.js';
import { billOf } from './tabs.js';

export const TAB_CLEARERS = ['superAdmin', 'director', 'finance'];
const NOT_HANDED = ['waiting', 'preparing', 'ready', 'taken'];
const HANDED = ['handed', 'received'];

async function staleTabs(env, date) {
  const today = bizDate();
  const open = (await queryWhere(env, 'tabs', [{ field: 'status', value: 'open' }], { limit: 5000 }))
    .filter(t => String(t.fields.businessDate || '') < today && (!date || t.fields.businessDate === date));
  const out = [];
  for (const t of open) {
    const rounds = (await queryWhere(env, 'rounds', [{ field: 'tabId', value: t.id }])).map(r => ({ id: r.id, ...r.fields }));
    out.push({ t, rounds, bill: billOf(t.fields, rounds) });
  }
  return out;
}

// What's open from past nights, night by night.
export async function staleTabsView(env, user) {
  if (!requireRole(user, TAB_CLEARERS)) return FORBIDDEN;
  const nights = {};
  for (const { t, rounds, bill } of await staleTabs(env)) {
    const d = t.fields.businessDate || '';
    (nights[d] ||= []).push({ id: t.id, number: t.fields.number, table: t.fields.table || '', customerName: t.fields.customerName || '', waiterName: t.fields.waiterName || '',
      balancePesewas: bill.balancePesewas, paidPesewas: bill.paidPesewas, notHanded: rounds.filter(r => NOT_HANDED.includes(r.status)).length });
  }
  return { today: bizDate(), nights: Object.entries(nights).sort(([a], [b]) => b.localeCompare(a)).map(([date, tabs]) => ({ date, tabs: tabs.sort((a, b) => a.number - b.number), unpaidPesewas: tabs.reduce((n, t) => n + t.balancePesewas, 0) })) };
}

// { date, reason }: clears every tab still open from that night.
export async function clearTabs(env, b, user) {
  if (!requireRole(user, TAB_CLEARERS)) return { error: 'Only the director, finance or the administrator can clear tabs.', status: 403 };
  const date = String(b?.date || '');
  if (!isDate(date)) return { error: 'Pick the night.' };
  if (date >= bizDate()) return { error: 'Tonight isn’t over yet. Tabs can be cleared once the night has ended.' };
  const reason = clean(b?.reason, 200);
  if (!reason) return { error: 'Say why, e.g. “trial night” or “night finished, tabs left open”.' };
  const list = await staleTabs(env, date);
  if (!list.length) return { cleared: 0, message: 'No tabs are open from that night.' };
  const at = now(), byName = user.name || '', by = uidOf(user);
  const writes = [];
  let cancelled = 0, writtenOff = 0, unpaid = 0;
  for (const { t, rounds, bill } of list) {
    for (const r of rounds) {
      const { id: rid, ...f } = r;
      if (NOT_HANDED.includes(f.status)) { cancelled++; writes.push(updateWrite(env, 'rounds', rid, { ...f, status: 'cancelled', cancelledAt: at, cancelledByName: byName, cancelReason: `Tab cleared after the night: ${reason}` })); }
      else if (HANDED.includes(f.status)) writes.push(updateWrite(env, 'rounds', rid, { ...f, status: 'delivered', deliveredAt: f.deliveredAt || at, receivedAt: f.receivedAt || at }));
    }
    // Recount after cancelling: drinks never handed over aren't owed.
    const after = billOf(t.fields, rounds.map(r => (NOT_HANDED.includes(r.status) ? { ...r, status: 'cancelled' } : r)));
    const clearedBy = { clearedAt: at, clearedBy: by, clearedByName: byName, clearReason: reason, closedAt: at, closedByName: `${byName} (cleared after the night)` };
    if (after.balancePesewas > 0) { writtenOff++; unpaid += after.balancePesewas; writes.push(updateWrite(env, 'tabs', t.id, { ...t.fields, status: 'written_off', writtenOffAt: at, writtenOffByName: byName, writeOffReason: reason, ...clearedBy })); }
    else writes.push(updateWrite(env, 'tabs', t.id, { ...t.fields, status: 'closed', ...clearedBy }));
  }
  writes.push(updateWrite(env, 'audit_logs', id(), { action: 'TABS_CLEARED', actorUid: by, actorName: byName, businessDate: date, reason, tabIds: list.map(x => x.t.id), cancelledOrders: cancelled, writtenOff, unpaidPesewas: unpaid, timestamp: at }));
  for (let i = 0; i < writes.length; i += 400) await commitTx(env, writes.slice(i, i + 400));
  const n = list.length;
  return { cleared: n, writtenOff, unpaidPesewas: unpaid, message: `Cleared ${n} tab${n === 1 ? '' : 's'}.${writtenOff ? ` ${writtenOff} still owed ${ghs(unpaid)} and ${writtenOff === 1 ? 'was' : 'were'} written off with your reason.` : ''}${cancelled ? ` ${cancelled} order${cancelled === 1 ? '' : 's'} the bar never handed over ${cancelled === 1 ? 'was' : 'were'} cancelled.` : ''}` };
}
