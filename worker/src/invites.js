// Invitations (e.g. Ladies Night): free tickets that look like a red VIP card, sent by text.
//
// Two ways in:
//   1. Staff send them: paste phone numbers (each can have its own number of passes).
//   2. Guests ask on the website: the night's invitation page asks three rotating questions; the
//      request waits until staff approve it (the invitation is texted then) or decline it.
// One invitation admits its passes together, once. The door finds it by the phone number.
//
//   events/{id}.invitation   { open, title, tagline, perk, dress, passes }   (open: guests may ask online)
//   invite_requests/{eventId_phone}  eventId, phone, style her|him, instagram, answers [{ q, a }], status
//                            pending|approved|declined, createdAt, decidedAt, decidedByName, ticketId
//   tickets/{token}.invite   { title, tagline, perk, dress, style }   style 'her' (the ladies' visa)
//                            or 'him' (the gentlemen's Memories card: a pass to witness, no perks)   (a free ticket: comp true, type 'Invitation')
import { getDoc, setDoc, queryWhere, commitTx, updateWrite, withTransaction, batchGet, parseFields, listDocs } from './lib/firestore.js';
import { now, id, clean, normalizePhone, ticketToken, displayCode, maskPhone, formatAccra } from './lib/util.js';
import { requireRole, uidOf } from './lib/auth.js';
import { sendSms, siteUrl } from './lib/notify.js';
import { isOver } from './public.js';

// Who sends invitations and decides requests: the bosses, the human manager, the event manager and media.
export const INVITERS = ['superAdmin', 'director', 'manager', 'hrManager', 'eventManager', 'media'];
export const INVITE_BATCH = 20, MAX_PASSES = 20;
const FORBIDDEN = { error: 'Forbidden.', status: 403 };
const audit = (env, user, action, data) => setDoc(env, 'audit_logs', id(), { action, actorUid: uidOf(user), ...data, timestamp: now() });

// A night's invitation wording (defaults: the night's name, "Her night. Her rules.", free drinks till
// 12AM, strict dress code).
export function invitationOf(ev) {
  const i = ev?.fields?.invitation || {};
  return { open: i.open === true, title: clean(i.title, 40) || clean(ev?.fields?.name, 40) || 'Ladies Night', tagline: clean(i.tagline, 60) || 'Her night. Her rules.',
    perk: i.perk === undefined ? 'Free drinks till 12AM' : clean(i.perk, 60), dress: i.dress === undefined ? 'Strict dress code' : clean(i.dress, 60), passes: Number.isInteger(i.passes) && i.passes >= 1 && i.passes <= MAX_PASSES ? i.passes : 1 };
}
const night = ev => formatAccra(ev.fields.date, { weekday: 'short', day: 'numeric', month: 'short' });
// Where it is: the night's venue, or the club's home at SamRit Hotel, Cape Coast.
export const venueOf = ev => { const v = clean(ev?.fields?.venue, 60); return v && !/^memories/i.test(v) ? v : 'SamRit Hotel, Cape Coast'; };
// One flowing paragraph with the link last, so it reads across the phone, not down it.
function smsFor(ev, inv, passes, link, { added = false, approved = false, name = '' } = {}) {
  const him = inv.style === 'him', when = `${night(ev)} at Memories Night Club, ${venueOf(ev)}`;
  const greeting = name ? `Hi ${name.split(/\s+/)[0]}, ` : '';
  const head = approved ? `MEMORIES: ${greeting}Your request is accepted. ${him ? `You're invited to witness ${inv.title}` : `You're on the list for ${inv.title}`}, ${when}.`
    : `MEMORIES: ${greeting}${him ? `You're invited to witness ${inv.title}` : `You're invited to ${inv.title}`}, ${when}.`;
  const notes = [him ? '' : inv.perk, inv.dress, passes > 1 ? `Admits ${passes}` : ''].filter(Boolean).join('. ');
  return [head, notes ? `${notes}.` : '', added ? `You now have ${passes} passes.` : '', `At the door, give this number. Your ${him ? 'pass' : 'card'}: ${link}`].filter(Boolean).join(' ');
}

