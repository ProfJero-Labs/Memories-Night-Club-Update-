// Tips: a customer tips whoever they name (the person serving by default). A tip is the staff
// member's money: never in the bill, the sales, the money in or the cash to hand in. Cash tips are
// kept; MoMo and card tips are owed, and finance pays them out (no director needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

const STATION = 'a'.repeat(32);
let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: STATION, open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('stock_moves', 'seed', { productId: 'beer', stationId: 'main', qty: 100, kind: 'received', businessDate: '2000-01-01' });
  const people = { w1: ['Efua Mensah', 'waitStaff'], b1: ['Ama Boateng', 'barStaff'], dj: ['Kofi Asare', 'dj'], f1: ['Esi Finance', 'finance'], m1: ['Akos Manager', 'manager'], d1: ['Nana Director', 'director'], sa: ['Sys Admin', 'superAdmin'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400003${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.97.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const tips = store => store.list('tips').map(t => t.fields);

test('a cash tip with a quick sale: the person keeps it; it is not in the sale, the cash to hand in or the money in', async () => {
  const { store, call } = setup();
  const sale = ok(await call('POST', '/api/ops/quick-sale', { who: 'b1', body: { lines: [{ productId: 'beer', qty: 2 }], fromBar: true, method: 'cash', tipPesewas: 1000, tipToUid: 'b1' } }), 'sale');
  assert.equal(sale.totalPesewas, 5000, 'the sale is the drinks only');
  assert.deepEqual(sale.tip, { toName: 'Ama Boateng', amountPesewas: 1000 });
  const [t] = tips(store);
  assert.deepEqual([t.toUid, t.amountPesewas, t.method, t.status, t.source], ['b1', 1000, 'cash', 'cash', 'quick']);
  const rep = ok(await call('GET', '/api/ops/my-report', { who: 'b1' }), 'my report').figures;
  assert.equal(rep.cashCollectedPesewas, 5000, 'the cash to hand in has no tip in it');
  assert.equal(rep.tipsPesewas, 1000, 'my tips tonight');
  const mine = ok(await call('GET', '/api/ops/my-tips', { who: 'b1' }), 'my tips');
  assert.deepEqual([mine.tonightPesewas, mine.cashPesewas, mine.owedPesewas], [1000, 1000, 0]);
  const money = ok(await call('GET', '/api/ops/money?period=today', { who: 'd1' }), 'money');
  assert.equal(money.totals.inPesewas, 5000, 'tips are not the club’s money');
  assert.deepEqual([money.tips.totalPesewas, money.tips.cashPesewas], [1000, 1000]);
  const sales = ok(await call('GET', '/api/ops/sales', { who: 'm1' }), 'sales');
  assert.equal(sales.totals.paidPesewas, 5000);
  assert.equal(sales.tips.totalPesewas, 1000);
});

test('a MoMo tip on a table for someone else: shares the MoMo ID, is owed to them, texted; finance pays it out once', async () => {
  const { store, call } = setup();
  const tab = ok(await call('POST', '/api/ops/tabs/open', { who: 'w1', body: { table: '4' } }), 'tab');
  ok(await call('POST', '/api/ops/tabs/round', { who: 'w1', body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 4 }] } }), 'round');
  // Who can be tipped: the team, not the directors.
  const ppl = ok(await call('GET', '/api/ops/tips/people', { who: 'w1' }), 'people').people.map(p => p.uid);
  assert.ok(ppl.includes('dj') && ppl.includes('w1') && !ppl.includes('d1'));
  assert.match((await call('POST', '/api/ops/tabs/pay', { who: 'w1', body: { tabId: tab.id, method: 'momo', amountPesewas: 10000, momoRef: 'MP123456', tipPesewas: 2000, tipToUid: 'd1' } })).data.error, /who the tip is for/);
  assert.match((await call('POST', '/api/ops/tabs/pay', { who: 'w1', body: { tabId: tab.id, method: 'momo', amountPesewas: 10000, momoRef: 'MP123456', tipPesewas: 50, tipToUid: 'dj' } })).data.error, /at least GHS 1/);
  assert.equal(tips(store).length, 0, 'nothing recorded when it’s refused');
  const pay = ok(await call('POST', '/api/ops/tabs/pay', { who: 'w1', body: { tabId: tab.id, method: 'momo', amountPesewas: 10000, momoRef: 'MP123456', tipPesewas: 2000, tipToUid: 'dj' } }), 'pay');
  assert.equal(pay.balancePesewas, 0, 'the bill is paid; the tip is on top');
  const [t] = tips(store);
  assert.deepEqual([t.toUid, t.amountPesewas, t.method, t.status, t.momoRef, t.tabNumber], ['dj', 2000, 'momo', 'owed', 'MP123456', 1]);
  assert.match(store.sms.at(-1).message, /You got a tip: GHS 20/); assert.equal(store.sms.at(-1).to, '0240000320');
  // The same MoMo can't be counted again, as a tip on its own either.
  assert.match((await call('POST', '/api/ops/tips', { who: 'w1', body: { method: 'momo', momoRef: 'MP123456', tipPesewas: 2000, tipToUid: 'dj' } })).data.error, /already recorded/);
  // The night's report: MoMo sales and MoMo tips, with the ID to find on the statement.
  const sales = ok(await call('GET', '/api/ops/sales', { who: 'm1' }), 'sales');
  assert.deepEqual([sales.totals.momoPesewas, sales.tips.momoPesewas, sales.tips.momo[0].momoRef], [10000, 2000, 'MP123456']);
  const night = ok(await call('GET', '/api/ops/payments', { who: 'm1' }), 'payments tonight');
  assert.deepEqual([night.payments[0].tipPesewas, night.payments[0].tipToName], [2000, 'Kofi Asare']);
  // Finance sees who is owed and pays; a manager can look but not pay.
  const owed = ok(await call('GET', '/api/ops/tips/owed', { who: 'f1' }), 'owed');
  assert.deepEqual([owed.owedPesewas, owed.people[0].uid, owed.people[0].needsCheck, owed.canPay], [2000, 'dj', true, true]);
  assert.equal(ok(await call('GET', '/api/ops/tips/owed', { who: 'm1' }), 'manager looks').canPay, false);
  assert.equal((await call('POST', '/api/ops/tips/pay', { who: 'm1', body: { uid: 'dj', paidWith: 'momo', ref: 'X1' } })).status, 403);
  assert.equal((await call('GET', '/api/ops/tips/owed', { who: 'w1' })).status, 403);
  assert.match((await call('POST', '/api/ops/tips/pay', { who: 'f1', body: { uid: 'dj', paidWith: 'momo' } })).data.error, /reference/);
  const paid = ok(await call('POST', '/api/ops/tips/pay', { who: 'f1', body: { uid: 'dj', paidWith: 'momo', ref: 'PAY-77' } }), 'pay tips');
  assert.deepEqual([paid.amountPesewas, paid.count], [2000, 1]);
  assert.match(store.sms.at(-1).message, /your tips are paid: GHS 20 by MoMo \(ref PAY-77\)/);
  assert.match((await call('POST', '/api/ops/tips/pay', { who: 'f1', body: { uid: 'dj', paidWith: 'momo', ref: 'PAY-78' } })).data.error, /Nothing is owed/);
  assert.deepEqual(store.list('tips').map(t => [t.fields.status, t.fields.payoutId ? 'yes' : 'no']), [['paid', 'yes']], 'the tip itself is marked paid');
  const mine = ok(await call('GET', '/api/ops/my-tips', { who: 'dj' }), 'dj tips');
  assert.deepEqual([mine.owedPesewas, mine.paidPesewas, mine.payouts[0].ref], [0, 2000, 'PAY-77']);
  assert.equal(ok(await call('GET', '/api/ops/my-tips', { who: 'd1' }), 'director').onTips, false, 'directors aren’t tipped');
});

