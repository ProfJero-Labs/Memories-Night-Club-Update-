// Products, prices and stock. One set of records for the manager and finance.
//
// Products are menu_items (the same menu the QR self-ordering uses): name, category, unit,
// pricePesewas (selling price), costPesewas (purchase cost), lowStock, tracked (counted at the
// bar), available. Every change of price, cost or stock level goes into change_log.
//
// Stock is a ledger, never edited: stock_moves/{id}
//   productId, stationId, qty (+ in, − out), kind, businessDate, ref, reason, note, by, byName, at
//   kinds: received (+, from a supplier), transfer_in (+), transfer_out (−), return_in (+, a waiter
//   brought drinks back), issue (−, handed to a waiter or a QR customer), waste (−, broken/spilled)
// A drink leaves the bar's stock exactly once: when the bar hands it over (issue). A sale or a
// payment never moves stock, so nothing is deducted twice.
//
// Counts: stock_counts/{date}__{stationId}__{opening|closing}: the bar's physical count. Expected
// closing = opening + received + transfers in + returns − issued − waste − transfers out.
// A submitted count is locked; a correction is an approval (ops/approvals.js) and keeps the original.
import { getDoc, setDoc, queryWhere, listDocs, queryRecent } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, STOCK, uidOf } from '../lib/auth.js';
import { FORBIDDEN, bizDate, dateOr, who, audit, logChange, closedError, int } from './common.js';

export const STOCK_HANDS = [...STOCK, 'barStaff'];           // may record deliveries, transfers, breakages, counts
const MENU_READERS = [...STOCK, 'barStaff', 'waitStaff', 'cashier', 'eventManager'];
export const UNITS = ['bottle', 'can', 'glass', 'shot', 'jug', 'pack', 'item'];
export const WASTE_REASONS = { broken: 'Broken', spilled: 'Spilled', expired: 'Expired / bad', other: 'Other' };
export const COUNT_REASONS = { not_recorded: 'Sold or given but not recorded', broken: 'Broken, not recorded', miscount: 'Counted wrong earlier', delivery: 'Delivery not recorded', unknown: 'Don’t know' };

