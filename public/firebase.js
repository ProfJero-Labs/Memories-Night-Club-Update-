// Staff pages only. The public site never loads Firebase: it talks to the Worker API.
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

const cfg = window.MEMORIES_CONFIG?.firebase;
const app = getApps()[0] || initializeApp(cfg);
const auth = getAuth(app);

const wrap = async u => (u ? { uid: u.uid, email: u.email, claims: (await u.getIdTokenResult()).claims } : null);
export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password).then(c => wrap(c.user));
export const signOutUser = () => signOut(auth);
export const resetPassword = email => sendPasswordResetEmail(auth, email);
export const onUser = cb => onAuthStateChanged(auth, async u => cb(await wrap(u)));
export const idToken = () => auth.currentUser?.getIdToken() || null;

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