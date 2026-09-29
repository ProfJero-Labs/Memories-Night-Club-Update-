// Rules shared with the browser: one copy of escaping, phone, money and Accra time.
import { accraDayKey } from '../../../public/lib/shared.js';
export { esc, normalizePhone, maskPhone, pes, accraDayKey, nightKey, formatAccra, NIGHT_ROLLOVER_HOUR, BITS_POLICY_VERSION, TICKET_STYLES, cleanTicketColors, monthStyles } from '../../../public/lib/shared.js';

export const now = () => new Date();
export const id = () => crypto.randomUUID().replaceAll('-', '');
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
// Paystack reference: time-ordered plus 64 random bits, so it can't be guessed to read a checkout.
export const paymentRef = () => `MEM-${Date.now()}-${hex(8).toUpperCase()}`;
// A ticket's document id is its bearer token: ~244 bits of randomness.
export const ticketToken = () => id() + id();
export const displayCode = token => `MEM-${token.slice(0, 6).toUpperCase()}`;
// Pay-in-bits order code: MEM-XXXXX-XXXXX, 10 Crockford Base32 characters from the CSPRNG
// (50 bits; no I, L, O, U, so it reads cleanly over the phone). Uniqueness is checked on create.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function orderCode() {
  const c = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => CROCKFORD[b & 31]).join('');
  return `MEM-${c.slice(0, 5)}-${c.slice(5)}`;
}
// What a guest types → the stored code, or null. New codes forgive case, spaces, missing dashes
// and O/I/L typos. Codes from before the change (MEM-AB1234) are matched exactly as they were.
export function normalizeOrderCode(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/\s+/g, '');
  if (/^MEM-[A-Z]{2}\d{4}$/.test(s)) return s;
  const body = s.replace(/^MEM-?/, '').replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(body)) return null;
  return `MEM-${body.slice(0, 5)}-${body.slice(5)}`;
}

export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export const money = pesewas => `GHS ${(Number(pesewas || 0) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}`;

export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
export const firstName = full => String(full || '').trim().split(/\s+/)[0] || '';

// Calendar dates are Africa/Accra dates (shared helper; see public/lib/shared.js).
export const dateKey = accraDayKey;

// Random alphanumeric password for staff invites. Avoids look-alike chars (0/O, 1/I/l).
export function generatePassword(len = 14) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}