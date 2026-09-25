import { esc } from './util.js';

// SMS goes through the club's existing SMS Worker. Payload shape matches what that worker already
// accepts from the old admin (event/sms.js): {sender, recipients:[phone], message} → {success}.
// Preferred transport is a Cloudflare service binding (env.SMS), which never leaves Cloudflare and
// lets the SMS worker drop its public URL entirely; otherwise the URL is called with a shared key.
export function smsRequest(env, path, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (env.SMS_WORKER_KEY) headers['X-Memories-Key'] = env.SMS_WORKER_KEY;
  if (env.SMS?.fetch) return env.SMS.fetch(new Request(`https://sms.internal${path}`, { ...init, headers }));
  if (!env.SMS_WORKER_URL) throw new Error('SMS is not configured');
  return fetch(`${env.SMS_WORKER_URL.replace(/\/$/, '')}${path}`, { ...init, headers });
}

// Never throws: a failed text is logged, it never rolls back a payment or a check-in.
export async function sendSms(env, phone, message) {
  if (!phone || !(env.SMS?.fetch || env.SMS_WORKER_URL)) return false;
  try {
    const r = await smsRequest(env, '/send-sms', { method: 'POST', body: JSON.stringify({ sender: env.SMS_SENDER || 'MEMORIES', recipients: [phone], message }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false) { console.error('SMS send failed', r.status, d.error || ''); return false; }
    return true;
  } catch (e) { console.error('SMS send threw', e); return false; }
}

// Email via Brevo, server-side only. Every interpolated value is escaped by the caller's template.
export async function sendEmail(env, to, subject, lines) {
  if (!to || !env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return false;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || 'Memories Night Club' }, to: [{ email: to }], subject, html }) });
    if (!r.ok) console.error('Brevo failed', r.status);
    return r.ok;
  } catch (e) { console.error('Brevo threw', e); return false; }
}

export const siteUrl = (env, path) => `${(env.PUBLIC_SITE_URL || '').replace(/\/$/, '')}${path}`;
