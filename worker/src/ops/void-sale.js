// Voiding a sale, and test mode.
//
// A sale is recorded the moment the seller taps it: a cash sale at the door, a tab, a quick sale.
// The system can't know whether money really changed hands, so a manager or director can void one
// (with a reason, kept in the audit log). A voided sale stops counting everywhere: the night's
// sales, the seller's cash for the night, the door's numbers, the tickets stop working, and the
// ticket or table is back on sale.
//   tab    its orders are cancelled, its payments move to voidedPayments (out of the seller's cash),
//          its tips are cancelled, status 'voided'
//   gate   a door sale paid in cash: the order is 'voided', its tickets cancelled and their check-in
//          taken back, the stock put back, and the cash taken out of the seller's cash session
// Not voidable: anything paid through Paystack (real money moved: refund it instead), a tip already
// paid out, or a sale from a closed night unless a director or the administrator does it.
// Stock moves of drinks already handed over are left as they are (the drinks left the bar): recount.
//
// Test mode (config/testmode): while on, new tabs and gate sales are stamped test:true. "Clear test
// sales" voids every one of them in one go. Test mode also turns off SMS and MoMo prompts to real
// phones. See isTestMode in common.js.
import { getDoc, setDoc, queryWhere, queryRecent, commitTx, updateWrite, deleteWrite } from '../lib/firestore.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { now, clean, nightKey } from '../lib/util.js';
import { FORBIDDEN, audit, nightState, bizDate, isDate, isTestMode, forgetTestMode } from './common.js';
import { billOf } from './tabs.js';

export const VOIDERS = ['superAdmin', 'director', 'manager'];
const LATE = ['superAdmin', 'director']; // may void a sale from a night already closed
const DAY = 864e5;

const needReason = b => { const r = clean(b?.reason, 160); return r.length >= 3 ? r : ''; };
const closedBlock = async (env, user, date) => (date && (await nightState(env, date)).status === 'closed' && !requireRole(user, LATE)
  ? { error: 'That night is closed. A director has to void a sale from a closed night.' } : null);

// Void one tab. Returns { voided, amountPesewas } or { error }.
async function voidTabSale(env, user, tabId, reason, { test = false } = {}) {
  const t = await getDoc(env, 'tabs', tabId);
  if (!t) return { error: 'That sale wasn’t found.', status: 404 };
  const f = t.fields;
  if (f.status === 'voided') return { error: 'This sale is already voided.' };
  const pays = f.payments || [];
  if (pays.some(p => p.method === 'digital') || f.pending?.reference) return { error: 'Part of this was paid through Paystack. Real money moved, so refund it instead of voiding it.' };
  const blocked = await closedBlock(env, user, f.businessDate); if (blocked) return blocked;
  const rounds = (await queryWhere(env, 'rounds', [{ field: 'tabId', value: tabId }])).map(r => ({ id: r.id, ...r.fields }));
  const bill = billOf(f, rounds);
  const tips = (await queryWhere(env, 'tips', [{ field: 'tabId', value: tabId }])).filter(x => x.fields.status !== 'cancelled');
  if (tips.some(x => x.fields.status === 'paid')) return { error: 'A tip on this sale was already paid out. Ask finance to sort that first.' };
  const at = now(), payIds = new Set(pays.map(p => p.id));
  const writes = [
    updateWrite(env, 'tabs', tabId, { ...f, status: 'voided', voidedAt: at, voidedBy: uidOf(user), voidedByName: user.name || '', voidReason: reason, ...(test ? { voidedAsTest: true } : {}),
      voidedPayments: pays, voidedTotalPesewas: bill.totalPesewas, payments: [], pending: null }),
    ...rounds.filter(r => r.status !== 'cancelled').map(({ id: rid, ...r }) => updateWrite(env, 'rounds', rid, { ...r, status: 'cancelled', cancelledAt: at, cancelledByName: user.name || '', cancelReason: `Sale voided: ${reason}` })),
    ...tips.map(x => updateWrite(env, 'tips', x.id, { ...x.fields, status: 'cancelled', cancelledAt: at, cancelReason: 'Sale voided' })),
  ];
  // Out of the seller's cash for the night.
  for (const sid of new Set(pays.map(p => p.sessionId).filter(Boolean))) {
    const s = await getDoc(env, 'cash_sessions', sid);
    if (s) writes.push(updateWrite(env, 'cash_sessions', sid, { ...s.fields, payments: (s.fields.payments || []).filter(x => !payIds.has(x.id) && x.tabId !== tabId) }));
  }
  await commitTx(env, writes);
  await audit(env, user, 'SALE_VOIDED', { kind: 'tab', tabId, tabNumber: f.number, amountPesewas: bill.totalPesewas, paidPesewas: bill.paidPesewas, reason, test });
  return { voided: true, amountPesewas: bill.totalPesewas };
}

