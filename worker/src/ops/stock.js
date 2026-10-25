// Products, prices and stock. One set of records for the manager and finance.
//
// Products are menu_items (the same menu the QR self-ordering uses): name, category, unit,
// pricePesewas (selling price), costPesewas (purchase cost), lowStock, tracked (counted at the
// bar), available. Every change of price, cost or stock level goes into change_log.
//
// Stock is a ledger, never edited: stock_moves/{id}
//   productId, stationId, qty (+ in, − out), kind, businessDate, ref, reason, note, by, byName, at
//   kinds: received (+, from a supplier), transfer_in (+), transfer_out (−), return_in (+, a waiter
//   brought drinks back), issue (−, handed to a waiter or a QR customer), waste (−, broken/spilled),
//   correction (±, finance fixed a mistake: a deleted or changed entry, or the number set by hand)
// A drink leaves the bar's stock exactly once: when the bar hands it over (issue). A sale or a
// payment never moves stock, so nothing is deducted twice.
//
// Counts: stock_counts/{date}__{stationId}__{opening|closing}: the bar's physical count. Expected
// closing = opening + received + transfers in + returns − issued − waste − transfers out.
// A submitted count is locked; a correction is an approval (ops/approvals.js) and keeps the original.
//
// New stock: stock_deliveries/{id}, with what it cost.
//   Finance records a drink purchase (the manager buys and brings the drinks): it is the bar's stock
//   at once. During the night the manager adds stock: finance sees it, and the bar confirms it
//   arrived before it counts. Stock the bar records needs finance or a manager to confirm.
// Who recorded it, who confirmed it, and any difference in the number are kept.
//
// Mistakes (an entry made twice, a wrong number): finance deletes the entry or changes its number,
// or sets the number of a drink in a bar by hand. Nothing is erased: the entry is marked deleted
// (or changed) with who, when and why, and a correction move puts the bar's stock right (on the
// night the entry was for, so that night's figures are right too). Every fix is in the change log.
//
// The bar's count when it opens (Friday, Saturday): compared with what the system says is left.
// A difference never stops sales; it is flagged for the manager to explain (the manager has the
// keys), and from then on the bar sells from what it actually counted.
//
// A drink no longer sold is deleted (finance): it leaves the menu, the bar and the QR menu, but
// the record stays (marked deleted, with who and why) so past nights' sheets and reports stay right.
// Only a drink with nothing left in any bar can be deleted.
//
// Nothing sells past zero: stockLeft() is what should be in the bar minus what's already ordered
// but not yet handed over. Waiter orders, quick sales and QR orders are refused when it runs out.
import { getDoc, setDoc, queryWhere, listDocs, queryRecent, batchGet, commitTx, updateWrite, foundFields, withTransaction } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, STOCK, uidOf } from '../lib/auth.js';
import { FORBIDDEN, bizDate, dateOr, who, audit, logChange, closedError, int } from './common.js';
import { approvedPurchase, notePurchaseReceived } from './purchases.js';

export const STOCK_HANDS = [...STOCK, 'barManager', 'barStaff']; // may record deliveries, transfers, breakages, counts
export const STOCK_APPROVERS = [...STOCK, 'barManager'];          // confirm what the bar recorded; review counts
const MENU_READERS = [...STOCK, 'barManager', 'barStaff', 'waitStaff', 'cashier', 'eventManager'];
export const UNITS = ['bottle', 'can', 'glass', 'shot', 'jug', 'pack', 'item'];
export const WASTE_REASONS = { broken: 'Broken', spilled: 'Spilled', expired: 'Expired / bad', other: 'Other' };
export const COUNT_REASONS = { not_recorded: 'Sold or given but not recorded', broken: 'Broken, not recorded', miscount: 'Counted wrong earlier', delivery: 'Delivery not recorded', unknown: 'Don’t know' };

