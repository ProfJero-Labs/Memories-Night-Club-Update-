// A whole night at the venue, through the Worker: waiter tabs (no QR), the bar, stock, cash, the
// customer paying on their phone, reports, the close and the end-of-day report for finance.
// The numbered scenarios follow the build brief's test list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, available: true, tracked: true });
  store.seed('menu_items', 'shot', { name: 'Tequila shot', category: 'Shots', unit: 'shot', pricePesewas: 3000, available: true, tracked: true });
  const people = { w1: ['Efua Waiter', 'waitStaff'], w2: ['Kojo Waiter', 'waitStaff'], b1: ['Ama Bartender', 'barStaff'], c1: ['Yaw Cashier', 'cashier'], m1: ['Akos Manager', 'manager'], f1: ['Esi Finance', 'finance'], fo: ['Kofi Front', 'doorStaff'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400000${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.60.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    return { status: r.status, text, data: JSON.parse(text || '{}') };
  };
  const W1 = as('w1'), W2 = as('w2'), B1 = as('b1'), C1 = as('c1'), M1 = as('m1'), F1 = as('f1'), FO = as('fo');
  return { store, env, call, W1, W2, B1, C1, M1, F1, FO };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
async function barMakes(ctx, rid) {
  for (const action of ['preparing', 'ready', 'hand']) ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: rid, action } }), `bar ${action}`);
}
async function openingCount(ctx, beer = 50, shot = 20) {
  ok(await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', kind: 'opening', lines: [{ productId: 'beer', counted: beer }, { productId: 'shot', counted: shot }] } }), 'opening count');
}

test('1–3, 13: a waiter opens a tab without a QR, the bar makes it, the customer pays on their phone; a repeated Paystack notice counts once', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '5' } }), 'open tab');
  assert.equal(tab.label, 'Tab 1');
  const round = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }, { productId: 'shot', qty: 1 }] } }), 'round');
  assert.equal(round.totalPesewas, 8000);
  const q = ok(await ctx.call('GET', '/api/ops/bar/rounds', { who: ctx.B1 }), 'bar queue');
  assert.deepEqual([q.rounds[0].table, q.rounds[0].tabNumber, q.rounds[0].waiterName, q.rounds[0].statusLabel], ['5', 1, 'Efua Waiter', 'Sent to bar']);
  await barMakes(ctx, round.id);
  const issued = ctx.store.list('stock_moves').filter(m => m.fields.kind === 'issue');
  assert.deepEqual(issued.map(m => [m.fields.productId, m.fields.qty, m.fields.toWaiterName]).sort(), [['beer', -2, 'Efua Waiter'], ['shot', -1, 'Efua Waiter']]);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: round.id, action: 'received' } }), 'received');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: round.id, action: 'delivered' } }), 'delivered');

  const t = ok(await ctx.call('GET', `/api/ops/tab?id=${tab.id}`, { who: ctx.W1 }), 'tab').tab;
  const token = new URL(t.billUrl).searchParams.get('t');
  const bill = ok(await ctx.call('GET', `/api/guest/bill/${token}`), 'bill').bill;
  assert.deepEqual([bill.totalPesewas, bill.balancePesewas, bill.statusLabel], [8000, 8000, 'Waiting for payment']);
  assert.deepEqual(bill.lines.map(l => [l.name, l.qty, l.amountPesewas]), [['Club beer', 2, 5000], ['Tequila shot', 1, 3000]]);
  assert.ok(!JSON.stringify(bill).includes('costPesewas'), 'no costs on the bill');
  const pay = ok(await ctx.call('POST', `/api/guest/bill/${token}/pay`, { body: {} }), 'pay');
  assert.equal(ctx.store.paystackInits.at(-1).amount, 8000);
  ctx.store.setPaystack(pay.reference, { status: 'success', currency: 'GHS', amount: 8000 });
  ok(await ctx.call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify');
  ok(await ctx.call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify again'); // 13: the notice arrives twice
  const after = ok(await ctx.call('GET', `/api/guest/bill/${token}`), 'bill').bill;
  assert.deepEqual([after.paidPesewas, after.balancePesewas, after.statusLabel, after.payments.length], [8000, 0, 'Paid', 1]);
  ok(await ctx.call('POST', '/api/ops/tabs/close', { who: ctx.W1, body: { tabId: tab.id } }), 'close tab');
});

