// member.html: the Memories Pass. Staff and members sign in once with their phone (a texted code),
// then this phone shows a pass with a QR that changes every 30 seconds. The QR is signed on the
// phone with a secret only this phone and the Worker hold, so it works with no signal, and a
// screenshot stops working within a minute. A live clock and moving sheen make a screenshot obvious.
import { api, esc, normalizePhone, $ } from '../app.js';
import { qrSvg } from '../ticket-art.js';

const root = $('#root');
const KEY = 'mem-pass';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode: pass lasts this visit */ } };
let pass = load(), timer = null, installEvent = null;

// The installable app: register the service worker (the pass then opens offline).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; const b = $('#install'); if (b) b.hidden = false; });

// ── The rotating code, computed on this phone ──
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function payload(p, step) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(p.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${p.passId}.${step}`))).slice(0, 16);
  return `MP1.${p.passId}.${step}.${sig}`;
}
// Phones' clocks drift; the Worker's time (saved as an offset) keeps the code in step with the gate.
const clockNow = () => Date.now() + (pass?.skewMs || 0);
const stepNow = p => Math.floor(clockNow() / 1000 / (p.stepSeconds || 30));
const skewFrom = serverTime => (Number.isFinite(serverTime) ? serverTime - Date.now() : 0);
const hhmmss = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour12: false });
const when = d => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Accra', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ── Sign in: phone → texted code → pass ──
function signIn(msg = '') {
  clearInterval(timer);
  root.innerHTML = `<div class="pass-top"><img src="assets/logo-sm.webp" alt="Memories" width="110" height="26"></div>
    <h1 class="display" style="font-size:clamp(48px,14vw,72px);margin:0">Your pass</h1>
    <p class="muted" style="margin:0">For Memories staff and members. Use the phone number the club has for you.</p>
    ${msg ? `<div class="notice" role="alert">${esc(msg)}</div>` : ''}
    <form id="ph" class="step" novalidate>
      <div class="field"><label for="phone">Your phone</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567"></div>
      <button class="btn red block" type="submit">Text me a code <span class="arrow">→</span></button>
    </form>
    <p class="foot-small" style="margin:0">No data at the gate? Just give the door your number: they’ll text you a code to say.</p>`;
  $('#ph').onsubmit = async ev => {
    ev.preventDefault();
    const phone = $('#phone').value;
    if (!normalizePhone(phone)) return signIn('Use a Ghana number, e.g. 024 123 4567.');
    const btn = $('#ph button'); btn.disabled = true; btn.textContent = 'Sending…';
    try { const d = await api('/api/members/pass-code', { method: 'POST', body: { phone } }); askCode(phone, d.message); }
    catch (e) { signIn(e.message); }
  };
}
function askCode(phone, message, err = '') {
  root.innerHTML = `<h1 class="display" style="font-size:clamp(44px,12vw,64px);margin:0">Enter the code</h1>
    <div class="notice ok" role="status">${esc(message)}</div>${err ? `<div class="notice" role="alert">${esc(err)}</div>` : ''}
    <form id="cd" class="step" novalidate>
      <div class="field"><label for="code">6-digit code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*"></div>
      <button class="btn red block" type="submit">Open my pass <span class="arrow">→</span></button>
      <button class="link" type="button" id="again" style="justify-self:start">Use a different number</button>
    </form>`;
  $('#code').focus();
  $('#again').onclick = () => signIn();
  $('#cd').onsubmit = async ev => {
    ev.preventDefault();
    const btn = $('#cd button[type=submit]'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const d = await api('/api/members/pass', { method: 'POST', body: { phone, code: $('#code').value, device: navigator.userAgent.slice(0, 60) } });
      pass = { passId: d.passId, secret: d.secret, stepSeconds: d.stepSeconds, member: d.member, savedAt: Date.now(), skewMs: skewFrom(d.serverTime) }; save(pass); show();
    } catch (e) { askCode(phone, message, e.message); }
  };
}

// ── The pass ──
function show(state = { online: null, valid: true }) {
  clearInterval(timer);
  const m = pass.member;
  root.innerHTML = `<div class="pass-top"><img src="assets/logo-sm.webp" alt="Memories" width="110" height="26"><button type="button" class="btn red" id="install" hidden style="min-height:44px;padding:0 14px">Install app</button></div>
    <section class="pass ${state.valid ? '' : 'bad'}" aria-label="Your Memories pass">
      <div class="role"><span class="badge ${m.type === 'staff' ? '' : 'member'}">${m.type === 'staff' ? 'Staff' : 'Member'}</span>${m.department ? `<span>${esc(m.department)}</span>` : ''}</div>
      <h1 class="who">${esc(m.name)}</h1>
      ${state.valid ? '' : `<div class="notice" role="alert"><strong>Not valid.</strong> ${esc(state.reason === 'suspended' ? 'This membership is suspended.' : state.reason === 'expired' ? 'This membership has ended.' : 'This pass was signed out. Sign in again.')} Talk to the manager.</div>`}
      <div class="qr-live" aria-label="Gate QR code, changes every 30 seconds"><div id="qr"></div><span class="tick" id="tick">Live code</span></div>
      <div class="bar" aria-hidden="true"><i id="bar"></i></div>
      <div class="clock" id="clock" aria-live="off">${hhmmss()}</div>
      <div class="meta-rows">
        ${m.position ? `<div><span>Position</span> · ${esc(m.position)}</div>` : ''}
        ${m.staffNo ? `<div><span>Staff no.</span> · ${esc(m.staffNo)}</div>` : ''}
        ${m.validUntil ? `<div><span>Valid until</span> · ${esc(new Date(`${m.validUntil}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}</div>` : ''}
        <div><span>Phone</span> · ${esc(m.phoneHint)}</div>
        <div id="lastIn">${pass.lastEntry ? `<span>Last checked in</span> · ${esc(when(pass.lastEntry))}` : ''}</div>
      </div>
    </section>
    <p class="foot-small" style="margin:0" id="net">${state.online === false ? 'Offline: your pass still works. The door checks it live.' : state.online ? 'Checked with Memories just now.' : 'Show this screen at the gate. Turn your brightness up.'}</p>
    <p class="foot-small" style="margin:0" id="iosHint" hidden>To install: tap Share, then “Add to Home Screen”.</p>
    <button class="link" type="button" id="out" style="justify-self:start">Sign out of this phone</button>`;
  $('#out').onclick = () => { if (confirm('Sign this phone out of your pass?')) { pass = null; save(null); signIn(); } };
  const ib = $('#install');
  if (installEvent) ib.hidden = false;
  ib.onclick = async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; ib.hidden = true; };
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) $('#iosHint').hidden = false;
  if (!state.valid) return;
  navigator.wakeLock?.request('screen').catch(() => {});
  let shown = -1;
  const tick = async () => {
    $('#clock').textContent = hhmmss();
    const sec = pass.stepSeconds || 30, s = stepNow(pass), left = sec - (Math.floor(clockNow() / 1000) % sec);
    $('#bar').style.width = `${(left / sec) * 100}%`;
    $('#tick').textContent = `New code in ${left}s`;
    if (s !== shown) { shown = s; $('#qr').innerHTML = await qrSvg(await payload(pass, s)).catch(() => '<p>QR unavailable</p>'); }
  };
  tick(); timer = setInterval(tick, 1000);
}

// When online, ask the club whether the pass is still good (and when it was last used at the gate).
async function refresh(again = true) {
  try {
    const d = await api('/api/members/pass-status', { method: 'POST', body: { qr: await payload(pass, stepNow(pass)) } });
    if (d.serverTime) pass.skewMs = skewFrom(d.serverTime);
    if (d.reason === 'clock') { save(pass); if (again) return refresh(false); }
    if (d.member) pass.member = d.member;
    pass.lastEntry = d.lastEntry || pass.lastEntry || null; save(pass);
    show({ online: true, valid: d.valid, reason: d.reason });
  } catch { show({ online: navigator.onLine ? null : false, valid: true }); }
}

if (pass?.passId) { show({ online: navigator.onLine ? null : false, valid: true }); refresh(); } else signIn();
addEventListener('online', () => pass && refresh());