const productView = (d, withCost) => ({
  id: d.id, name: d.fields.name, category: d.fields.category || 'Drinks', unit: d.fields.unit || 'bottle',
  pricePesewas: Number(d.fields.pricePesewas || 0), available: d.fields.available !== false, tracked: d.fields.tracked !== false,
  lowStock: Number(d.fields.lowStock || 0), maxStock: Number(d.fields.maxStock || 0), sortOrder: d.fields.sortOrder ?? 0,
  ...(withCost ? { costPesewas: Number(d.fields.costPesewas || 0), updatedByName: d.fields.updatedByName || '', updatedAt: d.fields.updatedAt || '' } : {}),
});
const sortProducts = (a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

// With a stationId: each counted drink also says how many are left to sell at that bar (`left`;
// null for drinks the bar doesn't count).
export async function listProducts(env, user, { stationId } = {}) {
  if (!requireRole(user, MENU_READERS)) return FORBIDDEN;
  const withCost = requireRole(user, STOCK);
  const [items, stations] = await Promise.all([listDocs(env, 'menu_items'), listDocs(env, 'bar_stations')]);
  const left = stationId ? await stockLeft(env, stationId) : null;
  const products = items.filter(d => !d.fields.deleted).map(d => ({ ...productView(d, withCost), ...(left ? { left: d.id in left ? left[d.id] : null } : {}) })).sort(sortProducts);
  return { products, stations: stations.map(s => ({ id: s.id, name: s.fields.name })).sort((a, b) => a.name.localeCompare(b.name)), units: UNITS };
}

// Finance sets the selling price and the cost price (what the club pays for one), so the director
// can see the profit on every drink.
export const PRICE_SETTERS = ['finance', 'superAdmin'];
export async function saveProduct(env, b, user) {
  if (!requireRole(user, PRICE_SETTERS)) return { error: 'Only the finance officer sets drinks and prices.', status: 403 };
  const name = clean(b?.name, 60), price = int(b?.pricePesewas), cost = b?.costPesewas === '' || b?.costPesewas == null ? NaN : int(b.costPesewas);
  if (!name) return { error: 'Add the drink’s name.' };
  if (!(price >= 100)) return { error: 'Add a selling price of at least GHS 1.' };
  if (!(cost >= 0)) return { error: 'Add the cost price: what the club pays for one.' };
  const low = b?.lowStock === '' || b?.lowStock == null ? 0 : int(b.lowStock);
  if (!(low >= 0)) return { error: 'The low-stock warning is a number of units (or blank).' };
  const max = b?.maxStock === '' || b?.maxStock == null ? 0 : int(b.maxStock);
  if (!(max >= 0)) return { error: 'The most to hold is a number of units (or blank).' };
  if (max && max < low) return { error: 'The most to hold can’t be below the minimum.' };
  const existing = b?.id ? await getDoc(env, 'menu_items', String(b.id)) : null;
  if (b?.id && !existing) return { error: 'Product not found.', status: 404 };
  if (existing?.fields.deleted) return { error: `${existing.fields.name} was deleted. Add it again as a new drink.` };
  const pid = existing?.id || id(), old = existing?.fields || {};
  const fields = {
    ...old, name, category: clean(b.category, 30) || 'Drinks', unit: UNITS.includes(b.unit) ? b.unit : (old.unit || 'bottle'),
    pricePesewas: price, costPesewas: cost, lowStock: low, maxStock: max, tracked: b.tracked !== false, available: b.available !== false, sortOrder: int(b.sortOrder) || 0,
    updatedAt: now(), updatedBy: uidOf(user), updatedByName: user.name || '', createdAt: old.createdAt || now(),
  };
  await setDoc(env, 'menu_items', pid, fields);
  // Who changed what: the old value and the new value, for every field that matters.
  const watch = [['pricePesewas', 'price'], ['costPesewas', 'cost'], ['lowStock', 'minimum stock'], ['maxStock', 'maximum stock'], ['available', 'on sale'], ['name', 'name']];
  for (const [k, label] of watch) if (!existing || old[k] !== fields[k]) await logChange(env, user, { kind: existing ? 'product' : 'product_added', refId: pid, refName: name, field: label, from: existing ? old[k] ?? null : null, to: fields[k] });
  await audit(env, user, existing ? 'PRODUCT_UPDATED' : 'PRODUCT_ADDED', { productId: pid, name, pricePesewas: price });
  return { id: pid };
}

// The bar marks a drink finished (or back) for tonight: no price change, recorded.
export async function setAvailable(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const p = await getDoc(env, 'menu_items', String(b?.id || ''));
  if (!p || p.fields.deleted) return { error: 'Drink not found.', status: 404 };
  const available = b.available === true;
  if ((p.fields.available !== false) === available) return { available };
  await setDoc(env, 'menu_items', p.id, { ...p.fields, available, updatedAt: now(), updatedBy: uidOf(user), updatedByName: user.name || '' });
  await logChange(env, user, { kind: 'product', refId: p.id, refName: p.fields.name, field: 'on sale', from: !available, to: available });
  return { available };
}

// Finance deletes a drink the club no longer sells. Only when no bar has any of it left and no new
// stock of it is waiting to be confirmed (so no stock vanishes from the books). A reason is required.
// The record is kept, marked deleted: past sheets, bills and reports still show it.
export async function deleteProduct(env, b, user) {
  if (!requireRole(user, PRICE_SETTERS)) return { error: 'Only the finance officer deletes drinks.', status: 403 };
  const p = await getDoc(env, 'menu_items', String(b?.id || ''));
  if (!p || p.fields.deleted) return { error: 'Drink not found.', status: 404 };
  const reason = clean(b?.reason, 200);
  if (!reason) return { error: 'Say why it’s deleted, e.g. “we don’t sell it any more”.' };
  const name = p.fields.name;
  if (p.fields.tracked !== false) {
    for (const s of await listDocs(env, 'bar_stations')) {
      const { rows } = await sheetFor(env, { id: s.id, ...s.fields }, bizDate(), { withComps: false });
      const left = rows.find(r => r.productId === p.id)?.expected || 0;
      if (left > 0) return { error: `${s.fields.name} still has ${left} ${name}. Sell, move or set its number to 0 first.` };
    }
  }
  const waiting = (await queryWhere(env, 'stock_deliveries', [{ field: 'productId', value: p.id }])).some(d => d.fields.status === 'pending');
  if (waiting) return { error: `New stock of ${name} is waiting to be confirmed. Confirm or delete it first.` };
  // Ordered but not handed over yet (a waiter's round, a paid QR order): finish those first.
  for (const status of ['waiting', 'preparing', 'ready', 'taken']) {
    if ((await queryWhere(env, 'rounds', [{ field: 'status', value: status }])).some(r => (r.fields.lines || []).some(l => l.productId === p.id))) return { error: `${name} is on an order the bar hasn’t handed over yet. Finish it first.` };
  }
  if ((await queryWhere(env, 'counter_orders', [{ field: 'status', value: 'paid' }])).some(o => (o.fields.lines || []).some(l => l.itemId === p.id))) return { error: `${name} is on a paid QR order waiting for pickup. Hand it over first.` };
  await setDoc(env, 'menu_items', p.id, { ...p.fields, deleted: true, available: false, deletedAt: now(), deletedBy: uidOf(user), deletedByName: user.name || '', deleteReason: reason });
  await logChange(env, user, { kind: 'product_deleted', refId: p.id, refName: name, field: 'deleted', from: false, to: true, note: reason });
  await audit(env, user, 'PRODUCT_DELETED', { productId: p.id, name, reason });
  return { deleted: true };
}

// ── The ledger ──
export async function addMoves(env, moves, user) {
  const at = now();
  for (const m of moves) await setDoc(env, 'stock_moves', id(), { ...m, businessDate: m.businessDate || bizDate(), ...who(user), at });
}
async function product(env, productId) { const p = await getDoc(env, 'menu_items', String(productId || '')); return p && !p.fields.deleted ? { id: p.id, ...p.fields } : null; }
async function station(env, stationId) { const s = await getDoc(env, 'bar_stations', String(stationId || '')); return s ? { id: s.id, ...s.fields } : null; }

export const PURCHASERS = ['finance', 'director', 'superAdmin'];   // their purchases count at once
export async function recordReceived(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const [p, st] = await Promise.all([product(env, b?.productId), station(env, b?.stationId)]);
  if (!p) return { error: 'Pick the drink.' }; if (!st) return { error: 'Pick the bar it went to.' };
  const qty = int(b.qty); if (!(qty >= 1 && qty <= 10000)) return { error: 'How many? A whole number.' };
  const closed = await closedError(env, bizDate()); if (closed) return closed;
  const auto = requireRole(user, PURCHASERS), byBar = !requireRole(user, STOCK);
  // Bought against an approved purchase request (the Manager buys what finance and a director approved).
  const purchaseId = b?.purchaseId ? String(b.purchaseId) : '';
  if (purchaseId) {
    const pr = await approvedPurchase(env, purchaseId);
    if (!pr) return { error: 'That purchase isn’t approved yet.' };
    if (!pr.fields.lines.some(l => l.productId === p.id)) return { error: `${p.name} isn’t on that purchase.` };
  }
  // What it cost: the total paid (or the price of one). Needed for a purchase finance records.
  const total = b.totalCostPesewas === '' || b.totalCostPesewas == null ? null : int(b.totalCostPesewas);
  const unit = b.unitCostPesewas === '' || b.unitCostPesewas == null ? null : int(b.unitCostPesewas);
  if ((total != null && !(total >= 0)) || (unit != null && !(unit >= 0))) return { error: 'The amount paid must be a number.' };
  const totalCost = total ?? (unit != null ? unit * qty : null);
  if (auto && totalCost == null) return { error: 'Enter the total amount paid for these drinks.' };
  const did = id(), at = now(), byName = user.name || '';
  const rec = { productId: p.id, productName: p.name, stationId: st.id, stationName: st.name, qty, supplier: clean(b.supplier, 80), reference: clean(b.reference, 60),
    totalCostPesewas: totalCost, unitCostPesewas: totalCost == null ? null : Math.round(totalCost / qty), note: clean(b.note, 200), businessDate: bizDate(), purchaseId,
    status: auto ? 'confirmed' : 'pending', purchase: auto, byBar, recordedBy: uidOf(user), recordedByName: byName, recordedRole: user.role, recordedAt: at,
    ...(auto ? { confirmedQty: qty, confirmedBy: uidOf(user), confirmedByName: byName, confirmedAt: at } : {}) };
  await setDoc(env, 'stock_deliveries', did, rec);
  if (purchaseId) await notePurchaseReceived(env, purchaseId, p.id, qty);
  if (auto) await addMoves(env, [{ productId: p.id, productName: p.name, stationId: st.id, qty, kind: 'received', supplier: rec.supplier, reference: rec.reference, unitCostPesewas: rec.unitCostPesewas, note: rec.note, deliveryId: did, purchase: true }], user);
  await logChange(env, user, { kind: 'stock', refId: p.id, refName: p.name, field: auto ? `drinks bought for ${st.name}` : `new stock recorded for ${st.name} (waiting to be confirmed)`, from: null, to: qty, note: [rec.supplier, rec.reference, totalCost != null ? `paid GHS ${totalCost / 100}` : ''].filter(Boolean).join(' · ') });
  await audit(env, user, auto ? 'STOCK_PURCHASE_RECORDED' : 'STOCK_DELIVERY_RECORDED', { deliveryId: did, productId: p.id, stationId: st.id, qty, totalCostPesewas: totalCost });
  return { recorded: true, pending: !auto, id: did, confirmBy: auto ? null : byBar ? 'finance or a manager' : 'the bar' };
}

const deliveryView = d => ({ id: d.id, productId: d.fields.productId, productName: d.fields.productName, stationId: d.fields.stationId, stationName: d.fields.stationName, qty: d.fields.qty, confirmedQty: d.fields.confirmedQty ?? null,
  purchase: !!d.fields.purchase, totalCostPesewas: d.fields.totalCostPesewas ?? null, recordedRole: d.fields.recordedRole || '',
  supplier: d.fields.supplier || '', reference: d.fields.reference || '', status: d.fields.status, byBar: !!d.fields.byBar, recordedByName: d.fields.recordedByName || '', recordedAt: d.fields.recordedAt,
  confirmedByName: d.fields.confirmedByName || '', confirmedAt: d.fields.confirmedAt || '', note: d.fields.note || '', confirmNote: d.fields.confirmNote || '',
  removedByName: d.fields.removedByName || '', removedAt: d.fields.removedAt || '', removeReason: d.fields.removeReason || '',
  edits: (d.fields.edits || []).map(e => ({ fromQty: e.fromQty, toQty: e.toQty, fromCostPesewas: e.fromCostPesewas ?? null, toCostPesewas: e.toCostPesewas ?? null, reason: e.reason, byName: e.byName, at: e.at })) });
// Who may confirm: never the person who recorded it; what the bar recorded needs finance or a manager.
const canConfirm = (user, f) => f.recordedBy !== uidOf(user) && (f.byBar ? requireRole(user, STOCK_APPROVERS) : requireRole(user, STOCK_HANDS));

// New stock for one bar (or every bar): waiting to be confirmed, and the last week's confirmed or refused.
export async function listDeliveries(env, user, { stationId } = {}) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const all = stationId ? await queryWhere(env, 'stock_deliveries', [{ field: 'stationId', value: String(stationId) }]) : await listDocs(env, 'stock_deliveries');
  const since = Date.now() - 7 * 864e5;
  const rows = all.filter(d => d.fields.status === 'pending' || new Date(d.fields.confirmedAt || d.fields.recordedAt).getTime() > since)
    .sort((a, b) => String(b.fields.recordedAt).localeCompare(String(a.fields.recordedAt))).slice(0, 100)
    .map(d => ({ ...deliveryView(d), canConfirm: d.fields.status === 'pending' && !!canConfirm(user, d.fields), canFix: d.fields.status !== 'removed' && !!requireRole(user, STOCK_FIXERS) }));
  return { deliveries: rows, canFix: !!requireRole(user, STOCK_FIXERS), pending: rows.filter(d => d.status === 'pending').length, forMe: rows.filter(d => d.canConfirm).length };
}