test('3–5: another round on the same tab; part paid in cash at the cashier; a bill that grows while paying keeps the new drinks owed', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { walkIn: true, customerPhone: '024 111 2222' } }), 'open');
  const r1 = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'r1');
  await barMakes(ctx, r1.id);
  const token = new URL(ok(await ctx.call('GET', `/api/ops/tab?id=${tab.id}`, { who: ctx.W1 }), 'tab').tab.billUrl).searchParams.get('t');
  const pay = ok(await ctx.call('POST', `/api/guest/bill/${token}/pay`, { body: {} }), 'pay 5000');
  // Another round lands while the customer is on the payment page.
  const r2 = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'shot', qty: 1 }] } }), 'r2');
  await barMakes(ctx, r2.id);
  ctx.store.setPaystack(pay.reference, { status: 'success', currency: 'GHS', amount: 5000 });
  ok(await ctx.call('POST', '/api/checkout/verify', { body: { reference: pay.reference } }), 'verify');
  let bill = ok(await ctx.call('GET', `/api/guest/bill/${token}`), 'bill').bill;
  assert.deepEqual([bill.totalPesewas, bill.paidPesewas, bill.balancePesewas, bill.statusLabel], [8000, 5000, 3000, 'Part paid'], 'the shot is still owed');
  // Cash at the cashier: needs an open cash shift; no more than the balance.
  assert.equal((await ctx.call('POST', '/api/ops/tabs/cash', { who: ctx.C1, body: { tabId: tab.id, amountPesewas: 1000 } })).data.code, 'no_session');
  ok(await ctx.call('POST', '/api/ops/cash/open', { who: ctx.C1, body: { floatPesewas: 20000 } }), 'open cash');
  assert.match((await ctx.call('POST', '/api/ops/tabs/cash', { who: ctx.C1, body: { tabId: tab.id, amountPesewas: 9000 } })).data.error, /balance is GHS 30/);
  ok(await ctx.call('POST', '/api/ops/tabs/cash', { who: ctx.C1, body: { tabId: tab.id, amountPesewas: 1000 } }), 'cash 1000');
  bill = ok(await ctx.call('GET', `/api/guest/bill/${token}`), 'bill').bill;
  assert.deepEqual([bill.balancePesewas, bill.statusLabel], [2000, 'Part paid']);
  assert.equal((await ctx.call('POST', '/api/ops/tabs/cash', { who: ctx.FO, body: { tabId: tab.id, amountPesewas: 1000 } })).status, 403, 'front office without cash permission can’t take cash');
  // A menu price change never moves a bill already sent.
  ok(await ctx.call('POST', '/api/ops/products', { who: ctx.F1, body: { id: 'shot', name: 'Tequila shot', category: 'Shots', unit: 'shot', pricePesewas: 5000, costPesewas: 1500 } }), 'price change');
  bill = ok(await ctx.call('GET', `/api/guest/bill/${token}`), 'bill').bill;
  assert.equal(bill.totalPesewas, 8000);
});

test('6–8: drinks received but not all sold; a return the bar confirms; a broken bottle; handed over but not delivered shows in My report', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: 'VIP 2' } }), 'open');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 5 }] } }), 'round');
  await barMakes(ctx, r.id);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: r.id, action: 'received' } }), 'received');
  const line = ok(await ctx.call('GET', `/api/ops/tab?id=${tab.id}`, { who: ctx.W1 }), 'tab').tab.rounds[0].lines[0];
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: r.id, action: 'return', lineId: line.lineId, qty: 2 } }), 'return 2');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: r.id, action: 'broken', lineId: line.lineId, qty: 1, note: 'dropped' } }), 'broken 1');
  let rep = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.W1 }), 'report').figures;
  assert.deepEqual([rep.receivedQty, rep.returnPendingQty, rep.brokenQty, rep.withYouQty, rep.deliveredQty], [5, 2, 1, 2, 0]);
  const bq = ok(await ctx.call('GET', '/api/ops/bar/rounds', { who: ctx.B1 }), 'bar');
  assert.equal(bq.returns.length, 1, 'the bar sees drinks coming back');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.id, action: 'confirm_return' } }), 'confirm return');
  assert.equal(ctx.store.list('stock_moves').find(m => m.fields.kind === 'return_in').fields.qty, 2);
  rep = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.W1 }), 'report').figures;
  assert.deepEqual([rep.returnedQty, rep.withYouQty, rep.withYouPesewas], [2, 2, 5000], '2 still with the waiter, not delivered');
  // 7: the report can't be submitted silently with drinks unaccounted for.
  assert.equal((await ctx.call('POST', '/api/ops/my-report', { who: ctx.W1, body: {} })).data.code, 'needs_explanation');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: r.id, action: 'delivered' } }), 'delivered');
  rep = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.W1 }), 'report').figures;
  assert.deepEqual([rep.deliveredQty, rep.withYouQty, rep.salesPesewas], [2, 0, 5000], 'billed: 5 − 2 returned − 1 broken');
  // 8: a bottle broken at the bar.
  ok(await ctx.call('POST', '/api/ops/stock/waste', { who: ctx.B1, body: { stationId: 'main', productId: 'beer', qty: 1, reason: 'broken' } }), 'waste');
  const sheet = ok(await ctx.call('GET', '/api/ops/stock?stationId=main', { who: ctx.B1 }), 'sheet');
  const beer = sheet.rows.find(x => x.productId === 'beer');
  assert.deepEqual([beer.opening, beer.issued, beer.returns, beer.waste, beer.expected], [50, 5, 2, 1, 46]);
});

