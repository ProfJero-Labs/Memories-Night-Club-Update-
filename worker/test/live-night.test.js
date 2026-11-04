// A whole night as the club runs it now: the owner's payment rules ON (the live default), every
// role. Gate, waiters' tabs, the bar (quick sales, QR orders paid by Paystack and in cash), a big
// bill paid by MoMo to the wallet, cash handed bar → Manager, the Manager's Tonight, finance, the
// directors, closing the night.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };

function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('settings', 'commercial', {}); // nothing saved: the owner's rules, as live
  const tonight = new Date(Date.now() - 2 * 3600e3).toISOString();
  store.seed('events', 'ev1', { name: 'Friday', date: tonight, active: true, visibility: 'public' });
  store.seed('ticket_types', 'reg', { eventId: 'ev1', name: 'Regular', pricePesewas: 8000, doorPricePesewas: 10000, admits: 1, remaining: 100, active: true });
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('menu_items', 'magnum', { name: 'Magnum', category: 'Bottles', pricePesewas: 150000, costPesewas: 70000, available: true, tracked: true });
  const people = { door: ['Kofi Door', 'doorStaff'], w1: ['Efua Waiter', 'waitStaff'], b1: ['Ama Bartender', 'barStaff'], m1: ['Akos Manager', 'manager'], hr: ['Abena HR', 'hrManager'], f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'], sa: ['Sys Admin', 'superAdmin'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400005${Object.keys(people).indexOf(uid)}0`, ...(role === 'director' ? { sharePct: 100 } : {}) });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.97.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    return { status: r.status, data: JSON.parse(text || '{}') };
  };
  const paystackPays = async (ref, amount) => { store.setPaystack(ref, { status: 'success', currency: 'GHS', amount, fees: Math.round(amount * 0.0195), channel: 'mobile_money' }); ok(await call('POST', '/api/checkout/verify', { body: { reference: ref } }), 'verify'); };
  const barMakes = async rid => { for (const action of ['preparing', 'ready', 'hand']) ok(await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: rid, action } }), `bar ${action}`); };
  return { store, env, call, paystackPays, barMakes };
}

