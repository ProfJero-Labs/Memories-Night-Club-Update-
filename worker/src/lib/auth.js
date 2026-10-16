import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDoc } from './firestore.js';

// Who can do what. A person's role is on their staff record (users/{uid}); the sign-in token also
// carries it, for the Firestore and Storage rules. superAdmin also carries admin:true.
//   superAdmin   system access and technical settings (the only role that can make admins)
//   director     the club's directors: a manager's access, plus adding managers and finance
//   manager      runs the night: everything in the control room, staff, approvals
//   finance      prices, stock, money, reports and the end-of-day report
//   eventManager nights, tickets, tables, promos, bar setup
//   doorStaff    front office: tickets, entry, table bookings and arrivals, customer issues
//   security     entry checks and incidents
//   barStaff     bartender: the bar queue, handovers, wastage, the stock count
//   waitStaff    waiters and waitresses: their tables, tabs, rounds and report
//   cashier      money received: cash payments, the cash shift
//   organiser    an outside organiser: their own nights
export const STAFF_ROLES = ['superAdmin', 'director', 'manager', 'finance', 'eventManager', 'doorStaff', 'security', 'barStaff', 'waitStaff', 'cashier', 'organiser'];
export const CMS = ['superAdmin', 'director', 'manager', 'eventManager'];     // run the site
export const MONEY = ['superAdmin', 'director', 'manager'];                    // settings, SMS, installments, people
export const DOOR = ['superAdmin', 'director', 'manager', 'eventManager', 'doorStaff', 'security', 'organiser'];
export const STOCK = ['superAdmin', 'director', 'manager', 'finance'];         // products, prices, stock received, reviews
export const REPORTS = ['superAdmin', 'director', 'manager', 'finance'];       // today's sales, staff reports, end of day
export const STAFF_ADMIN = ['superAdmin', 'director', 'manager'];              // add, change and remove staff
// Who may give which role: only a super admin makes admins; directors add managers and finance.
export function canAssign(actorRole, role) {
  if (actorRole === 'superAdmin') return STAFF_ROLES.includes(role);
  if (actorRole === 'director') return STAFF_ROLES.includes(role) && role !== 'superAdmin';
  if (actorRole === 'manager') return STAFF_ROLES.includes(role) && !['superAdmin', 'director', 'manager', 'finance'].includes(role);
  return false;
}
// Longer PINs for the roles that control money, stock or staff.
export const pinLength = role => (['superAdmin', 'director', 'manager', 'finance'].includes(role) ? 6 : 4);

// The staff record is the authority on the role, so a change or removal applies on the very next
// request (a sign-in token lasts up to an hour). Records are cached for a few seconds per Worker.
const recordCache = new WeakMap();
async function staffRecord(env, uid) {
  let byEnv = recordCache.get(env); if (!byEnv) recordCache.set(env, byEnv = new Map());
  const hit = byEnv.get(uid);
  if (hit && Date.now() - hit.at < 10000) return hit.doc;
  const doc = await getDoc(env, 'users', uid).catch(() => null);
  byEnv.set(uid, { doc, at: Date.now() });
  return doc;
}
export const forgetStaffRecord = (env, uid) => recordCache.get(env)?.delete(uid);

let jwks;
export async function verifyStaff(req, env) {
  const h = req.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    jwks ||= createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
    const { payload } = await jwtVerify(h.slice(7), jwks, { issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID });
    const uid = payload.uid || payload.sub;
    const rec = await staffRecord(env, uid);
    if (rec) {
      // Removed, or no staff role on file: no access, whatever the token still says.
      const f = rec.fields, role = f.admin === true ? 'superAdmin' : f.role;
      if (f.removed === true || !STAFF_ROLES.includes(role)) return null;
      return { ...payload, uid, role, admin: role === 'superAdmin', name: f.name || '', phone: f.phone || '', email: payload.email || f.email || '' };
    }
    // Older accounts without a staff record yet: the token's role.
    if (payload.admin === true || STAFF_ROLES.includes(payload.role)) return { ...payload, uid };
    return null;
  } catch { return null; }
}
export function requireRole(user, roles) { return !!user && (user.admin === true || roles.includes(user.role)); }
export const uidOf = user => user?.uid || user?.sub;
