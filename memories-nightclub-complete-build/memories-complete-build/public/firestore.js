import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore,
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, runTransaction, serverTimestamp,
  increment, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const cfg = window.MEMORIES_CONFIG?.firebase;
if (!cfg) throw new Error('MEMORIES_CONFIG.firebase missing in config.js');

const app = getApps().length ? getApps()[0] : initializeApp(cfg);

export const db = getFirestore(app);

export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, runTransaction, serverTimestamp,
  increment, arrayUnion, arrayRemove,
};