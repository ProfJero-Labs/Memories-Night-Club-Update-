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
// A checkout's claim secret (pay in full, or a pay-in-bits order): handed only to the buyer's
// browser, stored only as a hash.
// The payment-return page needs it (not just the Paystack reference, which staff and receipts see)
// to be shown the ticket links.
export const claimSecret = () => id() + id();
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
export const displayCode = token => `MEM-${token.slice(0, 6).toUpperCase()}`;
// What a table booking is called at the door and in its text (the order id is not a credential).
export const tableCode = orderId => `TBL-${String(orderId).slice(0, 6).toUpperCase()}`;
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

// Staff invite passwords: three short words + three digits, e.g. "SunDogMoon482". Easy to read
// over the phone and type on a phone keyboard; three words (not two) because these accounts can
// run the whole club: about 57.6 million combinations, on top of Firebase's sign-in throttling.
// Staff are told to change it after their first sign-in.
const PASSWORD_WORDS = [
  'Sun', 'Sky', 'Sea', 'Bay', 'Ash', 'Ivy', 'Oak', 'Fir', 'Elm', 'Bee',
  'Cat', 'Dog', 'Fox', 'Owl', 'Ant', 'Bat', 'Emu', 'Ram', 'Cod', 'Jay',
  'Red', 'Blue', 'Gold', 'Pink', 'Sand', 'Salt', 'Rain', 'Snow', 'Wind', 'Fire',
  'Moon', 'Star', 'Cloud', 'Leaf', 'Tree', 'Rock', 'Wave', 'Tide', 'Fern', 'Reed',
];
export function generatePassword() {
  const b = crypto.getRandomValues(new Uint32Array(4));
  const words = [0, 1, 2].map(i => PASSWORD_WORDS[b[i] % PASSWORD_WORDS.length]).join('');
  return `${words}${100 + (b[3] % 900)}`;
}

// ── Pay-in-bits order codes ──
// New orders get a readable code from the night's name, e.g. NOSADDAYS-001. Being readable means
// it is not a secret: looking an order up always needs the phone number on it too (or a code
// texted to that phone). Older orders keep their MEM-XXXXX-XXXXX / MEM-AB1234 codes.
export function eventSlug(name) {
  const s = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return s || 'MEM';
}
// What a guest types → the stored code, or null. Forgives case, spaces and a missing zero pad
// ("nosaddays 1" → NOSADDAYS-001); legacy MEM- codes go through normalizeOrderCode.
export function normalizePlanCode(raw) {
  const s = String(raw ?? '').toUpperCase().trim();
  if (/^MEM\b|^MEM-/.test(s)) { const legacy = normalizeOrderCode(s); if (legacy) return legacy; }
  const m = /^([A-Z0-9]{1,10})[\s_-]*-?(\d{1,4})$/.exec(s.replace(/\s+/g, '-'));
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(3, '0')}`;
}
// A 6-digit code for SMS confirmation, from the CSPRNG (never Math.random).
export const sixDigits = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
