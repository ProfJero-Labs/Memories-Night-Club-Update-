// Customer tabs: a waiter takes the order (no QR needed), the bar makes it, the customer pays on
// their phone (Paystack) or in cash. QR self-ordering (bar.js) uses the same menu and stock.
//
//   tabs/{id}    number ("Tab 27", counted per night), businessDate, stationId, table, customerName,
//                customerPhone, waiterUid, waiterName, status open|closed|written_off, billToken
//                (the customer's bill link), payments[{id, method cash|momo|digital, amountPesewas, at,
//                byName, sessionId?}], discounts[{amountPesewas, reason, approvedByName}], pending
//                (a Paystack payment in progress)
//   rounds/{id}  one order sent to the bar: tabId, tabNumber, stationId, waiterUid, table, lines
//                [{lineId, productId, name, unitPesewas, qty, returnedQty, brokenQty, compQty,
//                returnPending}], status waiting → preparing → ready → handed → received →
//                delivered, or cancelled
// Prices are copied onto the round when it's sent, so a menu price change never moves a bill.
// Stock leaves the bar once, when the bar hands the round to the waiter (stock_moves 'issue');
// drinks the waiter brings back come back in ('return_in') once the bar confirms them.
// Nothing is sold past zero: every order is checked against what's left at the bar (stockError).
// Quick sale: one go, no table: drinks + Cash or MoMo. From a waiter it goes to the bar like any
// order and the waiter confirms they got the drinks; from the bar it's served and closed at once.
import { getDoc, setDoc, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction, listDocs, deleteDoc } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone, paymentRef, validEmail } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { sendSms, siteUrl } from '../lib/notify.js';
import { FORBIDDEN, bizDate, who, audit, closedError, ghs, int } from './common.js';
import { addMoves, stockError } from './stock.js';
import { prepareTip, tipFields, textTip, phoneOf, guestTipPeople } from './tips.js';
import { paymentAlert } from './alerts.js';

export const BOSS = ['superAdmin', 'director', 'manager'];
export const WAITERS = [...BOSS, 'waitStaff', 'eventManager'];             // the Event manager serves tables too
export const BAR_HANDS = [...BOSS, 'barStaff'];
export const CASH_TAKERS = [...BOSS, 'cashier'];
const MAX_LINES = 20, MAX_QTY = 30;

// ── The bill ──
const billable = l => Math.max(0, Number(l.qty) - Number(l.returnedQty || 0) - Number(l.brokenQty || 0) - Number(l.compQty || 0));
export function billOf(tab, rounds) {
  const live = rounds.filter(r => r.status !== 'cancelled');
  const map = new Map();
  for (const r of live) for (const l of r.lines) {
    const n = billable(l); if (!n) continue;
    const k = `${l.productId}|${l.unitPesewas}`, cur = map.get(k) || { name: l.name, unitPesewas: l.unitPesewas, qty: 0 };
    cur.qty += n; map.set(k, cur);
  }
  const lines = [...map.values()].map(l => ({ ...l, amountPesewas: l.qty * l.unitPesewas }));
  const gross = lines.reduce((n, l) => n + l.amountPesewas, 0);
  const discount = (tab.discounts || []).reduce((n, d) => n + Number(d.amountPesewas || 0), 0);
  const total = Math.max(0, gross - discount);
  const paid = (tab.payments || []).reduce((n, p) => n + Number(p.amountPesewas || 0), 0);
  const balance = total - paid;
  const status = tab.status === 'written_off' ? 'written_off' : !total && !paid ? 'empty' : balance <= 0 ? (balance < 0 ? 'overpaid' : 'paid') : paid > 0 ? 'part_paid' : 'unpaid';
  return { lines, grossPesewas: gross, discountPesewas: discount, totalPesewas: total, paidPesewas: paid, balancePesewas: Math.max(0, balance), overpaidPesewas: Math.max(0, -balance), status };
}
export const PAY_LABEL = { empty: 'Nothing ordered yet', unpaid: 'Waiting for payment', part_paid: 'Part paid', paid: 'Paid', overpaid: 'Overpaid', written_off: 'Written off (unpaid)' };

async function roundsOf(env, tabId) { return (await queryWhere(env, 'rounds', [{ field: 'tabId', value: tabId }])).map(r => ({ id: r.id, ...r.fields })); }
const tabView = (t, rounds, { full = true } = {}) => {
  const bill = billOf(t, rounds);
  return {
    id: t.id, number: t.number, label: `Tab ${t.number}`, quick: !!t.quick, businessDate: t.businessDate, table: t.table || '', customerName: t.customerName || '', customerPhoneHint: t.customerPhone ? maskPhone(t.customerPhone) : '',
    waiterUid: t.waiterUid, waiterName: t.waiterName, stationId: t.stationId, stationName: t.stationName, status: t.status, payStatus: bill.status, payLabel: PAY_LABEL[bill.status],
    bill, payments: (t.payments || []).map(p => ({ method: p.method, label: METHOD_LABEL[p.method] || p.method, amountPesewas: p.amountPesewas, at: p.at, byName: p.byName || '', momoRef: p.momoRef || '' })),
    openRounds: rounds.filter(r => !['delivered', 'cancelled'].includes(r.status)).length,
    ...(full ? { rounds: rounds.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(roundView), billUrl: null } : {}),
    createdAt: t.createdAt,
  };
};
export const ROUND_LABEL = { waiting: 'Sent to bar', preparing: 'Bar is making it', ready: 'Ready at the bar', taken: 'You took it: the bar must confirm', handed: 'Bar gave it to you: tap “I got them”', received: 'With you', delivered: 'Delivered', cancelled: 'Cancelled' };
const roundView = r => ({ id: r.id, tabId: r.tabId, tabNumber: r.tabNumber, table: r.table || '', quick: !!r.quick, status: r.status, statusLabel: ROUND_LABEL[r.status], waiterUid: r.waiterUid, waiterName: r.waiterName, stationId: r.stationId,
  lines: r.lines.map(l => ({ lineId: l.lineId, productId: l.productId, name: l.name, qty: l.qty, unitPesewas: l.unitPesewas, returnedQty: l.returnedQty || 0, brokenQty: l.brokenQty || 0, compQty: l.compQty || 0, returnPending: l.returnPending || 0 })),
  note: r.note || '', createdAt: r.createdAt, handedAt: r.handedAt || '', handedByName: r.handedByName || '', takenAt: r.takenAt || '', takenByName: r.takenByName || '', takenConfirmed: !!r.takenConfirmedAt, cancelReason: r.cancelReason || '' });

const mineOrBoss = (user, t) => requireRole(user, BOSS) || t.waiterUid === uidOf(user);