test('9, 15: the bar count is lower than expected ("3 fewer"); a reason is required; a finished count can’t be changed except by an approved correction', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '1' } }), 'open');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 4 }] } }), 'round');
  await barMakes(ctx, r.id);
  const lines = [{ productId: 'beer', counted: 43 }, { productId: 'shot', counted: 20 }];
  assert.match((await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', lines } })).data.error, /Club beer: 3 fewer than expected/);
  ok(await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', lines: [{ ...lines[0], reason: 'unknown', note: 'checking' }, lines[1]] } }), 'count');
  assert.match((await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', lines } })).data.error, /already in/, '15: locked');
  const sheet = ok(await ctx.call('GET', '/api/ops/stock?stationId=main', { who: ctx.M1 }), 'sheet');
  assert.deepEqual([sheet.rows.find(x => x.productId === 'beer').expected, sheet.rows.find(x => x.productId === 'beer').difference], [46, -3]);
  const req = ok(await ctx.call('POST', '/api/ops/approvals/request', { who: ctx.B1, body: { kind: 'count_correction', date: sheet.date, stationId: 'main', lines: [{ productId: 'beer', counted: 46 }], reason: 'found 3 in the cold room' } }), 'request');
  assert.equal((await ctx.call('POST', '/api/ops/approvals/decide', { who: ctx.B1, body: { id: req.id, approve: true } })).status, 403, 'the bartender can’t approve their own');
  ok(await ctx.call('POST', '/api/ops/approvals/decide', { who: ctx.F1, body: { id: req.id, approve: true } }), 'finance approves');
  const c = ctx.store.get('stock_counts', `${sheet.date}__main__closing`).fields;
  assert.equal(c.lines.find(l => l.productId === 'beer').counted, 43, 'the original count is kept');
  assert.equal(c.corrected.lines.find(l => l.productId === 'beer').counted, 46);
  assert.equal(c.corrected.approvedByName, 'Esi Finance');
});

test('10, 14: the cashier has less cash than expected (explanation required); a waiter can’t change a price; every price change records old and new', async () => {
  const ctx = setup();
  await openingCount(ctx);
  ok(await ctx.call('POST', '/api/ops/cash/open', { who: ctx.C1, body: { floatPesewas: 10000 } }), 'open cash');
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '3' } }), 'open');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 4 }] } }), 'round');
  await barMakes(ctx, r.id);
  ok(await ctx.call('POST', '/api/ops/tabs/cash', { who: ctx.C1, body: { tabId: tab.id, amountPesewas: 10000 } }), 'cash');
  ok(await ctx.call('POST', '/api/ops/cash/move', { who: ctx.C1, body: { kind: 'drop', amountPesewas: 5000 } }), 'drop to safe');
  const refund = ok(await ctx.call('POST', '/api/ops/cash/move', { who: ctx.C1, body: { kind: 'refund', amountPesewas: 2000, reason: 'charged twice' } }), 'refund request');
  assert.equal(refund.requested, true, 'a cash refund waits for approval');
  ok(await ctx.call('POST', '/api/ops/approvals/decide', { who: ctx.M1, body: { id: refund.id, approve: true } }), 'manager approves');
  let mine = ok(await ctx.call('GET', '/api/ops/cash', { who: ctx.C1 }), 'cash').session;
  assert.equal(mine.expectedPesewas, 10000 + 10000 - 5000 - 2000);
  const short = await ctx.call('POST', '/api/ops/cash/close', { who: ctx.C1, body: { countedPesewas: 12000 } });
  assert.equal(short.data.code, 'needs_explanation'); assert.match(short.data.error, /GHS 10 less than expected/);
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.C1, body: { countedPesewas: 12000, explanation: 'gave too much change on Tab 1' } }), 'close cash');
  mine = ok(await ctx.call('GET', '/api/ops/cash', { who: ctx.C1 }), 'cash').session;
  assert.deepEqual([mine.differencePesewas, mine.status], [-1000, 'submitted']);
  assert.equal((await ctx.call('POST', '/api/ops/cash/review', { who: ctx.C1, body: { id: mine.id } })).status, 403, 'a cashier doesn’t review cash');
  ok(await ctx.call('POST', '/api/ops/cash/review', { who: ctx.F1, body: { id: mine.id } }), 'finance reviews');
  // 14
  assert.equal((await ctx.call('POST', '/api/ops/products', { who: ctx.W1, body: { id: 'beer', name: 'Club beer', pricePesewas: 100 } })).status, 403);
  assert.equal((await ctx.call('POST', '/api/ops/stock/received', { who: ctx.W1, body: { stationId: 'main', productId: 'beer', qty: 99 } })).status, 403);
  // Finance sets prices (and the cost price, needed for the profit); the manager can't.
  assert.equal((await ctx.call('POST', '/api/ops/products', { who: ctx.M1, body: { id: 'beer', name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 3000, costPesewas: 1200 } })).status, 403, 'manager can’t set prices');
  assert.match((await ctx.call('POST', '/api/ops/products', { who: ctx.F1, body: { id: 'beer', name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 3000 } })).data.error, /cost price/);
  ok(await ctx.call('POST', '/api/ops/products', { who: ctx.F1, body: { id: 'beer', name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 3000, costPesewas: 1200 } }), 'finance price');
  const ch = ok(await ctx.call('GET', '/api/ops/changes', { who: ctx.F1 }), 'changes').changes.find(c => c.field === 'price');
  assert.deepEqual([ch.from, ch.to, ch.byName], [2500, 3000, 'Esi Finance']);
  assert.equal((await ctx.call('GET', '/api/ops/products', { who: ctx.W1 })).data.products[0].costPesewas, undefined, 'waiters never see costs');
});

