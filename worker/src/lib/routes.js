// How a bill can be paid, and what the charge is (owner's rules, November 2026). One venue.
//
// The charge is always `percent` (5%) of the bill. On Paystack, Paystack takes its fee out of it
// and EvolveIT keeps the rest. Who pays the charge depends on the bill:
//   cash, any amount                    no charge
//   Paystack, bill ≤ customerOnlyUpTo   the customer pays all of it            (≤ GHS 300)
//   Paystack, bill ≤ paystackUpTo       split venueSharePercent (50/50) between customer and venue,
//                                       but the customer pays at least customerMin (GHS 15), so a
//                                       bill just over 300 never costs the customer less than 300
//   bill > paystackUpTo                 no Paystack: MoMo straight to the partner's merchant wallet,
//                                       a flat charge (GHS 100) paid by the customer, owed to EvolveIT
// The bill is the whole bill's total after discounts, never tips. All amounts are whole pesewas:
// the charge is rounded to the pesewa, the customer's share too, and the venue's share is the rest,
// so the two always add up to the charge exactly.
// Every figure worked out here is copied onto the payment, so changing the settings never changes
// a past payment.

export const DEFAULT_ROUTES = {
  enabled: false,                 // off until the owner switches the new rules on
  percent: 5,                     // the charge, % of the bill
  customerOnlyUpToPesewas: 30000, // GHS 300: up to and including this, the customer pays it all
  paystackUpToPesewas: 200000,    // GHS 2,000: up to and including this, Paystack is offered
  venueSharePercent: 50,          // above GHS 300, the venue's part of the charge
  customerMinPesewas: 1500,       // above GHS 300, the customer still pays at least GHS 15
  bigFlatPesewas: 10000,          // above GHS 2,000: the flat charge on MoMo to the wallet
  paystackFeePercent: 1.95,       // only for estimates shown before paying; the real fee is Paystack's
};

const int = v => Math.max(0, Math.round(Number(v) || 0));

// What the rules say for a bill. cfg: the settings (DEFAULT_ROUTES filled in).
//   { billPesewas, tenders: ['cash', 'paystack'] or ['cash', 'momo_direct'], paystack|momo: {...} }
export function routeFor(billPesewas, cfg = DEFAULT_ROUTES) {
  const c = { ...DEFAULT_ROUTES, ...(cfg || {}) };
  const bill = int(billPesewas);
  const rule = { percent: c.percent, customerOnlyUpToPesewas: c.customerOnlyUpToPesewas, paystackUpToPesewas: c.paystackUpToPesewas, venueSharePercent: c.venueSharePercent, customerMinPesewas: c.customerMinPesewas, bigFlatPesewas: c.bigFlatPesewas };
  const cash = { tender: 'cash', chargePesewas: 0, customerSharePesewas: 0, venueSharePesewas: 0, customerPaysPesewas: bill, venueRecordsPesewas: bill };
  if (bill > c.paystackUpToPesewas) {
    const flat = int(c.bigFlatPesewas);
    return { billPesewas: bill, band: 'big', tenders: ['cash', 'momo_direct'], cash, rule,
      momo: { tender: 'momo_direct', chargePesewas: flat, customerSharePesewas: flat, venueSharePesewas: 0, customerPaysPesewas: bill + flat, venueRecordsPesewas: bill, evolveitPesewas: flat } };
  }
  const charge = int(bill * Number(c.percent) / 100);
  let customer = charge, band = 'small';
  if (bill > c.customerOnlyUpToPesewas) {
    band = 'middle';
    const half = int(charge * (100 - Number(c.venueSharePercent)) / 100);
    customer = Math.min(charge, Math.max(half, int(c.customerMinPesewas)));
  }
  const venue = charge - customer, pays = bill + customer;
  // An estimate only (shown before paying): Paystack charges its % on everything the customer pays.
  const feeEst = int(pays * Number(c.paystackFeePercent) / 100);
  return { billPesewas: bill, band, tenders: ['cash', 'paystack'], cash, rule,
    paystack: { tender: 'paystack', chargePesewas: charge, customerSharePesewas: customer, venueSharePesewas: venue, customerPaysPesewas: pays, venueRecordsPesewas: bill - venue,
      paystackFeeEstimatePesewas: feeEst, evolveitEstimatePesewas: Math.max(0, charge - feeEst) } };
}

// Checks a settings change; returns the cleaned settings, or { error }.
export function cleanRoutes(input, current = DEFAULT_ROUTES) {
  const n = { ...DEFAULT_ROUTES, ...(current || {}) };
  const b = input || {};
  const money = (k, label, max = 10_000_000) => {
    if (b[k] === undefined) return null;
    const v = Number(b[k]);
    if (!Number.isInteger(v) || v < 0 || v > max) return `${label} must be an amount of 0 or more.`;
    n[k] = v; return null;
  };
  const pct = (k, label, max) => {
    if (b[k] === undefined) return null;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0 || v > max) return `${label} must be a percentage from 0 to ${max}.`;
    n[k] = Math.round(v * 100) / 100; return null;
  };
  const err = pct('percent', 'The charge', 20) || pct('venueSharePercent', 'The venue’s share', 100) || pct('paystackFeePercent', 'Paystack’s fee estimate', 20)
    || money('customerOnlyUpToPesewas', 'The “customer pays it all” limit') || money('paystackUpToPesewas', 'The Paystack limit')
    || money('customerMinPesewas', 'The customer’s smallest share') || money('bigFlatPesewas', 'The flat charge on big bills');
  if (err) return { error: err };
  if (b.enabled !== undefined) n.enabled = b.enabled === true;
  if (n.customerOnlyUpToPesewas > n.paystackUpToPesewas) return { error: 'The “customer pays it all” limit (GHS 300) must be at or below the Paystack limit (GHS 2,000).' };
  return n;
}
