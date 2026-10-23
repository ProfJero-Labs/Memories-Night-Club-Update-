// Cash shifts: cash_sessions/{date}__{uid}, one per person who takes cash that night.
//   floatPesewas (opening float), payments[] (cash taken, from tabs.recordCash), movements[]
//   ({kind: drop|float_in|refund|payout, amountPesewas, reason, byName, approvedByName}), status
//   open → submitted (counted) → reviewed. Refunds and payouts need a manager's approval first.
// Expected cash = float + cash taken + cash from waiters + float added − dropped − refunds − payouts.
// The chain: a waiter hands their cash to the bar (the bar person confirms what they got: it's added
// to the bar person's cash as from_waiter); the bar person hands it all to the Manager.
// The system never makes the count match: the difference stays, with the person's explanation.
import { getDoc, setDoc, queryWhere } from '../lib/firestore.js';
import { now, clean } from '../lib/util.js';
import { requireRole, uidOf, REPORTS } from '../lib/auth.js';
import { FORBIDDEN, bizDate, dateOr, audit, int, ghs } from './common.js';
import { canTakeCash, cashBag } from './tabs.js';
import { requestApproval } from './approvals.js';

export function cashFigures(s) {
  const sum = (arr, kind) => (arr || []).filter(m => !kind || m.kind === kind).reduce((n, m) => n + Number(m.amountPesewas || 0), 0);
  const taken = sum(s.payments) + sum(s.movements, 'from_waiter'), floatIn = sum(s.movements, 'float_in'), drops = sum(s.movements, 'drop'), refunds = sum(s.movements, 'refund'), payouts = sum(s.movements, 'payout');
  const expected = Number(s.floatPesewas || 0) + taken + floatIn - drops - refunds - payouts;
  return { floatPesewas: Number(s.floatPesewas || 0), takenPesewas: taken, paymentsCount: (s.payments || []).length, floatInPesewas: floatIn, dropsPesewas: drops, refundsPesewas: refunds, payoutsPesewas: payouts, expectedPesewas: expected,
    countedPesewas: s.countedPesewas ?? null, differencePesewas: s.countedPesewas == null ? null : s.countedPesewas - expected };
}
const view = (id, s) => ({ id, date: s.date, uid: s.uid, name: s.name, role: s.role, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt || null, explanation: s.explanation || '', reviewedByName: s.reviewedByName || '',
  receivedPesewas: s.receivedPesewas ?? null, receivedByName: s.receivedByName || '', receivedAt: s.receivedAt || '', receivedNote: s.receivedNote || '',
  movements: s.movements || [], payments: (s.payments || []).slice(-50), ...cashFigures(s) });

export async function openCash(env, b, user) {
  if (!(await canTakeCash(env, user))) return FORBIDDEN;
  const date = bizDate(), sid = `${date}__${uidOf(user)}`;
  if (await getDoc(env, 'cash_sessions', sid)) return { error: 'Your cash shift is already open.' };
  const float = b?.floatPesewas === '' || b?.floatPesewas == null ? 0 : int(b.floatPesewas);
  if (!(float >= 0)) return { error: 'Enter your starting cash (float), or 0.' };
  await setDoc(env, 'cash_sessions', sid, { date, uid: uidOf(user), name: user.name || '', role: user.role, floatPesewas: float, status: 'open', openedAt: now(), payments: [], movements: [] });
  await audit(env, user, 'CASH_SHIFT_OPENED', { sessionId: sid, floatPesewas: float });
  return { id: sid };
}

export async function myCash(env, user, { date } = {}) {
  if (!(await canTakeCash(env, user))) return FORBIDDEN;
  const sid = `${dateOr(date)}__${uidOf(user)}`, s = await getDoc(env, 'cash_sessions', sid);
  return { session: s ? view(s.id, s.fields) : null };
}

export async function cashMovement(env, b, user) {
  if (!(await canTakeCash(env, user))) return FORBIDDEN;
  const sid = `${bizDate()}__${uidOf(user)}`, s = await getDoc(env, 'cash_sessions', sid);
  if (!s || s.fields.status !== 'open') return { error: 'Open your cash shift first.' };
  const kind = b?.kind, amount = int(b?.amountPesewas), reason = clean(b?.reason, 200);
  if (!['drop', 'float_in', 'refund', 'payout'].includes(kind)) return { error: 'Pick what the cash is for.' };
  if (!(amount >= 100)) return { error: 'Enter the amount (at least GHS 1).' };
  if (!reason && kind !== 'drop') return { error: 'Say why, in a few words.' };
  if (kind === 'refund' || kind === 'payout') {
    // Cash leaving for a refund or a payout: a manager approves it first.
    return requestApproval(env, { kind: 'cash_out', sessionId: sid, cashKind: kind, amountPesewas: amount, reason, summary: `${kind === 'refund' ? 'Refund' : 'Pay out'} ${ghs(amount)} in cash: ${reason}` }, user);
  }
  await setDoc(env, 'cash_sessions', sid, { ...s.fields, movements: [...(s.fields.movements || []), { kind, amountPesewas: amount, reason, at: now(), byName: user.name || '' }] });
  await audit(env, user, kind === 'drop' ? 'CASH_DROPPED' : 'CASH_FLOAT_ADDED', { sessionId: sid, amountPesewas: amount });
  return { recorded: true };
}

