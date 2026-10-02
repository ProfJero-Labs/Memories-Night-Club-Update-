// Scan to order: a guest scans the QR at a bar (/b/{stationToken}), picks drinks, pays by MoMo or
// card on Paystack, and gets a pickup code only once Paystack confirms the payment. The bar sees
// paid orders in a queue (public/bar.html) and hands them over against the code. Cash guests just
// order at the bar as usual.
//
// Collections (server only):
//   bar_stations/{id}     name, token (in the QR; rotate it to retire printed QRs), open
//   menu_items/{id}       name, category, pricePesewas, available, sortOrder
//   counter_orders/{id}   the id is the guest's bearer for their order page; lines, totals, status
//                         pending_payment → paid → delivered, or refund_due / cancelled
// Payment goes through pending_checkouts (kind 'counter') and the same confirmCharge/fulfil path
// as tickets, so the webhook, the return page and the reconciliation job all complete it.
import { getDoc, setDoc, listDocs, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction } from './lib/firestore.js';
import { now, id, clean, normalizePhone, money, paymentRef, validEmail } from './lib/util.js';
import { requireRole, CMS, uidOf } from './lib/auth.js';
import { sendSms, siteUrl } from './lib/notify.js';

const FORBIDDEN = { error: 'Forbidden.', status: 403 };
export const BAR = ['superAdmin', 'manager', 'eventManager', 'barStaff'];
const MAX_LINES = 20, MAX_QTY = 20;
const PICKUP = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L: read across a loud bar
const pickupCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => PICKUP[b % PICKUP.length]).join('');
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user), ...data, timestamp: now() });

async function paystackInit(env, payload) {
  const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!r.ok || !d.status) throw new Error(d.message || 'Paystack request failed');
  return d.data;
}
async function stationByToken(env, token) {
  if (!/^[0-9a-f]{32}$/.test(String(token || ''))) return null;
  return (await queryWhere(env, 'bar_stations', [{ field: 'token', value: String(token) }], { limit: 1 }))[0] || null;
}
const publicItem = x => ({ id: x.id, name: x.fields.name, category: x.fields.category || 'Drinks', pricePesewas: Number(x.fields.pricePesewas || 0), available: x.fields.available !== false, sortOrder: x.fields.sortOrder ?? 0 });
const sortMenu = (a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

// ── Guest ──
export async function guestMenu(env, token) {
  const st = await stationByToken(env, token);
  if (!st) return { error: 'This QR code isn’t ours any more. Order at the bar.', status: 404 };
  const items = (await listDocs(env, 'menu_items')).map(publicItem).filter(i => i.pricePesewas > 0).sort(sortMenu);
  return { station: { name: st.fields.name }, open: st.fields.open !== false && items.some(i => i.available), items };
}

export async function counterCheckout(env, b) {
  const st = await stationByToken(env, b?.station);
  if (!st) return { error: 'This QR code isn’t ours any more. Order at the bar.', status: 404 };
  if (st.fields.open === false) return { error: 'The bar isn’t taking app orders right now. Order at the bar.' };
  const phone = normalizePhone(b?.phone);
  if (!phone) return { error: 'Enter your MoMo number, e.g. 024 123 4567.' };
  const clientId = /^[0-9a-f-]{8,64}$/i.test(String(b?.clientId || '')) ? String(b.clientId) : null;
  // A double tap, or Back then Pay again: the same basket returns the same payment, never a second one.
  if (clientId) {
    const again = (await queryWhere(env, 'counter_orders', [{ field: 'clientId', value: clientId }], { limit: 1 }))[0];
    if (again && again.fields.status === 'pending_payment' && again.fields.authorizationUrl) return { orderId: again.id, authorizationUrl: again.fields.authorizationUrl };
    if (again && again.fields.status !== 'pending_payment') return { error: 'That order is already paid. Start a new one.' };
  }
  const want = (Array.isArray(b?.items) ? b.items : []).map(x => ({ itemId: String(x?.itemId || ''), qty: Number(x?.qty) })).filter(x => x.itemId && Number.isInteger(x.qty) && x.qty > 0);
  if (!want.length) return { error: 'Pick at least one drink.' };
  if (want.length > MAX_LINES || want.some(x => x.qty > MAX_QTY)) return { error: `Up to ${MAX_QTY} of each, ${MAX_LINES} different drinks.` };
  if (new Set(want.map(x => x.itemId)).size !== want.length) return { error: 'Something went wrong with your basket. Start again.' };
  const got = await batchGet(env, want.map(x => `menu_items/${x.itemId}`));
  const lines = [];
  for (const x of want) {
    const it = foundFields(got, `/menu_items/${x.itemId}`);
    if (!it || it.fields.available === false || !(Number(it.fields.pricePesewas) > 0)) return { error: `${it?.fields?.name || 'A drink you picked'} isn’t available any more.` };
    lines.push({ itemId: x.itemId, name: it.fields.name, qty: x.qty, unitPesewas: Number(it.fields.pricePesewas) });
  }
  const totalPesewas = lines.reduce((n, l) => n + l.qty * l.unitPesewas, 0);
  const orderId = id(), reference = paymentRef();
  const order = { stationId: st.id, stationName: st.fields.name, lines, totalPesewas, phone, clientId, reference, status: 'pending_payment', receiptCode: id(), createdAt: now() };
  await setDoc(env, 'counter_orders', orderId, order);
  await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'counter', orderId, eventName: st.fields.name, amountPesewas: totalPesewas, buyerPhone: phone, status: 'pending', createdAt: now() });
  try {
    const email = validEmail(b?.email) ? b.email : `guest-${phone}@${new URL(env.PUBLIC_SITE_URL || 'https://memoriesnightclub.com').hostname.replace(/^www\./, '')}`;
    const p = await paystackInit(env, { email, amount: totalPesewas, currency: 'GHS', reference, callback_url: siteUrl(env, '/counter.html'), metadata: { kind: 'counter', orderId } });
    await setDoc(env, 'counter_orders', orderId, { ...order, authorizationUrl: p.authorization_url });
    return { orderId, authorizationUrl: p.authorization_url };
  } catch (e) {
    await setDoc(env, 'counter_orders', orderId, { ...order, status: 'cancelled', error: 'payment_initialization_failed' });
    await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'counter', orderId, status: 'failed', error: 'payment_initialization_failed', failedAt: now() });
    throw e;
  }
}