// ── Waiter ──
export async function openTab(env, b, user) {
  if (!requireRole(user, WAITERS)) return FORBIDDEN;
  const date = bizDate(); const closed = await closedError(env, date); if (closed) return closed;
  const stations = (await listDocs(env, 'bar_stations')).sort((a, b) => a.fields.name.localeCompare(b.fields.name));
  const st = stations.find(s => s.id === b?.stationId) || stations[0];
  if (!st) return { error: 'No bar is set up yet. Ask a manager (Setup → Bar orders).' };
  const table = clean(b?.table, 30), walkIn = b?.walkIn === true;
  if (!table && !walkIn) return { error: 'Pick a table, or tap “Walk-in”.' };
  const phone = b?.customerPhone ? normalizePhone(b.customerPhone) : '';
  if (b?.customerPhone && !phone) return { error: 'That phone number doesn’t look right. Use a Ghana number, or leave it blank.' };
  // Who brought the table (a 10% commission on a deal over GHS 3,000; see commission.js).
  const dealName = clean(b?.broughtByName, 60), dealPhone = b?.broughtByPhone ? normalizePhone(b.broughtByPhone) : '';
  if (b?.broughtByPhone && !dealPhone) return { error: 'The phone of the person who brought the table doesn’t look right, or leave it blank.' };
  const broughtBy = dealName ? { name: dealName, phone: dealPhone, setBy: uidOf(user), setByName: user.name || '', at: now() } : null;
  const tabId = id();
  const number = await withTransaction(env, async tx => {
    const key = `tabs_${date}`, got = foundFields(await batchGet(env, [`counters/${key}`], tx), `/counters/${key}`);
    const n = Number(got?.fields?.n || 0) + 1;
    await commitTx(env, [
      updateWrite(env, 'counters', key, { n }),
      updateWrite(env, 'tabs', tabId, { number: n, businessDate: date, stationId: st.id, stationName: st.fields.name, table: walkIn ? 'Walk-in' : table, customerName: clean(b.customerName, 60), customerPhone: phone,
        waiterUid: uidOf(user), waiterName: user.name || '', status: 'open', billToken: id(), payments: [], discounts: [], createdAt: now(), broughtBy }),
    ], tx);
    return n;
  });
  await audit(env, user, 'TAB_OPENED', { tabId, number, table: walkIn ? 'Walk-in' : table });
  return { id: tabId, number, label: `Tab ${number}` };
}

export async function myTabs(env, user, { all = false } = {}) {
  if (!requireRole(user, [...WAITERS, 'cashier', 'hrManager', 'eventManager'])) return FORBIDDEN;
  const everyone = all && requireRole(user, [...BOSS, 'cashier', 'hrManager', 'eventManager']);
  const open = await queryWhere(env, 'tabs', everyone ? [{ field: 'status', value: 'open' }] : [{ field: 'status', value: 'open' }, { field: 'waiterUid', value: uidOf(user) }]);
  const today = (await queryWhere(env, 'tabs', [{ field: 'businessDate', value: bizDate() }])).filter(t => t.fields.status !== 'open' && (everyone || t.fields.waiterUid === uidOf(user)));
  const out = [];
  for (const t of [...open, ...today]) out.push(tabView({ id: t.id, ...t.fields }, await roundsOf(env, t.id), { full: false }));
  return { tabs: out.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.number - a.number) };
}

export async function getTab(env, user, tabId) {
  const t = await getDoc(env, 'tabs', String(tabId || ''));
  if (!t) return { error: 'Tab not found.', status: 404 };
  if (!mineOrBoss(user, t.fields) && !requireRole(user, ['cashier', 'finance', 'barStaff', 'hrManager', 'eventManager'])) return FORBIDDEN;
  const view = tabView({ id: t.id, ...t.fields }, await roundsOf(env, t.id));
  view.billUrl = siteUrl(env, `/bill.html?t=${t.fields.billToken}`);
  return { tab: view };
}

export async function addRound(env, b, user) {
  if (!requireRole(user, WAITERS)) return FORBIDDEN;
  const t = await getDoc(env, 'tabs', String(b?.tabId || ''));
  if (!t) return { error: 'Tab not found.', status: 404 };
  if (!mineOrBoss(user, t.fields)) return { error: 'This is another waiter’s tab.', status: 403 };
  if (t.fields.status !== 'open') return { error: 'This tab is closed. Open a new tab.' };
  const closed = await closedError(env, t.fields.businessDate); if (closed) return { error: 'This tab is from a night that’s been closed. Open a new tab.' };
  const want = (Array.isArray(b.lines) ? b.lines : []).map(x => ({ productId: String(x?.productId || ''), qty: int(x?.qty) })).filter(x => x.productId && x.qty > 0);
  if (!want.length) return { error: 'Add at least one drink.' };
  if (want.length > MAX_LINES || want.some(x => x.qty > MAX_QTY)) return { error: `Up to ${MAX_QTY} of each drink in one round.` };
  const got = await batchGet(env, want.map(x => `menu_items/${x.productId}`));
  const lines = [];
  for (const x of want) {
    const p = foundFields(got, `/menu_items/${x.productId}`);
    if (!p || p.fields.available === false || !(Number(p.fields.pricePesewas) > 0)) return { error: `${p?.fields?.name || 'A drink you picked'} isn’t available. Take it off and send again.` };
    const same = lines.find(l => l.productId === x.productId);
    if (same) same.qty += x.qty;
    else lines.push({ lineId: id().slice(0, 12), productId: x.productId, name: p.fields.name, unitPesewas: Number(p.fields.pricePesewas), qty: x.qty, returnedQty: 0, brokenQty: 0, compQty: 0, returnPending: 0 });
  }
  const short = await stockError(env, t.fields.stationId, lines); if (short) return { error: short };
  const rid = id();
  await setDoc(env, 'rounds', rid, { tabId: t.id, tabNumber: t.fields.number, businessDate: bizDate(), stationId: t.fields.stationId, waiterUid: t.fields.waiterUid, waiterName: t.fields.waiterName, table: t.fields.table, lines, status: 'waiting', note: clean(b.note, 120), createdAt: now(), sentBy: uidOf(user) });
  return { id: rid, totalPesewas: lines.reduce((n, l) => n + l.qty * l.unitPesewas, 0) };
}

