// Firestore over its REST API, authenticated with the Firebase service account.
// The Admin SDK doesn't run in the Workers runtime, so this is the whole data layer.

const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64 = s => { const p = '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + p), c => c.charCodeAt(0)); };

export function firestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, firestoreValue(x)])) } };
  return { stringValue: String(v) };
}
export function docFields(obj) { return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, firestoreValue(v)])); }
function parseValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(parseValue);
  if ('mapValue' in v) return parseFields(v.mapValue.fields || {});
  return null;
}
export function parseFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseValue(v)])); }

// Access tokens are cached per scope: Firestore and Identity Toolkit need different ones.
const tokenCache = {};
export async function googleAccessToken(env, scope = 'https://www.googleapis.com/auth/datastore') {
  const cached = tokenCache[scope];
  if (cached && cached.sa === env.FIREBASE_SERVICE_ACCOUNT_JSON && Date.now() < cached.expires - 60000) return cached.value;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const keyPem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', fromB64(keyPem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: t, exp: t + 3600 }));
  const signature = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${signature}` }) });
  const d = await r.json(); if (!r.ok) throw new Error('Google access token failed');
  tokenCache[scope] = { value: d.access_token, expires: Date.now() + d.expires_in * 1000, sa: env.FIREBASE_SERVICE_ACCOUNT_JSON };
  return d.access_token;
}

const basePath = env => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const docName = (env, col, id) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${col}/${id}`;

async function call(env, url, options = {}) {
  const token = await googleAccessToken(env);
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(d.error?.message || `Firestore ${r.status}`); err.status = r.status; throw err; }
  return d;
}
const fs = (env, path, options) => call(env, basePath(env) + path, options);

export async function getDoc(env, col, docId) {
  if (!docId) return null;
  try { const d = await fs(env, `/${col}/${encodeURIComponent(docId)}`); return d.name ? { id: docId, fields: parseFields(d.fields) } : null; }
  catch (e) { if (e.status === 404 || String(e.message).includes('NOT_FOUND')) return null; throw e; }
}
export async function listDocs(env, col) {
  let docs = [], pageToken;
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const d = await fs(env, `/${col}?${qs}`);
    docs = docs.concat((d.documents || []).map(x => ({ id: x.name.split('/').pop(), fields: parseFields(x.fields) })));
    pageToken = d.nextPageToken || null;
  } while (pageToken);
  return docs;
}
export async function setDoc(env, col, docId, data) { await fs(env, `/${col}/${encodeURIComponent(docId)}`, { method: 'PATCH', body: JSON.stringify({ fields: docFields(data) }) }); }
export async function createDoc(env, col, docId, data) { return fs(env, `/${col}?documentId=${encodeURIComponent(docId)}`, { method: 'POST', body: JSON.stringify({ fields: docFields(data) }) }); }
export async function deleteDoc(env, col, docId) { await fs(env, `/${col}/${encodeURIComponent(docId)}`, { method: 'DELETE' }); }

// Equality-only structured query (AND of filters), optionally inside a transaction.
export async function queryWhere(env, col, filters, { limit = 1000, transaction } = {}) {
  const fieldFilters = filters.map(f => ({ fieldFilter: { field: { fieldPath: f.field }, op: 'EQUAL', value: firestoreValue(f.value) } }));
  const where = fieldFilters.length === 1 ? fieldFilters[0] : { compositeFilter: { op: 'AND', filters: fieldFilters } };
  const body = { structuredQuery: { from: [{ collectionId: col }], where, limit } };
  if (transaction) body.transaction = transaction;
  const d = await call(env, `${basePath(env)}:runQuery`, { method: 'POST', body: JSON.stringify(body) });
  return (d || []).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), fields: parseFields(x.document.fields) }));
}

// Newest first: documents whose `field` is at or after `since`, ordered by it, descending.
// (A single-field range plus its own orderBy needs no composite index.)
export async function queryRecent(env, col, field, since, limit = 50) {
  const body = { structuredQuery: {
    from: [{ collectionId: col }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(since) } },
    orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }], limit,
  } };
  const d = await call(env, `${basePath(env)}:runQuery`, { method: 'POST', body: JSON.stringify(body) });
  return (d || []).filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), fields: parseFields(x.document.fields) }));
}

// ── Transactions ──
async function beginTx(env) { const d = await fs(env, ':beginTransaction', { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) }); return d.transaction; }
export async function batchGet(env, paths, transaction) {
  const documents = paths.map(p => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${p}`);
  return call(env, `${basePath(env)}:batchGet`, { method: 'POST', body: JSON.stringify({ documents, transaction }) });
}
export async function commitTx(env, writes, transaction) {
  return call(env, `${basePath(env)}:commit`, { method: 'POST', body: JSON.stringify({ writes, transaction }) });
}
export const updateWrite = (env, col, docId, data) => ({ update: { name: docName(env, col, docId), fields: docFields(data) } });
export function foundFields(result, suffix) {
  const found = (result || []).filter(x => x.found).map(x => ({ path: x.found.name, fields: parseFields(x.found.fields) }));
  return found.find(x => x.path.endsWith(suffix));
}

// Firestore aborts contended transactions (409); the whole read-modify-write is retried against a
// fresh transaction, with backoff, a bounded number of times.
export async function withTransaction(env, fn, attempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const tx = await beginTx(env);
    try { return await fn(tx); }
    catch (e) {
      lastErr = e;
      if (e && e.status === 409 && attempt < attempts - 1) {
        await new Promise(res => setTimeout(res, Math.min(1000, 50 * 2 ** attempt) + Math.floor(Math.random() * 50)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
