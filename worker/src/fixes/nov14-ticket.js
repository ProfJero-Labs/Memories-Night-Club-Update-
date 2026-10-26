// One-time fix (October 2026): one paid ticket for the 14 November night was deleted from the
// database by mistake. The payment record still has the order id and the ticket code the buyer was
// texted, so the order and ticket are put back exactly as they were (src/restore.js) and the ticket
// is valid again at the door. Only that buyer's sale (phone ending 8168) is touched.
//
// Runs from the 10-minute cron. Once it has run, a marker in system_fixes stops it running again,
// and the outcome is in audit_logs (ORDERS_RESTORED) and in the marker. Safe to delete this file
// (and its line in src/index.js) once it has run.
import { getDoc, setDoc } from '../lib/firestore.js';
import { now } from '../lib/util.js';
import { planRestore, applyRestore } from '../restore.js';

export const FIX_ID = 'restore-2026-11-14-ticket-8168';
const NIGHT = '2026-11-14', PHONE_LAST4 = '8168';

export async function restoreNov14Ticket(env) {
  if (await getDoc(env, 'system_fixes', FIX_ID)) return null;
  const plan = await planRestore(env, NIGHT);
  const mine = plan.missing.filter(m => m.kind === 'ticket' && String(m.phone).endsWith(PHONE_LAST4));
  let result;
  if (mine.length) {
    const r = await applyRestore(env, { ...plan, missing: mine }, { by: 'one-time fix', extra: { fix: FIX_ID } });
    result = { status: 'restored', ...r, orderIds: mine.map(m => m.orderId), buyer: mine[0].buyer };
  } else {
    // Already back (restored by hand), or not a sale with a payment record (cash at the gate or a comp).
    const present = plan.events.length > 0;
    result = { status: present ? 'nothing_missing' : 'night_not_found' };
  }
  await setDoc(env, 'system_fixes', FIX_ID, { ...result, night: NIGHT, ranAt: now() });
  return result;
}