// Confirm what arrived (the number actually there; a different number needs a note), or say it didn't come.
export async function decideDelivery(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const did = String(b?.id || '');
  const res = await withTransaction(env, async tx => {
    const d = foundFields(await batchGet(env, [`stock_deliveries/${did}`], tx), `/stock_deliveries/${did}`);
    if (!d) return { error: 'Delivery not found.', status: 404 };
    const f = d.fields;
    if (f.status !== 'pending') return { error: f.status === 'confirmed' ? `Already confirmed by ${f.confirmedByName}.` : 'Already marked as not arrived.' };
    if (f.recordedBy === uidOf(user)) return { error: 'Someone else must confirm stock you recorded.', status: 403 };
    if (!canConfirm(user, f)) return { error: 'Finance or a manager must confirm stock the bar recorded.', status: 403 };
    const note = clean(b?.note, 200), at = now();
    if (b?.action === 'reject') {
      if (!note) return { error: 'Say what happened, e.g. it didn’t arrive.' };
      await commitTx(env, [updateWrite(env, 'stock_deliveries', did, { ...f, status: 'rejected', confirmedBy: uidOf(user), confirmedByName: user.name || '', confirmedAt: at, confirmNote: note })], tx);
      return { rejected: true, f };
    }
    const qty = b?.qty == null || b.qty === '' ? f.qty : int(b.qty);
    if (!(qty >= 0 && qty <= 10000)) return { error: 'How many arrived? A whole number.' };
    if (qty !== f.qty && !note) return { error: `${f.qty} were recorded but you counted ${qty}. Say what happened.` };
    await commitTx(env, [updateWrite(env, 'stock_deliveries', did, { ...f, status: 'confirmed', confirmedQty: qty, confirmedBy: uidOf(user), confirmedByName: user.name || '', confirmedAt: at, confirmNote: note })], tx);
    return { confirmed: true, qty, f };
  });
  if (res.error) return res;
  const { f } = res; delete res.f;
  if (res.confirmed && res.qty > 0) await addMoves(env, [{ productId: f.productId, productName: f.productName, stationId: f.stationId, qty: res.qty, kind: 'received', supplier: f.supplier || '', reference: f.reference || '', unitCostPesewas: f.unitCostPesewas ?? null, note: f.note || '', deliveryId: did, recordedByName: f.recordedByName }], user);
  await logChange(env, user, { kind: 'stock', refId: f.productId, refName: f.productName, field: res.confirmed ? `new stock confirmed at ${f.stationName}` : `new stock refused at ${f.stationName}`, from: f.qty, to: res.confirmed ? res.qty : 0, note: clean(b?.note, 200) });
  await audit(env, user, res.confirmed ? 'STOCK_DELIVERY_CONFIRMED' : 'STOCK_DELIVERY_REJECTED', { deliveryId: did, recordedQty: f.qty, qty: res.qty ?? 0 });
  return res;
}

