// The night's finances, for closing the books: what was sold, what was collected, what it cost
// to collect, what Paystack should settle and what it did. Sales and money received are kept
// apart: the service charge is never product revenue, and money collected through Paystack is
// never "received" until Paystack has settled it.
//
//   A. Sales: gross product sales (drinks on bills and QR orders, tickets and tables), discounts,
//      product refunds, net product sales = gross − discounts − refunds; service charges
//      collected (apart); tips (the staff's money, apart).
//   B. Payments and settlement: cash, MoMo sent straight to the club's number, and Paystack by
//      channel (mobile money, card); Paystack's actual fees (pending ones listed, not guessed);
//      developer commissions (payable / paid / reversed); refunds paid and owed;
//      expected net settlement = Paystack collections − Paystack fees − refunds already paid back;
//      settled per Paystack (matched settlements); outstanding = expected − settled;
//      what the club recorded as received; the club-borne payment cost.
//   C. Every transaction of the night: completed, pending, failed, refunded, with its figures.
// Each figure is added once: a payment's fee, commission and refund live on its ledger record.
import { getDoc, setDoc, queryWhere, queryRecent, listDocs } from '../lib/firestore.js';
import { now, nightKey, clean } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, dateOr, audit, int } from './common.js';
import { billOf } from './tabs.js';
import { ledgerFor, ledgerSince } from './ledger.js';
import { commercialConfig, serviceChargeOf, commissionOf } from '../lib/fee.js';

export const FINANCE_VIEW = ['superAdmin', 'director', 'finance'];
export const COMMISSION_PAYERS = ['superAdmin', 'director'];
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);
const CHANNELS = { cash: 'Cash', momo_direct: 'MoMo to the club’s number', mobile_money: 'Mobile money (Paystack)', card: 'Card (Paystack)', other: 'Other (Paystack)' };
const paystackChannel = ch => (ch === 'mobile_money' || ch === 'card' ? ch : 'other');
const KIND = { ticket: 'Tickets online', table: 'Table booking', installment_topup: 'Pay in bits', gate: 'Gate (MoMo)', tab: 'Bill (MoMo/card)', counter: 'QR bar order' };

