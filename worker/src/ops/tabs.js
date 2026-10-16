// Customer tabs: a waiter takes the order (no QR needed), the bar makes it, the customer pays on
// their phone (Paystack) or in cash. QR self-ordering (bar.js) uses the same menu and stock.
//
//   tabs/{id}    number ("Tab 27", counted per night), businessDate, stationId, table, customerName,
//                customerPhone, waiterUid, waiterName, status open|closed|written_off, billToken
//                (the customer's bill link), payments[{id, method cash|digital, amountPesewas, at,
//                byName, sessionId?}], discounts[{amountPesewas, reason, approvedByName}], pending
//                (a Paystack payment in progress)
//   rounds/{id}  one order sent to the bar: tabId, tabNumber, stationId, waiterUid, table, lines
//                [{lineId, productId, name, unitPesewas, qty, returnedQty, brokenQty, compQty,
//                returnPending}], status waiting → preparing → ready → handed → received →
//                delivered, or cancelled
// Prices are copied onto the round when it's sent, so a menu price change never moves a bill.
// Stock leaves the bar once, when the bar hands the round to the waiter (stock_moves 'issue');
// drinks the waiter brings back come back in ('return_in') once the bar confirms them.
import { getDoc, setDoc, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction, listDocs } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone, paymentRef, validEmail } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { sendSms, siteUrl } from '../lib/notify.js';
import { FORBIDDEN, bizDate, who, audit, closedError, ghs, int } from './common.js';
import { addMoves } from './stock.js';

export const BOSS = ['superAdmin', 'director', 'manager'];
export const WAITERS = [...BOSS, 'waitStaff'];
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
    id: t.id, number: t.number, label: `Tab ${t.number}`, businessDate: t.businessDate, table: t.table || '', customerName: t.customerName || '', customerPhoneHint: t.customerPhone ? maskPhone(t.customerPhone) : '',
    waiterUid: t.waiterUid, waiterName: t.waiterName, stationId: t.stationId, stationName: t.stationName, status: t.status, payStatus: bill.status, payLabel: PAY_LABEL[bill.status],
    bill, payments: (t.payments || []).map(p => ({ method: p.method, amountPesewas: p.amountPesewas, at: p.at, byName: p.byName || '' })),
    openRounds: rounds.filter(r => !['delivered', 'cancelled'].includes(r.status)).length,
    ...(full ? { rounds: rounds.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(roundView), billUrl: null } : {}),
    createdAt: t.createdAt,
  };
};
export const ROUND_LABEL = { waiting: 'Sent to bar', preparing: 'Bar is making it', ready: 'Ready at the bar', handed: 'Bar handed it to you', received: 'With you', delivered: 'Delivered', cancelled: 'Cancelled' };
const roundView = r => ({ id: r.id, tabId: r.tabId, tabNumber: r.tabNumber, table: r.table || '', status: r.status, statusLabel: ROUND_LABEL[r.status], waiterUid: r.waiterUid, waiterName: r.waiterName, stationId: r.stationId,
  lines: r.lines.map(l => ({ lineId: l.lineId, productId: l.productId, name: l.name, qty: l.qty, unitPesewas: l.unitPesewas, returnedQty: l.returnedQty || 0, brokenQty: l.brokenQty || 0, compQty: l.compQty || 0, returnPending: l.returnPending || 0 })),
  note: r.note || '', createdAt: r.createdAt, handedByName: r.handedByName || '', cancelReason: r.cancelReason || '' });

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
  const tabId = id();
  const number = await withTransaction(env, async tx => {
    const key = `tabs_${date}`, got = foundFields(await batchGet(env, [`counters/${key}`], tx), `/counters/${key}`);
    const n = Number(got?.fields?.n || 0) + 1;
    await commitTx(env, [
      updateWrite(env, 'counters', key, { n }),
      updateWrite(env, 'tabs', tabId, { number: n, businessDate: date, stationId: st.id, stationName: st.fields.name, table: walkIn ? 'Walk-in' : table, customerName: clean(b.customerName, 60), customerPhone: phone,
        waiterUid: uidOf(user), waiterName: user.name || '', status: 'open', billToken: id(), payments: [], discounts: [], createdAt: now() }),
    ], tx);
    return n;
  });
  await audit(env, user, 'TAB_OPENED', { tabId, number, table: walkIn ? 'Walk-in' : table });
  return { id: tabId, number, label: `Tab ${number}` };
}

export async function myTabs(env, user, { all = false } = {}) {
  if (!requireRole(user, [...WAITERS, 'cashier'])) return FORBIDDEN;
  const everyone = all && requireRole(user, [...BOSS, 'cashier']);
  const open = await queryWhere(env, 'tabs', everyone ? [{ field: 'status', value: 'open' }] : [{ field: 'status', value: 'open' }, { field: 'waiterUid', value: uidOf(user) }]);
  const today = (await queryWhere(env, 'tabs', [{ field: 'businessDate', value: bizDate() }])).filter(t => t.fields.status !== 'open' && (everyone || t.fields.waiterUid === uidOf(user)));
  const out = [];
  for (const t of [...open, ...today]) out.push(tabView({ id: t.id, ...t.fields }, await roundsOf(env, t.id), { full: false }));
  return { tabs: out.sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.number - a.number) };
}

