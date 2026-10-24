// The capped service charge, Paystack's fees, the developer commission and the night's finances.
//   Service charge = min(product subtotal × rate, cap), once per bill: 5%, at most GHS 100.
//   Paystack's fee: Paystack's own figure per payment (pending until it gives one), never guessed.
//   Developer commission: off until configured; recorded as payable on eligible successful payments.
//   Club-borne cost = max(0, Paystack fee + commission − service charge).
//   Expected settlement = collected through Paystack − Paystack fees − refunds paid back.
// Cash isn't charged and has no Paystack fee. The service charge is never product sales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { serviceChargeOf, commissionOf, DEFAULT_SERVICE_CHARGE, DEFAULT_COMMISSION } from '../src/lib/fee.js';

const STATION = 'a'.repeat(32);
const FUTURE = '2099-06-05T22:00:00.000Z';
const GHS = n => Math.round(n * 100);
let ip = 0;
function setup({ charge = { enabled: true, percent: 5, capPesewas: GHS(100) }, commission } = {}) {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('settings', 'commercial', { serviceCharge: charge, ...(commission ? { commission: { ...DEFAULT_COMMISSION, ...commission } } : {}) });
  store.seed('events', 'night1', { name: 'Afrobeats Friday', date: FUTURE, visibility: 'public', active: true });
  store.seed('ticket_types', 'std', { eventId: 'night1', name: 'Standard', pricePesewas: GHS(150), admits: 1, remaining: 200, active: true });
  store.seed('table_packages', 'vip', { eventId: 'night1', name: 'VIP table', pricePesewas: GHS(3000), remaining: 5, active: true });
  store.seed('table_packages', 'big', { eventId: 'night1', name: 'Owner’s table', pricePesewas: GHS(10000), remaining: 5, active: true });
  const tonight = new Date().toISOString();
  store.seed('events', 'ev1', { name: 'Tonight', date: tonight, active: true, visibility: 'public' });
  store.seed('ticket_types', 'reg', { eventId: 'ev1', name: 'Regular', pricePesewas: GHS(80), doorPricePesewas: GHS(100), admits: 1, remaining: 50, active: true });
  store.seed('bar_stations', 'main', { name: 'Main bar', token: STATION, open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: GHS(25), costPesewas: GHS(12), available: true, tracked: true });
  store.seed('stock_moves', 'seed', { productId: 'beer', stationId: 'main', qty: 1000, kind: 'received', businessDate: '2000-01-01' });
  const people = { m1: ['Akos Manager', 'manager'], w1: ['Efua Mensah', 'waitStaff'], b1: ['Ama Boateng', 'barStaff'], c1: ['Yaw Cashier', 'cashier'], door: ['Kofi Door', 'doorStaff'], f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'], sa: ['Sys Admin', 'superAdmin'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400007${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'CF-Connecting-IP': `10.93.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1], ...(who === 'sa' ? { admin: true } : {}) }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, env, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const buyer = { eventId: 'night1', ticketTypeId: 'std', quantity: 2, buyerName: 'Kofi Boateng', buyerPhone: '024 123 4567' };
const ledger = store => store.list('payment_ledger').map(d => d.fields);
const table = (pkg, phone = '0241234567') => ({ eventId: 'night1', packageId: pkg, name: 'Ama', phone });
const paid = (store, ref, amount, extra = {}) => store.setPaystack(ref, { status: 'success', currency: 'GHS', amount, channel: 'mobile_money', fees: undefined, ...extra });

// ── The customer charge ──
test('service charge: 5% of the bill, once per bill, capped at GHS 100; off is zero', () => {
  const sc = DEFAULT_SERVICE_CHARGE;
  for (const [bill, charge] of [[200, 10], [500, 25], [1000, 50], [2000, 100], [3000, 100], [5000, 100], [10000, 100]]) assert.equal(serviceChargeOf(GHS(bill), sc), GHS(charge), `GHS ${bill} → GHS ${charge}`);
  assert.equal(serviceChargeOf(GHS(10000), sc), GHS(100), 'GHS 10,000 is GHS 100, not GHS 500');
  assert.equal(serviceChargeOf(GHS(10000), { ...sc, enabled: false }), 0);
  assert.equal(serviceChargeOf(-500, sc), 0, 'never negative');
  assert.equal(serviceChargeOf(GHS(10000), { ...sc, capPesewas: GHS(250) }), GHS(250), 'the cap is configurable');
});

test('checkout: the charge is on the bill (after the discount), capped; Paystack is asked for exactly what the customer was shown', async () => {
  const { store, call } = setup();
  const t = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'tickets');
  assert.deepEqual([t.amountPesewas, t.feePesewas, t.chargePesewas, store.paystackInits.at(-1).amount], [GHS(300), GHS(15), GHS(315), GHS(315)]);
  const big = ok(await call('POST', '/api/table-checkout/initiate', { body: table('big') }), 'GHS 10,000 table');
  assert.deepEqual([big.amountPesewas, big.feePesewas, big.chargePesewas], [GHS(10000), GHS(100), GHS(10100)], 'GHS 10,000 + GHS 100 = GHS 10,100');
  const pc = store.get('pending_checkouts', big.reference).fields;
  assert.deepEqual([pc.feePercent, pc.feeCapPesewas], [5, GHS(100)], 'the rule is kept with the checkout');
  const pub = ok(await call('GET', '/api/settings'), 'public').settings;
  assert.deepEqual(pub.serviceCharge, { enabled: true, percent: 5, capPesewas: GHS(100) }, 'the pages show the same rule');
  assert.equal(pub.commission, undefined, 'the commission is never public');
});

test('pay in bits: the charge is on what is paid now; the plan owes only the ticket price', async () => {
  const { store, call } = setup();
  const b = ok(await call('POST', '/api/installments/start', { body: { ...buyer, quantity: 1, depositPesewas: GHS(50), acknowledged: true } }), 'bits');
  assert.deepEqual([b.feePesewas, store.paystackInits.at(-1).amount], [GHS(2.5), GHS(52.5)]);
  paid(store, b.reference, GHS(52.5));
  ok(await call('POST', '/api/checkout/verify', { body: { reference: b.reference } }), 'verify');
  const plan = store.get('installment_plans', b.planId).fields;
  assert.deepEqual([plan.paidPesewas, plan.totalPesewas], [GHS(50), GHS(150)]);
});

// ── The ledger: Paystack's fee, the commission, what the club bears ──
test('a GHS 10,000 table: GHS 100 charge, Paystack’s actual fee, 2% commission; the club bears the shortfall', async () => {
  const { store, call } = setup({ commission: { enabled: true, type: 'percent', percent: 2, basis: 'product' } });
  const s = ok(await call('POST', '/api/table-checkout/initiate', { body: table('big') }), 'table');
  paid(store, s.reference, GHS(10100), { fees: GHS(196.95), channel: 'card' });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: s.reference } }), 'verify');
  const [r] = ledger(store);
  assert.deepEqual([r.productPesewas, r.serviceChargePesewas, r.collectedPesewas, r.channel], [GHS(10000), GHS(100), GHS(10100), 'card']);
  assert.deepEqual([r.processingFeePesewas, r.feeStatus], [GHS(196.95), 'actual'], 'Paystack’s own fee');
  assert.deepEqual([r.commission.amountPesewas, r.commission.status, r.commission.rule.percent], [GHS(200), 'payable', 2]);
  assert.equal(r.clubBorneCostPesewas, GHS(196.95) + GHS(200) - GHS(100), 'fee + commission − charge');
  assert.equal(r.expectedNetPesewas, GHS(10100) - GHS(196.95), 'Paystack deducts its fee, not the commission');
  const order = store.list('orders').map(o => o.fields).find(o => o.reference === s.reference);
  assert.equal(order.amountPesewas, GHS(10000), 'product money is the price; the charge is apart');
});

