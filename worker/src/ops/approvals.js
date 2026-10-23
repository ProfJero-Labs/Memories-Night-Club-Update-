// Things that need a second person: approvals/{id}
//   kind  comp (free drink on a tab) · discount (amount off a tab) · write_off (an unpaid tab is
//         closed as unpaid) · cash_out (a cash refund or payout) · count_correction (a submitted
//         stock count is corrected; the original stays)
//   status pending → approved | rejected; requestedBy/Name, decidedBy/Name, note
// Nobody approves their own request. The effect is applied only once approved.
import { getDoc, setDoc, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, uidOf, STOCK } from '../lib/auth.js';
import { FORBIDDEN, bizDate, who, audit, int, ghs } from './common.js';

const BOSS = ['superAdmin', 'director', 'manager'];
// Who may approve which kind.
// The Human manager is on the floor (free drinks, discounts); the Event manager can give discounts.
const APPROVERS = { comp: [...BOSS, 'hrManager'], discount: [...BOSS, 'hrManager', 'eventManager'], write_off: [...BOSS, 'finance'], cash_out: [...BOSS, 'finance'], count_correction: [...STOCK, 'barManager'] };
const REQUESTERS = { comp: [...BOSS, 'hrManager', 'waitStaff', 'barManager', 'barStaff'], discount: [...BOSS, 'hrManager', 'eventManager', 'waitStaff', 'cashier'], write_off: [...BOSS, 'waitStaff', 'cashier'], cash_out: [...BOSS, 'cashier', 'waitStaff', 'finance'], count_correction: [...STOCK, 'barManager', 'barStaff'] };
export const APPROVAL_LABEL = { comp: 'Free drink', discount: 'Discount', write_off: 'Unpaid tab written off', cash_out: 'Cash out', count_correction: 'Stock count correction' };

async function roundsOf(env, tabId) { return (await queryWhere(env, 'rounds', [{ field: 'tabId', value: tabId }])).map(r => ({ id: r.id, ...r.fields })); }

export async function requestApproval(env, b, user) {
  const kind = b?.kind;
  if (!APPROVAL_LABEL[kind]) return { error: 'Unknown request.' };
  if (!requireRole(user, REQUESTERS[kind])) return FORBIDDEN;
  const data = {}, reason = clean(b.reason, 200);
  if (!reason) return { error: 'Say why, in a few words.' };
  let summary = clean(b.summary, 200);
  if (kind === 'comp' || kind === 'discount' || kind === 'write_off') {
    const t = await getDoc(env, 'tabs', String(b.tabId || ''));
    if (!t) return { error: 'Tab not found.', status: 404 };
    data.tabId = t.id; data.tabNumber = t.fields.number;
    if (kind === 'comp') {
      const r = (await roundsOf(env, t.id)).find(x => x.id === b.roundId), line = r?.lines.find(l => l.lineId === b.lineId), qty = int(b.qty);
      if (!line) return { error: 'Pick the drink.' };
      if (!(qty >= 1 && qty <= line.qty)) return { error: `Up to ${line.qty}.` };
      Object.assign(data, { roundId: r.id, lineId: line.lineId, qty, productName: line.name, valuePesewas: qty * line.unitPesewas });
      summary = `${qty} × ${line.name} free on Tab ${t.fields.number}`;
    } else if (kind === 'discount') {
      const amount = int(b.amountPesewas); if (!(amount >= 100)) return { error: 'Enter the discount amount.' };
      data.amountPesewas = amount; summary = `${ghs(amount)} off Tab ${t.fields.number}`;
    } else summary = `Close Tab ${t.fields.number} as unpaid`;
  } else if (kind === 'cash_out') {
    Object.assign(data, { sessionId: String(b.sessionId), cashKind: b.cashKind, amountPesewas: int(b.amountPesewas) });
  } else if (kind === 'count_correction') {
    const docId = `${String(b.date)}__${String(b.stationId)}__closing`;
    if (!(await getDoc(env, 'stock_counts', docId))) return { error: 'There’s no closing count to correct.' };
    const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ productId: String(l.productId), counted: int(l.counted) })).filter(l => l.counted >= 0);
    if (!lines.length) return { error: 'Enter the corrected counts.' };
    Object.assign(data, { countId: docId, lines }); summary = `Correct ${lines.length} stock count${lines.length > 1 ? 's' : ''} (${String(b.date)})`;
  }
  const aid = id();
  await setDoc(env, 'approvals', aid, { kind, status: 'pending', data, summary, reason, businessDate: bizDate(), requestedBy: uidOf(user), requestedByName: user.name || '', requestedAt: now() });
  await audit(env, user, 'APPROVAL_REQUESTED', { approvalId: aid, kind, summary });
  return { requested: true, id: aid, message: 'Sent to the manager for approval.' };
}

