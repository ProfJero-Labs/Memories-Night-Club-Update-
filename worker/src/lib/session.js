// Staff sessions without Firebase: after the phone + PIN check, the Worker signs its own token and
// verifies it on every request (lib/auth.js verifyStaff). Used when the Worker runs on Supabase
// (DB_BACKEND=supabase, or AUTH_BACKEND=own on its own).
//
// The token only says who it is (uid) and when it was made; the staff record is still the authority on
// the role and on whether the person was removed, checked on every request, so a removal or a role
// change applies at once. A token lasts 14 days; the page asks for a fresh one now and then
// (POST /api/ops/session), so a phone in daily use stays signed in until the person signs out.
// Signing out everywhere (a PIN change, a removal) sets users/{uid}.sessionsFrom: older tokens stop.
import { SignJWT, jwtVerify } from 'jose';

export const ownAuth = env => env.AUTH_BACKEND === 'own' || env.DB_BACKEND === 'supabase';
export const SESSION_DAYS = 14;
const ISSUER = 'memories-staff';

const enc = x => new TextEncoder().encode(String(x));
// The signing secret: APP_JWT_SECRET if one is set, otherwise derived from the Supabase service key, so
// the engineer sets one secret, not two. (If the service key leaked, the database would be open anyway.)
async function key(env) {
  if (env.APP_JWT_SECRET && String(env.APP_JWT_SECRET).length >= 24) return enc(env.APP_JWT_SECRET);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on this Worker (it also signs the staff sessions).');
  const base = await crypto.subtle.importKey('raw', enc(env.SUPABASE_SERVICE_ROLE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', base, enc('memories-staff-session-v1')));
}
export async function signSession(env, uid, role) {
  return new SignJWT({ uid, role, admin: role === 'superAdmin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setSubject(uid).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(await key(env));
}
export async function verifySession(env, token) {
  const { payload } = await jwtVerify(token, await key(env), { issuer: ISSUER, algorithms: ['HS256'] });
  return payload;
}
