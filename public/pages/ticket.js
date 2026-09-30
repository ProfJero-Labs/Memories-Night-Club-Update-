// ticket.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, params, $, errorState, toast, shortDate } from '../app.js';
import { ticketHTML, qrSvg, verifyUrl, shareImage } from '../ticket-art.js';
chrome();
const root = $('#root');
const token = params.get('token');
let T, blob, blobUrl;

function view(t, qr) {
  const r = t.raffle;
  const drawNote = r?.status === 'drawn' && r.youWon ? `<div class="notice ok">You won the draw${r.prize ? `: ${esc(r.prize)}` : ''}. Show this ticket at the door.</div>`
    : r?.status === 'drawn' && r.winner ? `<div class="notice">The draw is done: won by ${esc(r.winner.name)}.</div>`
    : t.inDraw ? `<div class="notice ok">You’re in the draw${r?.prize ? ` for ${esc(r.prize)}` : ''}. Winner is picked before the night and gets a text.</div>` : '';
  root.innerHTML = `<div class="ticket-page">
    <div>${ticketHTML({ line: t.identityLine, firstName: t.firstName, eventName: t.eventName, eventId: t.eventId, ticketStyle: t.ticketStyle, ticketColors: t.ticketColors, autoStyle: t.autoStyle, date: t.eventDate, doors: t.doors, venue: t.venue, artwork: t.artwork, code: t.displayCode, status: t.status, inDraw: t.inDraw, type: t.type, admits: t.admits }, { qr })}
      <p class="foot-small" style="text-align:center;margin-top:16px">This page is your ticket. Tap the QR to make it big at the door. Keep the link to yourself; it gets you in once.</p></div>
    <div class="post">
      <p class="kicker red">${params.get('new') ? 'You’re in' : esc(shortDate(t.eventDate || new Date()))}</p>
      <h1 class="display md">${t.status === 'used' ? 'Checked in. Enjoy it.' : t.status === 'cancelled' ? 'This ticket was cancelled.' : 'See you inside.'}</h1>
      ${drawNote}
      ${t.status === 'cancelled' ? '' : `<div class="section-title" style="margin-top:14px"><h2>Your post</h2><span class="kicker">No QR · safe to post</span></div>
      <img id="postImg" alt="Your Memories share image: ${esc(t.identityLine || t.eventName)} — ${esc(t.firstName)}">
      <div class="share-actions no-print"><button class="btn red" id="share">Share my night</button><button class="btn" id="dl">Download</button></div>`}
      <div class="info-rows no-print" style="margin-top:6px">
        <button type="button" class="link" id="print" style="display:flex;justify-content:space-between;width:100%;text-decoration:none;padding:16px 0;border:0;border-bottom:1px solid var(--line)"><span class="k">Offline copy</span><span>Save / print ticket</span></button>
        <a href="event.html?id=${encodeURIComponent(t.eventId)}"><span class="k">The night</span><span>${esc(t.eventName)} ↗</span></a>
      </div>
    </div></div>`;
  $('#print').onclick = () => print();
  if (t.status !== 'cancelled') makePost(t);
  // A dark doorway and a dim phone: tap the QR and it fills the screen on white.
  const small = $('.t-qr'); if (!qr || !small || t.status !== 'valid') return;
  small.setAttribute('role', 'button'); small.tabIndex = 0; small.setAttribute('aria-label', 'Show the QR code full screen');
  const big = document.createElement('dialog'); big.className = 'qr-full';
  big.innerHTML = `<div class="qr-big">${qr}</div><p class="qr-code">${esc(t.displayCode || '')}</p><p class="qr-hint">Turn your brightness up. Tap anywhere to close.</p>`;
  document.body.append(big);
  const open = () => { big.showModal(); navigator.wakeLock?.request('screen').catch(() => {}); };
  small.onclick = open; small.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  big.onclick = () => big.close();
}

async function makePost(t) {
  const img = $('#postImg');
  try {
    blob = await shareImage({ line: t.identityLine, firstName: t.firstName, eventName: t.eventName, eventId: t.eventId, ticketStyle: t.ticketStyle, ticketColors: t.ticketColors, autoStyle: t.autoStyle, doors: t.doors, date: t.eventDate, artwork: t.artwork, inDraw: t.inDraw });
    blobUrl = URL.createObjectURL(blob); img.src = blobUrl;
  } catch { img.replaceWith(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Your share image couldn’t be drawn on this phone. Screenshot the ticket instead.' })); }
  const file = () => new File([blob], `memories-${(t.identityLine || t.eventName).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`, { type: 'image/png' });
  $('#dl').onclick = () => { if (!blob) return; const a = Object.assign(document.createElement('a'), { href: blobUrl, download: file().name }); document.body.append(a); a.click(); a.remove(); };
  $('#share').onclick = async () => {
    if (!blob) return;
    const f = file();
    if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], text: `${t.identityLine || ''} ${t.eventName} · Memories`.trim() }); } catch { /* closed the sheet */ } }
    else { $('#dl').click(); toast('SAVED. POST IT FROM YOUR PHOTOS.'); }
  };
}

async function load() {
  if (!token) return errorState(root, 'This link is missing its ticket.');
  try {
    T = (await api(`/api/tickets/${encodeURIComponent(token)}`)).ticket;
    document.title = `${T.eventName} · Your ticket · Memories`;
    view(T, await qrSvg(verifyUrl(token)).catch(() => ''));
  } catch (e) {
    if (e.status === 404) root.innerHTML = '<div class="state-msg"><h2 class="display">This ticket isn’t valid.</h2><p>Check the link from your text message, or have it sent again.</p><a class="btn red" href="find.html">Find my ticket</a></div>';
    else errorState(root, e.message, load);
  }
}
load();