test('5, 11, 12: an unpaid tab, free drinks by approval, Today’s sales, the guided close, the end-of-day report to finance, sign-off; closing doesn’t stop anyone and can be done again', async () => {
  const ctx = setup();
  ctx.env.BREVO_API_KEY = 'k'; ctx.env.BREVO_SENDER_EMAIL = 'noreply@memories.test';
  ok(await ctx.call('POST', '/api/ops/finance-contact', { who: ctx.F1, body: { email: 'finance@memories.test' } }), 'finance contact');
  assert.ok(!(await ctx.call('GET', '/api/settings')).text.includes('finance@memories.test'), 'never on the public settings');
  await openingCount(ctx);
  ok(await ctx.call('POST', '/api/ops/cash/open', { who: ctx.C1, body: { floatPesewas: 0 } }), 'open cash');
  const paid = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '7' } }), 'tab a');
  const ra = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: paid.id, lines: [{ productId: 'beer', qty: 2 }, { productId: 'shot', qty: 2 }] } }), 'ra');
  await barMakes(ctx, ra.id);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: ra.id, action: 'delivered' } }), 'delivered');
  // A free shot needs the manager.
  const shotLine = ok(await ctx.call('GET', `/api/ops/tab?id=${paid.id}`, { who: ctx.W1 }), 'tab').tab.rounds[0].lines.find(l => l.productId === 'shot');
  const comp = ok(await ctx.call('POST', '/api/ops/approvals/request', { who: ctx.W1, body: { kind: 'comp', tabId: paid.id, roundId: ra.id, lineId: shotLine.lineId, qty: 1, reason: 'birthday' } }), 'comp');
  ok(await ctx.call('POST', '/api/ops/approvals/decide', { who: ctx.M1, body: { id: comp.id, approve: true } }), 'approve comp');
  ok(await ctx.call('POST', '/api/ops/tabs/cash', { who: ctx.C1, body: { tabId: paid.id, amountPesewas: 8000 } }), 'pay 50+30');
  // 5: a customer leaves without paying.
  const unpaid = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W2, body: { table: '9' } }), 'tab b');
  const rb = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W2, body: { tabId: unpaid.id, lines: [{ productId: 'beer', qty: 1 }] } }), 'rb');
  await barMakes(ctx, rb.id);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W2, body: { roundId: rb.id, action: 'delivered' } }), 'delivered b');

  const sales = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.M1 }), 'sales');
  assert.deepEqual([sales.totals.salesPesewas, sales.totals.paidPesewas, sales.totals.cashPesewas, sales.totals.owedPesewas, sales.totals.freeDrinksPesewas], [10500, 8000, 8000, 2500, 3000]);
  assert.deepEqual(sales.byWaiter.map(w => [w.name, w.salesPesewas, w.unpaidPesewas]), [['Efua Waiter', 8000, 0], ['Kojo Waiter', 2500, 2500]]);
  assert.equal(sales.byProduct.find(p => p.name === 'Tequila shot').qty, 1, 'the free shot isn’t a sale');
  assert.equal((await ctx.call('GET', '/api/ops/sales', { who: ctx.W1 })).status, 403, 'waiters don’t see the whole night');

  // The close: four steps, and it says what's missing.
  let cs = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.M1 }), 'closing');
  assert.deepEqual(cs.steps.map(s => [s.key, s.done]).slice(0, 3), [['waiters', false], ['cash', false], ['bar', false]]);
  // A waiter's report is their tabs: each one closed, paid or owed.
  ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W1, body: { tabId: paid.id, method: 'cash' } }), 'paid tab closed');
  assert.match((await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W2, body: { tabId: unpaid.id, method: 'debt' } })).data.error, /name/);
  const debt = ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W2, body: { tabId: unpaid.id, method: 'debt', customerName: 'Kwesi', phone: '024 555 1111', note: 'Pays tomorrow' } }), 'owed');
  assert.deepEqual([debt.closed, debt.owedPesewas, ctx.store.get('tabs', unpaid.id).fields.status], [true, 2500, 'owed']);
  assert.match(ctx.store.sms.filter(x => x.to === '0245551111').at(-1).message, /MEMORIES INVOICE[\s\S]*TO PAY GHS 25/);
  ok(await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', lines: [{ productId: 'beer', counted: 47 }, { productId: 'shot', counted: 18 }] } }), 'bar count');
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.C1, body: { countedPesewas: 8000 } }), 'cash count');
  cs = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.M1 }), 'closing');
  assert.equal(cs.steps.find(s => s.key === 'cash').done, false, 'counted, not yet with the Manager');
  const cid = ctx.store.list('cash_sessions').find(x => x.fields.uid === 'c1').id;
  ok(await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.M1, body: { id: cid, receivedPesewas: 8000 } }), 'manager receives');
  cs = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.M1 }), 'closing');
  assert.ok(cs.steps.slice(0, 3).every(s => s.done), JSON.stringify(cs.steps));

  // 12: finance gets the report; the night locks.
  const closed = ok(await ctx.call('POST', '/api/ops/close-night', { who: ctx.M1, body: {} }), 'close night');
  assert.equal(closed.sent, true);
  assert.equal(ctx.store.emails.at(-1).to, 'finance@memories.test');
  const eod = ok(await ctx.call('GET', '/api/ops/eod', { who: ctx.F1 }), 'eod').report;
  assert.deepEqual([eod.report.sales.totals.salesPesewas, eod.report.exceptions.unpaidTabs.length, eod.closedByName], [10500, 1, 'Akos Manager']);
  assert.equal((await ctx.call('POST', '/api/ops/eod/sign-off', { who: ctx.M1, body: {} })).status, 403, 'the closer doesn’t sign off for finance');
  ok(await ctx.call('POST', '/api/ops/eod/sign-off', { who: ctx.F1, body: { note: 'Checked.' } }), 'finance signs off');
  // Closing is for the accounts only: staff keep working (a new drink, a breakage), and closing
  // again brings the report up to date.
  const late = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '20' } }), 'a new tab after closing');
  ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: late.id, lines: [{ productId: 'beer', qty: 1 }] } }), 'a drink after closing');
  ok(await ctx.call('POST', '/api/ops/stock/waste', { who: ctx.B1, body: { stationId: 'main', productId: 'beer', qty: 1, reason: 'broken' } }), 'stock after closing');
  ok(await ctx.call('POST', '/api/ops/close-night', { who: ctx.M1, body: {} }), 'close again');
  const again = ok(await ctx.call('GET', '/api/ops/eod', { who: ctx.F1 }), 'eod v2').report;
  assert.equal(again.report.sales.totals.salesPesewas, 10500 + 2500, 'the updated report has the new drink');
  assert.equal(again.versions.length, 2);
  // The debt can still be paid later, or written off with approval.
  const wo = ok(await ctx.call('POST', '/api/ops/approvals/request', { who: ctx.W2, body: { kind: 'write_off', tabId: unpaid.id, reason: 'left without paying' } }), 'write-off request');
  ok(await ctx.call('POST', '/api/ops/approvals/decide', { who: ctx.F1, body: { id: wo.id, approve: true } }), 'write off');
  assert.equal(ctx.store.get('tabs', unpaid.id).fields.status, 'written_off');
});

