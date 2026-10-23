// Reports and the end of the night.
//   My report (each waiter) · Today's sales (manager, finance) · front office report
//   The guided close: waiters submit → bar counts → cashier counts → front office → manager
//   reviews and closes → the end-of-day report goes to finance → finance signs off.
//   staff_reports/{date}__{uid}   a submitted report: the figures as they were, plus explanations
//   eod_reports/{date}            the end-of-day report: preparedBy, sent (true/false, never assumed),
//                                 approvals (manager, finance), versions (corrections keep the original)
//   shifts/{date}                 status open | closed (closed nights are locked; see common.js)
import { getDoc, setDoc, queryWhere, listDocs } from '../lib/firestore.js';
import { now, id, clean, nightKey, normalizePhone } from '../lib/util.js';
import { requireRole, uidOf, REPORTS } from '../lib/auth.js';
import { sendEmail, sendSms, siteUrl } from '../lib/notify.js';
import { FORBIDDEN, bizDate, dateOr, audit, nightState, ghs } from './common.js';
import { billOf } from './tabs.js';
import { cashFigures } from './cash.js';
import { stockSheet } from './stock.js';
import { tipsOn, tipTotals } from './tips.js';

const BOSS = ['superAdmin', 'director', 'manager'];
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const lineValue = l => Number(l.qty) * Number(l.unitPesewas);

async function nightData(env, date) {
  const [tabs, rounds, cash, counts, approvals, reports, stations] = await Promise.all([
    queryWhere(env, 'tabs', [{ field: 'businessDate', value: date }]), queryWhere(env, 'rounds', [{ field: 'businessDate', value: date }]),
    queryWhere(env, 'cash_sessions', [{ field: 'date', value: date }]), queryWhere(env, 'stock_counts', [{ field: 'date', value: date }]),
    queryWhere(env, 'approvals', [{ field: 'status', value: 'pending' }]), queryWhere(env, 'staff_reports', [{ field: 'date', value: date }]), listDocs(env, 'bar_stations'),
  ]);
  const R = rounds.map(r => ({ id: r.id, ...r.fields }));
  // Older tabs still open (paid tonight, or rounds added) belong to the night they were opened.
  const T = tabs.map(t => ({ id: t.id, ...t.fields, rounds: R.filter(r => r.tabId === t.id) }));
  for (const t of T) t.bill = billOf(t, t.rounds);
  // QR self-orders paid tonight.
  const qr = (await queryWhere(env, 'counter_orders', [{ field: 'status', value: 'paid' }])).concat(await queryWhere(env, 'counter_orders', [{ field: 'status', value: 'delivered' }]))
    .concat(await queryWhere(env, 'counter_orders', [{ field: 'status', value: 'refund_due' }])).concat(await queryWhere(env, 'counter_orders', [{ field: 'status', value: 'refunded' }]))
    .map(o => ({ id: o.id, ...o.fields })).filter(o => o.paidAt && nightKey(o.paidAt) === date);
  const tips = (await tipsOn(env, date)).filter(x => x.status !== 'cancelled');
  return { tips, tabs: T, rounds: R, cash: cash.map(c => ({ id: c.id, ...c.fields })), counts: counts.map(c => ({ id: c.id, ...c.fields })), approvals: approvals.map(a => ({ id: a.id, ...a.fields })), reports: reports.map(r => ({ id: r.id, ...r.fields })), stations: stations.map(s => ({ id: s.id, name: s.fields.name })), qr };
}

