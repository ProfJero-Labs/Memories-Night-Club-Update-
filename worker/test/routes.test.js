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
  const n = cleanRoutes({ percent: 4, paystackUpToPesewas: 300000, bigFlatPesewas: 15000, enabled: true, paystackSubaccount: 'ACCT_test123456' });
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

// ── Step 2: Paystack payments under the new rules ──
function setupLive({ on = true } = {}) {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'b'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('menu_items', 'magnum', { name: 'Magnum', category: 'Bottles', pricePesewas: 100000, costPesewas: 50000, available: true, tracked: true });
  store.seed('menu_items', 'royal', { name: 'Royal set', category: 'Bottles', pricePesewas: 150000, costPesewas: 70000, available: true, tracked: true });
  for (const p of ['beer', 'magnum', 'royal']) store.seed('stock_moves', `in-${p}`, { productId: p, stationId: 'main', qty: 50, kind: 'received', businessDate: '2000-01-01' });
  store.seed('settings', 'commercial', { serviceCharge: { enabled: true, percent: 5, capPesewas: 10000 }, routes: { ...DEFAULT_ROUTES, enabled: on, paystackSubaccount: 'ACCT_89qd3ub03w61erk' } });
  store.seed('users', 'm1', { name: 'Akos Manager', role: 'manager', phone: '0240001111' });
  store.seed('users', 'd1', { name: 'Nana Director', role: 'director', phone: '0240002222' });
  let ip = 0;
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.56.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who }, { uid: who === 'manager' ? 'm1' : 'd1' })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const qr = items => call('POST', '/api/guest/counter/checkout', { body: { station: 'b'.repeat(32), phone: '0241234567', items } });
  return { store, env, call, qr };
}

test('a small QR order: the customer pays the whole 5%; Paystack is told to keep the charge for EvolveIT and send the rest to the partner', async () => {
  const { store, call, qr } = setupLive();
  const r = await qr([{ itemId: 'beer', qty: 2 }]);
  assert.equal(r.status, 200, r.data.error);
  const init = store.paystackInits.at(-1);
  assert.deepEqual([init.amount, init.subaccount, init.transaction_charge, init.bearer], [5250, 'ACCT_89qd3ub03w61erk', 250, 'account']);
  const ref = store.list('pending_checkouts')[0].id;
  store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 5250, fees: 102, channel: 'mobile_money' });
  await call('GET', `/api/guest/counter/${r.data.orderId}`);
  const led = store.get('payment_ledger', ref).fields;
  assert.deepEqual([led.route.chargePesewas, led.route.customerSharePesewas, led.route.venueSharePesewas], [250, 250, 0]);
  assert.deepEqual([led.evolveitPesewas, led.partnerPesewas, led.clubBorneCostPesewas, led.commission.reason], [148, 5000, 0, 'replaced_by_charge']);
});

test('a GHS 1,000 QR order: 5% split 50/50; the venue’s share is a cost in the Money report', async () => {
  const { store, call, qr } = setupLive();
  const r = await qr([{ itemId: 'magnum', qty: 1 }]);
  const init = store.paystackInits.at(-1);
  assert.deepEqual([init.amount, init.transaction_charge], [102500, 5000], 'customer pays 1,025; EvolveIT’s side keeps the 50 charge');
  const ref = store.list('pending_checkouts')[0].id;
  store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 102500, fees: 1999, channel: 'card' });
  await call('GET', `/api/guest/counter/${r.data.orderId}`);
  const led = store.get('payment_ledger', ref).fields;
  assert.deepEqual([led.partnerPesewas, led.clubBorneCostPesewas, led.evolveitPesewas], [97500, 2500, 3001], 'partner gets 975 = 1,000 − his 25 share');
  const m = (await call('GET', '/api/ops/money?period=today', { who: 'director' })).data;
  assert.equal(m.moneyOut.find(x => x.key === 'pay_charges')?.amountPesewas, 2500);
});

test('above GHS 2,000: no Paystack (QR order refused with a plain message; a tab’s bill link too, even for a part of it)', async () => {
  const { store, call, qr } = setupLive();
  const r = await qr([{ itemId: 'royal', qty: 2 }]);
  assert.match(r.data.error, /above GHS 2,000.*Cash at the bar/);
  assert.equal(store.paystackInits.length, 0);
  // A table's bill over GHS 2,000: the bill link won't take card or MoMo, even for what's left after a cash part payment.
  const t = (await call('POST', '/api/ops/tabs/open', { who: 'manager', body: { table: '1' } })).data;
  await call('POST', '/api/ops/tabs/round', { who: 'manager', body: { tabId: t.id, lines: [{ productId: 'royal', qty: 2 }] } });
  const token = store.get('tabs', t.id).fields.billToken;
  assert.match((await call('POST', `/api/guest/bill/${token}/pay`, { body: {} })).data.error, /above GHS 2,000/);
});

test('rules off: payments work as before (the old service charge, no split)', async () => {
  const { store, qr } = setupLive({ on: false });
  await qr([{ itemId: 'beer', qty: 2 }]);
  const init = store.paystackInits.at(-1);
  assert.deepEqual([init.amount, init.subaccount, init.transaction_charge], [5250, undefined, undefined]);
});

test('switching on needs the partner’s subaccount; a bad code is refused', () => {
  assert.match(cleanRoutes({ enabled: true, paystackSubaccount: '' }).error, /subaccount/);
  assert.match(cleanRoutes({ paystackSubaccount: '12345' }).error, /ACCT_/);
  assert.equal(cleanRoutes({ enabled: true, paystackSubaccount: 'ACCT_89qd3ub03w61erk' }).enabled, true);
});

test('tickets online: the same 5% rule, and EvolveIT’s 10% ticket share stays with EvolveIT’s account on top of the charge', async () => {
  const { store, call } = setupLive();
  store.seed('events', 'n1', { name: 'Afrobeats Friday', date: '2099-06-05T22:00:00.000Z', doors: '10PM', visibility: 'public', active: true, ticketLines: ['A LINE.'] });
  store.seed('ticket_types', 'n1-std', { eventId: 'n1', name: 'Standard', pricePesewas: 15000, admits: 1, remaining: 200, active: true });
  const r = await call('POST', '/api/checkout/initiate', { body: { eventId: 'n1', ticketTypeId: 'n1-std', quantity: 2, buyerName: 'Kofi', buyerPhone: '024 123 4567', identityLine: 'A LINE.' } });
  assert.equal(r.status, 200, r.data.error);
  const init = store.paystackInits.at(-1), shares = store.get('pending_checkouts', r.data.reference).fields.shares;
  assert.equal(init.amount, 31500, 'GHS 300 of tickets: the customer pays the whole 5%');
  assert.equal(init.transaction_charge, 1500 + shares.evolveitSharePesewas, 'the charge plus EvolveIT’s ticket share stay with EvolveIT');
  assert.ok(shares.evolveitSharePesewas > 0);
});