test('existing QR self-ordering still works, and its handover takes the drinks out of the bar’s stock', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const r = await ctx.call('POST', '/api/guest/counter/checkout', { body: { station: 'a'.repeat(32), items: [{ itemId: 'beer', qty: 2 }], phone: '0241234567', clientId: 'a1b2c3d4-0000-4000-8000-000000000001' } });
  assert.equal(r.status, 200, r.data.error);
  const ref = ctx.store.list('pending_checkouts')[0].id;
  ctx.store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 5000 });
  await ctx.call('GET', `/api/guest/counter/${r.data.orderId}`);
  ok(await ctx.call('POST', '/api/bar/order', { who: ctx.B1, body: { orderId: r.data.orderId, action: 'deliver' } }), 'deliver');
  const m = ctx.store.list('stock_moves').find(x => x.fields.qrOrder);
  assert.deepEqual([m.fields.productId, m.fields.qty, m.fields.kind], ['beer', -2, 'issue']);
  const sales = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.F1 }), 'sales');
  assert.equal(sales.totals.digitalPesewas, 5000);
});

test('waiters: invoice by SMS lists every drink; cash and MoMo recorded by the waiter; MoMo needs its ID once; reports split them', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '7', customerName: 'Abena', customerPhone: '024 555 7070' } }), 'open table');
  assert.match((await ctx.call('POST', '/api/ops/tabs/text-bill', { who: ctx.W1, body: { tabId: tab.id } })).data.error, /invoice is empty/);
  const round = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 3 }, { productId: 'shot', qty: 2 }] } }), 'round');
  await barMakes(ctx, round.id);
  const sent = ok(await ctx.call('POST', '/api/ops/tabs/text-bill', { who: ctx.W1, body: { tabId: tab.id } }), 'invoice');
  assert.equal(sent.sent, true);
  const sms = ctx.store.sms.at(-1);
  assert.equal(sms.to, '0245557070', 'to the phone given when the table was opened');
  assert.match(sms.message, /MEMORIES INVOICE/); assert.match(sms.message, /Tab 1 · Table 7/);
  assert.match(sms.message, /3 x Club beer GHS 75/); assert.match(sms.message, /2 x Tequila shot GHS 60/);
  assert.match(sms.message, /Total GHS 135/); assert.match(sms.message, /MEMORIES INVOICE/); assert.match(sms.message, /TO PAY GHS 135/); assert.match(sms.message, /bill\.html\?t=/);

  // Cash, by the waiter herself (no special permission needed).
  const cash = ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: tab.id, method: 'cash', amountPesewas: 5000 } }), 'cash');
  assert.equal(cash.balancePesewas, 8500);
  // MoMo: the transaction ID is required, and can't be used twice in a night.
  assert.match((await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: tab.id, method: 'momo', amountPesewas: 5000 } })).data.error, /transaction ID/);
  assert.match((await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: tab.id, method: 'momo', amountPesewas: 99000, momoRef: '51234567890' } })).data.error, /balance is GHS 85/);
  const momo = ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: tab.id, method: 'momo', amountPesewas: 5000, momoRef: '5123 4567 890', momoFrom: '0245557070' } }), 'momo');
  assert.equal(momo.balancePesewas, 3500);
  const tab2 = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W2, body: { table: '8' } }), 'tab 2');
  const r2 = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W2, body: { tabId: tab2.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'round 2');
  await barMakes(ctx, r2.id);
  assert.match((await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W2, body: { tabId: tab2.id, method: 'momo', amountPesewas: 5000, momoRef: '51234567890' } })).data.error, /already recorded \(Tab 1\)/);
  assert.equal((await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.FO, body: { tabId: tab2.id, method: 'momo', amountPesewas: 5000, momoRef: '99887766' } })).status, 403, 'front office can’t record payments');

  // The invoice now shows what's paid and what's left.
  ok(await ctx.call('POST', '/api/ops/tabs/text-bill', { who: ctx.W1, body: { tabId: tab.id } }), 'invoice again');
  assert.match(ctx.store.sms.at(-1).message, /Paid: Cash GHS 50 \(taken by Efua\), MoMo GHS 50 \(taken by Efua\)\nTO PAY GHS 35/);
  const t = ok(await ctx.call('GET', `/api/ops/tab?id=${tab.id}`, { who: ctx.W1 }), 'tab').tab;
  assert.deepEqual(t.payments.map(p => [p.method, p.amountPesewas, p.momoRef]), [['cash', 5000, ''], ['momo', 5000, '51234567890']]);
  const token = new URL(t.billUrl).searchParams.get('t');
  assert.deepEqual(ok(await ctx.call('GET', `/api/guest/bill/${token}`), 'bill').bill.payments.map(p => p.method), ['Cash', 'MoMo']);

  const sales = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.M1 }), 'sales');
  assert.deepEqual([sales.totals.cashPesewas, sales.totals.momoPesewas, sales.totals.paidPesewas], [5000, 5000, 10000]);
  assert.deepEqual(sales.momoPayments.map(m => [m.momoRef, m.tabNumber, m.byName, m.amountPesewas]), [['51234567890', 1, 'Efua Waiter', 5000]]);
  const mine = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.W1 }), 'my report').figures;
  assert.deepEqual([mine.cashCollectedPesewas, mine.momoRecordedPesewas], [5000, 5000]);
});

