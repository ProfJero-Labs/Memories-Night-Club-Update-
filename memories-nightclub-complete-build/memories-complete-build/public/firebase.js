import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

const cfg = window.MEMORIES_CONFIG?.firebase;
if (!cfg) throw new Error('MEMORIES_CONFIG.firebase missing in config.js');

const app = getApps().length ? getApps()[0] : initializeApp(cfg);

export const auth = getAuth(app);
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };