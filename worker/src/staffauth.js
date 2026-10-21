// Staff sign in with their phone number and a PIN (4 numbers; 6 for manager, director, finance and
// admin). The Worker checks the PIN and hands back a Firebase custom token, so every staff screen
// keeps using Firebase sign-in and the Worker's usual token check.
//
//   New staff: a manager adds them (name, phone, job). The system picks their starting PIN, texts
//   it to them and shows it to the manager once (in case the text doesn't arrive). They sign in
//   with it straight away and can change it any time (name button → Change my PIN).
//   Forgot PIN: "Text me a new PIN" sends one that works for 30 minutes; the old PIN keeps working
//   until the new one is used (so nobody can lock someone out by asking). Or a manager taps
//   "Send a new PIN".
//   Wrong PINs: 5 in a row locks the PIN for 15 minutes; 10 locks it until a new PIN is sent.
//   Staff are full-time: a session lasts until they sign out, every night.
//
// Staff records: users/{uid}
//   name, phone, email?, role, admin, removed, pinHash, pinSalt, pinSetAt, pinStarter (still the
//   PIN that was texted), pinFails, lockedUntil, pinLocked, tempPinHash, tempPinSalt,
//   tempPinExpires, pinSentAt, lastSignInAt, addedBy, updatedAt
import { getDoc, setDoc, queryWhere, listDocs, signServiceJwt, googleAccessToken } from './lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone, firstName } from './lib/util.js';
import { requireRole, STAFF_ROLES, STAFF_ADMIN, canAssign, pinLength, uidOf, forgetStaffRecord } from './lib/auth.js';
import { sendSms, siteUrl } from './lib/notify.js';
import { securitySignal } from './lib/monitor.js';
import { ensureStaffMember, suspendStaffMember } from './members.js';

const FORBIDDEN = { error: 'You can’t do that with your role.', status: 403 };
export const ROLE_NAMES = { superAdmin: 'System admin', director: 'Director', manager: 'Manager', finance: 'Finance officer', eventManager: 'Events manager', doorStaff: 'Front office', security: 'Security', barStaff: 'Bartender', waitStaff: 'Waiter / waitress', cashier: 'Cashier', organiser: 'Organiser' };
const TEMP_PIN_MS = 30 * 60e3, LOCK_MS = 15 * 60e3;
const SIGN_IN_FAIL = 'That phone number and PIN don’t match.';
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user) || null, ...data, timestamp: now() });

// ── PINs ──
async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g), h => parseInt(h, 16));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
// A PIN people can remember, but not one anyone would guess first.
export function pinProblem(pin, role) {
  const n = pinLength(role), p = String(pin || '');
  if (!new RegExp(`^\\d{${n}}$`).test(p)) return `Your PIN is ${n} numbers.`;
  if (/^(\d)\1+$/.test(p)) return 'Don’t use the same number for every digit.';
  const up = '01234567890123456789', down = '98765432109876543210';
  if (up.includes(p) || down.includes(p)) return 'Don’t use numbers in a row like 1234.';
  return '';
}
// A starting PIN the system picks: random, and never one pinProblem would refuse.
export function starterPin(role) {
  const n = pinLength(role);
  for (;;) {
    const p = [...crypto.getRandomValues(new Uint32Array(n))].map(x => x % 10).join('');
    if (!pinProblem(p, role)) return p;
  }
}
async function pinFields(pin) { const salt = newSalt(); return { pinSalt: salt, pinHash: await hashPin(pin, salt) }; }
const sameTime = (a, b) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

// ── The Firebase custom token a signed-in staff member's phone exchanges for a session ──
async function customToken(env, uid, role) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const t = Math.floor(Date.now() / 1000);
  return signServiceJwt(env, {
    iss: sa.client_email, sub: sa.client_email, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: t, exp: t + 3600, uid, claims: { role, admin: role === 'superAdmin' },
  });
}
// Sessions already open on other phones stop when a role changes or someone is removed.
async function revokeSessions(env, uid) {
  try {
    const token = await googleAccessToken(env, 'https://www.googleapis.com/auth/identitytoolkit');
    await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: uid, validSince: String(Math.floor(Date.now() / 1000)) }) });
  } catch { /* a phone-only account that never signed in has no Firebase session to revoke */ }
}

async function staffByPhone(env, phone) {
  const ph = normalizePhone(phone); if (!ph) return null;
  return (await queryWhere(env, 'users', [{ field: 'phone', value: ph }], { limit: 5 })).find(d => d.fields.removed !== true) || null;
}
const roleOfRecord = f => (f.admin === true ? 'superAdmin' : f.role);

