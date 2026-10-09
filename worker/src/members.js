// Membership: staff and other members get in without a ticket, but only after the door verifies
// them. Nothing here is sent by SMS: everything a member needs shows inside the app.
//
//   Getting a pass. A manager adds the person (People → Members) and shows them an activation QR
//   (or sends the link however they like). Opening it on their phone puts their pass in the
//   Memories app (member.html, installable). Staff with a sign-in open "My pass" from their own
//   dashboard (organiser, door, bar, control room): their staff account is the proof. Every staff
//   account is a member automatically, so staff never buy tickets to get in.
//
//   At the gate, two ways:
//   1. Scan the pass: a QR that changes every 30 seconds, signed on the phone with a secret only
//      that phone and this Worker hold, so it works offline and a screenshot dies in a minute.
//   2. By phone number: the door types the member's number; a 6-digit gate code appears in that
//      member's app (and on a staff member's dashboard); they say it; the door enters it.
//
// Every verified entry is recorded (member_entries): that is the HR attendance log.
//
// Collections (server only; Firestore rules deny browsers):
//   members/{id}          name, phone, type staff|member, department, position, staffNo, status,
//                         validUntil, staffUid (the linked staff account, if any)
//   member_passes/{id}    memberId, secret (HMAC key for the rotating QR), createdAt, revokedAt
//   member_codes/{key}    act_{code}: one-time activation (48 h); gate_{memberId}: the gate code
//   member_entries/{id}   memberId, name, type, department, at, by, method pass|code, night
import { getDoc, setDoc, createDoc, deleteDoc, listDocs, queryWhere, queryRecent } from './lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone, firstName, sixDigits, sha256Hex, nightKey } from './lib/util.js';
import { requireRole, MONEY, STAFF_ROLES, uidOf } from './lib/auth.js';
import { sendSms, siteUrl } from './lib/notify.js';
import { securitySignal } from './lib/monitor.js';

const FORBIDDEN = { error: 'Forbidden.', status: 403 };
// Who may verify members at the gate. Organisers run their own nights' doors only, not the club's staff.
export const MEMBER_DOOR = ['superAdmin', 'manager', 'eventManager', 'doorStaff'];
export const MEMBER_TYPES = ['staff', 'member'];
const STEP_S = 30;                  // the pass QR changes every 30 seconds
const STEPS_ACCEPTED = 2;           // and is accepted for the current and the 2 previous steps (60–90 s)
const GATE_TTL_MS = 5 * 60_000, GATE_TRIES = 5;
const ACTIVATE_TTL_MS = 48 * 3600_000;
const MAX_PASSES = 3;               // phones per member; a 4th retires the oldest
const ROLE_DEPT = { superAdmin: 'Management', manager: 'Management', eventManager: 'Events', doorStaff: 'Door', barStaff: 'Bar', organiser: 'Organiser' };
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
async function memberByStaff(env, uid) {
  const hit = (await queryWhere(env, 'members', [{ field: 'staffUid', value: uid }], { limit: 1 }))[0];
  return hit ? { id: hit.id, m: hit.fields } : null;
}

// ── Control room: People ──
export async function listMembers(env, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const [docs, staff] = await Promise.all([listDocs(env, 'members'), listDocs(env, 'users')]);
  const emails = new Map(staff.map(s => [s.id, s.fields.email]));
  return {
    members: docs.map(d => ({ ...memberCard(d.id, d.fields), phone: d.fields.phone, notes: d.fields.notes || '', staffUid: d.fields.staffUid || '', staffEmail: emails.get(d.fields.staffUid) || '', createdAt: d.fields.createdAt || '' })).sort((a, b) => a.name.localeCompare(b.name)),
    // Staff accounts with no member record yet: every staff account should be one.
    unlinkedStaff: staff.filter(s => s.fields.role && !docs.some(d => d.fields.staffUid === s.id)).map(s => ({ uid: s.id, email: s.fields.email, role: s.fields.role, name: s.fields.name || '' })),
  };
}

