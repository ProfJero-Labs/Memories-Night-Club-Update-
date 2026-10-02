// Shared by the staff pages (admin, organiser, door). Auth is Firebase; every action is a Worker
// call carrying the Firebase ID token, and the Worker checks the role on every request.
import { onUser, idToken, signOutUser } from './firebase.js';
import { api, esc } from './app.js';

export const roleOf = claims => (claims?.admin === true ? 'superAdmin' : claims?.role || '');
export const ROLE_LABEL = { superAdmin: 'Super admin', manager: 'Manager', eventManager: 'Event manager', doorStaff: 'Door', barStaff: 'Bar', organiser: 'Organiser' };
export const home = role => (role === 'organiser' ? 'organiser.html' : role === 'doorStaff' ? 'checkin.html' : role === 'barStaff' ? 'bar.html' : 'admin.html');

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
  h.innerHTML = `<div class="wrap"><a class="logo" href="index.html" title="Public site"><img src="assets/logo-sm.webp" alt="Memories" height="18"></a>
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
