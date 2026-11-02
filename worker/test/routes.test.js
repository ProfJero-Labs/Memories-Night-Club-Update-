// The owner's payment and charge rules (src/lib/routes.js): which ways a bill can be paid, and
// who pays the 5% charge. Amounts in pesewas (GHS 1 = 100).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeFor, cleanRoutes, DEFAULT_ROUTES } from '../src/lib/routes.js';

const ps = bill => routeFor(bill).paystack;

test('up to and including GHS 300: Paystack, the customer pays the whole 5%', () => {
  const r = routeFor(30000);
  assert.deepEqual(r.tenders, ['cash', 'paystack']);
  assert.deepEqual([r.paystack.chargePesewas, r.paystack.customerSharePesewas, r.paystack.venueSharePesewas, r.paystack.customerPaysPesewas, r.paystack.venueRecordsPesewas], [1500, 1500, 0, 31500, 30000]);
  assert.deepEqual([ps(20000).customerPaysPesewas, ps(20000).venueRecordsPesewas], [21000, 20000]);
});

test('just over GHS 300: the customer still pays GHS 15, so a bigger bill never costs them less', () => {
  const p = ps(30001);
  assert.deepEqual([p.chargePesewas, p.customerSharePesewas, p.venueSharePesewas, p.customerPaysPesewas], [1500, 1500, 0, 31501]);
  const q = ps(30100);
  assert.deepEqual([q.chargePesewas, q.customerSharePesewas, q.venueSharePesewas], [1505, 1500, 5]);
  for (let bill = 29000; bill <= 70000; bill += 37) assert.ok(ps(bill + 37).customerPaysPesewas >= ps(bill).customerPaysPesewas, `GHS ${bill / 100}: a bigger bill never costs the customer less`);
});

test('the owner’s example: bill 1,500 → customer pays 1,537.50, venue records 1,462.50, Paystack ~29.98, EvolveIT ~45.02', () => {
  const p = ps(150000);
  assert.deepEqual([p.chargePesewas, p.customerSharePesewas, p.venueSharePesewas, p.customerPaysPesewas, p.venueRecordsPesewas], [7500, 3750, 3750, 153750, 146250]);
  assert.deepEqual([p.paystackFeeEstimatePesewas, p.evolveitEstimatePesewas], [2998, 4502]);
});

test('exactly GHS 2,000: still Paystack, split 50/50', () => {
  const r = routeFor(200000);
  assert.deepEqual(r.tenders, ['cash', 'paystack']);
  assert.deepEqual([r.paystack.customerSharePesewas, r.paystack.venueSharePesewas, r.paystack.customerPaysPesewas, r.paystack.venueRecordsPesewas], [5000, 5000, 205000, 195000]);
});

test('above GHS 2,000: no Paystack; MoMo to the wallet with a flat GHS 100 the customer pays (the owner’s 20,000 example)', () => {
  const r = routeFor(200001);
  assert.deepEqual(r.tenders, ['cash', 'momo_direct']);
  assert.equal(r.paystack, undefined);
  const m = routeFor(2000000).momo;
  assert.deepEqual([m.customerPaysPesewas, m.venueRecordsPesewas, m.evolveitPesewas], [2010000, 2000000, 10000]);
});

test('cash: any amount, no charge', () => {
  for (const bill of [500, 30000, 200000, 5000000]) assert.deepEqual([routeFor(bill).cash.chargePesewas, routeFor(bill).cash.customerPaysPesewas], [0, bill]);
});

test('rounding: whole pesewas, and the two shares always add up to the charge', () => {
  for (let bill = 1; bill <= 200000; bill += 97) {
    const p = ps(bill);
    assert.ok([p.chargePesewas, p.customerSharePesewas, p.venueSharePesewas].every(Number.isInteger));
    assert.equal(p.customerSharePesewas + p.venueSharePesewas, p.chargePesewas);
    assert.equal(p.customerPaysPesewas - p.venueRecordsPesewas, p.chargePesewas);
    assert.ok(p.venueSharePesewas >= 0 && p.customerSharePesewas >= 0);
  }
  assert.deepEqual([ps(33333).chargePesewas, ps(33333).customerSharePesewas, ps(33333).venueSharePesewas], [1667, 1500, 167]);
});

test('settings: every number can change; nonsense is refused; off by default', () => {
  assert.equal(DEFAULT_ROUTES.enabled, false);
  const n = cleanRoutes({ percent: 4, paystackUpToPesewas: 300000, bigFlatPesewas: 15000, enabled: true });
  assert.deepEqual([n.percent, n.paystackUpToPesewas, n.bigFlatPesewas, n.enabled], [4, 300000, 15000, true]);
  assert.equal(routeFor(250000, n).band, 'middle', 'a raised limit moves GHS 2,500 onto Paystack');
  assert.match(cleanRoutes({ percent: 50 }).error, /percentage/);
  assert.match(cleanRoutes({ bigFlatPesewas: -1 }).error, /0 or more/);
  assert.match(cleanRoutes({ customerOnlyUpToPesewas: 300000, paystackUpToPesewas: 200000 }).error, /at or below/);
});

import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
test('the rules are settings: a director changes them, finance can look, nobody else; changes are logged', async () => {
  const { store, env } = createMockEnv();
  let ip = 0;
  const call = async (method, path, role, body) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.55.0.${++ip}`, Authorization: `Bearer ${await idToken({ role }, { uid: `u-${role}` })}` };
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const look = await call('GET', '/api/ops/commercial', 'finance');
  assert.equal(look.status, 200);
  assert.equal(look.data.routes.enabled, false);
  const ex = look.data.routeExamples.find(x => x.billPesewas === 150000);
  assert.equal(ex.paystack.customerPaysPesewas, 153750);
  assert.equal((await call('POST', '/api/ops/commercial', 'finance', { routes: { percent: 4 } })).status, 403);
  assert.equal((await call('POST', '/api/ops/commercial', 'manager', { routes: { percent: 4 } })).status, 403);
  assert.match((await call('POST', '/api/ops/commercial', 'director', { routes: { percent: 99 } })).data.error, /percentage/);
  const saved = await call('POST', '/api/ops/commercial', 'director', { routes: { bigFlatPesewas: 12000 } });
  assert.equal(saved.data.routes.bigFlatPesewas, 12000);
  assert.equal(saved.data.routeExamples.find(x => x.billPesewas === 2000000).momo.customerPaysPesewas, 2012000);
  assert.ok(store.list('change_log').some(d => d.fields.refId === 'routes'), 'the change is logged');
});