const productView = (d, withCost) => ({
  id: d.id, name: d.fields.name, category: d.fields.category || 'Drinks', unit: d.fields.unit || 'bottle',
  pricePesewas: Number(d.fields.pricePesewas || 0), available: d.fields.available !== false, tracked: d.fields.tracked !== false,
  lowStock: Number(d.fields.lowStock || 0), sortOrder: d.fields.sortOrder ?? 0,
  ...(withCost ? { costPesewas: Number(d.fields.costPesewas || 0), updatedByName: d.fields.updatedByName || '', updatedAt: d.fields.updatedAt || '' } : {}),
});
const sortProducts = (a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export async function listProducts(env, user) {
  if (!requireRole(user, MENU_READERS)) return FORBIDDEN;
  const withCost = requireRole(user, STOCK);
  const [items, stations] = await Promise.all([listDocs(env, 'menu_items'), listDocs(env, 'bar_stations')]);
  return { products: items.map(d => productView(d, withCost)).sort(sortProducts), stations: stations.map(s => ({ id: s.id, name: s.fields.name })).sort((a, b) => a.name.localeCompare(b.name)), units: UNITS };
}

export async function saveProduct(env, b, user) {
  if (!requireRole(user, STOCK)) return { error: 'Only a manager or the finance officer can change products and prices.', status: 403 };
  const name = clean(b?.name, 60), price = int(b?.pricePesewas), cost = b?.costPesewas === '' || b?.costPesewas == null ? 0 : int(b.costPesewas);
  if (!name) return { error: 'Add the drink’s name.' };
  if (!(price >= 100)) return { error: 'Add a selling price of at least GHS 1.' };
  if (!(cost >= 0)) return { error: 'The cost must be a number (or blank).' };
  const low = b?.lowStock === '' || b?.lowStock == null ? 0 : int(b.lowStock);
  if (!(low >= 0)) return { error: 'The low-stock warning is a number of units (or blank).' };
  const existing = b?.id ? await getDoc(env, 'menu_items', String(b.id)) : null;
  if (b?.id && !existing) return { error: 'Product not found.', status: 404 };
  const pid = existing?.id || id(), old = existing?.fields || {};
  const fields = {
    ...old, name, category: clean(b.category, 30) || 'Drinks', unit: UNITS.includes(b.unit) ? b.unit : (old.unit || 'bottle'),
    pricePesewas: price, costPesewas: cost, lowStock: low, tracked: b.tracked !== false, available: b.available !== false, sortOrder: int(b.sortOrder) || 0,
    updatedAt: now(), updatedBy: uidOf(user), updatedByName: user.name || '', createdAt: old.createdAt || now(),
  };
  await setDoc(env, 'menu_items', pid, fields);
  // Who changed what: the old value and the new value, for every field that matters.
  const watch = [['pricePesewas', 'price'], ['costPesewas', 'cost'], ['lowStock', 'low stock warning'], ['available', 'on sale'], ['name', 'name']];
  for (const [k, label] of watch) if (!existing || old[k] !== fields[k]) await logChange(env, user, { kind: existing ? 'product' : 'product_added', refId: pid, refName: name, field: label, from: existing ? old[k] ?? null : null, to: fields[k] });
  await audit(env, user, existing ? 'PRODUCT_UPDATED' : 'PRODUCT_ADDED', { productId: pid, name, pricePesewas: price });
  return { id: pid };
}

// ── The ledger ──
export async function addMoves(env, moves, user) {
  const at = now();
  for (const m of moves) await setDoc(env, 'stock_moves', id(), { ...m, businessDate: m.businessDate || bizDate(), ...who(user), at });
}
async function product(env, productId) { const p = await getDoc(env, 'menu_items', String(productId || '')); return p ? { id: p.id, ...p.fields } : null; }
async function station(env, stationId) { const s = await getDoc(env, 'bar_stations', String(stationId || '')); return s ? { id: s.id, ...s.fields } : null; }

export async function recordReceived(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const [p, st] = await Promise.all([product(env, b?.productId), station(env, b?.stationId)]);
  if (!p) return { error: 'Pick the drink.' }; if (!st) return { error: 'Pick the bar it went to.' };
  const qty = int(b.qty); if (!(qty >= 1 && qty <= 10000)) return { error: 'How many arrived? A whole number.' };
  const closed = await closedError(env, bizDate()); if (closed) return closed;
  const unitCost = b.unitCostPesewas === '' || b.unitCostPesewas == null ? null : int(b.unitCostPesewas);
  await addMoves(env, [{ productId: p.id, productName: p.name, stationId: st.id, qty, kind: 'received', supplier: clean(b.supplier, 80), reference: clean(b.reference, 60), unitCostPesewas: unitCost >= 0 ? unitCost : null, note: clean(b.note, 200) }], user);
  await logChange(env, user, { kind: 'stock', refId: p.id, refName: p.name, field: `received at ${st.name}`, from: null, to: qty, note: [clean(b.supplier, 80), clean(b.reference, 60)].filter(Boolean).join(' · ') });
  return { recorded: true };
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
async function openingFor(env, stationId, date) {
  const own = await getDoc(env, 'stock_counts', `${date}__${stationId}__opening`);
  if (own) return { source: 'opening_count', counts: Object.fromEntries(own.fields.lines.map(l => [l.productId, Number(l.counted)])), countedBy: own.fields.byName };
  const closings = (await queryWhere(env, 'stock_counts', [{ field: 'stationId', value: stationId }, { field: 'kind', value: 'closing' }])).filter(c => c.fields.date < date).sort((a, b) => b.fields.date.localeCompare(a.fields.date));
  if (closings[0]) {
    const c = closings[0].fields, use = c.corrected || c;
    return { source: 'last_closing', fromDate: c.date, counts: Object.fromEntries(use.lines.map(l => [l.productId, Number(l.counted)])) };
  }
  return { source: 'none', counts: {} };
}

export async function stockSheet(env, { stationId, date }, user) {
  if (!requireRole(user, [...STOCK_HANDS, 'eventManager'])) return FORBIDDEN;
  const d = dateOr(date), st = await station(env, stationId);
  if (!st) return { error: 'Pick the bar.' };
  const [items, moves, opening, closing] = await Promise.all([
    listDocs(env, 'menu_items'), queryWhere(env, 'stock_moves', [{ field: 'stationId', value: st.id }, { field: 'businessDate', value: d }]),
    openingFor(env, st.id, d), getDoc(env, 'stock_counts', `${d}__${st.id}__closing`),
  ]);
  const comps = (await queryWhere(env, 'rounds', [{ field: 'stationId', value: st.id }, { field: 'businessDate', value: d }]))
    .flatMap(r => r.fields.lines || []).reduce((m, l) => (l.compQty ? { ...m, [l.productId]: (m[l.productId] || 0) + l.compQty } : m), {});
  const counted = closing ? Object.fromEntries((closing.fields.corrected || closing.fields).lines.map(l => [l.productId, l])) : {};
  const rows = items.filter(i => i.fields.tracked !== false).map(i => {
    const mv = moves.filter(m => m.fields.productId === i.id), sum = k => mv.filter(m => m.fields.kind === k).reduce((n, m) => n + Math.abs(Number(m.fields.qty)), 0);
    const r = { productId: i.id, name: i.fields.name, category: i.fields.category || 'Drinks', unit: i.fields.unit || 'bottle', lowStock: Number(i.fields.lowStock || 0),
      opening: opening.counts[i.id] ?? 0, received: sum('received'), transferIn: sum('transfer_in'), returns: sum('return_in'), transferOut: sum('transfer_out'), issued: sum('issue'), comps: comps[i.id] || 0, waste: sum('waste') };
    r.expected = r.opening + r.received + r.transferIn + r.returns - r.issued - r.waste - r.transferOut;
    if (counted[i.id]) { r.counted = Number(counted[i.id].counted); r.difference = r.counted - r.expected; r.reason = counted[i.id].reason || ''; r.note = counted[i.id].note || ''; }
    r.low = r.lowStock > 0 && (r.counted ?? r.expected) <= r.lowStock;
    return r;
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  return {
    station: { id: st.id, name: st.name }, date: d, opening: { source: opening.source, fromDate: opening.fromDate || null },
    closing: closing ? { status: closing.fields.status, byName: closing.fields.byName, at: closing.fields.at, reviewedByName: closing.fields.reviewedByName || '', corrected: !!closing.fields.corrected } : null,
    rows, reasons: COUNT_REASONS, wasteReasons: WASTE_REASONS,
  };
}

// The bar's physical count. Opening: only before the night has an opening. Closing: once; locked.
export async function submitCount(env, b, user) {
  if (!requireRole(user, STOCK_HANDS)) return FORBIDDEN;
  const d = dateOr(b?.date), kind = b?.kind === 'opening' ? 'opening' : 'closing';
  const closed = await closedError(env, d); if (closed) return closed;
  const sheet = await stockSheet(env, { stationId: b?.stationId, date: d }, user); if (sheet.error) return sheet;
  const docId = `${d}__${sheet.station.id}__${kind}`;
  if (await getDoc(env, 'stock_counts', docId)) return { error: kind === 'closing' ? 'The closing count for this bar is already in. To change it, ask a manager for a correction.' : 'This bar already has an opening count for tonight.' };
  if (kind === 'opening' && sheet.opening.source !== 'none') return { error: 'Tonight’s opening stock comes from the last closing count. Count it again at closing.' };
  const given = new Map((Array.isArray(b.lines) ? b.lines : []).map(l => [String(l.productId), l]));
  const lines = [];
  for (const r of sheet.rows) {
    const l = given.get(r.productId), n = int(l?.counted);
    if (!(n >= 0)) return { error: `Enter the count for ${r.name} (0 if there are none).` };
    const diff = n - (kind === 'closing' ? r.expected : n);
    if (kind === 'closing' && diff !== 0 && !COUNT_REASONS[l.reason]) return { error: `${r.name}: ${Math.abs(diff)} ${diff < 0 ? 'fewer' : 'more'} than expected. Pick a reason.` };
    lines.push({ productId: r.productId, name: r.name, counted: n, ...(kind === 'closing' ? { expected: r.expected, difference: diff, reason: diff ? l.reason : '', note: clean(l.note, 200) } : {}) });
  }
  await setDoc(env, 'stock_counts', docId, { date: d, stationId: sheet.station.id, stationName: sheet.station.name, kind, lines, status: 'submitted', ...who(user), at: now() });
  await audit(env, user, kind === 'closing' ? 'STOCK_CLOSING_COUNTED' : 'STOCK_OPENING_COUNTED', { stationId: sheet.station.id, date: d, differences: lines.filter(l => l.difference).length });
  return { submitted: true, differences: lines.filter(l => l.difference).map(l => ({ name: l.name, difference: l.difference })) };
}

// Manager or finance looks at a submitted count (not the person who counted it).
export async function reviewCount(env, b, user) {
  if (!requireRole(user, STOCK)) return FORBIDDEN;
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