test('a repeated Paystack notice, a retry and the payment check never make a second record or commission', async () => {
  const { store, env, call } = setup({ commission: { enabled: true, type: 'fixed', fixedPesewas: GHS(1) } });
  const s = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'tickets');
  paid(store, s.reference, GHS(315), { fees: GHS(6) });
  for (let i = 0; i < 3; i++) ok(await call('POST', '/api/checkout/verify', { body: { reference: s.reference } }), 'verify');
  const { recordPayment } = await import('../src/ops/ledger.js');
  await recordPayment(env, s.reference, store.get('pending_checkouts', s.reference).fields, { status: 'success', amount: GHS(315), fees: GHS(6), currency: 'GHS' });
  assert.equal(ledger(store).length, 1);
  assert.equal(ledger(store)[0].commission.amountPesewas, GHS(1));
  assert.equal(store.list('tickets').length, 2, 'issued once');
});

test('failed, abandoned and short payments make no record and earn no commission', async () => {
  const { store, call } = setup({ commission: { enabled: true, type: 'percent', percent: 2 } });
  const a = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'a');
  store.setPaystack(a.reference, { status: 'failed' });
  await call('POST', '/api/checkout/verify', { body: { reference: a.reference } });
  const b = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'b');
  store.setPaystack(b.reference, { status: 'abandoned' });
  await call('POST', '/api/checkout/verify', { body: { reference: b.reference } });
  const c = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'c');
  paid(store, c.reference, GHS(300)); // without the service charge
  assert.equal(ok(await call('POST', '/api/checkout/verify', { body: { reference: c.reference } }), 'short').status, 'failed');
  assert.equal(ledger(store).length, 0);
});

