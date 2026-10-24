// The commercial rules for payments through the site (Paystack): the customer's service charge
// and the developer commission. Kept as three separate ideas, never mixed:
//   1. Service charge: what the customer pays on top of the bill. A percentage of the bill's
//      products, once per bill, capped: min(subtotal × rate, cap). Default 5%, capped at GHS 100.
//      Shown before paying. Cash isn't charged (nothing goes through Paystack).
//   2. Paystack's processing fee: what Paystack actually took, read from Paystack on each payment
//      (ops/ledger.js). Never added to the customer's bill, never assumed from a published rate.
//   3. Developer commission: what the club owes the developers on each eligible successful
//      payment, under the agreed arrangement. Off until management configures it: no rate is
//      built in. Recorded as payable; nothing is deducted from anyone's settlement.
// The settings live in settings/commercial and are changed only by a director or the admin
// (ops/commercial.js), with who and when. Every payment keeps a copy of the rules it was charged
// under, so changing the settings never changes a past payment.
//
// amountPesewas stays what the ticket, table or bill costs; chargePesewas is what Paystack is
// asked for (amount + tip + service charge), and that is what the payment check compares.
import { getDoc } from './firestore.js';
import { getSettings } from '../public.js';

export const MAX_RATE_PERCENT = 20;
export const DEFAULT_SERVICE_CHARGE = { enabled: true, percent: 5, capPesewas: 10000 };
// What can earn a commission: the kind of payment (pending_checkouts.kind) and Paystack's channel.
export const COMMISSION_KINDS = { ticket: 'Tickets online', table: 'Table bookings', installment_topup: 'Pay in bits', gate: 'Gate MoMo sales', tab: 'Bills paid by MoMo or card', counter: 'QR bar orders' };
export const COMMISSION_CHANNELS = { mobile_money: 'Mobile money', card: 'Card', other: 'Other Paystack channels' };
export const COMMISSION_BASES = { product: 'The products paid for (tickets, drinks), after discounts', collected: 'Everything collected except tips (products + service charge)', service_charge: 'The service charge only' };
export const DEFAULT_COMMISSION = { enabled: false, type: 'percent', percent: 0, fixedPesewas: 0, basis: 'product', kinds: Object.keys(COMMISSION_KINDS), channels: Object.keys(COMMISSION_CHANNELS), refunds: 'reverse', settlement: 'payable' };

// The configuration in force. Before anyone saved settings/commercial, the old site setting
// (serviceFeePercent, no cap) is honoured so a live site doesn't change on deploy without a save,
// except that the cap applies from now on.
// Read at most every 20 seconds per Worker instance (the payment check runs under a request limit);
// a save clears it at once on the instance that saved.
let cached = null;
export const clearCommercialCache = () => { cached = null; };
export async function commercialConfig(env, siteSettings) {
  if (cached && cached.env === env && Date.now() - cached.at < 20e3) return cached.value;
  const value = await readCommercial(env, siteSettings);
  cached = { env, at: Date.now(), value };
  return value;
}
async function readCommercial(env, siteSettings) {
  const doc = (await getDoc(env, 'settings', 'commercial'))?.fields;
  let serviceCharge = { ...DEFAULT_SERVICE_CHARGE, ...(doc?.serviceCharge || {}) };
  if (!doc?.serviceCharge) {
    const legacy = Number((siteSettings || await getSettings(env))?.serviceFeePercent);
    if (Number.isFinite(legacy) && legacy >= 0 && legacy <= MAX_RATE_PERCENT) serviceCharge = { ...serviceCharge, percent: legacy, enabled: legacy > 0 };
  }
  return { serviceCharge, commission: { ...DEFAULT_COMMISSION, ...(doc?.commission || {}) }, processing: { estimatePercent: null, ...(doc?.processing || {}) }, updatedAt: doc?.updatedAt || '', updatedByName: doc?.updatedByName || '' };
}

// customerCharge = min(eligibleSubtotal × rate, cap), once per bill, never negative; 0 when off.
export const serviceChargeOf = (subtotalPesewas, sc) => {
  if (!sc?.enabled) return 0;
  const raw = Math.round(Math.max(0, Number(subtotalPesewas) || 0) * Math.max(0, Number(sc.percent) || 0) / 100);
  const cap = Number(sc.capPesewas);
  return Math.max(0, Number.isFinite(cap) && cap >= 0 ? Math.min(raw, cap) : raw);
};

// The service charge on a bill, with the rule it was worked out under (spread onto the checkout).
export async function serviceFee(env, pesewas, siteSettings) {
  const { serviceCharge: sc } = await commercialConfig(env, siteSettings);
  return { feePercent: sc.enabled ? Number(sc.percent) : 0, feeCapPesewas: sc.enabled ? Number(sc.capPesewas) : 0, feePesewas: serviceChargeOf(pesewas, sc) };
}

// The developer commission on one successful payment, under the configuration given (a copy is
// kept on the payment). base: the payment's product, service charge and collected amounts.
export function commissionOf(cfg, { kind, channel, productPesewas, serviceChargePesewas }) {
  const c = cfg || DEFAULT_COMMISSION;
  const ch = COMMISSION_CHANNELS[channel] ? channel : 'other';
  if (!c.enabled) return { eligible: false, amountPesewas: 0, reason: 'off' };
  if (!(c.kinds || []).includes(kind)) return { eligible: false, amountPesewas: 0, reason: 'kind' };
  if (!(c.channels || []).includes(ch)) return { eligible: false, amountPesewas: 0, reason: 'channel' };
  const base = c.basis === 'service_charge' ? serviceChargePesewas : c.basis === 'collected' ? productPesewas + serviceChargePesewas : productPesewas;
  const amount = c.type === 'fixed' ? Number(c.fixedPesewas || 0) : Math.round(Math.max(0, base) * Number(c.percent || 0) / 100);
  return { eligible: true, amountPesewas: Math.max(0, amount), basePesewas: base };
}

// The line for texts: "incl. GHS 5 service charge". Empty when there's none.
export const feeNote = (feePesewas, money) => (Number(feePesewas) > 0 ? ` (incl. ${money(feePesewas)} service charge)` : '');
