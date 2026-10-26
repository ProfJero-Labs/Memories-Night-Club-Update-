// Put back a night's ticket and table records that were deleted from the database, from the
// payment records. Used by scripts/restore-night-orders.mjs (a trusted machine) and by one-time
// fixes in src/fixes/. How it works and what it never touches: see that script's header.
import { listDocs, queryWhere, batchGet, commitTx, updateWrite, setDoc } from './lib/firestore.js';
import { displayCode, nightKey, id, now } from './lib/util.js';

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const mask = p => (p ? `•••${String(p).slice(-4)}` : '');
const ghs = p => `GHS ${(Number(p || 0) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}`;
const flatShares = s => ({ evolveitSharePesewas: s?.evolveitSharePesewas || 0, memoriesSharePesewas: s?.memoriesSharePesewas || 0, organizerSharePesewas: s?.organizerSharePesewas || 0 });

// What the original sale wrote, rebuilt from its payment record (same fields as worker/src/checkout.js
// and worker/src/gate.js), with the original time.
function rebuild({ source, P, orderId, tokens, at, eventName, used, inDraw, planId = null }) {
  const mark = { restoredAt: now(), restoredFrom: source };
  const gateSale = P.channel === 'gate';   // gate sales are admitted (or seated) as they're paid
  const ticket = (token, extra = {}) => ({ customerName: P.buyerName, phoneLast4: String(P.buyerPhone || '').slice(-4), type: P.ticketTypeName, admitCount: P.admits || 1, eventId: P.eventId, eventName,
    identityLine: P.identityLine || '', reference: P.reference, displayCode: displayCode(token), status: gateSale || used.has(token) ? 'used' : 'valid', revoked: false, cancelled: false,
    inDraw: inDraw.has(token), issuedAt: at, ...(gateSale ? { checkedInAt: at, checkedInBy: P.soldBy || '' } : typeof used.get(token) === 'string' ? { checkedInAt: used.get(token) } : {}), ...extra, ...mark });
  if (P.kind === 'table') return { order: { orderId, kind: 'table', ...(P.channel === 'gate' ? { channel: 'gate', paidWith: 'momo', soldBy: P.soldBy, soldByName: P.soldByName, arrivedAt: at, arrivedBy: P.soldBy } : {}), reference: P.reference, eventId: P.eventId, eventName, packageId: P.packageId, packageName: P.packageName,
    bottles: P.bottles || [], amountPesewas: P.amountPesewas, buyerName: P.buyerName, buyerPhone: P.buyerPhone, buyerEmail: P.buyerEmail || '', status: 'confirmed', createdAt: at, shares: P.shares || {}, ...flatShares(P.shares), organizerId: P.organizerId || null, ...mark }, tickets: [] };
  const gate = gateSale;
  return {
    order: { orderId, kind: 'ticket', ...(gate ? { channel: 'gate', paidWith: 'momo', soldBy: P.soldBy, soldByName: P.soldByName, admits: P.admits || 1 } : {}), reference: P.reference, eventId: P.eventId, eventName, ticketTypeId: P.ticketTypeId, ticketTypeName: P.ticketTypeName,
      quantity: P.quantity, amountPesewas: planId ? P.totalPesewas : P.amountPesewas, buyerName: P.buyerName, buyerPhone: P.buyerPhone, buyerEmail: P.buyerEmail || '', status: 'confirmed', inDraw: tokens.some(t => inDraw.has(t)),
      ...(planId ? { paidInInstallments: true, planId } : {}), ticketIds: tokens, createdAt: at, shares: P.shares || {}, promo: P.promo || null, ...flatShares(P.shares), organizerId: P.organizerId || null, ...mark },
    tickets: tokens.map(t => [t, ticket(t, { ...(planId ? { planId } : {}), ...(gate ? { channel: 'gate', paidWith: 'momo' } : {}) })]),
  };
}

// Which documents exist, by path ("orders/abc").
async function existing(env, paths) {
  const have = new Set();
  for (let i = 0; i < paths.length; i += 100) {
    for (const x of await batchGet(env, paths.slice(i, i + 100))) if (x.found) have.add(x.found.name.split('/documents/')[1]);
  }
  return have;
}

