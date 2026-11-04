// What's due to EvolveIT: the charges collected in the partner's wallet (big bills by MoMo, and
// bills paid to the wallet while Paystack was down). The directors only: nobody else sees it.
// (On Paystack payments EvolveIT's part never leaves EvolveIT's account, so nothing is due there.)
//
// The partner pays EvolveIT himself. A director may tick it off when he does ("Paid to EvolveIT":
// the amount and the MoMo transaction ID): the oldest rows it covers become settled, and a payment
// that doesn't match whole rows is flagged with the difference. Rows unsettled for more than 10 days
// are highlighted.
//   evolveit_charges/{id}      (ops/wallet.js) businessDate, amountPesewas, status unsettled | settled
//   evolveit_settlements/{id}  amountPesewas, momoRef, rowIds, coveredPesewas, differencePesewas
import { queryRecent, listDocs, commitTx, updateWrite, queryWhere } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, int, ghs } from './common.js';

export const EVOLVEIT_VIEWERS = ['superAdmin', 'director'];
const DAY = 864e5, sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);
const ageDays = d => Math.floor((Date.now() - new Date(`${d}T12:00:00Z`).getTime()) / DAY);

export async function evolveitDue(env, user) {
  if (!requireRole(user, EVOLVEIT_VIEWERS)) return FORBIDDEN;
  const [rows, setts] = await Promise.all([listDocs(env, 'evolveit_charges'), queryRecent(env, 'evolveit_settlements', 'at', new Date(Date.now() - 365 * DAY), 200)]);
  const all = rows.map(d => ({ id: d.id, ...d.fields }));
  const days = new Map();
  for (const r of all) {
    const d = days.get(r.businessDate) || { date: r.businessDate, owedPesewas: 0, settledPesewas: 0, payments: 0 };
    d.owedPesewas += Number(r.amountPesewas || 0); d.payments += 1; if (r.status === 'settled') d.settledPesewas += Number(r.amountPesewas || 0);
    days.set(r.businessDate, d);
  }
  const byDay = [...days.values()].map(d => ({ ...d, outstandingPesewas: d.owedPesewas - d.settledPesewas, ageDays: ageDays(d.date) }))
    .map(d => ({ ...d, overdue: d.outstandingPesewas > 0 && d.ageDays > 10 })).sort((a, b) => b.date.localeCompare(a.date));
  const open = all.filter(r => r.status !== 'settled');
  return {
    totals: { owedPesewas: sum(all, r => r.amountPesewas), settledPesewas: sum(all.filter(r => r.status === 'settled'), r => r.amountPesewas), outstandingPesewas: sum(open, r => r.amountPesewas),
      overduePesewas: sum(open.filter(r => ageDays(r.businessDate) > 10), r => r.amountPesewas), oldestUnsettled: open.map(r => r.businessDate).sort()[0] || null },
    byDay, settlements: setts.map(s => ({ id: s.id, ...s.fields })).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    canRecord: !!requireRole(user, EVOLVEIT_VIEWERS),
  };
}

// The partner paid EvolveIT: { amountPesewas, momoRef, note }. Covers the oldest unsettled rows.
export async function recordEvolveitPayment(env, b, user) {
  if (!requireRole(user, EVOLVEIT_VIEWERS)) return { error: 'Only a director records this.', status: 403 };
  const amount = int(b?.amountPesewas);
  if (!(amount >= 100)) return { error: 'Type the amount paid to EvolveIT.' };
  const ref = String(b?.momoRef || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 40);
  if (ref.length < 6) return { error: 'Type the MoMo transaction ID of the payment.' };
  if ((await queryWhere(env, 'evolveit_settlements', [{ field: 'momoRef', value: ref }], { limit: 1 }))[0]) return { error: 'That transaction ID is already recorded.' };
  const open = (await queryWhere(env, 'evolveit_charges', [{ field: 'status', value: 'unsettled' }], { limit: 5000 })).map(d => ({ id: d.id, ...d.fields }))
    .sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!open.length) return { error: 'Nothing is due to EvolveIT right now.' };
  const covered = [];
  let left = amount;
  for (const r of open) { if (Number(r.amountPesewas) > left) break; covered.push(r); left -= Number(r.amountPesewas); }
  const coveredPesewas = amount - left, sid = id(), at = now();
  const writes = covered.map(r => { const { id: rid, ...f } = r; return updateWrite(env, 'evolveit_charges', rid, { ...f, status: 'settled', settlementId: sid, settledAt: at }); });
  writes.push(updateWrite(env, 'evolveit_settlements', sid, { amountPesewas: amount, momoRef: ref, note: clean(b?.note, 200), rowIds: covered.map(r => r.id), rows: covered.length, coveredPesewas,
    differencePesewas: left, from: covered[0]?.businessDate || '', to: covered.at(-1)?.businessDate || '', by: uidOf(user), byName: user.name || '', at }));
  writes.push(updateWrite(env, 'audit_logs', id(), { action: 'EVOLVEIT_PAYMENT_RECORDED', actorUid: uidOf(user), actorName: user.name || '', amountPesewas: amount, momoRef: ref, rows: covered.length, differencePesewas: left, timestamp: at }));
  for (let i = 0; i < writes.length; i += 400) await commitTx(env, writes.slice(i, i + 400));
  return { recorded: true, rows: covered.length, coveredPesewas, differencePesewas: left,
    message: left ? `Recorded. It covers ${covered.length} charge${covered.length === 1 ? '' : 's'} (${ghs(coveredPesewas)}); ${ghs(left)} doesn’t match whole charges and is flagged.` : `Recorded. ${covered.length} charge${covered.length === 1 ? '' : 's'} settled.` };
}