// The waiter's one step: take the order → it goes to the bar → the customer is texted the invoice
// with a pay link. A new table is opened with it (a table number, or none: standing at the bar);
// with tabId the drinks go on that table and the updated invoice is texted again.
//   { tabId? | table, stationId, customerPhone, customerName }, lines
export async function takeOrder(env, b, user) {
  if (!requireRole(user, WAITERS)) return FORBIDDEN;
  let tabId = String(b?.tabId || ''), opened = false;
  if (!tabId) {
    const table = clean(b?.table, 30);
    const o = await openTab(env, { ...b, table, walkIn: !table }, user);
    if (o.error) return o;
    tabId = o.id; opened = true;
  } else if (b?.customerPhone) {
    const t = await getDoc(env, 'tabs', tabId), phone = normalizePhone(b.customerPhone);
    if (!phone) return { error: 'That phone number doesn’t look right. Use a Ghana number, or leave it blank.' };
    if (t && mineOrBoss(user, t.fields) && t.fields.customerPhone !== phone) await setDoc(env, 'tabs', t.id, { ...t.fields, customerPhone: phone });
  }
  const r = await addRound(env, { ...b, tabId }, user);
  if (r.error) {
    // Nothing was ordered: don't leave an empty table behind.
    if (opened) await deleteDoc(env, 'tabs', tabId).catch(() => {});
    return r;
  }
  const t = await getDoc(env, 'tabs', tabId);
  let invoice = { sent: false, phoneHint: '' };
  if (t?.fields?.customerPhone) {
    const bill = billOf(t.fields, await roundsOf(env, t.id));
    invoice = { sent: await sendSms(env, t.fields.customerPhone, invoiceText(env, t.fields, bill)), phoneHint: maskPhone(t.fields.customerPhone) };
  }
  return { tabId, roundId: r.id, number: t?.fields?.number, totalPesewas: r.totalPesewas, invoice };
}

// Waiter steps on a round: cancel (before the bar starts), got them, delivered, broken, send back.
export async function waiterRound(env, b, user) {
  if (!requireRole(user, WAITERS)) return FORBIDDEN;
  const rid = String(b?.roundId || ''), action = b?.action;
  const res = await stepRound(env, b, user, rid, action);
  // A quick sale is finished once it's paid and the waiter has the drinks.
  if (!res.error && action === 'delivered' && res.tabId) await closeQuickIfDone(env, res.tabId, user);
  delete res.tabId;
  return res;
}
async function closeQuickIfDone(env, tabId, user) {
  const t = await getDoc(env, 'tabs', tabId);
  if (!t || !t.fields.quick || t.fields.status !== 'open') return;
  const rounds = await roundsOf(env, tabId), bill = billOf(t.fields, rounds);
  if (bill.balancePesewas > 0 || rounds.some(r => !['delivered', 'cancelled'].includes(r.status))) return;
  await setDoc(env, 'tabs', tabId, { ...t.fields, status: 'closed', closedAt: now(), closedByName: user.name || '' });
}
async function stepRound(env, b, user, rid, action) {
  return withTransaction(env, async tx => {
    const r = foundFields(await batchGet(env, [`rounds/${rid}`], tx), `/rounds/${rid}`);
    if (!r) return { error: 'Order not found.', status: 404 };
    const f = r.fields;
    if (!requireRole(user, BOSS) && f.waiterUid !== uidOf(user)) return { error: 'This is another waiter’s order.', status: 403 };
    const at = now(), byName = user.name || '';
    let next;
    if (action === 'cancel') {
      if (f.status !== 'waiting') return { error: f.status === 'cancelled' ? 'Already cancelled.' : 'The bar has started it. Ask the bar, or send it back after you get it.' };
      next = { ...f, status: 'cancelled', cancelledAt: at, cancelledByName: byName, cancelReason: clean(b.reason, 120) || 'Cancelled by waiter' };
    } else if (action === 'took') {
      // The waiter picked the drinks up without the bartender tapping "Hand over": the bar confirms
      // it next (and only then do the drinks leave the bar's stock).
      if (!['waiting', 'preparing', 'ready'].includes(f.status)) return { error: f.status === 'taken' ? 'Already marked: waiting for the bar to confirm.' : 'This order isn’t at the bar.' };
      next = { ...f, status: 'taken', takenAt: at, takenByName: byName };
    } else if (action === 'received') {
      if (f.status !== 'handed') return { error: 'The bar hasn’t handed this over yet.' };
      next = { ...f, status: 'received', receivedAt: at };
    } else if (action === 'delivered') {
      if (!['handed', 'received'].includes(f.status)) return { error: f.status === 'delivered' ? 'Already delivered.' : 'Collect it from the bar first.' };
      next = { ...f, status: 'delivered', receivedAt: f.receivedAt || at, deliveredAt: at };
    } else if (action === 'broken' || action === 'return') {
      if (!['handed', 'received', 'delivered'].includes(f.status)) return { error: action === 'return' ? 'Only drinks you got from the bar can go back to it.' : 'Only drinks you’ve collected can be recorded as broken.' };
      const qty = int(b.qty), line = f.lines.find(l => l.lineId === b.lineId);
      if (!line) return { error: 'Pick the drink.' };
      const left = line.qty - (line.returnedQty || 0) - (line.brokenQty || 0) - (line.compQty || 0) - (line.returnPending || 0);
      if (!(qty >= 1 && qty <= left)) return { error: `You can record up to ${left} ${line.name}.` };
      const lines = f.lines.map(l => (l.lineId !== line.lineId ? l : action === 'broken' ? { ...l, brokenQty: (l.brokenQty || 0) + qty, brokenNote: clean(b.note, 120) } : { ...l, returnPending: (l.returnPending || 0) + qty }));
      next = { ...f, lines, ...(action === 'broken' ? { brokenAt: at } : { returnRequestedAt: at }) };
    } else return { error: 'Unknown action.' };
    await commitTx(env, [updateWrite(env, 'rounds', rid, next), updateWrite(env, 'audit_logs', id(), { action: `ROUND_${action.toUpperCase()}`, actorUid: uidOf(user), actorName: byName, roundId: rid, tabId: f.tabId, timestamp: at })], tx);
    return { status: next.status, tabId: f.tabId };
  });
}

