// checkin.html (/door): scanner, paste, and search, against one chosen night.
// Built for a dark room, one hand, hundreds of scans: big results, tones, no paragraphs.
import { $, esc, params, shortDate, nightKey } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
const user = await requireStaff(['superAdmin', 'manager', 'eventManager', 'doorStaff', 'organiser']);
staffHeader(user, 'Door');
if (['superAdmin', 'manager', 'eventManager'].includes(user.role)) $('#adminLink').hidden = false;
if (user.role === 'organiser') { $('#adminLink').hidden = false; $('#adminLink').href = 'organiser.html'; $('#adminLink').textContent = 'My nights'; }

// ── The night ──
// ?event= wins; otherwise the night whose door window contains now (a night runs until 04:00 the
// next morning); otherwise staff must choose. Changing night is always a deliberate action.
const ev = $('#ev');
const night = () => ev.value;
try {
  const { events } = await sapi('/api/door/events');
  ev.innerHTML += events.map(e => `<option value="${esc(e.id)}">${esc(shortDate(e.date))} · ${esc(e.name)}</option>`).join('');
  const tonight = events.filter(e => nightKey(e.date) === nightKey());
  const want = params.get('event');
  if (want && events.some(e => e.id === want)) ev.value = want;
  else if (tonight.length === 1) ev.value = tonight[0].id;
  else { const saved = sessionStorage.getItem('door-event'); if (tonight.some(e => e.id === saved)) ev.value = saved; }
  $('#evHint').textContent = !events.length ? 'No nights to check in yet.' : night() ? '' : 'Choose the night before scanning.';
} catch (e) { $('#evHint').textContent = e.status === 0 ? 'No connection. Reload when you have signal.' : e.message; }
ev.onchange = () => { sessionStorage.setItem('door-event', night()); $('#evHint').textContent = ''; $('#hits').innerHTML = ''; summary(); };

// ── Headcount from the server (every phone sees the same numbers) ──
let summaryT;
async function summary() {
  clearTimeout(summaryT);
  if (night() && document.visibilityState === 'visible') {
    try { const s = await sapi(`/api/door/summary?eventId=${encodeURIComponent(night())}`); $('#inCount').textContent = s.admitted; $('#expCount').textContent = s.expected; }
    catch { /* keep the last numbers; the next poll retries */ }
  }
  summaryT = setTimeout(summary, 15000);
}
summary();

// ── Feedback: tone + vibration ──
let audio;
function tone(ok) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square';
    g.gain.setValueAtTime(0.15, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (ok ? 0.15 : 0.45));
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.15 : 0.45));
  } catch { /* no audio: vibration and colour still show it */ }
  navigator.vibrate?.(ok ? 80 : [60, 60, 160]);
}

// ── What counts as a ticket: a raw token, or a verify/ticket link carrying one ──
function parseTicket(raw) {
  const s = String(raw || '').trim();
  let t = s;
  try { const u = new URL(s); if (!/\/(verify|ticket)(\.html)?$/.test(u.pathname)) return null; t = u.searchParams.get('token') || ''; } catch { /* not a URL: a raw token */ }
  return /^[0-9A-Za-z_-]{16,100}$/.test(t) ? t : null;
}

