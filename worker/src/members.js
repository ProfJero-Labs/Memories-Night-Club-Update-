// Membership: staff and other members get in without a ticket, but only after the door verifies
// them. Two ways at the gate:
//   1. The member pass (public/member.html, installable): a QR that changes every 30 seconds,
//      signed with a secret only that phone and this Worker hold, so a screenshot dies in a minute.
//   2. Phone + texted code: the door types the member's phone, we text the member a 6-digit code,
//      the member says it, the door enters it.
// Every verified entry is recorded (member_entries): that is the HR attendance log.
//
// Collections (server only; Firestore rules deny browsers):
//   members/{id}          name, phone, type staff|member, department, position, staffNo, status, validUntil
//   member_passes/{id}    memberId, secret (HMAC key for the rotating QR), createdAt, revokedAt
//   member_codes/{key}    hashed 6-digit codes: pass sign-in (pass_{phone}) and gate (door_{phone})
//   member_entries/{id}   memberId, name, type, department, at, by, method pass|code, night
import { getDoc, setDoc, createDoc, deleteDoc, listDocs, queryWhere, queryRecent } from './lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone, firstName, sixDigits, sha256Hex, nightKey } from './lib/util.js';
import { requireRole, MONEY, uidOf } from './lib/auth.js';
import { sendSms, siteUrl } from './lib/notify.js';
import { securitySignal } from './lib/monitor.js';

const FORBIDDEN = { error: 'Forbidden.', status: 403 };
// Who may verify members at the gate. Organisers run their own nights' doors only, not the club's staff.
export const MEMBER_DOOR = ['superAdmin', 'manager', 'eventManager', 'doorStaff'];
export const MEMBER_TYPES = ['staff', 'member'];
const STEP_S = 30;                  // the pass QR changes every 30 seconds
const STEPS_ACCEPTED = 2;           // and is accepted for the current and the 2 previous steps (60–90 s)
const CODE_TTL_MS = 5 * 60_000, CODE_TRIES = 5, PASS_CODE_TTL_MS = 10 * 60_000;
const MAX_PASSES = 3;               // phones per member; signing in on a 4th retires the oldest
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user), ...data, timestamp: now() });

// ── Validity ──
const expired = m => m.validUntil && new Date(`${m.validUntil}T23:59:59Z`).getTime() < Date.now();
function standing(m) {
  if (!m) return { ok: false, code: 'not_member', message: 'NOT A MEMBER' };
  if (m.status !== 'active') return { ok: false, code: 'suspended', message: 'MEMBERSHIP SUSPENDED' };
  if (expired(m)) return { ok: false, code: 'expired', message: 'MEMBERSHIP EXPIRED' };
  return { ok: true };
}
// What the door and the pass may show about a member. Never the phone (masked), never notes.
export const memberCard = (mid, m) => ({
  id: mid, name: m.name, firstName: firstName(m.name), type: m.type, department: m.department || '', position: m.position || '',
  staffNo: m.staffNo || '', validUntil: m.validUntil || '', phoneHint: maskPhone(m.phone), status: m.status,
});
async function memberByPhone(env, phone) {
  const hit = (await queryWhere(env, 'members', [{ field: 'phone', value: phone }], { limit: 1 }))[0];
  return hit ? { id: hit.id, m: hit.fields } : null;
}