// ── Fixing mistakes ──
export const STOCK_FIXERS = ['finance', 'director', 'superAdmin'];
const NOT_FIXER = { error: 'Only finance (or a director) can delete or change stock entries.', status: 403 };
// Delete an entry (action: 'remove'), or change its number and what was paid ({ qty, totalCostPesewas }).
// A reason is required. What the entry put into the bar's stock is corrected.
export async function fixDelivery(env, b, user) {
  if (!requireRole(user, STOCK_FIXERS)) return NOT_FIXER;
  const did = String(b?.id || ''), reason = clean(b?.reason, 200), remove = b?.action === 'remove';
  if (!reason) return { error: remove ? 'Say why it’s deleted, e.g. “entered twice”.' : 'Say why it’s changed, e.g. “typed 240, it was 24”.' };
  const res = await withTransaction(env, async tx => {
    const d = foundFields(await batchGet(env, [`stock_deliveries/${did}`], tx), `/stock_deliveries/${did}`);
    if (!d) return { error: 'Entry not found.', status: 404 };
    const f = d.fields, at = now(), by = { uid: uidOf(user), name: user.name || '' };
    if (f.status === 'removed') return { error: `Already deleted by ${f.removedByName || 'someone'}.` };
    // What this entry has put into the bar's stock so far (pending or refused: nothing).
    const inStock = f.status === 'confirmed' ? Number(f.confirmedQty ?? f.qty) : 0;
    if (remove) {
      await commitTx(env, [updateWrite(env, 'stock_deliveries', did, { ...f, status: 'removed', removedFrom: f.status, removedBy: by.uid, removedByName: by.name, removedAt: at, removeReason: reason })], tx);
      return { f, delta: -inStock, removed: true };
    }
    if (f.status === 'rejected') return { error: 'This stock was marked as not arrived. If it came, record it again.' };
    const qty = int(b?.qty);
    if (!(qty >= 1 && qty <= 10000)) return { error: 'The right number: a whole number from 1. To take it off completely, delete it.' };
    const cost = b?.totalCostPesewas === '' || b?.totalCostPesewas == null ? undefined : int(b.totalCostPesewas);
    if (cost !== undefined && !(cost >= 0)) return { error: 'The amount paid must be a number.' };
    const fromQty = f.status === 'confirmed' ? inStock : Number(f.qty), totalCost = cost !== undefined ? cost : f.totalCostPesewas ?? null;
    if (qty === fromQty && totalCost === (f.totalCostPesewas ?? null)) return { error: 'Nothing changed.' };
    const next = { ...f, qty, ...(f.status === 'confirmed' ? { confirmedQty: qty } : {}), totalCostPesewas: totalCost, unitCostPesewas: totalCost == null ? null : Math.round(totalCost / qty),
      edits: [...(f.edits || []), { fromQty, toQty: qty, fromCostPesewas: f.totalCostPesewas ?? null, toCostPesewas: totalCost, reason, by: by.uid, byName: by.name, at }] };
    await commitTx(env, [updateWrite(env, 'stock_deliveries', did, next)], tx);
    return { f, delta: f.status === 'confirmed' ? qty - inStock : 0, changed: true, fromQty, qty };
  });
  if (res.error) return res;
  const { f, delta } = res;
  if (delta) await addMoves(env, [{ productId: f.productId, productName: f.productName, stationId: f.stationId, qty: delta, kind: 'correction', reason: res.removed ? 'entry_deleted' : 'entry_changed', note: reason, deliveryId: did, businessDate: f.businessDate || bizDate() }], user);
  await logChange(env, user, { kind: 'stock', refId: f.productId, refName: f.productName, field: res.removed ? `stock entry deleted (${f.stationName})` : `stock entry changed (${f.stationName})`, from: res.removed ? Number(f.qty) : res.fromQty, to: res.removed ? 0 : res.qty, note: reason });
  await audit(env, user, res.removed ? 'STOCK_ENTRY_DELETED' : 'STOCK_ENTRY_CHANGED', { deliveryId: did, productId: f.productId, stockChange: delta, reason });
  return { ...(res.removed ? { removed: true } : { changed: true, qty: res.qty }), stockChange: delta };
}

