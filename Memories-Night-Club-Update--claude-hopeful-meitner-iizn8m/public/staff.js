// Shared by the staff pages (admin, organiser, door). Auth is Firebase; every action is a Worker
// call carrying the Firebase ID token, and the Worker checks the role on every request.
import { onUser, idToken, signOutUser } from './firebase.js';
import { api, esc } from './app.js';

export const roleOf = claims => (claims?.admin === true ? 'superAdmin' : claims?.role || '');
export const ROLE_LABEL = { superAdmin: 'Super admin', manager: 'Manager', eventManager: 'Event manager', doorStaff: 'Door', organiser: 'Organiser' };
export const home = role => (role === 'organiser' ? 'organiser.html' : role === 'doorStaff' ? 'checkin.html' : 'admin.html');

// Resolves with the signed-in staff user, or sends them to the right place.
export function requireStaff(allowed) {
  return new Promise(resolve => {
    let done = false;
    onUser(u => {
      if (done) return;
      if (!u) { location.replace(`login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`); return; }
      const role = roleOf(u.claims);
      if (!role) { signOutUser().then(() => location.replace('login.html?denied=1')); return; }
      if (!allowed.includes(role)) { location.replace(home(role)); return; }
      done = true; resolve({ ...u, role });
    });
  });
}

export const sapi = async (path, opts = {}) => api(path, { ...opts, token: await idToken() });

export function staffHeader(user, title) {
  const h = document.createElement('header');
  h.className = 'staff-head';
  h.innerHTML = `<div class="wrap"><a class="logo" href="index.html" title="Public site"><img src="assets/logo.png" alt="Memories" height="18"></a>
    <strong style="font:400 20px var(--display);text-transform:uppercase;letter-spacing:.04em">${esc(title)}</strong>
    <span class="who">${esc(user.email || '')}<br>${esc(ROLE_LABEL[user.role] || user.role)}</span><button type="button" id="signout">Sign out</button></div>`;
  document.body.prepend(h);
  h.querySelector('#signout').onclick = () => signOutUser().then(() => location.replace('login.html'));
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
export const ghs = p => (p === null || p === undefined || p === '' ? '' : (Number(p) / 100).toString());
export const pes = v => Math.round(Number(String(v).replace(/[^\d.]/g, '')) * 100);
export const when = d => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