// ── A waiter's own figures ──
export function waiterFigures(uid, data) {
  const rounds = data.rounds.filter(r => r.waiterUid === uid && r.status !== 'cancelled');
  const handed = rounds.filter(r => ['handed', 'received', 'delivered'].includes(r.status));
  const lines = rs => rs.flatMap(r => r.lines);
  const qty = (ls, k) => sum(ls, l => (k ? l[k] : l.qty)), val = (ls, k) => sum(ls, l => (k ? l[k] : l.qty) * l.unitPesewas);
  const recv = lines(handed);
  const deliveredRounds = handed.filter(r => r.status === 'delivered');
  const deliveredLines = lines(deliveredRounds).map(l => ({ ...l, qty: l.qty - (l.returnedQty || 0) - (l.brokenQty || 0) - (l.returnPending || 0) }));
  const withYouLines = lines(handed.filter(r => r.status !== 'delivered')).map(l => ({ ...l, qty: l.qty - (l.returnedQty || 0) - (l.brokenQty || 0) - (l.returnPending || 0) })).filter(l => l.qty > 0);
  const tabs = data.tabs.filter(t => t.waiterUid === uid);
  const cash = data.tabs.flatMap(t => (t.payments || []).filter(p => p.method === 'cash' && p.by === uid));
  const momo = data.tabs.flatMap(t => (t.payments || []).filter(p => p.method === 'momo' && p.by === uid));
  return {
    ordersTaken: rounds.length,
    salesPesewas: sum(tabs, t => t.bill.totalPesewas),
    receivedQty: qty(recv), receivedPesewas: val(recv),
    deliveredQty: qty(deliveredLines), deliveredPesewas: val(deliveredLines),
    returnedQty: qty(recv, 'returnedQty'), returnPendingQty: qty(recv, 'returnPending'), brokenQty: qty(recv, 'brokenQty'), brokenPesewas: val(recv, 'brokenQty'),
    freeQty: qty(recv, 'compQty'), freePesewas: val(recv, 'compQty'),
    withYouQty: qty(withYouLines), withYouPesewas: val(withYouLines), withYou: withYouLines.map(l => ({ name: l.name, qty: l.qty })),
    waitingAtBar: rounds.filter(r => ['waiting', 'preparing', 'ready', 'taken'].includes(r.status)).length,
    billsPaid: tabs.filter(t => ['paid', 'overpaid'].includes(t.bill.status)).length, paidPesewas: sum(tabs, t => t.bill.paidPesewas),
    billsUnpaid: tabs.filter(t => ['unpaid', 'part_paid'].includes(t.bill.status)).length, unpaidPesewas: sum(tabs, t => t.bill.balancePesewas),
    unpaidTabs: tabs.filter(t => t.bill.balancePesewas > 0).map(t => ({ id: t.id, number: t.number, table: t.table, balancePesewas: t.bill.balancePesewas })),
    cashCollectedPesewas: sum(cash, p => p.amountPesewas), momoRecordedPesewas: sum(momo, p => p.amountPesewas),
    // Tips for this person tonight (theirs, not part of the cash to hand in).
    tipsPesewas: sum((data.tips || []).filter(x => x.toUid === uid), x => x.amountPesewas),
    cancelledRounds: data.rounds.filter(r => r.waiterUid === uid && r.status === 'cancelled').length,
  };
}
// Every waiter's report for a night, side by side, for finance (and the managers and directors):
// their sales, what's paid and unpaid, cash and MoMo they took, drinks still with them, breakages,
// free drinks, tips, and the report they submitted (with its explanation) or that it's missing.
export async function waitersReport(env, user, { date } = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const d = dateOr(date), data = await nightData(env, d);
  const ids = [...new Set([...data.tabs.map(t => t.waiterUid), ...data.rounds.map(r => r.waiterUid)])].filter(Boolean);
  const nameOf = uid => data.tabs.find(t => t.waiterUid === uid)?.waiterName || data.rounds.find(r => r.waiterUid === uid)?.waiterName || 'Waiter';
  const waiters = ids.map(uid => {
    const rep = data.reports.find(r => r.uid === uid && r.kind === 'waiter');
    return { uid, name: nameOf(uid), tabs: data.tabs.filter(t => t.waiterUid === uid).length, ...waiterFigures(uid, data),
      report: rep ? { at: rep.at || rep.submittedAt || '', explanation: rep.explanation || '' } : null };
  }).sort((a, b) => b.salesPesewas - a.salesPesewas);
  const t = k => waiters.reduce((n, w) => n + Number(w[k] || 0), 0);
  return { date: d, waiters, totals: { salesPesewas: t('salesPesewas'), paidPesewas: t('paidPesewas'), unpaidPesewas: t('unpaidPesewas'), cashCollectedPesewas: t('cashCollectedPesewas'), momoRecordedPesewas: t('momoRecordedPesewas'), withYouPesewas: t('withYouPesewas'), brokenPesewas: t('brokenPesewas') }, missing: waiters.filter(w => !w.report).length };
}

