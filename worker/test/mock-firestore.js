// A minimal in-memory Firestore REST emulator, just faithful enough to prove the Worker's own
// concurrency guarantees: every document carries a version, every transaction remembers the
// version of everything it read, and :commit rejects (409, mirroring real Firestore's ABORTED)
// if anything it read changed since. That's the exact mechanism withTransaction()'s retry loop in
// src/index.js is written to survive, so if these tests pass against this mock, the retry loop is
// proven to (a) actually retry on 409 and (b) end up with a correct, non-corrupted final state.
//
// This is a true black-box test: it only ever talks to the Worker over the same fetch() surface
// Cloudflare would use, with its own independent encode/decode of Firestore's {stringValue:...}
// wire format, so it can't accidentally pass by sharing internals with the code under test.

import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

// A stand-in for Google's securetoken signing key, so tests can mint real, signed Firebase ID
// tokens and drive the Worker's auth exactly as production does.
let signing;
async function signingKey() {
  if (!signing) { const { privateKey, publicKey } = await generateKeyPair('RS256'); const jwk = await exportJWK(publicKey); signing = { privateKey, jwk: { ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' } }; }
  return signing;
}
async function testJwks() { return { keys: [(await signingKey()).jwk] }; }
export async function idToken(claims = {}, { projectId = 'test-project', uid = 'user-' + Math.random().toString(36).slice(2) } = {}) {
  const { privateKey } = await signingKey();
  return new SignJWT({ ...claims, user_id: uid })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer(`https://securetoken.google.com/${projectId}`).setAudience(projectId).setSubject(uid)
    .setIssuedAt().setExpirationTime('1h').sign(privateKey);
}

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}
function encodeFields(obj) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encodeValue(v)]));
}
function decodeValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class MockFirestore {
  constructor() {
    this.docs = new Map();      // "col/id" -> plain JS fields object
    this.versions = new Map();  // "col/id" -> integer version
    this.txs = new Map();       // txId -> Map("col/id" -> version at read time)
    this.seq = 0;
    this.paystack = new Map();  // reference -> {status:'success'|'failed', currency, amount}
    this.commitDelays = new Map(); // "col/id" -> ms to sleep after read, before this tx's commit — lets tests force a specific interleaving
    this.sms = [];    // { to, message } — every sendSms() call the code under test made
    this.emails = []; // { to, subject } — every sendBrevo() call the code under test made
  }

  key(col, id) { return `${col}/${id}`; }

  seed(col, id, fields) {
    const k = this.key(col, id);
    this.docs.set(k, fields);
    this.versions.set(k, ++this.seq);
  }

  get(col, id) {
    const k = this.key(col, id);
    return this.docs.has(k) ? { fields: this.docs.get(k), version: this.versions.get(k) } : null;
  }

  list(col) {
    const out = [];
    for (const [k, fields] of this.docs) {
      const [c, id] = k.split(/\/(.*)/s);
      if (c === col) out.push({ id, fields });
    }
    return out;
  }

  setPaystack(reference, result) { this.paystack.set(reference, result); }

  fetch = async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';

    if (u.hostname === 'www.googleapis.com' && u.pathname.includes('securetoken@system.gserviceaccount.com')) {
      return jsonResponse(await testJwks());
    }

    if (u.hostname === 'identitytoolkit.googleapis.com') {
      const body = options.body ? JSON.parse(options.body) : {};
      if (u.pathname.endsWith('accounts:lookup')) return jsonResponse({ users: (this.authUsers || []).filter(x => body.email?.includes(x.email)) });
      if (u.pathname.endsWith('accounts:update')) { (this.claimUpdates ||= []).push(body); (this.claims ||= {})[body.localId] = JSON.parse(body.customAttributes || '{}'); return jsonResponse({ localId: body.localId }); }
    }

    if (u.hostname === 'oauth2.googleapis.com') {
      return jsonResponse({ access_token: 'mock-token', expires_in: 3600 });
    }

    const body = options.body ? JSON.parse(options.body) : null;

    if (u.hostname === 'api.brevo.com') {
      this.emails.push({ to: body?.to?.[0]?.email, subject: body?.subject });
      return jsonResponse({ messageId: 'mock' });
    }

    if (u.hostname === 'sms.mock.test' && u.pathname === '/send-sms') {
      // Same contract as the club's SMS worker: {sender, recipients:[phone], message}.
      if (!Array.isArray(body?.recipients) || !body?.message) return jsonResponse({ success: false, error: 'bad payload' }, 400);
      for (const to of body.recipients) this.sms.push({ to, message: body.message, sender: body.sender });
      return jsonResponse({ success: true });
    }

    if (u.hostname === 'api.paystack.co') {
      const m = u.pathname.match(/^\/transaction\/verify\/(.+)$/);
      if (m) {
        const ref = decodeURIComponent(m[1]);
        const r = this.paystack.get(ref) || { status: 'failed' };
        return jsonResponse({ status: true, message: 'ok', data: r });
      }
      if (u.pathname === '/transaction/initialize') {
        return jsonResponse({ status: true, data: { authorization_url: 'https://paystack.test/pay' } });
      }
      return jsonResponse({ status: false, message: 'not mocked' }, 400);
    }

    if (u.hostname === 'firestore.googleapis.com') {
      return this.handleFirestore(u, method, body);
    }

    throw new Error(`Unhandled fetch in mock: ${method} ${url}`);
  };

  handleFirestore(u, method, body) {
    const path = u.pathname.replace(/^\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents/, '');

    if (path === ':beginTransaction' && method === 'POST') {
      const txId = 'tx_' + (++this.seq);
      this.txs.set(txId, new Map());
      return jsonResponse({ transaction: txId });
    }

    if (path === ':batchGet' && method === 'POST') {
      const tx = body.transaction ? this.txs.get(body.transaction) : null;
      const out = (body.documents || []).map(fullName => {
        const rel = fullName.split('/documents/')[1];
        const [col, id] = rel.split(/\/(.*)/s);
        const doc = this.get(col, id);
        const k = this.key(col, id);
        if (tx) tx.set(k, this.versions.get(k) ?? 0);
        if (!doc) return { missing: fullName, readTime: new Date().toISOString() };
        return { found: { name: fullName, fields: encodeFields(doc.fields) }, readTime: new Date().toISOString() };
      });
      return jsonResponse(out);
    }

    if (path === ':runQuery' && method === 'POST') {
      const sq = body.structuredQuery;
      const col = sq.from[0].collectionId;
      const filters = sq.where ? (sq.where.compositeFilter ? sq.where.compositeFilter.filters : [sq.where]) : [];
      const tx = body.transaction ? this.txs.get(body.transaction) : null;
      const matches = this.list(col).filter(({ fields }) =>
        filters.every(f => {
          const ff = f.fieldFilter;
          return fields[ff.field.fieldPath] === decodeValue(ff.value);
        })
      ).slice(0, sq.limit || 1000);
      const out = matches.map(({ id, fields }) => {
        const k = this.key(col, id);
        if (tx) tx.set(k, this.versions.get(k) ?? 0);
        return { document: { name: `projects/p/databases/(default)/documents/${col}/${id}`, fields: encodeFields(fields) } };
      });
      return jsonResponse(out);
    }

    if (path === ':commit' && method === 'POST') {
      const txId = body.transaction;
      const tx = txId ? this.txs.get(txId) : new Map();
      if (txId && !tx) return jsonResponse({ error: { message: 'Unknown transaction' } }, 400);
      if (this.onCommitAttempt) this.onCommitAttempt();
      for (const [k, readVer] of tx) {
        const curVer = this.versions.get(k) ?? 0;
        if (curVer !== readVer) {
          if (txId) this.txs.delete(txId);
          return jsonResponse({ error: { message: 'ABORTED: transaction was aborted due to contention' } }, 409);
        }
      }
      for (const w of body.writes || []) {
        const rel = w.update.name.split('/documents/')[1];
        const [col, id] = rel.split(/\/(.*)/s);
        this.seed(col, id, decodeFields(w.update.fields));
      }
      if (txId) this.txs.delete(txId);
      return jsonResponse({ writeResults: (body.writes || []).map(() => ({ updateTime: new Date().toISOString() })) });
    }

    // Single-doc PATCH (setDoc), POST with documentId (createDoc), GET (getDoc/listDocs), DELETE
    const docMatch = path.match(/^\/([^/?]+)\/([^/?]+)$/);
    if (docMatch && method === 'PATCH') {
      const [, col, id] = docMatch;
      const existing = this.get(col, id);
      this.seed(col, decodeURIComponent(id), decodeFields(body.fields));
      return jsonResponse({ name: `projects/p/databases/(default)/documents/${col}/${id}`, fields: body.fields });
    }
    if (docMatch && method === 'GET') {
      const [, col, id] = docMatch;
      const doc = this.get(col, decodeURIComponent(id));
      if (!doc) return jsonResponse({ error: { message: `Document ${col}/${id} NOT_FOUND` } }, 404);
      return jsonResponse({ name: `projects/p/databases/(default)/documents/${col}/${id}`, fields: encodeFields(doc.fields) });
    }
    if (docMatch && method === 'DELETE') {
      const [, col, id] = docMatch;
      const k = this.key(col, decodeURIComponent(id));
      this.docs.delete(k); this.versions.delete(k);
      return jsonResponse({});
    }

    const colMatch = path.match(/^\/([^/?]+)$/);
    if (colMatch && method === 'POST') {
      const col = colMatch[1];
      const docId = u.searchParams.get('documentId');
      if (this.get(col, docId)) return jsonResponse({ error: { message: 'ALREADY_EXISTS: document already exists' } }, 409);
      this.seed(col, docId, decodeFields(body.fields));
      return jsonResponse({ name: `projects/p/databases/(default)/documents/${col}/${docId}`, fields: body.fields });
    }
    if (colMatch && method === 'GET') {
      const col = colMatch[1];
      const pageSize = Number(u.searchParams.get('pageSize') || 300);
      const pageToken = u.searchParams.get('pageToken');
      const all = this.list(col);
      const start = pageToken ? Number(pageToken) : 0;
      const page = all.slice(start, start + pageSize);
      const nextPageToken = start + pageSize < all.length ? String(start + pageSize) : undefined;
      return jsonResponse({
        documents: page.map(({ id, fields }) => ({ name: `projects/p/databases/(default)/documents/${col}/${id}`, fields: encodeFields(fields) })),
        ...(nextPageToken ? { nextPageToken } : {}),
      });
    }

    return jsonResponse({ error: { message: `mock: unhandled Firestore path ${method} ${path}` } }, 400);
  }
}

let cachedKeyPem;
function testPrivateKeyPem() {
  if (cachedKeyPem) return cachedKeyPem;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  cachedKeyPem = privateKey;
  return cachedKeyPem;
}

// Builds a fresh mock store + env pair and installs the mock fetch as globalThis.fetch for the
// duration of the calling test file. Returns {store, env} — call store.seed(...) to set up
// fixtures, then call the Worker's exported functions directly against env.
export function createMockEnv() {
  const store = new MockFirestore();
  globalThis.fetch = store.fetch;
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'test@test.iam.gserviceaccount.com', private_key: testPrivateKeyPem() }),
    PAYSTACK_SECRET_KEY: 'sk_test_mock',
    ALLOWED_ORIGINS: 'http://localhost:3000',
    SMS_WORKER_URL: 'https://sms.mock.test',
    BREVO_API_KEY: 'mock-brevo-key',
    BREVO_SENDER_EMAIL: 'noreply@memoriesnightclub.gh',
    PUBLIC_SITE_URL: 'https://memoriesnightclub.gh',
  };
  return { store, env };
}