test('Paystack’s fee not given yet: pending, left out of totals and labelled; filled in later, once', async () => {
  const { store, env, call } = setup();
  const s = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'tickets');
  paid(store, s.reference, GHS(315));
  ok(await call('POST', '/api/checkout/verify', { body: { reference: s.reference } }), 'verify');
  assert.deepEqual([ledger(store)[0].feeStatus, ledger(store)[0].processingFeePesewas], ['pending', null]);
  let n = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'report');
  assert.deepEqual([n.payments.processingFeesPesewas, n.payments.processingFeesPending], [0, 1]);
  const { refreshPendingFees } = await import('../src/ops/ledger.js');
  assert.equal(await refreshPendingFees(env, async () => ({ status: 'success', fees: GHS(6.14) })), 1);
  assert.deepEqual([ledger(store)[0].feeStatus, ledger(store)[0].processingFeePesewas], ['actual', GHS(6.14)]);
  n = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'report');
  assert.deepEqual([n.payments.processingFeesPesewas, n.payments.processingFeesPending, n.payments.expectedSettlementPesewas], [GHS(6.14), 0, GHS(315) - GHS(6.14)]);
});

test('settings changes never rewrite past payments; new payments use the new rule', async () => {
  const { store, call } = setup({ commission: { enabled: true, type: 'percent', percent: 2 } });
  const s = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'before');
  paid(store, s.reference, GHS(315), { fees: GHS(6) });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: s.reference } }), 'verify');
  const before = JSON.stringify(ledger(store)[0]);
  ok(await call('POST', '/api/ops/commercial', { who: 'd1', body: { serviceCharge: { percent: 10, capPesewas: GHS(20) }, commission: { percent: 5 } } }), 'change');
  assert.equal(JSON.stringify(ledger(store)[0]), before, 'the past payment is unchanged');
  assert.deepEqual([store.get('pending_checkouts', s.reference).fields.feePercent], [5]);
  const t = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'after');
  assert.equal(t.feePesewas, GHS(20), '10% of GHS 300 = GHS 30, capped at GHS 20');
});