export async function planRestore(env, night) {
  const events = (await listDocs(env, 'events')).filter(e => (isDate(night) ? e.fields.date && nightKey(e.fields.date) === night : e.id === night));
  const out = { night, events: events.map(e => ({ id: e.id, name: e.fields.name || '', date: e.fields.date })), missing: [], present: 0, notRebuilt: [] };
  for (const ev of events) {
    const eventName = ev.fields.name || '';
    const [checkouts, plans, checkins, entries, auditComps] = await Promise.all([
      queryWhere(env, 'pending_checkouts', [{ field: 'eventId', value: ev.id }]),
      queryWhere(env, 'installment_plans', [{ field: 'eventId', value: ev.id }]),
      queryWhere(env, 'checkins', [{ field: 'eventId', value: ev.id }]),
      queryWhere(env, 'raffle_entries', [{ field: 'eventId', value: ev.id }]),
      queryWhere(env, 'audit_logs', [{ field: 'action', value: 'COMP_ISSUED' }]),
    ]);
    const used = new Map(checkins.filter(c => !c.fields.undoneAt).map(c => [c.fields.ticketId, c.fields.checkedInAt || '']));
    const inDraw = new Set(entries.map(r => r.fields.ticketId));
    const cands = [];
    for (const c of checkouts) {
      const f = c.fields;
      if (f.status !== 'issued' || !f.orderId) continue;
      if (f.kind === 'ticket' || f.kind === 'table') cands.push({ source: `pending_checkouts/${c.id}`, P: { ...f, reference: c.id }, orderId: f.orderId, tokens: f.ticketIds || [], at: f.issuedAt || f.createdAt });
      else if (f.kind === 'gate' && f.sale) cands.push({ source: `pending_checkouts/${c.id}`, P: { ...f.sale, reference: c.id, channel: 'gate', eventId: f.eventId }, orderId: f.orderId, tokens: f.ticketIds || [], at: f.issuedAt || f.createdAt });
    }
    for (const p of plans) {
      const f = p.fields;
      if (f.status !== 'completed' || !f.orderId) continue;
      const last = (f.payments || []).at(-1)?.reference || '';
      cands.push({ source: `installment_plans/${p.id}`, P: { ...f, kind: 'ticket', reference: last }, orderId: f.orderId, tokens: f.ticketIds || [], at: f.completedAt || f.updatedAt, planId: p.id });
    }
    const have = await existing(env, cands.flatMap(c => [`orders/${c.orderId}`, ...c.tokens.map(t => `tickets/${t}`)]));
    for (const c of cands) {
      const built = rebuild({ ...c, eventName: c.P.eventName || eventName, used, inDraw });   // the name as it was sold
      const order = have.has(`orders/${c.orderId}`) ? null : built.order;
      const tickets = built.tickets.filter(([t]) => !have.has(`tickets/${t}`));
      if (!order && !tickets.length) { out.present++; continue; }
      out.missing.push({ eventId: ev.id, source: c.source, kind: c.P.kind, orderId: c.orderId, buyer: c.P.buyerName || '', phone: mask(c.P.buyerPhone), quantity: c.P.kind === 'table' ? 1 : c.P.quantity, what: c.P.kind === 'table' ? c.P.packageName : c.P.ticketTypeName,
        amountPesewas: built.order.amountPesewas, order, tickets });
    }
    // Comps have no copy of their code: list the ones whose order is gone, to issue again by hand.
    const comps = auditComps.filter(a => a.fields.eventId === ev.id && a.fields.orderId);
    const compHave = await existing(env, comps.map(a => `orders/${a.fields.orderId}`));
    for (const a of comps) if (!compHave.has(`orders/${a.fields.orderId}`)) out.notRebuilt.push({ eventId: ev.id, kind: 'comp', name: a.fields.name || '', admits: a.fields.admits || 1, orderId: a.fields.orderId });
  }
  return out;
}

// Writes only what's missing; each write is refused if the document has come back meanwhile.
export async function applyRestore(env, plan, { by = 'restore script', extra = {} } = {}) {
  const writes = plan.missing.flatMap(m => [...(m.order ? [{ ...updateWrite(env, 'orders', m.orderId, m.order), currentDocument: { exists: false } }] : []),
    ...m.tickets.map(([t, f]) => ({ ...updateWrite(env, 'tickets', t, f), currentDocument: { exists: false } }))]);
  for (let i = 0; i < writes.length; i += 400) await commitTx(env, writes.slice(i, i + 400));
  const orders = plan.missing.filter(m => m.order).length, tickets = plan.missing.reduce((n, m) => n + m.tickets.length, 0);
  await setDoc(env, 'audit_logs', id(), { action: 'ORDERS_RESTORED', actorUid: null, actorName: by, ...extra, night: plan.night, eventIds: plan.events.map(e => e.id), orders, tickets, orderIds: plan.missing.map(m => m.orderId), timestamp: now() });
  return { orders, tickets };
}

export function describe(plan) {
  const lines = [];
  if (!plan.events.length) return `No night found for ${plan.night}.`;
  for (const e of plan.events) lines.push(`Night: ${e.name} (${e.date}), id ${e.id}`);
  lines.push(`Already in place: ${plan.present} order${plan.present === 1 ? '' : 's'}.`);
  if (!plan.missing.length) lines.push('Nothing missing that can be rebuilt.');
  else {
    lines.push(`Missing, will be restored (${plan.missing.length}):`);
    for (const m of plan.missing) lines.push(`  ${m.kind.padEnd(6)} ${String(m.quantity).padStart(2)} × ${m.what || ''}  ${m.buyer} ${m.phone}  ${ghs(m.amountPesewas)}  order ${m.orderId}${m.order ? '' : ' (order there; tickets missing)'}  ← ${m.source}`);
    const tickets = plan.missing.reduce((n, m) => n + m.tickets.length, 0);
    lines.push(`Total: ${plan.missing.filter(m => m.order).length} orders, ${tickets} tickets, ${ghs(plan.missing.reduce((n, m) => n + (m.order ? m.amountPesewas : 0), 0))}.`);
  }
  if (plan.notRebuilt.length) {
    lines.push('Can’t be rebuilt (no copy of their codes); issue again by hand:');
    for (const n of plan.notRebuilt) lines.push(`  comp for ${n.name}, admits ${n.admits} (old order ${n.orderId})`);
  }
  return lines.join('\n');
}
