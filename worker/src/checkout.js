// Money paths. The browser never sets a price and never decides a payment succeeded: every amount
// is computed here from Firestore, and every success is confirmed with Paystack's verify API using
// the secret key before anything is issued. Issuance is transactional and idempotent per reference.
import { getDoc, setDoc, createDoc, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction } from './lib/firestore.js';
import { BITS_POLICY_VERSION, now, id, paymentRef, ticketToken, displayCode, orderCode, normalizeOrderCode, clean, normalizePhone, validEmail, firstName, money } from './lib/util.js';
import { sendSms, sendEmail, siteUrl } from './lib/notify.js';
import { getSettings, resolveLines, isOver } from './public.js';
import { openRaffleForEvent, raffleSpotWrites } from './raffle.js';

export const MIN_TOPUP_PESEWAS = 1000; // GHS 10

async function paystack(env, path, options = {}) {
  const r = await fetch(`https://api.paystack.co${path}`, { ...options, headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const d = await r.json();
  if (!r.ok || !d.status) throw new Error(d.message || 'Paystack request failed');
  return d.data;
}
// Paystack needs an email. Guests don't have to give one; their receipt address then falls back
// to a per-phone alias on the club's own domain.
export const LINE_MAX = 40;
// Where Paystack sends the guest back. Set by the Worker from PUBLIC_SITE_URL, never taken from the
// request, so nobody can point a real payment page at their own site. Empty = payments off.
export const returnUrl = env => (/^https?:\/\//.test(env.PUBLIC_SITE_URL || '') ? siteUrl(env, '/payment-return.html') : '');
const payEmail = (env, email, phone) => (validEmail(email) ? email : `guest-${phone}@${new URL(env.PUBLIC_SITE_URL || 'https://memoriesnightclub.com').hostname.replace(/^www\./, '')}`);

// Shared validation for anything that becomes a ticket.
async function ticketContext(env, b) {
  const buyerName = clean(b?.buyerName, 80), buyerPhone = normalizePhone(b?.buyerPhone);
  if (!b?.eventId || !b?.ticketTypeId) return { error: 'Pick a ticket.' };
  if (!buyerName) return { error: 'We need your name for the ticket.' };
  if (!buyerPhone) return { error: 'That phone number doesn’t look right. Use a Ghana number, e.g. 024 123 4567.' };
  if (b.buyerEmail && !validEmail(b.buyerEmail)) return { error: 'That email doesn’t look right.' };
  const qty = Number(b.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 6) return { error: 'You can get 1 to 6 tickets at a time.' };
  if (!returnUrl(env)) return { error: 'Payments are not set up yet.', status: 503 };
  const [ev, tt, settings] = await Promise.all([getDoc(env, 'events', b.eventId), getDoc(env, 'ticket_types', b.ticketTypeId), getSettings(env)]);
  if (!ev || !tt || ev.fields.active === false || ev.fields.visibility !== 'public' || tt.fields.eventId !== b.eventId || tt.fields.active !== true) return { error: 'This ticket is no longer available.' };
  if (ev.fields.soldOut === true || (typeof tt.fields.remaining === 'number' && tt.fields.remaining < qty)) return { error: 'Not enough tickets left for that.' };
  if (isOver(ev.fields)) return { error: 'This night has already happened.' };
  // The guest picks one of the night's lines or writes their own (short enough to sit on the ticket).
  // A night with lines needs one or the other; a night without lines can go without.
  const lines = resolveLines(ev.fields, settings);
  const own = clean(b.identityLine, 400).replace(/\s+/g, ' ').slice(0, LINE_MAX).trim();
  const identityLine = lines.includes(b.identityLine) ? b.identityLine : own;
  if (lines.length && !identityLine) return { error: 'Pick a line or write your own.' };
  const unit = Number(tt.fields.pricePesewas || 0);
  if (!(unit > 0)) return { error: 'This ticket is no longer available.' };
  return { ev, tt, qty, buyerName, buyerPhone, buyerEmail: clean(b.buyerEmail, 120), identityLine, totalPesewas: unit * qty };
}

// ── Pay in full ──
export async function initiateTicket(env, b) {
  const c = await ticketContext(env, b); if (c.error) return c;
  const reference = paymentRef();
  await setDoc(env, 'pending_checkouts', reference, {
    reference, kind: 'ticket', eventId: c.ev.id, eventName: c.ev.fields.name || '', ticketTypeId: c.tt.id, ticketTypeName: c.tt.fields.name || 'Ticket',
    admits: Number(c.tt.fields.admits || 1), quantity: c.qty, amountPesewas: c.totalPesewas, buyerName: c.buyerName, buyerPhone: c.buyerPhone,
    buyerEmail: c.buyerEmail, identityLine: c.identityLine, status: 'pending', createdAt: now(),
  });
  try {
    const p = await paystack(env, '/transaction/initialize', { method: 'POST', body: JSON.stringify({ email: payEmail(env, c.buyerEmail, c.buyerPhone), amount: c.totalPesewas, currency: 'GHS', reference, callback_url: returnUrl(env), metadata: { kind: 'ticket', eventId: c.ev.id, ticketTypeId: c.tt.id, quantity: c.qty } }) });
    return { reference, authorizationUrl: p.authorization_url };
  } catch (e) {
    await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'ticket', eventId: c.ev.id, status: 'failed', error: 'payment_initialization_failed', failedAt: now() });
    throw e;
  }
}

// Confirms the charge with Paystack and checks it matches what we asked for. Returns null when
// the checkout can go on to issuance.
async function confirmCharge(env, pending, reference) {
  const payment = await paystack(env, `/transaction/verify/${encodeURIComponent(reference)}`);
  if (payment.status !== 'success') return { status: payment.status === 'failed' || payment.status === 'abandoned' ? 'failed' : 'pending', error: payment.status === 'failed' ? 'Payment was not successful.' : undefined };
  if (payment.currency !== 'GHS' || Number(payment.amount) !== Number(pending.fields.amountPesewas)) {
    await setDoc(env, 'pending_checkouts', reference, { ...pending.fields, status: 'failed', error: 'amount_mismatch' });
    return { status: 'failed', error: 'Payment amount did not match. Contact us with your reference.' };
  }
  return null;
}

function ticketWrites(env, { tokens, holder, phone, eventId, eventName, typeName, admits, identityLine, reference, inDrawToken, extra = {} }) {
  return tokens.map(token => updateWrite(env, 'tickets', token, {
    customerName: holder, phoneLast4: String(phone || '').slice(-4), type: typeName, admitCount: admits, eventId, eventName, identityLine, reference,
    displayCode: displayCode(token), status: 'valid', revoked: false, cancelled: false, inDraw: token === inDrawToken, issuedAt: now(), ...extra,
  }));
}

export async function fulfillTicket(env, reference) {
  const pending = await getDoc(env, 'pending_checkouts', reference);
  if (!pending) return { status: 'failed', error: 'Checkout not found.' };
  if (pending.fields.status === 'issued') return { status: 'issued', ticketIds: pending.fields.ticketIds || [], orderId: pending.fields.orderId };
  if (pending.fields.status === 'failed') return { status: 'failed', error: pending.fields.error || 'Payment was not successful.' };
  const bad = await confirmCharge(env, pending, reference); if (bad) return bad;
  const P = pending.fields;
  const result = await withTransaction(env, async tx => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `ticket_types/${P.ticketTypeId}`], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), tt = foundFields(got, `/ticket_types/${P.ticketTypeId}`);
    if (!fresh || !tt) throw new Error('Checkout data disappeared.');
    if (fresh.fields.status === 'issued') return { status: 'issued', ticketIds: fresh.fields.ticketIds || [], orderId: fresh.fields.orderId, already: true };
    const remaining = typeof tt.fields.remaining === 'number' ? tt.fields.remaining : null;
    if (remaining !== null && remaining < P.quantity) {
      await commitTx(env, [updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'failed', error: 'sold_out_after_payment', refundStatus: 'manual_required' })], tx);
      return { status: 'failed', error: 'Tickets sold out while your payment was confirming. Contact us for a refund.' };
    }
    const orderId = id();
    const raffle = await openRaffleForEvent(env, tx, P.eventId);
    const tokens = Array.from({ length: P.quantity }, ticketToken);
    const inDraw = !!raffle;
    const writes = [
      ...ticketWrites(env, { tokens, holder: P.buyerName, phone: P.buyerPhone, eventId: P.eventId, eventName: P.eventName, typeName: P.ticketTypeName, admits: P.admits || 1, identityLine: P.identityLine || '', reference, inDrawToken: inDraw ? tokens[0] : null }),
      ...raffleSpotWrites(env, raffle, P.eventId, tokens[0], orderId),
      updateWrite(env, 'orders', orderId, { orderId, kind: 'ticket', reference, eventId: P.eventId, eventName: P.eventName, ticketTypeId: P.ticketTypeId, ticketTypeName: P.ticketTypeName, quantity: P.quantity, amountPesewas: P.amountPesewas, buyerName: P.buyerName, buyerPhone: P.buyerPhone, buyerEmail: P.buyerEmail || '', status: 'confirmed', inDraw, ticketIds: tokens, createdAt: now() }),
      updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'issued', ticketIds: tokens, orderId, issuedAt: now() }),
    ];
    if (remaining !== null) writes.push(updateWrite(env, 'ticket_types', P.ticketTypeId, { ...tt.fields, remaining: remaining - P.quantity }));
    await commitTx(env, writes, tx);
    return { status: 'issued', ticketIds: tokens, orderId };
  });
  if (result.status === 'issued' && !result.already) {
    const link = siteUrl(env, `/ticket.html?token=${result.ticketIds[0]}`);
    await sendSms(env, P.buyerPhone, `MEMORIES\nYou're in for ${P.eventName}.\nYour ticket: ${link}`);
    await sendEmail(env, P.buyerEmail, 'Your Memories ticket', [`You're in for ${P.eventName}.`, `Your ticket: ${link}`, `Reference: ${reference}`]);
  }
  delete result.already;
  return result;
}

// ── Tables: package + bottles, paid in full ──
export async function initiateTable(env, b) {
  const name = clean(b?.name, 80), phone = normalizePhone(b?.phone);
  if (!b?.eventId || !b?.packageId) return { error: 'Pick a table.' };
  if (!name) return { error: 'We need a name for the booking.' };
  if (!phone) return { error: 'That phone number doesn’t look right. Use a Ghana number, e.g. 024 123 4567.' };
  if (b.email && !validEmail(b.email)) return { error: 'That email doesn’t look right.' };
  if (!returnUrl(env)) return { error: 'Payments are not set up yet.', status: 503 };
  const [ev, pkg] = await Promise.all([getDoc(env, 'events', b.eventId), getDoc(env, 'table_packages', b.packageId)]);
  if (!ev || !pkg || ev.fields.active === false || ev.fields.visibility !== 'public' || pkg.fields.eventId !== b.eventId || pkg.fields.active !== true) return { error: 'This table isn’t available any more.' };
  if (isOver(ev.fields)) return { error: 'This night has already happened.' };
  if (typeof pkg.fields.remaining === 'number' && pkg.fields.remaining < 1) return { error: 'That table is fully booked.' };
  const chosen = (Array.isArray(b.bottles) ? b.bottles : []).map(x => ({ id: String(x.id || ''), quantity: Number(x.quantity || 0) })).filter(x => x.id && Number.isInteger(x.quantity) && x.quantity > 0 && x.quantity <= 50);
  let amount = Number(pkg.fields.pricePesewas || 0);
  const bottleItems = [];
  for (const item of chosen) {
    const btl = await getDoc(env, 'bottles', item.id);
    if (!btl || (btl.fields.eventId !== b.eventId && btl.fields.eventId !== 'all') || btl.fields.active !== true) return { error: 'A bottle you picked isn’t available any more.' };
    if (typeof btl.fields.remaining === 'number' && btl.fields.remaining < item.quantity) return { error: `Not enough ${btl.fields.name || 'of that bottle'} left.` };
    amount += Number(btl.fields.pricePesewas || 0) * item.quantity;
    bottleItems.push({ id: item.id, name: btl.fields.name, quantity: item.quantity, unitPricePesewas: Number(btl.fields.pricePesewas || 0) });
  }
  if (!(amount > 0)) return { error: 'This table isn’t available any more.' };
  const reference = paymentRef();
  await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'table', eventId: b.eventId, eventName: ev.fields.name || '', packageId: b.packageId, packageName: pkg.fields.name || '', packagePricePesewas: Number(pkg.fields.pricePesewas || 0), bottles: bottleItems, amountPesewas: amount, buyerName: name, buyerPhone: phone, buyerEmail: clean(b.email, 120), status: 'pending', createdAt: now() });
  const p = await paystack(env, '/transaction/initialize', { method: 'POST', body: JSON.stringify({ email: payEmail(env, b.email, phone), amount, currency: 'GHS', reference, callback_url: returnUrl(env), metadata: { kind: 'table', eventId: b.eventId, packageId: b.packageId } }) });
  return { reference, authorizationUrl: p.authorization_url };
}

