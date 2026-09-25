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

// Flyers and hero images go to Firebase Storage (event-art/), which only site staff can write.
export async function uploadImage(blob, name) {
  const { getStorage, ref, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js');
  const r = ref(getStorage(app), `event-art/${Date.now()}-${name.replace(/[^a-z0-9.-]/gi, '_')}`);
  await uploadBytes(r, blob, { contentType: blob.type, cacheControl: 'public, max-age=31536000' });
  return getDownloadURL(r);
}
