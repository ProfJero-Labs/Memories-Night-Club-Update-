// The ticket: the guest's chosen line is the big type; first name, night, date and Memories sit
// underneath; QR + short code on the stub. Each night has its own design (style + flyer colours).
// Used for the live preview at checkout, the real ticket, and the control room's design preview.
import { esc, shortDate, doors, formatAccra, money } from './app.js';
import { ticketDesign } from './lib/shared.js';

let qrReady;
const loadQr = () => (qrReady ||= new Promise((res, rej) => {
  if (window.qrcode) return res(window.qrcode);
  const s = document.createElement('script'); s.src = 'vendor/qrcode.min.js'; s.onload = () => res(window.qrcode); s.onerror = rej; document.head.append(s);
}));
export async function qrSvg(text) {
  const qrcode = await loadQr();
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
export const verifyUrl = token => `${location.origin}/verify.html?token=${encodeURIComponent(token)}`;

// Each night has its own design: a style (classic / poster / neon / split / stamp) and colours
// taken from its flyer (see ticketDesign in lib/shared.js). The stub with the QR is always light
// with a white QR box, whatever the design, so it scans in a dark room.
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export function designFor(t) {
  const d = ticketDesign({ id: t.eventId || t.eventName, ticketStyle: t.ticketStyle, ticketColors: t.ticketColors, autoStyle: t.autoStyle });
  // Text on the accent colour: whichever of dark/light reads better.
  const onAccent = (lum(d.colors.accent) + 0.05) / (lum(d.colors.dark) + 0.05) >= (lum(d.colors.light) + 0.05) / (lum(d.colors.accent) + 0.05) ? d.colors.dark : d.colors.light;
  return { ...d, onAccent };
}
const vars = d => `--t-accent:${d.colors.accent};--t-dark:${d.colors.dark};--t-light:${d.colors.light};--t-on-accent:${d.onAccent}`;

// t: { line, firstName, eventName, eventId, date, doors, venue, artwork, ticketStyle, ticketColors, code, status, inDraw, type, admits,
//      ticketNo, groupSize } (a group bought together: each person's own ticket, "2 OF 3")
export function ticketHTML(t, { preview = false, qr = '' } = {}) {
  const d = designFor(t);
  const big = t.line || t.eventName || 'MEMORIES';
  const long = big.length > 16;
  const day = t.date ? formatAccra(t.date, { day: '2-digit' }) : '';
  const status = preview ? '<span class="t-stamp preview">PREVIEW</span>'
    : t.status === 'used' ? '<span class="t-stamp used">CHECKED IN</span>'
      : t.status === 'cancelled' ? '<span class="t-stamp cancelled">CANCELLED</span>'
        : '<span class="t-stamp valid">VALID</span>';
  return `<article class="ticket s-${d.style}" data-style="${d.style}" style="${vars(d)}" aria-label="Ticket for ${esc(t.eventName)}">
    <div class="t-main">
      ${t.artwork ? `<div class="t-art"><img src="${esc(t.artwork)}" alt="" crossorigin="anonymous" decoding="async"></div>` : '<div class="t-art none"></div>'}
      <div class="t-vert" aria-hidden="true">${esc(t.eventName || 'Memories')}</div>
      ${day ? `<div class="t-day" aria-hidden="true">${esc(day)}</div>` : ''}
      <div class="t-body">
        <div class="t-top"><span class="brandmark">MEMORIES</span><span style="text-align:right">${esc(t.type || 'Ticket')}${t.groupSize > 1 ? ` · <b class="t-of">${t.ticketNo} OF ${t.groupSize}</b>` : ''}${t.admits > 1 ? `<br>ADMITS ${t.admits}` : '<br>ADMIT ONE'}</span></div>
        <p class="t-line ${long ? 'long' : ''} ${t.line ? '' : 'event'}" data-line>${esc(big)}</p>
        <div class="t-name" data-name>${esc(t.firstName || (preview ? 'Your name' : ''))}</div>
        <div class="t-meta">${t.line ? `<span>${esc(t.eventName)}</span>` : ''}<b>${t.date ? esc(shortDate(t.date)) : ''}</b><span>${t.date ? esc(doors(t)) : ''}</span><span>${esc(t.venue || '')}</span></div>
      </div>
    </div>
    <div class="t-rule" aria-hidden="true"></div>
    <div class="t-stub">
      ${qr ? `<div class="t-qr" aria-label="Entry QR code">${qr}</div>` : `<div class="t-qr blank">QR APPEARS<br>ONCE PAID</div>`}
      <div><div class="t-code">${esc(t.code || 'MEM-······')}</div>
        <div class="t-status">${status}${t.inDraw ? '<span class="t-stamp draw">IN THE DRAW</span>' : ''}</div>
        ${t.price ? `<div class="t-deal"><span class="t-stamp deal">${esc(t.price.promoName)}${t.price.promoLabel ? ` · ${esc(t.price.promoLabel)}` : ''}</span> Paid ${esc(money(t.price.paidPesewas))} <s>${esc(money(t.price.fullPesewas))}</s></div>` : ''}
        <div class="t-small">${t.groupSize > 1 ? `Ticket ${t.ticketNo} of ${t.groupSize} · ` : ''}Show at the door · strictly 18+</div>
        <div class="t-credit">Ticketing by EvolveIT</div></div>
    </div>
  </article>`;
}

// ── The invitation: the Ladies Night visa ──
// A red "entry visa": a hologram seal with the Memories infinity sign, security-print lines, the
// night's name in script, typewriter fields (valid on, entries, holder = the phone's last four, dress
// code, privileges), an ink stamp "ADMIT TWO", and a passport-style code line. No names, no QR: the
// door finds the guest by her phone number. Once she's in, an "ENTERED" stamp lands on it.
const INFINITY = 'M18 32c0-4.4 3-7.5 6.6-7.5 6.8 0 8 15 14.8 15 3.6 0 6.6-3.1 6.6-7.5s-3-7.5-6.6-7.5c-6.8 0-8 15-14.8 15-3.6 0-6.6-3.1-6.6-7.5Z';
const WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];
// Security print: interlaced waves and a rosette, drawn once per card (deterministic).
function guilloche() {
  let d = '';
  for (let k = 0; k < 14; k++) {
    let p = '';
    for (let x = 84; x <= 358; x += 3) {
      const y = 118 + Math.sin((x / 22) + k * 0.45) * (40 + k * 2.2) * Math.cos((x / 90) - k * 0.2);
      p += `${x === 84 ? 'M' : 'L'}${x} ${y.toFixed(1)}`;
    }
    d += `<path d="${p}" opacity="${(0.35 + (k % 3) * 0.15).toFixed(2)}"/>`;
  }
  for (let r = 6; r < 70; r += 5) d += `<circle cx="300" cy="58" r="${r}" opacity=".35"/>`;
  return `<svg class="vz-guil" viewBox="0 0 358 236" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="#d2273f" stroke-width=".45">${d}</svg>`;
}
let stampN = 0;
function stamp(cls, ring, l1, l2, colour) {
  const n = ++stampN;
  return `<svg class="vz-stamp ${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <defs><filter id="vzInk${n}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${3 + n}"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.4 1.5"/><feComposite in="SourceGraphic" operator="in"/></filter>
      <path id="vzRing${n}" d="M50 50 m-36 0 a36 36 0 1 1 72 0 a36 36 0 1 1 -72 0"/></defs>
    <g filter="url(#vzInk${n})" fill="none" stroke="${colour}">
      <circle cx="50" cy="50" r="46" stroke-width="3"/><circle cx="50" cy="50" r="41" stroke-width="1"/><circle cx="50" cy="50" r="27" stroke-width="1.2"/>
      <text fill="${colour}" stroke="none" font-family="Space Mono, monospace" font-weight="700" font-size="7.6" letter-spacing="1.4"><textPath href="#vzRing${n}" textLength="222">${esc(ring)}</textPath></text>
      <text x="50" y="${l2 ? 47 : 54}" text-anchor="middle" fill="${colour}" stroke="none" font-family="Anton, Impact, sans-serif" font-size="13" letter-spacing="1">${esc(l1)}</text>
      ${l2 ? `<text x="50" y="62" text-anchor="middle" fill="${colour}" stroke="none" font-family="Anton, Impact, sans-serif" font-size="${l2.length > 4 ? 12 : 15}" letter-spacing="1">${esc(l2)}</text>` : ''}
    </g></svg>`;
}
const mrz = (s, n) => (s.toUpperCase().replace(/[^A-Z0-9<]/g, '<') + '<'.repeat(n)).slice(0, n);
// t: { invite: { title, tagline, perk, dress }, phoneLast4, code, eventName, date, admits, status }
export function inviteHTML(t) {
  const inv = t.invite || {}, title = (inv.title || t.eventName || 'Ladies Night').trim();
  const last4 = String(t.phoneLast4 || '').slice(-4) || '····';
  const n = Math.max(1, Number(t.admits || 1)), word = WORDS[n - 1] || String(n);
  const no = String(t.code || '').replace(/^MEM-/i, '') || 'PREVIEW';
  const day = t.date ? formatAccra(t.date, { day: '2-digit', month: 'short', year: '2-digit' }).toUpperCase() : '';
  const dmy = t.date ? formatAccra(t.date, { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\D/g, '') : '000000';
  const shortDay = t.date ? formatAccra(t.date, { day: 'numeric', month: 'short' }).toUpperCase() : 'TONIGHT';
  const dress = /^strict( dress code)?$/i.test(inv.dress || '') ? 'Strict' : (inv.dress || '');
  const entered = t.status === 'used' ? stamp('entered', `ENTERED ✦ ${shortDay} ✦ WELCOME ✦ `, 'ENTERED', '', '#1f5fa8')
    : t.status === 'cancelled' ? stamp('entered', 'VOID ✦ VOID ✦ VOID ✦ VOID ✦ ', 'VOID', '', '#3a3a3a') : '';
  return `<div class="vz-wrap"><article class="vz" aria-label="${esc(title)} entry visa: admits ${n}, phone ending ${esc(last4)}">
    ${guilloche()}
    <div class="vz-band"></div>
    <div class="vz-micro" aria-hidden="true">${'MEMORIES · HER NIGHT · HER RULES · '.repeat(4)}</div>
    <div class="vz-holo" aria-hidden="true"><svg viewBox="14 20 36 24"><path d="${INFINITY}" fill="none" stroke="#c4112f" stroke-width="3" stroke-linecap="round"/></svg></div>
    <div class="vz-side"><span class="vz-vert">VISA</span><small>Class</small><b>VIP</b></div>
    <div class="vz-main">
      <div class="vz-kick"><span>Entry visa</span><span>Nº ${esc(no)}</span></div>
      <h2 class="vz-title">${esc(title)}</h2>
      ${inv.tagline ? `<p class="vz-tag">${esc(inv.tagline)}</p>` : ''}
      <div class="vz-grid">
        <div><small>Valid on</small><b>${esc(day)}</b></div>
        <div><small>Entries</small><b>${String(n).padStart(2, '0')}</b></div>
        <div><small>Holder</small><b>••• ${esc(last4)}</b></div>
        ${dress ? `<div><small>Dress code</small><b>${esc(dress)}</b></div>` : ''}
        ${inv.perk ? `<div class="w"><small>Privileges</small><b>${esc(inv.perk)}</b></div>` : ''}
      </div>
    </div>
    ${stamp('admit', `MEMORIES ✦ ADMITTED ✦ ${shortDay} ✦ MEMORIES ✦ `, 'ADMIT', word, '#c4112f')}
    ${entered}
    <div class="vz-mrz" aria-hidden="true">${esc(mrz(`V<MEMORIES<<${title}`, 30))}<br>${esc(mrz(`${no}<<${last4}<VIP<<${dmy}<${String(n).padStart(2, '0')}`, 30))}</div>
  </article></div>`;
}

// ── Square share image (1080×1080), drawn in the browser ──
// Deliberately carries no QR and no code: it's for posting, and a posted QR is a stolen ticket.
function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/); const out = []; let cur = '';
  for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width <= maxW || !cur) cur = test; else { out.push(cur); cur = w; } }
  if (cur) out.push(cur); return out;
}
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