export async function fulfillTable(env, reference) {
  const pending = await getDoc(env, 'pending_checkouts', reference);
  if (!pending) return { status: 'failed', error: 'Checkout not found.' };
  if (pending.fields.status === 'issued') return { status: 'issued', orderId: pending.fields.orderId };
  if (pending.fields.status === 'failed') return { status: 'failed', error: pending.fields.error || 'Payment failed.' };
  const bad = await confirmCharge(env, pending, reference); if (bad) return bad;
  const P = pending.fields;
  const bottlePaths = (P.bottles || []).map(x => `bottles/${x.id}`);
  const result = await withTransaction(env, async tx => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `table_packages/${P.packageId}`, ...bottlePaths], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), pkg = foundFields(got, `/table_packages/${P.packageId}`);
    if (!fresh || !pkg) throw new Error('Table checkout data disappeared.');
    if (fresh.fields.status === 'issued') return { status: 'issued', orderId: fresh.fields.orderId, already: true };
    const soldOut = async error => { await commitTx(env, [updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'failed', error, refundStatus: 'manual_required' })], tx); return { status: 'failed', error: 'Something you picked sold out while your payment was confirming. Contact us for a refund.' }; };
    if (typeof pkg.fields.remaining === 'number' && pkg.fields.remaining < 1) return soldOut('table_sold_out_after_payment');
    for (const item of P.bottles || []) {
      const bt = foundFields(got, `/bottles/${item.id}`);
      if (!bt) throw new Error('Bottle disappeared.');
      if (typeof bt.fields.remaining === 'number' && bt.fields.remaining < item.quantity) return soldOut('bottle_sold_out_after_payment');
    }
    const orderId = id();
    const writes = [
      updateWrite(env, 'orders', orderId, { orderId, kind: 'table', reference, eventId: P.eventId, eventName: P.eventName, packageId: P.packageId, packageName: P.packageName, bottles: P.bottles || [], amountPesewas: P.amountPesewas, buyerName: P.buyerName, buyerPhone: P.buyerPhone, buyerEmail: P.buyerEmail || '', status: 'confirmed', createdAt: now() }),
      updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'issued', orderId, issuedAt: now() }),
    ];
    if (typeof pkg.fields.remaining === 'number') writes.push(updateWrite(env, 'table_packages', P.packageId, { ...pkg.fields, remaining: pkg.fields.remaining - 1 }));
    for (const item of P.bottles || []) { const bt = foundFields(got, `/bottles/${item.id}`); if (typeof bt.fields.remaining === 'number') writes.push(updateWrite(env, 'bottles', item.id, { ...bt.fields, remaining: bt.fields.remaining - item.quantity })); }
    await commitTx(env, writes, tx);
    return { status: 'issued', orderId };
  });
  if (result.status === 'issued' && !result.already) {
    await sendSms(env, P.buyerPhone, `MEMORIES\nTable confirmed: ${P.packageName}, ${P.eventName}.\nTotal paid ${money(P.amountPesewas)}. Ref ${reference}.`);
    await sendEmail(env, P.buyerEmail, 'Your Memories table is confirmed', [`${P.packageName} · ${P.eventName}`, `Total paid: ${money(P.amountPesewas)}`, `Reference: ${reference}`]);
  }
  delete result.already;
  return result;
}

