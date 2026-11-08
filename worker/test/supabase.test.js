// The Supabase data layer (lib/supabase-db.js behind lib/firestore.js): same answers as Firebase's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import * as db from '../src/lib/firestore.js';

function sb() {
  const { store, env } = createMockEnv();
  Object.assign(env, { DB_BACKEND: 'supabase', SUPABASE_URL: 'https://mock.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'mock-key' });
  return { store, env };
}

test('a record round-trips: dates become ISO text, undefined is dropped, null stays', async () => {
  const { env } = sb();
  await db.setDoc(env, 'things', 'a', { name: 'Ama', n: 3, ok: true, none: null, gone: undefined, at: new Date('2026-11-08T10:00:00.000Z'), list: [1, 'x'], deep: { k: { v: 2 } } });
  const d = await db.getDoc(env, 'things', 'a');
  assert.deepEqual(d, { id: 'a', fields: { name: 'Ama', n: 3, ok: true, none: null, at: '2026-11-08T10:00:00.000Z', list: [1, 'x'], deep: { k: { v: 2 } } } });
  assert.equal(await db.getDoc(env, 'things', 'nope'), null);
  await db.deleteDoc(env, 'things', 'a');
  assert.equal(await db.getDoc(env, 'things', 'a'), null);
});

test('equality queries: text, numbers, booleans, null is not "missing", several at once', async () => {
  const { env } = sb();
  await db.setDoc(env, 'tabs', 't1', { status: 'open', n: 1, vip: true, note: null, waiter: 'w1' });
  await db.setDoc(env, 'tabs', 't2', { status: 'open', n: 2, vip: false, waiter: 'w2' });
  await db.setDoc(env, 'tabs', 't3', { status: 'closed', n: 2, vip: false, waiter: 'w1' });
  const ids = async f => (await db.queryWhere(env, 'tabs', f)).map(x => x.id);
  assert.deepEqual(await ids([{ field: 'status', value: 'open' }]), ['t1', 't2']);
  assert.deepEqual(await ids([{ field: 'n', value: 2 }]), ['t2', 't3']);
  assert.deepEqual(await ids([{ field: 'vip', value: true }]), ['t1']);
  assert.deepEqual(await ids([{ field: 'note', value: null }]), ['t1'], 'null matches null, not a missing field');
  assert.deepEqual(await ids([{ field: 'status', value: 'open' }, { field: 'waiter', value: 'w2' }]), ['t2']);
  assert.deepEqual(await ids([{ field: 'status', value: 'nothing' }]), []);
  assert.equal((await db.queryWhere(env, 'tabs', [{ field: 'status', value: 'open' }], { limit: 1 })).length, 1, 'the limit applies');
});

test('newest first: queryRecent is inclusive, newest first, limited', async () => {
  const { env } = sb();
  for (const [id, at] of [['a', '2026-11-08T08:00:00.000Z'], ['b', '2026-11-08T10:00:00.000Z'], ['c', '2026-11-08T12:00:00.000Z']]) await db.setDoc(env, 'logs', id, { at: new Date(at) });
  await db.setDoc(env, 'logs', 'nodate', { x: 1 });
  assert.deepEqual((await db.queryRecent(env, 'logs', 'at', new Date('2026-11-08T10:00:00.000Z'), 50)).map(x => x.id), ['c', 'b']);
  assert.deepEqual((await db.queryRecent(env, 'logs', 'at', new Date('2026-11-08T00:00:00.000Z'), 2)).map(x => x.id), ['c', 'b']);
});

test('listing and queryAll page past the page size, in id order, without losing any', async () => {
  const { env } = sb();
  for (let i = 0; i < 25; i++) await db.setDoc(env, 'many', `r${String(i).padStart(2, '0')}`, { i, even: i % 2 === 0 });
  assert.equal((await db.listDocs(env, 'many')).length, 25);
  const all = await db.queryAll(env, 'many', [{ field: 'even', value: true }], { page: 4 });
  assert.equal(all.length, 13);
  assert.deepEqual(all.map(x => x.id), [...all.map(x => x.id)].sort());
});

test('createDoc says so when the record is already there', async () => {
  const { env } = sb();
  await db.createDoc(env, 'codes', 'x', { n: 1 });
  await assert.rejects(db.createDoc(env, 'codes', 'x', { n: 2 }), e => db.alreadyExists(e) && /already exists/i.test(e.message));
  assert.equal((await db.getDoc(env, 'codes', 'x')).fields.n, 1, 'the first one is untouched');
});

test('a save inside a transaction is refused if what it read changed, and withTransaction tries again', async () => {
  const { store, env } = sb();
  await db.setDoc(env, 'counters', 'c', { n: 5 });
  let attempts = 0;
  const result = await db.withTransaction(env, async tx => {
    attempts++;
    const f = db.foundFields(await db.batchGet(env, ['counters/c'], tx), '/counters/c');
    if (attempts === 1) store.seed('counters', 'c', { n: 99 }); // someone else saves in between
    await db.commitTx(env, [db.updateWrite(env, 'counters', 'c', { n: f.fields.n + 1 })], tx);
    return f.fields.n + 1;
  });
  assert.equal(attempts, 2, 'the first attempt was refused and run again');
  assert.equal(result, 100);
  assert.equal((await db.getDoc(env, 'counters', 'c')).fields.n, 100);
});

test('a saved batch is all or nothing, and "only if it isn’t there" is honoured', async () => {
  const { env } = sb();
  await db.setDoc(env, 'orders', 'o1', { v: 1 });
  const writes = [db.updateWrite(env, 'orders', 'o2', { v: 2 }), { ...db.updateWrite(env, 'orders', 'o1', { v: 'changed' }), currentDocument: { exists: false } }];
  await assert.rejects(db.commitTx(env, writes), e => e.status === 409);
  assert.equal(await db.getDoc(env, 'orders', 'o2'), null, 'the first write was not kept');
  assert.equal((await db.getDoc(env, 'orders', 'o1')).fields.v, 1);
  await db.commitTx(env, [db.updateWrite(env, 'orders', 'o2', { v: 2 }), db.deleteWrite(env, 'orders', 'o1')]);
  assert.deepEqual([(await db.getDoc(env, 'orders', 'o2')).fields.v, await db.getDoc(env, 'orders', 'o1')], [2, null]);
});

test('missing Supabase keys are named plainly (they stop every database request)', async () => {
  const { env } = sb();
  await assert.rejects(db.getDoc({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, 'settings', 'site'), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set/);
  await assert.rejects(db.getDoc({ ...env, SUPABASE_URL: '' }, 'settings', 'site'), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set/);
});

test('the read cache works the same on Supabase', async () => {
  const { env } = sb();
  let calls = 0; const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => { if (String(u).includes('/rpc/m_query')) calls++; return orig(u, o); };
  try {
    await db.setDoc(env, 'tabs', 't1', { status: 'open' });
    const q = () => db.readCache({}, () => db.queryWhere(env, 'tabs', [{ field: 'status', value: 'open' }]));
    await q(); await q();
    assert.equal(calls, 1, 'the second read was shared');
    await db.setDoc(env, 'tabs', 't2', { status: 'open' });
    assert.equal((await q()).length, 2, 'a write cleared it');
  } finally { globalThis.fetch = orig; }
});
