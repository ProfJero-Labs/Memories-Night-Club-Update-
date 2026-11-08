// Staff pages only. The public site never loads Firebase: it talks to the Worker API.
//
// Two kinds of staff session, and the pages don't need to know which:
//   - Our own (the Worker runs on Supabase): after phone + PIN the Worker returns a signed token, kept in
//     this phone's storage. The page asks for a fresh one now and then (POST /api/ops/session) so a phone
//     in daily use stays signed in until the person signs out.
//   - Firebase's (until the move off Firebase is finished): the Firebase sign-in code is loaded only when
//     there is no session of ours, so on Supabase nothing from Firebase is ever downloaded.
const KEY = 'mem-staff-session';
const listeners = new Set();

const decode = token => { try { return JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; } };
const readOwn = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null'), p = s?.token && decode(s.token);
    return p && p.exp * 1000 > Date.now() ? { token: s.token, p } : null;
  } catch { return null; }
};
const ownUser = s => ({ uid: s.p.uid || s.p.sub, email: '', claims: { role: s.p.role, admin: s.p.admin === true } });
const clearOwn = () => { try { localStorage.removeItem(KEY); } catch { /* private mode */ } };

// Firebase, loaded on first need.
let fbp;
const fb = () => (fbp ||= (async () => {
  const cfg = window.MEMORIES_CONFIG?.firebase;
  if (!cfg) return null;
  const [{ initializeApp, getApps }, A] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js'),
  ]);
  return { A, auth: A.getAuth(getApps()[0] || initializeApp(cfg)) };
})());
const wrapFb = async u => (u ? { uid: u.uid, email: u.email, claims: (await u.getIdTokenResult()).claims } : null);
const emailOff = () => Object.assign(new Error('Email sign-in is switched off. Use your phone number and PIN.'), { code: 'auth/off' });
const tell = async () => { const u = await current(); for (const cb of listeners) cb(u); };
async function current() {
  const own = readOwn(); if (own) return ownUser(own);
  const f = fbp ? await fbp.catch(() => null) : null; // Firebase only if this page already loaded it
  return f ? wrapFb(f.auth.currentUser) : null;
}

export const signIn = async (email, password) => {
  const f = await fb(); if (!f) throw emailOff();
  return f.A.signInWithEmailAndPassword(f.auth, email, password).then(c => wrapFb(c.user));
};
// Phone + PIN: the Worker checked the PIN and returned a token (own: true = ours, kept here; otherwise a
// Firebase custom token, exchanged for a Firebase session).
export const signInWithToken = async (token, own = false) => {
  if (own) { try { localStorage.setItem(KEY, JSON.stringify({ token })); } catch { /* private mode */ } const s = readOwn(); if (!s) throw new Error('That sign-in token is not valid.'); await tell(); return ownUser(s); }
  const f = await fb(); if (!f) throw emailOff();
  return f.A.signInWithCustomToken(f.auth, token).then(c => wrapFb(c.user));
};
export const signOutUser = async () => {
  clearOwn();
  const f = fbp ? await fbp.catch(() => null) : null;
  if (f) await f.A.signOut(f.auth);
  await tell();
};
export const resetPassword = async email => { const f = await fb(); if (!f) return; return f.A.sendPasswordResetEmail(f.auth, email); };
export const onUser = cb => {
  listeners.add(cb);
  const own = readOwn();
  if (own) { setTimeout(() => cb(ownUser(own)), 0); return; }
  fb().then(f => (f ? f.A.onAuthStateChanged(f.auth, async u => { if (!readOwn()) cb(await wrapFb(u)); }) : cb(null))).catch(() => cb(null));
};
export const idToken = async () => {
  const own = readOwn();
  if (!own) { const f = await fb().catch(() => null); return f?.auth.currentUser?.getIdToken() || null; }
  // Older than a day: ask for a fresh one (a refused token means the session is over).
  if (Date.now() / 1000 - own.p.iat > 86400) {
    try {
      const r = await fetch(`${window.MEMORIES_CONFIG?.apiBase || ''}/api/ops/session`, { method: 'POST', headers: { Authorization: `Bearer ${own.token}`, 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.token) { try { localStorage.setItem(KEY, JSON.stringify({ token: d.token })); } catch { /* private mode */ } return d.token; }
      if (r.status === 401) { clearOwn(); return null; }
    } catch { /* offline: keep the one we have */ }
  }
  return own.token;
};

// Flyers, hero images and videos go to Cloudinary via an unsigned upload preset. The preset is
// what restricts uploads (folder, formats, size), not a secret, so nothing here needs hiding.
const CLOUDINARY_CLOUD = 'qyanrba2';
const CLOUDINARY_PRESET = 'memories-night-club';

export async function uploadImage(blob, _name) {
  const fd = new FormData();
  fd.append('file', blob);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/auto/upload`, {
    method: 'POST',
    body: fd,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.secure_url) {
    throw new Error(d.error?.message || 'Upload failed.');
  }
  return d.secure_url;
}