// Void one door sale (paid in cash).
async function voidGateSale(env, user, orderId, reason, { test = false } = {}) {
  const o = await getDoc(env, 'orders', orderId);
  if (!o || o.fields.channel !== 'gate') return { error: 'That sale wasn’t found.', status: 404 };
  const f = o.fields;
  if (f.status === 'voided') return { error: 'This sale is already voided.' };
  if (f.status !== 'confirmed') return { error: 'This isn’t a finished sale.' };
  if (f.paidWith !== 'cash') return { error: 'This was paid by MoMo through Paystack. Real money moved, so refund it instead of voiding it.' };
  const blocked = await closedBlock(env, user, nightOf(f)); if (blocked) return blocked;
  const at = now(), writes = [updateWrite(env, 'orders', orderId, { ...f, status: 'voided', voidedAt: at, voidedBy: uidOf(user), voidedByName: user.name || '', voidReason: reason, ...(test ? { voidedAsTest: true } : {}) })];
  for (const tid of f.ticketIds || []) {
    const tk = await getDoc(env, 'tickets', tid);
    if (tk) writes.push(updateWrite(env, 'tickets', tid, { ...tk.fields, cancelled: true, status: 'cancelled', voidedAt: at, voidReason: reason }));
    for (const c of await queryWhere(env, 'checkins', [{ field: 'ticketId', value: tid }])) writes.push(deleteWrite(env, 'checkins', c.id));
  }
  // Back on sale.
  if (f.kind === 'ticket' && f.ticketTypeId) { const tt = await getDoc(env, 'ticket_types', f.ticketTypeId); if (tt && typeof tt.fields.remaining === 'number') writes.push(updateWrite(env, 'ticket_types', f.ticketTypeId, { ...tt.fields, remaining: tt.fields.remaining + Number(f.quantity || 0) })); }
  if (f.kind === 'table' && f.packageId && !f.soldFromHold) { const pk = await getDoc(env, 'table_packages', f.packageId); if (pk && typeof pk.fields.remaining === 'number') writes.push(updateWrite(env, 'table_packages', f.packageId, { ...pk.fields, remaining: pk.fields.remaining + 1 })); }
  // Out of the seller's cash: whichever session holds this payment.
  for (const s of await queryWhere(env, 'cash_sessions', [{ field: 'uid', value: f.soldBy }])) {
    if ((s.fields.payments || []).some(x => x.id === orderId)) writes.push(updateWrite(env, 'cash_sessions', s.id, { ...s.fields, payments: s.fields.payments.filter(x => x.id !== orderId) }));
  }
  await commitTx(env, writes);
  await audit(env, user, 'SALE_VOIDED', { kind: 'gate', orderId, amountPesewas: f.amountPesewas, soldByName: f.soldByName, what: f.ticketTypeName || f.packageName || '', reason, test });
  return { voided: true, amountPesewas: Number(f.amountPesewas || 0) };
}
const nightOf = f => f.businessDate || (f.createdAt ? nightKey(f.createdAt) : '');

// POST /api/ops/sales/void  { kind: 'tab' | 'gate', id, reason }
export async function voidSale(env, b, user) {
  if (!requireRole(user, VOIDERS)) return FORBIDDEN;
  const reason = needReason(b); if (!reason) return { error: 'Say why (a few words): it’s kept in the record.' };
  const sid = String(b?.id || '');
  if (!sid) return { error: 'Pick the sale.' };
  if (b?.kind === 'tab') return voidTabSale(env, user, sid, reason);
  if (b?.kind === 'gate') return voidGateSale(env, user, sid, reason);
  return { error: 'Unknown sale.' };
}

