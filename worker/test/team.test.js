// Every staff member's page: notices from management, the team message board, feedback and
// complaints (to the Human manager or straight to the directors; anonymous if they like).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  const people = { dj: ['Kofi DJ', 'dj'], b1: ['Ama Bartender', 'barStaff'], w1: ['Efua Waiter', 'waitStaff'], hr: ['Abena HR', 'hrManager'], d1: ['Nana Director', 'director'], org: ['Org', 'organiser'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400001${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.97.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call, DJ: as('dj'), B1: as('b1'), W1: as('w1'), HR: as('hr'), D1: as('d1'), ORG: as('org') };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };

test('notices: managers post to everyone or a team; each person sees theirs', async () => {
  const ctx = setup();
  assert.equal((await ctx.call('POST', '/api/ops/notices', { who: ctx.B1, body: { title: 'x' } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/notices', { who: ctx.HR, body: { title: 'Staff meeting Friday 6pm', body: 'Everyone.', team: 'all' } }), 'all');
  ok(await ctx.call('POST', '/api/ops/notices', { who: ctx.HR, body: { title: 'Bar: count at 9pm', team: 'bar' } }), 'bar');
  assert.deepEqual(ok(await ctx.call('GET', '/api/ops/notices', { who: ctx.B1 }), 'bar sees').notices.map(n => n.title).sort(), ['Bar: count at 9pm', 'Staff meeting Friday 6pm']);
  assert.deepEqual(ok(await ctx.call('GET', '/api/ops/notices', { who: ctx.DJ }), 'dj sees').notices.map(n => n.title), ['Staff meeting Friday 6pm']);
  assert.equal((await ctx.call('GET', '/api/ops/notices', { who: ctx.ORG })).status, 403, 'outside organisers aren’t staff');
});

test('message board: to everyone or your own team; the author or a manager takes it down', async () => {
  const ctx = setup();
  const m = ok(await ctx.call('POST', '/api/ops/board', { who: ctx.DJ, body: { text: 'Who has the aux cable?', team: 'entertainment' } }), 'dj team');
  assert.equal((await ctx.call('POST', '/api/ops/board', { who: ctx.DJ, body: { text: 'x', team: 'bar' } })).status, 403, 'not another team');
  ok(await ctx.call('POST', '/api/ops/board', { who: ctx.B1, body: { text: 'Ice is finished', team: 'all' } }), 'bar to all');
  assert.equal(ok(await ctx.call('GET', '/api/ops/board', { who: ctx.W1 }), 'waiter').messages.length, 1, 'the waiter sees the message to all, not the DJs’');
  assert.equal(ok(await ctx.call('GET', '/api/ops/board', { who: ctx.HR }), 'hr').messages.length, 2, 'managers see every team');
  assert.equal((await ctx.call('POST', '/api/ops/board/remove', { who: ctx.W1, body: { id: m.id } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/board/remove', { who: ctx.HR, body: { id: m.id } }), 'hr removes');
});

test('feedback and complaints: to the Human manager or the directors; anonymous hides the name; answers come back', async () => {
  const ctx = setup();
  ok(await ctx.call('POST', '/api/ops/feedback', { who: ctx.W1, body: { kind: 'complaint', text: 'Shift ended at 5am, no transport.', to: 'hr' } }), 'to hr');
  const anon = ok(await ctx.call('POST', '/api/ops/feedback', { who: ctx.B1, body: { kind: 'complaint', text: 'About the Human manager…', to: 'director', anonymous: true } }), 'to directors');
  const hr = ok(await ctx.call('GET', '/api/ops/feedback', { who: ctx.HR }), 'hr inbox');
  assert.deepEqual(hr.feedback.map(f => f.fromName), ['Efua Waiter'], 'the Human manager doesn’t see what went to the directors');
  const dir = ok(await ctx.call('GET', '/api/ops/feedback', { who: ctx.D1 }), 'director inbox');
  assert.equal(dir.feedback.length, 2);
  assert.equal(dir.feedback.find(f => f.id === anon.id).fromName, 'Anonymous');
  assert.equal((await ctx.call('POST', '/api/ops/feedback/reply', { who: ctx.HR, body: { id: anon.id, reply: 'x' } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/feedback/reply', { who: ctx.D1, body: { id: anon.id, reply: 'Thank you. We’ll look into it.' } }), 'director answers');
  const mine = ok(await ctx.call('GET', '/api/ops/feedback/mine', { who: ctx.B1 }), 'mine');
  assert.deepEqual([mine.feedback[0].status, mine.feedback[0].reply], ['answered', 'Thank you. We’ll look into it.']);
  assert.equal((await ctx.call('GET', '/api/ops/feedback', { who: ctx.W1 })).status, 403);
});