export async function nightFinance(env, user, { date, channel = 'all' } = {}) {
  if (!requireRole(user, FINANCE_VIEW)) return FORBIDDEN;
  const d = dateOr(date), ch = CHANNELS[channel] ? channel : 'all';
  const since = new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5);
  const [tabsRaw, roundsRaw, qrRaw, ordersRaw, checkoutsRaw, ledger, tipsRaw, received] = await Promise.all([
    queryWhere(env, 'tabs', [{ field: 'businessDate', value: d }]), queryWhere(env, 'rounds', [{ field: 'businessDate', value: d }]),
    queryRecent(env, 'counter_orders', 'createdAt', since, 5000), queryRecent(env, 'orders', 'createdAt', since, 5000),
    queryRecent(env, 'pending_checkouts', 'createdAt', since, 5000), ledgerFor(env, d),
    queryWhere(env, 'tips', [{ field: 'businessDate', value: d }]).catch(() => []), getDoc(env, 'night_settlements', d),
  ]);
  const rounds = roundsRaw.map(r => ({ id: r.id, ...r.fields }));
  const tabs = tabsRaw.map(t => ({ id: t.id, ...t.fields }));
  for (const t of tabs) t.bill = billOf(t, rounds.filter(r => r.tabId === t.id));
  const qr = qrRaw.map(o => ({ id: o.id, ...o.fields })).filter(o => ['paid', 'delivered', 'refund_due', 'refunded'].includes(o.status) && o.paidAt && nightKey(o.paidAt) === d);
  const orders = ordersRaw.map(o => ({ id: o.id, ...o.fields })).filter(o => o.status === 'confirmed' && o.kind !== 'comp' && nightKey(o.createdAt) === d);

  // ── A. Sales ──
  const promoOff = o => Number(o.promo?.discountPesewas || 0);
  const drinksGross = sum(tabs, t => t.bill.grossPesewas) + sum(qr, o => o.totalPesewas);
  const drinksDiscount = sum(tabs, t => t.bill.discountPesewas);
  const ticketsGross = sum(orders, o => Number(o.amountPesewas || 0) + promoOff(o)), ticketsDiscount = sum(orders, promoOff);
  const qrRefunds = qr.filter(o => ['refund_due', 'refunded'].includes(o.status));
  const productRefunds = sum(qrRefunds, o => o.totalPesewas);
  const live = ledger.filter(r => r.refund?.status === 'none' || !r.refund);
  const sales = {
    grossProductPesewas: drinksGross + ticketsGross,
    discountsPesewas: drinksDiscount + ticketsDiscount,
    productRefundsPesewas: productRefunds,
    productRefundsPaidPesewas: sum(qrRefunds.filter(o => o.status === 'refunded'), o => o.totalPesewas),
    netProductPesewas: drinksGross + ticketsGross - drinksDiscount - ticketsDiscount - productRefunds,
    byKind: [
      { key: 'drinks', label: 'Drinks (bills and QR orders)', grossPesewas: drinksGross, discountsPesewas: drinksDiscount, refundsPesewas: productRefunds },
      { key: 'tickets', label: 'Tickets and tables (online and gate)', grossPesewas: ticketsGross, discountsPesewas: ticketsDiscount, refundsPesewas: 0 },
    ],
    serviceChargesPesewas: sum(live, r => r.serviceChargePesewas),
    serviceChargesRefundedPesewas: sum(ledger.filter(r => r.refund?.status && r.refund.status !== 'none'), r => r.serviceChargePesewas),
    tipsPesewas: sum(tipsRaw.map(x => x.fields).filter(x => x.status !== 'cancelled'), x => x.amountPesewas),
    unpaidOnBillsPesewas: sum(tabs.filter(t => t.status !== 'written_off'), t => t.bill.balancePesewas),
    note: 'Net product sales = gross product sales − discounts − product refunds. The service charge and tips are not product sales and are not shown as profit here.',
  };

  // ── C. The night's transactions (cash ones too), for the list and the channel filter ──
  const txs = [];
  for (const t of tabs) for (const p of t.payments || []) {
    if (p.method === 'digital') continue; // through Paystack: listed from its checkout below
    txs.push({ reference: p.id || '', kind: 'tab', label: `Tab ${t.number}${t.table ? ` · ${t.table}` : ''}`, channel: p.method === 'cash' ? 'cash' : 'momo_direct', status: 'completed', at: p.at, productPesewas: Number(p.amountPesewas || 0), serviceChargePesewas: 0, tipPesewas: 0, collectedPesewas: Number(p.amountPesewas || 0), byName: p.byName || t.waiterName || '', momoRef: p.momoRef || '' });
  }
  for (const o of orders.filter(x => x.channel === 'gate' && x.paidWith !== 'momo')) txs.push({ reference: o.reference || o.id, kind: 'gate', label: `Gate: ${o.kind === 'table' ? o.packageName : `${o.quantity} × ${o.ticketTypeName}`}`, channel: 'cash', status: 'completed', at: o.createdAt, productPesewas: Number(o.amountPesewas || 0), serviceChargePesewas: 0, tipPesewas: 0, collectedPesewas: Number(o.amountPesewas || 0), byName: o.soldByName || '' });
  const byRef = new Map(ledger.map(r => [r.reference, r]));
  for (const c of checkoutsRaw.map(x => ({ id: x.id, ...x.fields })).filter(x => nightKey(x.createdAt) === d || byRef.has(x.id))) {
    const r = byRef.get(c.id);
    const age = Date.now() - new Date(c.createdAt).getTime();
    const status = r ? (r.refund?.status === 'refunded' ? 'refunded' : r.refund?.status === 'pending' ? 'refund_owed' : 'completed') : c.status === 'failed' ? 'failed' : c.status === 'issued' ? 'completed' : age > 30 * 60e3 ? 'abandoned' : 'pending';
    txs.push({
      reference: c.id, kind: c.kind, label: `${KIND[c.kind] || c.kind}${c.eventName ? ` · ${c.eventName}` : ''}`, channel: r ? paystackChannel(r.channel) : 'paystack', status, at: r?.paidAt || c.createdAt,
      productPesewas: r ? r.productPesewas : Math.max(0, Number(c.amountPesewas || 0) - Number(c.tipPesewas || 0)), serviceChargePesewas: r ? r.serviceChargePesewas : Number(c.feePesewas || 0), tipPesewas: r ? r.tipPesewas : Number(c.tipPesewas || 0),
      collectedPesewas: r ? r.collectedPesewas : 0, chargedPesewas: Number(c.chargePesewas ?? c.amountPesewas ?? 0),
      processingFeePesewas: r?.processingFeePesewas ?? null, feeStatus: r?.feeStatus || '', commissionPesewas: r?.commission?.amountPesewas || 0, commissionStatus: r?.commission?.status || '',
      clubBorneCostPesewas: r?.clubBorneCostPesewas || 0, settlement: r?.settlement?.status || '', error: c.status === 'failed' ? c.error || '' : '',
      serviceChargeRule: r ? r.serviceCharge : { percent: c.feePercent ?? null, capPesewas: c.feeCapPesewas ?? null },
    });
  }
  const shown = ch === 'all' ? txs : txs.filter(t => t.channel === ch);

  // ── B. Payments and settlement (the channel filter applies) ──
  const L = ch === 'all' ? ledger : ledger.filter(r => paystackChannel(r.channel) === ch);
  const done = shown.filter(t => ['completed', 'refunded', 'refund_owed'].includes(t.status));
  const byChannel = Object.fromEntries(Object.keys(CHANNELS).map(k => [k, sum(done.filter(t => t.channel === k), t => t.collectedPesewas)]));
  const feesActual = L.filter(r => r.feeStatus === 'actual'), feesPending = L.filter(r => r.feeStatus !== 'actual');
  const refunded = L.filter(r => r.refund?.status === 'refunded'), refundOwed = L.filter(r => r.refund?.status === 'pending');
  const collectedPaystack = sum(L, r => r.collectedPesewas), fees = sum(feesActual, r => r.processingFeePesewas);
  const expected = collectedPaystack - fees - sum(refunded, r => r.refund.amountPesewas);
  const settled = L.filter(r => r.settlement?.status === 'settled');
  const settledNet = sum(settled, r => r.settlement.netPesewas ?? r.expectedNetPesewas);
  const cm = st => sum(L.filter(r => r.commission?.status === st), r => r.commission.amountPesewas);
  const payments = {
    totalCollectedPesewas: sum(done, t => t.collectedPesewas),
    byChannel: Object.entries(byChannel).map(([k, v]) => ({ key: k, label: CHANNELS[k], amountPesewas: v })),
    paystackCollectedPesewas: collectedPaystack,
    processingFeesPesewas: fees, processingFeesPending: feesPending.length,
    commission: { payablePesewas: cm('payable'), paidPesewas: cm('paid'), reversedPesewas: cm('reversed'), toRecoverPesewas: cm('paid_to_recover'), payments: L.filter(r => r.commission?.status && r.commission.status !== 'not_eligible').length },
    otherDeductionsPesewas: 0,
    refundsPaidPesewas: sum(refunded, r => r.refund.amountPesewas), refundsOwedPesewas: sum(refundOwed, r => r.refund.amountPesewas),
    expectedSettlementPesewas: expected,
    settledPesewas: settledNet, settledPayments: settled.length, unsettledPayments: L.length - settled.length,
    outstandingSettlementPesewas: expected - settledNet,
    clubBorneCostPesewas: sum(L, r => r.clubBorneCostPesewas),
    serviceChargesPesewas: sum(L.filter(r => r.refund?.status === 'none'), r => r.serviceChargePesewas),
    receivedByClub: received ? { amountPesewas: received.fields.amountPesewas, note: received.fields.note || '', byName: received.fields.byName || '', at: received.fields.at } : null,
    note: 'Expected settlement = money collected through Paystack − Paystack’s actual fees − refunds already paid back. The developer commission is not deducted by Paystack: it is payable separately. Payments not yet matched to a Paystack settlement are pending, not received.',
  };
  return { date: d, channel: ch, channels: CHANNELS, sales, payments, transactions: shown.sort((a, b) => String(b.at).localeCompare(String(a.at))),
    counts: Object.fromEntries(['completed', 'pending', 'abandoned', 'failed', 'refunded', 'refund_owed'].map(s => [s, shown.filter(t => t.status === s).length])),
    canRecord: true, canPayCommission: !!requireRole(user, COMMISSION_PAYERS) };
}