test('only a director or the admin changes the commercial settings; bad values are refused; every change is logged', async () => {
  const { store, call } = setup();
  for (const who of ['c1', 'w1', 'm1', 'f1', 'door']) assert.equal((await call('POST', '/api/ops/commercial', { who, body: { serviceCharge: { percent: 1 } } })).status, 403, `${who} can’t`);
  assert.equal((await call('GET', '/api/ops/commercial', { who: 'c1' })).status, 403, 'a cashier can’t even look');
  assert.equal(ok(await call('GET', '/api/ops/commercial', { who: 'f1' }), 'finance looks').canEdit, false);
  for (const bad of [{ serviceCharge: { percent: -1 } }, { serviceCharge: { percent: 50 } }, { serviceCharge: { capPesewas: -100 } }, { commission: { percent: -2 } }, { commission: { type: 'weird' } }, { commission: { enabled: true, percent: 0 } }, { commission: { settlement: 'split' } }])
    assert.equal((await call('POST', '/api/ops/commercial', { who: 'd1', body: bad })).status, 400, JSON.stringify(bad));
  const r = ok(await call('POST', '/api/ops/commercial', { who: 'sa', body: { serviceCharge: { enabled: false } } }), 'admin turns it off');
  assert.equal(r.serviceCharge.enabled, false);
  assert.equal(ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'off').feePesewas, 0, 'off: no charge');
  assert.ok(store.list('change_log').some(c => c.fields.kind === 'commercial' && c.fields.byName === 'Sys Admin'));
  assert.equal(store.get('settings', 'commercial').fields.updatedByName, 'Sys Admin');
});