export async function closeCash(env, b, user) {
  if (!(await canTakeCash(env, user))) return FORBIDDEN;
  const sid = `${dateOr(b?.date)}__${uidOf(user)}`, s = await getDoc(env, 'cash_sessions', sid);
  if (!s) return { error: 'You have no cash shift for that night.' };
  if (s.fields.status !== 'open') return { error: 'Your cash count is already in.' };
  const counted = int(b?.countedPesewas);
  if (!(counted >= 0)) return { error: 'Enter the cash you are holding now.' };
  const fig = cashFigures({ ...s.fields, countedPesewas: counted });
  const explanation = clean(b?.explanation, 400);
  if (fig.differencePesewas !== 0 && !explanation) return { error: `${ghs(Math.abs(fig.differencePesewas))} ${fig.differencePesewas < 0 ? 'less' : 'more'} than expected. Explain what happened.`, code: 'needs_explanation', differencePesewas: fig.differencePesewas };
  await setDoc(env, 'cash_sessions', sid, { ...s.fields, countedPesewas: counted, explanation, status: 'submitted', closedAt: now() });
  await audit(env, user, 'CASH_SHIFT_CLOSED', { sessionId: sid, countedPesewas: counted, differencePesewas: fig.differencePesewas });
  return { submitted: true, ...fig };
}

export async function cashSessions(env, user, { date } = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const d = dateOr(date);
  return { sessions: (await queryWhere(env, 'cash_sessions', [{ field: 'date', value: d }])).map(s => view(s.id, s.fields)).sort((a, b) => a.name.localeCompare(b.name)) };
}

// The cash goes to the Manager after the count: the Manager counts what was handed over and
// confirms it. A difference from what the person counted needs a note, and stays on record.
export const CASH_RECEIVERS = ['superAdmin', 'director', 'manager'];
// The bar person is the custodian of the drinks: waiters hand their cash to the bar.
const FROM_WAITERS = ['waitStaff', 'eventManager'];
export async function receiveCash(env, b, user) {
  const s = await getDoc(env, 'cash_sessions', String(b?.id || ''));
  if (!s) return { error: 'Cash shift not found.', status: 404 };
  // The bar takes waiters' cash; the bar manager takes the waiters' and the bartenders'.
  const asBar = ['barStaff', 'barManager'].includes(user.role);
  const fromWho = user.role === 'barManager' ? [...FROM_WAITERS, 'barStaff'] : FROM_WAITERS;
  if (asBar ? !fromWho.includes(s.fields.role) : !requireRole(user, CASH_RECEIVERS)) return { error: asBar ? 'The bar receives cash from waiters; the Manager receives the rest.' : 'The Manager receives the cash.', status: 403 };
  if (s.fields.uid === uidOf(user)) return { error: 'Someone else must receive your own cash.' };
  if (s.fields.status === 'open') return { error: `${s.fields.name} hasn’t counted their cash yet.` };
  if (s.fields.receivedAt) return { error: `Already received by ${s.fields.receivedByName}.` };
  const got = int(b?.receivedPesewas);
  if (!(got >= 0)) return { error: 'Enter the cash you received.' };
  const note = clean(b?.note, 300), counted = Number(s.fields.countedPesewas || 0);
  if (got !== counted && !note) return { error: `${s.fields.name} counted ${ghs(counted)}; you have ${ghs(got)}. Say what happened.`, code: 'needs_note' };
  // At the bar: the waiter's cash joins the bar person's own, which they hand to the Manager.
  if (asBar) {
    const bag = await cashBag(env, user, s.fields.date); if (bag.error) return { error: `${bag.error} Ask the Manager to take this cash instead.` };
    const mine = await getDoc(env, 'cash_sessions', bag.sid);
    await setDoc(env, 'cash_sessions', bag.sid, { ...mine.fields, movements: [...(mine.fields.movements || []), { kind: 'from_waiter', amountPesewas: got, fromUid: s.fields.uid, fromName: s.fields.name, sessionId: s.id, at: now(), byName: user.name || '' }] });
  }
  await setDoc(env, 'cash_sessions', s.id, { ...s.fields, receivedPesewas: got, receivedBy: uidOf(user), receivedByName: user.name || '', receivedByRole: user.role, receivedAt: now(), receivedNote: note });
  await audit(env, user, 'CASH_RECEIVED', { sessionId: s.id, countedPesewas: counted, receivedPesewas: got, by: asBar ? 'bar' : 'manager' });
  return { received: true, differencePesewas: got - counted };
}

// The bar's list: waiters who have counted their cash and are handing it to the bar.
export async function waiterCash(env, user, { date } = {}) {
  if (!requireRole(user, ['barStaff', 'barManager', ...CASH_RECEIVERS])) return FORBIDDEN;
  const from = user.role === 'barManager' ? [...FROM_WAITERS, 'barStaff'] : FROM_WAITERS;
  const all = (await queryWhere(env, 'cash_sessions', [{ field: 'date', value: dateOr(date) }])).filter(x => from.includes(x.fields.role) && x.fields.uid !== uidOf(user));
  return { waiting: all.filter(x => x.fields.status !== 'open' && !x.fields.receivedAt).map(x => view(x.id, x.fields)), stillWith: all.filter(x => x.fields.status === 'open' && cashFigures(x.fields).expectedPesewas).map(x => view(x.id, x.fields)),
    received: all.filter(x => x.fields.receivedAt).map(x => view(x.id, x.fields)) };
}

export async function reviewCash(env, b, user) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const s = await getDoc(env, 'cash_sessions', String(b?.id || ''));
  if (!s) return { error: 'Cash shift not found.', status: 404 };
  if (s.fields.uid === uidOf(user)) return { error: 'Someone else must review your own cash.' };
  if (s.fields.status !== 'submitted') return { error: 'The count isn’t in yet.' };
  await setDoc(env, 'cash_sessions', s.id, { ...s.fields, status: 'reviewed', reviewedBy: uidOf(user), reviewedByName: user.name || '', reviewedAt: now(), reviewNote: clean(b.note, 300) });
  await audit(env, user, 'CASH_SHIFT_REVIEWED', { sessionId: s.id });
  return { reviewed: true };
}
