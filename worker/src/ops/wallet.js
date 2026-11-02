// Big bills by MoMo straight to the partner's merchant wallet (payment rules, step 3).
//
// Above the Paystack limit (GHS 2,000) a bill can't go through Paystack. The waiter picks "MoMo to
// the wallet": the customer sends the bill plus the flat charge (GHS 100) to the wallet, quoting a
// short reference. The bill waits ("waiting") until a manager sees the money in the wallet and
// confirms it with the MoMo transaction ID (once only, ever). Nothing is released on a screenshot.
// On confirmation the bill gets the payment (its part, not the charge) and the charge becomes a
// row owed to EvolveIT (evolveit_charges, status unsettled; settled weekly, step 4).
//
// "Paystack is down" (a director, for tonight only): any bill can use the wallet, at the customer's
// normal Paystack price; that charge is owed to EvolveIT the same way.
//
//   wallet_payments/{id}  tabId, tabNumber, table, waiterUid/Name, businessDate, billPesewas (the part
//                         of the bill this pays), chargePesewas, duePesewas (= bill + charge),
//                         reason big | paystack_down, code (reference), wallet, status waiting |
//                         confirmed | cancelled; on confirm: receivedPesewas, momoRef, short, by/at
//   evolveit_charges/{id} businessDate, source 'wallet', walletPaymentId, tabId, amountPesewas,
//                         status unsettled | settled, createdAt
import { getDoc, setDoc, queryWhere, queryRecent, withTransaction, batchGet, foundFields, updateWrite, commitTx } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { sendSms } from '../lib/notify.js';
import { routeFor } from '../lib/routes.js';
import { commercialConfig } from '../lib/fee.js';
import { FORBIDDEN, bizDate, audit, ghs, int } from './common.js';

export const CONFIRMERS = ['superAdmin', 'director', 'manager', 'finance'];
const CODE = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => CODE[b % CODE.length]).join('');
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);

// Paystack is down tonight (a director turned it on for this night).
export const paystackDownTonight = routes => routes?.paystackDown?.date && routes.paystackDown.date === bizDate();
// Staff may not record "MoMo to the club's number" while the new rules are on (it skipped the rules
// and couldn't be checked). Returns an error, or null when it's allowed.
export async function momoDirectBlocked(env) {
  const { routes } = await commercialConfig(env);
  if (!routes?.enabled) return null;
  return { error: 'MoMo to the club’s number isn’t used any more. For a bill above the Paystack limit, close the tab with “MoMo to the wallet” (a manager confirms it). Otherwise: cash, or card / MoMo by Paystack.', code: 'momo_direct_off' };
}

// What the customer must send for a bill (or what's left of it), and why the wallet is allowed.
export async function walletQuote(env, balancePesewas, wholePesewas) {
  const { routes } = await commercialConfig(env);
  if (!routes?.enabled) return { error: 'MoMo to the wallet is part of the new payment rules, which aren’t switched on.' };
  if (!routes.bigWalletNumber) return { error: 'The wallet number isn’t set yet (directors: Service charge & commission).' };
  const r = routeFor(balancePesewas, routes, { bandBillPesewas: wholePesewas });
  const down = paystackDownTonight(routes);
  if (r.momo) return { reason: 'big', billPesewas: balancePesewas, chargePesewas: r.momo.chargePesewas, duePesewas: r.momo.customerPaysPesewas, wallet: { number: routes.bigWalletNumber, name: routes.bigWalletName || '' }, rule: r.rule };
  if (down) return { reason: 'paystack_down', billPesewas: balancePesewas, chargePesewas: r.paystack.customerSharePesewas, duePesewas: r.paystack.customerPaysPesewas, wallet: { number: routes.bigWalletNumber, name: routes.bigWalletName || '' }, rule: r.rule };
  return { error: `MoMo to the wallet is for bills above ${ghs(routes.paystackUpToPesewas)}. Use cash or card / MoMo by Paystack.` };
}

