// Workstream C (server): a night is required, the headcount comes from the server, search never
// returns a token, and many simultaneous scans admit exactly once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker, { checkin } from '../src/index.js';

const T = n => String(n).padStart(2, '0').repeat(32);
function seed(store) {
  store.seed('events', 'fri', { name: 'Friday', date: '2099-01-01T22:00:00Z', active: true, visibility: 'public', organiserId: 'org-A' });
  store.seed('events', 'sat', { name: 'Saturday', date: '2099-01-02T22:00:00Z', active: true, visibility: 'public', organiserId: 'org-B' });
  store.seed('tickets', T(1), { customerName: 'Ama Owusu', phoneLast4: '4567', eventId: 'fri', type: 'Regular', admitCount: 1, displayCode: 'MEM-010101', status: 'valid' });
  store.seed('tickets', T(2), { customerName: 'Kofi Mensah', phoneLast4: '1111', eventId: 'fri', type: 'Group', admitCount: 4, displayCode: 'MEM-020202', status: 'used' });
  store.seed('tickets', T(3), { customerName: 'Esi Comp', eventId: 'fri', type: 'Comp', admitCount: 2, displayCode: 'MEM-030303', status: 'valid', comp: true });
  store.seed('tickets', T(4), { customerName: 'Gone', eventId: 'fri', admitCount: 1, displayCode: 'MEM-040404', status: 'valid', revoked: true });
  store.seed('tickets', T(5), { customerName: 'Ama Sat', eventId: 'sat', admitCount: 1, displayCode: 'MEM-050505', status: 'valid' });
}
async function get(env, path, claims = { role: 'doorStaff' }, uid) {
  const r = await worker.fetch(new Request(`https://api.test${path}`, { headers: { Authorization: `Bearer ${await idToken(claims, uid ? { uid } : undefined)}`, 'CF-Connecting-IP': '10.3.3.3' } }), env);
  return { status: r.status, text: await r.clone().text(), data: await r.json() };
}
async function post(env, body, claims = { role: 'doorStaff' }) {
  const r = await worker.fetch(new Request('https://api.test/api/checkin', { method: 'POST', headers: { Authorization: `Bearer ${await idToken(claims)}` }, body: JSON.stringify(body) }), env);
  return r.json();
}

test('summary: admitted and expected people for the night, from the server', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const s = (await get(env, '/api/door/summary?eventId=fri')).data;
  assert.equal(s.admitted, 4, 'Kofi’s group of 4 is in');
  assert.equal(s.expected, 7, '1 + 4 + 2 (revoked ticket not counted)');
  assert.equal(s.comps, 2);
  await post(env, { token: T(1), eventId: 'fri' });
  assert.equal((await get(env, '/api/door/summary?eventId=fri')).data.admitted, 5, 'every phone sees the new count');
});

test('search by first name, code or last 4 of phone; results carry no token', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const byName = await get(env, '/api/door/search?eventId=fri&q=ama');
  assert.deepEqual(byName.data.results.map(r => r.code), ['MEM-010101'], 'Saturday’s Ama is not in Friday’s results');
  assert.deepEqual(Object.keys(byName.data.results[0]).sort(), ['admits', 'code', 'comp', 'firstName', 'phoneLast4', 'status', 'type']);
  assert.equal((await get(env, '/api/door/search?eventId=fri&q=1111')).data.results[0].firstName, 'Kofi');
  assert.equal((await get(env, '/api/door/search?eventId=fri&q=mem-0303')).data.results[0].comp, true);
  assert.equal((await get(env, '/api/door/search?eventId=fri&q=g')).data.results.length, 0, 'at least 2 characters');
  for (const q of ['ama', 'kofi', '4567', 'mem']) {
    const r = await get(env, `/api/door/search?eventId=fri&q=${q}`);
    for (let n = 1; n <= 5; n++) assert.ok(!r.text.includes(T(n)), `token in search for ${q}`);
  }
});

test('admit from search by code, within the chosen night only', async () => {
  const { store, env } = createMockEnv(); seed(store);
  assert.equal((await post(env, { code: 'MEM-050505', eventId: 'fri' })).code, 'invalid', 'Saturday’s code doesn’t work on Friday');
  const ok = await post(env, { code: 'mem-010101', eventId: 'fri' });
  assert.equal(ok.valid, true);
  assert.equal(store.get('tickets', T(1)).fields.status, 'used');
  assert.equal((await post(env, { code: 'MEM-010101', eventId: 'fri' })).code, 'used');
});

test('no night chosen → nothing is admitted', async () => {
  const { store, env } = createMockEnv(); seed(store);
  assert.equal((await post(env, { token: T(1) })).code, 'no_event');
  assert.equal(store.get('tickets', T(1)).fields.status, 'valid');
});

test('organisers: summary and search only for their own night', async () => {
  const { store, env } = createMockEnv(); seed(store);
  assert.equal((await get(env, '/api/door/summary?eventId=fri', { role: 'organiser' }, 'org-A')).status, 200);
  assert.equal((await get(env, '/api/door/summary?eventId=fri', { role: 'organiser' }, 'org-B')).status, 403);
  assert.equal((await get(env, '/api/door/search?eventId=fri&q=ama', { role: 'organiser' }, 'org-B')).status, 403);
});