// Waiters and bartenders (their quick sales and cash) both have one.
const REPORTERS = ['waitStaff', 'barStaff', 'eventManager', ...BOSS];
export async function myReport(env, user, { date } = {}) {
  if (!requireRole(user, REPORTERS)) return FORBIDDEN;
  const d = dateOr(date), data = await nightData(env, d);
  const sub = data.reports.find(r => r.uid === uidOf(user) && r.kind === 'waiter');
  return { date: d, figures: waiterFigures(uidOf(user), data), submitted: sub ? { at: sub.submittedAt, explanation: sub.explanation, figures: sub.figures } : null };
}
export async function submitMyReport(env, b, user) {
  if (!requireRole(user, REPORTERS)) return FORBIDDEN;
  const d = dateOr(b?.date), rid = `${d}__${uidOf(user)}`;
  if (await getDoc(env, 'staff_reports', rid)) return { error: 'Your report for this night is already in.' };
  const data = await nightData(env, d), fig = waiterFigures(uidOf(user), data);
  const explanation = clean(b?.explanation, 600);
  if ((fig.withYouQty > 0 || fig.returnPendingQty > 0) && !explanation) return { error: `${fig.withYouQty + fig.returnPendingQty} drink${fig.withYouQty + fig.returnPendingQty > 1 ? 's are' : ' is'} not delivered or returned yet. Deliver or return them, or explain.`, code: 'needs_explanation' };
  if (fig.billsUnpaid > 0 && !explanation) return { error: `${fig.billsUnpaid} bill${fig.billsUnpaid > 1 ? 's are' : ' is'} still unpaid (${ghs(fig.unpaidPesewas)}). Get them paid, or explain.`, code: 'needs_explanation' };
  await setDoc(env, 'staff_reports', rid, { date: d, uid: uidOf(user), name: user.name || '', kind: 'waiter', figures: fig, explanation, submittedAt: now(), status: 'submitted' });
  await audit(env, user, 'WAITER_REPORT_SUBMITTED', { date: d, withYouQty: fig.withYouQty, unpaidPesewas: fig.unpaidPesewas });
  return { submitted: true };
}

// ── Front office closing report ──
async function frontOfficeFigures(env, date) {
  const events = (await listDocs(env, 'events')).filter(e => e.fields.date && nightKey(e.fields.date) === date);
  let checked = 0, admitted = 0, booked = 0, arrived = 0;
  for (const e of events) {
    const ci = (await queryWhere(env, 'checkins', [{ field: 'eventId', value: e.id }])).filter(c => !c.fields.undoneAt);
    checked += ci.length; admitted += sum(ci, c => c.fields.admits || 1);
    const tables = (await queryWhere(env, 'orders', [{ field: 'eventId', value: e.id }, { field: 'kind', value: 'table' }])).filter(o => o.fields.status === 'confirmed');
    booked += tables.length; arrived += tables.filter(o => o.fields.arrivedAt).length;
  }
  const open = (await queryWhere(env, 'incidents', [{ field: 'status', value: 'open' }])).length + (await queryWhere(env, 'incidents', [{ field: 'status', value: 'handed_over' }])).length;
  return { nights: events.map(e => e.fields.name), ticketsChecked: checked, admitted, tablesBooked: booked, tablesArrived: arrived, openIssues: open };
}
export async function frontOfficeReport(env, user, { date } = {}) {
  if (!requireRole(user, ['doorStaff', 'security', ...BOSS])) return FORBIDDEN;
  const d = dateOr(date);
  const sub = (await queryWhere(env, 'staff_reports', [{ field: 'date', value: d }])).find(r => r.fields.kind === 'front_office');
  return { date: d, figures: await frontOfficeFigures(env, d), submitted: sub ? { byName: sub.fields.name, at: sub.fields.submittedAt, note: sub.fields.explanation } : null };
}
export async function submitFrontOffice(env, b, user) {
  if (!requireRole(user, ['doorStaff', ...BOSS])) return FORBIDDEN;
  const d = dateOr(b?.date), rid = `${d}__front_office`;
  if (await getDoc(env, 'staff_reports', rid)) return { error: 'The front office report for this night is already in.' };
  const fig = await frontOfficeFigures(env, d), note = clean(b?.note, 600);
  if (fig.openIssues > 0 && !note) return { error: `${fig.openIssues} issue${fig.openIssues > 1 ? 's are' : ' is'} still open. Hand them over (Issues tab), or explain here.`, code: 'needs_explanation' };
  await setDoc(env, 'staff_reports', rid, { date: d, uid: uidOf(user), name: user.name || '', kind: 'front_office', figures: fig, explanation: note, submittedAt: now(), status: 'submitted' });
  return { submitted: true };
}