// Called by fulfill() once Paystack has confirmed the charge (amount and currency already checked).
export async function issueCounter(env, reference, P) {
  const result = await withTransaction(env, async tx => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `counter_orders/${P.orderId}`], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), o = foundFields(got, `/counter_orders/${P.orderId}`);
    if (!fresh || !o) throw new Error('Counter order data disappeared.');
    if (fresh.fields.status === 'issued') return { status: 'issued', kind: 'counter', orderId: P.orderId, already: true };
    const code = pickupCode(), at = now();
    await commitTx(env, [
      updateWrite(env, 'counter_orders', P.orderId, { ...o.fields, status: 'paid', pickupCode: code, paidAt: at }),
      updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'issued', orderId: P.orderId, issuedAt: at }),
    ], tx);
    return { status: 'issued', kind: 'counter', orderId: P.orderId, code, order: o.fields };
  });
  if (!result.already && result.order) {
    const o = result.order;
    await sendSms(env, o.phone, `MEMORIES BAR\nPaid ${money(o.totalPesewas)} at ${o.stationName}.\nPickup code: ${result.code}\nShow it at the bar. Receipt: ${siteUrl(env, `/receipt.html?code=${o.receiptCode}`)}`);
  }
  delete result.already; delete result.order; delete result.code;
  return result;
}

