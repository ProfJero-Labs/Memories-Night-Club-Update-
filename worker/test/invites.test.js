// Invitations (e.g. Ladies Night): free entry sent by text as a red VIP card. Staff send them by
// phone number, or guests ask on the website (three questions) and staff approve. One invitation
// admits its passes together, once; the door finds it by the phone number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const Q = [{ q: 'Your signature drink for the night?', a: 'Rosé, always' }, { q: 'Heels, sneakers or barefoot by 2AM?', a: 'Barefoot' }, { q: 'Your colour for the night?', a: 'Red' }];
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('events', 'ladies', { name: 'Ladies Night', date: new Date(Date.now() + 2 * 864e5).toISOString(), venue: 'Memories Night Club', active: true, visibility: 'public' });
  const people = { admin: ['Owner', 'superAdmin'], dir: ['Kojo Director', 'director'], hr: ['Abena HR', 'hrManager'], em: ['Esi Events', 'eventManager'], mgr: ['Akos Manager', 'manager'], door: ['Kofi Door', 'doorStaff'], w1: ['Efua Waiter', 'waitStaff'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400008${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.97.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const send = (rows, extra = {}, who = 'admin') => call('POST', '/api/admin/invites', { who, body: { eventId: 'ladies', rows, ...extra } });
  const open = (who = 'admin', extra = {}) => call('POST', '/api/admin/invites/settings', { who, body: { eventId: 'ladies', open: true, title: 'Ladies Night', tagline: 'Her night. Her rules.', perk: 'Free drinks till 12AM', passes: 1, ...extra } });
  return { store, call, send, open };
}

test('sending by phone number: a free card per number, texted as a link; names aren’t needed', async () => {
  const { store, call, send } = setup();
  const r = ok(await send([{ phone: '024 123 4567' }, { phone: '+233 20 111 2222', passes: 3 }, { phone: '12345' }, { phone: '0241234567' }]), 'send');
  assert.deepEqual(r.results.map(x => x.status), ['sent', 'sent', 'invalid', 'duplicate']);
  const t = store.list('tickets').map(x => x.fields);
  const one = t.find(x => x.phone === '0241234567'), three = t.find(x => x.phone === '0201112222');
  assert.deepEqual([one.type, one.comp, one.admitCount, one.invite.perk, one.status], ['Invitation', true, 1, 'Free drinks till 12AM', 'valid'], 'default wording: free drinks till 12AM');
  assert.equal(three.admitCount, 3);
  const sms = store.sms.find(s => s.to === '0241234567').message;
  assert.match(sms, /You're invited: Ladies Night\./);
  assert.match(sms, /Free drinks till 12AM/);
  assert.match(sms, /Memories Night Club/);
  assert.match(sms, /Strict dress code/);
  assert.match(sms, /At the door: give this phone number/);
  assert.match(sms, /ticket\.html\?token=/);
  const token = store.list('tickets').find(x => x.fields.phone === '0241234567').id;
  const page = ok(await call('GET', `/api/tickets/${token}`), 'ticket').ticket;
  assert.deepEqual([page.invite.title, page.invite.perk, page.invite.dress, page.phoneLast4, page.admits], ['Ladies Night', 'Free drinks till 12AM', 'Strict dress code', '4567', 1]);
  assert.equal(page.fullName, undefined, 'no name on the card');
});

test('the door finds a card by the whole phone number and lets it in once, all passes together', async () => {
  const { store, call, send } = setup();
  ok(await send([{ phone: '0551234567', passes: 2 }]), 'send');
  const hits = ok(await call('GET', '/api/door/search?eventId=ladies&q=055%20123%204567', { who: 'door' }), 'search').results;
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].invite, hits[0].admits, hits[0].perk, hits[0].status], [true, 2, 'Free drinks till 12AM · Strict dress code', 'valid']);
  const first = ok(await call('POST', '/api/checkin', { who: 'door', body: { eventId: 'ladies', code: hits[0].code } }), 'admit');
  assert.deepEqual([first.valid, first.ticket.admits, first.ticket.perk], [true, 2, 'Free drinks till 12AM · Strict dress code']);
  const again = ok(await call('POST', '/api/checkin', { who: 'door', body: { eventId: 'ladies', code: hits[0].code } }), 'again');
  assert.deepEqual([again.valid, again.code], [false, 'used'], 'the number can’t be used again');
  assert.equal(store.list('checkins').length, 1);
});