let phoneCount = 0, busy = false;
const RESULT = {
  ok: ['ok', 'Entry confirmed'], used: ['no', 'Already checked in'], invalid: ['no', 'Ticket not valid'], cancelled: ['no', 'Ticket cancelled'],
  wrong_night: ['warn', 'Wrong night'], forbidden: ['no', 'Not your night'], no_event: ['warn', 'Choose the night'],
  seated: ['ok', 'Table seated'], table_used: ['no', 'Table already seated'],
};
function show(r) {
  const [cls, title] = RESULT[r.code] || ['no', r.message || 'Not valid'];
  const t = r.ticket || {};
  $('#out').innerHTML = `<div class="result ${cls}" role="alert">
    ${r.valid && t.admits > 1 ? `<div class="admits">Admits ${t.admits}</div>` : ''}
    <h1 class="display">${esc(title)}</h1>
    ${t.firstName ? `<p style="margin:0;font-size:24px"><strong>${esc(t.firstName)}</strong>${!r.valid && t.admits > 1 ? ` · admits ${t.admits}` : ''}</p>` : ''}
    ${t.eventName ? `<p class="foot-small" style="margin:0">${esc(t.eventName)} · ${esc(t.type || '')} · ${esc(t.displayCode || '')}${t.comp ? ' · comp' : ''}</p>` : ''}
    ${(r.code === 'used' || r.code === 'table_used') && t.checkedInAt ? `<p class="foot-small" style="margin:0">First scanned ${esc(new Date(t.checkedInAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' }))}</p>` : ''}</div>`;
}
const offline = () => { $('#out').innerHTML = '<div class="result offline" role="alert"><h1 class="display">No connection</h1><p style="margin:0">Not checked. Try again when you have signal, or find the guest by name.</p></div>'; navigator.vibrate?.([30, 30, 30]); };

async function admit(body) {
  if (!night()) { show({ code: 'no_event' }); tone(false); ev.focus(); return; }
  if (busy) return;
  busy = true;
  $('#out').innerHTML = '<div class="loading" style="padding:10px 0">Checking…</div>';
  try {
    const r = await sapi('/api/checkin', { method: 'POST', body: { ...body, eventId: night() } });
    show(r); tone(r.valid);
    if (r.valid && !r.ticket?.table) { phoneCount += r.ticket?.admits || 1; $('#counted').textContent = `This phone: ${phoneCount}`; summary(); }
  } catch (e) {
    if (e.status === 0) offline();
    else { $('#out').innerHTML = `<div class="result no" role="alert"><h1 class="display">Try again</h1><p style="margin:0">${esc(e.message)}</p></div>`; tone(false); }
  }
  busy = false;
}

$('#manual').onsubmit = ev2 => {
  ev2.preventDefault();
  const t = parseTicket($('#code').value);
  if (!t) { $('#out').innerHTML = '<div class="result no" role="alert"><h1 class="display">That is not a ticket code.</h1></div>'; tone(false); return; }
  $('#code').value = '';
  admit({ token: t });
};

// ── Search ──
let searchT;
$('#search').oninput = () => {
  clearTimeout(searchT);
  const q = $('#search').value.trim();
  if (q.length < 2 || !night()) { $('#hits').innerHTML = q.length >= 2 ? '<li>Choose the night first.</li>' : ''; return; }
  searchT = setTimeout(async () => {
    try {
      const { results } = await sapi(`/api/door/search?eventId=${encodeURIComponent(night())}&q=${encodeURIComponent(q)}`);
      $('#hits').innerHTML = results.length ? results.map(r => `<li><span><strong>${esc(r.firstName)}</strong>${r.phoneLast4 ? ` · …${esc(r.phoneLast4)}` : ''}<br><span class="foot-small">${r.table ? 'Table · ' : ''}${esc(r.type)} · ${esc(r.code)}${r.admits > 1 ? ` · admits ${r.admits}` : ''}${r.comp ? ' · comp' : ''}</span></span>${r.status === 'valid' ? `<button class="sbtn red" type="button" ${r.table ? 'data-table' : 'data-code'}="${esc(r.code)}">${r.table ? 'Seat' : 'Admit'}</button>` : `<span class="pill ${r.status === 'used' ? 'amber' : 'red'}">${r.status === 'used' ? (r.table ? 'Seated' : 'In') : esc(r.status)}</span>`}</li>`).join('') : '<li>No match for this night.</li>';
      $('#hits').querySelectorAll('[data-code]').forEach(b => b.onclick = () => admit({ code: b.dataset.code }).then(() => $('#search').dispatchEvent(new Event('input'))));
      $('#hits').querySelectorAll('[data-table]').forEach(b => b.onclick = () => admit({ table: b.dataset.table }).then(() => $('#search').dispatchEvent(new Event('input'))));
    } catch (e) { $('#hits').innerHTML = `<li>${e.status === 0 ? 'No connection.' : esc(e.message)}</li>`; }
  }, 300);
};

// ── Camera ──
// One code at a time: after a read, detection stops until "Scan next". The camera turns off when
// the page is hidden, and a torch toggle appears where the phone supports it.
let stream = null, scanning = false, loopT;
function stopCamera() {
  scanning = false; clearTimeout(loopT);
  stream?.getTracks().forEach(t => t.stop()); stream = null;
  $('#video').srcObject = null; $('#frame').hidden = true; $('#torch').hidden = true; $('#next').hidden = true;
  $('#camOff').hidden = false;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stopCamera(); else summary(); });
window.addEventListener('pagehide', stopCamera);

let detect;
async function setupDetector(video) {
  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
    const bd = new BarcodeDetector({ formats: ['qr_code'] });
    return async () => (await bd.detect(video))[0]?.rawValue;
  }
  await new Promise((res, rej) => { if (window.jsQR) return res(); const s = document.createElement('script'); s.src = 'vendor/jsQR.min.js'; s.onload = res; s.onerror = rej; document.head.append(s); });
  const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  return async () => { const w = video.videoWidth, h = video.videoHeight; if (!w) return null; const s = Math.min(1, 640 / Math.max(w, h)); c.width = w * s; c.height = h * s; ctx.drawImage(video, 0, 0, c.width, c.height); return window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)?.data; };
}
async function loop() {
  if (!scanning) return;
  try {
    const v = await detect();
    if (v) {
      scanning = false; $('#frame').hidden = true;
      const t = parseTicket(v);
      if (t) await admit({ token: t }); else { $('#out').innerHTML = '<div class="result no" role="alert"><h1 class="display">That is not a ticket code.</h1></div>'; tone(false); }
      $('#next').hidden = false; $('#next').focus();
      return;
    }
  } catch { /* keep scanning */ }
  loopT = setTimeout(loop, 200);
}
function resume() { if (!stream) return; $('#next').hidden = true; $('#out').innerHTML = ''; $('#frame').hidden = false; scanning = true; loop(); }
$('#next').onclick = resume;

$('#start').onclick = async () => {
  if (!night()) { show({ code: 'no_event' }); ev.focus(); return; }
  const video = $('#video');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream; await video.play();
  } catch { $('#camOff').innerHTML = '<p>Camera blocked. Allow camera access for this site, or paste the ticket link below.</p>'; return; }
  $('#camOff').hidden = true;
  const track = stream.getVideoTracks()[0];
  if (track?.getCapabilities?.().torch) {
    const btn = $('#torch'); btn.hidden = false;
    btn.onclick = async () => { const on = btn.getAttribute('aria-pressed') !== 'true'; try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.setAttribute('aria-pressed', String(on)); } catch { btn.hidden = true; } };
  }
  detect ||= await setupDetector(video);
  resume();
};
