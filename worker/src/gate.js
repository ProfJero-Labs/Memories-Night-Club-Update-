// The gate (front office): selling tickets and tables at the entrance, and checking anyone by phone.
//
//   Selling: the customer's phone number is their ID. Cash goes into the seller's cash for the night
//   (handed to the Manager at the count); MoMo is a payment prompt on the customer's own phone
//   (Paystack), so it's confirmed by the payment itself, never typed in by the seller. Either way
//   tickets are issued and admitted at once, the customer gets their ticket by SMS, and the sale
//   counts for the night like an online one (organiser share included).
//   Tables: free vs booked per package; sell one at the gate, or hold one for a name (30 minutes).
//   Checking: security, the front office and the night's organiser type a phone number (or scan a
//   code) and see what that person has: a paid ticket (and how, by whom), a member entry, a table.
//   Nothing found = not in the system.
import { getDoc, setDoc, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction } from './lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone, firstName, ticketToken, displayCode, tableCode, paymentRef, nightKey, money, sixDigits, sha256Hex } from './lib/util.js';
import { requireRole, uidOf } from './lib/auth.js';
import { sendSms, siteUrl } from './lib/notify.js';
import { computeShares } from './shares.js';
import { memberAtGate } from './members.js';
import { cashBag } from './ops/tabs.js';

const FORBIDDEN = { error: 'You can’t do that with your role.', status: 403 };
export const GATE_SELLERS = ['superAdmin', 'manager', 'eventManager', 'doorStaff'];
const CHECKERS = ['superAdmin', 'director', 'manager', 'eventManager', 'doorStaff', 'security'];
const HOLD_MS = 30 * 60e3;
const MAX_QTY = 10;
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user) || null, actorName: user?.name || '', ...data, timestamp: now() });
const shares = (env, ev, amount) => computeShares(amount, { evolveitSharePct: ev?.evolveitSharePct, organizerSharePct: ev?.organizerSharePct }, Number(env.EVOLVEIT_SHARE_PCT));
const doorPrice = tt => Number(tt.doorPricePesewas || tt.pricePesewas || 0);
const hhmm = d => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' }) : '');
const isTonight = ev => ev?.date && nightKey(ev.date) === nightKey(now());

