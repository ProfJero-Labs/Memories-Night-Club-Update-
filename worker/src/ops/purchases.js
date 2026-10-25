// Buying drinks: the Manager asks, finance checks it against the stock limits, a director approves
// the money, the Manager buys and records what arrived (the bar confirms it).
//
//   purchase_requests/{id}  stationId, stationName, lines [{ productId, name, qty, estUnitCostPesewas,
//                           stockNow, min, max, receivedQty }], estTotalPesewas, note,
//                           status requested → checked (finance) → approved (a director) → bought
//                           (everything recorded as arrived), or refused (by finance or a director)
//
// Limits are on each drink (Drinks & prices, set by finance): `lowStock` is the minimum (buy when
// at or below it) and `maxStock` the most to hold. Going above the maximum needs finance's reason.
import { getDoc, setDoc, listDocs, queryRecent } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, uidOf } from '../lib/auth.js';
import { FORBIDDEN, audit, int } from './common.js';
import { stockLeft } from './stock.js';

const ASKERS = ['superAdmin', 'director', 'manager'];
const CHECKERS = ['superAdmin', 'finance'];
const DIRECTORS = ['superAdmin', 'director'];
const SEE = ['superAdmin', 'director', 'manager', 'finance'];
export const PURCHASE_LABEL = { requested: 'Waiting for finance to check', checked: 'Checked by finance: waiting for a director', approved: 'Approved: buy it', bought: 'Bought and in stock', refused: 'Not approved' };
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);

// What each drink has now at a bar, its limits, and what to buy to fill it up.
async function stockNow(env, stationId) {
  const [items, left] = await Promise.all([listDocs(env, 'menu_items'), stockLeft(env, stationId)]);
  return items.filter(i => i.fields.tracked !== false && !i.fields.deleted).map(i => {
    const now_ = left[i.id] ?? 0, min = Number(i.fields.lowStock || 0), max = Number(i.fields.maxStock || 0);
    return { productId: i.id, name: i.fields.name, stockNow: now_, min, max, costPesewas: Number(i.fields.costPesewas || 0), low: min > 0 && now_ <= min, suggestQty: max > now_ ? max - now_ : 0 };
  }).sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name));
}

export async function purchases(env, user, { stationId } = {}) {
  if (!requireRole(user, SEE)) return FORBIDDEN;
  const stations = (await listDocs(env, 'bar_stations')).map(s => ({ id: s.id, name: s.fields.name })).sort((a, b) => a.name.localeCompare(b.name));
  const sid = stations.find(s => s.id === stationId)?.id || stations[0]?.id;
  const rows = (await queryRecent(env, 'purchase_requests', 'requestedAt', new Date(Date.now() - 90 * 864e5), 300)).map(d => ({ id: d.id, ...d.fields }));
  return {
    stations, stationId: sid, stock: sid ? await stockNow(env, sid) : [],
    requests: rows.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).map(r => ({ ...r, statusLabel: PURCHASE_LABEL[r.status] })),
    can: { ask: !!requireRole(user, ASKERS), check: !!requireRole(user, CHECKERS), approve: !!requireRole(user, DIRECTORS) },
  };
}

export async function askPurchase(env, b, user) {
  if (!requireRole(user, ASKERS)) return { error: 'The Manager asks for purchases.', status: 403 };
  const st = await getDoc(env, 'bar_stations', String(b?.stationId || '')); if (!st) return { error: 'Pick the bar it’s for.' };
  const stock = Object.fromEntries((await stockNow(env, st.id)).map(r => [r.productId, r]));
  const want = (Array.isArray(b?.lines) ? b.lines : []).map(x => ({ productId: String(x?.productId || ''), qty: int(x?.qty), est: x?.estUnitCostPesewas === '' || x?.estUnitCostPesewas == null ? null : int(x.estUnitCostPesewas) })).filter(x => stock[x.productId] && x.qty > 0);
  if (!want.length) return { error: 'Add at least one drink and how many.' };
  const lines = want.map(x => { const s = stock[x.productId]; return { productId: x.productId, name: s.name, qty: x.qty, estUnitCostPesewas: x.est != null && x.est >= 0 ? x.est : s.costPesewas, stockNow: s.stockNow, min: s.min, max: s.max, receivedQty: 0 }; });
  const pid = id();
  await setDoc(env, 'purchase_requests', pid, { stationId: st.id, stationName: st.fields.name, lines, estTotalPesewas: sum(lines, l => l.qty * l.estUnitCostPesewas), note: clean(b?.note, 300), status: 'requested', requestedBy: uidOf(user), requestedByName: user.name || '', requestedAt: now() });
  await audit(env, user, 'PURCHASE_REQUESTED', { purchaseId: pid });
  return { id: pid };
}