test('a live night, every role, with the owner’s payment rules on', async () => {
  const { store, call, paystackPays, barMakes } = setup();
  ok(await call('POST', '/api/ops/stock/count', { who: 'b1', body: { stationId: 'main', kind: 'opening', lines: [{ productId: 'beer', counted: 100 }, { productId: 'magnum', counted: 5 }] } }), 'opening count');

  // ── Gate: two tickets for cash ──
  const night = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'gate night');
  assert.equal(night.canSell, true);
  const sale = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 2, phone: '024 555 1234', name: 'Kwame', method: 'cash' } }), 'gate sale');
  assert.deepEqual([sale.status, sale.amountPesewas], ['issued', 20000], 'no charge on cash');

  // ── Waiter: a tab, the bar makes it, closed in cash (closes by itself) ──
  const t1 = ok(await call('POST', '/api/ops/tabs/order', { who: 'w1', body: { table: '4', lines: [{ productId: 'beer', qty: 4 }] } }), 'waiter order');
  await barMakes(t1.roundId);
  const c1 = ok(await call('POST', '/api/ops/tabs/checkout', { who: 'w1', body: { tabId: t1.tabId, method: 'cash' } }), 'close tab: cash');
  assert.equal(store.get('tabs', t1.tabId).fields.status, 'closed', 'cash closes the tab');
  void c1;

  // ── Waiter: a tab paid by the customer on Paystack (bill link): 5% on top, closes itself ──
  const t2 = ok(await call('POST', '/api/ops/tabs/order', { who: 'w1', body: { table: '6', lines: [{ productId: 'beer', qty: 2 }] } }), 'order 2');
  await barMakes(t2.roundId);
  const tab2 = ok(await call('GET', `/api/ops/tab?id=${t2.tabId}`, { who: 'w1' }), 'tab').tab;
  const token = new URL(tab2.billUrl).searchParams.get('t');
  const bill = ok(await call('GET', `/api/guest/bill/${token}`), 'bill').bill;
  assert.equal(bill.balancePesewas, 5000);
  const pay = ok(await call('POST', `/api/guest/bill/${token}/pay`, { body: {} }), 'customer pays');
  const init = store.paystackInits.at(-1);
  assert.deepEqual([init.amount, init.subaccount], [5250, 'ACCT_89qd3ub03w61erk'], 'GHS 50 + 5%; the partner’s share goes to his subaccount');
  await paystackPays(pay.reference, 5250);
  assert.equal(store.get('tabs', t2.tabId).fields.status, 'closed', 'paid in full: the tab closed itself');

  // ── Bar: a quick cash sale over the counter ──
  ok(await call('POST', '/api/ops/quick-sale', { who: 'b1', body: { stationId: 'main', fromBar: true, method: 'cash', lines: [{ productId: 'beer', qty: 2 }] } }), 'bar cash sale');
  // MoMo to the club's number is not used any more.
  assert.equal((await call('POST', '/api/ops/quick-sale', { who: 'b1', body: { stationId: 'main', fromBar: true, method: 'momo', momoRef: 'X1234567', lines: [{ productId: 'beer', qty: 1 }] } })).status, 400);

  // ── QR scan: Paystack, and cash at the bar ──
  const qr = ok(await call('POST', '/api/guest/counter/checkout', { body: { station: 'a'.repeat(32), phone: '0241234567', items: [{ itemId: 'beer', qty: 2 }] } }), 'QR order');
  assert.equal(store.paystackInits.at(-1).amount, 5250);
  const qrRef = store.list('pending_checkouts').find(p => p.fields.orderId === qr.orderId || p.fields.kind === 'counter' && !p.fields.done)?.id || store.paystackInits.at(-1).reference;
  await paystackPays(qrRef, 5250);
  assert.equal(ok(await call('GET', `/api/guest/counter/${qr.orderId}`), 'QR status').status, 'paid');
  ok(await call('POST', '/api/bar/order', { who: 'b1', body: { orderId: qr.orderId, action: 'deliver' } }), 'bar hands the QR order');
  const qc = ok(await call('POST', '/api/guest/counter/checkout', { body: { station: 'a'.repeat(32), payWith: 'cash', phone: '0247778888', items: [{ itemId: 'beer', qty: 1 }] } }), 'QR pay cash');
  ok(await call('POST', '/api/bar/order', { who: 'b1', body: { orderId: qc.orderId, action: 'cash' } }), 'bar takes the QR cash');

  // ── A big bill (GHS 3,000): no Paystack anywhere; MoMo to the wallet; a manager confirms ──
  const t3 = ok(await call('POST', '/api/ops/tabs/order', { who: 'w1', body: { table: 'VIP', lines: [{ productId: 'magnum', qty: 2 }] } }), 'big order');
  await barMakes(t3.roundId);
  const tok3 = new URL(ok(await call('GET', `/api/ops/tab?id=${t3.tabId}`, { who: 'w1' }), 'tab3').tab.billUrl).searchParams.get('t');
  const b3 = await call('POST', `/api/guest/bill/${tok3}/pay`, { body: {} });
  assert.notEqual(b3.status, 200, 'Paystack refused above GHS 2,000');
  const w = ok(await call('POST', '/api/ops/tabs/checkout', { who: 'w1', body: { tabId: t3.tabId, method: 'wallet', phone: '0244445555' } }), 'MoMo to the wallet');
  assert.deepEqual([w.wallet.duePesewas, w.wallet.chargePesewas], [310000, 10000], 'GHS 3,000 + GHS 100');
  const waiting = ok(await call('GET', '/api/ops/wallet', { who: 'hr' }), 'Human manager sees it');
  const wid = waiting.waiting?.[0]?.id || w.wallet.id;
  ok(await call('POST', '/api/ops/wallet/confirm', { who: 'hr', body: { id: wid, receivedPesewas: 310000, momoRef: 'MP555666777' } }), 'Human manager confirms');
  assert.equal(store.get('tabs', t3.tabId).fields.status, 'closed', 'the big tab closed itself');

  // ── Cash: waiter → bar → Manager ──
  const wCash = ok(await call('GET', '/api/ops/cash', { who: 'w1' }), 'waiter cash').session;
  assert.equal(wCash.expectedPesewas, 10000, 'the waiter holds the GHS 100 from table 4');
  ok(await call('POST', '/api/ops/cash/close', { who: 'w1', body: { countedPesewas: 10000 } }), 'waiter counts');
  const list = ok(await call('GET', '/api/ops/cash/waiters', { who: 'b1' }), 'bar list');
  ok(await call('POST', '/api/ops/cash/receive', { who: 'b1', body: { id: list.waiting[0].id, receivedPesewas: 10000 } }), 'bar receives the waiter’s cash');
  const bCash = ok(await call('GET', '/api/ops/cash', { who: 'b1' }), 'bar cash').session;
  assert.equal(bCash.expectedPesewas, 10000 + 5000 + 2500, 'waiter’s cash + bar sale + QR cash');
  const mine = ok(await call('GET', '/api/ops/my-report', { who: 'b1' }), 'bartender’s shift').figures;
  assert.equal(mine.cashCollectedPesewas, 7500, 'the bartender’s own cash: quick sale + QR cash');
  ok(await call('POST', '/api/ops/cash/close', { who: 'b1', body: { countedPesewas: 17500 } }), 'bar counts');
  const bid = store.list('cash_sessions').find(x => x.fields.uid === 'b1').id;
  ok(await call('POST', '/api/ops/cash/receive', { who: 'm1', body: { id: bid, receivedPesewas: 17500 } }), 'Manager receives the bar’s cash');
  const doorCash = store.list('cash_sessions').find(x => x.fields.uid === 'door');
  if (doorCash) {
    ok(await call('POST', '/api/ops/cash/close', { who: 'door', body: { countedPesewas: 20000 } }), 'gate counts');
    ok(await call('POST', '/api/ops/cash/receive', { who: 'm1', body: { id: doorCash.id, receivedPesewas: 20000 } }), 'Manager receives the gate cash');
  }

  // ── The Manager's Tonight ──
  const s = ok(await call('GET', '/api/ops/sales', { who: 'm1' }), 'Manager: tonight').totals;
  assert.equal(s.cashPesewas, 10000 + 5000 + 2500, 'drinks cash');
  assert.equal(s.digitalPesewas, 5000 + 5000, 'Paystack: the two GHS 50 bills (without the charge)');
  assert.equal(s.momoPesewas, 300000, 'MoMo to the wallet');
  ok(await call('GET', '/api/ops/payments', { who: 'm1' }), 'Manager: payments');

  // ── Directors: every sale, three ways to pay ──
  const sl = ok(await call('GET', '/api/ops/sales/list?period=today', { who: 'd1' }), 'director: every sale');
  assert.deepEqual(Object.values(sl.methodOptions), ['Cash', 'Paystack', 'MoMo', 'Not fully paid']);
  const labels = new Set(sl.sales.flatMap(x => x.payments.map(p => p.methodLabel)));
  for (const l of labels) assert.ok(['Cash', 'Paystack', 'MoMo'].includes(l), `only three ways to pay, not “${l}”`);
  const byPaystack = ok(await call('GET', '/api/ops/sales/list?period=today&method=phone', { who: 'd1' }), 'Paystack filter');
  assert.equal(byPaystack.totals.paidPesewas, 10000, 'Paystack: the bill-link tab + the QR order');
  ok(await call('GET', '/api/ops/money?period=today', { who: 'd1' }), 'director: money');
  const ev = ok(await call('GET', '/api/ops/evolveit', { who: 'd1' }), 'director: due to EvolveIT');
  assert.ok(JSON.stringify(ev).includes('10000'), 'the GHS 100 on the big bill is owed to EvolveIT');
  assert.equal((await call('GET', '/api/ops/evolveit', { who: 'f1' })).status, 403, 'finance doesn’t see EvolveIT');
  const how = ok(await call('GET', '/api/ops/commercial', { who: 'd1' }), 'director: how customers pay');
  assert.deepEqual([how.routes.enabled, how.canEdit], [true, false]);

  // ── Close the night; finance's report ──
  ok(await call('POST', '/api/ops/close-night', { who: 'm1', body: {} }), 'Manager closes the night');
  const fin = ok(await call('GET', '/api/ops/finance-night', { who: 'f1' }), 'finance: the night');
  assert.ok(fin.sales.netProductPesewas >= 300000 + 25000, 'finance sees the drinks sold');
  const eod = ok(await call('GET', '/api/ops/eod/list', { who: 'f1' }), 'finance: reports');
  assert.ok(JSON.stringify(eod).length > 2);
});
