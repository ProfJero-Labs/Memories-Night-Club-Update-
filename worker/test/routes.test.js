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
  assert.equal(DEFAULT_ROUTES.enabled, true, 'on by default: the owner’s rules');
  assert.equal(DEFAULT_ROUTES.paystackSubaccount, 'ACCT_89qd3ub03w61erk');
  const n = cleanRoutes({ percent: 4, paystackUpToPesewas: 300000, bigFlatPesewas: 15000, enabled: true, paystackSubaccount: 'ACCT_test123456' });
  assert.deepEqual([n.percent, n.paystackUpToPesewas, n.bigFlatPesewas, n.enabled], [4, 300000, 15000, true]);
  assert.equal(routeFor(250000, n).band, 'middle', 'a raised limit moves GHS 2,500 onto Paystack');
  assert.match(cleanRoutes({ percent: 50 }).error, /percentage/);
  assert.match(cleanRoutes({ bigFlatPesewas: -1 }).error, /0 or more/);
  assert.match(cleanRoutes({ customerOnlyUpToPesewas: 300000, paystackUpToPesewas: 200000 }).error, /at or below/);
});

import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
test('the rules are settings: only the admin changes them; directors and finance can look; changes are logged', async () => {
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
  assert.equal((await call('POST', '/api/ops/commercial', 'director', { routes: { percent: 4 } })).status, 403, 'a director can look, not change');
  const dl = await call('GET', '/api/ops/commercial', 'director');
  assert.deepEqual([dl.status, dl.data.canEdit], [200, false]);
  assert.match((await call('POST', '/api/ops/commercial', 'superAdmin', { routes: { percent: 99 } })).data.error, /percentage/);
  const saved = await call('POST', '/api/ops/commercial', 'superAdmin', { routes: { bigFlatPesewas: 12000 } });
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
  store.seed('settings', 'commercial', { serviceCharge: { enabled: true, percent: 5, capPesewas: 10000 }, routes: { ...DEFAULT_ROUTES, enabled: on, paystackSubaccount: 'ACCT_89qd3ub03w61erk', adminSet: true } });
  store.seed('users', 'sa', { name: 'Sys Admin', role: 'superAdmin', phone: '0240003333' });
  store.seed('users', 'm1', { name: 'Akos Manager', role: 'manager', phone: '0240001111' });
  store.seed('users', 'd1', { name: 'Nana Director', role: 'director', phone: '0240002222' });
  let ip = 0;
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.56.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who }, { uid: { manager: 'm1', superAdmin: 'sa' }[who] || 'd1' })}`;
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
  assert.match(r.data.error, /above GHS 2,000.*Pay cash/);
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

// ── Step 3: big bills by MoMo to the partner's wallet ──
async function bigTab(ctx, qty = 2) {
  const t = (await ctx.call('POST', '/api/ops/tabs/open', { who: 'manager', body: { table: 'VIP 1' } })).data;
  const r = (await ctx.call('POST', '/api/ops/tabs/round', { who: 'manager', body: { tabId: t.id, lines: [{ productId: 'royal', qty }] } })).data;
  ctx.store.seed('rounds', r.roundId || r.id, { ...ctx.store.get('rounds', r.roundId || r.id).fields, status: 'handed' });
  return t;
}
test('a GHS 3,000 bill: MoMo to the wallet; it waits until a manager confirms; a short amount isn’t accepted; the GHS 100 is owed to EvolveIT', async () => {
  const ctx = setupLive();
  const t = await bigTab(ctx);
  assert.match((await ctx.call('POST', '/api/ops/tabs/checkout', { who: 'manager', body: { tabId: t.id, method: 'momo', phone: '0244445555' } })).data.error, /above GHS 2,000/, 'no Paystack prompt');
  const s = (await ctx.call('POST', '/api/ops/tabs/checkout', { who: 'manager', body: { tabId: t.id, method: 'wallet', phone: '0244445555' } })).data;
  assert.equal(s.method, 'wallet');
  assert.deepEqual([s.wallet.duePesewas, s.wallet.chargePesewas, s.wallet.wallet.number, s.wallet.wallet.name], [310000, 10000, '0595986313', 'Samuel Forson / Memories Night Club']);
  assert.match(ctx.store.sms.at(-1).message, /send GHS 3,100 by MoMo to 0595986313 \(Samuel Forson \/ Memories Night Club\)[\s\S]*Reference: [A-Z0-9]{4}/);
  assert.equal(ctx.store.get('tabs', t.id).fields.status, 'open', 'not closed on a promise');
  const list = (await ctx.call('GET', '/api/ops/wallet', { who: 'manager' })).data;
  assert.equal(list.waiting.length, 1);
  const wid = list.waiting[0].id;
  const short = (await ctx.call('POST', '/api/ops/wallet/confirm', { who: 'manager', body: { id: wid, receivedPesewas: 300000, momoRef: 'MP111222333' } })).data;
  assert.deepEqual([short.code, short.shortPesewas], ['short', 10000]);
  const ok3 = (await ctx.call('POST', '/api/ops/wallet/confirm', { who: 'manager', body: { id: wid, receivedPesewas: 310000, momoRef: 'MP111222333' } })).data;
  assert.deepEqual([ok3.confirmed, ok3.billPesewas, ok3.chargePesewas, ok3.tabClosed], [true, 300000, 10000, true]);
  const tab = ctx.store.get('tabs', t.id).fields;
  assert.deepEqual([tab.status, tab.payments[0].method, tab.payments[0].viaWallet, tab.payments[0].amountPesewas], ['closed', 'momo', true, 300000]);
  const owed = ctx.store.list('evolveit_charges').map(d => d.fields);
  assert.deepEqual(owed.map(r => [r.amountPesewas, r.status, r.source]), [[10000, 'unsettled', 'wallet']]);
  // The same transaction ID can't be used again.
  const t2 = await bigTab(ctx);
  await ctx.call('POST', '/api/ops/tabs/checkout', { who: 'manager', body: { tabId: t2.id, method: 'wallet' } });
  const w2 = (await ctx.call('GET', '/api/ops/wallet', { who: 'manager' })).data.waiting[0];
  assert.match((await ctx.call('POST', '/api/ops/wallet/confirm', { who: 'manager', body: { id: w2.id, receivedPesewas: 310000, momoRef: 'MP111222333' } })).data.error, /already used/);
  // Sales: counted as MoMo, the bill’s part only.
  const sales = (await ctx.call('GET', '/api/ops/sales', { who: 'manager' })).data;
  assert.equal(sales.totals.momoPesewas, 300000);
});

test('the wallet is only for big bills, unless the admin says Paystack is down tonight (then the normal Paystack price)', async () => {
  const ctx = setupLive();
  const t = (await ctx.call('POST', '/api/ops/tabs/open', { who: 'manager', body: { table: '2' } })).data;
  const r = (await ctx.call('POST', '/api/ops/tabs/round', { who: 'manager', body: { tabId: t.id, lines: [{ productId: 'magnum', qty: 1 }] } })).data;
  ctx.store.seed('rounds', r.roundId || r.id, { ...ctx.store.get('rounds', r.roundId || r.id).fields, status: 'handed' });
  assert.match((await ctx.call('POST', '/api/ops/tabs/checkout', { who: 'manager', body: { tabId: t.id, method: 'wallet' } })).data.error, /for bills above GHS 2,000/);
  assert.equal((await ctx.call('POST', '/api/ops/paystack-down', { who: 'manager', body: { on: true } })).status, 403, 'the admin only');
  assert.equal((await ctx.call('POST', '/api/ops/paystack-down', { who: 'director', body: { on: true } })).status, 403, 'not a director: a technical switch');
  assert.ok((await ctx.call('POST', '/api/ops/paystack-down', { who: 'superAdmin', body: { on: true } })).data.paystackDown);
  const s = (await ctx.call('POST', '/api/ops/tabs/checkout', { who: 'manager', body: { tabId: t.id, method: 'wallet' } })).data;
  assert.deepEqual([s.wallet.reason, s.wallet.duePesewas, s.wallet.chargePesewas], ['paystack_down', 102500, 2500], 'GHS 1,000 bill: the customer’s usual 25');
});

test('with the new rules on, staff can’t record “MoMo to the club’s number” any more', async () => {
  const ctx = setupLive();
  const t = (await ctx.call('POST', '/api/ops/tabs/open', { who: 'manager', body: { table: '3' } })).data;
  const r = (await ctx.call('POST', '/api/ops/tabs/round', { who: 'manager', body: { tabId: t.id, lines: [{ productId: 'beer', qty: 1 }] } })).data;
  ctx.store.seed('rounds', r.roundId || r.id, { ...ctx.store.get('rounds', r.roundId || r.id).fields, status: 'handed' });
  assert.equal((await ctx.call('POST', '/api/ops/tabs/pay', { who: 'manager', body: { tabId: t.id, method: 'momo', amountPesewas: 2500, momoRef: 'MP999888777' } })).data.code, 'momo_direct_off');
  assert.equal((await ctx.call('POST', '/api/ops/tabs/checkout', { who: 'manager', body: { tabId: t.id, method: 'momo_club', momoRef: 'MP999888777' } })).data.code, 'momo_direct_off');
  assert.equal((await ctx.call('POST', '/api/ops/quick-sale', { who: 'manager', body: { lines: [{ productId: 'beer', qty: 1 }], method: 'momo', momoRef: 'MP999888776' } })).data.code, 'momo_direct_off');
  assert.equal((await ctx.call('POST', '/api/ops/tabs/pay', { who: 'manager', body: { tabId: t.id, method: 'cash', amountPesewas: 2500 } })).status, 200, 'cash still fine');
});

test('big bills, customer side: the bill link and the QR menu offer only cash or MoMo to the wallet; a manager confirms', async () => {
  const ctx = setupLive();
  // The bill link of a GHS 3,000 table
  const t = await bigTab(ctx);
  const token = ctx.store.get('tabs', t.id).fields.billToken;
  const w = (await ctx.call('POST', `/api/guest/bill/${token}/wallet`, { body: { phone: '0247770000' } })).data.wallet;
  assert.deepEqual([w.duePesewas, w.number], [310000, '0595986313']);
  assert.equal((await ctx.call('GET', `/api/guest/bill/${token}`)).data.walletWait.code, w.code, 'the bill page shows what to send');
  // A GHS 3,000 QR order
  const o = (await ctx.qr([{ itemId: 'royal', qty: 2 }]).then(r => r)).data;
  assert.match(o.error, /Pay cash/, 'no Paystack');
  const ow = (await ctx.call('POST', '/api/guest/counter/checkout', { body: { station: 'b'.repeat(32), phone: '0241234567', payWith: 'wallet', items: [{ itemId: 'royal', qty: 2 }] } })).data;
  assert.equal(ow.wallet.duePesewas, 310000);
  assert.equal((await ctx.call('GET', `/api/guest/counter/${ow.orderId}`)).data.status, 'wallet_due');
  const list = (await ctx.call('GET', '/api/ops/wallet', { who: 'manager' })).data.waiting;
  assert.equal(list.length, 2);
  const qrW = list.find(x => x.orderId === ow.orderId);
  ok3(await ctx.call('POST', '/api/ops/wallet/confirm', { who: 'manager', body: { id: qrW.id, receivedPesewas: 310000, momoRef: 'MP555444333' } }));
  const after = (await ctx.call('GET', `/api/guest/counter/${ow.orderId}`)).data;
  assert.equal(after.status, 'paid', 'now the bar hands it over like any paid QR order');
  const sales = (await ctx.call('GET', '/api/ops/sales', { who: 'manager' })).data;
  assert.deepEqual([sales.totals.momoPesewas, sales.totals.digitalPesewas], [300000, 0], 'counted as MoMo, not Paystack');
});
const ok3 = r => { assert.equal(r.status, 200, r.data.error); return r.data; };

test('what is due to EvolveIT: the directors only; a director ticks off what the partner paid', async () => {
  const ctx = setupLive();
  ctx.store.seed('evolveit_charges', 'c1', { businessDate: '2026-10-01', amountPesewas: 10000, status: 'unsettled', createdAt: '2026-10-01T22:00:00Z' });
  ctx.store.seed('evolveit_charges', 'c2', { businessDate: '2026-10-30', amountPesewas: 10000, status: 'unsettled', createdAt: '2026-10-30T22:00:00Z' });
  assert.equal((await ctx.call('GET', '/api/ops/evolveit', { who: 'manager' })).status, 403, 'not the Manager');
  const d = ok3(await ctx.call('GET', '/api/ops/evolveit', { who: 'director' }));
  assert.deepEqual([d.totals.outstandingPesewas, d.byDay.find(x => x.date === '2026-10-01').overdue], [20000, true], 'over 10 days: flagged');
  assert.equal((await ctx.call('POST', '/api/ops/evolveit/paid', { who: 'manager', body: { amountPesewas: 10000, momoRef: 'MP1234567' } })).status, 403);
  const p = ok3(await ctx.call('POST', '/api/ops/evolveit/paid', { who: 'director', body: { amountPesewas: 15000, momoRef: 'MP1234567' } }));
  assert.deepEqual([p.rows, p.differencePesewas], [1, 5000], 'the oldest charge settled; 50 doesn’t match whole charges and is flagged');
  assert.equal(ok3(await ctx.call('GET', '/api/ops/evolveit', { who: 'director' })).totals.outstandingPesewas, 10000);
  // Finance sees the rules but not what EvolveIT earns.
  const look = (await ctx.call('GET', '/api/ops/commercial', { who: 'manager' }));
  assert.equal(look.status, 403);
});

test('a QR customer paying cash at a table: the waitress takes it; it’s in her cash and goes to the bar as her order', async () => {
  const ctx = setupLive();
  ctx.store.seed('users', 'w5', { name: 'Efua Waitress', role: 'waitStaff', phone: '0240005555' });
  const o = (await ctx.call('POST', '/api/guest/counter/checkout', { body: { station: 'b'.repeat(32), phone: '0241239999', spot: '7', payWith: 'cash', items: [{ itemId: 'magnum', qty: 1 }] } })).data;
  assert.ok(o.pickupCode);
  const { idToken: tok } = await import('./mock-firestore.js');
  const as = async (method, path, body) => {
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.77.0.9', Authorization: `Bearer ${await tok({ role: 'waitStaff' }, { uid: 'w5' })}` }, body: body ? JSON.stringify(body) : undefined }), ctx.env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  assert.equal((await as('GET', '/api/bar/queue')).data.cashDue.length, 1, 'she sees it');
  const r = (await as('POST', '/api/bar/order', { orderId: o.orderId, action: 'cash' })).data;
  assert.deepEqual([r.status, r.atTable], ['cash_paid', true]);
  const mine = (await as('GET', '/api/ops/my-report')).data.figures;
  assert.equal(mine.cashCollectedPesewas, 100000, 'in her cash for tonight');
  const round = ctx.store.list('rounds').map(d => d.fields).find(x => x.waiterUid === 'w5');
  assert.equal(round.status, 'waiting', 'the bar makes it as her order');
});

test('on by default: with nothing saved, or settings saved back when they were off, the owner’s rules apply until the admin changes them', async () => {
  for (const stored of [null, { routes: { enabled: false, paystackSubaccount: '' } }, { routes: { paystackDown: null } }]) {
    const { store, env } = createMockEnv();
    store.seed('settings', 'commercial', stored || {});
    const { commercialConfig, clearCommercialCache } = await import('../src/lib/fee.js');
    clearCommercialCache();
    const c = await commercialConfig(env);
    assert.deepEqual([c.routes.enabled, c.routes.paystackSubaccount], [true, 'ACCT_89qd3ub03w61erk'], JSON.stringify(stored));
  }
});