// ── Today's sales ──
export async function todaySales(env, user, { date } = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const d = dateOr(date), data = await nightData(env, d);
  return { date: d, night: await nightState(env, d), ...salesFrom(data) };
}
function salesFrom(data) {
  const tabPays = data.tabs.flatMap(t => (t.payments || []).map(p => ({ ...p, tabNumber: t.number })));
  const qrValue = sum(data.qr, o => o.totalPesewas);
  const qrRefunds = data.qr.filter(o => ['refund_due', 'refunded'].includes(o.status));
  const byStation = new Map(data.stations.map(s => [s.id, { name: s.name, salesPesewas: 0, paidPesewas: 0, orders: 0 }]));
  const st = id => byStation.get(id) || byStation.set(id, { name: 'Bar', salesPesewas: 0, paidPesewas: 0, orders: 0 }).get(id);
  for (const t of data.tabs) { const s = st(t.stationId); s.salesPesewas += t.bill.totalPesewas; s.paidPesewas += t.bill.paidPesewas; s.orders += t.rounds.filter(r => r.status !== 'cancelled').length; }
  for (const o of data.qr) { const s = st(o.stationId); s.salesPesewas += o.totalPesewas; s.paidPesewas += o.totalPesewas; s.orders += 1; }
  const byWaiter = new Map();
  for (const t of data.tabs) {
    const w = byWaiter.get(t.waiterUid) || { uid: t.waiterUid, name: t.waiterName, salesPesewas: 0, paidPesewas: 0, unpaidPesewas: 0, tabs: 0 };
    w.salesPesewas += t.bill.totalPesewas; w.paidPesewas += t.bill.paidPesewas; w.unpaidPesewas += t.bill.balancePesewas; w.tabs += 1; byWaiter.set(t.waiterUid, w);
  }
  for (const w of byWaiter.values()) w.report = data.reports.find(r => r.uid === w.uid && r.kind === 'waiter') ? 'submitted' : 'missing';
  const byProduct = new Map();
  const addP = (name, qty, value) => { const p = byProduct.get(name) || { name, qty: 0, valuePesewas: 0 }; p.qty += qty; p.valuePesewas += value; byProduct.set(name, p); };
  for (const r of data.rounds.filter(r => r.status !== 'cancelled')) for (const l of r.lines) { const n = l.qty - (l.returnedQty || 0) - (l.brokenQty || 0) - (l.compQty || 0); if (n > 0) addP(l.name, n, n * l.unitPesewas); }
  for (const o of data.qr) for (const l of o.lines || []) addP(l.name, l.qty, l.qty * l.unitPesewas);
  const comps = data.rounds.flatMap(r => r.lines).filter(l => l.compQty);
  const cancelled = data.rounds.filter(r => r.status === 'cancelled');
  const cashRefunds = data.cash.flatMap(c => (c.movements || []).filter(m => m.kind === 'refund'));
  // Money confirmed by Paystack: tab payments and QR self-orders (refunds are listed on their own).
  const digital = sum(tabPays.filter(p => p.method === 'digital'), p => p.amountPesewas) + qrValue;
  const cash = sum(tabPays.filter(p => p.method === 'cash'), p => p.amountPesewas);
  // MoMo sent straight to the club's number, recorded by staff with its transaction ID: finance
  // checks these against the MoMo statement (listed in the report).
  const momo = sum(tabPays.filter(p => p.method === 'momo'), p => p.amountPesewas);
  const sales = sum(data.tabs, t => t.bill.totalPesewas) + qrValue;
  return {
    totals: {
      salesPesewas: sales, paidPesewas: digital + cash + momo, digitalPesewas: digital, cashPesewas: cash, momoPesewas: momo,
      owedPesewas: sum(data.tabs.filter(t => t.status !== 'written_off'), t => t.bill.balancePesewas), writtenOffPesewas: sum(data.tabs.filter(t => t.status === 'written_off'), t => t.bill.balancePesewas),
      discountsPesewas: sum(data.tabs, t => t.bill.discountPesewas), freeDrinksPesewas: sum(comps, l => l.compQty * l.unitPesewas), freeDrinksQty: sum(comps, l => l.compQty),
      cancelledOrders: cancelled.length, cancelledPesewas: sum(cancelled.flatMap(r => r.lines), lineValue),
      refundsPesewas: sum(qrRefunds, o => o.totalPesewas) + sum(cashRefunds, m => m.amountPesewas),
      openTabs: data.tabs.filter(t => t.status === 'open').length, unpaidTabs: data.tabs.filter(t => t.bill.balancePesewas > 0 && t.status !== 'written_off').length,
      qrOrders: data.qr.length,
    },
    byStation: [...byStation.values()].filter(s => s.orders), byWaiter: [...byWaiter.values()].sort((a, b) => b.salesPesewas - a.salesPesewas),
    byProduct: [...byProduct.values()].sort((a, b) => b.valuePesewas - a.valuePesewas),
    byMethod: [{ method: 'MoMo / card (Paystack, confirmed)', amountPesewas: digital }, { method: 'MoMo to the club’s number (recorded, check the statement)', amountPesewas: momo }, { method: 'Cash (recorded)', amountPesewas: cash }],
    momoPayments: tabPays.filter(p => p.method === 'momo').map(p => ({ tabNumber: p.tabNumber, amountPesewas: p.amountPesewas, momoRef: p.momoRef, momoFrom: p.momoFrom || '', byName: p.byName || '', at: p.at })),
    // Tips: the staff's money, not sales. MoMo tips share the payment's transaction ID (one MoMo for
    // bill and tip), so the MoMo statement = MoMo sales + MoMo tips.
    tips: { ...tipTotals(data.tips || []), people: [...(data.tips || []).reduce((m, x) => m.set(x.toUid, { name: x.toName, amountPesewas: (m.get(x.toUid)?.amountPesewas || 0) + Number(x.amountPesewas || 0) }), new Map()).values()].sort((a, b) => b.amountPesewas - a.amountPesewas),
      momo: (data.tips || []).filter(x => x.method === 'momo').map(x => ({ tabNumber: x.tabNumber || '', amountPesewas: x.amountPesewas, momoRef: x.momoRef, toName: x.toName, byName: x.byName || '', at: x.at })) },
    unpaid: data.tabs.filter(t => t.bill.balancePesewas > 0 && t.status !== 'written_off').map(t => ({ id: t.id, number: t.number, table: t.table, waiterName: t.waiterName, balancePesewas: t.bill.balancePesewas })),
  };
}