// ── Bar ──
export async function barRounds(env, user, { stationId }) {
  if (!requireRole(user, BAR_HANDS)) return FORBIDDEN;
  const stations = (await listDocs(env, 'bar_stations')).sort((a, b) => a.fields.name.localeCompare(b.fields.name));
  const st = stations.find(s => s.id === stationId) || stations[0];
  if (!st) return { rounds: [], returns: [], stationId: null };
  const live = (await queryWhere(env, 'rounds', [{ field: 'stationId', value: st.id }, { field: 'businessDate', value: bizDate() }])).map(r => ({ id: r.id, ...r.fields }));
  const older = (await queryWhere(env, 'rounds', [{ field: 'stationId', value: st.id }, { field: 'status', value: 'waiting' }])).map(r => ({ id: r.id, ...r.fields }));
  const all = [...new Map([...live, ...older].map(r => [r.id, r])).values()];
  return {
    stationId: st.id,
    rounds: all.filter(r => ['waiting', 'preparing', 'ready', 'taken', 'handed'].includes(r.status)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(roundView),
    returns: all.filter(r => r.lines.some(l => l.returnPending > 0)).map(roundView),
    handedToday: all.filter(r => ['received', 'delivered'].includes(r.status)).length,
    // Everything that left this bar tonight, newest first: who took it, when, who confirmed.
    handedOver: all.filter(r => r.handedAt && ['handed', 'received', 'delivered'].includes(r.status)).sort((a, b) => String(b.handedAt).localeCompare(String(a.handedAt))).slice(0, 40).map(roundView),
  };
}

// The bar's view of each waiter tonight: every drink this bar has given them (handed over, less
// what came back to the bar), on which tab, and how much of those tabs is still unpaid. Drinks
// still waiting for the waiter's "I got them" are counted as given (they left the bar).
export async function barWaiters(env, user, { stationId }) {
  if (!requireRole(user, BAR_HANDS)) return FORBIDDEN;
  const stations = (await listDocs(env, 'bar_stations')).sort((a, b) => a.fields.name.localeCompare(b.fields.name));
  const st = stations.find(s => s.id === stationId) || stations[0];
  if (!st) return { stationId: null, waiters: [] };
  const date = bizDate();
  const given = (await queryWhere(env, 'rounds', [{ field: 'stationId', value: st.id }, { field: 'businessDate', value: date }]))
    .map(r => ({ id: r.id, ...r.fields })).filter(r => r.handedAt && ['handed', 'received', 'delivered'].includes(r.status));
  const tabIds = [...new Set(given.map(r => r.tabId).filter(Boolean))];
  const tabs = new Map();
  for (const tid of tabIds) {
    const t = await getDoc(env, 'tabs', tid); if (!t) continue;
    tabs.set(tid, { t: { id: t.id, ...t.fields }, bill: billOf(t.fields, await roundsOf(env, tid)) });
  }
  const people = new Map();
  for (const r of given) {
    const w = people.get(r.waiterUid) || { uid: r.waiterUid, name: r.waiterName || 'Waiter', givenQty: 0, givenPesewas: 0, notConfirmedQty: 0, tabs: new Map() };
    const tab = w.tabs.get(r.tabId) || { id: r.tabId, number: r.tabNumber, table: r.table || '', given: new Map(), givenPesewas: 0, lastAt: '' };
    for (const l of r.lines) {
      const n = Math.max(0, l.qty - (l.returnedQty || 0)); if (!n) continue;
      const k = `${l.productId}|${l.unitPesewas}`, cur = tab.given.get(k) || { name: l.name, qty: 0, amountPesewas: 0 };
      cur.qty += n; cur.amountPesewas += n * l.unitPesewas; tab.given.set(k, cur);
      tab.givenPesewas += n * l.unitPesewas; w.givenQty += n; w.givenPesewas += n * l.unitPesewas;
      if (r.status === 'handed') w.notConfirmedQty += n;
    }
    if (String(r.handedAt) > tab.lastAt) tab.lastAt = r.handedAt;
    w.tabs.set(r.tabId, tab); people.set(r.waiterUid, w);
  }
  const waiters = [...people.values()].map(w => {
    const list = [...w.tabs.values()].map(x => {
      const info = tabs.get(x.id), b = info?.bill;
      return { id: x.id, number: x.number, table: x.table, quick: !!info?.t.quick, status: info?.t.status || 'open', payStatus: b?.status || 'unpaid', payLabel: PAY_LABEL[b?.status || 'unpaid'],
        totalPesewas: b?.totalPesewas || 0, paidPesewas: b?.paidPesewas || 0, balancePesewas: b?.balancePesewas || 0,
        given: [...x.given.values()], givenPesewas: x.givenPesewas, lastAt: x.lastAt };
    }).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
    return { uid: w.uid, name: w.name, givenQty: w.givenQty, givenPesewas: w.givenPesewas, notConfirmedQty: w.notConfirmedQty,
      unpaidPesewas: list.reduce((n, t) => n + (t.status === 'open' ? t.balancePesewas : 0), 0), openTabs: list.filter(t => t.status === 'open').length, tabs: list };
  }).sort((a, b) => b.givenPesewas - a.givenPesewas);
  return { stationId: st.id, stationName: st.fields.name, date, waiters };
}

const issueMoves = (rid, f) => f.lines.map(l => ({ productId: l.productId, productName: l.name, stationId: f.stationId, qty: -l.qty, kind: 'issue', ref: rid, tabId: f.tabId, toWaiterUid: f.waiterUid, toWaiterName: f.waiterName, businessDate: f.businessDate }));

export async function barRound(env, b, user) {
  if (!requireRole(user, BAR_HANDS)) return FORBIDDEN;
  const rid = String(b?.roundId || ''), action = b?.action;
  let moves = null;
  const res = await withTransaction(env, async tx => {
    const r = foundFields(await batchGet(env, [`rounds/${rid}`], tx), `/rounds/${rid}`);
    if (!r) return { error: 'Order not found.', status: 404 };
    const f = r.fields, at = now(), byName = user.name || '';
    let next;
    if (action === 'preparing') { if (f.status !== 'waiting') return { error: 'Already started.' }; next = { ...f, status: 'preparing', preparingAt: at, preparingByName: byName }; }
    else if (action === 'ready') { if (!['waiting', 'preparing'].includes(f.status)) return { error: 'This order isn’t being made.' }; next = { ...f, status: 'ready', readyAt: at }; }
    else if (action === 'hand') {
      if (!['waiting', 'preparing', 'ready'].includes(f.status)) return { error: f.status === 'handed' ? 'Already handed over.' : f.status === 'taken' ? 'The waiter says they took it: tap Confirm or Not taken.' : 'This order isn’t at the bar.' };
      next = { ...f, status: 'handed', handedAt: at, handedBy: uidOf(user), handedByName: byName };
      moves = issueMoves(rid, f);
    } else if (action === 'confirm_taken') {
      // The waiter already has the drinks: confirmed by the bar, they leave its stock now.
      if (f.status !== 'taken') return { error: 'Nothing to confirm on this order.' };
      next = { ...f, status: 'received', handedAt: at, handedBy: uidOf(user), handedByName: byName, receivedAt: f.takenAt || at, takenConfirmedAt: at };
      moves = issueMoves(rid, f);
    } else if (action === 'not_taken') {
      if (f.status !== 'taken') return { error: 'Nothing to confirm on this order.' };
      next = { ...f, status: 'ready', takenAt: '', takenByName: '', takenDisputedAt: at, takenDisputedByName: byName };
    } else if (action === 'cant_make') {
      if (!['waiting', 'preparing', 'ready'].includes(f.status)) return { error: 'Already handed over.' };
      // A quick sale is already paid: cancelling it means giving money back. The Manager only.
      if (f.quick && !requireRole(user, ['superAdmin', 'manager'])) return { error: 'This quick sale is paid, so the bar can’t cancel it. Call the Manager.', status: 403 };
      next = { ...f, status: 'cancelled', cancelledAt: at, cancelledByName: byName, cancelReason: clean(b.reason, 120) || 'The bar couldn’t make it' };
    } else if (action === 'confirm_return') {
      const back = f.lines.filter(l => l.returnPending > 0); if (!back.length) return { error: 'Nothing is waiting to come back.' };
      next = { ...f, lines: f.lines.map(l => (l.returnPending > 0 ? { ...l, returnedQty: (l.returnedQty || 0) + l.returnPending, returnPending: 0 } : l)), returnConfirmedAt: at, returnConfirmedByName: byName };
      moves = back.map(l => ({ productId: l.productId, productName: l.name, stationId: f.stationId, qty: l.returnPending, kind: 'return_in', ref: rid, tabId: f.tabId, fromWaiterUid: f.waiterUid, fromWaiterName: f.waiterName }));
    } else return { error: 'Unknown action.' };
    await commitTx(env, [updateWrite(env, 'rounds', rid, next), updateWrite(env, 'audit_logs', id(), { action: `BAR_ROUND_${String(b.action).toUpperCase()}`, actorUid: uidOf(user), actorName: byName, roundId: rid, timestamp: at })], tx);
    return { status: next.status };
  });
  if (!res.error && moves) await addMoves(env, moves, user);
  return res;
}

// ── Money ──
async function staffRecord(env, user) { return (await getDoc(env, 'users', uidOf(user)))?.fields || {}; }
// Waiters and bartenders record what customers paid them; cashiers and managers too; anyone else
// only if a manager ticked "Can collect cash" on their staff record.
export const PAY_TAKERS = [...CASH_TAKERS, 'waitStaff', 'barStaff', 'eventManager'];
export async function canTakeCash(env, user) { return requireRole(user, PAY_TAKERS) || (await staffRecord(env, user)).canCollectCash === true; }
export const METHOD_LABEL = { cash: 'Cash', momo: 'MoMo (to the club’s number)', digital: 'MoMo / card (paid on the bill link)' };

// "Customer paid": cash (into this person's cash bag for the night) or MoMo sent straight to the
// club's MoMo number. A MoMo payment needs the transaction ID from the MoMo text, so finance can
// match it on the MoMo statement; the same ID can't be recorded twice in a night.
// A tip can come with it ({ tipPesewas, tipToUid }): kept apart from the bill (it's the staff
// member's money, see tips.js). With MoMo it shares the payment's transaction ID.
export async function recordPayment(env, b, user) {
  const method = b?.method === 'momo' ? 'momo' : 'cash';
  const tip = await prepareTip(env, b); if (tip.error) return tip;
  const r = await (method === 'momo' ? recordMomo(env, b, user, tip) : recordCash(env, b, user, tip));
  if (r.recorded && !tip.none) { r.tip = { toName: tip.to.name, amountPesewas: tip.amount }; await textTip(env, await phoneOf(env, tip.to.uid), tip, method); }
  // MoMo to the club's number: the Manager is texted (cash is counted at the cash count instead).
  if (r.recorded && method === 'momo') await paymentAlert(env, { amountPesewas: int(b?.amountPesewas), kind: 'momo', where: `Tab ${r.tabNumber}`, byName: user.name, tipPesewas: tip.none ? 0 : tip.amount });
  return r;
}
const tipWrite = (env, tip, extra) => (tip && !tip.none ? [updateWrite(env, 'tips', id(), tipFields(tip, extra))] : []);

// The MoMo transaction ID (from the customer's MoMo text): needed, and only once a night.
export async function momoCheck(env, b, date) {
  const ref = String(b?.momoRef || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 40);
  if (ref.length < 6) return { error: 'Enter the MoMo transaction ID from the customer’s MoMo text (at least 6 letters or numbers).' };
  const from = b?.momoFrom ? normalizePhone(b.momoFrom) : '';
  if (b?.momoFrom && !from) return { error: 'That MoMo number doesn’t look right, or leave it blank.' };
  const tonight = await queryWhere(env, 'tabs', [{ field: 'businessDate', value: date }]);
  const dup = tonight.find(t => (t.fields.payments || []).some(p => p.method === 'momo' && p.momoRef === ref));
  if (dup) return { error: `That MoMo transaction ID is already recorded (Tab ${dup.fields.number}). Check the ID.` };
  const tipDup = (await queryWhere(env, 'tips', [{ field: 'momoRef', value: ref }], { limit: 1 }))[0];
  if (tipDup) return { error: `That MoMo transaction ID is already recorded (a tip for ${String(tipDup.fields.toName || '').split(/\s+/)[0]}). Check the ID.` };
  return { ref, from };
}

async function recordMomo(env, b, user, tip = null) {
  if (!(await canTakeCash(env, user))) return { error: 'Your job doesn’t include recording payments. Send the customer to the cashier.', status: 403 };
  const amount = int(b?.amountPesewas);
  if (!(amount >= 100)) return { error: 'Enter the amount (at least GHS 1).' };
  const date = bizDate(), closed = await closedError(env, date); if (closed) return closed;
  const m = await momoCheck(env, b, date); if (m.error) return m;
  const { ref, from } = m;
  const tabId = String(b?.tabId || '');
  return withTransaction(env, async tx => {
    const t = foundFields(await batchGet(env, [`tabs/${tabId}`], tx), `/tabs/${tabId}`);
    if (!t) return { error: 'Tab not found.', status: 404 };
    if (t.fields.status === 'written_off') return { error: 'This tab was written off. Ask a manager.' };
    const bill = billOf(t.fields, await roundsOf(env, tabId));
    if (amount > bill.balancePesewas) return { error: bill.balancePesewas ? `The balance is ${ghs(bill.balancePesewas)}. Record that amount; anything extra goes back to the customer.` : 'This tab is already paid.' };
    const payId = id(), at = now();
    const pay = { id: payId, method: 'momo', amountPesewas: amount, at, businessDate: date, by: uidOf(user), byName: user.name || '', momoRef: ref, momoFrom: from };
    await commitTx(env, [
      updateWrite(env, 'tabs', tabId, { ...t.fields, payments: [...(t.fields.payments || []), pay] }),
      updateWrite(env, 'audit_logs', id(), { action: 'MOMO_PAYMENT', actorUid: uidOf(user), actorName: user.name || '', tabId, amountPesewas: amount, momoRef: ref, ...(tip && !tip.none ? { tipPesewas: tip.amount, tipToUid: tip.to.uid } : {}), timestamp: at }),
      ...tipWrite(env, tip, { method: 'momo', source: 'tab', user, date, at, momoRef: ref, momoFrom: from, tabId, tabNumber: t.fields.number, paymentId: payId }),
    ], tx);
    return { recorded: true, method: 'momo', balancePesewas: bill.balancePesewas - amount, receiptId: payId, tabNumber: t.fields.number };
  });
}

// This person's cash bag for the night. Waiters, bartenders and managers start at GHS 0; a
// cashier opens theirs by counting a float first.
export async function cashBag(env, user, date) {
  const sid = `${date}__${uidOf(user)}`;
  let session = await getDoc(env, 'cash_sessions', sid);
  if (!session) {
    if (requireRole(user, ['cashier'])) return { error: 'Open your cash shift first (count your float).', code: 'no_session' };
    await setDoc(env, 'cash_sessions', sid, { date, uid: uidOf(user), name: user.name || '', role: user.role, floatPesewas: 0, status: 'open', openedAt: now(), payments: [], movements: [] });
    session = await getDoc(env, 'cash_sessions', sid);
  }
  if (session.fields.status !== 'open') return { error: 'You already handed in your cash for tonight. Ask a manager.' };
  return { sid };
}

export async function recordCash(env, b, user, tip = null) {
  if (!(await canTakeCash(env, user))) return { error: 'Your job doesn’t include taking cash. Send the customer to the cashier.', status: 403 };
  const amount = int(b?.amountPesewas);
  if (!(amount >= 100)) return { error: 'Enter the cash amount (at least GHS 1).' };
  const date = bizDate();
  const cs = await cashBag(env, user, date); if (cs.error) return cs;
  const { sid } = cs;
  const tabId = String(b?.tabId || '');
  return withTransaction(env, async tx => {
    const got = await batchGet(env, [`tabs/${tabId}`, `cash_sessions/${sid}`], tx);
    const t = foundFields(got, `/tabs/${tabId}`), s = foundFields(got, `/cash_sessions/${sid}`);
    if (!t) return { error: 'Tab not found.', status: 404 };
    if (t.fields.status === 'written_off') return { error: 'This tab was written off. Ask a manager.' };
    const bill = billOf(t.fields, await roundsOf(env, tabId));
    if (amount > bill.balancePesewas) return { error: bill.balancePesewas ? `The balance is ${ghs(bill.balancePesewas)}. Record that, and give change from the cash.` : 'This tab is already paid.' };
    const payId = id(), at = now();
    const pay = { id: payId, method: 'cash', amountPesewas: amount, at, businessDate: date, by: uidOf(user), byName: user.name || '', sessionId: sid };
    await commitTx(env, [
      updateWrite(env, 'tabs', tabId, { ...t.fields, payments: [...(t.fields.payments || []), pay] }),
      updateWrite(env, 'cash_sessions', sid, { ...s.fields, payments: [...(s.fields.payments || []), { id: payId, tabId, tabNumber: t.fields.number, amountPesewas: amount, at }] }),
      updateWrite(env, 'audit_logs', id(), { action: 'CASH_PAYMENT', actorUid: uidOf(user), actorName: user.name || '', tabId, amountPesewas: amount, ...(tip && !tip.none ? { tipPesewas: tip.amount, tipToUid: tip.to.uid } : {}), timestamp: at }),
      ...tipWrite(env, tip, { method: 'cash', source: 'tab', user, date, at, tabId, tabNumber: t.fields.number, paymentId: payId }),
    ], tx);
    return { recorded: true, balancePesewas: bill.balancePesewas - amount, receiptId: payId };
  });
}

// ── Quick sale ──
// { lines: [{productId, qty}], method: cash|momo, momoRef?, momoFrom?, stationId?, fromBar? }
// A waiter: the drinks go to the bar as an order, already paid; the waiter taps "I got them" and the
// sale closes itself. The bar (fromBar): served over the counter, out of stock and closed at once.
export async function quickSale(env, b, user) {
  const fromBar = b?.fromBar === true;
  if (!requireRole(user, fromBar ? BAR_HANDS : WAITERS)) return FORBIDDEN;
  if (!(await canTakeCash(env, user))) return { error: 'Your job doesn’t include taking payments. Ask a manager.', status: 403 };
  const date = bizDate(), closed = await closedError(env, date); if (closed) return closed;
  const stations = (await listDocs(env, 'bar_stations')).sort((a, c) => a.fields.name.localeCompare(c.fields.name));
  const st = stations.find(x => x.id === b?.stationId) || stations[0];
  if (!st) return { error: 'No bar is set up yet. Ask a manager (Setup → Bar orders).' };
  const want = (Array.isArray(b?.lines) ? b.lines : []).map(x => ({ productId: String(x?.productId || ''), qty: int(x?.qty) })).filter(x => x.productId && x.qty > 0);
  if (!want.length) return { error: 'Pick at least one drink.' };
  if (want.length > MAX_LINES || want.some(x => x.qty > MAX_QTY)) return { error: `Up to ${MAX_QTY} of each drink in one sale.` };
  const got = await batchGet(env, want.map(x => `menu_items/${x.productId}`));
  const lines = [];
  for (const x of want) {
    const p = foundFields(got, `/menu_items/${x.productId}`);
    if (!p || p.fields.available === false || !(Number(p.fields.pricePesewas) > 0)) return { error: `${p?.fields?.name || 'A drink you picked'} isn’t available. Take it off.` };
    const same = lines.find(l => l.productId === x.productId);
    if (same) same.qty += x.qty;
    else lines.push({ lineId: id().slice(0, 12), productId: x.productId, name: p.fields.name, unitPesewas: Number(p.fields.pricePesewas), qty: x.qty, returnedQty: 0, brokenQty: 0, compQty: 0, returnPending: 0 });
  }
  const short = await stockError(env, st.id, lines); if (short) return { error: short };
  const total = lines.reduce((n, l) => n + l.qty * l.unitPesewas, 0);
  const method = b?.method === 'momo' ? 'momo' : 'cash';
  // The customer's phone (optional): so their spending tonight adds up under one name.
  const custPhone = b?.customerPhone ? normalizePhone(b.customerPhone) : '';
  if (b?.customerPhone && !custPhone) return { error: 'That customer phone number doesn’t look right, or leave it blank.' };
  const tip = await prepareTip(env, b); if (tip.error) return tip;
  let momo = null, bag = null;
  if (method === 'momo') { momo = await momoCheck(env, b, date); if (momo.error) return momo; }
  else { bag = await cashBag(env, user, date); if (bag.error) return bag; }
  const tabId = id(), rid = id(), payId = id(), at = now(), uid = uidOf(user), byName = user.name || '';
  const pay = { id: payId, method, amountPesewas: total, at, businessDate: date, by: uid, byName, ...(momo ? { momoRef: momo.ref, momoFrom: momo.from } : { sessionId: bag.sid }) };
  const round = { tabId, businessDate: date, stationId: st.id, waiterUid: uid, waiterName: byName, table: 'Quick sale', lines, note: '', createdAt: at, sentBy: uid, quick: true,
    ...(fromBar ? { status: 'delivered', handedAt: at, handedBy: uid, handedByName: byName, receivedAt: at, deliveredAt: at, soldAtBar: true } : { status: 'waiting' }) };
  const number = await withTransaction(env, async tx => {
    const key = `tabs_${date}`, paths = [`counters/${key}`, ...(bag ? [`cash_sessions/${bag.sid}`] : [])];
    const res = await batchGet(env, paths, tx);
    const n = Number(foundFields(res, `/counters/${key}`)?.fields?.n || 0) + 1;
    const writes = [
      updateWrite(env, 'counters', key, { n }),
      updateWrite(env, 'tabs', tabId, { number: n, businessDate: date, stationId: st.id, stationName: st.fields.name, table: 'Quick sale', customerName: clean(b?.customerName, 60), customerPhone: custPhone || (momo?.from || ''), quick: true, soldAtBar: fromBar,
        waiterUid: uid, waiterName: byName, status: fromBar ? 'closed' : 'open', ...(fromBar ? { closedAt: at, closedByName: byName } : {}), billToken: id(), payments: [pay], discounts: [], createdAt: at }),
      updateWrite(env, 'rounds', rid, { ...round, tabNumber: n }),
      updateWrite(env, 'audit_logs', id(), { action: method === 'momo' ? 'QUICK_SALE_MOMO' : 'QUICK_SALE_CASH', actorUid: uid, actorName: byName, tabId, amountPesewas: total, fromBar, ...(momo ? { momoRef: momo.ref } : {}), ...(tip.none ? {} : { tipPesewas: tip.amount, tipToUid: tip.to.uid }), timestamp: at }),
      ...tipWrite(env, tip, { method, source: 'quick', user, date, at, tabId, tabNumber: n, paymentId: payId, ...(momo ? { momoRef: momo.ref, momoFrom: momo.from } : {}) }),
    ];
    if (bag) {
      const s = foundFields(res, `/cash_sessions/${bag.sid}`);
      writes.push(updateWrite(env, 'cash_sessions', bag.sid, { ...s.fields, payments: [...(s.fields.payments || []), { id: payId, tabId, tabNumber: n, amountPesewas: total, at }] }));
    }
    await commitTx(env, writes, tx);
    return n;
  });
  if (fromBar) await addMoves(env, lines.map(l => ({ productId: l.productId, productName: l.name, stationId: st.id, qty: -l.qty, kind: 'issue', ref: rid, tabId, quickSale: true, businessDate: date })), user);
  if (!tip.none) await textTip(env, await phoneOf(env, tip.to.uid), tip, method);
  if (method === 'momo') await paymentAlert(env, { amountPesewas: total, kind: 'momo', where: `Quick sale, Tab ${number}`, byName: user.name, tipPesewas: tip.none ? 0 : tip.amount });
  return { id: tabId, number, label: `Tab ${number}`, roundId: rid, totalPesewas: total, method, ...(tip.none ? {} : { tip: { toName: tip.to.name, amountPesewas: tip.amount } }) };
}

export async function closeTab(env, b, user) {
  if (!requireRole(user, [...WAITERS, 'cashier'])) return FORBIDDEN;
  const t = await getDoc(env, 'tabs', String(b?.tabId || ''));
  if (!t) return { error: 'Tab not found.', status: 404 };
  if (!mineOrBoss(user, t.fields) && !requireRole(user, ['cashier'])) return FORBIDDEN;
  if (t.fields.status !== 'open') return { error: 'Already closed.' };
  const rounds = await roundsOf(env, t.id), bill = billOf(t.fields, rounds);
  if (rounds.some(r => !['delivered', 'cancelled'].includes(r.status))) return { error: 'Some drinks on this tab aren’t delivered yet.' };
  if (bill.balancePesewas > 0) return { error: `${ghs(bill.balancePesewas)} is still unpaid. Take the payment first, or ask a manager to write it off.` };
  await setDoc(env, 'tabs', t.id, { ...t.fields, status: 'closed', closedAt: now(), closedByName: user.name || '' });
  await audit(env, user, 'TAB_CLOSED', { tabId: t.id });
  return { closed: true };
}

// The invoice by text: every drink with its price, the total, what's paid and what's left, and the
// link to see it and pay with MoMo or card. Long bills list the first drinks and count the rest.
export function invoiceText(env, tab, bill) {
  const where = tab.table && tab.table !== 'Walk-in' ? `Table ${String(tab.table).replace(/^table\s*/i, '')}` : 'Walk-in';
  const items = bill.lines.slice(0, 8).map(l => `${l.qty} x ${l.name.slice(0, 24)} ${ghs(l.amountPesewas)}`);
  if (bill.lines.length > 8) items.push(`+ ${bill.lines.length - 8} more on the link`);
  return ['MEMORIES INVOICE', `Tab ${tab.number} · ${where}`, ...items,
    ...(bill.discountPesewas ? [`Discount -${ghs(bill.discountPesewas)}`] : []),
    `Total ${ghs(bill.totalPesewas)}`, ...(bill.paidPesewas ? [`Paid ${ghs(bill.paidPesewas)}`] : []),
    bill.balancePesewas ? `To pay ${ghs(bill.balancePesewas)}` : 'Fully paid. Thank you!',
    ...(bill.balancePesewas ? [`Pay with MoMo or card: ${siteUrl(env, `/bill.html?t=${tab.billToken}`)}`] : [])].join('\n');
}

export async function textBill(env, b, user) {
  if (!requireRole(user, [...WAITERS, 'cashier'])) return FORBIDDEN;
  const t = await getDoc(env, 'tabs', String(b?.tabId || ''));
  if (!t) return { error: 'Tab not found.', status: 404 };
  const phone = normalizePhone(b.phone || t.fields.customerPhone);
  if (!phone) return { error: 'Enter the customer’s phone number.' };
  const bill = billOf(t.fields, await roundsOf(env, t.id));
  if (!bill.totalPesewas) return { error: 'Add drinks first: the invoice is empty.' };
  const sent = await sendSms(env, phone, invoiceText(env, t.fields, bill));
  if (phone !== t.fields.customerPhone) await setDoc(env, 'tabs', t.id, { ...t.fields, customerPhone: phone });
  return { sent, phoneHint: maskPhone(phone) };
}

// ── The customer's bill link (no sign-in; the link is the key, and it can only read and pay) ──
const PUBLIC = { error: 'This bill link isn’t valid.', status: 404 };
async function tabByToken(env, token) {
  if (!/^[0-9a-f]{32}$/.test(String(token || ''))) return null;
  return (await queryWhere(env, 'tabs', [{ field: 'billToken', value: String(token) }], { limit: 1 }))[0] || null;
}
export async function publicBill(env, token) {
  const t = await tabByToken(env, token); if (!t) return PUBLIC;
  const bill = billOf(t.fields, await roundsOf(env, t.id));
  // Paid, but staying: the table stays open for more drinks (from the waiter, or the bar's menu
  // on this phone when the bar is taking app orders).
  const st = t.fields.status === 'open' && t.fields.stationId ? await getDoc(env, 'bar_stations', t.fields.stationId).catch(() => null) : null;
  const menuUrl = st?.fields?.open && /^[0-9a-f]{32}$/.test(st.fields.token || '') ? `counter.html?s=${st.fields.token}${t.fields.table && t.fields.table !== 'Walk-in' ? `&t=${encodeURIComponent(t.fields.table)}` : ''}` : '';
  return { open: t.fields.status === 'open', menuUrl, bill: { label: `Tab ${t.fields.number}`, table: t.fields.table, waiterFirstName: String(t.fields.waiterName || '').split(/\s+/)[0], date: t.fields.businessDate, lines: bill.lines, grossPesewas: bill.grossPesewas, discountPesewas: bill.discountPesewas, totalPesewas: bill.totalPesewas, paidPesewas: bill.paidPesewas, balancePesewas: bill.balancePesewas, status: bill.status, statusLabel: PAY_LABEL[bill.status],
    payments: (t.fields.payments || []).map(p => ({ method: p.method === 'cash' ? 'Cash' : 'MoMo', amountPesewas: p.amountPesewas, at: p.at })), paying: !!(t.fields.pending && Date.now() - new Date(t.fields.pending.at).getTime() < 30 * 60e3) },
    // A tip with the payment: for their waiter by default, or anyone on the team.
    tip: { people: (await guestTipPeople(env)).people, defaultId: t.fields.waiterUid || '' } };
}

async function paystackInit(env, payload) {
  const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!r.ok || !d.status) throw new Error(d.message || 'Paystack request failed');
  return d.data;
}
// Pay now: the balance at this moment. If more drinks are added while paying, the new amount
// stays as balance (the payment only ever counts for what it was started for).
export async function startBillPayment(env, token, b) {
  const t = await tabByToken(env, token); if (!t) return PUBLIC;
  if (t.fields.status === 'written_off') return { error: 'This bill was closed by the manager. Talk to your waiter.' };
  const bill = billOf(t.fields, await roundsOf(env, t.id));
  if (bill.balancePesewas < 100) return { error: bill.balancePesewas ? 'The balance is less than GHS 1. Pay it in cash.' : 'This bill is already paid. Thank you!' };
  // An optional tip, on top of the bill, for whoever the customer picks (their waiter by default).
  const tip = await prepareTip(env, b); if (tip.error) return tip;
  const tipPesewas = tip.none ? 0 : tip.amount, tipToUid = tip.none ? '' : tip.to.uid;
  const p = t.fields.pending;
  if (p && p.amountPesewas === bill.balancePesewas && Number(p.tipPesewas || 0) === tipPesewas && (p.tipToUid || '') === tipToUid && Date.now() - new Date(p.at).getTime() < 30 * 60e3) {
    const pc = await getDoc(env, 'pending_checkouts', p.reference);
    if (pc?.fields?.status === 'pending') return { authorizationUrl: p.url, reference: p.reference };
  }
  const reference = paymentRef(), phone = normalizePhone(b?.phone) || t.fields.customerPhone || '';
  const host = new URL(env.PUBLIC_SITE_URL || 'https://memoriesnightclub.com').hostname.replace(/^www\./, '');
  // The charge is the bill plus the tip; the tip is split off again when Paystack confirms it.
  await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'tab', tabId: t.id, eventName: `Tab ${t.fields.number}`, amountPesewas: bill.balancePesewas + tipPesewas, ...(tipPesewas ? { tipPesewas, tipToUid, tipToName: tip.to.name, tipToRole: tip.to.role } : {}), buyerPhone: phone, status: 'pending', createdAt: now() });
  try {
    const d = await paystackInit(env, { email: validEmail(b?.email) ? b.email : `tab-${phone || t.id.slice(0, 8)}@${host}`, amount: bill.balancePesewas + tipPesewas, currency: 'GHS', reference, callback_url: siteUrl(env, `/bill.html?t=${t.fields.billToken}`), metadata: { kind: 'tab', tabId: t.id } });
    await setDoc(env, 'tabs', t.id, { ...t.fields, pending: { reference, amountPesewas: bill.balancePesewas, tipPesewas, tipToUid, at: now(), url: d.authorization_url } });
    return { authorizationUrl: d.authorization_url, reference };
  } catch (e) {
    await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'tab', tabId: t.id, status: 'failed', error: 'payment_initialization_failed', failedAt: now() });
    throw e;
  }
}

