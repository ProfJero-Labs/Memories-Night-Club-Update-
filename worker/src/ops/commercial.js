// Commercial settings: the customer's service charge (on/off, rate, cap) and the developer
// commission (lib/fee.js has the rules). A director or the admin changes them; finance can look. Checked here, on the Worker: the screen only shows the form.
// Every save keeps the old and new values (change_log, audit_logs). Payments keep a copy of the
// rules they were charged under, so a change never rewrites a past payment.
import { setDoc } from '../lib/firestore.js';
import { now } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, audit, logChange, int } from './common.js';
import { commercialConfig, clearCommercialCache, MAX_RATE_PERCENT, COMMISSION_KINDS, COMMISSION_CHANNELS, COMMISSION_BASES, DEFAULT_SERVICE_CHARGE } from '../lib/fee.js';

export const COMMERCIAL_EDITORS = ['superAdmin', 'director'];
export const COMMERCIAL_VIEWERS = [...COMMERCIAL_EDITORS, 'finance'];

export async function getCommercial(env, user) {
  if (!requireRole(user, COMMERCIAL_VIEWERS)) return FORBIDDEN;
  const cfg = await commercialConfig(env);
  return { ...cfg, canEdit: !!requireRole(user, COMMERCIAL_EDITORS), maxRatePercent: MAX_RATE_PERCENT, kinds: COMMISSION_KINDS, channels: COMMISSION_CHANNELS, bases: COMMISSION_BASES,
    // Nothing on the Paystack side is split automatically: the commission is recorded as payable.
    settlementModes: { payable: 'Recorded as payable to the developers (paid out separately)' } };
}

const rate = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= MAX_RATE_PERCENT ? Math.round(n * 100) / 100 : NaN; };
const pesewas = v => { const n = int(v); return n >= 0 && n <= 10_000_000 ? n : NaN; };

// { serviceCharge: { enabled, percent, capPesewas }, commission: {...}, processing: { estimatePercent } }
// Any part left out is kept as it is.
export async function saveCommercial(env, b, user) {
  if (!requireRole(user, COMMERCIAL_EDITORS)) return { error: 'Only a director or the admin can change the service charge or the commission.', status: 403 };
  const cur = await commercialConfig(env);
  const next = { serviceCharge: { ...DEFAULT_SERVICE_CHARGE, ...cur.serviceCharge }, commission: { ...cur.commission }, processing: { ...cur.processing } };
  if (b?.serviceCharge) {
    const s = b.serviceCharge;
    if (s.enabled !== undefined) next.serviceCharge.enabled = s.enabled === true;
    if (s.percent !== undefined) { const p = rate(s.percent); if (Number.isNaN(p)) return { error: `The service charge rate is a percentage from 0 to ${MAX_RATE_PERCENT}.` }; next.serviceCharge.percent = p; }
    if (s.capPesewas !== undefined) { const c = pesewas(s.capPesewas); if (Number.isNaN(c)) return { error: 'The most a bill can be charged is an amount of 0 or more.' }; next.serviceCharge.capPesewas = c; }
  }
  if (b?.commission) {
    const c = b.commission, n = next.commission;
    if (c.enabled !== undefined) n.enabled = c.enabled === true;
    if (c.type !== undefined) { if (!['percent', 'fixed'].includes(c.type)) return { error: 'The commission is a percentage or a fixed amount per payment.' }; n.type = c.type; }
    if (c.percent !== undefined) { const p = rate(c.percent); if (Number.isNaN(p)) return { error: `The commission rate is a percentage from 0 to ${MAX_RATE_PERCENT}.` }; n.percent = p; }
    if (c.fixedPesewas !== undefined) { const f = pesewas(c.fixedPesewas); if (Number.isNaN(f)) return { error: 'The fixed commission is an amount of 0 or more.' }; n.fixedPesewas = f; }
    if (c.basis !== undefined) { if (!COMMISSION_BASES[c.basis]) return { error: 'Pick what the commission is worked out on.' }; n.basis = c.basis; }
    if (c.kinds !== undefined) { if (!Array.isArray(c.kinds) || c.kinds.some(k => !COMMISSION_KINDS[k])) return { error: 'Pick which payments earn a commission.' }; n.kinds = [...new Set(c.kinds)]; }
    if (c.channels !== undefined) { if (!Array.isArray(c.channels) || c.channels.some(k => !COMMISSION_CHANNELS[k])) return { error: 'Pick which payment channels earn a commission.' }; n.channels = [...new Set(c.channels)]; }
    if (c.refunds !== undefined) { if (!['reverse', 'keep'].includes(c.refunds)) return { error: 'Say what happens to the commission when a payment is refunded.' }; n.refunds = c.refunds; }
    if (c.settlement !== undefined && c.settlement !== 'payable') return { error: 'Only “recorded as payable” is supported: there is no Paystack split set up.' };
    if (n.enabled && (n.type === 'percent' ? !(n.percent > 0) : !(n.fixedPesewas > 0))) return { error: 'Enter the agreed commission before turning it on.' };
  }
  if (b?.processing && b.processing.estimatePercent !== undefined) {
    const e = b.processing.estimatePercent === '' || b.processing.estimatePercent === null ? null : rate(b.processing.estimatePercent);
    if (Number.isNaN(e)) return { error: 'The fee estimate is a percentage from 0 to 20 (or blank).' };
    next.processing.estimatePercent = e;
  }
  await setDoc(env, 'settings', 'commercial', { ...next, updatedAt: now(), updatedBy: uidOf(user), updatedByName: user.name || '' });
  clearCommercialCache();
  const flat = o => JSON.stringify(o);
  for (const k of ['serviceCharge', 'commission', 'processing']) if (flat(cur[k]) !== flat(next[k])) await logChange(env, user, { kind: 'commercial', refId: k, refName: { serviceCharge: 'Service charge', commission: 'Developer commission', processing: 'Paystack fee estimate' }[k], field: k, from: flat(cur[k]), to: flat(next[k]) });
  await audit(env, user, 'COMMERCIAL_SETTINGS_UPDATED', { serviceCharge: next.serviceCharge, commission: next.commission });
  return getCommercial(env, user);
}