// Finance checks against the limits: may lower or change the numbers; above the maximum needs a reason.
export async function checkPurchase(env, b, user) {
  if (!requireRole(user, CHECKERS)) return { error: 'Finance checks purchases.', status: 403 };
  const r = await getDoc(env, 'purchase_requests', String(b?.id || '')); if (!r) return { error: 'Not found.', status: 404 };
  const f = r.fields;
  if (f.status !== 'requested') return { error: 'This request has already been checked.' };
  const note = clean(b?.note, 300);
  if (b?.approve === false) {
    if (!note) return { error: 'Say why it isn’t approved.' };
    await setDoc(env, 'purchase_requests', r.id, { ...f, status: 'refused', refusedByName: user.name || '', refusedAt: now(), refusedNote: note, refusedBy: 'finance' });
    return { refused: true };
  }
  const change = new Map((Array.isArray(b?.lines) ? b.lines : []).map(x => [String(x.productId), int(x.qty)]));
  const stock = Object.fromEntries((await stockNow(env, f.stationId)).map(s => [s.productId, s]));
  const lines = f.lines.map(l => ({ ...l, qty: change.has(l.productId) && change.get(l.productId) >= 0 ? change.get(l.productId) : l.qty, stockNow: stock[l.productId]?.stockNow ?? l.stockNow })).filter(l => l.qty > 0);
  if (!lines.length) return { error: 'Nothing left to buy. Refuse it instead.' };
  const over = lines.filter(l => l.max > 0 && l.stockNow + l.qty > l.max);
  if (over.length && !note) return { error: `${over.map(l => `${l.name} (${l.stockNow} + ${l.qty} is over the maximum of ${l.max})`).join(', ')}. Lower the number, or give a reason.`, code: 'over_max' };
  await setDoc(env, 'purchase_requests', r.id, { ...f, lines, estTotalPesewas: sum(lines, l => l.qty * l.estUnitCostPesewas), status: 'checked', checkedBy: uidOf(user), checkedByName: user.name || '', checkedAt: now(), checkNote: note });
  await audit(env, user, 'PURCHASE_CHECKED', { purchaseId: r.id, overMax: over.length });
  return { checked: true };
}

export async function decidePurchase(env, pid, approve, note, user) {
  if (!requireRole(user, DIRECTORS)) return { error: 'A director approves payments.', status: 403 };
  const r = await getDoc(env, 'purchase_requests', String(pid || '')); if (!r) return { error: 'Not found.', status: 404 };
  if (r.fields.status !== 'checked') return { error: r.fields.status === 'requested' ? 'Finance checks it first.' : 'Already decided.' };
  if (!approve && !clean(note, 300)) return { error: 'Say why it isn’t approved.' };
  await setDoc(env, 'purchase_requests', r.id, { ...r.fields, status: approve ? 'approved' : 'refused', decidedBy: uidOf(user), decidedByName: user.name || '', decidedAt: now(), decisionNote: clean(note, 300), ...(approve ? {} : { refusedBy: 'director', refusedNote: clean(note, 300), refusedByName: user.name || '' }) });
  await audit(env, user, approve ? 'PURCHASE_APPROVED' : 'PURCHASE_REFUSED', { purchaseId: r.id });
  return { decided: true };
}

// Called when new stock is recorded against an approved request: counts what has arrived.
export async function notePurchaseReceived(env, pid, productId, qty) {
  const r = await getDoc(env, 'purchase_requests', String(pid || ''));
  if (!r || !['approved', 'bought'].includes(r.fields.status)) return { error: 'That purchase isn’t approved.' };
  const line = r.fields.lines.find(l => l.productId === productId);
  if (!line) return { error: 'That drink isn’t on the approved purchase.' };
  const lines = r.fields.lines.map(l => (l.productId === productId ? { ...l, receivedQty: (l.receivedQty || 0) + qty } : l));
  await setDoc(env, 'purchase_requests', r.id, { ...r.fields, lines, status: lines.every(l => (l.receivedQty || 0) >= l.qty) ? 'bought' : 'approved' });
  return { ok: true };
}
export async function approvedPurchase(env, pid) {
  const r = await getDoc(env, 'purchase_requests', String(pid || ''));
  return r && ['approved', 'bought'].includes(r.fields.status) ? r : null;
}