// ── The close: what's done, what isn't ──
// ── Who closes the night ──
// The Manager closes it. Not the directors. If the Manager can't be there, they hand it over (with a
// note); the Human manager or the Event manager accepts, and closing that night is then theirs.
//   shifts/{date}.handover { byName, at, note, acceptedBy, acceptedByName, acceptedAt }
const STAND_INS = ['hrManager', 'eventManager'];
export function canCloseNight(user, state) {
  if (requireRole(user, ['superAdmin'])) return true;
  if (user.role === 'manager') return true;
  return !!state?.handover?.acceptedBy && state.handover.acceptedBy === uidOf(user);
}
export async function handOverClosing(env, b, user) {
  if (user?.role !== 'manager' && !requireRole(user, ['superAdmin'])) return { error: 'The Manager hands over closing.', status: 403 };
  const d = dateOr(b?.date), state = await nightState(env, d);
  if (state.status === 'closed') return { error: 'This night is already closed.' };
  const note = clean(b?.note, 300);
  if (!note) return { error: 'Say why you can’t close tonight, e.g. “Family emergency, left at 1am”.' };
  await setDoc(env, 'shifts', d, { ...state, status: state.status || 'open', handover: { by: uidOf(user), byName: user.name || '', at: now(), note } });
  // The other managers are told at once: a text, and a notice to the managers on My page.
  const standIns = (await listDocs(env, 'users')).filter(u => STAND_INS.includes(u.fields.role) && !u.fields.removed && u.fields.phone);
  for (const u of standIns) await sendSms(env, u.fields.phone, `MEMORIES\n${user.name || 'The Manager'} can't close tonight (${note}). Can you? Open the closing screen and tap "I'll close tonight".`);
  await setDoc(env, 'notices', id(), { title: `${user.name || 'The Manager'} can’t close tonight`, body: `${note} The Human manager or the Event manager: open Close the night and tap “I’ll close tonight”.`, team: 'managers', by: uidOf(user), byName: user.name || '', byRole: user.role, at: now(), removed: false });
  await audit(env, user, 'CLOSING_HANDED_OVER', { date: d, told: standIns.length });
  return { handedOver: true, told: standIns.map(u => u.fields.name) };
}
export async function acceptClosing(env, b, user) {
  if (!requireRole(user, STAND_INS)) return { error: 'The Human manager or the Event manager takes over closing.', status: 403 };
  const d = dateOr(b?.date), state = await nightState(env, d);
  if (state.status === 'closed') return { error: 'This night is already closed.' };
  if (!state.handover) return { error: 'The Manager hasn’t handed over closing tonight.' };
  if (state.handover.acceptedBy) return { error: state.handover.acceptedBy === uidOf(user) ? 'You’re already closing tonight.' : `${state.handover.acceptedByName} is already closing tonight.` };
  await setDoc(env, 'shifts', d, { ...state, handover: { ...state.handover, acceptedBy: uidOf(user), acceptedByName: user.name || '', acceptedAt: now() } });
  await audit(env, user, 'CLOSING_ACCEPTED', { date: d });
  return { accepted: true };
}

