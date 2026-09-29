import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { listDocs } from '../src/index.js';

test('listDocs follows nextPageToken past the 300-document page size instead of silently truncating', async () => {
  const { store, env } = createMockEnv();
  const total = 725; // several pages at pageSize=300
  for (let i = 0; i < total; i++) {
    store.seed('tickets', `t${i}`, { customerName: `Guest ${i}`, eventId: 'event1', status: 'valid' });
  }

  const docs = await listDocs(env, 'tickets');
  assert.equal(docs.length, total, 'every document must come back, not just the first page');
  const ids = new Set(docs.map(d => d.id));
  assert.equal(ids.size, total, 'no duplicates across pages');
});
