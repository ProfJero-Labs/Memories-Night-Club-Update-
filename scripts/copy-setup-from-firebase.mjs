// Copy the club's SETUP from the old Firebase database to the new Supabase one: the drink list, the
// bars, the staff, and the upcoming event with its tickets and tables. NOT any sales, tabs, orders,
// payments, cash or stock counts (those were test data). See worker/src/lib/setup-copy.js.
//
// It only READS from Firebase. By default it only shows what it would copy; add --go to write.
//
//   FIREBASE_SERVICE_ACCOUNT_FILE=./service-account.json \
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/copy-setup-from-firebase.mjs            # shows the list
//     node scripts/copy-setup-from-firebase.mjs --go       # copies it
//
// Options: --keep-pins (keep staff PINs; by default they are dropped and staff text themselves a new
//          one, or you set one with scripts/set-pin.mjs), --with-settings (also the club details).
// Safe to run again: the same records are written over themselves.
import { readFileSync } from 'node:fs';
import { listDocs, queryWhere } from '../worker/src/lib/firestore.js';
import * as supa from '../worker/src/lib/supabase-db.js';
import { planSetupCopy, countsOf } from '../worker/src/lib/setup-copy.js';

const args = process.argv.slice(2), has = f => args.includes(f);
const keyFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
const sb = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
if (!keyFile || !sb.SUPABASE_URL || !sb.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT_FILE (the key file), SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first. See the top of this file.'); process.exit(1);
}
const sa = JSON.parse(readFileSync(keyFile, 'utf8'));
const fb = { FIREBASE_PROJECT_ID: sa.project_id, FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(sa) }; // no DB_BACKEND: Firebase, read only

const { plan, notes } = await planSetupCopy({ listDocs: c => listDocs(fb, c), queryWhere: (c, f) => queryWhere(fb, c, f) }, { keepPins: has('--keep-pins'), withSettings: has('--with-settings') });

const names = { menu_items: 'Drinks and inventory', bar_stations: 'Bars', users: 'Staff', members: 'Staff passes', events: 'Upcoming events', ticket_types: 'Tickets', table_packages: 'Tables', bottles: 'Bottles', settings: 'Club details' };
for (const col of Object.keys(names)) {
  const rows = plan.filter(p => p.col === col); if (!rows.length) continue;
  console.log(`\n${names[col]} (${rows.length})`);
  for (const r of rows.slice(0, 80)) console.log(`  · ${r.label}`);
  if (rows.length > 80) console.log(`  … and ${rows.length - 80} more`);
}
console.log('\nNOT copied, on purpose: tabs, orders, tickets sold, payments, cash, stock counts and movements, expenses, payroll, reviews, logs.');
if (!has('--keep-pins')) console.log('Staff PINs are NOT copied: each person taps "First time, or forgot your PIN?" on the login page (a text with a new PIN), or run scripts/set-pin.mjs.');
for (const n of notes) console.log(`\nNote: ${n}`);

if (!has('--go')) { console.log('\nNothing was written. Run again with --go to copy this to Supabase.'); process.exit(0); }

let done = 0;
for (const p of plan) { await supa.setDoc(sb, p.col, p.id, p.fields); done++; }
console.log(`\nWrote ${done} records to Supabase. Checking…`);
let bad = 0;
for (const [col, n] of Object.entries(countsOf(plan))) {
  const have = (await supa.listDocs(sb, col)).length;
  console.log(`  ${col}: copied ${n}, now on Supabase ${have}${have < n ? '   <-- FEWER THAN COPIED' : ''}`);
  if (have < n) bad++;
}
console.log(bad ? '\nSomething is missing: send this output to the developer.' : '\nDone. The setup is on Supabase.');
process.exit(bad ? 1 : 0);