// Issues one invitation (or adds passes to the one this phone already has). Returns a result row.
async function issueOne(env, ev, invNight, phone, passes, { ifInvited = 'skip', existing, user, approved = false, style = 'her', name = '' } = {}) {
  const inv = cardFor(invNight, style);
  const had = existing.find(t => t.fields.phone === phone);
  if (had && ifInvited !== 'add') return { phone, status: 'already', passes: Number(had.fields.admitCount || 1), message: `Already invited (${Number(had.fields.admitCount || 1)} pass${Number(had.fields.admitCount || 1) > 1 ? 'es' : ''})`, token: had.id };
  if (had) {
    const r = await withTransaction(env, async tx => {
      const f = (await batchGet(env, [`tickets/${had.id}`], tx)).find(x => x.found)?.found, got = f ? parseFields(f.fields) : null;
      if (!got || got.status === 'used' || got.revoked || got.cancelled) return { error: got?.status === 'used' ? 'Already used at the door' : 'Invitation not found' };
      const total = Math.min(MAX_PASSES, Number(got.admitCount || 1) + passes);
      await commitTx(env, [updateWrite(env, 'tickets', had.id, { ...got, admitCount: total, passesAddedAt: now() })], tx);
      return { total };
    });
    if (r.error) return { phone, status: 'invalid', message: r.error };
    had.fields.admitCount = r.total;
    const link = siteUrl(env, `/ticket.html?token=${had.id}`);
    const texted = await sendSms(env, phone, smsFor(ev, inv, r.total, link, { added: true, name }));
    return { phone, status: texted ? 'added' : 'added_not_texted', passes: r.total, link, token: had.id };
  }
  const token = ticketToken(), orderId = id(), issuedBy = uidOf(user);
  const guestName = name || 'Guest';
  const invite = { title: inv.title, tagline: inv.tagline, perk: inv.perk, dress: inv.dress, style: inv.style };
  await commitTx(env, [
    updateWrite(env, 'tickets', token, { customerName: guestName, phone, phoneLast4: phone.slice(-4), type: 'Invitation', admitCount: passes, eventId: ev.id, eventName: ev.fields.name || '', identityLine: '', reference: orderId, displayCode: displayCode(token), status: 'valid', revoked: false, cancelled: false, comp: true, invite, issuedBy, compNote: `Invitation: ${inv.title}`, inDraw: false, issuedAt: now() }),
    updateWrite(env, 'orders', orderId, { orderId, kind: 'comp', invite: true, eventId: ev.id, eventName: ev.fields.name || '', quantity: 1, admits: passes, amountPesewas: 0, buyerName: guestName, buyerPhone: phone, status: 'confirmed', issuedBy, note: `Invitation: ${inv.title}`, inDraw: false, ticketIds: [token], createdAt: now() }),
  ]);
  existing.push({ id: token, fields: { phone, invite, admitCount: passes } });
  const link = siteUrl(env, `/ticket.html?token=${token}`);
  const texted = await sendSms(env, phone, smsFor(ev, inv, passes, link, { approved, name }));
  return { phone, status: texted ? 'sent' : 'not_texted', passes, link, token };
}
const invitesOf = async (env, eventId) => (await queryWhere(env, 'tickets', [{ field: 'eventId', value: eventId }])).filter(t => t.fields.invite && !t.fields.revoked && !t.fields.cancelled);
async function inviteNight(env, eventId) {
  const ev = eventId ? await getDoc(env, 'events', String(eventId)) : null;
  if (!ev) return { error: 'Night not found.', status: 404 };
  if (isOver(ev.fields)) return { error: 'This night has already happened.' };
  return { ev };
}

// The card's wording for her (the visa: the night's line and perks) or him (a pass to witness the
// night: no free drinks, the dress code still applies).
export function cardFor(inv, style) {
  if (style === 'him') return { ...inv, style: 'him', tagline: `A pass to witness ${inv.title}`, perk: '' };
  return { ...inv, style: 'her' };
}
const styleOf = s => (s === 'him' ? 'him' : 'her');

