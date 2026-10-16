// login.html: staff sign in with their phone number and PIN. New staff (or a forgotten PIN): a code
// by text, then choose a PIN. Older accounts can still use email and password.
import { signIn, signInWithToken, onUser, resetPassword, signOutUser } from '../firebase.js';
import { $, $$, api, normalizePhone } from '../app.js';
import { roleOf, home } from '../staff.js';

const msg = (t, ok = false) => { const m = $('#msg'); m.hidden = !t; m.textContent = t; m.className = ok ? 'notice ok' : 'notice'; };
const params = new URLSearchParams(location.search);
const invite = params.get('invite') === '1';
const next = params.get('next');
if (params.get('denied')) msg('This account doesn’t have staff access. Ask a manager to add you.');
const PHONE = 'mem-staff-phone';
const remember = p => { try { localStorage.setItem(PHONE, p); } catch { /* private mode */ } };
try { const p = localStorage.getItem(PHONE); if (p) { $('#phone').value = p; $('#cPhone').value = p; $('#sPhone').value = p; } } catch { /* private mode */ }

let routed = false;
const route = u => {
  if (routed) return;
  const r = roleOf(u.claims);
  if (!r) { signOutUser(); msg('This account doesn’t have staff access. Ask a manager to add you.'); return; }
  routed = true;
  try { localStorage.setItem('mem-staff-signed-in', String(Date.now())); } catch { /* private mode */ }
  location.replace(next && /^[a-z-]+\.html/.test(next) ? next : home(r));
};

// One form on screen at a time.
const show = id => { for (const f of ['#pinForm', '#codeForm', '#setForm', '#f']) $(f).hidden = f !== id; $('#toEmail').hidden = id === '#f'; msg(''); const first = $(`${id} input`); if (first && !first.value) first.focus(); else $(`${id} input:not([value])`)?.focus(); };
$$('[data-back]').forEach(b => b.onclick = () => show('#pinForm'));
$('#toCode').onclick = () => { $('#cPhone').value = $('#phone').value || $('#cPhone').value; show('#codeForm'); };
$('#haveCode').onclick = () => { $('#sPhone').value = $('#cPhone').value; show('#setForm'); $('#sCode').focus(); };
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
    if (e.code === 'no_pin') { $('#cPhone').value = phone; show('#codeForm'); msg('You haven’t chosen a PIN yet. Get a code by text first.'); return; }
    msg(e.message); $('#pin').focus();
  }
};

// 2. Text me a code
$('#codeForm').onsubmit = async ev => {
  ev.preventDefault();
  const phone = $('#cPhone').value.trim();
  if (!normalizePhone(phone)) { msg('Enter your phone number, e.g. 024 123 4567.'); return $('#cPhone').focus(); }
  const btn = $('#codeForm button[type=submit]'); busy(btn, true, 'Sending…');
  try { const r = await api('/api/staff-auth/send-code', { method: 'POST', body: { phone } }); remember(phone); $('#sPhone').value = phone; show('#setForm'); msg(r.message, true); $('#sCode').focus(); }
  catch (e) { msg(e.message); }
  busy(btn, false, 'Text me a code');
};

// 3. Code + new PIN
$('#setForm').onsubmit = async ev => {
  ev.preventDefault(); msg('');
  const phone = $('#sPhone').value.trim(), code = $('#sCode').value.trim(), pin = $('#sPin').value.trim();
  if (!/^\d{6}$/.test(code)) { msg('Enter the 6-number code from the text.'); return $('#sCode').focus(); }
  if (pin !== $('#sPin2').value.trim()) { msg('The two PINs don’t match. Type them again.'); $('#sPin2').value = ''; return $('#sPin2').focus(); }
  const btn = $('#setForm button[type=submit]'); busy(btn, true, 'Saving…');
  try { remember(phone); await finish(await api('/api/staff-auth/set-pin', { method: 'POST', body: { phone, code, pin } })); }
  catch (e) { msg(e.message); busy(btn, false, 'Save my PIN and sign in'); }
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

// The welcome text's link (?invite=1) always starts clean: never inherit someone else's session.
let signedOutForInvite = false;
if (invite) signOutUser().finally(() => { signedOutForInvite = true; show('#codeForm'); $('#title').textContent = 'Welcome'; msg('Enter your phone number, then the code from your text, and choose your PIN.', true); $('#haveCode').click(); });
else onUser(u => { if (u && !params.get('denied')) route(u); });
onUser(u => {
  if (!u || signedOutForInvite) { $('#switch').hidden = true; return; }
  $('#switch').hidden = false; $('#switch').textContent = 'Not you? Sign out';
});
$('#switch').onclick = async () => { await signOutUser(); msg(''); $('#switch').hidden = true; $('#pin').value = ''; $('#phone').focus(); };
$('#phone').focus();