// ── Sign in ──
export async function signInWithPin(env, { phone, pin }, ip) {
  const rec = await staffByPhone(env, phone);
  const f = rec?.fields, role = f && roleOfRecord(f);
  if (!rec || !STAFF_ROLES.includes(role)) { await securitySignal(env, 'staff_pin_failed', ip || 'unknown'); return { error: SIGN_IN_FAIL, status: 401 }; }
  const temp = f.tempPinHash && new Date(f.tempPinExpires).getTime() > Date.now();
  if (!f.pinHash && !temp) return { error: 'You don’t have a PIN yet. Tap “First time, or forgot your PIN?” and we’ll text you one.', status: 401, code: 'no_pin' };
  if (f.pinLocked === true && !temp) return { error: 'Your PIN is locked after too many wrong tries. Tap “First time, or forgot your PIN?” for a new one, or ask a manager.', status: 423, code: 'locked' };
  if (f.lockedUntil && new Date(f.lockedUntil).getTime() > Date.now()) return { error: 'Too many wrong PINs. Wait 15 minutes, or ask a manager to send you a new PIN.', status: 423, code: 'locked' };
  const p = String(pin || '');
  const usedTemp = temp && sameTime(await hashPin(p, f.tempPinSalt), f.tempPinHash);
  const ok = usedTemp || (f.pinHash && f.pinLocked !== true && sameTime(await hashPin(p, f.pinSalt), f.pinHash));
  if (!ok) {
    const fails = Number(f.pinFails || 0) + 1;
    await setDoc(env, 'users', rec.id, { ...f, pinFails: fails, lockedUntil: fails >= 5 ? new Date(Date.now() + LOCK_MS).toISOString() : f.lockedUntil || '', pinLocked: fails >= 10 });
    await securitySignal(env, 'staff_pin_failed', ip || 'unknown');
    return { error: fails >= 5 ? 'Too many wrong PINs. Wait 15 minutes, or ask a manager to send you a new PIN.' : SIGN_IN_FAIL, status: 401 };
  }
  // The texted PIN, once used, becomes their PIN.
  const pinNow = usedTemp ? { pinHash: f.tempPinHash, pinSalt: f.tempPinSalt, pinSetAt: now(), pinStarter: true, pinLocked: false, tempPinHash: '', tempPinSalt: '', tempPinExpires: '' } : {};
  await setDoc(env, 'users', rec.id, { ...f, ...pinNow, pinFails: 0, lockedUntil: '', lastSignInAt: now() });
  if (usedTemp) await audit(env, { uid: rec.id }, 'STAFF_PIN_SET', { targetUid: rec.id, how: 'texted' });
  return { token: await customToken(env, rec.id, role), role, name: f.name || '' };
}

// "First time, or forgot your PIN?": a new PIN by text to the phone on file, valid 30 minutes. Until
// it's used the old PIN still works, so asking for someone else's can't lock them out. Same reply
// whatever happens, so the page never says which numbers are staff.
const NEUTRAL = { sent: true, message: 'If that number belongs to Memories staff, a new PIN is on its way by text. Sign in with it.' };
export async function sendNewPin(env, { phone }) {
  const rec = await staffByPhone(env, phone);
  if (!rec || !STAFF_ROLES.includes(roleOfRecord(rec.fields))) return NEUTRAL;
  const f = rec.fields;
  if (f.pinSentAt && Date.now() - new Date(f.pinSentAt).getTime() < 60e3) return NEUTRAL; // one text a minute
  const pin = starterPin(roleOfRecord(f)), salt = newSalt();
  await setDoc(env, 'users', rec.id, { ...f, tempPinSalt: salt, tempPinHash: await hashPin(pin, salt), tempPinExpires: new Date(Date.now() + TEMP_PIN_MS).toISOString(), pinSentAt: now() });
  await sendSms(env, f.phone, `MEMORIES STAFF\nYour new PIN: ${pin}\nSign in at ${siteUrl(env, '/login.html')} with your phone number and this PIN within 30 minutes. You can change it after. Don’t share it.`);
  return NEUTRAL;
}

// Signed in: change my own PIN.
export async function changeMyPin(env, user, { current, pin }) {
  const rec = await getDoc(env, 'users', uidOf(user));
  if (!rec) return { error: 'Your staff record wasn’t found. Ask a manager.', status: 404 };
  const f = rec.fields, role = roleOfRecord(f);
  if (f.pinHash && !sameTime(await hashPin(String(current || ''), f.pinSalt), f.pinHash)) return { error: 'Your current PIN isn’t right.' };
  const problem = pinProblem(pin, role); if (problem) return { error: problem };
  const salt = newSalt();
  await setDoc(env, 'users', rec.id, { ...f, pinSalt: salt, pinHash: await hashPin(String(pin), salt), pinSetAt: now(), pinStarter: false, pinFails: 0, lockedUntil: '', pinLocked: false });
  await audit(env, user, 'STAFF_PIN_CHANGED', { targetUid: rec.id });
  return { changed: true };
}

