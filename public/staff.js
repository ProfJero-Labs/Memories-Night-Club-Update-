// Shared by the staff pages (admin, organiser, door). Auth is Firebase; every action is a Worker
// call carrying the Firebase ID token, and the Worker checks the role on every request.
import { onUser, idToken, signOutUser } from './firebase.js';
import { api, esc, CREDIT } from './app.js';

export const roleOf = claims => (claims?.admin === true ? 'superAdmin' : claims?.role || '');
export const ROLE_LABEL = { superAdmin: 'System admin', director: 'Director', manager: 'Manager', hrManager: 'Human manager', finance: 'Finance officer', eventManager: 'Event manager', doorStaff: 'Front office', security: 'Security', barStaff: 'Bartender', waitStaff: 'Waiter / waitress', cashier: 'Cashier', dj: 'DJ', mc: 'MC', organiser: 'Organiser' };
// Each job opens on its own screen.
const HOMES = { manager: 'night.html', director: 'night.html', hrManager: 'hr.html', organiser: 'organiser.html', doorStaff: 'checkin.html', security: 'checkin.html', barStaff: 'bar.html', waitStaff: 'waiter.html', cashier: 'cashier.html', finance: 'finance.html', dj: 'me.html', mc: 'me.html' };
export const home = role => HOMES[role] || 'admin.html';
// Resolves with the signed-in staff user (role and name from their staff record), or sends them on.
export function requireStaff(allowed) {
  return new Promise(resolve => {
    let done = false;
    onUser(async u => {
      if (done) return;
      if (!u) { location.replace(`login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`); return; }
      let role = roleOf(u.claims), me = null;
      try { me = await api('/api/ops/me', { token: await idToken() }); role = me.role; }
      catch (e) { if (e.status === 401) { await signOutUser(); location.replace('login.html?denied=1'); return; } /* offline: the token's role */ }
      if (!role) { signOutUser().then(() => location.replace('login.html?denied=1')); return; }
      if (!allowed.includes(role)) { location.replace(home(role)); return; }
      done = true; resolve({ ...u, role, name: me?.name || '', me });
    });
  });
}

export const sapi = async (path, opts = {}) => api(path, { ...opts, token: await idToken() });

