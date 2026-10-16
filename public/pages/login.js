// login.html: staff sign in with their phone number and the PIN that was texted to them (or one they
// changed it to). First time or forgot it: "Text me one" sends a new PIN to the phone typed in.
// Older accounts can still use email and password.
import { signIn, signInWithToken, onUser, resetPassword, signOutUser } from '../firebase.js';
import { $, $$, api, normalizePhone } from '../app.js';
import { roleOf, home } from '../staff.js';

const msg = (t, ok = false) => { const m = $('#msg'); m.hidden = !t; m.textContent = t; m.className = ok ? 'notice ok' : 'notice'; };
const params = new URLSearchParams(location.search);
const next = params.get('next');
if (params.get('denied')) msg('This account doesn’t have staff access. Ask a manager to add you.');
const PHONE = 'mem-staff-phone';
const remember = p => { try { localStorage.setItem(PHONE, p); } catch { /* private mode */ } };
try { const p = localStorage.getItem(PHONE); if (p) $('#phone').value = p; } catch { /* private mode */ }

let routed = false;
const route = u => {
  if (routed) return;
  const r = roleOf(u.claims);
  if (!r) { signOutUser(); msg('This account doesn’t have staff access. Ask a manager to add you.'); return; }
  routed = true;
  location.replace(next && /^[a-z-]+\.html/.test(next) ? next : home(r));
};

// One form on screen at a time.
const show = id => { for (const f of ['#pinForm', '#f']) $(f).hidden = f !== id; $('#toEmail').hidden = id === '#f'; msg(''); $(`${id} input`)?.focus(); };
$$('[data-back]').forEach(b => b.onclick = () => show('#pinForm'));
$('#toEmail').onclick = () => show('#f');
$('#showPin').onclick = e => { const on = $('#pin').type === 'password'; $('#pin').type = on ? 'text' : 'password'; e.target.textContent = on ? 'Hide' : 'Show'; e.target.setAttribute('aria-pressed', String(on)); };

const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; };
async function finish(d) { route(await signInWithToken(d.token)); }

// 1. Phone + PIN
$('#pinForm').onsubmit = async ev => {
  ev.preventDefault(); msg('');
  const phone = $('#phone').value.trim(), pin = $('#pin').value.trim();
  if (!normalizePhone(phone)) { msg('Enter your phone number, e.g. 024 123 4567.'); return $('#phone').focus(); }
  if (!/^\d{4,6}$/.test(pin)) { msg('Enter your PIN (4 or 6 numbers).'); return $('#pin').focus(); }
  const btn = $('#go'); busy(btn, true, 'Signing in…');
  try { remember(phone); await finish(await api('/api/staff-auth/sign-in', { method: 'POST', body: { phone, pin } })); }
  catch (e) {
    busy(btn, false, 'Sign in'); $('#pin').value = '';
    msg(e.message); $('#pin').focus();
  }
};

// 2. First time or forgot: text a new PIN to the phone typed in (it works for 30 minutes; the old
// one keeps working until the new one is used).
$('#sendPin').onclick = async () => {
  const phone = $('#phone').value.trim();
  if (!normalizePhone(phone)) { msg('Type your phone number first, then tap “Text me one”.'); return $('#phone').focus(); }
  const btn = $('#sendPin'); busy(btn, true, 'Sending…');
  try { const r = await api('/api/staff-auth/send-pin', { method: 'POST', body: { phone } }); remember(phone); msg(r.message, true); $('#pin').value = ''; $('#pin').focus(); }
  catch (e) { msg(e.message); }
  busy(btn, false, 'First time, or forgot your PIN? Text me one');
};

// Older accounts: email + password
$('#f').onsubmit = async e => {
  e.preventDefault(); msg('');
  const btn = $('#goEmail'); busy(btn, true, 'Signing in…');
  try { route(await signIn($('#email').value.trim(), $('#pw').value)); }
  catch (err) {
    msg(err.code === 'auth/too-many-requests' ? 'Too many attempts. Wait a few minutes.' : err.code === 'auth/network-request-failed' ? 'Connection dropped. Try again.' : 'That email and password don’t match.');
    busy(btn, false, 'Sign in');
  }
};
$('#forgot').onclick = async () => {
  const email = $('#email').value.trim();
  if (!email) { msg('Enter your email first, then tap Forgot password.'); return $('#email').focus(); }
  try { await resetPassword(email); } catch { /* same answer either way */ }
  msg('If that email has a staff account, a reset link is on its way.', true);
};

// Old welcome texts for email accounts (?email=1) open the email form.
if (params.get('email') === '1' || params.get('invite') === '1') show('#f');
onUser(u => {
  if (u && !params.get('denied')) route(u);
  $('#switch').hidden = !u; $('#switch').textContent = 'Not you? Sign out';
});
$('#switch').onclick = async () => { await signOutUser(); msg(''); $('#switch').hidden = true; $('#pin').value = ''; $('#phone').focus(); };
if ($('#pinForm').hidden === false) ($('#phone').value ? $('#pin') : $('#phone')).focus();