export async function closingStatus(env, user, { date } = {}) {
  if (!requireRole(user, [...REPORTS, ...STAND_INS])) return FORBIDDEN;
  const d = dateOr(date), data = await nightData(env, d);
  const waiterIds = [...new Set([...data.tabs.map(t => t.waiterUid), ...data.rounds.map(r => r.waiterUid)])];
  const waiters = waiterIds.map(uid => {
    const fig = waiterFigures(uid, data), rep = data.reports.find(r => r.uid === uid && r.kind === 'waiter');
    return { uid, name: data.tabs.find(t => t.waiterUid === uid)?.waiterName || data.rounds.find(r => r.waiterUid === uid)?.waiterName || 'Waiter', submitted: !!rep, explanation: rep?.explanation || '', withYouQty: fig.withYouQty, unpaidPesewas: fig.unpaidPesewas, salesPesewas: fig.salesPesewas, openTabs: data.tabs.filter(t => t.waiterUid === uid && t.status === 'open').length };
  });
  const moves = await queryWhere(env, 'stock_moves', [{ field: 'businessDate', value: d }]);
  const activeStations = [...new Set([...moves.map(m => m.fields.stationId), ...data.rounds.map(r => r.stationId)])];
  const bars = [];
  for (const sid of activeStations) {
    const c = data.counts.find(x => x.stationId === sid && x.kind === 'closing');
    const lines = c ? (c.corrected || c).lines : [];
    bars.push({ stationId: sid, name: data.stations.find(s => s.id === sid)?.name || 'Bar', counted: !!c, countedByName: c?.byName || '', reviewed: c?.status === 'reviewed', differences: lines.filter(l => l.difference).map(l => ({ name: l.name, difference: l.difference, reason: l.reason })) });
  }
  const cash = data.cash.map(c => ({ id: c.id, name: c.name, role: c.role, status: c.status, explanation: c.explanation || '', receivedAt: c.receivedAt || '', receivedByName: c.receivedByName || '', ...cashFigures(c) }));
  const front = data.reports.find(r => r.kind === 'front_office');
  const eod = await getDoc(env, 'eod_reports', d);
  const night = await nightState(env, d);
  // Four steps. A waiter's report is their tabs: each one closed as paid or owed (nothing to submit).
  // Cash: waiters → the bar → the Manager.
  const openTabs = data.tabs.filter(t => t.status === 'open');
  const notIn = cash.filter(c => c.expectedPesewas && c.status === 'open'), notReceived = cash.filter(c => c.status !== 'open' && !c.receivedAt);
  const steps = [
    { key: 'waiters', label: 'Every tab closed (paid or owed)', done: !openTabs.length, detail: openTabs.length ? `${openTabs.length} open: ${[...new Set(openTabs.map(t => String(t.waiterName || '').split(' ')[0]))].join(', ')}` : `${data.tabs.length} tabs closed` },
    { key: 'cash', label: 'Cash in: waiters to the bar, the bar to the Manager', done: !notIn.length && !notReceived.length, detail: notIn.length || notReceived.length ? [notIn.length ? `still with ${notIn.map(c => c.name.split(' ')[0]).join(', ')}` : '', notReceived.length ? `to receive from ${notReceived.map(c => c.name.split(' ')[0]).join(', ')}` : ''].filter(Boolean).join(' · ') : 'All received' },
    { key: 'bar', label: 'The bar counts its stock', done: bars.every(b => b.counted), detail: `${bars.filter(b => b.counted).length} of ${bars.length} bars counted` },
    { key: 'finance', label: 'Close: the report goes to finance', done: !!eod?.fields?.sent || night.status === 'closed', detail: eod ? (eod.fields.sent ? `Sent to ${eod.fields.sentTo}` : eod.fields.sendNote) : 'When you close' },
    { key: 'signoff', label: 'Finance signs off', done: !!eod?.fields?.financeApprovedAt, detail: eod?.fields?.financeApprovedAt ? `Finance: ${eod.fields.financeApprovedByName}` : 'Waiting' },
  ];
  const h = night.handover || null;
  const closer = { handover: h ? { byName: h.byName, at: h.at, note: h.note, acceptedByName: h.acceptedByName || '', acceptedAt: h.acceptedAt || '' } : null,
    canClose: canCloseNight(user, night), canHandOver: (user.role === 'manager' || requireRole(user, ['superAdmin'])) && !h && night.status !== 'closed',
    canAccept: !!h && !h.acceptedBy && requireRole(user, STAND_INS) && night.status !== 'closed' };
  return { date: d, night, closer, steps, waiters, bars, cash, frontOffice: front ? { name: front.name, at: front.submittedAt, note: front.explanation, figures: front.figures } : null, pendingApprovals: data.approvals.filter(a => a.businessDate === d).length };
}