test('the bar confirms drinks a waiter took without a hand-over tap; "not taken" puts them back; only then do they leave the stock', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '3' } }), 'tab');
  const round = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'round');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: round.id, action: 'ready' } }), 'ready');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: round.id, action: 'took' } }), 'took');
  const issued = () => ctx.store.list('stock_moves').filter(m => m.fields.kind === 'issue' && m.fields.ref === round.id).length;
  assert.equal(issued(), 0, 'not out of stock until the bar confirms');
  let q = ok(await ctx.call('GET', '/api/ops/bar/rounds', { who: ctx.B1 }), 'queue');
  assert.equal(q.rounds.find(r => r.id === round.id).status, 'taken');
  assert.match((await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: round.id, action: 'hand' } })).data.error, /Confirm or Not taken/);
  assert.match((await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: round.id, action: 'received' } })).data.error, /hasn’t handed/);
  // The bar says no: back on the list.
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: round.id, action: 'not_taken' } }), 'not taken');
  q = ok(await ctx.call('GET', '/api/ops/bar/rounds', { who: ctx.B1 }), 'queue');
  assert.equal(q.rounds.find(r => r.id === round.id).status, 'ready');
  // Took again, and the bar confirms: out of stock, and with the waiter.
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: round.id, action: 'took' } }), 'took again');
  assert.equal((await ctx.call('POST', '/api/ops/bar/round', { who: ctx.W1, body: { roundId: round.id, action: 'confirm_taken' } })).status, 403, 'a waiter can’t confirm for the bar');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: round.id, action: 'confirm_taken' } }), 'confirm');
  assert.equal(issued(), 1);
  const r = ctx.store.get('rounds', round.id).fields;
  assert.deepEqual([r.status, r.handedByName, !!r.takenConfirmedAt], ['received', 'Ama Bartender', true]);
  q = ok(await ctx.call('GET', '/api/ops/bar/rounds', { who: ctx.B1 }), 'queue');
  assert.deepEqual(q.handedOver.map(x => [x.tabNumber, x.waiterName, x.handedByName, x.takenConfirmed]), [[1, 'Efua Waiter', 'Ama Bartender', true]]);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: round.id, action: 'delivered' } }), 'delivered');
});

