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
// Sends the prompt. { sent: true } when it's on their phone. { otp: true } when Paystack first texts
// the customer a code (it does this for numbers it doesn't know yet): staff type the code in
// (submitMomoCode) and then the prompt comes. { sent: false } when it couldn't be sent (unknown
// network, or it failed): then the customer pays with the link they're texted.
export async function momoPrompt(env, { phone, amountPesewas, reference, email, metadata }) {
  const provider = momoProvider(phone);
  if (!provider) return { sent: false };
  try {
    const c = await paystackPost(env, '/charge', { email, amount: amountPesewas, currency: 'GHS', reference, mobile_money: { phone, provider }, metadata });
    if (c?.status === 'send_otp') return { otp: true };
    return { sent: c?.status !== 'failed' };
  } catch { return { sent: false }; }
}
// The code Paystack texted the customer, passed on. Paystack then sends the MoMo prompt.
export async function submitMomoCode(env, reference, otp) {
  const code = String(otp || '').replace(/\D/g, '');
  if (code.length < 4 || code.length > 8) return { error: 'Type the code from the customer’s text (numbers only).' };
  try {
    const c = await paystackPost(env, '/charge/submit_otp', { otp: code, reference });
    if (c?.status === 'failed') return { error: 'Paystack didn’t accept that code. Check it with the customer and try again.' };
    if (c?.status === 'send_otp') return { error: 'That code didn’t work. Ask the customer for the newest code in their messages.' };
    return { accepted: true, status: c?.status || '' };
  } catch (e) { return { error: e.message && /otp|code/i.test(e.message) ? 'Paystack didn’t accept that code. Check it with the customer and try again.' : 'Couldn’t reach Paystack. Try again.' }; }
}
