// The team: notices from management, the message board, and staff feedback and complaints.
// Every staff member has these on "My page" (me.html), whatever their job.
//
//   notices/{id}   title, body, team ('all' or a team key), byName, byRole, at, removed
//                  posted by the managers and the directors (and the admin)
//   board/{id}     text, team ('all' or a team key), by, byName, byRole, at, removed
//                  anyone posts to everyone or to their own team; managers to any team. The author
//                  or a manager takes a message down.
//   feedback/{id}  kind feedback|complaint, text, to hr|director, anonymous, by, byName, at, status
//                  open|answered, reply, replyByName, repliedAt
//                  To the Human manager, or straight to the directors (e.g. about the Human manager).
//                  Anonymous: the reader never sees who sent it (it's still kept, so the sender sees
//                  their own and any reply).
import { setDoc, getDoc, queryWhere, queryRecent } from '../lib/firestore.js';
import { now, id, clean } from '../lib/util.js';
import { requireRole, uidOf, STAFF_ROLES, MANAGERS } from '../lib/auth.js';
import { TEAMS, teamOf, ROLE_NAMES } from '../staffauth.js';
import { FORBIDDEN, audit } from './common.js';

const POSTERS = ['superAdmin', 'director', ...MANAGERS];
const anyStaff = user => !!user && (user.admin === true || (STAFF_ROLES.includes(user.role) && user.role !== 'organiser'));
const DAY = 864e5;
const forMe = (user, team) => team === 'all' || team === teamOf(user.role) || requireRole(user, POSTERS);
const teamLabel = t => (t === 'all' ? 'Everyone' : TEAMS[t] || t);

// ── Notices ──
export async function listNotices(env, user) {
  if (!anyStaff(user)) return FORBIDDEN;
  const rows = (await queryRecent(env, 'notices', 'at', new Date(Date.now() - 60 * DAY), 200)).map(d => ({ id: d.id, ...d.fields })).filter(n => !n.removed && forMe(user, n.team));
  return { notices: rows.map(n => ({ id: n.id, title: n.title, body: n.body, team: n.team, teamLabel: teamLabel(n.team), byName: n.byName, byRole: ROLE_NAMES[n.byRole] || '', at: n.at })), canPost: !!requireRole(user, POSTERS), teams: TEAMS, myTeam: teamOf(user.role) };
}
export async function postNotice(env, b, user) {
  if (!requireRole(user, POSTERS)) return { error: 'Managers and directors post notices.', status: 403 };
  const title = clean(b?.title, 80), body = clean(b?.body, 1000), team = b?.team === 'all' || TEAMS[b?.team] ? b.team : 'all';
  if (!title) return { error: 'Give the notice a title, e.g. “Staff meeting Friday 6pm”.' };
  const nid = id();
  await setDoc(env, 'notices', nid, { title, body, team, by: uidOf(user), byName: user.name || '', byRole: user.role, at: now(), removed: false });
  await audit(env, user, 'NOTICE_POSTED', { noticeId: nid, team });
  return { id: nid };
}
export async function removeNotice(env, b, user) {
  if (!requireRole(user, POSTERS)) return FORBIDDEN;
  const n = await getDoc(env, 'notices', String(b?.id || '')); if (!n) return { error: 'Notice not found.', status: 404 };
  await setDoc(env, 'notices', n.id, { ...n.fields, removed: true, removedByName: user.name || '', removedAt: now() });
  return { removed: true };
}