test('the waiter’s tab: order → the bar → “I got them”; close it: cash closes it and texts the receipt; MoMo sends a prompt and the invoice and closes once paid', async () => {
  const ctx = setup();
  await openingCount(ctx);
  ctx.store.seed('users', 'w1', { ...ctx.store.get('users', 'w1').fields, canCollectCash: true });
  const a = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W1, body: { table: '7', customerPhone: '024 555 7070', lines: [{ productId: 'beer', qty: 2 }] } }), 'order');
  assert.equal(a.totalPesewas, 5000);
  assert.equal(ctx.store.sms.filter(x => x.to === '0245557070').length, 0, 'no text while they’re still drinking');
  // Closing before the drinks are collected: refused, so the bill is final.
  assert.match((await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W1, body: { tabId: a.tabId, method: 'cash' } })).data.error, /isn’t collected yet/);
  await barMakes(ctx, a.roundId);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: a.roundId, action: 'delivered' } }), 'I got them');
  // More drinks on the same tab later.
  const more = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W1, body: { tabId: a.tabId, lines: [{ productId: 'shot', qty: 1 }] } }), 'more');
  await barMakes(ctx, more.roundId);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: more.roundId, action: 'delivered' } }), 'I got them');
  // Cash: one step takes it and closes the tab; the receipt is texted.
  const c = ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W1, body: { tabId: a.tabId, method: 'cash' } }), 'cash close');
  assert.deepEqual([c.closed, c.cashPesewas, c.receiptSent], [true, 8000, true]);
  assert.equal(ctx.store.get('tabs', a.tabId).fields.status, 'closed');
  const rc = ctx.store.sms.filter(x => x.to === '0245557070').at(-1).message;
  assert.match(rc, /MEMORIES RECEIPT/); assert.match(rc, /Paid: Cash GHS 80 \(taken by Efua\)/); assert.ok(!/INVOICE|TO PAY/.test(rc));
  const bag = ctx.store.list('cash_sessions').find(x => x.fields.uid === 'w1').fields;
  assert.equal(bag.payments.reduce((n, p) => n + p.amountPesewas, 0), 8000, 'in the waiter’s cash');

  // MoMo: the prompt goes to their phone, the invoice is texted; it closes by itself once paid.
  const m = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W1, body: { table: '8', lines: [{ productId: 'beer', qty: 1 }] } }), 'order 2');
  await barMakes(ctx, m.roundId);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: m.roundId, action: 'delivered' } }), 'got');
  assert.match((await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W1, body: { tabId: m.tabId, method: 'momo' } })).data.error, /MoMo number/);
  const p = ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W1, body: { tabId: m.tabId, method: 'momo', phone: '024 555 8080' } }), 'momo close');
  assert.equal(p.prompt, true);
  assert.equal(ctx.store.paystackCharges.at(-1).mobile_money.provider, 'mtn');
  assert.equal(ctx.store.paystackCharges.at(-1).amount, 2500);
  assert.match(ctx.store.sms.filter(x => x.to === '0245558080').at(-1).message, /MEMORIES INVOICE[\s\S]*bill\.html/);
  ctx.store.setPaystack(p.reference, { status: 'abandoned', currency: 'GHS', amount: 2500 });
  let w = ok(await ctx.call('GET', `/api/ops/tabs/charge?ref=${p.reference}`, { who: ctx.W1 }), 'still approving');
  assert.deepEqual([w.status, w.tabStatus], ['pending', 'open']);
  ctx.store.setPaystack(p.reference, { status: 'success', currency: 'GHS', amount: 2500 });
  w = ok(await ctx.call('GET', `/api/ops/tabs/charge?ref=${p.reference}`, { who: ctx.W1 }), 'paid');
  assert.deepEqual([w.status, w.tabStatus], ['issued', 'closed']);
  // Someone else's tab: refused.
  assert.equal((await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W2, body: { tabId: m.tabId, method: 'cash' } })).status, 403);
});