async function paystack(env, path, body) {
  const r = await fetch(`https://api.paystack.co${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.status) throw new Error(d.message || 'Paystack request failed');
  return d.data;
}
// The MoMo network from the number (Paystack's provider codes for Ghana).
export function momoProvider(phone) {
  const p = String(phone).slice(0, 3);
  if (['024', '054', '055', '059', '025', '053'].includes(p)) return 'mtn';
  if (['020', '050'].includes(p)) return 'vod';
  if (['026', '056', '027', '057'].includes(p)) return 'atl';
  return null;
}
const email = (env, phone) => `gate-${phone}@${new URL(env.PUBLIC_SITE_URL || 'https://memoriesnightclub.com').hostname.replace(/^www\./, '')}`;

// A night the gate may work on (staff: any; an organiser: only theirs).
async function gateNight(env, user, eventId, roles) {
  const ev = eventId ? await getDoc(env, 'events', String(eventId)) : null;
  if (!ev) return null;
  if (requireRole(user, roles)) return ev;
  return user?.role === 'organiser' && ev.fields.organiserId === uidOf(user) ? ev : null;
}

// Holds that ran out go back on sale (checked whenever the gate looks at the tables).
async function releaseHolds(env, eventId) {
  const held = (await queryWhere(env, 'orders', [{ field: 'eventId', value: eventId }, { field: 'kind', value: 'table' }])).filter(o => o.fields.status === 'held' && new Date(o.fields.heldUntil).getTime() < Date.now());
  for (const o of held) {
    await withTransaction(env, async tx => {
      const got = await batchGet(env, [`orders/${o.id}`, `table_packages/${o.fields.packageId}`], tx);
      const f = foundFields(got, `/orders/${o.id}`), pkg = foundFields(got, `/table_packages/${o.fields.packageId}`);
      if (!f || f.fields.status !== 'held') return;
      await commitTx(env, [updateWrite(env, 'orders', o.id, { ...f.fields, status: 'released', releasedAt: now() }),
        ...(pkg && typeof pkg.fields.remaining === 'number' ? [updateWrite(env, 'table_packages', o.fields.packageId, { ...pkg.fields, remaining: pkg.fields.remaining + 1 })] : [])], tx);
    });
  }
}

// ── What the gate needs for tonight: ticket prices at the door, tables free and booked, sales ──
export async function gateNightView(env, user, eventId) {
  const ev = await gateNight(env, user, eventId, CHECKERS); if (!ev) return { error: 'Not your night.', status: 403 };
  await releaseHolds(env, ev.id);
  const [types, pkgs, orders] = await Promise.all([
    queryWhere(env, 'ticket_types', [{ field: 'eventId', value: ev.id }]), queryWhere(env, 'table_packages', [{ field: 'eventId', value: ev.id }]),
    queryWhere(env, 'orders', [{ field: 'eventId', value: ev.id }]),
  ]);
  const O = orders.map(o => ({ id: o.id, ...o.fields }));
  const gate = O.filter(o => o.channel === 'gate' && o.status === 'confirmed');
  const sum = (xs, f = o => o.amountPesewas) => xs.reduce((n, o) => n + Number(f(o) || 0), 0);
  const mine = gate.filter(o => o.soldBy === uidOf(user));
  const tables = O.filter(o => o.kind === 'table' && ['confirmed', 'held'].includes(o.status));
  return {
    event: { id: ev.id, name: ev.fields.name || '', tonight: isTonight(ev.fields) },
    canSell: !!requireRole(user, GATE_SELLERS) && isTonight(ev.fields),
    buyUrl: siteUrl(env, `/tickets.html?event=${encodeURIComponent(ev.id)}`),
    ticketTypes: types.filter(t => t.fields.active === true).map(t => ({ id: t.id, name: t.fields.name || 'Ticket', admits: Number(t.fields.admits || 1), pricePesewas: doorPrice(t.fields), remaining: typeof t.fields.remaining === 'number' ? t.fields.remaining : null }))
      .sort((a, b) => a.pricePesewas - b.pricePesewas),
    tables: pkgs.filter(p => p.fields.active === true).map(p => {
      const of = tables.filter(o => o.packageId === p.id);
      return { packageId: p.id, name: p.fields.name || 'Table', pricePesewas: Number(p.fields.pricePesewas || 0), capacity: Number(p.fields.capacity || 0),
        free: typeof p.fields.remaining === 'number' ? p.fields.remaining : null,
        booked: of.filter(o => o.status === 'confirmed').map(o => ({ code: tableCode(o.id), name: firstName(o.buyerName), phoneHint: maskPhone(o.buyerPhone), arrived: !!o.arrivedAt, tableNumber: o.tableNumber || '', gate: o.channel === 'gate' })),
        held: of.filter(o => o.status === 'held').map(o => ({ id: o.id, name: o.buyerName, phoneHint: maskPhone(o.buyerPhone), until: o.heldUntil, byName: o.heldByName || '' })) };
    }),
    // The night's gate sales (everyone) and this person's own.
    sales: {
      cashPesewas: sum(gate.filter(o => o.paidWith === 'cash')), momoPesewas: sum(gate.filter(o => o.paidWith === 'momo')),
      people: sum(gate.filter(o => o.kind === 'ticket'), o => Number(o.quantity || 1) * Number(o.admits || 1)), tables: gate.filter(o => o.kind === 'table').length,
      mine: { cashPesewas: sum(mine.filter(o => o.paidWith === 'cash')), momoPesewas: sum(mine.filter(o => o.paidWith === 'momo')), count: mine.length },
    },
  };
}

// ── Sell at the gate ──
// { eventId, ticketTypeId, quantity } or { eventId, packageId | holdId }, plus { phone, name, method: cash|momo }
export async function gateSell(env, b, user) {
  if (!requireRole(user, GATE_SELLERS)) return { error: 'Only the front office sells at the gate.', status: 403 };
  const ev = await getDoc(env, 'events', String(b?.eventId || ''));
  if (!ev || ev.fields.active === false) return { error: 'Pick tonight’s night first.' };
  if (!isTonight(ev.fields)) return { error: 'The gate sells for tonight’s night only.' };
  const phone = normalizePhone(b?.phone);
  if (!phone) return { error: 'Enter their phone number (it’s their ticket), e.g. 024 123 4567.' };
  const method = b?.method === 'momo' ? 'momo' : 'cash';
  const name = clean(b?.name, 80) || 'Guest';
  let item;
  if (b?.ticketTypeId) {
    const tt = await getDoc(env, 'ticket_types', String(b.ticketTypeId));
    const qty = Number(b?.quantity || 1);
    if (!tt || tt.fields.eventId !== ev.id || tt.fields.active !== true) return { error: 'That ticket isn’t on sale.' };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: `1 to ${MAX_QTY} at a time.` };
    if (typeof tt.fields.remaining === 'number' && tt.fields.remaining < qty) return { error: tt.fields.remaining ? `Only ${tt.fields.remaining} left.` : 'Sold out.' };
    const unit = doorPrice(tt.fields); if (!(unit > 0)) return { error: 'That ticket has no price.' };
    item = { kind: 'ticket', ticketTypeId: tt.id, ticketTypeName: tt.fields.name || 'Ticket', admits: Number(tt.fields.admits || 1), quantity: qty, amountPesewas: unit * qty };
  } else if (b?.packageId || b?.holdId) {
    let pkgId = String(b.packageId || ''), holdId = '';
    if (b.holdId) {
      const h = await getDoc(env, 'orders', String(b.holdId));
      if (!h || h.fields.status !== 'held' || h.fields.eventId !== ev.id) return { error: 'That hold has ended. Check the table is still free.' };
      pkgId = h.fields.packageId; holdId = h.id;
    }
    const pkg = await getDoc(env, 'table_packages', pkgId);
    if (!pkg || pkg.fields.eventId !== ev.id || pkg.fields.active !== true) return { error: 'That table isn’t available.' };
    if (!holdId && typeof pkg.fields.remaining === 'number' && pkg.fields.remaining < 1) return { error: 'No table of that kind is free.' };
    item = { kind: 'table', packageId: pkg.id, packageName: pkg.fields.name || 'Table', holdId, quantity: 1, amountPesewas: Number(pkg.fields.pricePesewas || 0) };
    if (!(item.amountPesewas > 0)) return { error: 'That table has no price.' };
  } else return { error: 'Pick a ticket or a table.' };

  const sale = { ...item, eventId: ev.id, eventName: ev.fields.name || '', organizerId: ev.fields.organiserId || null, buyerName: name, buyerPhone: phone, soldBy: uidOf(user), soldByName: user.name || '', shares: shares(env, ev.fields, item.amountPesewas) };
  if (method === 'cash') {
    const bag = await cashBag(env, user, nightKey(now())); if (bag.error) return bag;
    const r = await issueGateSale(env, sale, { paidWith: 'cash', reference: `gate_${id()}`, sessionId: bag.sid });
    if (r.error) return r;
    await audit(env, user, 'GATE_SALE_CASH', { orderId: r.orderId, eventId: ev.id, amountPesewas: item.amountPesewas, kind: item.kind });
    return { ...r, method: 'cash' };
  }
  // MoMo: a payment prompt on the customer's phone. Nothing is issued until Paystack confirms it.
  const reference = paymentRef();
  // The sale itself is kept whole under `sale` (its own kind is ticket or table; this checkout's kind is gate).
  await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'gate', sale, eventId: ev.id, eventName: sale.eventName, buyerPhone: phone, amountPesewas: item.amountPesewas, status: 'pending', createdAt: now() });
  const provider = momoProvider(phone);
  try {
    if (!provider) throw new Error('unknown network');
    const c = await paystack(env, '/charge', { email: email(env, phone), amount: item.amountPesewas, currency: 'GHS', reference, mobile_money: { phone, provider }, metadata: { kind: 'gate', eventId: ev.id } });
    if (c?.status === 'send_otp' || c?.status === 'failed') throw new Error(c.status);
    await audit(env, user, 'GATE_SALE_MOMO_PROMPT', { reference, eventId: ev.id, amountPesewas: item.amountPesewas });
    return { reference, method: 'momo', prompt: true, amountPesewas: item.amountPesewas, message: `A MoMo prompt for ${money(item.amountPesewas)} is on ${maskPhone(phone)}. Ask them to approve it.` };
  } catch {
    // The prompt couldn't be sent (network not recognised, or Paystack wants a voucher): the customer
    // pays on their phone with a link (texted, and shown as a QR to scan right there).
    const fresh = paymentRef();
    await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'gate', sale, eventId: ev.id, amountPesewas: item.amountPesewas, status: 'failed', error: 'prompt_not_sent', failedAt: now() });
    await setDoc(env, 'pending_checkouts', fresh, { reference: fresh, kind: 'gate', sale, eventId: ev.id, eventName: sale.eventName, buyerPhone: phone, amountPesewas: item.amountPesewas, status: 'pending', createdAt: now() });
    const p = await paystack(env, '/transaction/initialize', { email: email(env, phone), amount: item.amountPesewas, currency: 'GHS', reference: fresh, callback_url: siteUrl(env, '/payment-return.html'), channels: ['mobile_money', 'card'], metadata: { kind: 'gate', eventId: ev.id } });
    await sendSms(env, phone, `MEMORIES\nPay ${money(item.amountPesewas)} for ${ev.fields.name || 'tonight'}: ${p.authorization_url}`);
    return { reference: fresh, method: 'momo', prompt: false, link: p.authorization_url, amountPesewas: item.amountPesewas, message: `Payment link texted to ${maskPhone(phone)}. They can also scan the code on your screen.` };
  }
}

// Issues a gate sale once it's paid: tickets admitted now (or the table seated), the order, the
// cash in the seller's cash for the night, and the ticket by SMS. Idempotent per reference.
export async function issueGateSale(env, P, { paidWith, reference, sessionId = null }) {
  const at = now(), orderId = id();
  const res = await withTransaction(env, async tx => {
    const paths = [P.kind === 'ticket' ? `ticket_types/${P.ticketTypeId}` : `table_packages/${P.packageId}`, ...(P.holdId ? [`orders/${P.holdId}`] : []), ...(sessionId ? [`cash_sessions/${sessionId}`] : []), ...(paidWith === 'momo' ? [`pending_checkouts/${reference}`] : [])];
    const got = await batchGet(env, paths, tx);
    if (paidWith === 'momo') { const pc = foundFields(got, `/pending_checkouts/${reference}`); if (pc?.fields?.status === 'issued') return { already: true, orderId: pc.fields.orderId, ticketIds: pc.fields.ticketIds || [] }; }
    const writes = [];
    let tokens = [];
    const order = { orderId, kind: P.kind, channel: 'gate', paidWith, reference, eventId: P.eventId, eventName: P.eventName, amountPesewas: P.amountPesewas, quantity: P.quantity, admits: P.admits || 1,
      buyerName: P.buyerName, buyerPhone: P.buyerPhone, buyerEmail: '', soldBy: P.soldBy, soldByName: P.soldByName, status: 'confirmed', createdAt: at,
      shares: P.shares || {}, evolveitSharePesewas: P.shares?.evolveitSharePesewas || 0, memoriesSharePesewas: P.shares?.memoriesSharePesewas || 0, organizerSharePesewas: P.shares?.organizerSharePesewas || 0, organizerId: P.organizerId || null };
    if (P.kind === 'ticket') {
      const tt = foundFields(got, `/ticket_types/${P.ticketTypeId}`);
      if (!tt) return { error: 'That ticket isn’t on sale.' };
      if (typeof tt.fields.remaining === 'number') {
        if (tt.fields.remaining < P.quantity) return { error: 'Sold out while paying.', soldOut: true };
        writes.push(updateWrite(env, 'ticket_types', P.ticketTypeId, { ...tt.fields, remaining: tt.fields.remaining - P.quantity }));
      }
      tokens = Array.from({ length: P.quantity }, ticketToken);
      for (const token of tokens) {
        writes.push(updateWrite(env, 'tickets', token, { customerName: P.buyerName, phoneLast4: P.buyerPhone.slice(-4), type: P.ticketTypeName, admitCount: P.admits || 1, eventId: P.eventId, eventName: P.eventName, identityLine: '', reference,
          displayCode: displayCode(token), status: 'used', checkedInAt: at, checkedInBy: P.soldBy, revoked: false, cancelled: false, inDraw: false, issuedAt: at, channel: 'gate', paidWith }));
        writes.push(updateWrite(env, 'checkins', id(), { ticketId: token, eventId: P.eventId, admits: P.admits || 1, checkedInAt: at, checkedInBy: P.soldBy, gate: true }));
      }
      Object.assign(order, { ticketTypeId: P.ticketTypeId, ticketTypeName: P.ticketTypeName, ticketIds: tokens });
    } else {
      const pkg = foundFields(got, `/table_packages/${P.packageId}`);
      if (!pkg) return { error: 'That table isn’t available.' };
      if (P.holdId) {
        const h = foundFields(got, `/orders/${P.holdId}`);
        if (!h || h.fields.status !== 'held') return { error: 'That hold has ended.' };
        writes.push(updateWrite(env, 'orders', P.holdId, { ...h.fields, status: 'sold', soldOrderId: orderId, soldAt: at }));
      } else if (typeof pkg.fields.remaining === 'number') {
        if (pkg.fields.remaining < 1) return { error: 'No table of that kind is free.', soldOut: true };
        writes.push(updateWrite(env, 'table_packages', P.packageId, { ...pkg.fields, remaining: pkg.fields.remaining - 1 }));
      }
      Object.assign(order, { packageId: P.packageId, packageName: P.packageName, bottles: [], arrivedAt: at, arrivedBy: P.soldBy });
    }
    writes.push(updateWrite(env, 'orders', orderId, order));
    if (sessionId) {
      const s = foundFields(got, `/cash_sessions/${sessionId}`);
      writes.push(updateWrite(env, 'cash_sessions', sessionId, { ...s.fields, payments: [...(s.fields.payments || []), { id: orderId, gate: true, label: P.kind === 'ticket' ? `Gate: ${P.quantity} × ${P.ticketTypeName}` : `Gate: ${P.packageName}`, amountPesewas: P.amountPesewas, at }] }));
    }
    if (paidWith === 'momo') { const pc = foundFields(got, `/pending_checkouts/${reference}`); writes.push(updateWrite(env, 'pending_checkouts', reference, { ...pc.fields, status: 'issued', orderId, ticketIds: tokens, issuedAt: at })); }
    await commitTx(env, writes, tx);
    return { orderId, ticketIds: tokens };
  });
  if (res.error || res.already) return res.error ? res : { status: 'issued', orderId: res.orderId, ticketIds: res.ticketIds };
  const how = paidWith === 'cash' ? 'cash' : 'MoMo';
  const text = P.kind === 'ticket'
    ? `MEMORIES\nWelcome to ${P.eventName}! Paid ${money(P.amountPesewas)} (${how}) at the gate.\nYour ticket: ${siteUrl(env, `/ticket.html?token=${res.ticketIds[0]}`)}\nSecurity may check your number.`
    : `MEMORIES\nTable confirmed: ${P.packageName}, ${P.eventName}. Paid ${money(P.amountPesewas)} (${how}) at the gate. Code: ${tableCode(res.orderId)}.`;
  await sendSms(env, P.buyerPhone, text).catch(() => false);
  return { status: 'issued', orderId: res.orderId, ticketIds: res.ticketIds, amountPesewas: P.amountPesewas, kind: P.kind, phoneHint: maskPhone(P.buyerPhone), people: P.kind === 'ticket' ? P.quantity * (P.admits || 1) : 0 };
}

// ── Hold a table for a name (30 minutes), or let it go ──
export async function gateHold(env, b, user) {
  if (!requireRole(user, GATE_SELLERS)) return FORBIDDEN;
  const ev = await getDoc(env, 'events', String(b?.eventId || ''));
  if (!ev || !isTonight(ev.fields)) return { error: 'Holds are for tonight’s night only.' };
  const name = clean(b?.name, 80); if (!name) return { error: 'Whose name is it held for?' };
  const phone = b?.phone ? normalizePhone(b.phone) : '';
  if (b?.phone && !phone) return { error: 'That phone number doesn’t look right, or leave it blank.' };
  const pkgId = String(b?.packageId || '');
  return withTransaction(env, async tx => {
    const pkg = foundFields(await batchGet(env, [`table_packages/${pkgId}`], tx), `/table_packages/${pkgId}`);
    if (!pkg || pkg.fields.eventId !== ev.id || pkg.fields.active !== true) return { error: 'That table isn’t available.' };
    if (typeof pkg.fields.remaining === 'number' && pkg.fields.remaining < 1) return { error: 'No table of that kind is free.' };
    const hid = id(), until = new Date(Date.now() + HOLD_MS).toISOString();
    await commitTx(env, [
      updateWrite(env, 'orders', hid, { orderId: hid, kind: 'table', channel: 'gate', status: 'held', heldUntil: until, eventId: ev.id, eventName: ev.fields.name || '', packageId: pkgId, packageName: pkg.fields.name || 'Table', buyerName: name, buyerPhone: phone, heldBy: uidOf(user), heldByName: user.name || '', createdAt: now(), amountPesewas: 0 }),
      ...(typeof pkg.fields.remaining === 'number' ? [updateWrite(env, 'table_packages', pkgId, { ...pkg.fields, remaining: pkg.fields.remaining - 1 })] : []),
    ], tx);
    return { id: hid, until };
  });
}
export async function gateRelease(env, b, user) {
  if (!requireRole(user, GATE_SELLERS)) return FORBIDDEN;
  const hid = String(b?.id || '');
  return withTransaction(env, async tx => {
    const h = foundFields(await batchGet(env, [`orders/${hid}`], tx), `/orders/${hid}`);
    if (!h || h.fields.status !== 'held') return { error: 'That hold has already ended.' };
    const pkg = foundFields(await batchGet(env, [`table_packages/${h.fields.packageId}`], tx), `/table_packages/${h.fields.packageId}`);
    await commitTx(env, [updateWrite(env, 'orders', hid, { ...h.fields, status: 'released', releasedAt: now(), releasedByName: user.name || '' }),
      ...(pkg && typeof pkg.fields.remaining === 'number' ? [updateWrite(env, 'table_packages', h.fields.packageId, { ...pkg.fields, remaining: pkg.fields.remaining + 1 })] : [])], tx);
    return { released: true };
  });
}

// ── Check anyone by phone (or a ticket code): what do they have for this night? ──
export async function gateCheck(env, user, { eventId, phone, code } = {}) {
  const ev = await gateNight(env, user, eventId, CHECKERS); if (!ev) return { error: 'Not your night.', status: 403 };
  const ph = phone ? normalizePhone(phone) : '';
  const c = String(code || '').trim().toUpperCase();
  if (!ph && c.length < 4) return { error: 'Type their phone number, e.g. 024 123 4567.' };
  const orders = ph ? (await queryWhere(env, 'orders', [{ field: 'buyerPhone', value: ph }])).filter(o => o.fields.eventId === ev.id && o.fields.status === 'confirmed') : [];
  // Friends the table's owner confirmed at the door.
  const guestOf = ph ? (await queryWhere(env, 'orders', [{ field: 'eventId', value: ev.id }, { field: 'kind', value: 'table' }])).filter(o => o.fields.status === 'confirmed' && (o.fields.guests || []).some(g => g.phone === ph)) : [];
  let tickets = [];
  const ids = orders.flatMap(o => o.fields.ticketIds || []);
  if (ids.length) tickets = (await batchGet(env, ids.map(t => `tickets/${t}`))).filter(x => x.found).map(x => ({ token: x.found.name.split('/').pop(), ...foundFields([x], `/tickets/${x.found.name.split('/').pop()}`).fields }));
  if (c) tickets = tickets.concat((await queryWhere(env, 'tickets', [{ field: 'eventId', value: ev.id }])).filter(t => String(t.fields.displayCode || '').toUpperCase() === c || String(t.fields.displayCode || '').toUpperCase() === `MEM-${c}`).map(t => ({ token: t.id, ...t.fields })));
  const names = new Map();
  const nameOf = async uid => { if (!uid) return ''; if (!names.has(uid)) names.set(uid, (await getDoc(env, 'users', uid).catch(() => null))?.fields?.name || ''); return names.get(uid); };
  const orderOf = token => orders.find(o => (o.fields.ticketIds || []).includes(token));
  const lines = [];
  for (const t of tickets) {
    if (t.revoked || t.cancelled) { lines.push({ kind: 'ticket', ok: false, title: `${t.type || 'Ticket'}: CANCELLED`, sub: t.displayCode || '' }); continue; }
    const o = orderOf(t.token)?.fields;
    const amt = o ? `${money(o.amountPesewas)}${(o.ticketIds || []).length > 1 ? ` for ${o.ticketIds.length}` : ''}` : '';
    const paid = t.comp ? 'Free (comp)' : t.channel === 'gate' ? `Paid ${amt} ${t.paidWith === 'cash' ? 'cash' : 'MoMo'} at the gate${o?.soldByName ? `, sold by ${firstName(o.soldByName)}` : ''}` : `Paid online${amt ? ` ${amt}` : ''}`;
    lines.push({ kind: 'ticket', ok: true, title: `${t.type || 'Ticket'}${Number(t.admitCount || 1) > 1 ? ` (admits ${t.admitCount})` : ''}`, sub: `${paid} · ${t.status === 'used' ? `in at ${hhmm(t.checkedInAt)}${t.checkedInBy ? ` (${firstName(await nameOf(t.checkedInBy))})` : ''}` : 'not in yet'}`, code: t.displayCode || '', at: t.checkedInAt || '' });
  }
  for (const o of orders.filter(x => x.fields.kind === 'table')) {
    const f = o.fields;
    lines.push({ kind: 'table', ok: true, title: `Table: ${f.packageName || 'Table'}${f.tableNumber ? ` · no. ${f.tableNumber}` : ''}`, sub: `${f.channel === 'gate' ? `Paid ${money(f.amountPesewas)} ${f.paidWith === 'cash' ? 'cash' : 'MoMo'} at the gate` : `Booked online ${money(f.amountPesewas)}`} · ${f.arrivedAt ? `arrived ${hhmm(f.arrivedAt)}` : 'not arrived yet'}`, code: tableCode(o.id) });
  }
  for (const o of guestOf) {
    const f = o.fields, g = f.guests.find(x => x.phone === ph);
    lines.push({ kind: 'table', ok: true, title: `Guest at ${firstName(f.buyerName)}’s table: ${f.packageName || 'Table'}`, sub: `Confirmed by the table’s owner ${hhmm(g.at)}${g.byName ? ` (${firstName(g.byName)})` : ''}`, code: tableCode(o.id) });
  }
  const member = ph ? await memberAtGate(env, ph) : null;
  if (member) lines.push({ kind: 'member', ok: member.ok, title: `${member.ok ? 'Member' : member.message}: ${member.card.firstName}`, sub: member.inAt ? `in at ${hhmm(member.inAt)}${member.inByName ? ` (${firstName(member.inByName)})` : ''}` : 'not in yet tonight' });
  const ok = lines.some(l => l.ok);
  // VIP area: a table (theirs or as a confirmed guest) or a VIP ticket.
  const vipTypes = new Set((await queryWhere(env, 'ticket_types', [{ field: 'eventId', value: ev.id }])).filter(t => t.fields.vip === true || /\bvip\b/i.test(t.fields.name || '')).map(t => t.fields.name));
  const vip = lines.some(l => l.ok && l.kind === 'table') || tickets.some(t => !t.revoked && !t.cancelled && vipTypes.has(t.type));
  const name = firstName(orders[0]?.fields?.buyerName || tickets[0]?.customerName || member?.card?.name || '');
  return { vip, verdict: ok ? 'ok' : 'not_found', message: ok ? (lines.some(l => l.kind !== 'member' && l.ok) ? 'PAID' : 'MEMBER') : 'NOT IN THE SYSTEM', name, phoneHint: ph ? maskPhone(ph) : '', lines,
    hint: ok ? '' : 'No ticket, table or membership for this number tonight. Ask how they got in, and report it to the Manager.' };
}

// ── Friends joining a table ──
// Security (or the door) types the table's code and the friend's number; the table's owner gets a
// 4-digit code by SMS and reads it out if they know the friend. Then the friend is on the table's
// list (VIP access with it). Never more people than the table holds.
export async function tableGuestRequest(env, b, user) {
  const ev = await gateNight(env, user, b?.eventId, CHECKERS); if (!ev) return FORBIDDEN;
  const o = await tableByCode(env, ev.id, b?.tableCode); if (!o) return { error: 'No table with that code tonight.' };
  const ph = normalizePhone(b?.phone); if (!ph) return { error: 'Type the friend’s phone number.' };
  if (ph === o.fields.buyerPhone || (o.fields.guests || []).some(g => g.phone === ph)) return { error: 'That number is already on this table.' };
  const cap = await tableCap(env, o.fields);
  if (cap && 1 + (o.fields.guests || []).length >= cap) return { error: `This table is full (${cap} people).` };
  if (!o.fields.buyerPhone) return { error: 'This table has no phone number to confirm with.' };
  const code = sixDigits().slice(0, 4);
  await setDoc(env, 'orders', o.id, { ...o.fields, guestRequest: { phone: ph, codeHash: await sha256Hex(`tg:${o.id}:${ph}:${code}`), expiresAt: new Date(Date.now() + 10 * 60e3).toISOString(), tries: 0 } });
  await sendSms(env, o.fields.buyerPhone, `MEMORIES\n${maskPhone(ph)} wants to join your table (${o.fields.packageName || 'table'}). If you know them, give security this code: ${code}`);
  return { sent: true, ownerHint: maskPhone(o.fields.buyerPhone), ownerName: firstName(o.fields.buyerName), message: `A code was texted to ${firstName(o.fields.buyerName)} (${maskPhone(o.fields.buyerPhone)}). Ask them for it.` };
}
export async function tableGuestConfirm(env, b, user) {
  const ev = await gateNight(env, user, b?.eventId, CHECKERS); if (!ev) return FORBIDDEN;
  const o = await tableByCode(env, ev.id, b?.tableCode); if (!o) return { error: 'No table with that code tonight.' };
  const ph = normalizePhone(b?.phone), r = o.fields.guestRequest;
  if (!r || r.phone !== ph || new Date(r.expiresAt).getTime() < Date.now()) return { error: 'Ask for a new code.' };
  if ((await sha256Hex(`tg:${o.id}:${ph}:${String(b?.code || '').trim()}`)) !== r.codeHash) {
    const tries = Number(r.tries || 0) + 1;
    await setDoc(env, 'orders', o.id, { ...o.fields, guestRequest: tries >= 5 ? null : { ...r, tries } });
    return { error: tries >= 5 ? 'Too many wrong codes. Ask for a new one.' : 'That code isn’t right. Check it with the table’s owner.' };
  }
  const guests = [...(o.fields.guests || []), { phone: ph, at: now(), by: uidOf(user), byName: user.name || '' }];
  await setDoc(env, 'orders', o.id, { ...o.fields, guests, guestRequest: null });
  await audit(env, user, 'TABLE_GUEST_ADDED', { orderId: o.id, phoneHint: maskPhone(ph) });
  return { added: true, guests: guests.length + 1, message: `On ${firstName(o.fields.buyerName)}’s table. VIP access.` };
}
async function tableByCode(env, eventId, code) {
  const want = String(code || '').trim().toUpperCase().replace(/^(?!TBL-)/, 'TBL-');
  return (await queryWhere(env, 'orders', [{ field: 'eventId', value: eventId }, { field: 'kind', value: 'table' }])).find(o => o.fields.status === 'confirmed' && tableCode(o.id) === want) || null;
}
async function tableCap(env, f) { return f.packageId ? Number((await getDoc(env, 'table_packages', f.packageId))?.fields?.capacity || 0) : 0; }

// Security or an organiser found someone not in the system: the Manager is told (an issue for the night).
export async function gateReport(env, b, user) {
  const ev = await gateNight(env, user, b?.eventId, CHECKERS); if (!ev) return FORBIDDEN;
  const ph = normalizePhone(b?.phone);
  await setDoc(env, 'incidents', id(), { businessDate: nightKey(now()), kind: 'entry', note: `Not in the system: ${ph ? maskPhone(ph) : 'no number'}${clean(b?.note, 200) ? `: ${clean(b.note, 200)}` : ''}. Found by ${user.name || 'staff'} (${user.role}).`, people: '', needsManager: true, status: 'open', by: uidOf(user), byName: user.name || '', at: now() });
  await audit(env, user, 'GATE_NOT_IN_SYSTEM', { eventId: ev.id, phoneHint: ph ? maskPhone(ph) : '' });
  return { reported: true };
}

// The organiser's view of their night: every way people got in, and the gate's money.
export async function gateCounts(env, user, eventId) {
  const ev = await gateNight(env, user, eventId, CHECKERS); if (!ev) return { error: 'Not your night.', status: 403 };
  const [tickets, orders] = await Promise.all([queryWhere(env, 'tickets', [{ field: 'eventId', value: ev.id }]), queryWhere(env, 'orders', [{ field: 'eventId', value: ev.id }])]);
  const T = tickets.map(t => t.fields).filter(t => !t.revoked && !t.cancelled), O = orders.map(o => o.fields).filter(o => o.status === 'confirmed');
  const heads = xs => xs.reduce((n, t) => n + Number(t.admitCount || 1), 0);
  const gate = O.filter(o => o.channel === 'gate'), sum = xs => xs.reduce((n, o) => n + Number(o.amountPesewas || 0), 0);
  const members = isTonight(ev.fields) ? (await queryWhere(env, 'member_entries', [{ field: 'night', value: nightKey(now()) }])).filter(e => e.fields.method !== 'reentry').length : 0;
  return {
    event: { id: ev.id, name: ev.fields.name || '' },
    online: { sold: heads(T.filter(t => t.channel !== 'gate' && !t.comp)), in: heads(T.filter(t => t.channel !== 'gate' && !t.comp && t.status === 'used')) },
    gate: { people: heads(T.filter(t => t.channel === 'gate')), cashPesewas: sum(gate.filter(o => o.paidWith === 'cash')), momoPesewas: sum(gate.filter(o => o.paidWith === 'momo')), tables: gate.filter(o => o.kind === 'table').length },
    comps: { issued: heads(T.filter(t => t.comp)), in: heads(T.filter(t => t.comp && t.status === 'used')) },
    tables: { booked: O.filter(o => o.kind === 'table').length, arrived: O.filter(o => o.kind === 'table' && o.arrivedAt).length },
    members,
    inside: heads(T.filter(t => t.status === 'used')) + members,
  };
}