// ── Staff ──
// The nights coming up, each with its invitation wording and how many requests are waiting.
export async function inviteNights(env, user) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  const events = (await listDocs(env, 'events')).filter(e => e.fields.active !== false && !isOver(e.fields)).sort((a, b) => String(a.fields.date).localeCompare(String(b.fields.date)));
  const out = [];
  for (const e of events) {
    const pending = (await queryWhere(env, 'invite_requests', [{ field: 'eventId', value: e.id }])).filter(r => r.fields.status === 'pending').length;
    out.push({ id: e.id, name: e.fields.name || '', date: e.fields.date, doors: e.fields.doors || '', venue: venueOf(e), invitation: invitationOf(e), pending, applyUrl: siteUrl(env, `/invite.html?event=${encodeURIComponent(e.id)}`) });
  }
  return { nights: out };
}
// { eventId, open, title, tagline, perk, dress, passes }
export async function saveInvitation(env, b, user) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  const n = await inviteNight(env, b?.eventId); if (n.error) return n;
  const passes = Number(b.passes ?? 1);
  if (!Number.isInteger(passes) || passes < 1 || passes > MAX_PASSES) return { error: `Passes: 1 to ${MAX_PASSES}.` };
  const invitation = { open: b.open === true, title: clean(b.title, 40), tagline: clean(b.tagline, 60), perk: b.perk === undefined ? 'Free drinks till 12AM' : clean(b.perk, 60), dress: b.dress === undefined ? 'Strict dress code' : clean(b.dress, 60), passes };
  await setDoc(env, 'events', n.ev.id, { ...n.ev.fields, invitation });
  await audit(env, user, 'INVITATION_SAVED', { eventId: n.ev.id, open: invitation.open });
  return { saved: true, invitation: invitationOf({ fields: { ...n.ev.fields, invitation } }) };
}
// Send: { eventId, rows: [{ phone, passes? }] (at most INVITE_BATCH a call), passes, ifInvited: 'skip'|'add',
//   style: 'her' (the ladies' visa) | 'him' (the gentlemen's pass) }
export async function sendInvites(env, b, user) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  if (styleOf(b.style) === 'him' && !requireRole(user, ['superAdmin', 'director'])) return { error: 'Only directors can send gentlemen\'s passes.', status: 403 };
  const n = await inviteNight(env, b?.eventId); if (n.error) return n;
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!rows.length) return { error: 'Add at least one phone number.' };
  if (rows.length > INVITE_BATCH) return { error: `At most ${INVITE_BATCH} at a time.` };
  const inv = invitationOf(n.ev), def = b.passes === undefined ? inv.passes : Number(b.passes);
  if (!Number.isInteger(def) || def < 1 || def > MAX_PASSES) return { error: `Passes: 1 to ${MAX_PASSES}.` };
  const existing = await invitesOf(env, n.ev.id), out = [];
  for (const raw of rows) {
    const phone = normalizePhone(raw?.phone), passes = raw?.passes === undefined || raw?.passes === '' || raw?.passes === null ? def : Number(raw.passes);
    const name = clean(raw?.name, 60);
    if (!phone) { out.push({ phone: String(raw?.phone || '').slice(0, 20), status: 'invalid', message: 'Not a Ghana phone number' }); continue; }
    if (!Number.isInteger(passes) || passes < 1 || passes > MAX_PASSES) { out.push({ phone, status: 'invalid', message: `Passes: 1 to ${MAX_PASSES}` }); continue; }
    if (out.some(o => o.phone === phone && o.status !== 'invalid')) { out.push({ phone, status: 'duplicate', message: 'Twice in this list' }); continue; }
    const r = await issueOne(env, n.ev, inv, phone, passes, { ifInvited: b.ifInvited, existing, user, style: styleOf(b.style), name });
    if (['sent', 'not_texted'].includes(r.status)) {
      // Someone who had asked online and is now sent one: their request is done.
      const req = await getDoc(env, 'invite_requests', `${n.ev.id}_${phone}`);
      if (req?.fields?.status === 'pending') await setDoc(env, 'invite_requests', req.id, { ...req.fields, status: 'approved', decidedAt: now(), decidedByName: user.name || '', ticketId: r.token });
    }
    const { token, ...row } = r; out.push(row);
  }
  for (const o of out) {
    if (['sent', 'not_texted', 'added', 'added_not_texted'].includes(o.status)) {
      const row = rows.find(r => normalizePhone(r?.phone) === o.phone);
      const cname = clean(row?.name, 60);
      if (cname) await setDoc(env, 'guest_contacts', o.phone, { phone: o.phone, name: cname, lastInvitedAt: now() });
    }
  }
  await audit(env, user, 'INVITES_SENT', { eventId: n.ev.id, sent: out.filter(o => ['sent', 'not_texted'].includes(o.status)).length, added: out.filter(o => o.status.startsWith('added')).length });
  return { results: out };
}

