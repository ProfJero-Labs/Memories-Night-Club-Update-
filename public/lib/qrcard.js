// The QR maker for scan to order, used by the control room (Setup → Bar orders) and the bar screen.
// Pick a bar, optionally a table (or a range: "1-12" makes one card per table), then print the
// cards, save one as a picture to send to a printer or WhatsApp, or copy the link.
// Each card's QR opens counter.html?s={bar token}&t={table}; the bar sees the table on the order.
import { esc } from '../app.js';
import { qrSvg } from '../ticket-art.js';

const CSS = `
.qrm { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.72); display: grid; place-items: center; padding: 12px; overflow: auto; }
.qrm-box { background: var(--ink-2, #17110f); color: var(--paper, #f4ead7); border: 2px solid var(--line-2, #3a302b); width: min(560px, 100%); max-height: calc(100dvh - 24px); overflow: auto; padding: 18px; display: grid; gap: 12px; }
.qrm-box h2 { margin: 0; font: 400 26px/1 var(--display, Anton, sans-serif); text-transform: uppercase; }
.qrm-row { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; } @media (max-width: 460px) { .qrm-row { grid-template-columns: 1fr; } }
.qrm-prev { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
.qr-card { flex: 0 0 auto; width: 230px; background: #fff; color: #111; text-align: center; padding: 16px 14px 14px; display: grid; gap: 8px; font-family: 'Archivo', Arial, sans-serif; border-top: 10px solid #b8114a; }
.qr-card .t1 { font: 400 30px/1 'Anton', Impact, sans-serif; text-transform: uppercase; letter-spacing: .02em; }
.qr-card .t2 { font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: .1em; color: #b8114a; }
.qr-card .tbl { display: inline-block; justify-self: center; background: #111; color: #fff; font: 400 20px/1 'Anton', Impact, sans-serif; padding: 6px 10px; letter-spacing: .06em; }
.qr-card svg { width: 100%; height: auto; display: block; }
.qr-card .t3 { font-size: 12px; line-height: 1.35; color: #333; }
.qrm-link { font-size: 13px; color: var(--muted, #a99); overflow-wrap: anywhere; }
.qrm-acts { display: flex; flex-wrap: wrap; gap: 8px; }
#qrPrint { display: none; }
@media print {
  body.qr-printing > *:not(#qrPrint) { display: none !important; }
  body.qr-printing { background: #fff !important; }
  body.qr-printing #qrPrint { display: flex; flex-wrap: wrap; gap: 8mm; justify-content: center; }
  #qrPrint .qr-card { width: 85mm; page-break-inside: avoid; break-inside: avoid; border: 1px solid #ddd; border-top: 10px solid #b8114a; }
}`;

// "1-12", "1, 2, VIP 3", "" → the list of table labels (at most 60 cards at once).
export function parseTables(s) {
  const out = [];
  for (const part of String(s || '').split(',').map(x => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
    if (m) { const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y); for (let i = a; i <= b && out.length < 60; i++) out.push(String(i)); }
    else out.push(part.slice(0, 24));
    if (out.length >= 60) break;
  }
  return [...new Set(out)];
}
export const tableUrl = (base, table) => (table ? `${base}${base.includes('?') ? '&' : '?'}t=${encodeURIComponent(table)}` : base);
const label = t => (t ? `Table ${t.replace(/^table\s*/i, '')}` : '');

async function cardHtml(bar, table) {
  const url = tableUrl(bar.url, table);
  return `<div class="qr-card"><div class="t2">Memories · ${esc(bar.name)}</div><div class="t1">Order &amp; pay here</div>${table ? `<span class="tbl">${esc(label(table))}</span>` : ''}${await qrSvg(url)}<div class="t3">Point your phone camera here.<br>Pay by MoMo or card · show your pickup code at the bar.</div></div>`;
}