// ── Matching Paystack's settlements ──
// Paystack settles collected money (less its fees) in batches. This asks Paystack for the
// settlements between two dates and marks each payment in them as settled, with what Paystack
// says it paid. Only a settlement Paystack reports as successful counts as settled.
async function paystackGet(env, path) {
  const r = await fetch(`https://api.paystack.co${path}`, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.status) throw new Error(d.message || 'Paystack request failed');
  return d.data;
}
export async function syncSettlements(env, user, { from, to } = {}) {
  if (!requireRole(user, FINANCE_VIEW)) return FORBIDDEN;
  const f = dateOr(from), t = dateOr(to, f);
  let list;
  try { list = await paystackGet(env, `/settlement?from=${f}T00:00:00Z&to=${t}T23:59:59Z&perPage=50`); }
  catch (e) { return { error: `Paystack didn’t answer: ${e.message}. Try again, or record what was received by hand.`, status: 502 }; }
  let matched = 0, settlements = 0;
  for (const s of (list || []).slice(0, 10)) {
    settlements++;
    const ok = String(s.status || '').toLowerCase() === 'success';
    await setDoc(env, 'paystack_settlements', String(s.id), { id: s.id, status: s.status || '', totalAmountPesewas: Number(s.total_amount || 0), effectiveAmountPesewas: Number(s.effective_amount ?? s.total_amount ?? 0), totalFeesPesewas: Number(s.total_fees || 0), settlementDate: s.settlement_date || s.settled_at || s.createdAt || '', syncedAt: now() });
    let txs = [];
    try { txs = await paystackGet(env, `/settlement/${encodeURIComponent(s.id)}/transactions?perPage=200`); } catch { continue; }
    for (const x of txs || []) {
      const led = x.reference ? await getDoc(env, 'payment_ledger', String(x.reference)) : null;
      if (!led) continue;
      const r = led.fields, fee = x.fees != null ? Number(x.fees) : null;
      const next = { ...r, settlement: { status: ok ? 'settled' : 'processing', settlementId: String(s.id), settledAt: s.settlement_date || '', netPesewas: Number(x.amount || r.collectedPesewas) - (fee ?? (r.processingFeePesewas || 0)) } };
      if (r.feeStatus !== 'actual' && fee != null) { next.processingFeePesewas = fee; next.feeStatus = 'actual'; }
      const feeNow = next.feeStatus === 'actual' ? Number(next.processingFeePesewas) : 0;
      const commission = ['payable', 'paid'].includes(next.commission?.status) ? Number(next.commission.amountPesewas) : 0;
      Object.assign(next, { clubBorneCostPesewas: Math.max(0, feeNow + commission - Number(next.serviceChargePesewas || 0)), expectedNetPesewas: Number(next.collectedPesewas) - feeNow });
      await setDoc(env, 'payment_ledger', led.id, next);
      matched++;
    }
  }
  await audit(env, user, 'PAYSTACK_SETTLEMENTS_SYNCED', { from: f, to: t, settlements, matched });
  return { settlements, matched };
}

