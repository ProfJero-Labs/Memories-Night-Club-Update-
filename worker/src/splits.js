// Paystack split payments: EvolveIT's platform share is routed to its own Paystack subaccount at
// the moment of payment; Memories (the main integration account) keeps the rest. The organizer's
// share is tracked in the ledger on each order — the club settles with organizers out-of-band.
//
// Config lives in settings/site:
//   platformSubaccount        "ACCT_..."   EvolveIT's Paystack subaccount code
//   platformSharePct          integer      EvolveIT's percentage of every paid transaction
//   platformAccountName       string       the resolved account name, shown in admin
//
// If either platformSubaccount or platformSharePct is missing, buildSplitObject returns null and
// the transaction is initialized without a split. That keeps checkout working even if the
// platform configuration is later removed.
//
// Paystack's transaction fee is borne by the main account (Memories) under bearer_type: 'account'.
// To split the fee proportionally between Memories and EvolveIT instead, change 'account' to
// 'all-proportional' in buildSplitObject.

import { getDoc } from './lib/firestore.js';
import { clean } from './lib/util.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

async function paystack(env, path, options = {}) {
  const r = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status === false) {
    const err = new Error(d.message || `Paystack ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return d.data;
}

// Paystack's settlement list for Ghana: banks (ghipss) and mobile money operators.
export async function listSettlementBanks(env) {
  return paystack(env, '/bank?currency=GHS&country=ghana&type=ghipss,mobile_money');
}

// Ask Paystack who owns the account before we attach a subaccount to it. For MoMo the resolve
// endpoint may not return a name — the caller treats that as a soft warning, not a hard failure.
export async function resolveBankAccount(env, { bankCode, accountNumber }) {
  const code = clean(bankCode, 20);
  const num = clean(accountNumber, 30);
  if (!code) throw new Error('Pick a settlement bank or mobile money provider.');
  if (!num) throw new Error('Enter the account number.');
  const d = await paystack(env, `/bank/resolve?account_number=${encodeURIComponent(num)}&bank_code=${encodeURIComponent(code)}`);
  return { accountName: d.account_name || '', accountNumber: d.account_number || num };
}

// Create EvolveIT's subaccount. Called once from admin. The percentage_charge is a default that
// becomes advisory under dynamic split, but Paystack requires the field, so we set it to the
// platform share.
export async function createPlatformSubaccount(env, { businessName, bankCode, accountNumber, percentageCharge, email, phone }) {
  const name = clean(businessName, 100);
  const code = clean(bankCode, 20);
  const num = clean(accountNumber, 30);
  const pct = Number(percentageCharge);
  if (!name) throw new Error('Enter the business name Paystack should show on settlements.');
  if (!code) throw new Error('Pick a settlement bank or mobile money provider.');
  if (!num) throw new Error('Enter the account or MoMo number.');
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new Error('The platform share must be a whole number from 1 to 100.');

  const d = await paystack(env, '/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: name,
      settlement_bank: code,
      account_number: num,
      percentage_charge: pct,
      ...(clean(email, 120) ? { primary_contact_email: clean(email, 120) } : {}),
      ...(clean(phone, 30) ? { primary_contact_phone: clean(phone, 30) } : {}),
    }),
  });

  return {
    subaccountCode: d.subaccount_code,
    accountName: d.account_name || name,
    settlementBank: d.settlement_bank,
    accountNumber: d.account_number,
  };
}

// Builds the split object for a checkout. Returns null when the platform share isn't configured,
// so events keep selling without a split.
export async function buildSplitObject(env) {
  const d = await getDoc(env, 'settings', 'site');
  const s = d?.fields || {};
  const subaccount = clean(s.platformSubaccount, 40);
  const pct = Number(s.platformSharePct);
  if (!subaccount || !Number.isInteger(pct) || pct < 1 || pct > 100) return null;
  return {
    type: 'percentage',
    bearer_type: 'account',
    subaccounts: [{ subaccount, share: pct }],
  };
}