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
// Shared by the Worker (which charges) and the pages (which show the total before paying).

export const DEFAULT_ROUTES = {
  enabled: true,                  // on: the owner's rules (November 2026); only the admin changes them
  percent: 5,                     // the charge, % of the bill
  customerOnlyUpToPesewas: 30000, // GHS 300: up to and including this, the customer pays it all
  paystackUpToPesewas: 200000,    // GHS 2,000: up to and including this, Paystack is offered
  venueSharePercent: 50,          // above GHS 300, the venue's part of the charge
  customerMinPesewas: 1500,       // above GHS 300, the customer still pays at least GHS 15
  bigFlatPesewas: 10000,          // above GHS 2,000: the flat charge on MoMo to the wallet
  paystackFeePercent: 1.95,       // only for estimates shown before paying; the real fee is Paystack's
  paystackSubaccount: 'ACCT_89qd3ub03w61erk', // the partner's Paystack subaccount: his share goes straight to him
  bigWalletNumber: '0595986313',  // the partner's MoMo merchant wallet, for bills above the Paystack limit
  bigWalletName: 'Samuel Forson / Memories Night Club', // the name customers see when they send to it
  bigWalletQr: '00020101021132790018GH.NET.GHIPSS.GHQR01163346159950641821020601000003030010416E20761029T1547075204581453039365802GH5919MEMORIES NIGHT CLUB6010Cape Coast610800000001622203083346159907063346156304CD28', // the club's GhQR (MTN MoMo scan-to-pay) code: each bill's QR is made from it, with the amount added
};

const int = v => Math.max(0, Math.round(Number(v) || 0));

// What the rules say for a bill. cfg: the settings (DEFAULT_ROUTES filled in).
//   { billPesewas, tenders: ['cash', 'paystack'] or ['cash', 'momo_direct'], paystack|momo: {...} }
// bandBillPesewas (optional): the whole bill's total, when only part of it is being paid now. The
// whole bill decides the route (so a big table can't be paid in small Paystack pieces); the charge
// is on the amount paid now.
export function routeFor(billPesewas, cfg = DEFAULT_ROUTES, { bandBillPesewas } = {}) {
  const c = { ...DEFAULT_ROUTES, ...(cfg || {}) };
  const bill = int(billPesewas), whole = Math.max(bill, int(bandBillPesewas ?? bill));
  const rule = { percent: c.percent, customerOnlyUpToPesewas: c.customerOnlyUpToPesewas, paystackUpToPesewas: c.paystackUpToPesewas, venueSharePercent: c.venueSharePercent, customerMinPesewas: c.customerMinPesewas, bigFlatPesewas: c.bigFlatPesewas };
  const cash = { tender: 'cash', chargePesewas: 0, customerSharePesewas: 0, venueSharePesewas: 0, customerPaysPesewas: bill, venueRecordsPesewas: bill };
  if (whole > c.paystackUpToPesewas) {
    const flat = int(c.bigFlatPesewas);
    return { billPesewas: bill, band: 'big', tenders: ['cash', 'momo_direct'], cash, rule,
      momo: { tender: 'momo_direct', chargePesewas: flat, customerSharePesewas: flat, venueSharePesewas: 0, customerPaysPesewas: bill + flat, venueRecordsPesewas: bill, evolveitPesewas: flat } };
  }
  const charge = int(bill * Number(c.percent) / 100);
  let customer = charge, band = 'small';
  if (whole > c.customerOnlyUpToPesewas) {
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
