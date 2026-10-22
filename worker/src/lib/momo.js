// MoMo prompts through Paystack's Charge API: a payment request appears on the customer's own
// phone and they approve it there. Used at the gate and when a waiter closes a tab.
export async function paystackPost(env, path, body) {
  const r = await fetch(`https://api.paystack.co${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.status) throw new Error(d.message || 'Paystack request failed');
  return d.data;
}
// The MoMo network from the number (Paystack's provider codes for Ghana).
export function momoProvider(phone) {
  const p = String(phone).slice(0, 3);
  if (['024', '054', '055', '059', '025', '053'].includes(p)) return 'mtn';
  if (['020', '050'].includes(p)) return 'vod';
  if (['026', '056', '027', '057'].includes(p)) return 'atl';
  return null;
}
// Sends the prompt. true when it's on their phone; false when it couldn't be sent (unknown network,
// or Paystack wants a voucher/OTP instead): then the customer pays with the link they're texted.
export async function momoPrompt(env, { phone, amountPesewas, reference, email, metadata }) {
  const provider = momoProvider(phone);
  if (!provider) return false;
  try {
    const c = await paystackPost(env, '/charge', { email, amount: amountPesewas, currency: 'GHS', reference, mobile_money: { phone, provider }, metadata });
    return !(c?.status === 'send_otp' || c?.status === 'failed');
  } catch { return false; }
}
