// The draw. A spot is taken only inside the same transaction that issues a fully-paid ticket (or
// an admin comp explicitly marked in), and only while spotsTaken < cap — so the cap holds under
// simultaneous payments. The draw runs here, never in a browser, and leaves an audit record.
import { getDoc, setDoc, queryWhere, batchGet, commitTx, updateWrite, foundFields, withTransaction } from './lib/firestore.js';
import { now, id, clean } from './lib/util.js';
import { requireRole, CMS, uidOf } from './lib/auth.js';
import { sendSms } from './lib/notify.js';

export const DEFAULT_CAP = 20;
const capOf = f => (Number(f.cap) > 0 ? Number(f.cap) : DEFAULT_CAP);

export async function openRaffleForEvent(env, tx, eventId) {
  const raffles = await queryWhere(env, 'raffles', [{ field: 'eventId', value: eventId }], { transaction: tx });
  const raffle = raffles.find(r => r.fields.enabled === true && r.fields.status === 'open');
  if (!raffle) return null;
  const cap = capOf(raffle.fields), spotsTaken = Number(raffle.fields.spotsTaken || 0);
  if (spotsTaken >= cap) return null;
  return { raffleId: raffle.id, fields: raffle.fields, cap, spotsTaken };
}

export function raffleSpotWrites(env, raffle, eventId, ticketId, orderId) {
  if (!raffle) return [];
  const next = raffle.spotsTaken + 1;
  return [
    updateWrite(env, 'raffle_entries', id(), { raffleId: raffle.raffleId, eventId, ticketId, orderId, status: 'eligible', createdAt: now() }),
    updateWrite(env, 'raffles', raffle.raffleId, { ...raffle.fields, spotsTaken: next, status: next >= raffle.cap ? 'closed' : 'open', updatedAt: now() }),
  ];
}

// One raffle per night, id derived from the event so admin edits always hit the same doc.
export const raffleIdFor = eventId => `evt_${eventId}`;

export async function upsertRaffle(env, b, user) {
  if (!requireRole(user, CMS)) return { error: 'Forbidden.', status: 403 };
  if (!b?.eventId) return { error: 'Pick a night.' };
  const ev = await getDoc(env, 'events', b.eventId);
  if (!ev) return { error: 'Night not found.', status: 404 };
  const existing = (await queryWhere(env, 'raffles', [{ field: 'eventId', value: b.eventId }]))[0];
  const rid = existing?.id || raffleIdFor(b.eventId);
  const cur = existing?.fields || { spotsTaken: 0, status: 'open' };
  const prize = clean(b.prize ?? cur.prize, 140);
  if (!prize) return { error: 'Add the prize.' };
  const cap = b.cap === undefined ? capOf(cur) : Number(b.cap);
  if (!Number.isInteger(cap) || cap < 1 || cap > 500) return { error: 'Cap must be a whole number from 1 to 500.' };
  const spotsTaken = Number(cur.spotsTaken || 0);
  if (cap < spotsTaken) return { error: `${spotsTaken} spots are already taken — the cap can't go below that.` };
  let status = cur.status || 'open';
  if (status !== 'drawn') {
    if (b.status === 'closed') status = 'closed';
    else if (b.status === 'open') status = spotsTaken >= cap ? 'closed' : 'open';
    else status = spotsTaken >= cap ? 'closed' : status;
  }
  const data = { ...cur, eventId: b.eventId, prize, cap, spotsTaken, status, enabled: b.enabled === undefined ? cur.enabled !== false : b.enabled === true, public: true, updatedAt: now(), createdAt: cur.createdAt || now() };
  await setDoc(env, 'raffles', rid, data);
  await setDoc(env, 'audit_logs', id(), { action: 'RAFFLE_UPDATED', actorUid: uidOf(user), raffleId: rid, eventId: b.eventId, prize, cap, status, timestamp: now() });
  return { raffleId: rid };
}

// "Jeffery Essel" → "Jeffery E." — the most a public page ever shows of a winner.
export function safeWinnerName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Winner';
  return parts[1] ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

export async function drawRaffle(env, b, user) {
  if (!requireRole(user, CMS)) return { error: 'Forbidden.', status: 403 };
  const raffleId = b?.raffleId;
  if (!raffleId) return { error: 'raffleId is required.' };
  try {
    const result = await withTransaction(env, async tx => {
      const f = foundFields(await batchGet(env, [`raffles/${raffleId}`], tx), `/raffles/${raffleId}`);
      if (!f) throw Object.assign(new Error('Raffle not found.'), { clientError: true });
      if (f.fields.status === 'drawn') throw Object.assign(new Error('This raffle has already been drawn.'), { clientError: true });
      const entries = await queryWhere(env, 'raffle_entries', [{ field: 'raffleId', value: raffleId }, { field: 'status', value: 'eligible' }], { transaction: tx });
      if (!entries.length) throw Object.assign(new Error('No eligible entries yet.'), { clientError: true });
      const rnd = crypto.getRandomValues(new Uint32Array(1))[0];
      const winner = entries[rnd % entries.length];
      const wg = await batchGet(env, [`tickets/${winner.fields.ticketId}`, ...(winner.fields.orderId ? [`orders/${winner.fields.orderId}`] : [])], tx);
      const ticket = foundFields(wg, `/tickets/${winner.fields.ticketId}`);
      const order = winner.fields.orderId ? foundFields(wg, `/orders/${winner.fields.orderId}`) : null;
      const winnerDisplayName = safeWinnerName(ticket?.fields.customerName), winnerDisplayCode = ticket?.fields.displayCode || '';
      const when = now();
      // The raffle doc is publicly readable: it gets only the display name/code. The raw ticket id
      // (a bearer token) goes to the admin-only audit log and the client-denied entries collection.
      await commitTx(env, [
        updateWrite(env, 'raffles', raffleId, { ...f.fields, status: 'drawn', winnerDisplayName, winnerDisplayCode, drawnAt: when, eligibleEntryCount: entries.length }),
        updateWrite(env, 'raffle_entries', winner.id, { ...winner.fields, status: 'won' }),
        updateWrite(env, 'audit_logs', id(), { action: 'RAFFLE_DRAWN', raffleId, eventId: f.fields.eventId, drawnAt: when, drawnBy: uidOf(user), actorUid: uidOf(user), eligibleEntryCount: entries.length, winningTicketId: winner.fields.ticketId, winnerTicketId: winner.fields.ticketId, winnerEntryId: winner.id, timestamp: when }),
      ], tx);
      return { winnerDisplayName, winnerDisplayCode, phone: order?.fields.buyerPhone || ticket?.fields.phone, eventName: order?.fields.eventName || ticket?.fields.eventName || '', prize: f.fields.prize || '', eligible: entries.length };
    });
    if (result.phone) await sendSms(env, result.phone, `MEMORIES\n${result.winnerDisplayName}, you won the draw for ${result.eventName}${result.prize ? `: ${result.prize}` : ''}.\nTicket ${result.winnerDisplayCode}. See you at the door.`);
    return { winnerDisplayName: result.winnerDisplayName, winnerDisplayCode: result.winnerDisplayCode, eligibleEntryCount: result.eligible, notified: !!result.phone };
  } catch (e) {
    if (e.clientError) return { error: e.message, status: 400 };
    throw e;
  }
}