// ── Pay in bits ──
// One installment_plans doc per order, keyed by a short code. Each top-up is an ordinary Paystack
// charge recorded against the plan by its reference (so a reference can only count once). No stock
// is held and no ticket, share image or raffle spot exists until the balance reaches zero.
export async function startInstallment(env, b) {
  // The guest must tick the pay-in-bits rule; the version and time are kept with the plan.
  if (b?.acknowledged !== true) return { error: 'Tick the box to confirm how pay in bits works.' };
  const c = await ticketContext(env, b); if (c.error) return c;
  const deposit = Number(b.depositPesewas);
  if (!Number.isInteger(deposit) || deposit < MIN_TOPUP_PESEWAS) return { error: 'The smallest payment is GHS 10.' };
  if (deposit > c.totalPesewas) return { error: 'That’s more than the ticket costs.' };
  let planId;
  for (let attempt = 0; attempt < 6 && !planId; attempt++) {
    const code = orderCode();
    try {
      await createDoc(env, 'installment_plans', code, {
        eventId: c.ev.id, eventName: c.ev.fields.name || '', eventDate: c.ev.fields.date || '', ticketTypeId: c.tt.id, ticketTypeName: c.tt.fields.name || 'Ticket',
        admits: Number(c.tt.fields.admits || 1), quantity: c.qty, totalPesewas: c.totalPesewas, paidPesewas: 0,
        buyerName: c.buyerName, firstName: firstName(c.buyerName), buyerPhone: c.buyerPhone, buyerEmail: c.buyerEmail, identityLine: c.identityLine,
        status: 'active', payments: [], createdAt: now(), updatedAt: now(), policyVersion: BITS_POLICY_VERSION, acknowledgedAt: now(),
      });
      planId = code;
    } catch (e) { if (!String(e.message).includes('ALREADY_EXISTS')) throw e; }
  }
  if (!planId) return { error: 'Couldn’t start your order right now. Try again.' };
  return startInstallmentTopup(env, planId, deposit, payEmail(env, c.buyerEmail, c.buyerPhone));
}

