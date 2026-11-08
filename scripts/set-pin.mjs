// Give a staff member a PIN directly, from a trusted computer. Used once for the first admin on a new
// (Supabase) database, or when someone can't get the PIN text. Everyone else uses "Text me one".
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/set-pin.mjs 0244123456 123456
//
// The PIN is 6 numbers for managers, directors, finance and the admin, 4 for everyone else. It is
// stored only as a salted hash; they can change it after signing in (their name → Change my PIN).
import { queryWhere, setDoc } from '../worker/src/lib/supabase-db.js';
import { hashPin, newSalt } from '../worker/src/lib/pin.js';

const [phoneRaw, pin] = process.argv.slice(2);
const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
if (!phoneRaw || !pin || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/set-pin.mjs <phone> <pin>'); process.exit(1);
}
const digits = String(phoneRaw).replace(/\D/g, '');
const phone = digits.startsWith('233') ? `0${digits.slice(3)}` : digits.startsWith('0') ? digits : `0${digits}`;
const rec = (await queryWhere(env, 'users', [{ field: 'phone', value: phone }])).find(d => d.fields.removed !== true);
if (!rec) { console.error(`No staff member with the phone ${phone} on the new database. Copy the staff first (copy-setup-from-firebase.mjs) or add them in the app.`); process.exit(1); }
const f = rec.fields, role = f.admin === true ? 'superAdmin' : f.role;
const need = ['superAdmin', 'director', 'manager', 'hrManager', 'finance', 'barManager'].includes(role) ? 6 : 4;
if (!new RegExp(`^\\d{${need}}$`).test(pin)) { console.error(`${f.name || phone} is a ${role}: the PIN is ${need} numbers.`); process.exit(1); }
const salt = newSalt();
await setDoc(env, 'users', rec.id, { ...f, pinSalt: salt, pinHash: await hashPin(pin, salt), pinSetAt: new Date(), pinStarter: true, pinFails: 0, lockedUntil: '', pinLocked: false, tempPinHash: '', tempPinSalt: '', tempPinExpires: '', sessionsFrom: new Date() });
console.log(`PIN set for ${f.name || phone} (${role}). They can sign in at the staff login with ${phone} and that PIN.`);
