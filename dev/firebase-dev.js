// Local stand-in for public/firebase.js (same exports), served only by dev/server.mjs.
let current = JSON.parse(sessionStorage.getItem('dev-user') || 'null');
const listeners = [];
const emit = () => listeners.forEach(cb => cb(current && { uid: current.uid, email: current.email, claims: current.claims }));
export async function signIn(email, password) {
  const r = await fetch('/dev/token', { method: 'POST', body: JSON.stringify({ email, password }) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error('auth'), { code: d.code });
  current = d; sessionStorage.setItem('dev-user', JSON.stringify(d)); emit();
  return { uid: d.uid, email: d.email, claims: d.claims };
}
export const signOutUser = async () => { current = null; sessionStorage.removeItem('dev-user'); emit(); };
export const resetPassword = async () => {};
export const onUser = cb => { listeners.push(cb); setTimeout(() => cb(current && { uid: current.uid, email: current.email, claims: current.claims }), 0); };
export const idToken = async () => current?.token || null;
export async function uploadImage(blob) { const r = await fetch('/dev/upload', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }); return (await r.json()).url; }
