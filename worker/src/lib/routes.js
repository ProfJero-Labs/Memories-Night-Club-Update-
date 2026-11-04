// The payment rules (public/lib/charge-rules.js: shared with the pages, so the total shown before
// paying is the total charged), plus the settings check, the Worker's only.
import { DEFAULT_ROUTES } from '../../../public/lib/charge-rules.js';
import { normalizePhone } from './util.js';
export { DEFAULT_ROUTES, routeFor } from '../../../public/lib/charge-rules.js';

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
  if (b.paystackSubaccount !== undefined) {
    const code = String(b.paystackSubaccount || '').trim();
    if (code && !SUBACCOUNT_RE.test(code)) return { error: 'The partner’s Paystack subaccount code starts with ACCT_ (copy it from Paystack → Subaccounts).' };
    n.paystackSubaccount = code;
  }
  if (b.bigWalletNumber !== undefined) {
    const given = String(b.bigWalletNumber || '').trim(), num = given ? normalizePhone(given) : '';
    if (given && !num) return { error: 'The wallet number is a Ghana number, e.g. 059 598 6313.' };
    n.bigWalletNumber = num;
  }
  if (b.bigWalletName !== undefined) n.bigWalletName = String(b.bigWalletName || '').replace(/[<>]/g, '').trim().slice(0, 60);
  if (b.enabled !== undefined) n.enabled = b.enabled === true;
  if (n.enabled && !n.paystackSubaccount) return { error: 'Enter the partner’s Paystack subaccount code before switching the new rules on: without it his share wouldn’t reach him.' };
  if (n.customerOnlyUpToPesewas > n.paystackUpToPesewas) return { error: 'The “customer pays it all” limit (GHS 300) must be at or below the Paystack limit (GHS 2,000).' };
  return n;
}

// The partner's Paystack subaccount: Paystack sends him everything but the charge.
export const SUBACCOUNT_RE = /^ACCT_[A-Za-z0-9]{6,40}$/;
