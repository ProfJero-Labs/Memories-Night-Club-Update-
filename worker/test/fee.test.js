// The service fee: the customer pays it on top of every payment made through Paystack (tickets,
// tables, pay in bits, the gate's MoMo, a tab's bill link or MoMo prompt, the bar's app orders).
// Cash isn't charged. The fee never reaches the ticket's, table's or bill's money (so the night's
// accounts still balance); Paystack must confirm the whole charge; finance sees the fees apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

const STATION = 'a'.repeat(32);
const FUTURE = '2099-06-05T22:00:00.000Z';
let ip = 0;
function setup(pct = 5) {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('settings', 'site', { serviceFeePercent: pct });
  store.seed('events', 'night1', { name: 'Afrobeats Friday', date: FUTURE, visibility: 'public', active: true });
  store.seed('ticket_types', 'std', { eventId: 'night1', name: 'Standard', pricePesewas: 15000, admits: 1, remaining: 200, active: true });
  store.seed('table_packages', 'vip', { eventId: 'night1', name: 'VIP table', pricePesewas: 300000, remaining: 2, active: true });
  const tonight = new Date().toISOString();
  store.seed('events', 'ev1', { name: 'Tonight', date: tonight, active: true, visibility: 'public' });
  store.seed('ticket_types', 'reg', { eventId: 'ev1', name: 'Regular', pricePesewas: 8000, doorPricePesewas: 10000, admits: 1, remaining: 50, active: true });
  store.seed('bar_stations', 'main', { name: 'Main bar', token: STATION, open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('stock_moves', 'seed', { productId: 'beer', stationId: 'main', qty: 100, kind: 'received', businessDate: '2000-01-01' });
  const people = { m1: ['Akos Manager', 'manager'], w1: ['Efua Mensah', 'waitStaff'], b1: ['Ama Boateng', 'barStaff'], door: ['Kofi Door', 'doorStaff'], d1: ['Nana Director', 'director'], sa: ['Sys Admin', 'superAdmin'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400005${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'CF-Connecting-IP': `10.95.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1], ...(who === 'sa' ? { admin: true } : {}) }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const buyer = { eventId: 'night1', ticketTypeId: 'std', quantity: 2, buyerName: 'Kofi Boateng', buyerPhone: '024 123 4567' };

test('tickets: the customer pays 5% on top; the ticket money stays the price; Paystack must confirm the whole charge', async () => {
  const { store, call } = setup();
  const s = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'initiate');
  assert.deepEqual([s.amountPesewas, s.feePesewas, s.chargePesewas], [30000, 1500, 31500]);
  assert.equal(store.paystackInits.at(-1).amount, 31500, 'Paystack is asked for the price + 5%');
  const pc = store.get('pending_checkouts', s.reference).fields;
  assert.deepEqual([pc.amountPesewas, pc.feePesewas, pc.feePercent, pc.chargePesewas], [30000, 1500, 5, 31500]);
  // Paying only the ticket price (without the fee) is refused.
  store.setPaystack(s.reference, { status: 'success', currency: 'GHS', amount: 30000 });
  assert.equal(ok(await call('POST', '/api/checkout/verify', { body: { reference: s.reference } }), 'short').status, 'failed');
  assert.equal(store.list('tickets').length, 0);
  // The whole charge: issued, and the order carries the ticket price only.
  const s2 = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'again');
  store.setPaystack(s2.reference, { status: 'success', currency: 'GHS', amount: 31500 });
  assert.equal(ok(await call('POST', '/api/checkout/verify', { body: { reference: s2.reference } }), 'paid').status, 'issued');
  const order = store.list('orders').map(o => o.fields).find(o => o.reference === s2.reference);
  assert.equal(order.amountPesewas, 30000, 'ticket money is the price; the fee is apart');
  const over = ok(await call('GET', '/api/admin/overview', { who: 'sa' }), 'overview');
  assert.equal(over.serviceFeesPesewas, 1500, 'only the fee of the payment Paystack confirmed');
});

test('tables and pay in bits: the fee is on what is paid now; the plan owes only the ticket price', async () => {
  const { store, call } = setup();
  const t = ok(await call('POST', '/api/table-checkout/initiate', { body: { eventId: 'night1', packageId: 'vip', name: 'Ama', phone: '0241234567' } }), 'table');
  assert.deepEqual([t.amountPesewas, t.feePesewas, store.paystackInits.at(-1).amount], [300000, 15000, 315000]);
  const b = ok(await call('POST', '/api/installments/start', { body: { ...buyer, quantity: 1, depositPesewas: 5000, acknowledged: true } }), 'bits');
  assert.deepEqual([b.amountPesewas, b.feePesewas, store.paystackInits.at(-1).amount], [5000, 250, 5250]);
  store.setPaystack(b.reference, { status: 'success', currency: 'GHS', amount: 5250 });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: b.reference } }), 'verify');
  const plan = store.get('installment_plans', b.planId).fields;
  assert.deepEqual([plan.paidPesewas, plan.totalPesewas], [5000, 15000], 'the fee doesn’t count towards the ticket');
});

test('drinks: the bill link and the QR menu add 5% on the drinks (not the tip); the bill and the drinks total stay the same', async () => {
  const { store, call } = setup();
  const tab = ok(await call('POST', '/api/ops/tabs/open', { who: 'w1', body: { table: '9' } }), 'tab');
  ok(await call('POST', '/api/ops/tabs/round', { who: 'w1', body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'round');
  const token = new URL(ok(await call('GET', `/api/ops/tab?id=${tab.id}`, { who: 'w1' }), 'tab').tab.billUrl).searchParams.get('t');
  const pay = ok(await call('POST', `/api/guest/bill/${token}/pay`, { body: { tipPesewas: 1000, tipToUid: 'w1' } }), 'pay');
  assert.equal(store.paystackInits.at(-1).amount, 5000 + 1000 + 250, 'bill GHS 50 + tip GHS 10 + 5% of the bill');
  store.setPaystack(pay.reference, { status: 'success', currency: 'GHS', amount: 6250 });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify');
  const bill = ok(await call('GET', `/api/guest/bill/${token}`), 'after').bill;
  assert.deepEqual([bill.paidPesewas, bill.balancePesewas, bill.status], [5000, 0, 'paid'], 'the bill gets the bill amount, no more');
  assert.equal(store.list('tips')[0].fields.amountPesewas, 1000, 'the tip is the tip');

  const o = ok(await call('POST', '/api/guest/counter/checkout', { body: { station: STATION, items: [{ itemId: 'beer', qty: 4 }], phone: '024 123 4567', clientId: 'a1b2c3d4-0000-4000-8000-0000000000f1' } }), 'qr');
  assert.deepEqual([o.feePesewas, store.paystackInits.at(-1).amount], [500, 10500]);
  store.setPaystack(store.list('pending_checkouts').map(d => d.fields).find(f => f.kind === 'counter').reference, { status: 'success', currency: 'GHS', amount: 10500 });
  const got = ok(await call('GET', `/api/guest/counter/${o.orderId}`), 'poll');
  assert.deepEqual([got.status, got.totalPesewas], ['paid', 10000], 'the drinks total is the drinks');
  assert.match(store.sms.find(x => /MEMORIES BAR/.test(x.message)).message, /Paid GHS 105 .*incl\. GHS 5 service fee/);

  const money = ok(await call('GET', '/api/ops/money?period=today', { who: 'd1' }), 'money');
  assert.equal(money.drinks.paidPesewas, 15000, 'drinks money: GHS 50 bill + GHS 100 app order');
  assert.deepEqual([money.serviceFees.totalPesewas, money.serviceFees.payments], [750, 2], 'fees shown apart');
  // The bar can't make the app order after all: the refund owed is everything they paid, the fee too.
  ok(await call('POST', '/api/bar/order', { who: 'm1', body: { orderId: o.orderId, action: 'refund', reason: 'bottle broke' } }), 'refund');
  const refunds = ok(await call('GET', '/api/admin/refunds', { who: 'sa' }), 'refunds').refunds;
  assert.equal(refunds.find(r => r.id === o.orderId).amountPesewas, 10500);
});

test('the waiter’s MoMo prompt and the gate’s MoMo add the fee; cash never does', async () => {
  const { store, call } = setup();
  const tab = ok(await call('POST', '/api/ops/tabs/open', { who: 'w1', body: { table: '4' } }), 'tab');
  const round = ok(await call('POST', '/api/ops/tabs/round', { who: 'w1', body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 4 }] } }), 'round');
  ok(await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: round.id, action: 'hand' } }), 'handed');
  ok(await call('POST', '/api/ops/tabs/round-action', { who: 'w1', body: { roundId: round.id, action: 'received' } }), 'received');
  ok(await call('POST', '/api/ops/tabs/round-action', { who: 'w1', body: { roundId: round.id, action: 'delivered' } }), 'delivered');
  const pc = () => store.list('pending_checkouts').map(d => d.fields).at(-1);
  const m = ok(await call('POST', '/api/ops/tabs/checkout', { who: 'w1', body: { tabId: tab.id, method: 'momo', phone: '0245550000' } }), 'momo prompt');
  assert.equal(store.paystackCharges.at(-1).amount, 10500, 'MoMo prompt: bill GHS 100 + GHS 5');
  assert.match(m.message, /GHS 105 \(bill GHS 100 \+ GHS 5 service fee\)/);
  assert.deepEqual([pc().amountPesewas, pc().chargePesewas], [10000, 10500]);
  const gate = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 1, phone: '0245551234', method: 'momo' } }), 'gate momo');
  assert.deepEqual([store.paystackCharges.at(-1).amount, gate.chargePesewas], [10500, 10500]);
  assert.match(gate.message, /GHS 105 \(GHS 100 \+ GHS 5 service fee\)/);
  store.setPaystack(gate.reference, { status: 'success', currency: 'GHS', amount: 10500 });
  assert.equal(ok(await call('GET', `/api/door/gate/sale/${gate.reference}`, { who: 'door' }), 'gate paid').status, 'issued');
  assert.equal(store.list('orders').map(o => o.fields).find(o => o.channel === 'gate').amountPesewas, 10000, 'the ticket money is the door price');
  const cash = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 1, phone: '0245551235', method: 'cash' } }), 'gate cash');
  assert.equal(cash.amountPesewas, 10000, 'cash: no fee');
  assert.equal(pc().reference, gate.reference, 'cash makes no Paystack checkout');
});

test('the admin sets the fee in Settings (0 turns it off); out of range is refused; 0 charges the price alone', async () => {
  const { store, call } = setup();
  assert.equal(ok(await call('GET', '/api/settings'), 'public').settings.serviceFeePercent, 5);
  assert.match((await call('POST', '/api/admin/settings', { who: 'sa', body: { serviceFeePercent: 50 } })).data.error, /0 to 20/);
  assert.equal((await call('POST', '/api/admin/settings', { who: 'd1', body: { serviceFeePercent: 1 } })).status, 403, 'not a director');
  ok(await call('POST', '/api/admin/settings', { who: 'sa', body: { serviceFeePercent: 0 } }), 'off');
  const s = ok(await call('POST', '/api/checkout/initiate', { body: buyer }), 'initiate');
  assert.deepEqual([s.feePesewas, store.paystackInits.at(-1).amount], [0, 30000]);
});