// One card as a PNG (for WhatsApp or a print shop).
async function cardPng(bar, table) {
  await qrSvg('x'); // loads the QR library
  const q = window.qrcode(0, 'M'); q.addData(tableUrl(bar.url, table)); q.make();
  const n = q.getModuleCount(), W = 1000, cell = Math.floor(760 / n), qs = cell * n;
  const H = 1420, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  await document.fonts?.ready;
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#b8114a'; x.fillRect(0, 0, W, 34);
  x.textAlign = 'center';
  x.fillStyle = '#b8114a'; x.font = '700 40px Archivo, Arial, sans-serif'; x.fillText(`MEMORIES · ${bar.name.toUpperCase()}`, W / 2, 120);
  x.fillStyle = '#111'; x.font = '110px Anton, Impact, sans-serif'; x.fillText('ORDER & PAY HERE', W / 2, 250, W - 80);
  let top = 300;
  if (table) { x.font = '64px Anton, Impact, sans-serif'; const t = label(table).toUpperCase(), w = x.measureText(t).width + 48; x.fillRect((W - w) / 2, top, w, 90); x.fillStyle = '#fff'; x.fillText(t, W / 2, top + 70); x.fillStyle = '#111'; top += 120; }
  const ox = (W - qs) / 2;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (q.isDark(r, col)) x.fillRect(ox + col * cell, top + r * cell, cell, cell);
  x.fillStyle = '#333'; x.font = '36px Archivo, Arial, sans-serif';
  x.fillText('Point your phone camera here.', W / 2, top + qs + 70);
  x.fillText('Pay by MoMo or card · show your pickup code at the bar.', W / 2, top + qs + 120, W - 60);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

// The modal's styles (also used by the control room's member pass QR).
export function ensureQrCss() {
  if (!document.getElementById('qrm-css')) { const s = document.createElement('style'); s.id = 'qrm-css'; s.textContent = CSS; document.head.append(s); }
}

// The maker. bars: [{ id, name, url }]; pick: the bar to start on.
export function openQrMaker(bars, pick) {
  if (!bars?.length) return alert('Add a bar first.');
  ensureQrCss();
  const back = document.activeElement;
  const m = document.createElement('div'); m.className = 'qrm'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Make order QR codes');
  m.innerHTML = `<div class="qrm-box">
    <h2>Order QR codes</h2>
    <p class="muted" style="margin:0">Guests scan, pay by MoMo or card, and show a pickup code at the bar. A table on the card shows on the bar screen with the order.</p>
    <div class="qrm-row">
      <div class="sfield"><label for="qrmBar">Bar</label><select id="qrmBar">${bars.map(b => `<option value="${esc(b.id)}" ${b.id === pick ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div>
      <div class="sfield"><label for="qrmT">Tables (optional)</label><input id="qrmT" placeholder="e.g. 1-12, VIP 1" autocomplete="off"><span class="hint">Leave empty for one card for the counter.</span></div>
    </div>
    <div class="qrm-prev" id="qrmPrev" aria-live="polite"></div>
    <div class="qrm-link" id="qrmLink"></div>
    <div class="qrm-acts"><button class="sbtn red" type="button" id="qrmPrint">Print</button><button class="sbtn" type="button" id="qrmPng">Save picture</button><button class="sbtn ghost" type="button" id="qrmCopy">Copy link</button><button class="sbtn ghost" type="button" id="qrmClose">Done</button></div>
  </div>`;
  document.body.append(m);
  const $m = s => m.querySelector(s);
  const bar = () => bars.find(b => b.id === $m('#qrmBar').value) || bars[0];
  let cards = [], seq = 0;
  const draw = async () => {
    const my = ++seq, b = bar(), tables = parseTables($m('#qrmT').value), list = tables.length ? tables : [''];
    const html = await Promise.all(list.map(t => cardHtml(b, t)));
    if (my !== seq) return;
    cards = html; $m('#qrmPrev').innerHTML = html.slice(0, 6).join('') + (html.length > 6 ? `<p class="muted" style="align-self:center">+${html.length - 6} more</p>` : '');
    $m('#qrmLink').textContent = tableUrl(b.url, list[0]);
    $m('#qrmPrint').textContent = html.length > 1 ? `Print ${html.length} cards` : 'Print';
  };
  let t; $m('#qrmT').oninput = () => { clearTimeout(t); t = setTimeout(draw, 250); };
  $m('#qrmBar').onchange = draw;
  $m('#qrmPrint').onclick = () => {
    let p = document.getElementById('qrPrint'); if (!p) { p = document.createElement('div'); p.id = 'qrPrint'; document.body.append(p); }
    p.innerHTML = cards.join('');
    document.body.classList.add('qr-printing');
    const done = () => { document.body.classList.remove('qr-printing'); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done); print(); setTimeout(done, 1000);
  };
  $m('#qrmPng').onclick = async () => {
    const b = bar(), tables = parseTables($m('#qrmT').value);
    for (const tb of (tables.length ? tables : [''])) {
      const blob = await cardPng(b, tb), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `memories-${b.name}${tb ? `-table-${tb}` : ''}.png`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  };
  $m('#qrmCopy').onclick = async () => { try { await navigator.clipboard.writeText($m('#qrmLink').textContent); $m('#qrmCopy').textContent = 'Copied'; } catch { prompt('Copy this link:', $m('#qrmLink').textContent); } };
  const close = () => { m.remove(); removeEventListener('keydown', esc_); back?.focus?.(); };
  const esc_ = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', esc_);
  $m('#qrmClose').onclick = close; m.onclick = e => { if (e.target === m) close(); };
  $m('#qrmT').focus();
  draw();
}
