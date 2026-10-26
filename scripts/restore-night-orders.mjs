// Put back a night's ticket and table records that were deleted from the database, from a trusted
// machine. Never run this in a browser.
//
//   node scripts/restore-night-orders.mjs ./service-account.json 2026-11-14            (preview)
//   node scripts/restore-night-orders.mjs ./service-account.json 2026-11-14 --apply    (restore)
//
// The night can be given by its date (YYYY-MM-DD, Accra) or by its event id.
//
// Where the records come from: every paid checkout keeps its own record (pending_checkouts), with
// the order id and the exact ticket codes it issued. Completed pay-in-bits plans keep the same. So
// each order and ticket is rebuilt with its original id and code: the QR codes and links the
// customers were texted keep working. Anything already there is left alone (each write is refused
// if the document exists), nothing is texted, and stock counts, promos, payments and the ledger
// aren't touched (they weren't deleted). Each restored record is marked restoredAt / restoredFrom,
// and the restore is written to audit_logs (ORDERS_RESTORED).
//
// Not rebuilt (no copy of their codes): comps (guest-list tickets) and gate sales paid in cash.
// The preview lists any it can see evidence of, so they can be issued again by hand.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { planRestore, applyRestore, describe } from '../worker/src/restore.js';
export { planRestore, applyRestore, describe };

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [saPath, night, flag] = process.argv.slice(2);
  if (!saPath || !night || (flag && flag !== '--apply')) { console.error('Usage: node scripts/restore-night-orders.mjs <service-account.json> <YYYY-MM-DD | eventId> [--apply]'); process.exit(1); }
  const json = readFileSync(saPath, 'utf8');
  const env = { FIREBASE_SERVICE_ACCOUNT_JSON: json, FIREBASE_PROJECT_ID: JSON.parse(json).project_id };
  const plan = await planRestore(env, night);
  console.log(describe(plan));
  if (flag !== '--apply') { if (plan.missing.length) console.log('\nPreview only. Run again with --apply to restore.'); process.exit(0); }
  if (!plan.missing.length) process.exit(0);
  const r = await applyRestore(env, plan);
  console.log(`\nRestored ${r.orders} orders and ${r.tickets} tickets. Logged as ORDERS_RESTORED in audit_logs.`);
}
