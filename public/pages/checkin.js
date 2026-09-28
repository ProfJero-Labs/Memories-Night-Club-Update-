// checkin.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { $, esc, params, shortDate } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
const user = await requireStaff(['superAdmin', 'manager', 'eventManager', 'doorStaff', 'organiser']);
staffHeader(user, 'Door');
if (['superAdmin', 'manager', 'eventManager'].includes(user.role)) $('#adminLink').hidden = false;
if (user.role === 'organiser') { $('#adminLink').hidden = false; $('#adminLink').href = 'organiser.html'; $('#adminLink').textContent = 'My nights'; }

try {
  const { events } = await sapi('/api/door/events');
  $('#ev').innerHTML += events.map(e => `<option value="${esc(e.id)}">${esc(shortDate(e.date))} · ${esc(e.name)}</option>`).join('');
  const want = params.get('event') || sessionStorage.getItem('door-event') || events[0]?.id || '';
  if (events.some(e => e.id === want)) $('#ev').value = want;
} catch { /* any-night mode still works */ }
$('#ev').onchange = () => sessionStorage.setItem('door-event', $('#ev').value);

let admitted = 0, busy = false, last = { t: '', at: 0 };
const RESULT = {
  ok: ['ok', 'Entry confirmed'], used: ['no', 'Already checked in'], invalid: ['no', 'Ticket not valid'], cancelled: ['no', 'Ticket cancelled'],
  wrong_night: ['warn', 'Wrong night'], forbidden: ['no', 'Not your night'],
};
async function check(raw) {
  const now = Date.now();
  if (busy || (raw === last.t && now - last.at < 4000)) return;
  busy = true; last = { t: raw, at: now };
  $('#out').innerHTML = '<div class="loading" style="padding:10px 0">Checking…</div>';
  try {
    const r = await sapi('/api/checkin', { method: 'POST', body: { token: raw, eventId: $('#ev').value || undefined } });
    const [cls, title] = RESULT[r.code] || ['no', r.message];
    const t = r.ticket || {};
    if (r.valid) admitted += t.admits || 1;
    $('#counted').textContent = `${admitted} in on this device`;
    navigator.vibrate?.(r.valid ? 80 : [60, 60, 160]);
    $('#out').innerHTML = `<div class="result ${cls}" role="alert"><h1 class="display">${esc(title)}</h1>
      ${t.firstName ? `<p style="margin:0;font-size:22px"><strong>${esc(t.firstName)}</strong>${t.admits > 1 ? ` · <strong>admits ${t.admits}</strong>` : ''}</p>` : ''}
      ${t.eventName ? `<p class="foot-small" style="margin:0">${esc(t.eventName)} · ${esc(t.type || '')} · ${esc(t.displayCode || '')}${t.comp ? ' · comp' : ''}</p>` : ''}
      ${r.code === 'used' && t.checkedInAt ? `<p class="foot-small" style="margin:0">First scanned ${esc(new Date(t.checkedInAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }))}</p>` : ''}</div>`;
  } catch (e) { $('#out').innerHTML = `<div class="result no"><h1 class="display">Try again</h1><p style="margin:0">${esc(e.message)}</p></div>`; }
  busy = false;
}
$('#manual').onsubmit = ev => { ev.preventDefault(); const v = $('#code').value.trim(); if (v) { last.t = ''; check(v); $('#code').value = ''; } };

// Camera: the browser's own BarcodeDetector where it exists (Chrome on Android), otherwise jsQR.
$('#start').onclick = async () => {
  const video = $('#video');
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    await video.play();
  } catch { $('#camOff').innerHTML = '<p>Camera blocked. Allow camera access for this site, or paste the ticket link below.</p>'; return; }
  $('#camOff').hidden = true; $('#frame').hidden = false;
  let detect;
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
    const bd = new BarcodeDetector({ formats: ['qr_code'] });
    detect = async () => (await bd.detect(video))[0]?.rawValue;
  } else {
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jsQR.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
    const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
    detect = async () => { const w = video.videoWidth, h = video.videoHeight; if (!w) return null; const s = Math.min(1, 640 / Math.max(w, h)); c.width = w * s; c.height = h * s; ctx.drawImage(video, 0, 0, c.width, c.height); return window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)?.data; };
  }
  const loop = async () => { try { const v = await detect(); if (v) await check(v); } catch { /* keep scanning */ } setTimeout(loop, 250); };
  loop();
};