// GET /api/ops/sales/door?date=  tonight's door sales, for voiding
export async function doorSales(env, user, { date } = {}) {
  if (!requireRole(user, VOIDERS)) return FORBIDDEN;
  const d = isDate(date) ? date : bizDate();
  const since = new Date(new Date(`${d}T00:00:00Z`).getTime() - DAY);
  const rows = (await queryRecent(env, 'orders', 'createdAt', since, 5000)).map(o => ({ id: o.id, ...o.fields }))
    .filter(o => o.channel === 'gate' && ['confirmed', 'voided'].includes(o.status) && nightOf(o) >= d)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { date: d, sales: rows.map(o => ({ id: o.id, at: o.createdAt, what: o.ticketTypeName ? `${o.quantity} × ${o.ticketTypeName}` : o.packageName || 'Table', amountPesewas: Number(o.amountPesewas || 0), paidWith: o.paidWith, soldByName: o.soldByName || '', buyerName: o.buyerName || '', test: !!o.test, voided: o.status === 'voided', voidReason: o.voidReason || '', canVoid: o.status === 'confirmed' && o.paidWith === 'cash' })) };
}

// ── Test mode ──
export async function testModeStatus(env, user) {
  if (!requireRole(user, VOIDERS)) return FORBIDDEN;
  const doc = (await getDoc(env, 'config', 'testmode'))?.fields || {};
  const [tabs, orders] = await Promise.all([queryWhere(env, 'tabs', [{ field: 'test', value: true }], { limit: 5000 }), queryWhere(env, 'orders', [{ field: 'test', value: true }], { limit: 5000 })]);
  const liveTabs = tabs.filter(t => t.fields.status !== 'voided'), liveOrders = orders.filter(o => o.fields.status === 'confirmed');
  return { on: doc.on === true, since: doc.since || null, byName: doc.byName || '',
    testTabs: liveTabs.length, testDoorSales: liveOrders.length, testPesewas: liveTabs.reduce((n, t) => n + Number((t.fields.payments || []).reduce((m, p) => m + Number(p.amountPesewas || 0), 0)), 0) + liveOrders.reduce((n, o) => n + Number(o.fields.amountPesewas || 0), 0) };
}

export async function setTestMode(env, b, user) {
  if (!requireRole(user, VOIDERS)) return FORBIDDEN;
  const on = b?.on === true;
  await setDoc(env, 'config', 'testmode', { on, since: on ? now() : null, byName: user.name || '', byUid: uidOf(user), changedAt: now() });
  forgetTestMode();
  await audit(env, user, on ? 'TEST_MODE_ON' : 'TEST_MODE_OFF', {});
  return { on };
}

// POST /api/ops/sales/clear-test  { confirm: 'CLEAR' }  voids every test sale
export async function clearTestSales(env, b, user) {
  if (!requireRole(user, VOIDERS)) return FORBIDDEN;
  if (b?.confirm !== 'CLEAR') return { error: 'Confirm first.' };
  const [tabs, orders] = await Promise.all([queryWhere(env, 'tabs', [{ field: 'test', value: true }], { limit: 5000 }), queryWhere(env, 'orders', [{ field: 'test', value: true }], { limit: 5000 })]);
  let cleared = 0, skipped = [];
  for (const t of tabs.filter(t => t.fields.status !== 'voided')) { const r = await voidTabSale(env, user, t.id, 'Test sale', { test: true }); r.voided ? cleared++ : skipped.push(`Tab ${t.fields.number}: ${r.error}`); }
  for (const o of orders.filter(o => o.fields.status === 'confirmed')) { const r = await voidGateSale(env, user, o.id, 'Test sale', { test: true }); r.voided ? cleared++ : skipped.push(`Door sale ${o.fields.ticketTypeName || o.fields.packageName || ''}: ${r.error}`); }
  await audit(env, user, 'TEST_SALES_CLEARED', { cleared, skipped: skipped.length });
  return { cleared, skipped, message: `Cleared ${cleared} test sale${cleared === 1 ? '' : 's'}.${skipped.length ? ` ${skipped.length} could not be cleared.` : ''}` };
}
export { isTestMode };
