import { createRemoteJWKSet, jwtVerify } from 'jose';

// Roles live in Firebase Auth custom claims, set only by /api/admin/set-role (superAdmin).
// superAdmin also carries admin:true, which is what Firestore/Storage rules key on.
export const STAFF_ROLES = ['superAdmin', 'manager', 'eventManager', 'doorStaff', 'organiser', 'barStaff'];
export const CMS = ['superAdmin', 'manager', 'eventManager'];     // run the site
export const MONEY = ['superAdmin', 'manager'];                   // settings, SMS, installments
export const DOOR = ['superAdmin', 'manager', 'eventManager', 'doorStaff', 'organiser'];

let jwks;
export async function verifyStaff(req, env) {
  const h = req.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    jwks ||= createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
    const { payload } = await jwtVerify(h.slice(7), jwks, { issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID });
    if (payload.admin === true || STAFF_ROLES.includes(payload.role)) return { ...payload, uid: payload.uid || payload.sub };
    return null;
  } catch { return null; }
}
export function requireRole(user, roles) { return !!user && (user.admin === true || roles.includes(user.role)); }
export const uidOf = user => user?.uid || user?.sub;