const mixHex = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * t + parseInt(b.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');

export async function shareImage(t, { withArt = true } = {}) {
  await Promise.all(['400 100px Anton', 'italic 400 60px "Instrument Serif"', '700 30px Archivo'].map(f => document.fonts?.load(f).catch(() => {})));
  const S = 1080, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const d = designFor(t), C = d.colors;
  const [art, logo] = await Promise.all([withArt ? loadImg(t.artwork) : null, loadImg('assets/logo.webp')]);
  const cover = (img, x0, y0, w, h, alpha = 1, filter = 'none') => {
    x.save(); x.beginPath(); x.rect(x0, y0, w, h); x.clip(); x.globalAlpha = alpha; x.filter = filter;
    const r = Math.max(w / img.width, h / img.height); x.drawImage(img, x0 + (w - img.width * r) / 2, y0 + (h - img.height * r) / 2, img.width * r, img.height * r); x.restore();
  };
  // Each design paints its own background and picks its text colours.
  let ink = C.dark, lineColor = mixHex(C.accent, C.dark, 0.72), accent = C.accent, textX = 94, textW = S - 250, glow = false, textLogo = false;
  if (d.style === 'poster') {
    x.fillStyle = C.dark; x.fillRect(0, 0, S, S);
    if (art) cover(art, 0, 0, S, S);
    else { const g = x.createRadialGradient(200, 0, 50, 200, 0, 1100); g.addColorStop(0, C.accent); g.addColorStop(0.7, C.dark); x.fillStyle = g; x.fillRect(0, 0, S, S); }
    // Keep the flyer as texture, but the line must win: a strong fade from the bottom and a lighter one from the top.
    const g = x.createLinearGradient(0, S, 0, 0); g.addColorStop(0.15, C.dark); g.addColorStop(0.5, C.dark + 'd9'); g.addColorStop(0.8, C.dark + '99'); g.addColorStop(1, C.dark + '66'); x.fillStyle = g; x.fillRect(0, 0, S, S);
    ink = C.light; lineColor = C.light;
  } else if (d.style === 'neon') {
    x.fillStyle = C.dark; x.fillRect(0, 0, S, S);
    const g = x.createRadialGradient(S * 0.85, 0, 20, S * 0.85, 0, 800); g.addColorStop(0, C.accent + '66'); g.addColorStop(1, C.accent + '00'); x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = C.accent + '1f'; x.lineWidth = 2; for (let p = 0; p < S; p += 54) { x.beginPath(); x.moveTo(p, 0); x.lineTo(p, S); x.moveTo(0, p); x.lineTo(S, p); x.stroke(); }
    ink = C.light; lineColor = C.accent; glow = true;
  } else if (d.style === 'split') {
    x.fillStyle = C.dark; x.fillRect(0, 0, S, S);
    if (art) cover(art, 0, 0, 360, S); else { x.fillStyle = C.accent; x.fillRect(0, 0, 360, S); }
    const sg = x.createLinearGradient(180, 0, 360, 0); sg.addColorStop(0, C.dark + '00'); sg.addColorStop(0.45, C.dark + 'cc'); sg.addColorStop(1, C.dark); x.fillStyle = sg; x.fillRect(180, 0, 180, S);
    x.save(); x.translate(300, S - 90); x.rotate(-Math.PI / 2); x.fillStyle = C.light; x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 16;
    const vn = (t.eventName || 'MEMORIES').toUpperCase(); let vs = 64;
    do { x.font = `400 ${vs}px Anton, Impact, sans-serif`; vs -= 2; } while (x.measureText(vn).width > S - 190 && vs > 28);
    x.textBaseline = 'alphabetic'; x.fillText(vn, 0, 0); x.restore();
    ink = C.light; lineColor = C.accent; textX = 410; textW = S - 410 - 90;
  } else if (d.style === 'stamp') {
    x.fillStyle = C.accent; x.fillRect(0, 0, S, S);
    x.fillStyle = C.dark + '38'; for (let yy = 7; yy < S; yy += 16) for (let xx = (yy / 16) % 2 ? 15 : 7; xx < S; xx += 16) { x.beginPath(); x.arc(xx, yy, 2.2, 0, Math.PI * 2); x.fill(); }
    ink = d.onAccent; lineColor = d.onAccent; accent = d.onAccent; textLogo = true;
    const day = t.date ? formatAccra(t.date, { day: '2-digit' }) : '';
    if (day) { x.save(); x.globalAlpha = 0.2; x.fillStyle = d.onAccent; x.font = '400 560px Anton, Impact, sans-serif'; x.textAlign = 'right'; x.textBaseline = 'top'; x.fillText(day, S - 40, 120); x.restore(); }
  } else if (d.style === 'marquee') {
    const g = x.createRadialGradient(S / 2, S * 0.45, 40, S / 2, S * 0.45, 760); g.addColorStop(0, mixHex(C.accent, C.dark, 0.25)); g.addColorStop(1, C.dark);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.save(); x.fillStyle = C.accent; x.shadowColor = C.accent; x.shadowBlur = 16;
    for (let p = 78; p <= S - 78; p += 40) for (const [bx, by] of [[p, 72], [p, S - 72], [72, p], [S - 72, p]]) { x.beginPath(); x.arc(bx, by, 8, 0, Math.PI * 2); x.fill(); }
    x.restore();
    ink = C.light; lineColor = C.light; textX = 110; textW = S - 260; glow = 'fill';
  } else if (d.style === 'vinyl') {
    x.fillStyle = C.dark; x.fillRect(0, 0, S, S);
    const cx = S * 0.86, cy = S * 0.46;
    x.fillStyle = '#111'; x.beginPath(); x.arc(cx, cy, 620, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 2; for (let r = 150; r < 620; r += 9) { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = C.accent; x.beginPath(); x.arc(cx, cy, 140, 0, Math.PI * 2); x.fill();
    x.fillStyle = C.dark; x.beginPath(); x.arc(cx, cy, 14, 0, Math.PI * 2); x.fill();
    const sh = x.createLinearGradient(0, 0, S, S); sh.addColorStop(0.35, 'rgba(255,255,255,0)'); sh.addColorStop(0.45, 'rgba(255,255,255,.06)'); sh.addColorStop(0.55, 'rgba(255,255,255,0)'); x.fillStyle = sh; x.fillRect(0, 0, S, S);
    const fade = x.createLinearGradient(0, 0, S, 0); fade.addColorStop(0.1, C.dark); fade.addColorStop(0.6, C.dark + '00'); x.fillStyle = fade; x.fillRect(0, 0, S, S);
    ink = C.light; lineColor = C.light; accent = C.accent;
  } else if (d.style === 'sunburst') {
    x.fillStyle = mixHex(C.accent, C.light, 0.62); x.fillRect(0, 0, S, S);
    const ox = S / 2, oy = S * 1.08; x.fillStyle = C.accent;
    for (let a = -Math.PI; a < 0; a += Math.PI / 13) { x.beginPath(); x.moveTo(ox, oy); x.arc(ox, oy, 2000, a, a + Math.PI / 26); x.closePath(); x.fill(); }
    x.fillStyle = mixHex(C.light, C.accent, 0.55); x.beginPath(); x.arc(ox, oy, 380, 0, Math.PI * 2); x.fill();
    ink = C.dark; lineColor = C.dark; accent = C.dark;
  } else if (d.style === 'holo') {
    x.fillStyle = mixHex(C.light, '#c9f3ff', 0.6); x.fillRect(0, 0, S, S);
    for (const [cx, cy, r, col] of [[160, 100, 800, mixHex(C.accent, '#ff5fd2', 0.85)], [970, 430, 700, mixHex(C.accent, '#3fd8ff', 0.25)], [320, 1030, 760, mixHex(C.accent, '#a66bff', 0.2)]]) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, S, S);
    }
    const sh = x.createLinearGradient(0, 0, S, S * 0.6); sh.addColorStop(0.3, 'rgba(255,255,255,0)'); sh.addColorStop(0.42, 'rgba(255,255,255,.5)'); sh.addColorStop(0.54, 'rgba(255,255,255,0)'); x.fillStyle = sh; x.fillRect(0, 0, S, S);
    ink = C.dark; lineColor = C.dark; accent = C.dark;
  } else if (d.style === 'coast') {
    const sky = x.createLinearGradient(0, 0, 0, S * 0.72); sky.addColorStop(0, mixHex(C.accent, C.dark, 0.4)); sky.addColorStop(1, C.accent);
    x.fillStyle = sky; x.fillRect(0, 0, S, S);
    x.fillStyle = mixHex(C.light, C.accent, 0.7); x.beginPath(); x.arc(S / 2, S * 0.72, 150, Math.PI, 0); x.fill();
    const sea = x.createLinearGradient(0, S * 0.72, 0, S); sea.addColorStop(0, C.dark); sea.addColorStop(1, mixHex(C.dark, C.accent, 0.8));
    x.fillStyle = sea; x.fillRect(0, S * 0.72, S, S * 0.28);
    x.strokeStyle = C.light + '66'; x.lineWidth = 3;
    for (let wy = S * 0.76; wy < S; wy += 34) { x.beginPath(); for (let wx = 0; wx <= S; wx += 60) { x.moveTo(wx, wy); x.quadraticCurveTo(wx + 15, wy - 10, wx + 30, wy); } x.stroke(); }
    ink = C.light; lineColor = C.light; accent = C.light;
  } else {
    x.fillStyle = mixHex(C.light, '#e9ddc0', 0.88); x.fillRect(0, 0, S, S);
    if (art) cover(art, 0, 0, S, S, 0.08, 'grayscale(1) sepia(.5) contrast(1.1)');
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(36,29,20,${Math.random() * .08})`; x.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  }
  // frame + perforation edge
  x.strokeStyle = ink; x.globalAlpha = 0.85; x.lineWidth = 4; x.strokeRect(40, 40, S - 80, S - 80); x.globalAlpha = 1;
  x.fillStyle = '#0d0a09'; for (let y = 70; y < S - 60; y += 36) { x.beginPath(); x.arc(40, y, 7, 0, Math.PI * 2); x.arc(S - 40, y, 7, 0, Math.PI * 2); x.fill(); }
  // top row
  x.textBaseline = 'top';
  if (logo && !textLogo) { const h = 46, w = logo.width * (h / logo.height); x.drawImage(logo, textX - 6, 88, w, h); }
  else { x.fillStyle = ink; x.font = '400 44px Anton, Impact, sans-serif'; x.fillText('MEMORIES', textX - 6, 88); }
  x.fillStyle = ink; x.font = '700 24px Archivo, Arial, sans-serif'; x.textAlign = 'right';
  x.fillText('CAPE COAST', S - 88, 100); x.textAlign = 'left';
  // the line, as big as it can be
  const big = (t.line || t.eventName || 'MEMORIES').toUpperCase();
  let size = 250, rows;
  do { x.font = `400 ${size}px Anton, Impact, sans-serif`; rows = wrapLines(x, big, textW); size -= 6; } while ((rows.length * size * .92 > 560 || rows.some(r => x.measureText(r).width > textW)) && size > 60);
  size += 6; x.font = `400 ${size}px Anton, Impact, sans-serif`;
  const lh = size * .9, blockH = rows.length * lh, top = 190 + (560 - blockH) / 2;
  x.save(); x.translate(textX, top); if (!glow) x.rotate(d.style === 'stamp' || d.style === 'sunburst' ? -0.06 : -0.02);
  if (glow === 'fill') { x.fillStyle = lineColor; x.shadowColor = C.accent; x.shadowBlur = 30; rows.forEach((r, i) => x.fillText(r, 0, i * lh)); x.shadowBlur = 10; rows.forEach((r, i) => x.fillText(r, 0, i * lh)); }
  else if (glow) { x.strokeStyle = lineColor; x.lineWidth = Math.max(3, size / 45); x.shadowColor = lineColor; x.shadowBlur = 28; rows.forEach((r, i) => x.strokeText(r, 0, i * lh)); x.shadowBlur = 8; rows.forEach((r, i) => x.strokeText(r, 0, i * lh)); }
  else {
    x.fillStyle = t.line ? lineColor : ink;
    if (d.style === 'poster' || d.style === 'vinyl' || d.style === 'coast') { x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 24; }
    if (d.style === 'sunburst') { x.save(); x.fillStyle = mixHex(C.light, '#ffffff', 0.8); rows.forEach((r, i) => x.fillText(r, 6, i * lh + 6)); x.restore(); }
    rows.forEach((r, i) => x.fillText(r, 0, i * lh));
  }
  x.restore();
  // name
  x.fillStyle = ink; x.font = 'italic 400 88px "Instrument Serif", Georgia, serif';
  x.fillText(`— ${t.firstName || ''}`, textX, 790);
  // dashed rule + event strip
  x.strokeStyle = ink; x.setLineDash([14, 10]); x.lineWidth = 3; x.beginPath(); x.moveTo(textX - 6, 906); x.lineTo(S - 88, 906); x.stroke(); x.setLineDash([]);
  x.font = '700 26px Archivo, Arial, sans-serif'; x.fillStyle = ink;
  const meta = [t.line && d.style !== 'split' ? t.eventName : '', t.date ? shortDate(t.date) : ''].filter(Boolean).join('   ·   ').toUpperCase();
  let m = meta; while (x.measureText(m).width > S - textX - 300 && m.length > 10) m = m.slice(0, -2);
  x.fillText(m === meta ? m : m + '…', textX, 934);
  // stamp
  const stamp = d.style === 'classic' ? '#c4841c' : accent;
  x.save(); x.translate(S - 230, 930); x.rotate(-0.07); x.strokeStyle = stamp; x.fillStyle = stamp; x.lineWidth = 5;
  x.strokeRect(-12, -14, 164, 70); x.font = '400 40px Anton, Impact, sans-serif'; x.fillText(t.inDraw ? 'IN DRAW' : 'I’M IN.', 6, -2); x.restore();
  try {
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('blob'))), 'image/png'));
  } catch (e) {
    // A flyer served without CORS taints the canvas; redraw without it rather than fail.
    if (withArt && art) return shareImage(t, { withArt: false });
    throw e;
  }
}