// ── Control room: People ──
export async function listMembers(env, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const docs = await listDocs(env, 'members');
  return { members: docs.map(d => ({ ...memberCard(d.id, d.fields), phone: d.fields.phone, notes: d.fields.notes || '', createdAt: d.fields.createdAt || '' })).sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function upsertMember(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone);
  const type = MEMBER_TYPES.includes(b?.type) ? b.type : 'member';
  const status = b?.status === 'suspended' ? 'suspended' : 'active';
  const validUntil = b?.validUntil ? (/^\d{4}-\d{2}-\d{2}$/.test(b.validUntil) ? b.validUntil : null) : '';
  if (!name) return { error: 'Add their name.' };
  if (!phone) return { error: 'Add a Ghana phone number, e.g. 024 123 4567. It’s how they’re checked at the gate.' };
  if (validUntil === null) return { error: 'Pick a valid end date, or leave it blank.' };
  const existing = b.id ? await getDoc(env, 'members', String(b.id)) : null;
  if (b.id && !existing) return { error: 'Member not found.', status: 404 };
  const clash = await memberByPhone(env, phone);
  if (clash && clash.id !== existing?.id) return { error: `${clash.m.name} already has that number.` };
  const mid = existing?.id || id();
  const data = {
    ...(existing?.fields || {}), name, phone, type, status, validUntil,
    department: clean(b.department, 60), position: clean(b.position, 60), staffNo: clean(b.staffNo, 30), notes: clean(b.notes, 300),
    updatedAt: now(), updatedBy: uidOf(user), createdAt: existing?.fields?.createdAt || now(), createdBy: existing?.fields?.createdBy || uidOf(user),
  };
  await setDoc(env, 'members', mid, data);
  // Suspending, or changing the phone, retires every pass already on a phone.
  if (existing && (status !== 'active' || existing.fields.phone !== phone)) await revokePasses(env, mid);
  await audit(env, user, existing ? 'MEMBER_UPDATED' : 'MEMBER_ADDED', { memberId: mid, type, status, from: existing?.fields?.status || null });
  let texted = false;
  if (!existing || b.resendInvite === true) {
    texted = await sendSms(env, phone, `MEMORIES\n${firstName(name)}, you're on the Memories ${type === 'staff' ? 'staff' : 'members'} list. Get your gate pass: ${siteUrl(env, '/member.html')}\nAt the gate, show the pass or give this number.`);
  }
  return { id: mid, texted };
}

async function revokePasses(env, memberId) {
  for (const p of await queryWhere(env, 'member_passes', [{ field: 'memberId', value: memberId }])) {
    if (!p.fields.revokedAt) await setDoc(env, 'member_passes', p.id, { ...p.fields, revokedAt: now() });
  }
}

// HR attendance: verified gate entries, newest first, for the last `days`.
export async function attendance(env, { days = 30, memberId } = {}, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const d = Math.min(366, Math.max(1, Number(days) || 30));
  let entries = (await queryRecent(env, 'member_entries', 'at', new Date(Date.now() - d * 864e5), 5000)).map(e => ({ id: e.id, ...e.fields }));
  if (memberId) entries = entries.filter(e => e.memberId === memberId);
  // Per person: nights present (a night runs to 04:00, see nightKey), first and last seen.
  const people = new Map();
  for (const e of entries) {
    const p = people.get(e.memberId) || { memberId: e.memberId, name: e.name, type: e.type, department: e.department || '', nights: new Set(), last: e.at };
    p.nights.add(e.night); people.set(e.memberId, p);
  }
  return {
    days: d,
    entries: entries.slice(0, 500).map(e => ({ at: e.at, memberId: e.memberId, name: e.name, type: e.type, department: e.department || '', method: e.method, night: e.night, byEmail: e.byEmail || '' })),
    people: [...people.values()].map(p => ({ ...p, nights: p.nights.size })).sort((a, b) => b.nights - a.nights || a.name.localeCompare(b.name)),
  };
}

// ── The member's own pass (public, phone-proven) ──
export const NEUTRAL_PASS_CODE = 'If that number is on our list, we’ve texted it a 6-digit code.';
export async function startPassSignIn(env, { phone }) {
  const ph = normalizePhone(phone); if (!ph) return false;
  const hit = await memberByPhone(env, ph);
  if (!hit || !standing(hit.m).ok) return false;
  const code = sixDigits();
  await setDoc(env, 'member_codes', `pass_${ph}`, { codeHash: await sha256Hex(`pass:${ph}:${code}`), memberId: hit.id, attempts: 0, expiresAt: new Date(Date.now() + PASS_CODE_TTL_MS).toISOString() });
  return sendSms(env, ph, `MEMORIES\nYour pass code: ${code}\nEnter it in the Memories pass to sign in. It expires in 10 minutes. Never share it.`);
}

async function checkCode(env, key, salt, code, ip) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return { error: 'Enter the 6-digit code.' };
  const s = await getDoc(env, 'member_codes', key);
  if (!s || new Date(s.fields.expiresAt).getTime() < Date.now()) { if (s) await deleteDoc(env, 'member_codes', key).catch(() => {}); return { error: 'That code has expired. Send a new one.', code: 'expired_code' }; }
  if ((await sha256Hex(`${salt}:${c}`)) !== s.fields.codeHash) {
    await securitySignal(env, 'member_code_guessing', ip || 'unknown');
    const attempts = Number(s.fields.attempts || 0) + 1;
    if (attempts >= CODE_TRIES) { await deleteDoc(env, 'member_codes', key).catch(() => {}); return { error: 'Too many wrong codes. Send a new one.', code: 'wrong_code' }; }
    await setDoc(env, 'member_codes', key, { ...s.fields, attempts });
    return { error: 'That code is wrong. Check the text and try again.', code: 'wrong_code' };
  }
  await deleteDoc(env, 'member_codes', key).catch(() => {});
  return { memberId: s.fields.memberId };
}