// Set how many of a drink are in a bar now (e.g. after a recount). The difference from what the
// records say goes in as a correction, with the reason.
export async function setStockLevel(env, b, user) {
  if (!requireRole(user, STOCK_FIXERS)) return NOT_FIXER;
  const [p, st] = await Promise.all([product(env, b?.productId), station(env, b?.stationId)]);
  if (!p) return { error: 'Pick the drink.' }; if (!st) return { error: 'Pick the bar.' };
  const qty = int(b?.qty); if (!(qty >= 0 && qty <= 100000)) return { error: 'How many are there? A whole number (0 if none).' };
  const reason = clean(b?.reason, 200); if (!reason) return { error: 'Say why, e.g. “recounted the store”.' };
  const { rows } = await sheetFor(env, st, bizDate(), { withComps: false });
  const r = rows.find(x => x.productId === p.id);
  if (!r) return { error: `${p.name} isn’t counted at the bar. Turn on “Count it at the bar” for it first.` };
  const delta = qty - r.expected;
  if (!delta) return { unchanged: true, qty };
  await addMoves(env, [{ productId: p.id, productName: p.name, stationId: st.id, qty: delta, kind: 'correction', reason: 'set_level', note: reason }], user);
  await logChange(env, user, { kind: 'stock', refId: p.id, refName: p.name, field: `number in ${st.name} set by hand`, from: r.expected, to: qty, note: reason });
  await audit(env, user, 'STOCK_LEVEL_SET', { productId: p.id, stationId: st.id, from: r.expected, to: qty, reason });
  return { set: true, from: r.expected, qty, stockChange: delta };
}