export async function whoAmI(env, user) {
  const rec = await getDoc(env, 'users', uidOf(user));
  const f = rec?.fields || {}, role = user.role;
  return { uid: uidOf(user), name: f.name || user.name || '', phoneHint: f.phone ? maskPhone(f.phone) : '', role, roleName: ROLE_NAMES[role] || role, pinLength: pinLength(role), hasPin: !!f.pinHash, pinStarter: f.pinStarter === true, canCollectCash: f.canCollectCash === true || ['cashier', 'manager', 'director', 'superAdmin', 'waitStaff', 'barStaff'].includes(role) };
}

// ── Managers look after staff ──
const staffView = d => {
  const f = d.fields, role = roleOfRecord(f);
  return { uid: d.id, name: f.name || '', phone: f.phone || '', email: f.email || '', role, roleName: ROLE_NAMES[role] || role, removed: f.removed === true, hasPin: !!f.pinHash, pinStarter: f.pinStarter === true, locked: f.pinLocked === true || (f.lockedUntil && new Date(f.lockedUntil).getTime() > Date.now()), lastSignInAt: f.lastSignInAt || '', canCollectCash: f.canCollectCash === true };
};
export async function listStaffPeople(env, user) {
  if (!requireRole(user, STAFF_ADMIN)) return FORBIDDEN;
  const all = (await listDocs(env, 'users')).map(staffView).filter(s => !s.removed && STAFF_ROLES.includes(s.role));
  return { staff: all.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)), roles: STAFF_ROLES.filter(r => canAssign(user.role, r)).map(r => ({ id: r, name: ROLE_NAMES[r] })) };
}

function pinText(env, name, role, pin, again = false) {
  return `MEMORIES STAFF\nHi ${firstName(name)}, ${again ? 'here is your new PIN' : `you’re on the Memories team as ${ROLE_NAMES[role]}`}.\nSign in at ${siteUrl(env, '/login.html')}\nPhone: your number\nPIN: ${pin}\nYou can change your PIN after signing in (tap your name). Don’t share it.`;
}
// Gives someone a fresh starting PIN (replacing any old one), texts it, and returns it once for
// the manager's screen. The PIN itself is never stored, only its hash.
async function giveStarterPin(env, rec, user, again) {
  const f = rec.fields, role = roleOfRecord(f), pin = starterPin(role);
  await setDoc(env, 'users', rec.id, { ...f, ...(await pinFields(pin)), pinSetAt: now(), pinStarter: true, pinFails: 0, lockedUntil: '', pinLocked: false, tempPinHash: '', tempPinSalt: '', tempPinExpires: '', updatedAt: now() });
  const texted = f.phone ? await sendSms(env, f.phone, pinText(env, f.name, role, pin, again)) : false;
  await audit(env, user, again ? 'STAFF_PIN_RESET' : 'STAFF_PIN_SENT', { targetUid: rec.id });
  return { pin, texted, phoneHint: f.phone ? maskPhone(f.phone) : '', name: f.name || '' };
}

export async function addStaffPerson(env, b, user) {
  if (!requireRole(user, STAFF_ADMIN)) return FORBIDDEN;
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone), role = String(b?.role || '');
  if (!name) return { error: 'Add their name.' };
  if (!phone) return { error: 'Add their phone number, e.g. 024 123 4567. They sign in with it.' };
  if (!STAFF_ROLES.includes(role)) return { error: 'Pick their job.' };
  if (!canAssign(user.role, role)) return { error: `Your role can’t add a ${ROLE_NAMES[role]}. Ask a director or the system admin.`, status: 403 };
  const clash = await staffByPhone(env, phone);
  if (clash) return { error: `${clash.fields.name || clash.fields.email || 'Someone'} already uses that phone number.` };
  const uid = `st${id().slice(0, 24)}`;
  const fields = { name, phone, email: clean(b.email, 120).toLowerCase(), role, admin: role === 'superAdmin', removed: false, canCollectCash: b.canCollectCash === true, addedBy: uidOf(user), createdAt: now(), updatedAt: now() };
  await setDoc(env, 'users', uid, fields);
  await ensureStaffMember(env, { uid, name, phone, role }, user);
  await audit(env, user, 'STAFF_ADDED', { targetUid: uid, role, name });
  return { uid, ...(await giveStarterPin(env, { id: uid, fields }, user, false)) };
}