export function staffHeader(user, title) {
  const h = document.createElement('header');
  h.className = 'staff-head';
  const who = user.name || user.email || 'Me';
  h.innerHTML = `<div class="wrap"><a class="logo" href="index.html" title="Public site"><img src="assets/logo-sm.webp" alt="Memories" height="18"></a>
    <strong class="head-title">${esc(title)}</strong>
    <div class="acct"><button type="button" id="acctBtn" aria-haspopup="true" aria-expanded="false"><span>${esc(who.split(/\s+/)[0])}</span> ▾</button>
      <div class="acct-menu" id="acctMenu" hidden role="menu">
        <p class="acct-who"><b>${esc(who)}</b><span>${esc(ROLE_LABEL[user.role] || user.role)}</span></p>
        ${user.role !== 'organiser' ? '<a role="menuitem" class="acct-link" href="me.html">My page: notices, messages, my pay</a>' : ''}
        ${!['dj', 'mc', 'organiser'].includes(user.role) && !location.pathname.endsWith(home(user.role)) ? `<a role="menuitem" class="acct-link" href="${home(user.role)}">My work screen</a>` : ''}
        ${user.role === 'eventManager' && !location.pathname.endsWith('waiter.html') ? '<a role="menuitem" class="acct-link" href="waiter.html">Serve tables (like a waiter)</a>' : ''}
        <button type="button" role="menuitem" id="myPass">My pass (for the gate)</button>
        <button type="button" role="menuitem" id="changePin">Change my PIN</button>
        <button type="button" role="menuitem" data-install hidden>Install the app</button>
        <button type="button" role="menuitem" id="signout" class="danger">Sign out</button>
      </div></div></div>
    <div class="gate-banner" id="gateBanner" hidden role="alert"></div>`;
  document.body.prepend(h);
  const credit = document.createElement('footer'); credit.className = 'staff-credit'; credit.textContent = `Memories platform · ${CREDIT}`;
  document.body.append(credit);
  const menu = h.querySelector('#acctMenu'), btn = h.querySelector('#acctBtn');
  const toggle = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.onclick = e => { e.stopPropagation(); toggle(menu.hidden); };
  document.addEventListener('click', e => { if (!h.querySelector('.acct').contains(e.target)) toggle(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
  h.querySelector('#signout').onclick = () => { signOutUser().then(() => location.replace('login.html')); };
  h.querySelector('#changePin').onclick = () => { toggle(false); changePin(user); };
  // Staff are members: "My pass" puts this person's pass on this phone (their sign-in is the proof).
  h.querySelector('#myPass').onclick = async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Opening…';
    try {
      const d = await sapi('/api/members/my-pass', { method: 'POST', body: { device: navigator.userAgent.slice(0, 60) } });
      localStorage.setItem('mem-pass', JSON.stringify({ passId: d.passId, secret: d.secret, stepSeconds: d.stepSeconds, member: d.member, savedAt: Date.now(), skewMs: d.serverTime - Date.now() }));
      location.href = 'member.html';
    } catch (e) { alert(e.message); b.disabled = false; b.textContent = 'My pass (for the gate)'; }
  };
  watchGate(h.querySelector('#gateBanner'));
}

// A small sheet: current PIN, new PIN twice.
function changePin(user) {
  const n = user.me?.pinLength || 4, has = user.me?.hasPin !== false;
  const box = document.createElement('div'); box.className = 'sheet-back';
  box.innerHTML = `<form class="sheet" novalidate role="dialog" aria-modal="true" aria-label="Change my PIN"><h2>Change my PIN</h2>
    ${has ? `<div class="sfield"><label for="cpOld">${user.me?.pinStarter ? 'The PIN we texted you' : 'Your PIN now'}</label><input id="cpOld" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></div>` : ''}
    <div class="sfield"><label for="cpNew">New PIN (${n} numbers)</label><input id="cpNew" type="password" inputmode="numeric" maxlength="${n}" autocomplete="new-password"></div>
    <div class="sfield"><label for="cpNew2">New PIN again</label><input id="cpNew2" type="password" inputmode="numeric" maxlength="${n}" autocomplete="new-password"></div>
    <div id="cpMsg" role="alert"></div>
    <div class="toolbar" style="margin:0"><button class="sbtn red" type="submit">Save new PIN</button><button class="sbtn ghost" type="button" id="cpClose">Cancel</button></div></form>`;
  document.body.append(box);
  const say = (t, ok) => { box.querySelector('#cpMsg').innerHTML = `<div class="msg ${ok ? '' : 'err'}">${esc(t)}</div>`; };
  const close = () => box.remove();
  box.querySelector('#cpClose').onclick = close;
  box.onclick = e => { if (e.target === box) close(); };
  box.querySelector('input').focus();
  box.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const pin = box.querySelector('#cpNew').value.trim();
    if (pin !== box.querySelector('#cpNew2').value.trim()) return say('The new PINs don’t match.');
    try { await sapi('/api/ops/change-pin', { method: 'POST', body: { current: box.querySelector('#cpOld')?.value.trim() || '', pin } }); say('Your PIN is changed. Use it next time you sign in.', true); setTimeout(close, 1800); }
    catch (err) { say(err.message); }
  };
}

// The phone-number route at the gate: when the door asks for this staff member's code, it shows
// here, on their own dashboard (never by SMS). Checked every 6 seconds while the page is on screen.
function watchGate(el) {
  let gone = false;
  const check = async () => {
    if (gone || document.visibilityState !== 'visible') return;
    try {
      const d = await sapi('/api/members/my-gate');
      if (!d.gate) { el.hidden = true; return; }
      const secs = Math.max(0, Math.round((new Date(d.gate.expiresAt).getTime() - Date.now()) / 1000));
      if (el.hidden) navigator.vibrate?.([120, 60, 120]);
      el.hidden = false;
      el.innerHTML = `<span>Gate code: say it to the door</span><b>${esc(d.gate.code.replace(/(\d{3})(\d{3})/, '$1 $2'))}</b><small>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</small>`;
    } catch (e) { if (e.status === 404 || e.status === 401 || e.status === 403) gone = true; }
  };
  check(); setInterval(check, 6000);
  document.addEventListener('visibilitychange', check);
}

// Flyers: resized in the browser (max 1600px, WebP/JPEG) before upload, so the public site
// never serves a 6 MB phone photo over mobile data.
export async function compressImage(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use a JPG, PNG or WEBP image.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', .82)) || await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
  if (blob.size > 8 * 1024 * 1024) throw new Error('That image is still over 8 MB after resizing.');
  return blob;
}
// A night's ticket colours, taken from its flyer at upload (the file is still local, so no CORS):
// the most vivid common hue becomes the accent, with a near-black and a pale tint of the same hue.
// Returns null for a flyer with no real colour (black and white), so the night keeps its palette.
export async function paletteFrom(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, 48, 48);
  const px = ctx.getImageData(0, 0, 48, 48).data;
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (d < 0.12 || l < 0.12 || l > 0.9) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
    const w = s * s * (1 - Math.abs(l - 0.5) * 1.6), bin = bins[Math.floor(h / 15)];
    bin.w += w; bin.r += px[i] * w; bin.g += px[i + 1] * w; bin.b += px[i + 2] * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < 4) return null;
  const rgb = [best.r, best.g, best.b].map(v => v / best.w);
  const [h, s0] = hsl(rgb);
  const s = Math.max(0.55, s0);
  return { accent: hex(fromHsl(h, s, 0.55)), dark: hex(fromHsl(h, Math.min(s, 0.5), 0.08)), light: hex(fromHsl(h, Math.min(s, 0.4), 0.92)) };
}
function hsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min; if (!d) return [0, 0, l]; const s = d / (1 - Math.abs(2 * l - 1)); let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, s, l]; }
function fromHsl(h, s, l) { const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return [0, 8, 4].map(n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); }
const hex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const ghs = p => (p === null || p === undefined || p === '' ? '' : (Number(p) / 100).toString());
export { pes } from './lib/shared.js'; // strict: throws on anything that isn't an amount
export const when = d => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