// The waiter starts it (from Close tab). t: the tab document; bill: billOf(...). Returns what to show.
export async function startWallet(env, t, bill, user, { phone } = {}) {
  const q = await walletQuote(env, bill.balancePesewas, bill.totalPesewas); if (q.error) return q;
  // One waiting at a time per tab: a second tap shows the same one.
  const open = (await queryWhere(env, 'wallet_payments', [{ field: 'tabId', value: t.id }, { field: 'status', value: 'waiting' }]))[0];
  if (open && open.fields.billPesewas === bill.balancePesewas) return { ...view(open.id, open.fields), again: true };
  if (open) await setDoc(env, 'wallet_payments', open.id, { ...open.fields, status: 'cancelled', cancelledAt: now(), cancelReason: 'bill changed' });
  const wid = id(), at = now();
  const w = { tabId: t.id, tabNumber: t.fields.number, table: t.fields.table || '', waiterUid: t.fields.waiterUid || '', waiterName: t.fields.waiterName || '', businessDate: bizDate(),
    billPesewas: q.billPesewas, chargePesewas: q.chargePesewas, duePesewas: q.duePesewas, reason: q.reason, code: code(), wallet: q.wallet, rule: q.rule,
    customerPhone: phone || t.fields.customerPhone || '', status: 'waiting', startedBy: uidOf(user), startedByName: user.name || '', createdAt: at };
  await setDoc(env, 'wallet_payments', wid, w);
  await setDoc(env, 'tabs', t.id, { ...t.fields, ...(phone ? { customerPhone: phone } : {}), closeWhenPaid: true, closeAskedByName: user.name || '', walletWait: wid });
  if (w.customerPhone) await sendSms(env, w.customerPhone, `MEMORIES\nTab ${w.tabNumber}: send ${ghs(w.duePesewas)} by MoMo to ${w.wallet.number}${w.wallet.name ? ` (${w.wallet.name})` : ''}.\nReference: ${w.code}\n${q.reason === 'big' ? `That's your bill ${ghs(w.billPesewas)} + ${ghs(w.chargePesewas)} charge.` : `That's your bill ${ghs(w.billPesewas)} + ${ghs(w.chargePesewas)} charge.`} Your bill closes once the club sees the money arrive.`);
  await audit(env, user, 'WALLET_PAYMENT_STARTED', { walletPaymentId: wid, tabId: t.id, duePesewas: w.duePesewas, reason: w.reason });
  return view(wid, w);
}
const view = (wid, w) => ({ id: wid, tabId: w.tabId, tabNumber: w.tabNumber, table: w.table, waiterName: w.waiterName, billPesewas: w.billPesewas, chargePesewas: w.chargePesewas, duePesewas: w.duePesewas,
  reason: w.reason, code: w.code, wallet: w.wallet, status: w.status, phoneHint: w.customerPhone ? maskPhone(w.customerPhone) : '', createdAt: w.createdAt,
  ...(w.status === 'confirmed' ? { receivedPesewas: w.receivedPesewas, momoRef: w.momoRef, confirmedByName: w.confirmedByName, changePesewas: Math.max(0, w.receivedPesewas - w.duePesewas) } : {}) });

// The Manager's list: waiting tonight (and the last confirmed ones).
export async function walletList(env, user) {
  if (!requireRole(user, [...CONFIRMERS, 'waitStaff', 'eventManager'])) return FORBIDDEN;
  const recent = (await queryRecent(env, 'wallet_payments', 'createdAt', new Date(Date.now() - 2 * 864e5), 500)).map(d => view(d.id, d.fields));
  const { routes } = await commercialConfig(env);
  return { waiting: recent.filter(w => w.status === 'waiting'), confirmed: recent.filter(w => w.status === 'confirmed').slice(0, 20), canConfirm: !!requireRole(user, CONFIRMERS),
    paystackDown: paystackDownTonight(routes) ? routes.paystackDown : null, wallet: { number: routes?.bigWalletNumber || '', name: routes?.bigWalletName || '' } };
}
export async function walletOne(env, user, wid) {
  if (!requireRole(user, [...CONFIRMERS, 'waitStaff', 'eventManager'])) return FORBIDDEN;
  const w = await getDoc(env, 'wallet_payments', String(wid || ''));
  return w ? { payment: view(w.id, w.fields) } : { error: 'Not found.', status: 404 };
}