export async function recordTransfer(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const [p, from, to] = await Promise.all([product(env, b?.productId), station(env, b?.fromStationId), station(env, b?.toStationId)]);
  if (!p) return { error: 'Pick the drink.' }; if (!from || !to || from.id === to.id) return { error: 'Pick the bar it left and the bar it went to.' };
  const qty = int(b.qty); if (!(qty >= 1 && qty <= 10000)) return { error: 'How many? A whole number.' };
  const closed = await closedError(env, bizDate()); if (closed) return closed;
  const ref = id();
  await addMoves(env, [
    { productId: p.id, productName: p.name, stationId: from.id, qty: -qty, kind: 'transfer_out', ref, toStationId: to.id, note: clean(b.note, 200) },
    { productId: p.id, productName: p.name, stationId: to.id, qty, kind: 'transfer_in', ref, fromStationId: from.id, note: clean(b.note, 200) },
  ], user);
  await logChange(env, user, { kind: 'stock', refId: p.id, refName: p.name, field: `moved ${from.name} → ${to.name}`, from: null, to: qty });
  return { recorded: true };
}

export async function recordWaste(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const [p, st] = await Promise.all([product(env, b?.productId), station(env, b?.stationId)]);
  if (!p) return { error: 'Pick the drink.' }; if (!st) return { error: 'Pick the bar.' };
  const qty = int(b.qty); if (!(qty >= 1 && qty <= 1000)) return { error: 'How many? A whole number.' };
  if (!WASTE_REASONS[b.reason]) return { error: 'Pick what happened (broken, spilled…).' };
  const closed = await closedError(env, bizDate()); if (closed) return closed;
  await addMoves(env, [{ productId: p.id, productName: p.name, stationId: st.id, qty: -qty, kind: 'waste', reason: b.reason, note: clean(b.note, 200) }], user);
  return { recorded: true };
}

// ── The stock sheet: opening, everything recorded since, expected, and the count if there is one ──
// Opening for a night = its own opening count, or else the last closing count before it plus every
// move recorded on the nights in between (so stock added on a night nobody counted still carries on).
function openingFor(stationId, date, counts, moves) {
  const sumMoves = keep => moves.filter(m => keep(String(m.fields.businessDate || ''))).reduce((acc, m) => ({ ...acc, [m.fields.productId]: (acc[m.fields.productId] || 0) + Number(m.fields.qty || 0) }), {});
  const plus = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v; return o; };
  const own = counts.find(c => c.fields.date === date && c.fields.kind === 'opening');
  // The bar's opening count is the truth from then on. `base` takes off what was recorded tonight
  // before the count (it is in the count already), so nothing is added twice.
  if (own) return { source: 'opening_count', counts: Object.fromEntries(own.fields.lines.map(l => [l.productId, Number(l.base ?? l.counted)])), countedBy: own.fields.byName };
  const closing = counts.filter(c => c.fields.kind === 'closing' && c.fields.date < date).sort((a, b) => b.fields.date.localeCompare(a.fields.date))[0];
  if (closing) {
    const c = closing.fields, use = c.corrected || c;
    return { source: 'last_closing', fromDate: c.date, counts: plus(Object.fromEntries(use.lines.map(l => [l.productId, Number(l.counted)])), sumMoves(d => d > c.date && d < date)) };
  }
  const earlier = sumMoves(d => d < date);
  return { source: Object.keys(earlier).length ? 'earlier_moves' : 'none', counts: earlier };
}