// What the guest's order page polls. Their order id is their key. The pickup code appears only once paid.
export async function guestOrder(env, orderId, fulfillRef) {
  if (!/^[0-9a-f]{32}$/.test(String(orderId || ''))) return null;
  let o = await getDoc(env, 'counter_orders', orderId);
  if (!o) return null;
  // Still waiting on MoMo? Ask Paystack now rather than wait for the webhook.
  let declined = false;
  if (o.fields.status === 'pending_payment' && o.fields.reference) {
    const res = await fulfillRef(o.fields.reference).catch(() => null);
    const pc = await getDoc(env, 'pending_checkouts', o.fields.reference);
    // Money taken but it can't be honoured (wrong amount): the guest is owed a refund, and Refunds lists it.
    if (pc?.fields?.status === 'failed' && pc.fields.error === 'amount_mismatch') {
      await setDoc(env, 'counter_orders', orderId, { ...o.fields, status: 'refund_due', refundReason: 'amount_mismatch', refundFlaggedAt: now() });
    }
    // Declined: nothing taken. Stays retryable on Paystack, so it's shown, not stored.
    declined = res?.status === 'failed' && pc?.fields?.status !== 'failed';
    o = await getDoc(env, 'counter_orders', orderId);
  }
  const f = o.fields, paid = ['paid', 'delivered'].includes(f.status);
  return { status: declined ? 'payment_failed' : f.status, stationName: f.stationName, lines: f.lines.map(l => ({ name: l.name, qty: l.qty })), totalPesewas: f.totalPesewas, pickupCode: paid ? f.pickupCode : undefined, receiptCode: paid || f.status === 'refund_due' ? f.receiptCode : undefined };
}

export async function receipt(env, code) {
  if (!/^[0-9a-f]{32}$/.test(String(code || ''))) return null;
  const o = (await queryWhere(env, 'counter_orders', [{ field: 'receiptCode', value: String(code) }], { limit: 1 }))[0];
  if (!o || !['paid', 'delivered', 'refund_due', 'refunded'].includes(o.fields.status)) return null;
  const f = o.fields;
  return { stationName: f.stationName, lines: f.lines, totalPesewas: f.totalPesewas, paidAt: f.paidAt, status: f.status, reference: f.reference, pickupCode: f.pickupCode };
}

// ── The bar ──
export async function barQueue(env, user, stationId) {
  if (!requireRole(user, BAR)) return FORBIDDEN;
  const stations = (await listDocs(env, 'bar_stations')).map(s => ({ id: s.id, name: s.fields.name, open: s.fields.open !== false })).sort((a, b) => a.name.localeCompare(b.name));
  const st = stations.find(s => s.id === stationId) || stations[0];
  if (!st) return { stations, orders: [], delivered: [] };
  const all = await queryWhere(env, 'counter_orders', [{ field: 'stationId', value: st.id }], { limit: 1000 });
  const view = o => ({ id: o.id, pickupCode: o.fields.pickupCode, lines: o.fields.lines.map(l => ({ name: l.name, qty: l.qty })), totalPesewas: o.fields.totalPesewas, paidAt: o.fields.paidAt, deliveredAt: o.fields.deliveredAt || null, phoneLast4: String(o.fields.phone || '').slice(-4) });
  const since = Date.now() - 12 * 3600e3;
  return {
    stations, stationId: st.id, open: st.open,
    orders: all.filter(o => o.fields.status === 'paid').map(view).sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt)),
    delivered: all.filter(o => o.fields.status === 'delivered' && new Date(o.fields.deliveredAt).getTime() > since).map(view).sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt)).slice(0, 20),
  };
}

// Hand over (delivered) or can't make it (refund_due). Once only, in a transaction.
export async function barUpdate(env, user, b) {
  if (!requireRole(user, BAR)) return FORBIDDEN;
  const orderId = String(b?.orderId || ''), action = b?.action;
  if (!/^[0-9a-f]{32}$/.test(orderId) || !['deliver', 'refund'].includes(action)) return { error: 'Unknown order.' };
  return withTransaction(env, async tx => {
    const o = foundFields(await batchGet(env, [`counter_orders/${orderId}`], tx), `/counter_orders/${orderId}`);
    if (!o) return { error: 'Unknown order.', status: 404 };
    if (o.fields.status !== 'paid') return { error: o.fields.status === 'delivered' ? 'Already handed over.' : 'This order isn’t waiting at the bar.' };
    const at = now();
    const next = action === 'deliver'
      ? { ...o.fields, status: 'delivered', deliveredAt: at, deliveredBy: uidOf(user) }
      : { ...o.fields, status: 'refund_due', refundReason: clean(b.reason, 120) || 'bar_could_not_make', refundFlaggedAt: at, refundFlaggedBy: uidOf(user) };
    await commitTx(env, [updateWrite(env, 'counter_orders', orderId, next), updateWrite(env, 'audit_logs', id(), { action: action === 'deliver' ? 'BAR_HANDED_OVER' : 'BAR_REFUND_FLAGGED', actorUid: uidOf(user), orderId, timestamp: at })], tx);
    return { status: next.status };
  });
}