// Called by checkout.fulfill() once Paystack confirms the charge (amount already checked).
export async function issueTabPayment(env, reference, P) {
  return withTransaction(env, async tx => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `tabs/${P.tabId}`], tx);
    const pc = foundFields(got, `/pending_checkouts/${reference}`), t = foundFields(got, `/tabs/${P.tabId}`);
    if (!pc || !t) throw new Error('Tab payment data disappeared.');
    if (pc.fields.status === 'issued') return { status: 'issued', kind: 'tab', tabId: P.tabId };
    if ((t.fields.payments || []).some(p => p.id === reference)) return { status: 'issued', kind: 'tab', tabId: P.tabId };
    const at = now(), date = bizDate();
    // A tip rode on the charge: the bill gets the rest; the tip is owed to the person picked.
    const tipPesewas = Number(pc.fields.tipPesewas || 0);
    const pay = { id: reference, method: 'digital', amountPesewas: Number(pc.fields.amountPesewas) - tipPesewas, at, businessDate: date, reference };
    const pending = t.fields.pending?.reference === reference ? null : t.fields.pending || null;
    const tip = tipPesewas ? { amount: tipPesewas, to: { uid: pc.fields.tipToUid, name: pc.fields.tipToName || '', role: pc.fields.tipToRole || '' } } : null;
    await commitTx(env, [
      updateWrite(env, 'tabs', P.tabId, { ...t.fields, payments: [...(t.fields.payments || []), pay], pending }),
      updateWrite(env, 'pending_checkouts', reference, { ...pc.fields, status: 'issued', issuedAt: at }),
      ...(tip ? [updateWrite(env, 'tips', `tip_${reference}`, tipFields(tip, { method: 'digital', source: 'bill', date, at, reference, tabId: P.tabId, tabNumber: t.fields.number, paymentId: reference }))] : []),
    ], tx);
    return { status: 'issued', kind: 'tab', tabId: P.tabId, tip, fresh: { amountPesewas: pay.amountPesewas, where: `Tab ${t.fields.number}`, byName: t.fields.waiterName || '' } };
  }).then(async r => {
    if (r.tip) await textTip(env, await phoneOf(env, r.tip.to.uid), r.tip, 'digital');
    // Paystack confirmed it: the Manager is texted.
    if (r.fresh) await paymentAlert(env, { ...r.fresh, kind: 'digital', tipPesewas: r.tip?.amount || 0 });
    delete r.fresh; return r;
  });
}

// Cashier: find a bill by tab number, table or name.
export async function findTabs(env, user, q) {
  if (!requireRole(user, [...CASH_TAKERS, 'waitStaff', 'finance'])) return FORBIDDEN;
  const s = String(q || '').trim().toLowerCase().replace(/^tab\s*/, '');
  const open = (await queryWhere(env, 'tabs', [{ field: 'status', value: 'open' }])).map(t => ({ id: t.id, ...t.fields }));
  const hits = open.filter(t => !s || String(t.number) === s || String(t.table).toLowerCase().includes(s) || String(t.customerName).toLowerCase().includes(s) || String(t.waiterName).toLowerCase().includes(s)).slice(0, 30);
  const out = [];
  for (const t of hits) out.push(tabView(t, await roundsOf(env, t.id), { full: false }));
  return { tabs: out.sort((a, b) => b.number - a.number) };
}
