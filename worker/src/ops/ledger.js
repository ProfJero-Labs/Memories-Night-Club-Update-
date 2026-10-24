// The payment ledger: one record per successful Paystack payment, payment_ledger/{reference}.
// Written when Paystack confirms the payment (checkout.confirmCharge), before anything is issued:
// the money was collected even if, say, the tickets sold out meanwhile (then a refund is owed).
// The reference is the record's id, so a repeated Paystack notice, a retry or the payment check
// running twice can never make a second record, a second service charge or a second commission.
// Failed, abandoned and mismatched payments never get one.
//
// Each record keeps, as they were at that moment:
//   productPesewas        the products paid for (tickets, table, drinks), after any discount
//   discountPesewas       the discount, where the payment carries it (a promo on tickets)
//   serviceChargePesewas  the customer's service charge, with the rate and cap it was charged under
//   tipPesewas            a tip (the staff's money)
//   collectedPesewas      what Paystack took from the customer (= product + service charge + tip)
//   channel               Paystack's channel (mobile_money, card, …)
//   processingFeePesewas  Paystack's actual fee, from Paystack; feeStatus 'actual', or 'pending'
//                         when Paystack hasn't given it yet (then it's left out of totals, labelled,
//                         and filled in by the payment check later)
//   commission            the developer commission under the configuration of the day: amount,
//                         basis, rule, status payable → paid (or reversed on a refund, or not_eligible)
//   clubBorneCostPesewas  max(0, processing fee + commission − service charge): what the club pays
//                         out of its own money for this payment (the charge is capped, so on a big
//                         bill it doesn't cover the costs)
//   expectedNetPesewas    collected − processing fee: what Paystack should settle (it deducts its
//                         fee; the commission is not deducted, it is payable separately)
//   settlement            pending → settled (matched to a Paystack settlement, with what it paid)
//   refund                none → pending → refunded
import { getDoc, setDoc, createDoc, queryWhere, queryRecent, alreadyExists } from '../lib/firestore.js';
import { now, nightKey } from '../lib/util.js';
import { commercialConfig, commissionOf } from '../lib/fee.js';

const num = v => Number(v || 0);
// The product part of a checkout: tabs and QR orders keep the tip inside amountPesewas.
export function partsOf(P) {
  const tip = num(P.tipPesewas), product = Math.max(0, num(P.amountPesewas) - tip);
  const discount = P.kind === 'ticket' ? num(P.promo?.discountPesewas) : 0;
  return { productPesewas: product, discountPesewas: discount, grossProductPesewas: product + discount, tipPesewas: tip, serviceChargePesewas: num(P.feePesewas) };
}
const derive = r => {
  const fee = r.feeStatus === 'actual' ? num(r.processingFeePesewas) : 0;
  const commission = ['payable', 'paid'].includes(r.commission?.status) ? num(r.commission.amountPesewas) : 0;
  return { clubBorneCostPesewas: Math.max(0, fee + commission - num(r.serviceChargePesewas)), expectedNetPesewas: num(r.collectedPesewas) - fee };
};