export async function getTab(env, user, tabId) {
  const t = await getDoc(env, 'tabs', String(tabId || ''));
  if (!t) return { error: 'Tab not found.', status: 404 };
  if (!mineOrBoss(user, t.fields) && !requireRole(user, ['cashier', 'finance', 'barStaff'])) return FORBIDDEN;
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
  const rid = id();
  await setDoc(env, 'rounds', rid, { tabId: t.id, tabNumber: t.fields.number, businessDate: bizDate(), stationId: t.fields.stationId, waiterUid: t.fields.waiterUid, waiterName: t.fields.waiterName, table: t.fields.table, lines, status: 'waiting', note: clean(b.note, 120), createdAt: now(), sentBy: uidOf(user) });
  return { id: rid, totalPesewas: lines.reduce((n, l) => n + l.qty * l.unitPesewas, 0) };
}

// Waiter steps on a round: cancel (before the bar starts), got them, delivered, broken, send back.
export async function waiterRound(env, b, user) {
  if (!requireRole(user, WAITERS)) return FORBIDDEN;
  const rid = String(b?.roundId || ''), action = b?.action;
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
    } else if (action === 'received') {
      if (f.status !== 'handed') return { error: 'The bar hasn’t handed this over yet.' };
      next = { ...f, status: 'received', receivedAt: at };
    } else if (action === 'delivered') {
      if (!['handed', 'received'].includes(f.status)) return { error: f.status === 'delivered' ? 'Already delivered.' : 'Collect it from the bar first.' };
      next = { ...f, status: 'delivered', receivedAt: f.receivedAt || at, deliveredAt: at };
    } else if (action === 'broken' || action === 'return') {
      if (!['handed', 'received', 'delivered'].includes(f.status) || (action === 'return' && f.status === 'delivered')) return { error: action === 'return' ? 'Only drinks you haven’t delivered can go back to the bar.' : 'Only drinks you’ve collected can be recorded as broken.' };
      const qty = int(b.qty), line = f.lines.find(l => l.lineId === b.lineId);
      if (!line) return { error: 'Pick the drink.' };
      const left = line.qty - (line.returnedQty || 0) - (line.brokenQty || 0) - (line.compQty || 0) - (line.returnPending || 0);
      if (!(qty >= 1 && qty <= left)) return { error: `You can record up to ${left} ${line.name}.` };
      const lines = f.lines.map(l => (l.lineId !== line.lineId ? l : action === 'broken' ? { ...l, brokenQty: (l.brokenQty || 0) + qty, brokenNote: clean(b.note, 120) } : { ...l, returnPending: (l.returnPending || 0) + qty }));
      next = { ...f, lines, ...(action === 'broken' ? { brokenAt: at } : { returnRequestedAt: at }) };
    } else return { error: 'Unknown action.' };
    await commitTx(env, [updateWrite(env, 'rounds', rid, next), updateWrite(env, 'audit_logs', id(), { action: `ROUND_${action.toUpperCase()}`, actorUid: uidOf(user), actorName: byName, roundId: rid, tabId: f.tabId, timestamp: at })], tx);
    return { status: next.status };
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
    rounds: all.filter(r => ['waiting', 'preparing', 'ready', 'handed'].includes(r.status)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(roundView),
    returns: all.filter(r => r.lines.some(l => l.returnPending > 0)).map(roundView),
    handedToday: all.filter(r => ['received', 'delivered'].includes(r.status)).length,
  };
}

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
      if (!['waiting', 'preparing', 'ready'].includes(f.status)) return { error: f.status === 'handed' ? 'Already handed over.' : 'This order isn’t at the bar.' };
      next = { ...f, status: 'handed', handedAt: at, handedBy: uidOf(user), handedByName: byName };
      moves = f.lines.map(l => ({ productId: l.productId, productName: l.name, stationId: f.stationId, qty: -l.qty, kind: 'issue', ref: rid, tabId: f.tabId, toWaiterUid: f.waiterUid, toWaiterName: f.waiterName, businessDate: f.businessDate }));
    } else if (action === 'cant_make') {
      if (!['waiting', 'preparing', 'ready'].includes(f.status)) return { error: 'Already handed over.' };
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
export async function canTakeCash(env, user) { return requireRole(user, CASH_TAKERS) || (await staffRecord(env, user)).canCollectCash === true; }

export async function recordCash(env, b, user) {
  if (!(await canTakeCash(env, user))) return { error: 'Your job doesn’t include taking cash. Send the customer to the cashier.', status: 403 };
  const amount = int(b?.amountPesewas);
  if (!(amount >= 100)) return { error: 'Enter the cash amount (at least GHS 1).' };
  const date = bizDate();
  const sid = `${date}__${uidOf(user)}`;
  let session = await getDoc(env, 'cash_sessions', sid);
  if (!session) {
    if (requireRole(user, ['cashier'])) return { error: 'Open your cash shift first (count your float).', code: 'no_session' };
    // Waiters and managers allowed to take cash: their cash bag starts at GHS 0.
    await setDoc(env, 'cash_sessions', sid, { date, uid: uidOf(user), name: user.name || '', role: user.role, floatPesewas: 0, status: 'open', openedAt: now(), payments: [], movements: [] });
    session = await getDoc(env, 'cash_sessions', sid);
  }
  if (session.fields.status !== 'open') return { error: 'Your cash shift is closed. Ask a manager.' };
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
      updateWrite(env, 'audit_logs', id(), { action: 'CASH_PAYMENT', actorUid: uidOf(user), actorName: user.name || '', tabId, amountPesewas: amount, timestamp: at }),
    ], tx);
    return { recorded: true, balancePesewas: bill.balancePesewas - amount, receiptId: payId };
  });
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