export async function finishPassSignIn(env, { phone, code, device }, ip) {
  const ph = normalizePhone(phone); if (!ph) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  const r = await checkCode(env, `pass_${ph}`, `pass:${ph}`, code, ip); if (r.error) return r;
  const m = await getDoc(env, 'members', r.memberId);
  const st = standing(m?.fields); if (!st.ok) return { error: 'This membership isn’t active. Talk to the manager.' };
  // One pass per phone; keep the newest few.
  const live = (await queryWhere(env, 'member_passes', [{ field: 'memberId', value: m.id }])).filter(p => !p.fields.revokedAt)
    .sort((a, b) => new Date(a.fields.createdAt) - new Date(b.fields.createdAt));
  for (const old of live.slice(0, Math.max(0, live.length - (MAX_PASSES - 1)))) await setDoc(env, 'member_passes', old.id, { ...old.fields, revokedAt: now() });
  const passId = id(), secret = id() + id();
  await createDoc(env, 'member_passes', passId, { memberId: m.id, secret, device: clean(device, 60), createdAt: now() });
  // serverTime lets the pass correct a phone whose clock is off (common), so its codes line up.
  return { passId, secret, stepSeconds: STEP_S, serverTime: Date.now(), member: memberCard(m.id, m.fields) };
}

// ── The rotating QR ──
// Payload: MP1.{passId}.{step}.{sig}  where sig = base64url(HMAC-SHA256(secret, `${passId}.${step}`))[0..16]
// The pass computes it on the phone (works offline); the Worker recomputes it here.
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function passSig(secret, passId, step) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${passId}.${step}`))).slice(0, 16);
}
const sameText = (a, b) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

async function readPass(env, payload) {
  const m = /^MP1\.([0-9a-f]{32})\.(\d{1,12})\.([A-Za-z0-9_-]{16})$/.exec(String(payload || '').trim());
  if (!m) return { error: 'not_pass' };
  const [, passId, stepStr, sig] = m, step = Number(stepStr), nowStep = Math.floor(Date.now() / 1000 / STEP_S);
  const p = await getDoc(env, 'member_passes', passId);
  if (!p || p.fields.revokedAt) return { error: 'revoked' };
  if (step > nowStep + 1 || step < nowStep - STEPS_ACCEPTED) return { error: 'stale', memberId: p.fields.memberId };
  if (!sameText(await passSig(p.fields.secret, passId, step), sig)) return { error: 'bad_sig' };
  return { pass: p };
}

// The pass checking itself when online (is it still valid? last gate check?). Auth = a fresh QR.
export async function passStatus(env, payload) {
  const r = await readPass(env, payload);
  // A code from a skewed clock isn't a bad pass: send the time so the phone can correct itself.
  if (r.error === 'stale') return { valid: true, reason: 'clock', serverTime: Date.now() };
  if (r.error) return { valid: false, reason: r.error, serverTime: Date.now() };
  const m = await getDoc(env, 'members', r.pass.fields.memberId);
  const st = standing(m?.fields);
  const lastEntry = (await queryWhere(env, 'member_entries', [{ field: 'memberId', value: r.pass.fields.memberId }], { limit: 200 }))
    .map(e => e.fields.at).sort().pop() || null;
  return { valid: st.ok, reason: st.ok ? '' : st.code, member: m ? memberCard(m.id, m.fields) : null, lastEntry, serverTime: Date.now() };
}

async function logEntry(env, user, mid, m, method) {
  const at = now();
  // Who let them in, by name, for the attendance log (the staff record has the email if the token doesn't).
  const byEmail = user.email || (await getDoc(env, 'users', uidOf(user)).catch(() => null))?.fields?.email || '';
  await setDoc(env, 'member_entries', id(), { memberId: mid, name: m.name, type: m.type, department: m.department || '', at, by: uidOf(user), byEmail, method, night: nightKey(at) });
}
const result = (st, m, extra = {}) => ({ valid: st.ok, code: st.ok ? 'member_ok' : st.code, message: st.ok ? (m.fields.type === 'staff' ? 'STAFF VERIFIED' : 'MEMBER VERIFIED') : st.message, member: m ? memberCard(m.id, m.fields) : null, ...extra });

// ── At the gate ──
export async function doorVerifyPass(env, user, payload, ip) {
  if (!requireRole(user, MEMBER_DOOR)) return FORBIDDEN;
  const r = await readPass(env, payload);
  if (r.error === 'stale') return { valid: false, code: 'stale_pass', message: 'OLD PASS CODE', hint: 'Ask them to open the pass live (not a screenshot) and scan again.' };
  if (r.error) { if (r.error === 'bad_sig') await securitySignal(env, 'member_code_guessing', ip || 'unknown'); return { valid: false, code: 'invalid_pass', message: 'PASS NOT VALID' }; }
  const m = await getDoc(env, 'members', r.pass.fields.memberId);
  const st = standing(m?.fields);
  if (st.ok) { await logEntry(env, user, m.id, m.fields, 'pass'); await setDoc(env, 'member_passes', r.pass.id, { ...r.pass.fields, lastSeenAt: now() }); }
  return result(st, m);
}

export async function doorSendCode(env, user, phone) {
  if (!requireRole(user, MEMBER_DOOR)) return FORBIDDEN;
  const ph = normalizePhone(phone); if (!ph) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  const hit = await memberByPhone(env, ph);
  // Door staff are signed in, so the door may be told plainly that a number isn't on the list.
  if (!hit) return { sent: false, code: 'not_member', message: 'NOT A MEMBER', hint: 'That number isn’t on the members list. They need a ticket.' };
  const st = standing(hit.m);
  if (!st.ok) return { sent: false, ...result(st, { id: hit.id, fields: hit.m }) };
  const code = sixDigits();
  await setDoc(env, 'member_codes', `door_${ph}`, { codeHash: await sha256Hex(`door:${ph}:${code}`), memberId: hit.id, attempts: 0, expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), requestedBy: uidOf(user) });
  const sent = await sendSms(env, ph, `MEMORIES GATE\nYour code: ${code}\nSay it to the door to come in. Expires in 5 minutes. If you're not at the gate, ignore this.`);
  return { sent, firstName: firstName(hit.m.name), phoneHint: maskPhone(ph), message: sent ? 'CODE SENT' : 'TEXT DIDN’T SEND' };
}

export async function doorConfirmCode(env, user, { phone, code }, ip) {
  if (!requireRole(user, MEMBER_DOOR)) return FORBIDDEN;
  const ph = normalizePhone(phone); if (!ph) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  const r = await checkCode(env, `door_${ph}`, `door:${ph}`, code, ip);
  if (r.error) return { valid: false, code: r.code || 'wrong_code', message: r.code === 'expired_code' ? 'CODE EXPIRED' : 'WRONG CODE', hint: r.error };
  const m = await getDoc(env, 'members', r.memberId);
  const st = standing(m?.fields);
  if (st.ok) await logEntry(env, user, m.id, m.fields, 'code');
  return result(st, m);
}