export async function updateStaffPerson(env, b, user) {
  if (!requireRole(user, STAFF_ADMIN)) return FORBIDDEN;
  const rec = await getDoc(env, 'users', String(b?.uid || ''));
  if (!rec || rec.fields.removed === true) return { error: 'Staff member not found.', status: 404 };
  const f = rec.fields, oldRole = roleOfRecord(f);
  if (!canAssign(user.role, oldRole)) return { error: `Your role can’t change a ${ROLE_NAMES[oldRole]}.`, status: 403 };
  const role = b.role ? String(b.role) : oldRole;
  if (!STAFF_ROLES.includes(role) || !canAssign(user.role, role)) return { error: `Your role can’t make someone a ${ROLE_NAMES[role] || role}.`, status: 403 };
  if (rec.id === uidOf(user) && role !== oldRole) return { error: 'Ask another manager to change your own job.' };
  const name = b.name !== undefined ? clean(b.name, 80) : f.name;
  const phone = b.phone !== undefined ? normalizePhone(b.phone) : f.phone;
  if (!name) return { error: 'Add their name.' };
  if (b.phone !== undefined && !phone) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  if (phone && phone !== f.phone) { const clash = await staffByPhone(env, phone); if (clash && clash.id !== rec.id) return { error: `${clash.fields.name || 'Someone'} already uses that phone number.` }; }
  await setDoc(env, 'users', rec.id, { ...f, name, phone, role, admin: role === 'superAdmin', canCollectCash: b.canCollectCash === undefined ? f.canCollectCash === true : b.canCollectCash === true, updatedAt: now() });
  forgetStaffRecord(env, rec.id);
  if (role !== oldRole) { await revokeSessions(env, rec.id); await ensureStaffMember(env, { uid: rec.id, name, phone, role }, user); }
  await audit(env, user, 'STAFF_UPDATED', { targetUid: rec.id, from: oldRole, role, name });
  return { uid: rec.id, role };
}

export async function resetStaffPin(env, b, user) {
  if (!requireRole(user, STAFF_ADMIN)) return FORBIDDEN;
  const rec = await getDoc(env, 'users', String(b?.uid || ''));
  if (!rec || rec.fields.removed === true) return { error: 'Staff member not found.', status: 404 };
  const f = rec.fields, role = roleOfRecord(f);
  if (!canAssign(user.role, role)) return { error: `Your role can’t reset a ${ROLE_NAMES[role]}’s PIN.`, status: 403 };
  if (!f.phone) return { error: 'Add their phone number first.' };
  const out = await giveStarterPin(env, rec, user, !!f.pinHash);
  forgetStaffRecord(env, rec.id);
  if (f.pinHash) await revokeSessions(env, rec.id);
  return out;
}

// "Text PINs to everyone": every current staff member with a phone and no PIN yet (e.g. staff
// added before PIN sign-in) gets a starting PIN. Staff who already have a PIN are left alone.
export async function sendStarterPins(env, user) {
  if (!requireRole(user, STAFF_ADMIN)) return FORBIDDEN;
  const sent = [], skipped = [];
  for (const d of await listDocs(env, 'users')) {
    const f = d.fields, role = roleOfRecord(f);
    if (f.removed === true || !STAFF_ROLES.includes(role) || f.pinHash || d.id === uidOf(user)) continue;
    if (!f.phone) { skipped.push({ name: f.name || f.email || d.id, why: 'no phone number' }); continue; }
    if (!canAssign(user.role, role)) { skipped.push({ name: f.name || f.email || d.id, why: `a ${ROLE_NAMES[role]} needs a director` }); continue; }
    sent.push(await giveStarterPin(env, d, user, false));
  }
  return { sent, skipped };
}

export async function removeStaffPerson(env, b, user) {
  if (!requireRole(user, STAFF_ADMIN)) return FORBIDDEN;
  const rec = await getDoc(env, 'users', String(b?.uid || ''));
  if (!rec || rec.fields.removed === true) return { error: 'Staff member not found.', status: 404 };
  const role = roleOfRecord(rec.fields);
  if (rec.id === uidOf(user)) return { error: 'You can’t remove yourself.' };
  if (!canAssign(user.role, role)) return { error: `Your role can’t remove a ${ROLE_NAMES[role]}.`, status: 403 };
  // Kept (marked removed) so their past work still shows who did it; access stops at once.
  await setDoc(env, 'users', rec.id, { ...rec.fields, removed: true, removedAt: now(), removedBy: uidOf(user), pinHash: '', tempPinHash: '', updatedAt: now() });
  forgetStaffRecord(env, rec.id);
  await revokeSessions(env, rec.id);
  await suspendStaffMember(env, rec.id);
  await audit(env, user, 'STAFF_REMOVED', { targetUid: rec.id, role, name: rec.fields.name || rec.fields.email || '' });
  return { removed: true };
}