export async function textBill(env, b, user) {
  if (!requireRole(user, [...WAITERS, 'cashier'])) return FORBIDDEN;
  const t = await getDoc(env, 'tabs', String(b?.tabId || ''));
  if (!t) return { error: 'Tab not found.', status: 404 };
  const phone = normalizePhone(b.phone || t.fields.customerPhone);
  if (!phone) return { error: 'Enter the customer’s phone number.' };
  const bill = billOf(t.fields, await roundsOf(env, t.id));
  const sent = await sendSms(env, phone, `MEMORIES\nYour bill (Tab ${t.fields.number}): ${ghs(bill.balancePesewas)} to pay.\nSee it and pay on your phone: ${siteUrl(env, `/bill.html?t=${t.fields.billToken}`)}`);
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
  return { bill: { label: `Tab ${t.fields.number}`, table: t.fields.table, waiterFirstName: String(t.fields.waiterName || '').split(/\s+/)[0], date: t.fields.businessDate, lines: bill.lines, grossPesewas: bill.grossPesewas, discountPesewas: bill.discountPesewas, totalPesewas: bill.totalPesewas, paidPesewas: bill.paidPesewas, balancePesewas: bill.balancePesewas, status: bill.status, statusLabel: PAY_LABEL[bill.status],
    payments: (t.fields.payments || []).map(p => ({ method: p.method === 'cash' ? 'Cash' : 'MoMo / card', amountPesewas: p.amountPesewas, at: p.at })), paying: !!(t.fields.pending && Date.now() - new Date(t.fields.pending.at).getTime() < 30 * 60e3) } };
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
  const p = t.fields.pending;
  if (p && p.amountPesewas === bill.balancePesewas && Date.now() - new Date(p.at).getTime() < 30 * 60e3) {
    const pc = await getDoc(env, 'pending_checkouts', p.reference);
    if (pc?.fields?.status === 'pending') return { authorizationUrl: p.url, reference: p.reference };
  }
  const reference = paymentRef(), phone = normalizePhone(b?.phone) || t.fields.customerPhone || '';
  const host = new URL(env.PUBLIC_SITE_URL || 'https://memoriesnightclub.com').hostname.replace(/^www\./, '');
  await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'tab', tabId: t.id, eventName: `Tab ${t.fields.number}`, amountPesewas: bill.balancePesewas, buyerPhone: phone, status: 'pending', createdAt: now() });
  try {
    const d = await paystackInit(env, { email: validEmail(b?.email) ? b.email : `tab-${phone || t.id.slice(0, 8)}@${host}`, amount: bill.balancePesewas, currency: 'GHS', reference, callback_url: siteUrl(env, `/bill.html?t=${t.fields.billToken}`), metadata: { kind: 'tab', tabId: t.id } });
    await setDoc(env, 'tabs', t.id, { ...t.fields, pending: { reference, amountPesewas: bill.balancePesewas, at: now(), url: d.authorization_url } });
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
    const at = now();
    const pay = { id: reference, method: 'digital', amountPesewas: Number(pc.fields.amountPesewas), at, businessDate: bizDate(), reference };
    const pending = t.fields.pending?.reference === reference ? null : t.fields.pending || null;
    await commitTx(env, [
      updateWrite(env, 'tabs', P.tabId, { ...t.fields, payments: [...(t.fields.payments || []), pay], pending }),
      updateWrite(env, 'pending_checkouts', reference, { ...pc.fields, status: 'issued', issuedAt: at }),
    ], tx);
    return { status: 'issued', kind: 'tab', tabId: P.tabId };
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