// The manager closes the night: the end-of-day report is prepared, saved and sent to finance.
export async function closeNight(env, b, user) {
  if (!requireRole(user, [...BOSS, ...STAND_INS])) return FORBIDDEN;
  const d = dateOr(b?.date);
  const state = await nightState(env, d);
  if (!canCloseNight(user, state)) return { error: requireRole(user, ['director']) ? 'The Manager closes the night, not the directors.' : 'Only the Manager closes the night, or whoever accepted it when the Manager handed it over.', status: 403 };
  // Any time, and again later: each close saves a new version of the report (nothing is locked).
  const status = await closingStatus(env, user, { date: d });
  // Never blocked: what isn't done yet is listed in the report (and can be closed again later).
  const missing = status.steps.filter(s => ['waiters', 'bar', 'cash'].includes(s.key) && !s.done);
  const data = await nightData(env, d), sales = salesFrom(data);
  const sheets = [];
  for (const bar of status.bars) { const s = await stockSheet(env, { stationId: bar.stationId, date: d }, { role: 'manager', admin: false }); if (!s.error) sheets.push({ station: s.station.name, rows: s.rows }); }
  const report = {
    date: d, preparedAt: now(), preparedBy: uidOf(user), preparedByName: user.name || '',
    sales, waiters: status.waiters.map(w => ({ ...w, figures: waiterFigures(w.uid, data) })), bars: sheets, barDifferences: status.bars, cash: status.cash,
    frontOffice: status.frontOffice || { missing: true, figures: await frontOfficeFigures(env, d) },
    exceptions: {
      unpaidTabs: sales.unpaid, pendingPayments: (await queryWhere(env, 'pending_checkouts', [{ field: 'status', value: 'pending' }])).filter(p => p.fields.kind === 'tab').length,
      cashDifferences: status.cash.filter(c => c.differencePesewas), stockDifferences: status.bars.filter(x => x.differences.length), missingReports: missing.map(m => m.label),
      pendingApprovals: status.pendingApprovals,
    },
  };
  const fc = (await getDoc(env, 'config', 'finance'))?.fields || {};
  const to = fc.email || env.FINANCE_EMAIL || '';
  const lines = [`Memories: end of day ${d}`, `Sales ${ghs(sales.totals.salesPesewas)} · Paid ${ghs(sales.totals.paidPesewas)} (MoMo/card ${ghs(sales.totals.digitalPesewas)}, MoMo to the club ${ghs(sales.totals.momoPesewas || 0)}, cash ${ghs(sales.totals.cashPesewas)}) · Still owed ${ghs(sales.totals.owedPesewas)}`,
    ...(sales.tips?.totalPesewas ? [`Tips for staff (not club money) ${ghs(sales.tips.totalPesewas)}: MoMo/card ${ghs(sales.tips.momoPesewas + sales.tips.digitalPesewas)}, cash ${ghs(sales.tips.cashPesewas)}`] : []),
    `Cash differences: ${report.exceptions.cashDifferences.length} · Stock differences: ${report.exceptions.stockDifferences.length} · Missing reports: ${report.exceptions.missingReports.length || 'none'}`,
    `Prepared by ${user.name || 'the manager'}. Open the full report: ${siteUrl(env, `/finance.html#report/${d}`)}`];
  const sent = to ? await sendEmail(env, to, `Memories end of day: ${d}`, lines) : false;
  const smsTo = fc.phone || '';
  const texted = smsTo ? await sendSms(env, smsTo, lines.slice(0, 2).join('\n')) : false;
  const prev = await getDoc(env, 'eod_reports', d);
  await setDoc(env, 'eod_reports', d, { ...(prev?.fields || {}), date: d, report, versions: [...(prev?.fields?.versions || []), { at: now(), byName: user.name || '' }], sent, texted, sentTo: sent ? to : '', sendNote: sent ? '' : (to ? 'The email didn’t send. Open the report in the system.' : 'No finance email is set (Site settings). The report is saved here.'),
    closedBy: uidOf(user), closedByName: user.name || '', closedAt: now(), managerApprovedAt: now(), managerApprovedByName: user.name || '' });
  await setDoc(env, 'shifts', d, { ...state, status: 'closed', closedBy: uidOf(user), closedByName: user.name || '', closedAt: now(), closedWithMissing: missing.map(m => m.key) });
  await audit(env, user, 'NIGHT_CLOSED', { date: d, sent, missing: missing.map(m => m.key) });
  return { closed: true, sent, texted, sentTo: sent ? to : '', note: sent ? `Report emailed to ${to}.` : (to ? 'The email didn’t send. The report is saved: finance can open it in the system.' : 'No finance email is set. The report is saved: finance can open it in the system.') };
}

export async function eodReport(env, user, { date } = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const d = await getDoc(env, 'eod_reports', dateOr(date));
  return { report: d ? d.fields : null };
}
export async function listEod(env, user) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  return { reports: (await listDocs(env, 'eod_reports')).map(r => ({ date: r.id, sent: r.fields.sent, closedByName: r.fields.closedByName, financeApprovedByName: r.fields.financeApprovedByName || '', financeApprovedAt: r.fields.financeApprovedAt || null, salesPesewas: r.fields.report?.sales?.totals?.salesPesewas || 0 })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90) };
}
// Finance signs off (not the person who closed the night).
export async function financeSignOff(env, b, user) {
  if (!requireRole(user, ['finance', 'superAdmin', 'director'])) return FORBIDDEN;
  const r = await getDoc(env, 'eod_reports', dateOr(b?.date));
  if (!r) return { error: 'That night isn’t closed yet.', status: 404 };
  if (r.fields.closedBy === uidOf(user)) return { error: 'Someone other than the person who closed the night must sign off.' };
  if (r.fields.financeApprovedAt) return { error: 'Already signed off.' };
  await setDoc(env, 'eod_reports', r.id, { ...r.fields, financeApprovedAt: now(), financeApprovedBy: uidOf(user), financeApprovedByName: user.name || '', financeNote: clean(b.note, 400) });
  await audit(env, user, 'EOD_SIGNED_OFF', { date: r.id });
  return { signedOff: true };
}

// Where the end-of-day report goes. Kept server-side (site settings are public).
export async function financeContact(env, user, b) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const cur = (await getDoc(env, 'config', 'finance'))?.fields || {};
  if (!b) return { email: cur.email || '', phone: cur.phone || '', emailReady: !!(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL) };
  const email = clean(b.email, 120).toLowerCase(), phone = b.phone ? normalizePhone(b.phone) : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email doesn’t look right.' };
  if (b.phone && !phone) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  await setDoc(env, 'config', 'finance', { email, phone, updatedAt: now(), updatedByName: user.name || '' });
  await audit(env, user, 'FINANCE_CONTACT_SET', { email, phone });
  return { email, phone, saved: true };
}
