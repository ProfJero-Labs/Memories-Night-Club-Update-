// The MoMo phone: the business phone with the wallet's SIM (0595986313, MTN) runs a small app that
// sends every incoming text here, signed. A "money received" text confirms the waiting MoMo-to-the-
// wallet payment automatically when everything checks out; otherwise it's shown to the Manager and
// the Human manager with the details filled in. Nobody types anything on a busy night.
//
// The wallet is on MTN, so every text comes from MTN, even when the customer paid from Telecel or
// AirtelTigo: one reader, tolerant of MTN's wording. Every raw text is kept, so the reader can be
// fixed and old texts read again (reread).
//
// Automatic confirmation needs ALL of:
//   the phone is paired and the message is signed with its secret (HMAC-SHA256, fresh timestamp)
//   the sender is MTN's (settings: routes.smsSenders; "MobileMoney" by default)
//   the text reads as money received: amount and transaction ID
//   the transaction ID has never been used (here or by hand)
//   the balance adds up: the last balance this phone reported + the amount = the new balance
//   exactly one waiting payment matches: same amount (bill + charge); if several, the reference
//   code the customer typed, then the customer's phone
// Anything else stays for a person to look at (status says why).
//
//   momo_pairing/{code}    a 6-digit code a manager makes; the app swaps it for its secret (15 min)
//   momo_devices/{id}      name, secret, active, pairedAt, pairedByName, lastSeenAt, lastBalancePesewas
//   momo_messages/{hash}   the raw text (from, body, receivedAt, deviceId), what was read, status:
//                          confirmed | waiting (no payment matched yet) | ambiguous | check_balance |
//                          used_id | bad_sender | not_payment | unreadable
import { getDoc, setDoc, listDocs, queryWhere, queryRecent } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, sha256Hex } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, audit, ghs } from './common.js';
import { commercialConfig } from '../lib/fee.js';
import { confirmWallet, CONFIRMERS } from './wallet.js';