test('a tip on the bill link: charged with the bill, split off when Paystack confirms, owed to the waiter by default', async () => {
  const { store, call } = setup();
  const tab = ok(await call('POST', '/api/ops/tabs/open', { who: 'w1', body: { table: '9' } }), 'tab');
  ok(await call('POST', '/api/ops/tabs/round', { who: 'w1', body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'round');
  const t = ok(await call('GET', `/api/ops/tab?id=${tab.id}`, { who: 'w1' }), 'tab').tab;
  const token = new URL(t.billUrl).searchParams.get('t');
  const page = ok(await call('GET', `/api/guest/bill/${token}`), 'bill');
  assert.equal(page.tip.defaultId, 'w1', 'their waiter first');
  assert.ok(page.tip.people.some(p => p.id === 'w1' && p.name === 'Efua M.'), 'short names on the customer’s page');
  assert.ok(!JSON.stringify(page.tip).includes('Mensah') && !JSON.stringify(page.tip).includes('0240'), 'no full names or phones');
  const pay = ok(await call('POST', `/api/guest/bill/${token}/pay`, { body: { tipPesewas: 1500, tipToUid: 'w1' } }), 'pay');
  assert.equal(store.paystackInits.at(-1).amount, 6500, 'bill GHS 50 + tip GHS 15');
  store.setPaystack(pay.reference, { status: 'success', currency: 'GHS', amount: 6500 });
  ok(await call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify');
  ok(await call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify again');
  const after = ok(await call('GET', `/api/guest/bill/${token}`), 'after').bill;
  assert.deepEqual([after.paidPesewas, after.balancePesewas, after.status], [5000, 0, 'paid'], 'the bill gets the bill amount');
  assert.equal(tips(store).length, 1, 'one tip, even when Paystack tells us twice');
  assert.deepEqual([tips(store)[0].toUid, tips(store)[0].amountPesewas, tips(store)[0].method, tips(store)[0].status], ['w1', 1500, 'digital', 'owed']);
  const money = ok(await call('GET', '/api/ops/money?period=today', { who: 'd1' }), 'money');
  assert.equal(money.totals.inPesewas, 5000);
  assert.deepEqual([money.tips.digitalPesewas, money.tips.owedPesewas], [1500, 1500]);
});

test('a tip on the QR menu: drinks total unchanged, owed to the person picked; if the bar can’t make it, the tip is refunded too', async () => {
  const { store, call } = setup();
  const menu = ok(await call('GET', `/api/guest/menu?station=${STATION}`), 'menu');
  assert.ok(menu.tipPeople.some(p => p.id === 'b1') && !menu.tipPeople.some(p => p.id === 'd1'));
  const basket = (extra = {}) => ({ station: STATION, items: [{ itemId: 'beer', qty: 2 }], phone: '024 123 4567', clientId: 'a1b2c3d4-0000-4000-8000-0000000000a1', ...extra });
  assert.match((await call('POST', '/api/guest/counter/checkout', { body: basket({ tipPesewas: 1000 }) })).data.error, /who the tip is for/);
  const o = ok(await call('POST', '/api/guest/counter/checkout', { body: basket({ tipPesewas: 1000, tipToUid: 'b1' }) }), 'checkout');
  assert.equal(store.paystackInits.at(-1).amount, 6000);
  const ref = store.list('pending_checkouts').at(-1).id;
  store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 6000 });
  const got = ok(await call('GET', `/api/guest/counter/${o.orderId}`), 'poll');
  assert.equal(got.status, 'paid'); assert.equal(got.totalPesewas, 5000, 'the drinks');
  assert.deepEqual([tips(store)[0].toUid, tips(store)[0].status, tips(store)[0].source], ['b1', 'owed', 'qr']);
  ok(await call('POST', '/api/bar/order', { who: 'b1', body: { orderId: o.orderId, action: 'refund', reason: 'finished' } }), 'can’t make it');
  assert.equal(tips(store)[0].status, 'cancelled', 'the tip goes back with the drinks');
  const refunds = ok(await call('GET', '/api/admin/refunds', { who: 'sa' }), 'refunds');
  assert.equal(refunds.refunds.find(x => x.id === o.orderId).amountPesewas, 6000, 'drinks and tip go back');
  assert.equal(ok(await call('GET', '/api/ops/tips/owed', { who: 'f1' }), 'owed').owedPesewas, 0);
});

test('a tip on its own (no bill): cash for the DJ; the one who records it must take payments', async () => {
  const { store, call } = setup();
  assert.equal((await call('POST', '/api/ops/tips', { who: 'dj', body: { method: 'cash', tipPesewas: 5000, tipToUid: 'dj' } })).status, 403, 'a DJ can’t record payments');
  const t = ok(await call('POST', '/api/ops/tips', { who: 'w1', body: { method: 'cash', tipPesewas: 5000, tipToUid: 'dj' } }), 'tip');
  assert.deepEqual([t.toName, t.status], ['Kofi Asare', 'cash']);
  assert.match(store.sms.at(-1).message, /You got a tip: GHS 50 \(cash\)/);
  assert.equal(ok(await call('GET', '/api/ops/my-tips', { who: 'dj' }), 'dj').cashPesewas, 5000);
  assert.match((await call('POST', '/api/ops/tips', { who: 'w1', body: { method: 'cash', tipPesewas: 2000000, tipToUid: 'dj' } })).data.error, /can’t be more/);
});
