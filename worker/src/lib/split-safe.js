// A payment must never fail because of the partner's split. If Paystack refuses a payment that
// carries the split (e.g. the subaccount code isn't on the club's live Paystack account), it is
// sent again without it: the customer pays, the whole amount reaches the club's account, and the
// directors and finance are told the partner's share needs paying by hand (split_failures).
import { setDoc } from './firestore.js';

const SPLIT_KEYS = ['subaccount', 'transaction_charge', 'bearer', 'split_code'];

export async function sendSplitSafe(env, body, send) {
  const hasSplit = body && SPLIT_KEYS.some(k => body[k] !== undefined);
  try { return await send(body); }
  catch (e) {
    if (!hasSplit) throw e;
    const plain = Object.fromEntries(Object.entries(body).filter(([k]) => !SPLIT_KEYS.includes(k)));
    const out = await send(plain); // if this fails too, the problem isn't the split: the error stands
    await noteSplitFailed(env, body, e.message).catch(() => {});
    return out;
  }
}

async function noteSplitFailed(env, body, reason) {
  const at = new Date().toISOString(), day = at.slice(0, 10);
  await setDoc(env, 'split_failures', String(body.reference || `${Date.now()}`), {
    reference: body.reference || '', amountPesewas: Number(body.amount || 0), subaccount: body.subaccount || '', transactionChargePesewas: Number(body.transaction_charge || 0),
    reason: String(reason || '').slice(0, 300), at, partnerShareToPayByHand: true,
  });
  // One alert a day in the directors' app (no texts to directors).
  await setDoc(env, 'app_alerts', `split-${day}`, { roles: ['director'], at,
    text: `Paystack refused the partner's split (${String(reason || 'no reason given').slice(0, 120)}). Payments are going through without it: the whole amount reaches the club's Paystack account, and the partner's share must be paid by hand. Ask the admin to check the subaccount code ${body.subaccount || ''} on the live Paystack account.` });
}
