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
  ok(await ctx.call('POST', '/api/ops/products', { who: ctx.F1, body: { id: 'shot', name: 'Tequila shot', category: 'Shots', unit: 'shot', pricePesewas: 5000 } }), 'price change');
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
  ok(await ctx.call('POST', '/api/ops/products', { who: ctx.M1, body: { id: 'beer', name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 3000, costPesewas: 1200 } }), 'manager price');
  const ch = ok(await ctx.call('GET', '/api/ops/changes', { who: ctx.F1 }), 'changes').changes.find(c => c.field === 'price');
  assert.deepEqual([ch.from, ch.to, ch.byName], [2500, 3000, 'Akos Manager']);
  assert.equal((await ctx.call('GET', '/api/ops/products', { who: ctx.W1 })).data.products[0].costPesewas, undefined, 'waiters never see costs');
});

test('5, 11, 12: an unpaid tab, free drinks by approval, Today’s sales, the guided close, the end-of-day report to finance, sign-off, and the night locked', async () => {
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

  // The close: it says what's missing.
  let cs = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.M1 }), 'closing');
  assert.deepEqual(cs.steps.map(s => [s.key, s.done]).slice(0, 4), [['waiters', false], ['bar', false], ['cash', false], ['front', false]]);
  assert.equal((await ctx.call('POST', '/api/ops/close-night', { who: ctx.M1, body: { confirmEarly: true } })).data.code, 'incomplete');
  ok(await ctx.call('POST', '/api/ops/my-report', { who: ctx.W1, body: {} }), 'w1 report');
  assert.equal((await ctx.call('POST', '/api/ops/my-report', { who: ctx.W2, body: {} })).data.code, 'needs_explanation', 'an unpaid bill needs an explanation');
  ok(await ctx.call('POST', '/api/ops/my-report', { who: ctx.W2, body: { explanation: 'Table 9 left without paying; security has the details.' } }), 'w2 report');
  ok(await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', lines: [{ productId: 'beer', counted: 47 }, { productId: 'shot', counted: 18 }] } }), 'bar count');
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.C1, body: { countedPesewas: 8000 } }), 'cash count');
  ok(await ctx.call('POST', '/api/ops/front-report', { who: ctx.FO, body: {} }), 'front office');
  cs = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.M1 }), 'closing');
  assert.ok(cs.steps.slice(0, 4).every(s => s.done), JSON.stringify(cs.steps));

  // 12: finance gets the report; the night locks.
  const closed = ok(await ctx.call('POST', '/api/ops/close-night', { who: ctx.M1, body: { confirmEarly: true } }), 'close night');
  assert.equal(closed.sent, true);
  assert.equal(ctx.store.emails.at(-1).to, 'finance@memories.test');
  const eod = ok(await ctx.call('GET', '/api/ops/eod', { who: ctx.F1 }), 'eod').report;
  assert.deepEqual([eod.report.sales.totals.salesPesewas, eod.report.exceptions.unpaidTabs.length, eod.closedByName], [10500, 1, 'Akos Manager']);
  assert.equal((await ctx.call('POST', '/api/ops/eod/sign-off', { who: ctx.M1, body: {} })).status, 403, 'the closer doesn’t sign off for finance');
  ok(await ctx.call('POST', '/api/ops/eod/sign-off', { who: ctx.F1, body: { note: 'Checked.' } }), 'finance signs off');
  assert.equal((await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W2, body: { tabId: unpaid.id, lines: [{ productId: 'beer', qty: 1 }] } })).status, 400, 'closed night: no new drinks on its tabs');
  assert.equal((await ctx.call('POST', '/api/ops/stock/waste', { who: ctx.B1, body: { stationId: 'main', productId: 'beer', qty: 1, reason: 'broken' } })).status, 409, 'closed night: stock locked');
  // The unpaid tab can still be paid later, or written off with approval.
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
  assert.match(sms.message, /Total GHS 135/); assert.match(sms.message, /To pay GHS 135/); assert.match(sms.message, /bill\.html\?t=/);

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
  assert.match(ctx.store.sms.at(-1).message, /Paid GHS 100\nTo pay GHS 35/);
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