test('20 phones scanning one ticket at the same moment: exactly one entry', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => checkin(env, T(1), { uid: `door-${i}`, role: 'doorStaff' }, { eventId: 'fri' }).catch(e => ({ error: e.message }))));
  assert.equal(results.filter(r => r.valid).length, 1, JSON.stringify(results.map(r => r.code || r.error)));
  assert.equal(store.list('checkins').length, 1, 'one check-in record');
  assert.ok(results.filter(r => !r.valid).every(r => r.code === 'used' || r.error), 'the rest see ALREADY CHECKED IN (or a retry error)');
});

test('tables at the door: found by name, last 4 digits or TBL- code, seated once; another organiser can’t', async () => {
  const { store, env } = createMockEnv(); seed(store);
  store.seed('orders', 'abc123ffff', { kind: 'table', status: 'confirmed', eventId: 'fri', eventName: 'Friday', packageName: 'Floor Table', buyerName: 'Efua Mensah', buyerPhone: '0551234567' });
  store.seed('orders', 'zzz999ffff', { kind: 'table', status: 'confirmed', eventId: 'sat', eventName: 'Saturday', packageName: 'Table', buyerName: 'Efua Other', buyerPhone: '0551234567' });
  for (const q of ['efua', '4567', 'TBL-ABC1', 'abc123']) {
    const hits = (await get(env, `/api/door/search?eventId=fri&q=${q}`)).data.results.filter(r => r.table);
    assert.deepEqual(hits.map(h => h.code), ['TBL-ABC123'], `search "${q}" finds the table on this night only`);
    assert.equal(hits[0].phoneLast4, '4567');
  }
  const first = await post(env, { table: 'TBL-ABC123', eventId: 'fri' });
  assert.equal(first.code, 'seated'); assert.equal(first.ticket.firstName, 'Efua');
  assert.ok(store.get('orders', 'abc123ffff').fields.arrivedAt, 'arrival recorded');
  assert.equal((await post(env, { table: 'TBL-ABC123', eventId: 'fri' })).code, 'table_used');
  assert.equal((await post(env, { table: 'TBL-ABC123', eventId: 'sat' })).code, 'invalid', 'wrong night');
  assert.equal((await post(env, { table: 'TBL-ZZZ999', eventId: 'sat' }, { role: 'organiser' })).code, 'forbidden', 'not their night');
  assert.equal((await get(env, '/api/door/summary?eventId=fri')).data.admitted, 4, 'seating a table doesn’t change the ticket headcount');
});

test('a paid table’s text gives its door code, not the long payment reference', async () => {
  const { store, env } = createMockEnv();
  store.seed('table_packages', 'p1', { eventId: 'fri', name: 'Floor Table', pricePesewas: 350000, remaining: null, active: true });
  store.seed('pending_checkouts', 'refT', { reference: 'refT', kind: 'table', eventId: 'fri', eventName: 'Friday', packageId: 'p1', packageName: 'Floor Table', bottles: [], amountPesewas: 350000, buyerName: 'Efua', buyerPhone: '0551234567', status: 'pending' });
  store.setPaystack('refT', { status: 'success', currency: 'GHS', amount: 350000 });
  const { fulfillTable } = await import('../src/index.js');
  const r = await fulfillTable(env, 'refT');
  assert.match(store.sms[0].message, new RegExp(`At the door: TBL-${r.orderId.slice(0, 6).toUpperCase()}`));
  assert.ok(!store.sms[0].message.includes('refT'));
});

test('undo an admission: the admitter within 2 minutes, a manager any time; kept on record, never deleted', async () => {
  const { store, env } = createMockEnv(); seed(store);
  const undo = async (checkinId, claims, uid) => {
    const r = await worker.fetch(new Request('https://api.test/api/checkin/undo', { method: 'POST', headers: { Authorization: `Bearer ${await idToken(claims, uid ? { uid } : undefined)}` }, body: JSON.stringify({ checkinId }) }), env);
    return { status: r.status, data: await r.json() };
  };
  const door = { role: 'doorStaff' };
  const r = await checkin(env, T(1), { role: 'doorStaff', uid: 'door-1' }, { eventId: 'fri' });
  assert.equal(r.code, 'ok'); assert.match(r.checkinId, /^[0-9a-f]{32}$/);
  assert.equal((await undo(r.checkinId, door, 'door-2')).status, 403, 'another door phone can’t undo it');
  const ok = await undo(r.checkinId, door, 'door-1');
  assert.equal(ok.status, 200, ok.data.error); assert.equal(ok.data.ticket.firstName, 'Ama');
  assert.equal(store.get('tickets', T(1)).fields.status, 'valid', 'the ticket works again');
  const ci = store.get('checkins', r.checkinId).fields;
  assert.ok(ci.undoneAt && ci.undoneBy === 'door-1' && ci.checkedInBy === 'door-1', 'the check-in stays, marked undone');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'CHECKIN_UNDONE' && a.fields.checkinId === r.checkinId));
  assert.equal((await undo(r.checkinId, door, 'door-1')).status, 400, 'once only');
  assert.equal((await get(env, '/api/door/summary?eventId=fri')).data.admitted, 4, 'headcount back to before');

  const again = await checkin(env, T(1), { role: 'doorStaff', uid: 'door-1' }, { eventId: 'fri' });
  assert.equal(again.code, 'ok', 'it can be scanned again');
  const ci2 = store.get('checkins', again.checkinId);
  store.seed('checkins', again.checkinId, { ...ci2.fields, checkedInAt: new Date(Date.now() - 3 * 60e3).toISOString() });
  assert.equal((await undo(again.checkinId, door, 'door-1')).status, 403, 'door staff: 2 minutes only');
  assert.equal((await undo(again.checkinId, { role: 'manager' }, 'mgr-1')).status, 200, 'a manager can later');
});
