// The Supabase side of the data layer: the same functions as the Firebase side in firestore.js
// (which picks one or the other by env.DB_BACKEND), so the rest of the app doesn't know which
// database it is using. Every record is a row of public.docs (collection, id, JSON data, version);
// the Worker reaches it through the functions in supabase/migrations/001_docs_and_functions.sql,
// called as /rest/v1/rpc/<name> with the service-role key (a Worker secret).
//
// Transactions: Firebase aborts a transaction if anything it read changed. Here a transaction is a
// record of the version of every document read through it; m_commit refuses (409) if any of those
// versions moved, and withTransaction retries, exactly as it does on Firebase.
import { docFields, parseFields } from './codec.js';

const base = env => String(env.SUPABASE_URL || '').replace(/\/+$/, '');

async function rpc(env, fn, args) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this Worker (Cloudflare → Settings → Variables and Secrets, as Secrets).');
  // New-style secret keys (sb_secret_…) go in apikey only; the older JWT keys also go in Authorization.
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(String(key).startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
  const r = await fetch(`${base(env)}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await r.text();
  let d = null; try { d = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) {
    const err = new Error(d?.message || `Supabase ${r.status}`);
    err.status = r.status;
    // A deadlock or a serialization failure is a clash between two saves: retry it like Firebase's 409.
    if (['40P01', '40001'].includes(d?.code)) err.status = 409;
    throw err;
  }
  return d;
}

// ── Transactions in flight (one request's read-modify-write, in this Worker's memory) ──
const txs = new Map(); // id → { at, reads: Map('col/id' → version) }
const TX_LIFE = 5 * 60e3;
export async function beginTx() {
  const now = Date.now();
  for (const [k, t] of txs) if (now - t.at > TX_LIFE) txs.delete(k);
  const id = `sb${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  txs.set(id, { at: now, reads: new Map() });
  return id;
}
const seen = (tx, col, id, version) => { const t = tx && txs.get(tx); if (t) t.reads.set(`${col}/${id}`, version); };

// ── Reading ──
const asDoc = x => ({ id: x.id, fields: x.data || {} });
const jsonValue = v => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
// [{ field: 'a.b', value }] → { a: { b: value } } (what m_query matches with @>).
function filterOf(filters) {
  const out = {};
  for (const f of filters || []) {
    const path = String(f.field).split('.'); let o = out;
    for (const p of path.slice(0, -1)) o = (o[p] ||= {});
    o[path.at(-1)] = jsonValue(f.value);
  }
  return out;
}

export async function getDoc(env, col, id) {
  const d = await rpc(env, 'm_get', { p_col: col, p_id: String(id) });
  return d ? asDoc(d) : null;
}
export async function queryWhere(env, col, filters, { limit = 1000, transaction } = {}) {
  const rows = await rpc(env, 'm_query', { p_col: col, p_filter: filterOf(filters), p_limit: limit, p_after: null });
  for (const x of rows) seen(transaction, col, x.id, x.version);
  return rows.map(asDoc);
}
// Every matching document, paged by id.
export async function queryAll(env, col, filters, { page = 1000, max = 200000 } = {}) {
  const out = []; let after = null;
  while (out.length < max) {
    const rows = await rpc(env, 'm_query', { p_col: col, p_filter: filterOf(filters), p_limit: page, p_after: after });
    out.push(...rows.map(asDoc));
    if (rows.length < page) break;
    after = rows.at(-1).id;
  }
  return out;
}
export const listDocs = (env, col) => queryAll(env, col, []);
export async function queryRecent(env, col, field, since, limit = 50) {
  return (await rpc(env, 'm_recent', { p_col: col, p_field: field, p_since: new Date(since).toISOString(), p_limit: limit })).map(asDoc);
}

// ── Writing ──
const put = (col, id, data, extra = {}) => ({ op: 'set', col, id: String(id), data: JSON.parse(JSON.stringify(data ?? {})), ...extra });
export async function setDoc(env, col, id, data) { await rpc(env, 'm_commit', { p_reads: [], p_writes: [put(col, id, data)] }); }
export async function createDoc(env, col, id, data) { return rpc(env, 'm_commit', { p_reads: [], p_writes: [put(col, id, data, { exists: false })] }); }
export async function deleteDoc(env, col, id) { await rpc(env, 'm_commit', { p_reads: [], p_writes: [{ op: 'delete', col, id: String(id) }] }); }

// ── The Firebase-shaped calls the rest of the app makes inside transactions ──
const NAME = (col, id) => `projects/memories/databases/(default)/documents/${col}/${id}`;
const split = name => { const rest = String(name).split('/documents/')[1] || ''; const i = rest.indexOf('/'); return { col: rest.slice(0, i), id: rest.slice(i + 1) }; };

// Like Firebase's batchGet: [{ found: { name, fields (typed) } } | { missing: name }], in the order asked.
export async function batchGet(env, paths, transaction) {
  const keys = paths.map(p => { const i = p.indexOf('/'); return { col: p.slice(0, i), id: p.slice(i + 1) }; });
  const rows = await rpc(env, 'm_batch_get', { p_keys: keys });
  return rows.map(x => {
    seen(transaction, x.col, x.id, x.found ? x.version : 0);
    return x.found ? { found: { name: NAME(x.col, x.id), fields: docFields(x.data) }, readTime: new Date().toISOString() } : { missing: NAME(x.col, x.id) };
  });
}
// Like Firebase's commit: writes are { update: { name, fields } } or { delete: name }, optionally with
// currentDocument: { exists }. If a transaction is given, nothing is saved when anything it read moved.
export async function commitTx(env, writes, transaction) {
  const p_writes = (writes || []).map(w => {
    if (w.update) { const { col, id } = split(w.update.name); return put(col, id, parseFields(w.update.fields), w.currentDocument && 'exists' in w.currentDocument ? { exists: !!w.currentDocument.exists } : {}); }
    if (w.delete) { const { col, id } = split(w.delete); return { op: 'delete', col, id }; }
    throw new Error('This kind of write is not supported on Supabase.');
  });
  const t = transaction && txs.get(transaction);
  const p_reads = t ? [...t.reads].map(([k, version]) => { const i = k.indexOf('/'); return { col: k.slice(0, i), id: k.slice(i + 1), version }; }) : [];
  try { return await rpc(env, 'm_commit', { p_reads, p_writes }); }
  finally { if (transaction) txs.delete(transaction); }
}