async function sheetFor(env, st, d, { withComps = true } = {}) {
  const [items, allMoves, counts] = await Promise.all([
    listDocs(env, 'menu_items'), queryWhere(env, 'stock_moves', [{ field: 'stationId', value: st.id }], { limit: 20000 }),
    queryWhere(env, 'stock_counts', [{ field: 'stationId', value: st.id }]),
  ]);
  const opening = openingFor(st.id, d, counts, allMoves);
  const moves = allMoves.filter(m => m.fields.businessDate === d);
  const closing = counts.find(c => c.fields.date === d && c.fields.kind === 'closing');
  const comps = withComps ? (await queryWhere(env, 'rounds', [{ field: 'stationId', value: st.id }, { field: 'businessDate', value: d }]))
    .flatMap(r => r.fields.lines || []).reduce((m, l) => (l.compQty ? { ...m, [l.productId]: (m[l.productId] || 0) + l.compQty } : m), {}) : {};
  const counted = closing ? Object.fromEntries((closing.fields.corrected || closing.fields).lines.map(l => [l.productId, l])) : {};
  const rows = items.filter(i => i.fields.tracked !== false).map(i => {
    const mv = moves.filter(m => m.fields.productId === i.id), sum = k => mv.filter(m => m.fields.kind === k).reduce((n, m) => n + Math.abs(Number(m.fields.qty)), 0);
    const r = { productId: i.id, name: i.fields.name, category: i.fields.category || 'Drinks', unit: i.fields.unit || 'bottle', lowStock: Number(i.fields.lowStock || 0),
      opening: opening.counts[i.id] ?? 0, received: sum('received'), transferIn: sum('transfer_in'), returns: sum('return_in'), transferOut: sum('transfer_out'), issued: sum('issue'), comps: comps[i.id] || 0, waste: sum('waste'),
      corrections: mv.filter(m => m.fields.kind === 'correction').reduce((n, m) => n + Number(m.fields.qty || 0), 0) };
    r.expected = r.opening + r.received + r.transferIn + r.returns + r.corrections - r.issued - r.waste - r.transferOut;
    if (counted[i.id]) { r.counted = Number(counted[i.id].counted); r.difference = r.counted - r.expected; r.reason = counted[i.id].reason || ''; r.note = counted[i.id].note || ''; }
    r.low = r.lowStock > 0 && (r.counted ?? r.expected) <= r.lowStock;
    // A deleted drink stays on the sheet only for a night it still had stock or anything recorded.
    return i.fields.deleted && !r.opening && !mv.length && !r.comps && !counted[i.id] ? null : r;
  }).filter(Boolean).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return { opening, closing, rows };
}

export async function stockSheet(env, { stationId, date }, user) {
  if (!requireRole(user, [...STOCK_HANDS, 'eventManager'])) return FORBIDDEN;
  const d = dateOr(date), st = await station(env, stationId);
  if (!st) return { error: 'Pick the bar.' };
  const { opening, closing, rows } = await sheetFor(env, st, d);
  const pendingNew = (await queryWhere(env, 'stock_deliveries', [{ field: 'stationId', value: st.id }, { field: 'status', value: 'pending' }])).length;
  const oc = await getDoc(env, 'stock_counts', `${d}__${st.id}__opening`);
  return {
    openingCount: oc ? countView(oc.fields) : null,
    station: { id: st.id, name: st.name }, date: d, opening: { source: opening.source, fromDate: opening.fromDate || null },
    closing: closing ? { status: closing.fields.status, byName: closing.fields.byName, at: closing.fields.at, reviewedByName: closing.fields.reviewedByName || '', corrected: !!closing.fields.corrected } : null,
    rows, reasons: COUNT_REASONS, wasteReasons: WASTE_REASONS, pendingDeliveries: pendingNew,
  };
}

// ── What's left to sell at a bar right now ──
// Should be in the bar (tonight's sheet) minus what's ordered but not handed over yet: waiter orders
// at the bar, paid QR orders waiting for pickup, and QR orders being paid for (the last 30 minutes).
// Returns { productId: left } for counted drinks only; drinks not counted (tracked: false) never block.
export async function stockLeft(env, stationId) {
  const st = await station(env, stationId);
  if (!st) return {};
  const { rows } = await sheetFor(env, st, bizDate(), { withComps: false });
  const left = Object.fromEntries(rows.map(r => [r.productId, r.expected]));
  const take = (pid, n) => { if (pid in left) left[pid] -= Number(n || 0); };
  for (const status of ['waiting', 'preparing', 'ready', 'taken']) {
    for (const r of await queryWhere(env, 'rounds', [{ field: 'stationId', value: st.id }, { field: 'status', value: status }])) for (const l of r.fields.lines || []) take(l.productId, l.qty);
  }
  const fresh = Date.now() - 30 * 60e3;
  for (const status of ['paid', 'pending_payment']) {
    for (const o of await queryWhere(env, 'counter_orders', [{ field: 'stationId', value: st.id }, { field: 'status', value: status }])) {
      if (status === 'pending_payment' && !(new Date(o.fields.createdAt).getTime() > fresh)) continue;
      for (const l of o.fields.lines || []) take(l.itemId, l.qty);
    }
  }
  for (const k of Object.keys(left)) left[k] = Math.max(0, left[k]);
  return left;
}

// Refuses a basket the bar can't fill. want: [{ productId, name, qty }]. Returns an error or null.
export async function stockError(env, stationId, want, { guest = false } = {}) {
  const left = await stockLeft(env, stationId);
  const need = new Map();
  for (const w of want) need.set(w.productId, { name: w.name, qty: (need.get(w.productId)?.qty || 0) + Number(w.qty) });
  for (const [pid, w] of need) {
    if (!(pid in left) || w.qty <= left[pid]) continue;
    if (!left[pid]) return guest ? `Sorry, ${w.name} is finished. Take it off and try again.` : `${w.name} is finished at this bar. Take it off.`;
    return guest ? `Sorry, only ${left[pid]} ${w.name} left. Change the number and try again.` : `Only ${left[pid]} ${w.name} left at this bar. Change the number.`;
  }
  return null;
}

