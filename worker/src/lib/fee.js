// The service fee: a percentage the customer pays on top of anything paid through Paystack
// (tickets, tables, pay in bits, the gate's MoMo sales, a tab's bill or MoMo prompt, the bar's app
// orders). Cash isn't charged. The admin sets the percentage in Settings (5% unless changed).
// The fee is worked out here, never in the browser, and kept apart from the ticket or drinks
// money: amountPesewas stays what the ticket, table or bill costs; chargePesewas is what Paystack
// is asked for (amount + tip + fee), and that is what the payment check compares.
import { getSettings } from '../public.js';

export const DEFAULT_FEE_PERCENT = 5;
export const MAX_FEE_PERCENT = 20;
export const feePercentOf = settings => {
  const n = Number(settings?.serviceFeePercent);
  return Number.isFinite(n) && n >= 0 && n <= MAX_FEE_PERCENT ? n : DEFAULT_FEE_PERCENT;
};
export const feeOf = (pesewas, pct) => Math.round(Number(pesewas || 0) * Number(pct || 0) / 100);

// { feePercent, feePesewas } for an amount (the tip is never charged a fee).
export async function serviceFee(env, pesewas, settings) {
  const feePercent = feePercentOf(settings || await getSettings(env));
  return { feePercent, feePesewas: feeOf(pesewas, feePercent) };
}
// The line for texts and screens: "incl. GHS 5 service fee". Empty when there's no fee.
export const feeNote = (feePesewas, money) => (Number(feePesewas) > 0 ? ` (incl. ${money(feePesewas)} service fee)` : '');
