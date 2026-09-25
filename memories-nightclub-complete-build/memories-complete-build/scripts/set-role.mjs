// Grant a staff role from a trusted machine — used once to create the first super admin (after
// that, super admins grant roles in the control room). Never run this in a browser.
//
//   node scripts/set-role.mjs ./service-account.json owner@example.com superAdmin
//
// Roles: superAdmin | manager | eventManager | doorStaff | organiser | none
// The account must already exist (Firebase Console → Authentication → Add user).
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const [saPath, email, role] = process.argv.slice(2);
const ROLES = ['superAdmin', 'manager', 'eventManager', 'doorStaff', 'organiser', 'none'];
if (!saPath || !email || !ROLES.includes(role)) { console.error('Usage: node scripts/set-role.mjs <service-account.json> <email> <role>\nRoles:', ROLES.join(' | ')); process.exit(1); }
const sa = JSON.parse(readFileSync(saPath, 'utf8'));
const b64 = x => Buffer.from(x).toString('base64url');

async function token(scope) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const d = await r.json(); if (!r.ok) throw new Error(d.error_description || 'token failed'); return d.access_token;
}
const idt = await token('https://www.googleapis.com/auth/identitytoolkit');
const call = async (path, body) => { const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${idt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || path); return d; };

const user = (await call('accounts:lookup', { email: [email.toLowerCase()] })).users?.[0];
if (!user) { console.error(`No Firebase Auth account for ${email}. Create it in the console first.`); process.exit(1); }
const claims = role === 'none' ? {} : { role, admin: role === 'superAdmin' };
await call('accounts:update', { localId: user.localId, customAttributes: JSON.stringify(claims) });

const fsToken = await token('https://www.googleapis.com/auth/datastore');
const docUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/users/${user.localId}`;
if (role === 'none') await fetch(docUrl, { method: 'DELETE', headers: { Authorization: `Bearer ${fsToken}` } });
else await fetch(docUrl, { method: 'PATCH', headers: { Authorization: `Bearer ${fsToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { email: { stringValue: email.toLowerCase() }, role: { stringValue: role }, admin: { booleanValue: claims.admin === true }, updatedAt: { timestampValue: new Date().toISOString() } } }) });
console.log(`${email} (${user.localId}) → ${role}. They need to sign out and back in.`);