// What the club actually received for the night (from the bank statement, or from whoever holds
// the Paystack account), recorded by finance or a director. Every change is kept.
export async function recordNightReceived(env, b, user) {
  if (!requireRole(user, FINANCE_VIEW)) return FORBIDDEN;
  const d = dateOr(b?.date), amount = int(b?.amountPesewas), note = clean(b?.note, 300);
  if (!(amount >= 0)) return { error: 'Enter the amount received (0 or more).' };
  if (!note) return { error: 'Say where it came from, e.g. the bank statement reference.' };
  const cur = (await getDoc(env, 'night_settlements', d))?.fields;
  await setDoc(env, 'night_settlements', d, { date: d, amountPesewas: amount, note, by: uidOf(user), byName: user.name || '', at: now(), history: [...(cur?.history || []), ...(cur ? [{ amountPesewas: cur.amountPesewas, note: cur.note, byName: cur.byName, at: cur.at }] : [])] });
  await audit(env, user, 'NIGHT_SETTLEMENT_RECORDED', { date: d, amountPesewas: amount });
  return { recorded: true };
}

// The developers were paid what was payable for a night: those commissions become paid.
export async function markCommissionPaid(env, b, user) {
  if (!requireRole(user, COMMISSION_PAYERS)) return { error: 'A director marks the developer commission as paid.', status: 403 };
  const d = dateOr(b?.date), note = clean(b?.note, 300);
  if (!note) return { error: 'Say how it was paid (e.g. the transfer reference).' };
  const rows = (await ledgerFor(env, d)).filter(r => r.commission?.status === 'payable');
  for (const r of rows) { const { id: rid, ...f } = r; await setDoc(env, 'payment_ledger', rid, { ...f, commission: { ...f.commission, status: 'paid', paidAt: now(), paidNote: note, paidByName: user.name || '' } }); }
  await audit(env, user, 'DEVELOPER_COMMISSION_PAID', { date: d, payments: rows.length, amountPesewas: sum(rows, r => r.commission.amountPesewas), note });
  return { paid: rows.length, amountPesewas: sum(rows, r => r.commission.amountPesewas) };
}