export async function upsertMember(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone);
  const type = MEMBER_TYPES.includes(b?.type) ? b.type : 'member';
  const status = b?.status === 'suspended' ? 'suspended' : 'active';
  const validUntil = b?.validUntil ? (/^\d{4}-\d{2}-\d{2}$/.test(b.validUntil) ? b.validUntil : null) : '';
  if (!name) return { error: 'Add their name.' };
  if (!phone) return { error: 'Add a Ghana phone number, e.g. 024 123 4567. The door can find them by it.' };
  if (validUntil === null) return { error: 'Pick a valid end date, or leave it blank.' };
  const existing = b.id ? await getDoc(env, 'members', String(b.id)) : null;
  if (b.id && !existing) return { error: 'Member not found.', status: 404 };
  const clash = await memberByPhone(env, phone);
  if (clash && clash.id !== existing?.id) return { error: `${clash.m.name} already has that number.` };
  // Linking a staff account: it must be a real one, and not already linked to someone else.
  let staffUid = existing?.fields?.staffUid || '';
  if (b.staffUid !== undefined) {
    staffUid = clean(b.staffUid, 128);
    if (staffUid) {
      const acct = await getDoc(env, 'users', staffUid);
      if (!acct?.fields?.role) return { error: 'Pick a staff account from the list.' };
      const other = await memberByStaff(env, staffUid);
      if (other && other.id !== existing?.id) return { error: `That staff account is already ${other.m.name}’s.` };
    }
  }
  const mid = existing?.id || id();
  await setDoc(env, 'members', mid, {
    ...(existing?.fields || {}), name, phone, type, status, validUntil, staffUid,
    department: clean(b.department, 60), position: clean(b.position, 60), staffNo: clean(b.staffNo, 30), notes: clean(b.notes, 300),
    updatedAt: now(), updatedBy: uidOf(user), createdAt: existing?.fields?.createdAt || now(), createdBy: existing?.fields?.createdBy || uidOf(user),
  });
  // Suspending, or changing the phone, retires every pass already on a phone.
  if (existing && (status !== 'active' || existing.fields.phone !== phone)) await revokePasses(env, mid);
  await audit(env, user, existing ? 'MEMBER_UPDATED' : 'MEMBER_ADDED', { memberId: mid, type, status, from: existing?.fields?.status || null });
  return { id: mid };
}

// Every staff account is a member (called when a staff member is invited or given a role).
// Returns the member id. Creates the record, or links an existing one with the same phone.
export async function ensureStaffMember(env, { uid, name, phone, role }, user) {
  const linked = await memberByStaff(env, uid);
  if (linked) {
    if (linked.m.status !== 'active') await setDoc(env, 'members', linked.id, { ...linked.m, status: 'active', updatedAt: now() });
    return linked.id;
  }
  const ph = normalizePhone(phone);
  const byPhone = ph ? await memberByPhone(env, ph) : null;
  if (byPhone) { await setDoc(env, 'members', byPhone.id, { ...byPhone.m, staffUid: uid, type: 'staff', status: 'active', updatedAt: now() }); return byPhone.id; }
  const mid = id();
  await setDoc(env, 'members', mid, { name: clean(name, 80) || 'Staff', phone: ph || '', type: 'staff', status: 'active', validUntil: '', staffUid: uid, department: ROLE_DEPT[role] || 'Staff', position: '', staffNo: '', notes: '', createdAt: now(), createdBy: uidOf(user), updatedAt: now() });
  await audit(env, user, 'MEMBER_ADDED', { memberId: mid, type: 'staff', staffUid: uid, auto: true });
  return mid;
}
// Losing staff access suspends the staff membership too (and retires its passes).
export async function suspendStaffMember(env, uid) {
  const linked = await memberByStaff(env, uid);
  if (linked && linked.m.type === 'staff') { await setDoc(env, 'members', linked.id, { ...linked.m, status: 'suspended', updatedAt: now() }); await revokePasses(env, linked.id); }
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

// ── Getting the pass onto a phone ──
// The manager's activation QR/link: one-time, 48 hours. 10 Crockford characters (50 bits).
const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const activationCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), x => CROCK[x & 31]).join('');
export async function createActivation(env, b, user) {
  if (!requireRole(user, MONEY)) return FORBIDDEN;
  const m = await getDoc(env, 'members', String(b?.id || ''));
  if (!m) return { error: 'Member not found.', status: 404 };
  const st = standing(m.fields); if (!st.ok) return { error: 'Reactivate this membership first.' };
  const code = activationCode(), expiresAt = new Date(Date.now() + ACTIVATE_TTL_MS).toISOString();
  await setDoc(env, 'member_codes', `act_${code}`, { memberId: m.id, expiresAt, createdBy: uidOf(user), createdAt: now() });
  const link = siteUrl(env, `/member.html?activate=${code}`);
  // Optional, if the manager asks: text the link (it's an invitation, not a verification code).
  const texted = b.text === true && m.fields.phone ? await sendSms(env, m.fields.phone, `MEMORIES\n${firstName(m.fields.name)}, open this on your phone to get your Memories pass: ${link}\nIt works once, for 48 hours.`) : false;
  await audit(env, user, 'MEMBER_ACTIVATION_CREATED', { memberId: m.id, texted });
  return { code, link, expiresAt, texted };
}