export async function startInstallmentTopup(env, planId, amountPesewas, email) {
  const reference = paymentRef();
  await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'installment_topup', planId, amountPesewas, status: 'pending', createdAt: now() });
  try {
    const p = await paystack(env, '/transaction/initialize', { method: 'POST', body: JSON.stringify({ email, amount: amountPesewas, currency: 'GHS', reference, callback_url: returnUrl(env), metadata: { kind: 'installment_topup', planId } }) });
    return { reference, authorizationUrl: p.authorization_url, planId };
  } catch (e) {
    await setDoc(env, 'pending_checkouts', reference, { reference, kind: 'installment_topup', planId, amountPesewas, status: 'failed', error: 'payment_initialization_failed', failedAt: now() });
    throw e;
  }
}

export async function topupInstallment(env, b) {
  const planId = normalizeOrderCode(b?.planId);
  if (!planId) return { error: 'Enter your order code.' };
  if (!returnUrl(env)) return { error: 'Payments are not set up yet.', status: 503 };
  const plan = await getDoc(env, 'installment_plans', planId);
  if (!plan) return { error: 'We couldn’t find that order.' };
  if (await maybeForfeitPlan(env, plan)) return { error: 'This order was forfeited because the night has passed.' };
  if (plan.fields.status !== 'active') return { error: plan.fields.status === 'completed' ? 'This order is already fully paid.' : 'This order is no longer active.' };
  const remaining = Number(plan.fields.totalPesewas) - Number(plan.fields.paidPesewas || 0);
  const amount = Number(b.amountPesewas);
  if (!Number.isInteger(amount) || amount < Math.min(MIN_TOPUP_PESEWAS, remaining)) return { error: 'The smallest payment is GHS 10.' };
  if (amount > remaining) return { error: `Your balance is ${money(remaining)}. Pay that or less.` };
  return startInstallmentTopup(env, planId, amount, payEmail(env, plan.fields.buyerEmail, plan.fields.buyerPhone));
}