// ── Drinks, cash, refunds and the night's report ──
test('the night’s finances: product sales without the charge; cash without Paystack fees; refunds reverse the commission; settlement only once Paystack says so', async () => {
  const { store, call } = setup({ commission: { enabled: true, type: 'percent', percent: 2, basis: 'product' } });
  // A tab paid in cash (no Paystack, no fee, no charge).
  const tab = ok(await call('POST', '/api/ops/tabs/open', { who: 'w1', body: { table: '4' } }), 'tab');
  const round = ok(await call('POST', '/api/ops/tabs/round', { who: 'w1', body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 4 }] } }), 'round');
  ok(await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: round.id, action: 'hand' } }), 'handed');
  ok(await call('POST', '/api/ops/tabs/round-action', { who: 'w1', body: { roundId: round.id, action: 'received' } }), 'received');
  ok(await call('POST', '/api/ops/tabs/round-action', { who: 'w1', body: { roundId: round.id, action: 'delivered' } }), 'delivered');
  ok(await call('POST', '/api/ops/tabs/checkout', { who: 'w1', body: { tabId: tab.id, method: 'cash' } }), 'cash');
  // A QR order paid by MoMo (GHS 100 + GHS 5), then the bar can't make it: refunded.
  const o = ok(await call('POST', '/api/guest/counter/checkout', { body: { station: STATION, items: [{ itemId: 'beer', qty: 4 }], phone: '024 123 4567', clientId: 'a1b2c3d4-0000-4000-8000-0000000000f1' } }), 'qr');
  const qref = store.list('pending_checkouts').map(d => d.fields).find(f => f.kind === 'counter').reference;
  paid(store, qref, GHS(105), { fees: GHS(2.05) });
  assert.equal(ok(await call('GET', `/api/guest/counter/${o.orderId}`), 'poll').status, 'paid');
  // A table online (GHS 3,000 + GHS 100 capped charge).
  const t = ok(await call('POST', '/api/table-checkout/initiate', { body: table('vip') }), 'table');
  paid(store, t.reference, GHS(3100), { fees: GHS(60.45), channel: 'card' });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: t.reference } }), 'verify');

  let n = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'report');
  assert.equal(n.sales.grossProductPesewas, GHS(100) + GHS(100) + GHS(3000), 'tab + QR + table, no service charge in it');
  assert.equal(n.sales.serviceChargesPesewas, GHS(5) + GHS(100));
  assert.equal(n.sales.netProductPesewas, GHS(3200));
  const ch = Object.fromEntries(n.payments.byChannel.map(x => [x.key, x.amountPesewas]));
  assert.deepEqual([ch.cash, ch.mobile_money, ch.card], [GHS(100), GHS(105), GHS(3100)]);
  assert.equal(n.payments.processingFeesPesewas, GHS(2.05) + GHS(60.45), 'no Paystack fee on cash');
  assert.equal(n.payments.commission.payablePesewas, GHS(2) + GHS(60));
  assert.equal(n.payments.expectedSettlementPesewas, GHS(105) + GHS(3100) - GHS(62.5));
  assert.deepEqual([n.payments.settledPesewas, n.payments.unsettledPayments], [0, 2], 'not received until Paystack settles');
  assert.ok(n.transactions.some(x => x.channel === 'cash' && x.collectedPesewas === GHS(100) && x.processingFeePesewas == null));

  // The bar can't make the QR order: refund owed, commission reversed; then refunded.
  ok(await call('POST', '/api/bar/order', { who: 'm1', body: { orderId: o.orderId, action: 'refund', reason: 'bottle broke' } }), 'refund owed');
  let q = ledger(store).find(r => r.reference === qref);
  assert.deepEqual([q.refund.status, q.commission.status], ['pending', 'reversed']);
  ok(await call('POST', '/api/admin/refunds/mark', { who: 'sa', body: { source: 'counter', id: o.orderId, note: 'Paystack refund 123' } }), 'mark refunded');
  q = ledger(store).find(r => r.reference === qref);
  n = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'after the refund');
  assert.equal(n.sales.productRefundsPesewas, GHS(100));
  assert.equal(n.sales.netProductPesewas, GHS(3100));
  assert.equal(n.payments.commission.payablePesewas, GHS(60), 'the refunded payment earns no commission');
  assert.equal(q.refund.status, 'refunded');
  assert.equal(n.payments.expectedSettlementPesewas, GHS(3205) - GHS(62.5) - GHS(105), 'a refund paid back comes off once');

  // Paystack settles the table.
  store.paystackSettlements = [{ id: 77, status: 'success', total_amount: GHS(3100), effective_amount: GHS(3039.55), total_fees: GHS(60.45), settlement_date: new Date().toISOString(), transactions: [{ reference: t.reference, amount: GHS(3100), fees: GHS(60.45) }] }];
  assert.equal((await call('POST', '/api/ops/settlements/sync', { who: 'w1', body: {} })).status, 403);
  assert.equal(ok(await call('POST', '/api/ops/settlements/sync', { who: 'f1', body: {} }), 'sync').matched, 1);
  n = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'settled');
  assert.equal(n.payments.settledPesewas, GHS(3100) - GHS(60.45));
  // Finance records what reached the club; a director marks the commission paid.
  assert.match((await call('POST', '/api/ops/night-received', { who: 'f1', body: { amountPesewas: GHS(3000) } })).data.error, /where it came from/);
  ok(await call('POST', '/api/ops/night-received', { who: 'f1', body: { amountPesewas: GHS(3039.55), note: 'bank ref 9' } }), 'received');
  assert.equal((await call('POST', '/api/ops/commission/paid', { who: 'f1', body: { note: 'x' } })).status, 403, 'finance doesn’t mark the developers paid');
  ok(await call('POST', '/api/ops/commission/paid', { who: 'd1', body: { note: 'transfer 55' } }), 'paid');
  n = ok(await call('GET', '/api/ops/finance-night', { who: 'd1' }), 'final');
  assert.deepEqual([n.payments.commission.payablePesewas, n.payments.commission.paidPesewas, n.payments.receivedByClub.amountPesewas], [0, GHS(60), GHS(3039.55)]);
  const cash = ok(await call('GET', '/api/ops/finance-night?channel=cash', { who: 'f1' }), 'cash only');
  assert.ok(cash.transactions.every(x => x.channel === 'cash') && cash.payments.processingFeesPesewas === 0);
  assert.equal((await call('GET', '/api/ops/finance-night', { who: 'm1' })).status, 403);
});

