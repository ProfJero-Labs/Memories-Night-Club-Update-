// The invitation visa (e.g. Ladies Night), drawn as a picture so it looks the same on every phone,
// downloads as an image, and makes a post for social media.
//
// drawn on a 358 × 236 grid (scaled up for a sharp image):
//   a red side band with a hologram seal (the Memories infinity sign), security-print lines, the
//   night's name in script (shrunk to fit), typewriter fields (valid on, entries, holder = the phone's
//   last four, dress code, privileges), an "ADMIT TWO" ink stamp, a passport-style code line, and
//   once she's in, a blue "ENTERED" stamp.
// The post (1080 × 1350) shows the visa on Memories red with "I'm on the list"; the phone digits are
// hidden on it, since it's for posting.
import { formatAccra } from '../app.js';

export const VISA_W = 358, VISA_H = 236;
const venueText = t => String(t.venue || 'SamRit Hotel, Cape Coast').toUpperCase();
const INFINITY = 'M18 32c0-4.4 3-7.5 6.6-7.5 6.8 0 8 15 14.8 15 3.6 0 6.6-3.1 6.6-7.5s-3-7.5-6.6-7.5c-6.8 0-8 15-14.8 15-3.6 0-6.6-3.1-6.6-7.5Z';
const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
const F = { card: '"Share Tech Mono", "Space Mono", ui-monospace, monospace', script: '"Great Vibes", "Instrument Serif", cursive', mono: '"Space Mono", ui-monospace, monospace', serif: '"Cormorant Garamond", "Instrument Serif", Georgia, serif', display: 'Anton, Impact, sans-serif', sans: 'Archivo, system-ui, sans-serif' };

export async function loadVisaFonts() {
  if (!document.fonts?.load) return;
  await Promise.all([`400 12px ${F.card}`, `400 46px ${F.script}`, `700 10px ${F.mono}`, `400 10px ${F.mono}`, `italic 500 38px ${F.serif}`, `italic 500 13px ${F.serif}`, `400 15px ${F.display}`, `600 7px ${F.sans}`, `700 7px ${F.sans}`]
    .map(f => document.fonts.load(f).catch(() => {})));
}