export async function listApprovals(env, user, { status = 'pending' } = {}) {
  if (!requireRole(user, [...BOSS, 'finance', ...STOCK, 'hrManager', 'eventManager'])) return FORBIDDEN;
  const rows = (await queryWhere(env, 'approvals', [{ field: 'status', value: status === 'pending' ? 'pending' : status }])).map(a => ({ id: a.id, ...a.fields, label: APPROVAL_LABEL[a.fields.kind],
    canDecide: requireRole(user, APPROVERS[a.fields.kind]) && a.fields.requestedBy !== uidOf(user) }));
  return { approvals: rows.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).slice(0, 200) };
}

export async function decideApproval(env, b, user) {
  const a = await getDoc(env, 'approvals', String(b?.id || ''));
  if (!a) return { error: 'Request not found.', status: 404 };
  const f = a.fields;
  if (!requireRole(user, APPROVERS[f.kind])) return FORBIDDEN;
  if (f.requestedBy === uidOf(user)) return { error: 'Someone else must approve your own request.', status: 403 };
  if (f.status !== 'pending') return { error: 'Already decided.' };
  const approve = b.approve === true, note = clean(b.note, 200), at = now(), decided = { status: approve ? 'approved' : 'rejected', decidedBy: uidOf(user), decidedByName: user.name || '', decidedAt: at, decisionNote: note };
  if (!approve) { await setDoc(env, 'approvals', a.id, { ...f, ...decided }); await audit(env, user, 'APPROVAL_REJECTED', { approvalId: a.id, kind: f.kind }); return { decided: 'rejected' }; }
  const d = f.data, approvedByName = user.name || '';
  const r = await withTransaction(env, async tx => {
    const writes = [updateWrite(env, 'approvals', a.id, { ...f, ...decided })];
    if (f.kind === 'comp') {
      const rd = foundFields(await batchGet(env, [`rounds/${d.roundId}`], tx), `/rounds/${d.roundId}`); if (!rd) return { error: 'The order is gone.' };
      const lines = rd.fields.lines.map(l => (l.lineId === d.lineId ? { ...l, compQty: Math.min(l.qty, (l.compQty || 0) + d.qty), compApprovedByName: approvedByName } : l));
      writes.push(updateWrite(env, 'rounds', d.roundId, { ...rd.fields, lines }));
    } else if (f.kind === 'discount' || f.kind === 'write_off') {
      const t = foundFields(await batchGet(env, [`tabs/${d.tabId}`], tx), `/tabs/${d.tabId}`); if (!t) return { error: 'The tab is gone.' };
      if (f.kind === 'discount') writes.push(updateWrite(env, 'tabs', d.tabId, { ...t.fields, discounts: [...(t.fields.discounts || []), { amountPesewas: d.amountPesewas, reason: f.reason, approvedByName, at }] }));
      else writes.push(updateWrite(env, 'tabs', d.tabId, { ...t.fields, status: 'written_off', writtenOffAt: at, writtenOffByName: approvedByName, writeOffReason: f.reason }));
    } else if (f.kind === 'cash_out') {
      const s = foundFields(await batchGet(env, [`cash_sessions/${d.sessionId}`], tx), `/cash_sessions/${d.sessionId}`); if (!s) return { error: 'The cash shift is gone.' };
      if (s.fields.status !== 'open') return { error: 'That cash shift is already counted. Record it on tonight’s shift instead.' };
      writes.push(updateWrite(env, 'cash_sessions', d.sessionId, { ...s.fields, movements: [...(s.fields.movements || []), { kind: d.cashKind, amountPesewas: d.amountPesewas, reason: f.reason, at, byName: f.requestedByName, approvedByName }] }));
    } else if (f.kind === 'count_correction') {
      const c = foundFields(await batchGet(env, [`stock_counts/${d.countId}`], tx), `/stock_counts/${d.countId}`); if (!c) return { error: 'The count is gone.' };
      const fix = new Map(d.lines.map(l => [l.productId, l.counted]));
      const lines = c.fields.lines.map(l => (fix.has(l.productId) ? { ...l, counted: fix.get(l.productId), difference: fix.get(l.productId) - l.expected, correctedFrom: l.counted } : l));
      writes.push(updateWrite(env, 'stock_counts', d.countId, { ...c.fields, corrected: { lines, reason: f.reason, requestedByName: f.requestedByName, approvedByName, at } }));
    }
    await commitTx(env, writes, tx);
    return { decided: 'approved' };
  });
  if (!r.error) await audit(env, user, 'APPROVAL_APPROVED', { approvalId: a.id, kind: f.kind, summary: f.summary });
  return r;
}
