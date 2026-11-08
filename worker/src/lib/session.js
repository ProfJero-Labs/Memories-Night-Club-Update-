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

const key = env => {
  if (!env.APP_JWT_SECRET || String(env.APP_JWT_SECRET).length < 24) throw new Error('APP_JWT_SECRET is not set on this Worker, or is too short (use 32+ random characters, as a Secret).');
  return new TextEncoder().encode(String(env.APP_JWT_SECRET));
};
export async function signSession(env, uid, role) {
  return new SignJWT({ uid, role, admin: role === 'superAdmin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setSubject(uid).setIssuedAt().setExpirationTime(`${SESSION_DAYS}d`).sign(key(env));
}
export async function verifySession(env, token) {
  const { payload } = await jwtVerify(token, key(env), { issuer: ISSUER, algorithms: ['HS256'] });
  return payload;
}