async function issuePass(env, memberDoc, device) {
  const live = (await queryWhere(env, 'member_passes', [{ field: 'memberId', value: memberDoc.id }])).filter(p => !p.fields.revokedAt)
    .sort((a, b) => new Date(a.fields.createdAt) - new Date(b.fields.createdAt));
  for (const old of live.slice(0, Math.max(0, live.length - (MAX_PASSES - 1)))) await setDoc(env, 'member_passes', old.id, { ...old.fields, revokedAt: now() });
  const passId = id(), secret = id() + id();
  await createDoc(env, 'member_passes', passId, { memberId: memberDoc.id, secret, device: clean(device, 60), createdAt: now() });
  // serverTime lets the pass correct a phone whose clock is off (common), so its codes line up.
  return { passId, secret, stepSeconds: STEP_S, serverTime: Date.now(), member: memberCard(memberDoc.id, memberDoc.fields) };
}

export async function activatePass(env, { code, device }, ip) {
  const c = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(c)) return { error: 'That activation code doesn’t look right. Ask the manager for a new QR.' };
  const a = await getDoc(env, 'member_codes', `act_${c}`);
  if (!a || new Date(a.fields.expiresAt).getTime() < Date.now()) {
    await securitySignal(env, 'member_code_guessing', ip || 'unknown');
    if (a) await deleteDoc(env, 'member_codes', `act_${c}`).catch(() => {});
    return { error: 'This activation has expired or was already used. Ask the manager for a new QR.' };
  }
  await deleteDoc(env, 'member_codes', `act_${c}`).catch(() => {});
  const m = await getDoc(env, 'members', a.fields.memberId);
  if (!standing(m?.fields).ok) return { error: 'This membership isn’t active. Talk to the manager.' };
  return issuePass(env, m, device);
}