// ── Pricing simulation (nothing is saved, no price changes) ──
// For each bill size: the service charge, what the customer pays, Paystack's fee (at the club's
// actual average rate from recorded payments when there are any; else the estimate typed or set;
// else unknown), the commission, what the club bears and what it keeps. For each drink: the
// margin, the payment cost on a typical bill, and the margin at a proposed price (a draft only).
export async function pricingSimulation(env, user, b = {}) {
  if (!requireRole(user, FINANCE_VIEW)) return FORBIDDEN;
  const cfg = await commercialConfig(env);
  const recent = (await ledgerSince(env, new Date(Date.now() - 60 * 864e5))).filter(r => r.feeStatus === 'actual' && r.collectedPesewas > 0);
  const actualRate = recent.length ? sum(recent, r => r.processingFeePesewas) / sum(recent, r => r.collectedPesewas) * 100 : null;
  const typed = b.estimatePercent === '' || b.estimatePercent == null ? null : Number(b.estimatePercent);
  const rate = actualRate ?? (Number.isFinite(typed) && typed >= 0 ? typed : cfg.processing.estimatePercent);
  const feeSource = actualRate != null ? `actual: the average of ${recent.length} recent payment${recent.length > 1 ? 's' : ''}` : rate != null ? 'estimate (no actual fees recorded yet)' : 'unknown';
  const calc = (subtotal, channel = 'mobile_money') => {
    const charge = serviceChargeOf(subtotal, cfg.serviceCharge), total = subtotal + charge;
    const fee = rate == null ? null : Math.round(total * rate / 100);
    const commission = commissionOf(cfg.commission, { kind: 'tab', channel, productPesewas: subtotal, serviceChargePesewas: charge }).amountPesewas;
    const borne = fee == null ? null : Math.max(0, fee + commission - charge);
    return { subtotalPesewas: subtotal, serviceChargePesewas: charge, totalPesewas: total, feePesewas: fee, commissionPesewas: commission, clubBornePesewas: borne, clubProceedsPesewas: fee == null ? null : total - fee - commission, productAfterCostsPesewas: borne == null ? null : subtotal - borne };
  };
  const bills = (Array.isArray(b.bills) && b.bills.length ? b.bills : [20000, 50000, 100000, 200000, 300000, 500000, 1000000]).map(int).filter(n => n > 0).slice(0, 20);
  const typical = int(b.typicalBillPesewas) > 0 ? int(b.typicalBillPesewas) : 20000, change = Number(b.priceChangePercent) || 0;
  const t = calc(typical), bornePer = t.clubBornePesewas == null ? null : t.clubBornePesewas / typical;
  const drinks = (await listDocs(env, 'menu_items')).filter(i => !i.fields.deleted).map(i => {
    const price = Number(i.fields.pricePesewas || 0), cost = Number(i.fields.costPesewas || 0), proposed = Math.round(price * (1 + change / 100) / 50) * 50;
    const payCost = p => (bornePer == null ? null : Math.round(p * bornePer));
    return { name: i.fields.name, pricePesewas: price, costPesewas: cost, marginPesewas: price - cost, paymentCostPesewas: payCost(price), marginAfterPaymentPesewas: payCost(price) == null ? null : price - cost - payCost(price),
      proposedPricePesewas: change ? proposed : null, proposedMarginAfterPaymentPesewas: change && payCost(proposed) != null ? proposed - cost - payCost(proposed) : null };
  }).sort((a, z) => a.name.localeCompare(z.name));
  return { config: { serviceCharge: cfg.serviceCharge, commission: cfg.commission }, feeRatePercent: rate == null ? null : Math.round(rate * 1000) / 1000, feeSource, rows: bills.map(n => calc(n)), typicalBillPesewas: typical, priceChangePercent: change, drinks,
    note: 'A simulation: nothing is saved and no price changes. Paid online (mobile money); cash has no Paystack fee.' };
}