test('the bar sees every waiter’s tabs: drinks it gave each one (less what came back), per table, and what’s still unpaid', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const a = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W1, body: { table: '5', lines: [{ productId: 'beer', qty: 3 }] } }), 'W1 table 5');
  const b = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W1, body: { table: '6', lines: [{ productId: 'shot', qty: 2 }] } }), 'W1 table 6');
  const c = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W2, body: { table: '9', lines: [{ productId: 'beer', qty: 1 }] } }), 'W2 table 9');
  ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W2, body: { table: '10', lines: [{ productId: 'beer', qty: 4 }] } }), 'still at the bar');
  for (const r of [a, b, c]) await barMakes(ctx, r.roundId);
  // One beer from table 5 goes back to the bar.
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: a.roundId, action: 'received' } }), 'got them');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: a.roundId, action: 'delivered' } }), 'delivered');
  const line = ctx.store.get('rounds', a.roundId).fields.lines[0].lineId;
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: a.roundId, action: 'return', lineId: line, qty: 1 } }), 'send back');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: a.roundId, action: 'confirm_return', lineId: line } }), 'bar takes it back');
  // Table 6 pays in cash.
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: ctx.W1, body: { tabId: b.tabId, method: 'cash', amountPesewas: 6000 } }), 'cash');

  const d = ok(await ctx.call('GET', '/api/ops/bar/waiters', { who: ctx.B1 }), 'bar waiters');
  const efua = d.waiters.find(w => w.name === 'Efua Waiter'), kojo = d.waiters.find(w => w.name === 'Kojo Waiter');
  const t5 = efua.tabs.find(t => t.table === '5'), t6 = efua.tabs.find(t => t.table === '6');
  assert.equal(efua.tabs.length, 2);
  assert.deepEqual(t5.given, [{ name: 'Club beer', qty: 2, amountPesewas: 5000 }], 'the beer that came back isn’t counted');
  assert.deepEqual(t6.given, [{ name: 'Tequila shot', qty: 2, amountPesewas: 6000 }]);
  assert.equal(t6.balancePesewas, 0, 'table 6 paid');
  assert.equal(t5.balancePesewas, t5.totalPesewas, 'table 5 unpaid');
  assert.equal(efua.unpaidPesewas, t5.balancePesewas);
  assert.equal(kojo.givenQty, 1, 'an order still at the bar isn’t given yet');
  assert.equal(kojo.notConfirmedQty, 1, 'handed, waiting for Kojo’s “I got them”');
  // Waiters can't open the bar's view.
  assert.equal((await ctx.call('GET', '/api/ops/bar/waiters', { who: ctx.W1 })).status, 403);
});

test('cash chain: a waiter takes cash (no setting needed), hands it to the bar; the bar person’s cash includes it, and they hand it all to the Manager', async () => {
  const ctx = setup();
  await openingCount(ctx);
  const a = ok(await ctx.call('POST', '/api/ops/tabs/order', { who: ctx.W1, body: { table: '3', lines: [{ productId: 'beer', qty: 2 }] } }), 'order');
  await barMakes(ctx, a.roundId);
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: a.roundId, action: 'delivered' } }), 'got');
  ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.W1, body: { tabId: a.tabId, method: 'cash' } }), 'cash close');
  // The bar person sells over the counter for cash too.
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { lines: [{ productId: 'shot', qty: 1 }], stationId: 'main', fromBar: true, method: 'cash', amountPesewas: 3000 } }), 'bar sale');
  // The waiter hands their cash to the bar.
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.W1, body: { countedPesewas: 5000 } }), 'waiter counts');
  const list = ok(await ctx.call('GET', '/api/ops/cash/waiters', { who: ctx.B1 }), 'bar list');
  assert.deepEqual(list.waiting.map(x => [x.name, x.countedPesewas]), [['Efua Waiter', 5000]]);
  ok(await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.B1, body: { id: list.waiting[0].id, receivedPesewas: 5000 } }), 'bar receives');
  const mine = ok(await ctx.call('GET', '/api/ops/cash', { who: ctx.B1 }), 'bar cash').session;
  assert.equal(mine.expectedPesewas, 5000 + 3000, 'the waiter’s cash and the bar’s own sale');
  // The bar can't receive a cashier's or another bar person's cash: that goes to the Manager.
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.B1, body: { countedPesewas: 8000 } }), 'bar counts');
  const bid = ctx.store.list('cash_sessions').find(x => x.fields.uid === 'b1').id;
  assert.equal((await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.B1, body: { id: bid, receivedPesewas: 8000 } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.M1, body: { id: bid, receivedPesewas: 8000 } }), 'manager receives');
  const cs = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.M1 }), 'closing');
  assert.equal(cs.steps.find(s => s.key === 'cash').done, true);
  // Finance sees the cash in the night's sales.
  assert.equal(ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.F1 }), 'sales').totals.cashPesewas, 8000);
});
