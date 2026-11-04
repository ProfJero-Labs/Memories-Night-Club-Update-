// The autopilot (src/ops/autopilot.js): what happens without anyone remembering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { walletAlerts, autoClose, morningAndMidday } from '../src/ops/autopilot.js';
import { loadNight } from '../src/ops/common.js';

const MIN = 60e3;
const day = ms => new Date(Date.now() + ms).toISOString().slice(0, 10);
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  const people = { m1: ['Akos Manager', 'manager', '0240000001'], h1: ['Abena HR', 'hrManager', '0240000002'], d1: ['Nana Director', 'director', '0240000003'], f1: ['Esi Finance', 'finance', '0240000004'], w1: ['Efua', 'waitStaff', '0240000005'] };
  for (const [uid, [name, role, phone]] of Object.entries(people)) store.seed('users', uid, { name, role, phone });
  const to = phone => store.sms.filter(x => x.to === phone).map(x => x.message);
  // Directors aren't texted: their alerts wait in the app.
  const app = () => store.list('app_alerts').sort((a, b) => a.id.localeCompare(b.id)).map(x => x.fields.text);
  return { store, env, to, app };
}

test('MoMo waiting: 20 minutes → the Manager and the Human manager; an hour → the directors (in the app); never twice', async () => {
  const { store, env, to, app } = setup();
  store.seed('wallet_payments', 'w1', { status: 'waiting', tabNumber: 4, table: '9', duePesewas: 310000, code: 'K7QX', createdAt: new Date(Date.now() - 25 * MIN).toISOString() });
  assert.equal(await walletAlerts(env), 1);
  assert.equal(to('0240000001').length, 1); assert.equal(to('0240000002').length, 1); assert.match(to('0240000001')[0], /Tab 4 \(table 9\)[\s\S]*20 minutes/);
  assert.equal(app().length, 0, 'not the directors yet');
  assert.equal(await walletAlerts(env), 0, 'not twice');
  assert.equal(await walletAlerts(env, Date.now() + 40 * MIN), 1);
  assert.match(app()[0], /over an hour/);
  assert.equal(to('0240000003').length, 0, 'directors get no texts');
  assert.equal(to('0240000005').length, 0, 'waiters aren’t texted');
});

test('a forgotten night closes itself (past 5AM, 3 quiet hours); the 10AM report goes to finance and the directors; midday: not signed off → the directors', async () => {
  const { store, env, to, app } = setup();
  const d = day(-2 * 864e5);
  store.seed('config', 'night', { date: d, startedAt: new Date(Date.now() - 50 * 3600e3).toISOString() });
  store.seed('tabs', 't1', { number: 1, businessDate: d, table: '3', waiterUid: 'w1', waiterName: 'Efua', status: 'open', createdAt: new Date(Date.now() - 40 * 3600e3).toISOString(), payments: [], discounts: [] });
  await loadNight(env, { fresh: true });
  const c = await autoClose(env);
  assert.deepEqual(c, { closed: d });
  assert.equal(store.get('shifts', d).fields.status, 'closed');
  assert.match(app().at(-1), /closed automatically/);
  assert.equal(await autoClose(env), null, 'once');
  // 10AM the next day: the report.
  const ten = new Date(`${day(0)}T10:05:00Z`).getTime();
  await morningAndMidday(env, ten);
  assert.match(to('0240000004').at(-1), new RegExp(`night of ${d}[\\s\\S]*Sales GHS 0[\\s\\S]*Details:`));
  assert.match(app().at(-1), /night of/);
  assert.equal(to('0240000001').filter(m => /night of/.test(m)).length, 0, 'not the Manager');
  const n = store.sms.length; await morningAndMidday(env, ten + 5 * MIN); assert.equal(store.sms.length, n, 'once a day');
  // Midday: finance hasn't signed it off.
  await morningAndMidday(env, new Date(`${day(0)}T12:05:00Z`).getTime());
  assert.match(app().at(-1), /hasn’t signed off/);
  assert.equal(to('0240000003').length, 0, 'directors get no texts');
});

test('a night with sales in the last 3 hours, or before 5AM, stays open', async () => {
  const { store, env } = setup();
  const d = day(-864e5);
  store.seed('config', 'night', { date: d, startedAt: new Date().toISOString() });
  store.seed('tabs', 't1', { number: 1, businessDate: d, status: 'open', createdAt: new Date(Date.now() - 30 * MIN).toISOString(), payments: [], discounts: [] });
  await loadNight(env, { fresh: true });
  assert.equal(await autoClose(env), null, 'a sale 30 minutes ago: still going');
});