test('someone already invited: left alone, or passes added while unused', async () => {
  const { store, call, send } = setup();
  ok(await send([{ phone: '0241234567' }]), 'first');
  assert.equal(ok(await send([{ phone: '0241234567' }]), 'again').results[0].status, 'already');
  const add = ok(await send([{ phone: '0241234567', passes: 2 }], { ifInvited: 'add' }), 'add').results[0];
  assert.deepEqual([add.status, add.passes, store.list('tickets').length], ['added', 3, 1]);
  assert.match(store.sms.at(-1).message, /you now have 3/);
  const t = store.list('tickets')[0].fields;
  ok(await call('POST', '/api/checkin', { who: 'door', body: { eventId: 'ladies', code: t.displayCode } }), 'admit');
  assert.equal(ok(await send([{ phone: '0241234567' }], { ifInvited: 'add' }), 'late').results[0].status, 'invalid');
});

test('guests ask on the website (three answers); staff approve, and the card is texted', async () => {
  const { store, call, open } = setup();
  // Closed until staff open requests for the night.
  assert.match((await call('POST', '/api/invite-request', { body: { eventId: 'ladies', phone: '0241234567', answers: Q } })).data.error, /closed/);
  ok(await open('dir'), 'open (a director)');
  const night = ok(await call('GET', '/api/events/ladies'), 'event');
  assert.deepEqual(night.invitation, { title: 'Ladies Night', tagline: 'Her night. Her rules.', perk: 'Free drinks till 12AM', dress: 'Strict dress code' });
  assert.match((await call('POST', '/api/invite-request', { body: { eventId: 'ladies', phone: '0241234567', answers: Q.slice(0, 2) } })).data.error, /all three/);
  const asked = ok(await call('POST', '/api/invite-request', { body: { eventId: 'ladies', phone: '024 123 4567', instagram: '@ama.gh', answers: Q } }), 'ask');
  assert.equal(asked.received, true);
  ok(await call('POST', '/api/invite-request', { body: { eventId: 'ladies', phone: '0201112222', answers: Q } }), 'ask 2');
  assert.equal(store.list('tickets').length, 0, 'nothing issued until approved');
  assert.equal(store.sms.length, 0, 'no text yet');
  const list = ok(await call('GET', '/api/admin/invites?eventId=ladies', { who: 'hr' }), 'list (human manager)');
  assert.equal(list.totals.pending, 2);
  const ama = list.requests.find(r => r.phone === '0241234567');
  assert.deepEqual([ama.instagram, ama.answers.length, ama.answers[0].a], ['ama.gh', 3, 'Rosé, always']);
  const other = list.requests.find(r => r.phone === '0201112222');
  const yes = ok(await call('POST', '/api/admin/invites/decide', { who: 'em', body: { eventId: 'ladies', ids: [ama.id], decision: 'approve' } }), 'approve (event manager)');
  assert.equal(yes.results[0].status, 'sent');
  assert.match(store.sms.find(s => s.to === '0241234567').message, /Your request was accepted/);
  ok(await call('POST', '/api/admin/invites/decide', { who: 'mgr', body: { eventId: 'ladies', ids: [other.id], decision: 'decline' } }), 'decline (manager)');
  assert.equal(store.sms.filter(s => s.to === '0201112222').length, 0, 'a decline isn’t texted');
  const after = ok(await call('GET', '/api/admin/invites?eventId=ladies', { who: 'admin' }), 'after');
  assert.deepEqual([after.totals.pending, after.totals.invitations, after.requests.find(r => r.id === ama.id).status], [0, 1, 'approved']);
  // Deciding twice does nothing.
  assert.equal(ok(await call('POST', '/api/admin/invites/decide', { who: 'admin', body: { eventId: 'ladies', ids: [ama.id], decision: 'approve' } }), 'twice').results[0].status, 'invalid');
  assert.equal(store.list('tickets').length, 1);
  // The nights list shows what's waiting and the page link.
  const nights = ok(await call('GET', '/api/admin/invites/nights', { who: 'dir' }), 'nights').nights;
  assert.match(nights[0].applyUrl, /invite\.html\?event=ladies/);
});

test('who may: directors, managers, the human manager, the event manager; not the door or waiters. Limits.', async () => {
  const { call, send } = setup();
  for (const who of ['dir', 'mgr', 'hr', 'em']) assert.equal((await send([{ phone: `024000000${['dir', 'mgr', 'hr', 'em'].indexOf(who)}` }], {}, who)).status, 200, who);
  for (const who of ['w1', 'door']) assert.equal((await send([{ phone: '0241234567' }], {}, who)).status, 403, who);
  const big = await send(Array.from({ length: 21 }, (_, i) => ({ phone: `02400${String(i).padStart(5, '0')}` })));
  assert.match(String(big.data.error), /At most 20/);
  assert.match(String((await send([{ phone: '0241234567' }], { passes: 0 })).data.error), /Passes/);
  assert.equal(ok(await send([{ phone: '0241119999', passes: 25 }]), 'too many').results[0].status, 'invalid');
});