// Called once Paystack says the payment succeeded and the amount matched. Idempotent.
export async function recordPayment(env, reference, pending, payment) {
  const P = pending.fields || pending;
  const { commission: cc } = await commercialConfig(env);
  const parts = partsOf(P), paid = new Date(payment.paid_at || payment.paidAt || Date.now()), at = Number.isNaN(paid.getTime()) ? now() : paid;
  const channel = String(payment.channel || 'unknown');
  const c = commissionOf(cc, { kind: P.kind, channel, ...parts });
  const feeKnown = payment.fees !== undefined && payment.fees !== null && Number.isFinite(Number(payment.fees));
  const rec = {
    reference, kind: P.kind, eventId: P.eventId || '', label: P.eventName || P.ticketTypeName || P.packageName || '', tabId: P.tabId || '', orderId: P.orderId || '', planId: P.planId || '',
    businessDate: nightKey(at), paidAt: at, recordedAt: now(), channel, currency: payment.currency || 'GHS',
    ...parts, collectedPesewas: num(payment.amount),
    serviceCharge: { percent: num(P.feePercent), capPesewas: P.feeCapPesewas ?? null },
    processingFeePesewas: feeKnown ? num(payment.fees) : null, feeStatus: feeKnown ? 'actual' : 'pending',
    commission: { status: c.eligible && c.amountPesewas > 0 ? 'payable' : 'not_eligible', amountPesewas: c.eligible ? c.amountPesewas : 0, basePesewas: c.basePesewas ?? 0, reason: c.reason || '',
      rule: { type: cc.type, percent: cc.percent, fixedPesewas: cc.fixedPesewas, basis: cc.basis, refunds: cc.refunds, settlement: cc.settlement } },
    settlement: { status: 'pending' }, refund: { status: 'none', amountPesewas: 0 },
  };
  Object.assign(rec, derive(rec));
  try { await createDoc(env, 'payment_ledger', reference, rec); }
  catch (e) {
    if (!alreadyExists(e)) throw e;
    // Already recorded (a repeated notice or a retry): never a second record; only a fee Paystack
    // hadn't given before is filled in.
    const existing = await getDoc(env, 'payment_ledger', reference);
    return existing ? fillFee(env, existing, payment) : rec;
  }
  return rec;
}

// Paystack hadn't given its fee yet: fill it in now that it has (only ever once).
async function fillFee(env, doc, payment) {
  const r = doc.fields;
  if (r.feeStatus === 'actual' || payment?.fees === undefined || payment?.fees === null) return r;
  const next = { ...r, processingFeePesewas: num(payment.fees), feeStatus: 'actual', feeFilledAt: now() };
  await setDoc(env, 'payment_ledger', doc.id, { ...next, ...derive(next) });
  return next;
}

// The payment check asks Paystack again for fees it didn't have (a few per run).
export async function refreshPendingFees(env, verify, limit = 5) {
  const rows = (await queryWhere(env, 'payment_ledger', [{ field: 'feeStatus', value: 'pending' }], { limit })).slice(0, limit);
  let filled = 0;
  for (const d of rows) {
    try { const p = await verify(d.id); if (p?.status === 'success' && p.fees != null) { await fillFee(env, d, p); filled++; } } catch { /* next run */ }
  }
  return filled;
}

// A refund owed (status 'pending') or made ('refunded'). The commission is reversed when the
// agreed rule says so (refunds: 'reverse'); a commission already paid out is marked to be
// clawed back rather than silently changed.
export async function ledgerRefund(env, reference, status, { amountPesewas, note = '', byName = '' } = {}) {
  if (!reference) return null;
  const d = await getDoc(env, 'payment_ledger', reference);
  if (!d) return null;
  const r = d.fields;
  if (r.refund?.status === 'refunded') return r;
  const refund = { status, amountPesewas: amountPesewas ?? r.collectedPesewas, note, byName, at: now() };
  let commission = r.commission;
  if (r.commission?.rule?.refunds !== 'keep' && ['payable', 'paid'].includes(r.commission?.status)) commission = { ...r.commission, status: r.commission.status === 'paid' ? 'paid_to_recover' : 'reversed', reversedAt: now() };
  const next = { ...r, refund, commission };
  await setDoc(env, 'payment_ledger', d.id, { ...next, ...derive(next) });
  return next;
}

export async function ledgerFor(env, date) { return (await queryWhere(env, 'payment_ledger', [{ field: 'businessDate', value: date }], { limit: 5000 })).map(d => ({ id: d.id, ...d.fields })); }
export async function ledgerSince(env, since) { return (await queryRecent(env, 'payment_ledger', 'paidAt', since, 10000)).map(d => ({ id: d.id, ...d.fields })); }