// A manager saw the money in the wallet. { id, receivedPesewas, momoRef, acceptShort, note }
export async function confirmWallet(env, b, user, { closeIfPaid }) {
  if (!requireRole(user, CONFIRMERS)) return { error: 'A manager confirms MoMo to the wallet (they check the wallet itself).', status: 403 };
  const ref = String(b?.momoRef || '').toUpperCase().replace(/[^A-Z0-9.]/g, '').slice(0, 40);
  if (ref.length < 6) return { error: 'Type the MoMo transaction ID from the wallet’s message (at least 6 letters or numbers).' };
  const received = int(b?.receivedPesewas);
  if (!(received > 0)) return { error: 'Type the amount that arrived in the wallet.' };
  // A transaction ID counts once, ever: here, or as a MoMo payment on any bill tonight.
  const used = (await queryWhere(env, 'wallet_payments', [{ field: 'momoRef', value: ref }], { limit: 1 }))[0];
  if (used) return { error: `That transaction ID was already used (Tab ${used.fields.tabNumber}). Check it in the wallet.` };
  const res = await withTransaction(env, async tx => {
    const wid = String(b?.id || '');
    const got = await batchGet(env, [`wallet_payments/${wid}`], tx);
    const wd = foundFields(got, `/wallet_payments/${wid}`);
    if (!wd) return { error: 'Not found.', status: 404 };
    const w = wd.fields;
    if (w.status !== 'waiting') return { error: w.status === 'confirmed' ? 'Already confirmed.' : 'This one was cancelled. Start it again from the tab.' };
    const short = Math.max(0, w.duePesewas - received);
    if (short && b?.acceptShort !== true) return { error: `That’s ${ghs(short)} short of ${ghs(w.duePesewas)}. Ask the customer to send the rest, then confirm with the total. Or accept it short, with a reason.`, code: 'short', shortPesewas: short };
    const note = clean(b?.note, 200);
    if (short && !note) return { error: 'Say why you’re accepting less.' };
    const tabGot = await batchGet(env, [`tabs/${w.tabId}`], tx);
    const t = foundFields(tabGot, `/tabs/${w.tabId}`);
    if (!t) return { error: 'The tab is gone.', status: 404 };
    // What arrived pays the charge first (it's EvolveIT's), then the bill; anything over the due is change.
    const charge = Math.min(w.chargePesewas, received), billPart = Math.min(w.billPesewas, Math.max(0, received - charge));
    const at = now(), payId = id(), chargeId = id();
    const pay = { id: payId, method: 'momo', viaWallet: true, walletPaymentId: wid, amountPesewas: billPart, at, businessDate: w.businessDate, by: uidOf(user), byName: user.name || '', momoRef: ref, chargePesewas: charge };
    const writes = [
      updateWrite(env, 'wallet_payments', wid, { ...w, status: 'confirmed', receivedPesewas: received, momoRef: ref, short, shortNote: note, confirmedBy: uidOf(user), confirmedByName: user.name || '', confirmedAt: at, paymentId: payId, evolveitChargeId: charge ? chargeId : '' }),
      updateWrite(env, 'tabs', w.tabId, { ...t.fields, payments: [...(t.fields.payments || []), ...(billPart ? [pay] : [])], walletWait: '' }),
      updateWrite(env, 'audit_logs', id(), { action: 'WALLET_PAYMENT_CONFIRMED', actorUid: uidOf(user), actorName: user.name || '', walletPaymentId: wid, tabId: w.tabId, receivedPesewas: received, momoRef: ref, short, timestamp: at }),
    ];
    if (charge) writes.push(updateWrite(env, 'evolveit_charges', chargeId, { businessDate: w.businessDate, source: 'wallet', reason: w.reason, walletPaymentId: wid, tabId: w.tabId, tabNumber: w.tabNumber, momoRef: ref, amountPesewas: charge, status: 'unsettled', createdAt: at }));
    await commitTx(env, writes, tx);
    return { confirmed: true, tabId: w.tabId, billPesewas: billPart, chargePesewas: charge, shortPesewas: short, changePesewas: Math.max(0, received - w.duePesewas) };
  });
  if (res.confirmed) res.tabClosed = await closeIfPaid(env, res.tabId);
  return res;
}

// It didn't arrive (or the customer paid another way). { id, reason }
export async function cancelWallet(env, b, user) {
  if (!requireRole(user, [...CONFIRMERS, 'waitStaff', 'eventManager'])) return FORBIDDEN;
  const w = await getDoc(env, 'wallet_payments', String(b?.id || ''));
  if (!w) return { error: 'Not found.', status: 404 };
  if (w.fields.status !== 'waiting') return { error: 'It isn’t waiting any more.' };
  if (!requireRole(user, CONFIRMERS) && w.fields.waiterUid !== uidOf(user)) return FORBIDDEN;
  const reason = clean(b?.reason, 200) || 'Not arrived';
  await setDoc(env, 'wallet_payments', w.id, { ...w.fields, status: 'cancelled', cancelledAt: now(), cancelledByName: user.name || '', cancelReason: reason });
  const t = await getDoc(env, 'tabs', w.fields.tabId);
  if (t && t.fields.walletWait === w.id) await setDoc(env, 'tabs', t.id, { ...t.fields, walletWait: '', closeWhenPaid: false });
  await audit(env, user, 'WALLET_PAYMENT_CANCELLED', { walletPaymentId: w.id, reason });
  return { cancelled: true };
}

// "Paystack is down" for tonight: a director. { on }
export async function setPaystackDown(env, b, user) {
  if (!requireRole(user, ['superAdmin', 'director'])) return { error: 'A director turns this on.', status: 403 };
  const doc = (await getDoc(env, 'settings', 'commercial'))?.fields || {};
  const routes = { ...(doc.routes || {}), paystackDown: b?.on === true ? { date: bizDate(), byName: user.name || '', at: now() } : null };
  if (b?.on === true && !routes.enabled) return { error: 'Switch the new payment rules on first.' };
  await setDoc(env, 'settings', 'commercial', { ...doc, routes });
  const { clearCommercialCache } = await import('../lib/fee.js'); clearCommercialCache();
  await audit(env, user, b?.on === true ? 'PAYSTACK_DOWN_ON' : 'PAYSTACK_DOWN_OFF', { date: bizDate() });
  return { paystackDown: routes.paystackDown };
}

// What's owed to EvolveIT from the wallet (step 4 builds the full screen).
export async function evolveitOwedSummary(env) {
  const rows = (await queryWhere(env, 'evolveit_charges', [{ field: 'status', value: 'unsettled' }], { limit: 5000 })).map(d => d.fields);
  return { unsettledPesewas: sum(rows, r => r.amountPesewas), rows: rows.length };
}
export { normalizePhone };
