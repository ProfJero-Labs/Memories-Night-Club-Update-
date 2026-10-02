// member.html: the Memories Pass. A member gets it by opening the activation QR or link the manager
// gives them (no SMS); staff open it from "My pass" on their own dashboard. The phone then shows a
// pass with a QR that changes every 30 seconds, signed on the phone with a secret only this phone
// and the Worker hold: it works with no signal, and a screenshot stops working within a minute.
// While it's open it also shows any gate code the door has asked for (the phone-number route).
import { api, esc, params, $ } from '../app.js';
import { qrSvg } from '../ticket-art.js';

const root = $('#root');
const KEY = 'mem-pass';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode: pass lasts this visit */ } };
let pass = load(), timer = null, poll = null, lastGate = null;

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

// ── Getting the pass: the manager's activation QR / link, or a code typed in ──
function signIn(msg = '') {
  clearInterval(timer); clearInterval(poll);
  root.innerHTML = `<div class="pass-top"><img src="assets/logo-sm.webp" alt="Memories" width="110" height="26"><button type="button" class="btn red" data-install hidden style="min-height:44px;padding:0 14px">Install app</button></div>
    <h1 class="display" style="font-size:clamp(48px,14vw,72px);margin:0">Your pass</h1>
    <p class="muted" style="margin:0">For Memories members and staff. Scan the activation QR the manager shows you, or type its code here.</p>
    ${msg ? `<div class="notice" role="alert">${esc(msg)}</div>` : ''}
    <form id="act" class="step" novalidate>
      <div class="field"><label for="code">Activation code</label><input id="code" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="14" placeholder="e.g. 7K3QX9WP2M"></div>
      <button class="btn red block" type="submit">Get my pass <span class="arrow">→</span></button>
    </form>
    <p class="foot-small" style="margin:0"><strong>Staff:</strong> sign in to your dashboard and tap <a href="login.html">My pass</a>. No need for a code.</p>`;
  $('#act').onsubmit = ev => { ev.preventDefault(); activate($('#code').value); };
}
async function activate(code) {
  root.innerHTML = '<div class="loading" role="status">OPENING YOUR PASS…</div>';
  try {
    const d = await api('/api/members/activate', { method: 'POST', body: { code, device: navigator.userAgent.slice(0, 60) } });
    pass = { passId: d.passId, secret: d.secret, stepSeconds: d.stepSeconds, member: d.member, savedAt: Date.now(), skewMs: skewFrom(d.serverTime) }; save(pass);
    history.replaceState(null, '', location.pathname); // the code is used: keep it out of the address bar
    show(); refresh();
  } catch (e) { signIn(e.message); }
}

// ── The pass ──
function show(state = { online: null, valid: true }) {
  clearInterval(timer);
  const m = pass.member;
  root.innerHTML = `<div class="pass-top"><img src="assets/logo-sm.webp" alt="Memories" width="110" height="26"><button type="button" class="btn red" data-install hidden style="min-height:44px;padding:0 14px">Install app</button></div>
    <section class="pass ${state.valid ? '' : 'bad'}" aria-label="Your Memories pass">
      <div class="role"><span class="badge ${m.type === 'staff' ? '' : 'member'}">${m.type === 'staff' ? 'Staff' : 'Member'}</span>${m.department ? `<span>${esc(m.department)}</span>` : ''}</div>
      <h1 class="who">${esc(m.name)}</h1>
      <div id="gate" aria-live="assertive"></div>
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
    <button class="link" type="button" id="out" style="justify-self:start">Sign out of this phone</button>`;
  $('#out').onclick = () => { if (confirm('Sign this phone out of your pass?')) { pass = null; save(null); signIn(); } };
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

// A gate code the door asked for (they typed this member's number): big, with a countdown.
function drawGate(g) {
  const el = $('#gate'); if (!el) return;
  if (!g) { el.innerHTML = ''; lastGate = null; return; }
  if (lastGate !== g.code) navigator.vibrate?.([120, 60, 120]);
  lastGate = g.code;
  const secs = Math.max(0, Math.round((new Date(g.expiresAt).getTime() - clockNow()) / 1000));
  el.innerHTML = `<div class="gate-code"><span>Gate code: say it to the door</span><b>${esc(g.code.replace(/(\d{3})(\d{3})/, '$1 $2'))}</b><small>Expires in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</small></div>`;
}

// While the pass is open: is it still good, is a gate code waiting, when was it last used at the gate?
// Only the first answer redraws the whole pass; after that just the parts that change.
let state = null;
async function refresh(again = true) {
  try {
    const d = await api('/api/members/pass-status', { method: 'POST', body: { qr: await payload(pass, stepNow(pass)) } });
    if (d.serverTime) pass.skewMs = skewFrom(d.serverTime);
    if (d.reason === 'clock') { save(pass); if (again) return refresh(false); }
    if (d.member) pass.member = d.member;
    pass.lastEntry = d.lastEntry || pass.lastEntry || null; save(pass);
    const next = { online: true, valid: d.valid, reason: d.reason };
    if (!state || state.valid !== next.valid || state.online !== true) show(next);
    state = next;
    drawGate(d.gate);
    $('#lastIn') && ($('#lastIn').innerHTML = pass.lastEntry ? `<span>Last checked in</span> · ${esc(when(pass.lastEntry))}` : '');
    $('#net') && ($('#net').textContent = 'Checked with Memories just now.');
  } catch {
    if (!state || state.online === true) { state = { online: navigator.onLine ? null : false, valid: true }; show(state); }
  }
}
// Look for a gate code every 5 seconds while the pass is on screen (not when it's in the background).
const startPolling = () => { clearInterval(poll); poll = setInterval(() => { if (pass && document.visibilityState === 'visible') refresh(); }, 5000); };

const act = params.get('activate');
if (act) activate(act);
else if (pass?.passId) { show({ online: navigator.onLine ? null : false, valid: true }); refresh(); }
else signIn();
startPolling();
addEventListener('online', () => pass && refresh());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pass) refresh(); });