// Staff open their pass from their own dashboard: the signed-in staff account is the proof.
export async function staffPass(env, user, { device } = {}) {
  if (!requireRole(user, STAFF_ROLES)) return FORBIDDEN;
  const linked = await memberByStaff(env, uidOf(user));
  if (!linked) return { error: 'Your staff account isn’t set up as a member yet. Ask a manager (People → Members).', status: 404 };
  if (!standing(linked.m).ok) return { error: 'Your staff membership isn’t active. Talk to the manager.' };
  return issuePass(env, { id: linked.id, fields: linked.m }, device);
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

// The gate code waiting for this member, if the door asked for one in the last 5 minutes.
async function pendingGate(env, memberId) {
  const g = await getDoc(env, 'member_codes', `gate_${memberId}`);
  if (!g || new Date(g.fields.expiresAt).getTime() < Date.now()) return null;
  return { code: g.fields.code, expiresAt: g.fields.expiresAt };
}

// What the pass asks while it's open: still valid? a gate code waiting? last gate check?
// Authenticated by a fresh pass QR, so only the phone holding the pass can ask.
export async function passStatus(env, payload) {
  const r = await readPass(env, payload);
  // A code from a skewed clock isn't a bad pass: send the time so the phone can correct itself.
  if (r.error === 'stale') return { valid: true, reason: 'clock', serverTime: Date.now() };
  if (r.error) return { valid: false, reason: r.error, serverTime: Date.now() };
  const mid = r.pass.fields.memberId;
  const m = await getDoc(env, 'members', mid);
  const st = standing(m?.fields);
  const lastEntry = (await queryWhere(env, 'member_entries', [{ field: 'memberId', value: mid }], { limit: 200 })).map(e => e.fields.at).sort().pop() || null;
  return { valid: st.ok, reason: st.ok ? '' : st.code, member: m ? memberCard(m.id, m.fields) : null, lastEntry, gate: st.ok ? await pendingGate(env, mid) : null, serverTime: Date.now() };
}

// A staff member's dashboard asks the same: a gate code waiting for me? (Their sign-in is the proof.)
export async function myGate(env, user) {
  if (!requireRole(user, STAFF_ROLES)) return FORBIDDEN;
  const linked = await memberByStaff(env, uidOf(user));
  if (!linked) return { member: false, gate: null };
  return { member: true, active: standing(linked.m).ok, gate: standing(linked.m).ok ? await pendingGate(env, linked.id) : null };
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

// The door types a member's phone: a gate code appears in that member's app / staff dashboard.
// Nothing is texted. Door staff are signed in, so they may be told plainly that a number isn't a member.
export async function doorRequestCode(env, user, phone) {
  if (!requireRole(user, MEMBER_DOOR)) return FORBIDDEN;
  const ph = normalizePhone(phone); if (!ph) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  const hit = await memberByPhone(env, ph);
  if (!hit) return { sent: false, code: 'not_member', message: 'NOT A MEMBER', hint: 'That number isn’t on the members list. They need a ticket.' };
  const st = standing(hit.m);
  if (!st.ok) return { sent: false, ...result(st, { id: hit.id, fields: hit.m }) };
  const code = sixDigits();
  await setDoc(env, 'member_codes', `gate_${hit.id}`, { code, codeHash: await sha256Hex(`gate:${hit.id}:${code}`), memberId: hit.id, attempts: 0, expiresAt: new Date(Date.now() + GATE_TTL_MS).toISOString(), requestedBy: uidOf(user) });
  return { sent: true, firstName: firstName(hit.m.name), phoneHint: maskPhone(ph), staff: !!hit.m.staffUid, message: 'CODE IS ON THEIR APP' };
}

export async function doorConfirmCode(env, user, { phone, code }, ip) {
  if (!requireRole(user, MEMBER_DOOR)) return FORBIDDEN;
  const ph = normalizePhone(phone); if (!ph) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  const c = String(code || '').trim();
  const hit = await memberByPhone(env, ph);
  const key = hit ? `gate_${hit.id}` : null;
  const g = key ? await getDoc(env, 'member_codes', key) : null;
  if (!g || new Date(g.fields.expiresAt).getTime() < Date.now()) return { valid: false, code: 'expired_code', message: 'CODE EXPIRED', hint: 'Ask for a new code.' };
  if (!/^\d{6}$/.test(c) || (await sha256Hex(`gate:${hit.id}:${c}`)) !== g.fields.codeHash) {
    await securitySignal(env, 'member_code_guessing', ip || 'unknown');
    const attempts = Number(g.fields.attempts || 0) + 1;
    if (attempts >= GATE_TRIES) { await deleteDoc(env, 'member_codes', key).catch(() => {}); return { valid: false, code: 'expired_code', message: 'TOO MANY WRONG CODES', hint: 'Ask for a new code.' }; }
    await setDoc(env, 'member_codes', key, { ...g.fields, attempts });
    return { valid: false, code: 'wrong_code', message: 'WRONG CODE', hint: 'Check the code on their app and try again.' };
  }
  await deleteDoc(env, 'member_codes', key).catch(() => {});
  const m = await getDoc(env, 'members', hit.id);
  const st = standing(m?.fields);
  if (st.ok) await logEntry(env, user, m.id, m.fields, 'code');
  return result(st, m);
}