export async function maybeForfeitPlan(env, plan) {
  if (plan.fields.status !== 'active') return plan.fields.status === 'forfeited';
  const ev = await getDoc(env, 'events', plan.fields.eventId);
  if (ev && new Date(ev.fields.date).getTime() <= Date.now()) {
    await setDoc(env, 'installment_plans', plan.id, { ...plan.fields, status: 'forfeited', updatedAt: now() });
    return true;
  }
  return false;
}

// What the public lookup may show about an order. Never ticket ids, links, QR data or the phone:
// the order code is not proof of who you are, so it can't hand out tickets.
export const planSummary = p => {
  const total = Number(p.fields.totalPesewas || 0), paid = Number(p.fields.paidPesewas || 0);
  return {
    planId: p.id, eventName: p.fields.eventName || '', eventDate: p.fields.eventDate || '', firstName: p.fields.firstName || firstName(p.fields.buyerName),
    totalPesewas: total, paidPesewas: paid, remainingPesewas: Math.max(0, total - paid), status: p.fields.status, ticketReady: p.fields.status === 'completed',
  };
};

// Lookup is by order code only. (Phone lookups text the codes instead: see textOrderCodes.)
export async function lookupInstallments(env, { code }) {
  const c = normalizeOrderCode(code); if (!c) return [];
  const p = await getDoc(env, 'installment_plans', c);
  return p ? [planSummary(p)] : [];
}

// One reply for every case, so these can't be used to learn whether a number or order exists.
export const NEUTRAL_CODES = 'If that number has orders with us, we’ve texted the order codes to it.';
export const NEUTRAL_LINK = 'If this order is yours and paid in full, we’ve texted the ticket link to the number on it.';

// "Lost my code": text every open or paid order code to the phone that made them.
export async function textOrderCodes(env, { phone }) {
  const ph = normalizePhone(phone); if (!ph) return false;
  const plans = (await queryWhere(env, 'installment_plans', [{ field: 'buyerPhone', value: ph }]))
    .filter(p => ['active', 'completed'].includes(p.fields.status)).slice(0, 5);
  if (!plans.length) return false;
  const lines = plans.map(p => `${p.id}: ${p.fields.eventName || 'your night'}${p.fields.status === 'completed' ? ' (paid)' : ` (${money(Number(p.fields.totalPesewas) - Number(p.fields.paidPesewas || 0))} left)`}`);
  return sendSms(env, ph, `MEMORIES\nYour orders:\n${lines.join('\n')}\nPay or check: ${siteUrl(env, '/installment.html')}`);
}

// "Text me the link" on a paid order: only to the phone on the order, and only if the guest
// gave that same number.
export async function resendTicketLink(env, { planId, phone }) {
  const c = normalizeOrderCode(planId), ph = normalizePhone(phone);
  if (!c || !ph) return false;
  const p = await getDoc(env, 'installment_plans', c);
  if (!p || p.fields.status !== 'completed' || p.fields.buyerPhone !== ph || !(p.fields.ticketIds || []).length) return false;
  const links = p.fields.ticketIds.map(t => siteUrl(env, `/ticket.html?token=${t}`));
  return sendSms(env, ph, `MEMORIES\n${p.fields.eventName || 'Your night'}.\nYour ticket${links.length > 1 ? 's' : ''}: ${links.join(' ')}`);
}