// ── Control room: stations and the menu ──
export async function barSetup(env, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const [stations, items] = await Promise.all([listDocs(env, 'bar_stations'), listDocs(env, 'menu_items')]);
  return {
    stations: stations.map(s => ({ id: s.id, name: s.fields.name, open: s.fields.open !== false, url: siteUrl(env, `/b/${s.fields.token}`) })).sort((a, b) => a.name.localeCompare(b.name)),
    items: items.map(publicItem).sort(sortMenu),
  };
}
export async function upsertStation(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const name = clean(b?.name, 40); if (!name) return { error: 'Name the bar, e.g. Main bar.' };
  const existing = b?.id ? await getDoc(env, 'bar_stations', String(b.id)) : null;
  if (b?.id && !existing) return { error: 'Bar not found.', status: 404 };
  const sid = existing?.id || id();
  // A new token retires every QR already printed for this bar.
  const token = !existing || b.newQr === true ? id() : existing.fields.token;
  await setDoc(env, 'bar_stations', sid, { ...(existing?.fields || {}), name, token, open: b.open !== false, updatedAt: now(), createdAt: existing?.fields?.createdAt || now() });
  await audit(env, user, existing ? (b.newQr ? 'BAR_QR_ROTATED' : 'BAR_STATION_UPDATED') : 'BAR_STATION_ADDED', { stationId: sid, open: b.open !== false });
  return { id: sid, url: siteUrl(env, `/b/${token}`) };
}
export async function setStationOpen(env, user, b) {
  if (!requireRole(user, BAR)) return FORBIDDEN;
  const st = await getDoc(env, 'bar_stations', String(b?.stationId || ''));
  if (!st) return { error: 'Bar not found.', status: 404 };
  await setDoc(env, 'bar_stations', st.id, { ...st.fields, open: b.open === true, updatedAt: now() });
  await audit(env, user, b.open === true ? 'BAR_OPENED' : 'BAR_PAUSED', { stationId: st.id });
  return { open: b.open === true };
}
export async function upsertMenuItem(env, b, user) {
  if (!requireRole(user, CMS)) return FORBIDDEN;
  const name = clean(b?.name, 60), price = Number(b?.pricePesewas);
  if (!name) return { error: 'Add a name.' };
  if (!Number.isInteger(price) || price < 100) return { error: 'Add a price of at least GHS 1.' };
  const existing = b?.id ? await getDoc(env, 'menu_items', String(b.id)) : null;
  if (b?.id && !existing) return { error: 'Item not found.', status: 404 };
  const mid = existing?.id || id();
  await setDoc(env, 'menu_items', mid, { name, category: clean(b.category, 30) || 'Drinks', pricePesewas: price, available: b.available !== false, sortOrder: Number(b.sortOrder) || 0, updatedAt: now(), createdAt: existing?.fields?.createdAt || now() });
  await audit(env, user, 'MENU_ITEM_SAVED', { itemId: mid, name, pricePesewas: price, available: b.available !== false });
  return { id: mid };
}
// Refunds owed on bar orders, for the control room's Refunds tab.
export async function counterRefunds(env) {
  return (await queryWhere(env, 'counter_orders', [{ field: 'status', value: 'refund_due' }])).map(o => ({
    source: 'counter', id: o.id, reason: o.fields.refundReason || 'bar_could_not_make', amountPesewas: Number(o.fields.totalPesewas || 0),
    buyerName: 'Bar guest', buyerPhone: o.fields.phone || '', eventName: o.fields.stationName || 'Bar', planId: '', at: o.fields.refundFlaggedAt || o.fields.paidAt || '',
  }));
}