// A small seeded random, so every card's ink texture is the same each time it's drawn.
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// Letter-spaced text, drawn a letter at a time (works on every browser). Returns the width used.
function spaced(ctx, text, x, y, spacing, align = 'left') {
  const chars = [...text], widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const prev = ctx.textAlign; ctx.textAlign = 'left';
  chars.forEach((c, i) => { ctx.fillText(c, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = prev; return total;
}
// Text no wider than maxW: the font shrinks until it fits.
function fitFont(ctx, text, font, size, maxW, min = 6) {
  let s = size;
  do { ctx.font = font.replace('{s}', `${s}px`); if (ctx.measureText(text).width <= maxW) break; s -= 0.5; } while (s > min);
  return s;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

// An ink stamp: rings, words around the edge, one or two words in the middle, a worn ink texture.
function stamp(ctx, { cx, cy, r, rot, colour, ring, l1, l2, seed, blend = 'multiply' }) {
  const size = Math.ceil(r * 2 + 8), off = document.createElement('canvas');
  const k = ctx.getTransform().a || 1; // draw at the target's resolution
  off.width = off.height = Math.ceil(size * k);
  const s = off.getContext('2d'); s.scale(k, k); s.translate(size / 2, size / 2);
  s.strokeStyle = s.fillStyle = colour;
  [[r * 0.96, 3], [r * 0.85, 1], [r * 0.56, 1.2]].forEach(([rr, lw]) => { s.lineWidth = lw; s.beginPath(); s.arc(0, 0, rr, 0, Math.PI * 2); s.stroke(); });
  s.font = `700 ${r * 0.158}px ${F.mono}`; s.textAlign = 'center'; s.textBaseline = 'middle';
  const chars = [...ring], step = (Math.PI * 2) / chars.length, rr = r * 0.705;
  chars.forEach((c, i) => { const a = -Math.PI / 2 + i * step; s.save(); s.rotate(a); s.translate(0, -rr); s.fillText(c, 0, 0); s.restore(); });
  const big = r * (l2 ? 0.28 : 0.3);
  s.font = `400 ${big}px ${F.display}`;
  if (l2) { s.fillText(l1, 0, -big * 0.42); s.font = `400 ${big * (l2.length > 4 ? 1 : 1.15)}px ${F.display}`; s.fillText(l2, 0, big * 0.68); } else s.fillText(l1, 0, 0);
  // Worn ink: specks taken out of the print.
  const rand = rng(seed); s.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 520; i++) { const a = rand() * Math.PI * 2, d = rand() * r; s.globalAlpha = 0.25 + rand() * 0.6; s.beginPath(); s.arc(Math.cos(a) * d, Math.sin(a) * d, 0.3 + rand() * 0.9, 0, Math.PI * 2); s.fill(); }
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha = 0.9; ctx.globalCompositeOperation = blend;
  ctx.drawImage(off, -size / 2, -size / 2, size, size); ctx.restore();
}

// A masked card number: groups of four raised dots, then the last four digits, embossed.
// fills: [shadow, highlight, face]. Returns where it ended.
function maskedNumber(ctx, x, y, { groups, last4, size, fills, gap = 2.2 }) {
  const r = size * 0.13, step = size * 0.42, groupGap = size * 0.55;
  ctx.font = `400 ${size}px ${F.card}`;
  const draw = (dx, dy, fill) => {
    let cx = x + dx;
    for (let gi = 0; gi < groups; gi++) { for (let k = 0; k < 4; k++) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx + r, y + dy - size * 0.32, r, 0, Math.PI * 2); ctx.fill(); cx += step; } cx += groupGap; }
    if (last4) { ctx.fillStyle = fill; return cx + spaced(ctx, last4, cx, y + dy, gap); }
    return cx;
  };
  draw(0, 1, fills[0]); draw(0, -0.6, fills[1]); return draw(0, 0, fills[2]);
}
const mrz = (s, n) => (s.toUpperCase().replace(/[^A-Z0-9<]/g, '<') + '<'.repeat(n)).slice(0, n);

// Draws the visa with its top-left at (0, 0) in grid units (the caller scales). share: hide the phone.
export function drawVisa(ctx, t, { share = false } = {}) {
  const inv = t.invite || {}, title = (inv.title || t.eventName || 'Ladies Night').trim();
  const last4 = String(t.phoneLast4 || '').slice(-4) || '····';
  const n = Math.max(1, Number(t.admits || 1)), word = WORDS[n - 1] || String(n);
  const no = String(t.code || '').replace(/^MEM-/i, '') || 'PREVIEW';
  const day = t.date ? formatAccra(t.date, { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '';
  const dmy = t.date ? formatAccra(t.date, { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\D/g, '') : '000000';
  const shortDay = t.date ? formatAccra(t.date, { day: 'numeric', month: 'short' }).toUpperCase() : 'TONIGHT';
  const dress = /^strict( dress code)?$/i.test(inv.dress || '') ? 'STRICT' : String(inv.dress || '').toUpperCase();
  const W = VISA_W, H = VISA_H, seed = [...no].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 14); ctx.clip();
  // Paper.
  let g = ctx.createRadialGradient(W, 0, 10, W, 0, W * 1.25);
  g.addColorStop(0, '#ffe9e3'); g.addColorStop(0.4, '#fbe1da'); g.addColorStop(1, '#f4cfc6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Security print.
  ctx.strokeStyle = '#d2273f'; ctx.lineWidth = 0.45;
  for (let k = 0; k < 14; k++) {
    ctx.globalAlpha = (0.35 + (k % 3) * 0.15) * 0.55; ctx.beginPath();
    for (let x = 84; x <= W; x += 2) { const y = 118 + Math.sin((x / 22) + k * 0.45) * (40 + k * 2.2) * Math.cos((x / 90) - k * 0.2); if (x === 84) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.2; for (let r = 6; r < 70; r += 5) { ctx.beginPath(); ctx.arc(300, 58, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // Side band.
  g = ctx.createLinearGradient(0, 0, 84, H); g.addColorStop(0, '#e2213f'); g.addColorStop(0.7, '#a30a27'); g.addColorStop(1, '#74041a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 84, H);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 84, H); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  for (let i = -H; i < 84 + H; i += 5) { ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H * 0.47, 0); ctx.stroke(); }
  ctx.restore();
  // Micro-print strip.
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(84, 0, W - 84, 20);
  ctx.fillStyle = 'rgba(179,20,47,.25)'; ctx.fillRect(84, 20, W - 84, 0.6);
  ctx.fillStyle = '#b3142f'; ctx.font = `700 6.5px ${F.mono}`; ctx.textBaseline = 'middle';
  spaced(ctx, 'MEMORIES · HER NIGHT · HER RULES · MEMORIES · HER NIGHT · HER RULES · MEMORIES', 96, 10.5, 0.8);
  // Hologram seal with the infinity sign.
  ctx.save(); ctx.beginPath(); ctx.arc(42, 56, 28, 0, Math.PI * 2); ctx.clip();
  if (ctx.createConicGradient) { g = ctx.createConicGradient(0.5, 42, 56); ['#ffd1dc', '#ffe8a3', '#b8f3e6', '#c9c4ff', '#ffd1dc', '#ffe8a3', '#ffd1dc'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c)); }
  else { g = ctx.createRadialGradient(36, 48, 2, 42, 56, 30); g.addColorStop(0, '#fff3d6'); g.addColorStop(0.5, '#c9f0ea'); g.addColorStop(1, '#e8c9ff'); }
  ctx.fillStyle = g; ctx.fillRect(14, 28, 56, 56);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(42, 56, 27, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.translate(42, 56); ctx.scale(1.3, 1.3); ctx.translate(-32, -32);
  ctx.strokeStyle = '#c4112f'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.stroke(new Path2D(INFINITY)); ctx.restore();
  // Side words: brand name below the infinity seal, then rotated labels.
  ctx.fillStyle = '#ffe9e3'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 7px ${F.sans}`; spaced(ctx, 'MEMORIES', 42, 90, 1.2, 'center');
  ctx.globalAlpha = 0.7; ctx.font = `600 5px ${F.sans}`; spaced(ctx, 'NIGHT CLUB', 42, 99, 1.8, 'center'); ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(46, 150); ctx.rotate(-Math.PI / 2); ctx.font = `400 13px ${F.display}`; spaced(ctx, 'VISA', 0, 0, 6.5, 'center'); ctx.restore();
  ctx.globalAlpha = 0.8; ctx.font = `600 6.5px ${F.sans}`; spaced(ctx, 'CLASS', 42, 200, 1.4, 'center'); ctx.globalAlpha = 1;
  ctx.font = `400 16px ${F.display}`; spaced(ctx, share ? 'VIP' : 'VIP', 42, 218, 2.2, 'center');
  // The heading.
  ctx.fillStyle = '#b3142f'; ctx.font = `700 7.5px ${F.sans}`;
  spaced(ctx, 'ENTRY VISA', 96, 36, 2); spaced(ctx, `Nº ${share ? 'VIP' : no}`, W - 12, 36, 2, 'right');
  const tsz = fitFont(ctx, title, `italic 500 {s} ${F.serif}`, 38, W - 108, 18);
  ctx.font = `italic 500 ${tsz}px ${F.serif}`;
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(title, 96, 41 + tsz * 0.82 + 0.8);
  ctx.fillStyle = '#b0102c'; ctx.fillText(title, 96, 41 + tsz * 0.82);
  let y = 41 + tsz * 0.82 + 19;
  if (inv.tagline) { ctx.fillStyle = '#6b0a1f'; fitFont(ctx, inv.tagline, `italic 500 {s} ${F.serif}`, 13, W - 210, 8); ctx.fillText(inv.tagline, 96, y); y += 9; }
  if (t.fullName && !share) {
    const name = String(t.fullName).toUpperCase();
    ctx.fillStyle = '#b3142f'; ctx.globalAlpha = 0.7; ctx.font = `600 5.5px ${F.sans}`;
    spaced(ctx, 'HOLDER NAME', 97, y, 1.2); ctx.globalAlpha = 1; y += 9;
    const nsz = fitFont(ctx, name, `700 {s} ${F.card}`, 16, W - 110, 9);
    ctx.font = `700 ${nsz}px ${F.card}`;
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(name, 97, y + nsz + 1.4);
    ctx.fillStyle = '#1a0408'; ctx.fillText(name, 97, y + nsz);
    y += nsz + 7;
  }
  // The fields: two columns, the privileges across both.
  const field = (label, value, x, fy, maxW) => {
    ctx.fillStyle = '#b3142f'; ctx.globalAlpha = 0.85; ctx.font = `600 6px ${F.sans}`; spaced(ctx, label, x, fy, 1.2); ctx.globalAlpha = 1;
    fitFont(ctx, value, `400 {s} ${F.card}`, 11.5, maxW, 6);
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(value, x, fy + 12.6); ctx.fillStyle = '#2b040c'; ctx.fillText(value, x, fy + 12);
  };
  const fy = Math.max(y + 4, 104);
  field('VALID ON', day, 96, fy, 80); field('ENTRIES', String(n).padStart(2, '0'), 180, fy, 60);
  if (share) {
    field('HOLDER', t.fullName ? String(t.fullName).toUpperCase() : 'ON THE LIST', 96, fy + 24, 80);
  } else {
    field('HOLDER', '', 96, fy + 24, 80);
    maskedNumber(ctx, 96, fy + 36, { groups: 1, last4, size: 11.5, fills: ['rgba(255,255,255,.75)', 'rgba(255,255,255,0)', '#2b040c'], gap: 0.4 });
  } if (dress) field('DRESS CODE', dress, 180, fy + 24, 70);
  if (inv.perk) field('PRIVILEGES', String(inv.perk).toUpperCase(), 96, fy + 48, 150);
  field('VENUE', venueText(t), 96, fy + (inv.perk ? 72 : 48), 150);
  // The code line.
  ctx.fillStyle = '#3a0612'; ctx.globalAlpha = 0.85; ctx.font = `400 9.4px ${F.mono}`;
  ctx.font = `400 9.4px ${F.card}`; spaced(ctx, mrz(`V<MEMORIES<<${title}`, 30), 96, H - 18, 1.05);
  spaced(ctx, mrz(share ? `VIP<<<<<<<<<<${dmy}<${String(n).padStart(2, '0')}` : `${no}<<${last4}<VIP<<${dmy}<${String(n).padStart(2, '0')}`, 30), 96, H - 6.5, 1.05);
  ctx.globalAlpha = 1;
  // Stamps.
  stamp(ctx, { cx: W - 58, cy: 144, r: 46, rot: -0.21, colour: '#c4112f', ring: `MEMORIES ✦ ADMITTED ✦ ${shortDay} ✦ MEMORIES ✦ `, l1: 'ADMIT', l2: word, seed });
  if (t.status === 'used') stamp(ctx, { cx: W - 92, cy: 166, r: 44, rot: 0.16, colour: '#1f5fa8', ring: `ENTERED ✦ ${shortDay} ✦ WELCOME ✦ `, l1: 'ENTERED', l2: '', seed: seed + 1 });
  if (t.status === 'cancelled') stamp(ctx, { cx: W - 92, cy: 166, r: 44, rot: 0.16, colour: '#3a3a3a', ring: 'VOID ✦ VOID ✦ VOID ✦ VOID ✦ ', l1: 'VOID', l2: '', seed: seed + 1 });
  ctx.restore();
  // Edge.
  ctx.save(); roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 14); ctx.strokeStyle = 'rgba(150,20,40,.3)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}

// ── The gentlemen's pass: a black Memories card, a pass to witness the night (no perks) ──
// Matte black with a woven carbon texture, a red edge, the infinity mark and the night's name in
// brushed silver, the phone's last four embossed like a card number.
const silver = (ctx, x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); [['#8b8e94', 0], ['#f1f2f4', 0.35], ['#a5a8ae', 0.55], ['#e4e6e9', 0.8], ['#7d8086', 1]].forEach(([c, o]) => g.addColorStop(o, c)); return g; };
export function drawPass(ctx, t, { share = false } = {}) {
  const inv = t.invite || {}, title = String(inv.title || t.eventName || 'Ladies Night').toUpperCase();
  const last4 = String(t.phoneLast4 || '').slice(-4) || '····';
  const n = Math.max(1, Number(t.admits || 1));
  const no = String(t.code || '').replace(/^MEM-/i, '') || 'PREVIEW';
  const valid = t.date ? formatAccra(t.date, { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/[^\d]+/g, '/') : '';
  const shortDay = t.date ? formatAccra(t.date, { day: 'numeric', month: 'short' }).toUpperCase() : 'TONIGHT';
  const dress = /^strict( dress code)?$/i.test(inv.dress || '') ? 'STRICT' : String(inv.dress || '').toUpperCase();
  const W = VISA_W, H = VISA_H, seed = [...no].reduce((a, c) => a * 31 + c.charCodeAt(0), 11);
  ctx.save(); roundRect(ctx, 0, 0, W, H, 14); ctx.clip();
  // Matte black with a soft light from the top left.
  let g = ctx.createRadialGradient(40, 0, 10, 120, 60, W * 1.1);
  g.addColorStop(0, '#2c2c31'); g.addColorStop(0.45, '#141417'); g.addColorStop(1, '#070708');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Woven carbon texture.
  ctx.lineWidth = 0.6;
  for (let i = -H; i < W + H; i += 3.2) {
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.moveTo(i, H); ctx.lineTo(i + H, 0); ctx.stroke();
  }
  // A big infinity watermark.
  ctx.save(); ctx.translate(268, 128); ctx.scale(5.2, 5.2); ctx.translate(-32, -32);
  ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 3; ctx.stroke(new Path2D(INFINITY)); ctx.restore();
  // The red edge.
  g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#e2213f'); g.addColorStop(1, '#7a0519');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 6, H);
  // Brand: the infinity mark and MEMORIES in brushed silver.
  ctx.save(); ctx.translate(34, 30); ctx.scale(0.62, 0.62); ctx.translate(-32, -32);
  ctx.strokeStyle = silver(ctx, 18, 24, 46, 40); ctx.lineWidth = 3.6; ctx.lineCap = 'round'; ctx.stroke(new Path2D(INFINITY)); ctx.restore();
  ctx.textBaseline = 'alphabetic'; ctx.fillStyle = silver(ctx, 52, 20, 140, 34);
  ctx.font = `400 15px ${F.display}`; spaced(ctx, 'MEMORIES', 52, 35, 4.2);
  ctx.fillStyle = '#8f9298'; ctx.font = `600 5.5px ${F.sans}`; spaced(ctx, 'NIGHT CLUB', 53, 44, 3.4);
  ctx.fillStyle = '#e2213f'; ctx.font = `700 6.5px ${F.sans}`; spaced(ctx, 'GENTLEMAN’S PASS', W - 18, 30, 2.2, 'right');
  ctx.fillStyle = '#8f9298'; ctx.font = `400 8px ${F.card}`; spaced(ctx, `Nº ${share ? 'VIP' : no}`, W - 18, 41, 1.4, 'right');
  // The chip (silver).
  ctx.save(); ctx.translate(20, 66);
  roundRect(ctx, 0, 0, 40, 30, 5.5); ctx.fillStyle = silver(ctx, 0, 0, 40, 30); ctx.fill();
  ctx.strokeStyle = 'rgba(40,40,44,.7)'; ctx.lineWidth = 0.8; ctx.beginPath();
  [[0, 11, 12, 11], [0, 20, 12, 20], [28, 11, 40, 11], [28, 20, 40, 20], [12, 0, 12, 30], [28, 0, 28, 30], [12, 15, 28, 15]].forEach(([a, b, c, d]) => { ctx.moveTo(a, b); ctx.lineTo(c, d); });
  ctx.stroke(); roundRect(ctx, 0, 0, 40, 30, 5.5); ctx.stroke(); ctx.restore();
  // The night: "TO WITNESS" over its name in silver.
  ctx.fillStyle = '#e2213f'; ctx.font = `700 7px ${F.sans}`; spaced(ctx, 'A PASS TO WITNESS', 20, 120, 2.6);
  const tsz = fitFont(ctx, title, `400 {s} ${F.display}`, 40, W - 40, 18);
  ctx.font = `400 ${tsz}px ${F.display}`; ctx.fillStyle = 'rgba(0,0,0,.6)'; spaced(ctx, title, 20, 120 + tsz + 1.2, 1.6);
  ctx.fillStyle = silver(ctx, 20, 120, 20 + W * 0.7, 120 + tsz); spaced(ctx, title, 20, 120 + tsz, 1.6);
  // Holder name (if known) above the embossed number.
  if (t.fullName && !share) {
    const name = String(t.fullName).toUpperCase();
    ctx.fillStyle = '#8f9298'; ctx.font = `600 5.5px ${F.sans}`; spaced(ctx, 'HOLDER', 20, 157, 1.8);
    const nsz = fitFont(ctx, name, `700 {s} ${F.card}`, 18, W - 44, 10);
    ctx.font = `700 ${nsz}px ${F.card}`;
    ctx.fillStyle = 'rgba(0,0,0,.95)'; ctx.fillText(name, 20, 157 + nsz + 2.5);
    ctx.fillStyle = silver(ctx, 20, 157, 20 + W * 0.75, 157 + nsz + 3);
    ctx.fillText(name, 20, 157 + nsz + 2);
  }
  // Embossed number (the phone's last four).
  maskedNumber(ctx, 20, 188, { groups: share ? 4 : 3, last4: share ? '' : last4, size: 19, fills: ['rgba(0,0,0,.85)', 'rgba(255,255,255,.35)', silver(ctx, 20, 172, 280, 192)], gap: 2.6 });
  // Bottom row.
  const cell = (label, value, x, align = 'left') => {
    ctx.fillStyle = '#8f9298'; ctx.font = `600 5.5px ${F.sans}`; spaced(ctx, label, x, 208, 1.8, align);
    ctx.font = `400 10.5px ${F.card}`; ctx.fillStyle = 'rgba(0,0,0,.8)'; spaced(ctx, value, x, 220.8, 0.8, align);
    ctx.fillStyle = '#e9eaec'; spaced(ctx, value, x, 220, 0.8, align);
  };
  cell('VALID', valid, 20); cell('ADMITS', String(n).padStart(2, '0'), 104); if (dress) cell('DRESS CODE', dress, 166);
  cell('VENUE', venueText(t).split(',')[0], W - 18, 'right');
  if (t.status === 'used') stamp(ctx, { cx: W - 72, cy: 92, r: 42, rot: -0.2, colour: '#e2213f', ring: `ENTERED ✦ ${shortDay} ✦ WELCOME ✦ `, l1: 'ENTERED', l2: '', seed, blend: 'source-over' });
  if (t.status === 'cancelled') stamp(ctx, { cx: W - 72, cy: 92, r: 42, rot: -0.2, colour: '#9a9ca1', ring: 'VOID ✦ VOID ✦ VOID ✦ VOID ✦ ', l1: 'VOID', l2: '', seed, blend: 'source-over' });
  ctx.restore();
  ctx.save(); roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 14); ctx.strokeStyle = 'rgba(220,222,226,.22)'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}
const isHim = t => t?.invite?.style === 'him';

// The visa as an image (PNG blob), sharp on any screen (3× the grid).
export async function visaCanvas(t, { scale = 3, share = false } = {}) {
  await loadVisaFonts();
  const c = document.createElement('canvas'); c.width = VISA_W * scale; c.height = VISA_H * scale;
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); (isHim(t) ? drawPass : drawVisa)(ctx, t, { share });
  return c;
}
export const canvasBlob = c => new Promise(res => c.toBlob(res, 'image/png'));

// The post for social media (1080 × 1350): the visa on Memories red, "I'm on the list".
export async function visaPost(t) {
  await loadVisaFonts();
  if (isHim(t)) return passPost(t);
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  let g = ctx.createRadialGradient(W * 0.2, H * 0.05, 40, W * 0.5, H * 0.5, H * 0.95);
  g.addColorStop(0, '#f2394f'); g.addColorStop(0.4, '#b80e2a'); g.addColorStop(0.8, '#5e0418'); g.addColorStop(1, '#2a0009');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Faint security lines across the background.
  ctx.strokeStyle = 'rgba(255,220,225,.07)'; ctx.lineWidth = 1.4;
  for (let k = 0; k < 18; k++) { ctx.beginPath(); for (let x = 0; x <= W; x += 6) { const y = 640 + Math.sin(x / 70 + k * 0.4) * (180 + k * 9) * Math.cos(x / 260 - k * 0.15); if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }
  // Brand: the infinity sign and MEMORIES.
  ctx.save(); ctx.translate(W / 2, 128); ctx.scale(2.4, 2.4); ctx.translate(-32, -32);
  ctx.strokeStyle = '#fff1e6'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.stroke(new Path2D(INFINITY)); ctx.restore();
  ctx.fillStyle = '#fff1e6'; ctx.font = `400 34px ${F.display}`; ctx.textBaseline = 'alphabetic'; spaced(ctx, 'MEMORIES NIGHT CLUB', W / 2, 220, 12, 'center');
  // The visa, tilted, with a shadow.
  const vw = 930, s = vw / VISA_W;
  ctx.save(); ctx.translate(W / 2, 600); ctx.rotate(-0.05); ctx.translate(-vw / 2, -(VISA_H * s) / 2);
  ctx.shadowColor = 'rgba(30,0,8,.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 30;
  ctx.fillStyle = '#f4cfc6'; roundRect(ctx, 0, 0, vw, VISA_H * s, 14 * s); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.scale(s, s); drawVisa(ctx, t, { share: true }); ctx.restore();
  // "I'm on the list".
  ctx.fillStyle = '#fff1e6'; ctx.textAlign = 'center';
  ctx.font = `400 128px ${F.script}`; ctx.fillText('I’m on the list', W / 2, 1050);
  const inv = t.invite || {}, when = t.date ? formatAccra(t.date, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase() : '';
  ctx.fillStyle = '#ecc878'; ctx.font = `700 26px ${F.sans}`;
  spaced(ctx, [String(inv.title || t.eventName || 'Ladies Night').toUpperCase(), when].filter(Boolean).join('  ·  '), W / 2, 1140, 5, 'center');
  if (inv.tagline) { ctx.font = `italic 500 40px ${F.serif}`; ctx.fillStyle = '#ffe3dc'; ctx.fillText(inv.tagline, W / 2, 1210); }
  ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff1e6'; ctx.font = `600 20px ${F.sans}`; spaced(ctx, `${venueText(t)}  ·  BY INVITATION ONLY`, W / 2, 1290, 5, 'center');
  return c;
}

// The gentlemen's post: black, a red glow, the card tilted, "On the list" in silver.
async function passPost(t) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#08080a'; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W / 2, H * 0.95, 20, W / 2, H * 0.95, H * 0.75);
  g.addColorStop(0, 'rgba(196,17,44,.55)'); g.addColorStop(1, 'rgba(196,17,44,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 9) { ctx.strokeStyle = 'rgba(255,255,255,.025)'; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); }
  ctx.save(); ctx.translate(W / 2, 128); ctx.scale(2.4, 2.4); ctx.translate(-32, -32);
  ctx.strokeStyle = silver(ctx, 18, 24, 46, 40); ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.stroke(new Path2D(INFINITY)); ctx.restore();
  ctx.fillStyle = '#e9eaec'; ctx.font = `400 34px ${F.display}`; ctx.textBaseline = 'alphabetic'; spaced(ctx, 'MEMORIES NIGHT CLUB', W / 2, 220, 12, 'center');
  const vw = 930, s = vw / VISA_W;
  ctx.save(); ctx.translate(W / 2, 600); ctx.rotate(-0.05); ctx.translate(-vw / 2, -(VISA_H * s) / 2);
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 34;
  ctx.fillStyle = '#111'; roundRect(ctx, 0, 0, vw, VISA_H * s, 14 * s); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.scale(s, s); drawPass(ctx, t, { share: true }); ctx.restore();
  ctx.textAlign = 'left';
  ctx.font = `400 120px ${F.display}`; ctx.fillStyle = silver(ctx, 200, 960, 880, 1080); spaced(ctx, 'ON THE LIST', W / 2, 1075, 10, 'center');
  const inv = t.invite || {}, when = t.date ? formatAccra(t.date, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase() : '';
  ctx.fillStyle = '#e2213f'; ctx.font = `700 26px ${F.sans}`;
  spaced(ctx, ['TO WITNESS ' + String(inv.title || t.eventName || 'Ladies Night').toUpperCase(), when].filter(Boolean).join('  ·  '), W / 2, 1150, 5, 'center');
  ctx.globalAlpha = 0.65; ctx.fillStyle = '#e9eaec'; ctx.font = `600 20px ${F.sans}`; spaced(ctx, 'BY INVITATION ONLY', W / 2, 1290, 6, 'center');
  return c;
}