export async function fulfillInstallment(env, reference) {
  const pending = await getDoc(env, 'pending_checkouts', reference);
  if (!pending) return { status: 'failed', error: 'Checkout not found.' };
  if (pending.fields.status === 'issued') return { status: 'issued', kind: 'installment', planId: pending.fields.planId, ticketIds: pending.fields.ticketIds || [], planComplete: pending.fields.planComplete === true };
  if (pending.fields.status === 'failed') return { status: 'failed', error: pending.fields.error || 'Payment was not successful.' };
  const bad = await confirmCharge(env, pending, reference); if (bad) return bad;
  const planId = pending.fields.planId;
  const result = await withTransaction(env, async tx => {
    const got = await batchGet(env, [`pending_checkouts/${reference}`, `installment_plans/${planId}`], tx);
    const fresh = foundFields(got, `/pending_checkouts/${reference}`), plan = foundFields(got, `/installment_plans/${planId}`);
    if (!fresh || !plan) throw new Error('Installment plan data disappeared.');
    const P = plan.fields;
    if (fresh.fields.status === 'issued') return { status: 'issued', kind: 'installment', planId, ticketIds: fresh.fields.ticketIds || [], planComplete: fresh.fields.planComplete === true, already: true };
    const payment = { reference, amountPesewas: fresh.fields.amountPesewas, paidAt: now() };
    if (P.status === 'forfeited') {
      await commitTx(env, [updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'failed', error: 'plan_forfeited', refundStatus: 'manual_required' })], tx);
      return { status: 'failed', error: 'This order was forfeited. Contact us.' };
    }
    // A stray charge after completion (two top-ups racing) is real money: record it for a manual
    // refund, never issue a second ticket.
    if (P.status === 'completed') {
      await commitTx(env, [
        updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'issued', planComplete: false, overpaid: true, ticketIds: P.ticketIds || [], orderId: P.orderId, issuedAt: now() }),
        updateWrite(env, 'installment_plans', planId, { ...P, paidPesewas: Number(P.paidPesewas || 0) + Number(fresh.fields.amountPesewas || 0), overpaidPesewas: Number(P.overpaidPesewas || 0) + Number(fresh.fields.amountPesewas || 0), payments: [...(P.payments || []), { ...payment, note: 'overpayment_after_completion' }], updatedAt: now() }),
      ], tx);
      return { status: 'issued', kind: 'installment', planId, ticketIds: P.ticketIds || [], planComplete: false, overpaid: true };
    }
    const paidPesewas = Number(P.paidPesewas || 0) + Number(fresh.fields.amountPesewas || 0);
    const payments = [...(P.payments || []), payment];
    const writes = [];
    let planComplete = false, tokens = [], orderId = null;
    if (paidPesewas >= P.totalPesewas) {
      const tt = foundFields(await batchGet(env, [`ticket_types/${P.ticketTypeId}`], tx), `/ticket_types/${P.ticketTypeId}`);
      const remaining = tt && typeof tt.fields.remaining === 'number' ? tt.fields.remaining : null;
      if (remaining !== null && remaining < P.quantity) {
        await commitTx(env, [
          updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'failed', error: 'sold_out_after_payment', refundStatus: 'manual_required' }),
          updateWrite(env, 'installment_plans', planId, { ...P, paidPesewas, payments, status: 'sold_out', updatedAt: now() }),
        ], tx);
        return { status: 'failed', error: 'Tickets sold out before your last payment landed. Contact us for a refund.' };
      }
      planComplete = true; orderId = id();
      const raffle = await openRaffleForEvent(env, tx, P.eventId);
      tokens = Array.from({ length: P.quantity }, ticketToken);
      writes.push(
        ...ticketWrites(env, { tokens, holder: P.buyerName, phone: P.buyerPhone, eventId: P.eventId, eventName: P.eventName, typeName: P.ticketTypeName, admits: P.admits || 1, identityLine: P.identityLine || '', reference, inDrawToken: raffle ? tokens[0] : null, extra: { planId } }),
        ...raffleSpotWrites(env, raffle, P.eventId, tokens[0], orderId),
        updateWrite(env, 'orders', orderId, { orderId, kind: 'ticket', reference, eventId: P.eventId, eventName: P.eventName, ticketTypeId: P.ticketTypeId, ticketTypeName: P.ticketTypeName, quantity: P.quantity, amountPesewas: P.totalPesewas, buyerName: P.buyerName, buyerPhone: P.buyerPhone, buyerEmail: P.buyerEmail || '', status: 'confirmed', inDraw: !!raffle, paidInInstallments: true, planId, ticketIds: tokens, createdAt: now() }),
        updateWrite(env, 'installment_plans', planId, { ...P, paidPesewas, payments, status: 'completed', ticketIds: tokens, orderId, completedAt: now(), updatedAt: now() }),
      );
      if (remaining !== null) writes.push(updateWrite(env, 'ticket_types', P.ticketTypeId, { ...tt.fields, remaining: remaining - P.quantity }));
    } else {
      writes.push(updateWrite(env, 'installment_plans', planId, { ...P, paidPesewas, payments, updatedAt: now() }));
    }
    writes.push(updateWrite(env, 'pending_checkouts', reference, { ...fresh.fields, status: 'issued', planComplete, ticketIds: tokens, orderId, issuedAt: now() }));
    await commitTx(env, writes, tx);
    return { status: 'issued', kind: 'installment', planId, ticketIds: tokens, planComplete, orderId, plan: P, paidPesewas, received: fresh.fields.amountPesewas };
  });
  // One message per newly-applied reference: a repeat verify/webhook for the same reference
  // returns at the 'issued' checks above and never reaches this.
  if (result.status === 'issued' && !result.already && result.plan) {
    const P = result.plan;
    if (result.planComplete) {
      const link = siteUrl(env, `/ticket.html?token=${result.ticketIds[0]}`);
      await sendSms(env, P.buyerPhone, `MEMORIES\nPaid in full. Order ${planId}.\nYou're in for ${P.eventName}: ${link}`);
      await sendEmail(env, P.buyerEmail, 'Your Memories ticket', [`Paid in full. Order ${planId}.`, `You're in for ${P.eventName}.`, `Your ticket: ${link}`]);
    } else {
      await sendSms(env, P.buyerPhone, balanceMessage(env, planId, result.received, P.totalPesewas - result.paidPesewas));
    }
  }
  delete result.already; delete result.plan; delete result.received; delete result.paidPesewas;
  return result;
}
export const balanceMessage = (env, planId, received, balance) =>
  `MEMORIES\n${received ? `${money(received)} received. ` : ''}Balance: ${money(balance)}.\nOrder ${planId}.\nPay the rest: ${siteUrl(env, `/installment.html?code=${planId}`)}`;