// The bar's physical count. Opening: only before the night has an opening. Closing: once; locked.
export async function submitCount(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const d = dateOr(b?.date), kind = b?.kind === 'opening' ? 'opening' : 'closing';
  const closed = await closedError(env, d); if (closed) return closed;
  const sheet = await stockSheet(env, { stationId: b?.stationId, date: d }, user); if (sheet.error) return sheet;
  const docId = `${d}__${sheet.station.id}__${kind}`;
  if (await getDoc(env, 'stock_counts', docId)) return { error: kind === 'closing' ? 'The closing count for this bar is already in. To change it, ask a manager for a correction.' : 'This bar already has an opening count for tonight.' };
  const given = new Map((Array.isArray(b.lines) ? b.lines : []).map(l => [String(l.productId), l]));
  const lines = [];
  for (const r of sheet.rows) {
    const l = given.get(r.productId), n = int(l?.counted);
    if (!(n >= 0)) return { error: `Enter the count for ${r.name} (0 if there are none).` };
    const diff = n - r.expected;
    if (kind === 'closing' && diff !== 0 && !COUNT_REASONS[l.reason]) return { error: `${r.name}: ${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} than expected. Pick a reason.` };
    // Opening: what the bar found against what the system says should be there. The manager explains
    // any difference; the bar doesn't have to.
    lines.push({ productId: r.productId, name: r.name, counted: n, expected: r.expected, difference: diff,
      ...(kind === 'closing' ? { reason: diff ? l.reason : '', note: clean(l.note, 200) } : { base: n - (r.expected - r.opening), note: clean(l?.note, 200) }) });
  }
  await setDoc(env, 'stock_counts', docId, { date: d, stationId: sheet.station.id, stationName: sheet.station.name, kind, lines, status: 'submitted', ...who(user), at: now() });
  await audit(env, user, kind === 'closing' ? 'STOCK_CLOSING_COUNTED' : 'STOCK_OPENING_COUNTED', { stationId: sheet.station.id, date: d, differences: lines.filter(l => l.difference).length });
  return { submitted: true, differences: lines.filter(l => l.difference).map(l => ({ name: l.name, difference: l.difference })) };
}

const countView = c => ({ kind: c.kind, byName: c.byName, at: c.at, stationId: c.stationId, stationName: c.stationName, date: c.date,
  differences: (c.lines || []).filter(l => l.difference).map(l => ({ name: l.name, expected: l.expected, counted: l.counted, difference: l.difference })),
  explanation: c.managerExplanation || '', explainedByName: c.explainedByName || '', explainedAt: c.explainedAt || '' });
const EXPLAINERS = ['superAdmin', 'director', 'manager'];

// Opening counts that came out different and the manager hasn't explained yet (the last 3 weeks).
export async function countsToExplain(env, user) {
  if (!requireRole(user, [...STOCK])) return FORBIDDEN;
  const recent = await queryRecent(env, 'stock_counts', 'at', new Date(Date.now() - 21 * 864e5), 200);
  const rows = recent.map(d => d.fields).filter(c => c.kind === 'opening' && (c.lines || []).some(l => l.difference)).map(countView);
  return { counts: rows.filter(c => !c.explanation), explained: rows.filter(c => c.explanation).slice(0, 20), canExplain: !!requireRole(user, EXPLAINERS) };
}

// The manager explains why the bar found a different number when it opened. Kept with the count.
export async function explainCount(env, b, user) {
  if (!requireRole(user, EXPLAINERS)) return { error: 'The manager explains stock differences.', status: 403 };
  const d = dateOr(b?.date), docId = `${d}__${String(b?.stationId || '')}__opening`;
  const c = await getDoc(env, 'stock_counts', docId);
  if (!c) return { error: 'That count isn’t in.', status: 404 };
  const note = clean(b?.note, 500);
  if (!note) return { error: 'Explain what happened to the stock.' };
  await setDoc(env, 'stock_counts', docId, { ...c.fields, managerExplanation: note, explainedBy: uidOf(user), explainedByName: user.name || '', explainedAt: now() });
  await audit(env, user, 'STOCK_DIFFERENCE_EXPLAINED', { docId });
  return { explained: true };
}

// Manager or finance looks at a submitted count (not the person who counted it).
export async function reviewCount(env, b, user) {
  if (!requireRole(user, STOCK_APPROVERS)) return FORBIDDEN;
  const docId = `${dateOr(b?.date)}__${String(b?.stationId || '')}__closing`;
  const c = await getDoc(env, 'stock_counts', docId);
  if (!c) return { error: 'That count isn’t in yet.', status: 404 };
  if (c.fields.by === uidOf(user)) return { error: 'Someone else must review your own count.' };
  await setDoc(env, 'stock_counts', docId, { ...c.fields, status: 'reviewed', reviewedBy: uidOf(user), reviewedByName: user.name || '', reviewedAt: now(), reviewNote: clean(b.note, 300) });
  await audit(env, user, 'STOCK_COUNT_REVIEWED', { docId });
  return { reviewed: true };
}

export async function changeLog(env, user, { limit = 200 } = {}) {
  if (!requireRole(user, STOCK)) return FORBIDDEN;
  const rows = (await queryRecent(env, 'change_log', 'at', new Date(Date.now() - 60 * 864e5), limit)).map(d => d.fields);
  return { changes: rows };
}