export const PHONE_KEEPERS = ['superAdmin', 'director', 'manager', 'hrManager'];
export const DEFAULT_SENDERS = ['MobileMoney', 'MTN MoMo', 'MTNMoMo', 'MoMo'];
const SYSTEM = { uid: 'momo-phone', name: 'MoMo phone', role: 'manager' };
const OFFLINE_MS = 10 * 60e3;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ── Reading an MTN MoMo text ──
// Returns { kind: 'credit' | 'debit' | 'other', amountPesewas, txId, balancePesewas, payerPhone, payerName, reference } or null.
const cedis = s => { const n = Number(String(s || '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
export function readMomoText(body) {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const amt = t.match(/(?:GHS|GH₵|GHC|¢)\s?([\d,]+(?:\.\d{1,2})?)/i);
  const credit = /(payment received|you have received|received\s+(?:GHS|GH₵|GHC)|cash ?in received|credited)/i.test(t);
  const debit = !credit && /(cash ?out|withdraw|payment (?:made|sent)|you have (?:sent|paid|transferred)|debited|transfer(?:red)? to)/i.test(t);
  const bal = t.match(/(?:current|new|available)\s+balance(?:\s+is)?\s*:?\s*(?:GHS|GH₵|GHC|¢)\s?([\d,]+(?:\.\d{1,2})?)/i);
  const tx = t.match(/(?:transaction|trans\.?|financial transaction)\s*id\s*[:.]?\s*([A-Za-z0-9.]{6,40})/i);
  const ref = t.match(/reference\s*:?\s*([^.\s][^.]{0,40}?)(?:\.|\s+(?:transaction|trans|current|new|available|fee)|$)/i);
  const phone = t.match(/(?:\b233|\b0)(\d{9})\b/);
  const name = t.match(/from\s+(?:(?:233|0)\d{9}\s+)?([A-Z][A-Za-z.'\- ]{1,60}?)(?:\s*(?:\(|\.|,|current|new|available|reference|transaction|on\s+\d|$))/i);
  return {
    kind: credit ? 'credit' : debit ? 'debit' : 'other',
    amountPesewas: amt ? cedis(amt[1]) : null,
    txId: tx ? tx[1].replace(/\.$/, '').toUpperCase() : null,
    balancePesewas: bal ? cedis(bal[1]) : null,
    payerPhone: phone ? normalizePhone(`0${phone[1]}`) : '',
    payerName: name ? name[1].trim() : '',
    reference: ref ? ref[1].trim().toUpperCase() : '',
  };
}

// ── Pairing (a manager makes a code; the app swaps it for its secret) ──
export async function pairCode(env, user) {
  if (!requireRole(user, PHONE_KEEPERS)) return FORBIDDEN;
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await setDoc(env, 'momo_pairing', code, { createdBy: uidOf(user), createdByName: user.name || '', expiresAt: new Date(Date.now() + 15 * 60e3).toISOString(), used: false });
  return { code, minutes: 15 };
}
export async function pairPhone(env, b) {
  const code = String(b?.code || '').replace(/\D/g, '');
  const p = code.length === 6 ? await getDoc(env, 'momo_pairing', code) : null;
  if (!p || p.fields.used || new Date(p.fields.expiresAt).getTime() < Date.now()) return { error: 'That code isn’t valid any more. Ask a manager for a new one.', status: 403 };
  const deviceId = id(), secret = id() + id();
  await setDoc(env, 'momo_pairing', code, { ...p.fields, used: true, usedAt: now(), deviceId });
  await setDoc(env, 'momo_devices', deviceId, { name: clean(b?.name, 40) || 'MoMo phone', secret, active: true, pairedAt: now(), pairedByName: p.fields.createdByName, lastSeenAt: now(), lastBalancePesewas: null });
  await audit(env, { uid: p.fields.createdBy, name: p.fields.createdByName }, 'MOMO_PHONE_PAIRED', { deviceId });
  return { deviceId, secret };
}
export async function phoneStatus(env, user) {
  if (!requireRole(user, [...PHONE_KEEPERS, 'finance'])) return FORBIDDEN;
  const devices = (await listDocs(env, 'momo_devices')).filter(d => d.fields.active).map(d => ({ id: d.id, name: d.fields.name, pairedAt: d.fields.pairedAt, pairedByName: d.fields.pairedByName, lastSeenAt: d.fields.lastSeenAt, online: Date.now() - new Date(d.fields.lastSeenAt).getTime() < OFFLINE_MS }));
  const messages = (await queryRecent(env, 'momo_messages', 'storedAt', new Date(Date.now() - 2 * 864e5), 100)).map(d => ({ id: d.id, ...pick(d.fields) }));
  return { devices, anyOnline: devices.some(d => d.online), messages, canManage: !!requireRole(user, PHONE_KEEPERS) };
}
const pick = f => ({ from: f.from, body: f.body, receivedAt: f.receivedAt, storedAt: f.storedAt, status: f.status, why: f.why || '', read: f.read || null, walletPaymentId: f.walletPaymentId || '', tabNumber: f.tabNumber || '' });
export async function unpairPhone(env, b, user) {
  if (!requireRole(user, PHONE_KEEPERS)) return FORBIDDEN;
  const d = await getDoc(env, 'momo_devices', String(b?.id || ''));
  if (!d) return { error: 'Not found.', status: 404 };
  await setDoc(env, 'momo_devices', d.id, { ...d.fields, active: false, unpairedAt: now(), unpairedByName: user.name || '' });
  await audit(env, user, 'MOMO_PHONE_UNPAIRED', { deviceId: d.id });
  return { unpaired: true };
}

// ── The phone calls in (signed) ──
// Headers: x-momo-device, x-momo-time (ms), x-momo-sign = HMAC(secret, `${time}.${rawBody}`).
export async function verifyPhone(env, req, raw) {
  const deviceId = req.headers.get('x-momo-device') || '', time = Number(req.headers.get('x-momo-time') || 0), sign = (req.headers.get('x-momo-sign') || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(deviceId) || !time || !/^[0-9a-f]{64}$/.test(sign)) return null;
  if (Math.abs(Date.now() - time) > 10 * 60e3) return null; // a replayed or badly timed call
  const d = await getDoc(env, 'momo_devices', deviceId);
  if (!d?.fields?.active) return null;
  if (!same(await hmac(d.fields.secret, `${time}.${raw}`), sign)) return null;
  return d;
}
export async function phonePing(env, device) {
  await setDoc(env, 'momo_devices', device.id, { ...device.fields, lastSeenAt: now(), offlineAlertAt: null });
  return { ok: true };
}
// { messages: [{ from, body, receivedAt }] } in the order received (the app queues while offline).
export async function phoneTexts(env, device, b) {
  const list = (Array.isArray(b?.messages) ? b.messages : []).slice(0, 50);
  let dev = { ...device.fields, lastSeenAt: now(), offlineAlertAt: null };
  const results = [];
  for (const m of list) {
    const r = await handleText(env, device.id, dev, { from: clean(m?.from, 40), body: String(m?.body || '').slice(0, 1000), receivedAt: m?.receivedAt || now() });
    dev = r.dev; results.push({ status: r.status });
  }
  await setDoc(env, 'momo_devices', device.id, dev);
  return { received: results.length, results };
}

async function handleText(env, deviceId, dev, m) {
  const key = await sha256Hex(`${m.from}|${m.body}`);
  const seen = await getDoc(env, 'momo_messages', key);
  if (seen) return { dev, status: 'duplicate' }; // the same text sent twice: ignored
  const { routes } = await commercialConfig(env);
  const senders = (routes?.smsSenders?.length ? routes.smsSenders : DEFAULT_SENDERS).map(s => s.toLowerCase().replace(/\s+/g, ''));
  const base = { ...m, deviceId, storedAt: now() };
  const save = async (status, extra = {}) => { await setDoc(env, 'momo_messages', key, { ...base, status, ...extra, txId: extra.read?.txId || '' }); return status; };
  if (!senders.includes(String(m.from).toLowerCase().replace(/\s+/g, ''))) return { dev, status: await save('bad_sender', { why: 'Not from MTN MoMo’s sender name: never trusted.' }) };
  const read = readMomoText(m.body);
  if (!read || read.amountPesewas == null) return { dev, status: await save('unreadable', { read, why: 'Couldn’t read it. Kept for a person to look at.' }) };
  // Every MTN text with a balance keeps the balance chain going (money in or out).
  const prev = dev.lastBalancePesewas;
  if (read.balancePesewas != null) dev = { ...dev, lastBalancePesewas: read.balancePesewas, lastBalanceAt: now() };
  if (read.kind !== 'credit') return { dev, status: await save('not_payment', { read }) };
  if (!read.txId) return { dev, status: await save('unreadable', { read, why: 'No transaction ID in the text.' }) };
  const usedHere = (await queryWhere(env, 'momo_messages', [{ field: 'txId', value: read.txId }], { limit: 1 }))[0];
  const usedThere = (await queryWhere(env, 'wallet_payments', [{ field: 'momoRef', value: read.txId }], { limit: 1 }))[0];
  if (usedHere || usedThere) return { dev, status: await save('used_id', { read, why: 'This transaction ID was already used.' }) };
  const balanceOk = prev != null && read.balancePesewas != null && prev + read.amountPesewas === read.balancePesewas;
  // Waiting payments for this exact amount.
  const waiting = (await queryWhere(env, 'wallet_payments', [{ field: 'status', value: 'waiting' }], { limit: 500 })).map(d => ({ id: d.id, ...d.fields }))
    .filter(w => w.duePesewas === read.amountPesewas && Date.now() - new Date(w.createdAt).getTime() < 864e5);
  let match = waiting.length === 1 ? waiting[0] : null;
  if (waiting.length > 1) match = waiting.find(w => read.reference && w.code === read.reference) || (read.payerPhone ? (waiting.filter(w => w.customerPhone === read.payerPhone).length === 1 ? waiting.find(w => w.customerPhone === read.payerPhone) : null) : null);
  if (!match) return { dev, status: await save(waiting.length > 1 ? 'ambiguous' : 'waiting', { read, why: waiting.length > 1 ? `${waiting.length} payments wait for ${ghs(read.amountPesewas)}: a person picks.` : `No payment waits for ${ghs(read.amountPesewas)} right now.` }) };
  if (!balanceOk) return { dev, status: await save('check_balance', { read, walletPaymentId: match.id, tabNumber: match.tabNumber || '', why: prev == null ? 'First text from this phone: the balance can’t be checked yet. Check the wallet, then confirm.' : `The balance doesn’t add up (${ghs(prev)} + ${ghs(read.amountPesewas)} ≠ ${ghs(read.balancePesewas)}). Check the wallet itself.` }) };
  // Everything checks out: confirmed, exactly as if a manager had.
  const res = await confirmWallet(env, { id: match.id, receivedPesewas: read.amountPesewas, momoRef: read.txId }, SYSTEM, { closeIfPaid: (await import('./tabs.js')).closeIfPaid, via: 'sms', messageId: key });
  if (res.error) return { dev, status: await save('waiting', { read, walletPaymentId: match.id, why: res.error }) };
  return { dev, status: await save('confirmed', { read, walletPaymentId: match.id, tabNumber: match.tabNumber || '' }) };
}

// A person confirms from a text the phone couldn't match on its own (several the same amount, the
// balance to check): { messageId, walletPaymentId }. Same rules as confirming by hand.
export async function confirmFromText(env, b, user, { closeIfPaid }) {
  if (!requireRole(user, CONFIRMERS)) return FORBIDDEN;
  const m = await getDoc(env, 'momo_messages', String(b?.messageId || ''));
  if (!m || !m.fields.read?.txId || m.fields.status === 'confirmed') return { error: 'That text can’t be used.' };
  if (['bad_sender', 'used_id'].includes(m.fields.status)) return { error: m.fields.why || 'That text can’t be used.' };
  const res = await confirmWallet(env, { id: String(b?.walletPaymentId || ''), receivedPesewas: m.fields.read.amountPesewas, momoRef: m.fields.read.txId, acceptShort: b?.acceptShort === true, note: b?.note }, user, { closeIfPaid, via: 'text_by_hand', messageId: m.id });
  if (!res.error) await setDoc(env, 'momo_messages', m.id, { ...m.fields, status: 'confirmed', why: `Confirmed by ${user.name || 'a manager'}.`, walletPaymentId: String(b.walletPaymentId), confirmedByName: user.name || '' });
  return res;
}

// "Send a test text": reads it the way the phone would and says what would happen. Nothing is saved.
export async function testText(env, b, user) {
  if (!requireRole(user, PHONE_KEEPERS)) return FORBIDDEN;
  const read = readMomoText(b?.body);
  const waiting = read?.amountPesewas ? (await queryWhere(env, 'wallet_payments', [{ field: 'status', value: 'waiting' }], { limit: 500 })).map(d => d.fields).filter(w => w.duePesewas === read.amountPesewas) : [];
  return { read, matches: waiting.length, says: !read || read.amountPesewas == null ? 'Couldn’t read an amount: the reader needs adjusting for this wording.'
    : read.kind !== 'credit' ? 'Read as not a payment received (it only updates the balance).'
      : !read.txId ? 'No transaction ID found: the reader needs adjusting.'
        : waiting.length === 1 ? `Would confirm the payment waiting for ${ghs(read.amountPesewas)} (if the balance adds up).` : waiting.length ? `${waiting.length} payments wait for ${ghs(read.amountPesewas)}: a person would pick.` : `Read fine (${ghs(read.amountPesewas)}, ID ${read.txId}); nothing waits for that amount now.` };
}

// The phone went quiet: the Manager and the Human manager are told (once per outage).
export async function phoneOfflineAlert(env, textAll) {
  // Only while a MoMo-to-the-wallet payment is waiting (no texts in the daytime for a phone that's off).
  if (!(await queryWhere(env, 'wallet_payments', [{ field: 'status', value: 'waiting' }], { limit: 1 })).length) return 0;
  const devs = (await listDocs(env, 'momo_devices')).filter(d => d.fields.active);
  if (!devs.length || devs.some(d => Date.now() - new Date(d.fields.lastSeenAt).getTime() < 30 * 60e3)) return 0;
  const d = devs.sort((a, b) => String(b.fields.lastSeenAt).localeCompare(String(a.fields.lastSeenAt)))[0];
  if (d.fields.offlineAlertAt) return 0;
  await textAll(env, ['manager', 'hrManager'], `MEMORIES\nThe MoMo phone hasn't checked in for 30 minutes (last seen ${String(d.fields.lastSeenAt).slice(11, 16)}). Check it's on, charged and has data. Until then, confirm MoMo by hand.`);
  await setDoc(env, 'momo_devices', d.id, { ...d.fields, offlineAlertAt: now() });
  return 1;
}