// All unique phone numbers that have ever been invited (auto-populated when invites are sent).
export async function guestContacts(env, user) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  const all = await listDocs(env, 'guest_contacts');
  const contacts = all.map(c => ({ phone: c.fields.phone || c.id, name: c.fields.name || '' }))
    .sort((a, b) => (a.name || a.phone).localeCompare(b.name || b.phone));
  return { contacts, total: contacts.length };
}
// The night's invitations sent and the requests from the website.
export async function invitesFor(env, user, eventId) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  const n = await getDoc(env, 'events', String(eventId || ''));
  if (!n) return { error: 'Night not found.', status: 404 };
  const sent = (await queryWhere(env, 'tickets', [{ field: 'eventId', value: n.id }])).filter(t => t.fields.invite)
    .map(t => ({ phone: t.fields.phone || '', name: t.fields.customerName !== 'Guest' ? (t.fields.customerName || '') : '', style: styleOf(t.fields.invite?.style), passes: Number(t.fields.admitCount || 1), code: t.fields.displayCode, status: t.fields.revoked || t.fields.cancelled ? 'cancelled' : t.fields.status, checkedInAt: t.fields.checkedInAt || null, issuedAt: t.fields.issuedAt || '' }))
    .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
  const requests = (await queryWhere(env, 'invite_requests', [{ field: 'eventId', value: n.id }]))
    .map(r => ({ id: r.id, phone: r.fields.phone, name: r.fields.name || '', style: styleOf(r.fields.style), instagram: r.fields.instagram || '', answers: r.fields.answers || [], status: r.fields.status, createdAt: r.fields.createdAt, decidedByName: r.fields.decidedByName || '' }))
    .sort((a, b) => (a.status === 'pending') - (b.status === 'pending') || String(a.createdAt).localeCompare(String(b.createdAt))).reverse();
  return { sent, requests, totals: { invitations: sent.length, passes: sent.reduce((k, x) => k + x.passes, 0), in: sent.filter(x => x.status === 'used').reduce((k, x) => k + x.passes, 0), pending: requests.filter(r => r.status === 'pending').length } };
}
// Send a reminder text to all valid invitees who haven't checked in yet. { eventId, message? }
function reminderSms(ev, inv, style, passes, link) {
  const him = style === 'him';
  const when = `${night(ev)} at Memories Night Club, ${venueOf(ev)}`;
  const perks = [him ? '' : inv.perk, inv.dress, passes > 1 ? `Admits ${passes}` : ''].filter(Boolean).join('. ');
  return [`MEMORIES: Reminder — ${him ? `Your pass to witness ${inv.title}` : `Your invitation to ${inv.title}`}, ${when}.`, perks ? `${perks}.` : '', `At the door, give this number. Your ${him ? 'pass' : 'card'}: ${link}`].filter(Boolean).join(' ');
}
export async function remindInvites(env, b, user) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  const n = await inviteNight(env, b?.eventId); if (n.error) return n;
  const inv = invitationOf(n.ev);
  const all = await invitesOf(env, n.ev.id);
  const eligible = all.filter(t => t.fields.status !== 'used');
  const customMsg = b?.message ? clean(String(b.message), 320) : null;
  let sent = 0, failed = 0;
  for (const t of eligible) {
    const phone = t.fields.phone, passes = Number(t.fields.admitCount || 1);
    const style = styleOf(t.fields.invite?.style), link = siteUrl(env, `/ticket.html?token=${t.id}`);
    const msg = customMsg || reminderSms(n.ev, inv, style, passes, link);
    const ok = await sendSms(env, phone, msg);
    ok ? sent++ : failed++;
  }
  await audit(env, user, 'INVITES_REMINDED', { eventId: n.ev.id, sent, failed });
  return { sent, failed, total: eligible.length };
}

