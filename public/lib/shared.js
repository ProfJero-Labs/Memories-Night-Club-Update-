// One copy of the rules both sides need: the browser imports this file directly and the Worker
// bundles it (worker/src/lib/util.js re-exports it). No DOM, no Worker APIs, no dependencies.

// ── Escaping: the only HTML escape in the project ──
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Phone: Ghana mobile numbers, stored as 0XXXXXXXXX (the SMS worker's format) ──
// Accepts "024 123 4567", "0241234567", "233241234567", "+233241234567". Anything else → null.
export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  if (/^233\d{9}$/.test(d)) return '0' + d.slice(3);   // +233241234567 → 0241234567
  if (/^0\d{9}$/.test(d)) return d;                     // 0241234567       → 0241234567
  if (/^\d{9}$/.test(d)) return '0' + d;                // 241234567        → 0241234567
  return null;
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

// ── Pay in bits: the rule the guest ticks before starting (owner decision #1, OPEN_DECISIONS) ──
// Changing the rule means changing this text AND the version; the Worker stores the version and
// the time with each plan, so it's always known which wording a guest agreed to.
export const BITS_POLICY_VERSION = '2026-09-forfeit-at-start';
export const BITS_ACK_TEXT = 'I understand my ticket is only issued once the full price is paid, and that if the balance isn’t paid by the time the night starts, the order is forfeited and what I’ve paid is not refunded.';

// ── Ticket designs: each night looks different ──
// A night picks a design (or "auto") and carries colours taken from its own flyer at upload.
export const TICKET_STYLES = ['classic', 'poster', 'neon', 'split', 'stamp', 'marquee', 'vinyl', 'sunburst', 'holo', 'coast'];
const HEX = /^#[0-9a-f]{6}$/i;
// Validates stored colours: { accent, dark, light } as #rrggbb, or null.
export const cleanTicketColors = c => (c && HEX.test(c.accent) && HEX.test(c.dark) && HEX.test(c.light) ? { accent: c.accent.toLowerCase(), dark: c.dark.toLowerCase(), light: c.light.toLowerCase() } : null);
// Brand-safe palettes for nights that have no flyer colours yet.
export const FALLBACK_PALETTES = [
  { accent: '#e0245e', dark: '#1a0a10', light: '#f3ead9' }, { accent: '#2fb5a3', dark: '#071a18', light: '#e6f2ee' },
  { accent: '#e8a520', dark: '#1c1406', light: '#f6ecd6' }, { accent: '#8b5cf6', dark: '#130b24', light: '#ede7fb' },
  { accent: '#ff5a36', dark: '#1f0b06', light: '#fbe9e2' }, { accent: '#3b82f6', dark: '#07122a', light: '#e4ecfa' },
];
const hash = s => { let h = 2166136261; for (const ch of String(s || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// "Auto" nights in the same month get different designs: in date order, each takes the next design
// no other night that month has (chosen by hand or already given). The starting design moves on
// each month. With ten designs, a month of up to ten Friday/Saturday nights has ten looks.
// events: [{ id, date, ticketStyle }] (all nights, any visibility). Returns Map(id → style).
export function monthStyles(events) {
  const byMonth = new Map();
  for (const e of events) { const m = accraDayKey(e.date).slice(0, 7); if (m) (byMonth.get(m) || byMonth.set(m, []).get(m)).push(e); }
  const out = new Map();
  for (const [month, list] of byMonth) {
    list.sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.id).localeCompare(String(b.id)));
    const used = new Set(list.map(e => e.ticketStyle).filter(st => TICKET_STYLES.includes(st)));
    const [y, mo] = month.split('-').map(Number);
    let next = (y * 12 + mo) % TICKET_STYLES.length;
    for (const e of list) {
      if (TICKET_STYLES.includes(e.ticketStyle)) { out.set(e.id, e.ticketStyle); continue; }
      let pick = null;
      for (let k = 0; k < TICKET_STYLES.length; k++) { const st = TICKET_STYLES[(next + k) % TICKET_STYLES.length]; if (!used.has(st)) { pick = st; next = (next + k + 1) % TICKET_STYLES.length; break; } }
      if (!pick) { pick = TICKET_STYLES[next]; next = (next + 1) % TICKET_STYLES.length; } // an 11th night reuses
      used.add(pick); out.set(e.id, pick);
    }
  }
  return out;
}

// The design a night's tickets use: its chosen style, else the month's pick (autoStyle, from
// monthStyles on the server), else one picked from its id; and its flyer colours (or a palette).
export function ticketDesign({ id, ticketStyle, ticketColors, autoStyle } = {}) {
  const h = hash(id);
  const style = TICKET_STYLES.includes(ticketStyle) ? ticketStyle : TICKET_STYLES.includes(autoStyle) ? autoStyle : TICKET_STYLES[h % TICKET_STYLES.length];
  return { style, colors: cleanTicketColors(ticketColors) || FALLBACK_PALETTES[(h >>> 8) % FALLBACK_PALETTES.length] };
}

// ── Ticket promos (worker/src/promos.js): the same maths on the page and in the Worker ──
// percent: value% off each ticket (1–90); amount: value pesewas off each ticket; bundle: buy N, pay for M.
// Never more off than leaves GHS 1 to pay (Paystack's smallest charge; free tickets are comps).
export const PROMO_MIN_ORDER_PESEWAS = 100;
export function promoDiscount(p, unit, qty) {
  let off = 0;
  if (p.kind === 'percent') off = Math.round(unit * qty * Math.min(90, Math.max(0, Number(p.value) || 0)) / 100);
  else if (p.kind === 'amount') off = Math.min(unit, Math.max(0, Number(p.value) || 0)) * qty;
  else if (p.kind === 'bundle') {
    const buy = Number(p.buy), pay = Number(p.pay);
    if (buy >= 2 && pay >= 1 && pay < buy) off = Math.floor(qty / buy) * (buy - pay) * unit;
  }
  return Math.max(0, Math.min(off, unit * qty - PROMO_MIN_ORDER_PESEWAS));
}
export function promoText(p) {
  if (p.kind === 'percent') return `${Number(p.value)}% off`;
  if (p.kind === 'amount') return `GHS ${(Number(p.value) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })} off each`;
  return `Buy ${p.buy}, pay for ${p.pay}`;
}
// The best automatic promo for this pick (the page's view; the Worker decides at checkout).
export function pickPromo(promos, ticketTypeId, unit, qty) {
  let best = null;
  for (const p of promos || []) {
    if ((p.ticketTypeIds || []).length && !p.ticketTypeIds.includes(ticketTypeId)) continue;
    if (p.left !== null && p.left !== undefined && p.left < qty) continue;
    const off = promoDiscount(p, unit, qty);
    if (off > 0 && (!best || off > best.off)) best = { promo: p, off };
  }
  return best;
}

// ── Forgiving drink search (the QR menu) ──
// Small mistakes are pardoned: "henikin" finds Heineken, "hennesy" Hennessy, "star bear" Star Beer,
// "guiness" Guinness, "smirnof" Smirnoff. Every word typed must match a word of the name or group:
// as its start, inside it, by its consonants ("hnkn" = Heineken), or within one or two typos.
// Returns a score (0 = no match; higher = better) so the best matches can come first.
const searchNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const skeleton = w => w.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length];
}
function wordScore(q, w) {
  if (w.startsWith(q)) return 4;
  if (q.length >= 3 && w.includes(q)) return 3;
  if (q.length < 3) return 0;
  const tol = q.length <= 4 ? 1 : 2;
  if (editDistance(q, w, tol) <= tol || editDistance(q, w.slice(0, q.length), tol - (q.length <= 5 ? 0 : 1)) <= tol - (q.length <= 5 ? 0 : 1)) return 2;
  const sq = skeleton(q), sw = skeleton(w);
  if (sq.length >= 2 && (sq === sw || (sq.length >= 3 && sw.startsWith(sq)) || (sq.length >= 4 && editDistance(sq, sw, 1) <= 1))) return 1;
  return 0;
}
// Names people call drinks by. Add more here as the bar hears them.
const DRINK_NICKNAMES = { coke: 'coca cola', jd: 'jack daniels', henny: 'hennessy', jw: 'johnnie walker', mineral: 'water', minerals: 'soft drinks', malt: 'malta' };
// Looser: any one word typed matches (for when nothing matches every word, e.g. "guiness stout"
// on a menu that only has "Stout").
export function drinkMatchAny(query, ...fields) {
  return Math.max(0, ...searchNorm(query).split(' ').filter(Boolean).map(w => drinkMatch(w, ...fields)));
}
export function drinkMatch(query, ...fields) {
  const norm = searchNorm(query);
  const alias = DRINK_NICKNAMES[norm];
  if (alias && norm !== alias) { const a = drinkMatch(alias, ...fields); if (a) return a; }
  const words = norm.split(' ').filter(Boolean);
  if (!words.length) return 1;
  const hay = searchNorm(fields.join(' ')).split(' ').filter(Boolean);
  const joined = hay.join('');
  let score = 0;
  for (const q of words) {
    let best = Math.max(0, ...hay.map(w => wordScore(q, w)));
    if (!best && q.length >= 4 && joined.includes(q)) best = 2;   // "starbeer"
    if (!best) return 0;
    score += best;
  }
  return score;
}