test('drinks and the gate: the bill link adds the capped charge on the bill (not the tip), the bill gets the bill amount; the gate’s MoMo adds it, cash doesn’t', async () => {
  const { store, call } = setup();
  const tab = ok(await call('POST', '/api/ops/tabs/open', { who: 'w1', body: { table: '9' } }), 'tab');
  ok(await call('POST', '/api/ops/tabs/round', { who: 'w1', body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'round');
  const token = new URL(ok(await call('GET', `/api/ops/tab?id=${tab.id}`, { who: 'w1' }), 'tab').tab.billUrl).searchParams.get('t');
  const pay = ok(await call('POST', `/api/guest/bill/${token}/pay`, { body: { tipPesewas: GHS(10), tipToUid: 'w1' } }), 'pay');
  assert.equal(store.paystackInits.at(-1).amount, GHS(50) + GHS(10) + GHS(2.5));
  paid(store, pay.reference, GHS(62.5), { fees: GHS(1.22) });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify');
  const bill = ok(await call('GET', `/api/guest/bill/${token}`), 'after').bill;
  assert.deepEqual([bill.paidPesewas, bill.balancePesewas], [GHS(50), 0]);
  const [r] = ledger(store);
  assert.deepEqual([r.productPesewas, r.tipPesewas, r.serviceChargePesewas, r.collectedPesewas], [GHS(50), GHS(10), GHS(2.5), GHS(62.5)]);
  const gate = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 1, phone: '0245551234', method: 'momo' } }), 'gate');
  assert.match(gate.message, /GHS 105 \(GHS 100 \+ GHS 5 service charge\)/);
  const cashGate = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 1, phone: '0245551235', method: 'cash' } }), 'cash');
  assert.equal(cashGate.amountPesewas, GHS(100), 'cash: no charge');
});

test('pricing simulation: capped charge per bill; Paystack fee from actual payments when there are any, else the estimate; no price changes', async () => {
  const { store, call } = setup({ commission: { enabled: true, type: 'percent', percent: 2 } });
  assert.equal((await call('POST', '/api/ops/pricing-sim', { who: 'w1', body: {} })).status, 403);
  let s = ok(await call('POST', '/api/ops/pricing-sim', { who: 'f1', body: { bills: [GHS(200), GHS(10000)] } }), 'no data');
  assert.equal(s.feeRatePercent, null, 'unknown, not guessed');
  assert.equal(s.rows[1].feePesewas, null);
  s = ok(await call('POST', '/api/ops/pricing-sim', { who: 'f1', body: { bills: [GHS(200), GHS(10000)], estimatePercent: 2, priceChangePercent: 10 } }), 'estimate');
  assert.match(s.feeSource, /estimate/);
  assert.deepEqual([s.rows[1].serviceChargePesewas, s.rows[1].totalPesewas, s.rows[1].feePesewas, s.rows[1].commissionPesewas], [GHS(100), GHS(10100), GHS(202), GHS(200)]);
  assert.equal(s.rows[1].clubBornePesewas, GHS(202) + GHS(200) - GHS(100));
  assert.equal(s.rows[0].clubBornePesewas, Math.max(0, GHS(4.2) + GHS(4) - GHS(10)), 'a small bill: the charge covers it');
  assert.equal(s.drinks[0].proposedPricePesewas, GHS(27.5), 'a draft price');
  assert.equal(store.get('menu_items', 'beer').fields.pricePesewas, GHS(25), 'nothing changed');
  const t = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'a real payment');
  paid(store, t.reference, GHS(315), { fees: GHS(6.3) });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: t.reference } }), 'verify');
  s = ok(await call('POST', '/api/ops/pricing-sim', { who: 'd1', body: { estimatePercent: 9 } }), 'actual');
  assert.match(s.feeSource, /actual/); assert.equal(s.feeRatePercent, 2);
});

test('commission rules: off by default; eligible kinds and channels; fixed or percentage on the chosen basis', () => {
  const base = { kind: 'tab', channel: 'mobile_money', productPesewas: GHS(1000), serviceChargePesewas: GHS(50) };
  assert.equal(commissionOf(DEFAULT_COMMISSION, base).amountPesewas, 0, 'no rate built in');
  const on = { ...DEFAULT_COMMISSION, enabled: true, percent: 2 };
  assert.equal(commissionOf(on, base).amountPesewas, GHS(20));
  assert.equal(commissionOf({ ...on, basis: 'collected' }, base).amountPesewas, GHS(21));
  assert.equal(commissionOf({ ...on, basis: 'service_charge' }, base).amountPesewas, GHS(1));
  assert.equal(commissionOf({ ...on, type: 'fixed', fixedPesewas: GHS(3) }, base).amountPesewas, GHS(3));
  assert.equal(commissionOf({ ...on, kinds: ['ticket'] }, base).eligible, false);
  assert.equal(commissionOf({ ...on, channels: ['card'] }, base).eligible, false);
});