// ── The message board ──
export async function listBoard(env, user) {
  if (!anyStaff(user)) return FORBIDDEN;
  const boss = requireRole(user, POSTERS);
  const rows = (await queryRecent(env, 'board', 'at', new Date(Date.now() - 30 * DAY), 300)).map(d => ({ id: d.id, ...d.fields })).filter(m => !m.removed && forMe(user, m.team));
  return { messages: rows.slice(0, 150).map(m => ({ id: m.id, text: m.text, team: m.team, teamLabel: teamLabel(m.team), byName: m.byName, byRole: ROLE_NAMES[m.byRole] || '', at: m.at, mine: m.by === uidOf(user), canRemove: m.by === uidOf(user) || boss })),
    myTeam: teamOf(user.role), myTeamLabel: TEAMS[teamOf(user.role)] || '', teams: boss ? TEAMS : null };
}
export async function postBoard(env, b, user) {
  if (!anyStaff(user)) return FORBIDDEN;
  const text = clean(b?.text, 500); if (!text) return { error: 'Write your message.' };
  const team = b?.team === 'all' || !b?.team ? 'all' : String(b.team);
  if (team !== 'all' && !TEAMS[team]) return { error: 'Pick who it’s for.' };
  if (team !== 'all' && team !== teamOf(user.role) && !requireRole(user, POSTERS)) return { error: 'You can post to everyone or to your own team.', status: 403 };
  const mid = id();
  await setDoc(env, 'board', mid, { text, team, by: uidOf(user), byName: user.name || '', byRole: user.role, at: now(), removed: false });
  return { id: mid };
}
export async function removeBoard(env, b, user) {
  if (!anyStaff(user)) return FORBIDDEN;
  const m = await getDoc(env, 'board', String(b?.id || '')); if (!m) return { error: 'Message not found.', status: 404 };
  if (m.fields.by !== uidOf(user) && !requireRole(user, POSTERS)) return FORBIDDEN;
  await setDoc(env, 'board', m.id, { ...m.fields, removed: true, removedByName: user.name || '', removedAt: now() });
  return { removed: true };
}

// ── Feedback and complaints ──
const FEEDBACK_KINDS = { feedback: 'Feedback or idea', complaint: 'Complaint' };
const feedbackView = (f, reader) => ({ id: f.id, kind: f.kind, kindLabel: FEEDBACK_KINDS[f.kind], text: f.text, to: f.to, toLabel: f.to === 'director' ? 'The directors' : 'The Human manager',
  fromName: reader && f.anonymous ? 'Anonymous' : f.byName, fromRole: reader && f.anonymous ? '' : ROLE_NAMES[f.byRole] || '', anonymous: !!f.anonymous, at: f.at, status: f.status, reply: f.reply || '', replyByName: f.replyByName || '', repliedAt: f.repliedAt || '' });
export async function sendFeedback(env, b, user) {
  if (!anyStaff(user)) return FORBIDDEN;
  const text = clean(b?.text, 1500); if (!text) return { error: 'Write what you want to say.' };
  const kind = FEEDBACK_KINDS[b?.kind] ? b.kind : 'feedback', to = b?.to === 'director' ? 'director' : 'hr';
  const fid = id();
  await setDoc(env, 'feedback', fid, { kind, text, to, anonymous: b?.anonymous === true, by: uidOf(user), byName: user.name || '', byRole: user.role, at: now(), status: 'open' });
  return { id: fid, to };
}
export async function myFeedback(env, user) {
  if (!anyStaff(user)) return FORBIDDEN;
  return { feedback: (await queryWhere(env, 'feedback', [{ field: 'by', value: uidOf(user) }])).map(d => feedbackView({ id: d.id, ...d.fields }, false)).sort((a, b) => String(b.at).localeCompare(String(a.at))) };
}
// The inbox: the Human manager reads what was sent to them; the directors read everything.
export async function feedbackInbox(env, user) {
  const director = requireRole(user, ['superAdmin', 'director']);
  if (!director && !requireRole(user, ['hrManager'])) return FORBIDDEN;
  const rows = (await queryRecent(env, 'feedback', 'at', new Date(Date.now() - 180 * DAY), 500)).map(d => ({ id: d.id, ...d.fields })).filter(f => director || f.to === 'hr');
  return { feedback: rows.map(f => feedbackView(f, true)), open: rows.filter(f => f.status === 'open').length };
}
export async function replyFeedback(env, b, user) {
  const f = await getDoc(env, 'feedback', String(b?.id || '')); if (!f) return { error: 'Not found.', status: 404 };
  const director = requireRole(user, ['superAdmin', 'director']);
  if (!director && !(requireRole(user, ['hrManager']) && f.fields.to === 'hr')) return FORBIDDEN;
  const reply = clean(b?.reply, 1000); if (!reply) return { error: 'Write your answer.' };
  await setDoc(env, 'feedback', f.id, { ...f.fields, status: 'answered', reply, replyBy: uidOf(user), replyByName: user.name || '', repliedAt: now() });
  await audit(env, user, 'FEEDBACK_ANSWERED', { feedbackId: f.id });
  return { answered: true };
}
