// login.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { signIn, onUser, resetPassword, signOutUser } from '../firebase.js';
import { $ } from '../app.js';
import { roleOf, home } from '../staff.js';
const msg = (t, ok = false) => { const m = $('#msg'); m.hidden = !t; m.textContent = t; m.className = ok ? 'notice ok' : 'notice'; };
const params = new URLSearchParams(location.search);
const invite = params.get('invite') === '1';
if (params.get('denied')) msg('This account doesn’t have staff access. Ask a super admin to add you.');
const next = params.get('next');
let routed = false;

const route = u => {
  if (routed) return;
  const r = roleOf(u.claims);
  if (!r) { signOutUser(); msg('This account doesn’t have staff access. Ask a super admin to add you.'); return; }
  routed = true;
  location.replace(next && home(r) === 'admin.html' && /^[a-z-]+\.html/.test(next) ? next : home(r));
};

// The invite link (?invite=1) always starts clean: a staff member receiving a text must never
// inherit whatever session is cached on the phone. Sign out, then wait for them to sign in.
let signedOutForInvite = false;
if (invite) {
  signOutUser().finally(() => { signedOutForInvite = true; $('#email').focus(); });
} else {
  onUser(u => { if (u && !params.get('denied')) route(u); });
}

// If the visitor is already signed in but wants to be someone else, give them a way out.
onUser(u => {
  if (!u || signedOutForInvite) { $('#switch').hidden = true; return; }
  $('#switch').hidden = false;
  $('#switch').textContent = `Not ${u.email}? Sign out`;
});

$('#f').onsubmit = async e => {
  e.preventDefault(); msg('');
  const btn = $('#go'); btn.disabled = true; btn.textContent = 'Signing in…';
  try { route(await signIn($('#email').value.trim(), $('#pw').value)); }
  catch (err) {
    // One message for wrong email and wrong password: the form never confirms who has an account.
    msg(err.code === 'auth/too-many-requests' ? 'Too many attempts. Wait a few minutes.' : err.code === 'auth/network-request-failed' ? 'Connection dropped. Try again.' : 'That email and password don’t match.');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
};
$('#switch').onclick = async () => { await signOutUser(); msg(''); $('#email').value = ''; $('#pw').value = ''; $('#email').focus(); $('#switch').hidden = true; };
$('#forgot').onclick = async () => {
  const email = $('#email').value.trim();
  if (!email) { msg('Enter your email first, then tap Forgot password.'); return $('#email').focus(); }
  try { await resetPassword(email); } catch { /* same answer either way */ }
  msg('If that email has a staff account, a reset link is on its way.', true);
};