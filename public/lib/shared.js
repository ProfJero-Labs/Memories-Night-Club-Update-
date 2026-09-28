// One copy of the rules both sides need: the browser imports this file directly and the Worker
// bundles it (worker/src/lib/util.js re-exports it). No DOM, no Worker APIs, no dependencies.

// ── Escaping: the only HTML escape in the project ──
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Phone: Ghana mobile numbers, stored as 0XXXXXXXXX (the SMS worker's format) ──
// Accepts "024 123 4567", "0241234567", "233241234567", "+233241234567". Anything else → null.
export function normalizePhone(raw) {
  const p = String(raw ?? '').replace(/[\s\-().]/g, '').replace(/^\+?233/, '0');
  return /^0\d{9}$/.test(p) ? p : null;
}
// For screens and logs: 024***4567.
export const maskPhone = p => { const n = normalizePhone(p); return n ? `${n.slice(0, 3)}***${n.slice(-4)}` : ''; };

// ── Money: integer pesewas only ──
// "150", "150.5", 150, "1,500" → pesewas. Throws on anything that isn't a non-negative amount,
// so a typo can never become GHS 0 or NaN. Works on strings to avoid float error ("10.10" → 1010).
export function pes(value) {
  if (value === null || value === undefined || typeof value === 'boolean') throw new TypeError('Enter an amount.');
  const s = String(value).trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new TypeError('Enter an amount in GHS, e.g. 150 or 150.50.');
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

// ── Time: every "which day / which night" decision, in Africa/Accra ──
// Stored values are UTC ISO strings. Ghana is UTC+0 today, but nothing here relies on that.
export const TZ = 'Africa/Accra';
// A night runs from its date until this hour the next morning (owner decision #4, OPEN_DECISIONS).
export const NIGHT_ROLLOVER_HOUR = 4;
const parts = d => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date(d)).map(p => [p.type, p.value]));
// Calendar date in Accra: "2026-10-02".
export function accraDayKey(d = new Date()) {
  const t = new Date(d); if (isNaN(t)) return '';
  const p = parts(t); return `${p.year}-${p.month}-${p.day}`;
}
// Which night a moment belongs to: before the rollover hour it's still the previous night.
export function nightKey(d = new Date()) {
  const t = new Date(d); if (isNaN(t)) return '';
  const p = parts(t);
  return Number(p.hour) < NIGHT_ROLLOVER_HOUR ? accraDayKey(t.getTime() - 864e5) : `${p.year}-${p.month}-${p.day}`;
}
export const formatAccra = (d, opts = {}) => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleString('en-GB', { timeZone: TZ, ...opts }); };
