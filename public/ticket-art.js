// One ticket layout for every night: the guest's chosen line is the big type; first name, night,
// date and Memories sit underneath; QR + short code on the stub; the flyer faded behind.
// Used for the live preview at checkout and for the real ticket.
import { esc, shortDate, doors } from './app.js';

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

// t: { line, firstName, eventName, date, doors, venue, artwork, code, status, inDraw, type, admits }
export function ticketHTML(t, { preview = false, qr = '' } = {}) {
  const big = t.line || t.eventName || 'MEMORIES';
  const long = big.length > 16;
  const status = preview ? '<span class="t-stamp preview">PREVIEW</span>'
    : t.status === 'used' ? '<span class="t-stamp used">CHECKED IN</span>'
      : t.status === 'cancelled' ? '<span class="t-stamp cancelled">CANCELLED</span>'
        : '<span class="t-stamp valid">VALID</span>';
  return `<article class="ticket" aria-label="Ticket for ${esc(t.eventName)}">
    ${t.artwork ? `<div class="t-art"><img src="${esc(t.artwork)}" alt="" crossorigin="anonymous" decoding="async"></div>` : ''}
    <div class="t-main">
      <div class="t-top"><span class="brandmark">MEMORIES</span><span style="text-align:right">${esc(t.type || 'Ticket')}${t.admits > 1 ? `<br>ADMITS ${t.admits}` : '<br>ADMIT ONE'}</span></div>
      <p class="t-line ${long ? 'long' : ''} ${t.line ? '' : 'event'}" data-line>${esc(big)}</p>
      <div class="t-name" data-name>${esc(t.firstName || (preview ? 'Your name' : ''))}</div>
      <div class="t-meta">${t.line ? `<span>${esc(t.eventName)}</span>` : ''}<b>${t.date ? esc(shortDate(t.date)) : ''}</b><span>${t.date ? esc(doors(t)) : ''}</span><span>${esc(t.venue || '')}</span></div>
    </div>
    <div class="t-rule" aria-hidden="true"></div>
    <div class="t-stub">
      ${qr ? `<div class="t-qr" aria-label="Entry QR code">${qr}</div>` : `<div class="t-qr blank">QR APPEARS<br>ONCE PAID</div>`}
      <div><div class="t-code">${esc(t.code || 'MEM-······')}</div>
        <div class="t-status">${status}${t.inDraw ? '<span class="t-stamp draw">IN THE DRAW</span>' : ''}</div>
        <div class="t-small">Show at the door · strictly 18+</div></div>
    </div>
  </article>`;
}

// ── Square share image (1080×1080), drawn in the browser ──
// Deliberately carries no QR and no code: it's for posting, and a posted QR is a stolen ticket.
function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/); const out = []; let cur = '';
  for (const w of words) { const test = cur ? `${cur} ${w}` : w; if (ctx.measureText(test).width <= maxW || !cur) cur = test; else { out.push(cur); cur = w; } }
  if (cur) out.push(cur); return out;
}
const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

export async function shareImage(t, { withArt = true } = {}) {
  await Promise.all(['400 100px Anton', 'italic 400 60px "Instrument Serif"', '700 30px Archivo'].map(f => document.fonts?.load(f).catch(() => {})));
  const S = 1080, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  // paper
  x.fillStyle = '#e9ddc0'; x.fillRect(0, 0, S, S);
  const [art, logo] = await Promise.all([withArt ? loadImg(t.artwork) : null, loadImg('assets/logo.webp')]);
  if (art) {
    x.save(); x.globalAlpha = .08; x.filter = 'grayscale(1) sepia(.5) contrast(1.1)';
    const r = Math.max(S / art.width, S / art.height); x.drawImage(art, (S - art.width * r) / 2, (S - art.height * r) / 2, art.width * r, art.height * r);
    x.restore();
  }
  // speckle grain
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(36,29,20,${Math.random() * .08})`; x.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  // frame + perforation edge
  x.strokeStyle = '#241d14'; x.lineWidth = 4; x.strokeRect(40, 40, S - 80, S - 80);
  x.fillStyle = '#0d0a09'; for (let y = 70; y < S - 60; y += 36) { x.beginPath(); x.arc(40, y, 7, 0, Math.PI * 2); x.arc(S - 40, y, 7, 0, Math.PI * 2); x.fill(); }
  // top row
  x.fillStyle = '#7c2a28'; x.font = '400 44px Anton, Impact, sans-serif'; x.textBaseline = 'top';
  if (logo) { const h = 46, w = logo.width * (h / logo.height); x.drawImage(logo, 88, 88, w, h); } else x.fillText('MEMORIES', 88, 88);
  x.fillStyle = '#241d14'; x.font = '700 24px Archivo, Arial, sans-serif'; x.textAlign = 'right';
  x.fillText('CAPE COAST', S - 88, 100); x.textAlign = 'left';
  // the line, as big as it can be
  const big = (t.line || t.eventName || 'MEMORIES').toUpperCase();
  let size = 250, rows;
  do { x.font = `400 ${size}px Anton, Impact, sans-serif`; rows = wrapLines(x, big, S - 250); size -= 6; } while ((rows.length * size * .92 > 560 || rows.some(r => x.measureText(r).width > S - 250)) && size > 70);
  size += 6; x.font = `400 ${size}px Anton, Impact, sans-serif`;
  const lh = size * .9, blockH = rows.length * lh, top = 190 + (560 - blockH) / 2;
  x.save(); x.translate(94, top); x.rotate(-0.02); x.fillStyle = t.line ? '#7c2a28' : '#241d14';
  rows.forEach((r, i) => x.fillText(r, 0, i * lh)); x.restore();
  // name
  x.fillStyle = '#241d14'; x.font = 'italic 400 88px "Instrument Serif", Georgia, serif';
  x.fillText(`— ${t.firstName || ''}`, 94, 790);
  // dashed rule + event strip
  x.setLineDash([14, 10]); x.lineWidth = 3; x.beginPath(); x.moveTo(88, 906); x.lineTo(S - 88, 906); x.stroke(); x.setLineDash([]);
  x.font = '700 26px Archivo, Arial, sans-serif'; x.fillStyle = '#241d14';
  const meta = [t.line ? t.eventName : '', t.date ? shortDate(t.date) : ''].filter(Boolean).join('   ·   ').toUpperCase();
  let m = meta; while (x.measureText(m).width > S - 380 && m.length > 10) m = m.slice(0, -2);
  x.fillText(m === meta ? m : m + '…', 94, 934);
  // stamp
  x.save(); x.translate(S - 230, 930); x.rotate(-0.07); x.strokeStyle = '#c4841c'; x.fillStyle = '#c4841c'; x.lineWidth = 5;
  x.strokeRect(-12, -14, 164, 70); x.font = '400 40px Anton, Impact, sans-serif'; x.fillText(t.inDraw ? 'IN DRAW' : 'I’M IN.', 6, -2); x.restore();
  try {
    return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('blob'))), 'image/png'));
  } catch (e) {
    // A flyer served without CORS taints the canvas; redraw without it rather than fail.
    if (withArt && art) return shareImage(t, { withArt: false });
    throw e;
  }
}