export async function forfeitStalePlans(env) {
  const active = await queryWhere(env, 'installment_plans', [{ field: 'status', value: 'active' }]);
  let forfeited = 0;
  for (const plan of active) if (await maybeForfeitPlan(env, plan)) forfeited++;
  return { checked: active.length, forfeited };
}

export async function fulfill(env, reference) {
  const p = await getDoc(env, 'pending_checkouts', reference);
  if (!p) return { status: 'failed', error: 'Checkout not found.' };
  if (p.fields.kind === 'table') return { kind: 'table', ...(await fulfillTable(env, reference)) };
  if (p.fields.kind === 'installment_topup') return fulfillInstallment(env, reference);
  return { kind: 'ticket', ...(await fulfillTicket(env, reference)) };
}

// What the payment-return page polls. Ticket tokens are returned only to whoever holds the
// reference (Paystack puts it in their redirect), which is the buyer.
export async function checkoutStatus(env, reference) {
  const d = await getDoc(env, 'pending_checkouts', reference);
  if (!d) return null;
  const f = d.fields;
  const out = { status: f.status, kind: f.kind || 'ticket', eventId: f.eventId || '', eventName: f.eventName || '', packageName: f.packageName || '', amountPesewas: f.amountPesewas, bottles: f.bottles || [], tickets: (f.ticketIds || []).map(token => ({ token })), error: f.status === 'failed' ? f.error : undefined };
  if (f.kind === 'installment_topup' && f.planId) {
    const plan = await getDoc(env, 'installment_plans', f.planId);
    if (plan) Object.assign(out, { eventId: plan.fields.eventId, planId: f.planId, planStatus: plan.fields.status, paidPesewas: plan.fields.paidPesewas, totalPesewas: plan.fields.totalPesewas, eventName: plan.fields.eventName, planComplete: f.planComplete === true || plan.fields.status === 'completed' });
  }
  return out;
}
