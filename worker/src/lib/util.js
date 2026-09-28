// Rules shared with the browser: one copy of escaping, phone, money and Accra time.
import { accraDayKey } from '../../../public/lib/shared.js';
export { esc, normalizePhone, maskPhone, pes, accraDayKey, nightKey, formatAccra, NIGHT_ROLLOVER_HOUR } from '../../../public/lib/shared.js';

export const now = () => new Date();
export const id = () => crypto.randomUUID().replaceAll('-', '');
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
// Paystack reference: time-ordered plus 64 random bits, so it can't be guessed to read a checkout.
export const paymentRef = () => `MEM-${Date.now()}-${hex(8).toUpperCase()}`;
// A ticket's document id is its bearer token: ~244 bits of randomness.
export const ticketToken = () => id() + id();
export const displayCode = token => `MEM-${token.slice(0, 6).toUpperCase()}`;
// Short human-typeable order code for pay-in-bits orders (MEM-4821 style, with a letter pair so
// the space isn't trivially small).
export function orderCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `MEM-${letters[r[0] % 24]}${letters[r[1] % 24]}${1000 + (r[2] % 9000)}`;
}

export const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export const money = pesewas => `GHS ${(Number(pesewas || 0) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}`;

export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
export const firstName = full => String(full || '').trim().split(/\s+/)[0] || '';

// Calendar dates are Africa/Accra dates (shared helper; see public/lib/shared.js).
export const dateKey = accraDayKey;