// Approve (the invitation is texted) or decline website requests. { eventId, ids: [], decision, passes? }
export async function decideRequests(env, b, user) {
  if (!requireRole(user, INVITERS)) return FORBIDDEN;
  const n = await inviteNight(env, b?.eventId); if (n.error) return n;
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, INVITE_BATCH);
  if (!ids.length) return { error: 'Pick at least one request.' };
  if (!['approve', 'decline'].includes(b.decision)) return { error: 'Approve or decline?' };
  const inv = invitationOf(n.ev), passes = b.passes === undefined ? inv.passes : Number(b.passes);
  if (!Number.isInteger(passes) || passes < 1 || passes > MAX_PASSES) return { error: `Passes: 1 to ${MAX_PASSES}.` };
  const existing = await invitesOf(env, n.ev.id), out = [];
  for (const rid of ids) {
    const r = await getDoc(env, 'invite_requests', rid);
    if (!r || r.fields.eventId !== n.ev.id) { out.push({ id: rid, status: 'invalid', message: 'Request not found' }); continue; }
    if (r.fields.status !== 'pending') { out.push({ id: rid, phone: r.fields.phone, status: 'invalid', message: `Already ${r.fields.status}` }); continue; }
    if (b.decision === 'decline') {
      await setDoc(env, 'invite_requests', rid, { ...r.fields, status: 'declined', decidedAt: now(), decidedByName: user.name || '' });
      out.push({ id: rid, phone: r.fields.phone, status: 'declined' }); continue;
    }
    const s = await issueOne(env, n.ev, inv, r.fields.phone, passes, { existing, user, approved: true, style: styleOf(r.fields.style), name: r.fields.name || '' });
    await setDoc(env, 'invite_requests', rid, { ...r.fields, status: 'approved', decidedAt: now(), decidedByName: user.name || '', ...(s.token ? { ticketId: s.token } : {}) });
    if (['sent', 'not_texted'].includes(s.status) && r.fields.name) await setDoc(env, 'guest_contacts', r.fields.phone, { phone: r.fields.phone, name: clean(r.fields.name, 60), lastInvitedAt: now() });
    const { token, ...row } = s; out.push({ id: rid, ...row });
  }
  await audit(env, user, b.decision === 'approve' ? 'INVITE_REQUESTS_APPROVED' : 'INVITE_REQUESTS_DECLINED', { eventId: n.ev.id, count: out.filter(o => o.status !== 'invalid').length });
  return { results: out };
}

// ── The website: a guest asks for an invitation ──
// { eventId, phone, instagram?, answers: [{ q, a }] x3 }. The same answer for any phone, so the page
// never tells anyone whether a number is already on the list.
export async function requestInvite(env, b) {
  const ev = b?.eventId ? await getDoc(env, 'events', String(b.eventId)) : null;
  if (!ev || ev.fields.active === false || ev.fields.visibility !== 'public' || isOver(ev.fields) || !invitationOf(ev).open) return { error: 'Requests for this night are closed.' };
  const phone = normalizePhone(b.phone);
  if (!phone) return { error: 'Use a Ghana number, e.g. 024 123 4567.' };
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 3).map(x => ({ q: clean(x?.q, 120), a: clean(x?.a, 160) }));
  if (answers.length < 3 || answers.some(x => !x.q || x.a.length < 2)) return { error: 'Answer all three, even in a few words.' };
  const instagram = clean(String(b.instagram || '').replace(/^@+/, ''), 40).replace(/[^A-Za-z0-9._]/g, '');
  const name = clean(b.name, 60);
  const rid = `${ev.id}_${phone}`, had = await getDoc(env, 'invite_requests', rid);
  // Ladies only ask on the website; the gentlemen's passes are sent by staff.
  if (!had) await setDoc(env, 'invite_requests', rid, { eventId: ev.id, phone, ...(name ? { name } : {}), style: 'her', instagram, answers, status: 'pending', createdAt: now() });
  return { received: true, phoneHint: maskPhone(phone) };
}
