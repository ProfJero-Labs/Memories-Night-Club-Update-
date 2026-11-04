// The Human manager's people work and the payment flows that need a director: salaries (fixed,
// monthly), bonuses, deductions, loans; purchases (the Manager asks, finance checks the limits, a
// director approves); cash going to the Manager; customer reviews; performance reviews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { nightKey } from '../src/lib/util.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, costPesewas: 1200, lowStock: 24, maxStock: 120, available: true, tracked: true });
  store.seed('stock_moves', 'seed', { productId: 'beer', stationId: 'main', qty: 20, kind: 'received', businessDate: '2000-01-01' });
  const people = { hr: ['Abena HR', 'hrManager'], m1: ['Akos Manager', 'manager'], f1: ['Esi Finance', 'finance'], d1: ['Nana Director', 'director'], d2: ['Kwame Director', 'director'], b1: ['Ama Bartender', 'barStaff'], dj: ['Kofi DJ', 'dj'], w1: ['Efua Waiter', 'waitStaff'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400002${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.98.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const P = Object.fromEntries(Object.keys(people).map(k => [k.toUpperCase(), as(k)]));
  return { store, call, ...P };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };

test('directors are not on payroll: no salary, bonus or loan for them, not in the month, no My pay', async () => {
  const ctx = setup();
  const month = nightKey(new Date()).slice(0, 7);
  assert.equal((await ctx.call('POST', '/api/ops/pay/details', { who: ctx.HR, body: { uid: 'd1', salaryPesewas: 500000 } })).status, 404, 'no salary for a director');
  assert.equal((await ctx.call('POST', '/api/ops/pay/item', { who: ctx.HR, body: { uid: 'd2', month, kind: 'bonus', amountPesewas: 10000, reason: 'x' } })).status, 404, 'no bonus for a director');
  assert.equal((await ctx.call('POST', '/api/ops/loans', { who: ctx.HR, body: { uid: 'd1', amountPesewas: 10000, monthlyPesewas: 1000, reason: 'x' } })).status, 404, 'no loan for a director');
  ok(await ctx.call('POST', '/api/ops/pay/details', { who: ctx.HR, body: { uid: 'dj', salaryPesewas: 150000 } }), 'staff still paid');
  const pr = ok(await ctx.call('GET', `/api/ops/payroll?month=${month}`, { who: ctx.HR }), 'payroll');
  const staff = pr.staff.map(x => x.uid), lines = pr.lines.map(x => x.uid);
  assert.ok(!staff.includes('d1') && !staff.includes('d2'), 'directors are not listed for pay');
  assert.ok(!lines.includes('d1') && !lines.includes('d2'), 'nor in the month’s salaries');
  assert.ok(staff.includes('dj') && lines.includes('dj'), 'staff are');
  assert.equal(ok(await ctx.call('GET', '/api/ops/my-pay', { who: ctx.D1 }), 'my pay').onPayroll, false);
  assert.equal(ok(await ctx.call('GET', '/api/ops/my-pay', { who: ctx.DJ }), 'dj my pay').onPayroll, true);
});

test('salaries: the Human manager sets them, adds a bonus, a deduction and a loan; a director approves; finance pays; the staff member is texted and sees the payslip', async () => {
  const ctx = setup();
  const month = nightKey(new Date()).slice(0, 7);
  assert.equal((await ctx.call('POST', '/api/ops/pay/details', { who: ctx.M1, body: { uid: 'dj', salaryPesewas: 150000 } })).status, 403, 'only the Human manager');
  ok(await ctx.call('POST', '/api/ops/pay/details', { who: ctx.HR, body: { uid: 'dj', salaryPesewas: 150000, payMethod: 'momo', momoNumber: '0244555666', momoName: 'Kofi Mensah' } }), 'dj pay');
  ok(await ctx.call('POST', '/api/ops/pay/details', { who: ctx.HR, body: { uid: 'b1', salaryPesewas: 100000, payMethod: 'bank', bankName: 'GCB', bankAccount: '1234567', accountName: 'Ama B' } }), 'bar pay');
  ok(await ctx.call('POST', '/api/ops/pay/item', { who: ctx.HR, body: { uid: 'dj', month, kind: 'bonus', amountPesewas: 20000, reason: 'Packed Saturday' } }), 'bonus');
  ok(await ctx.call('POST', '/api/ops/pay/item', { who: ctx.HR, body: { uid: 'b1', month, kind: 'deduction', amountPesewas: 5000, reason: 'Late 3 times' } }), 'deduction');
  // A loan: recorded, a director approves, finance pays it out; it comes off the salary.
  const loan = ok(await ctx.call('POST', '/api/ops/loans', { who: ctx.HR, body: { uid: 'b1', amountPesewas: 30000, monthlyPesewas: 10000, reason: 'School fees' } }), 'loan');
  assert.match((await ctx.call('POST', '/api/ops/loans/pay', { who: ctx.F1, body: { id: loan.id } })).data.error, /director must approve/);
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D2, body: { kind: 'loan', id: loan.id, approve: true } }), 'either director');
  ok(await ctx.call('POST', '/api/ops/loans/pay', { who: ctx.F1, body: { id: loan.id, paidWith: 'momo' } }), 'loan paid out');
  assert.match(ctx.store.sms.at(-1).message, /loan of GHS 300/);

  let pr = ok(await ctx.call('GET', `/api/ops/payroll?month=${month}`, { who: ctx.HR }), 'draft');
  const net = uid => pr.lines.find(l => l.uid === uid).netPesewas;
  assert.deepEqual([net('dj'), net('b1')], [170000, 100000 - 5000 - 10000]);
  assert.match((await ctx.call('POST', '/api/ops/payroll/pay', { who: ctx.F1, body: { month } })).data.error, /director must approve/);
  ok(await ctx.call('POST', '/api/ops/payroll/submit', { who: ctx.HR, body: { month } }), 'sent');
  assert.match((await ctx.call('POST', '/api/ops/pay/item', { who: ctx.HR, body: { uid: 'dj', month, kind: 'bonus', amountPesewas: 100, reason: 'x' } })).data.error, /sent to the directors/);
  // Sent back by a director with a reason: a draft again. Then sent and approved.
  assert.match((await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'payroll', id: month, approve: false } })).data.error, /what needs changing/);
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'payroll', id: month, approve: false, note: 'Check the DJ bonus' } }), 'sent back');
  ok(await ctx.call('POST', '/api/ops/payroll/submit', { who: ctx.HR, body: { month } }), 'sent again');
  const todo = ok(await ctx.call('GET', '/api/ops/to-approve', { who: ctx.D1 }), 'list');
  assert.equal(todo.items.find(i => i.kind === 'payroll').amountPesewas, 255000);
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'payroll', id: month, approve: true } }), 'approved');
  // The month view shows the salaries as still to pay.
  assert.equal(ok(await ctx.call('GET', `/api/ops/budget?month=${month}`, { who: ctx.D2 }), 'month').salaries.netPesewas, 255000);
  ok(await ctx.call('POST', '/api/ops/payroll/pay', { who: ctx.F1, body: { month, uid: 'dj', payRef: 'MM-1' } }), 'pay the DJ');
  assert.match(ctx.store.sms.at(-1).message, /Your pay for .*GHS 1,700.*MoMo 024\*\*\*5666/s);
  const mine = ok(await ctx.call('GET', '/api/ops/my-pay', { who: ctx.DJ }), 'dj payslip');
  assert.deepEqual([mine.payslips[0].netPesewas, mine.payslips[0].statusLabel, mine.payslips[0].lines.map(l => l.label)], [170000, 'Paid', ['Monthly salary', 'Bonus']]);
  ok(await ctx.call('POST', '/api/ops/payroll/pay', { who: ctx.F1, body: { month } }), 'pay the rest');
  const bar = ok(await ctx.call('GET', '/api/ops/my-pay', { who: ctx.B1 }), 'bar');
  assert.equal(bar.loanLeftPesewas, 20000, 'one repayment taken');
  const money = ok(await ctx.call('GET', '/api/ops/money?period=month', { who: ctx.D1 }), 'money');
  assert.deepEqual([money.moneyOut.find(x => x.key === 'staff').amountPesewas, money.moneyOut.find(x => x.key === 'loans').amountPesewas], [255000, 30000]);
});

test('purchases: the Manager asks, finance checks the maximum, a director approves, the Manager buys and the bar confirms', async () => {
  const ctx = setup();
  const look = ok(await ctx.call('GET', '/api/ops/purchases', { who: ctx.M1 }), 'stock');
  const beer = look.stock.find(s => s.productId === 'beer');
  assert.deepEqual([beer.stockNow, beer.min, beer.max, beer.low, beer.suggestQty], [20, 24, 120, true, 100], 'low: suggest filling to the maximum');
  assert.equal((await ctx.call('POST', '/api/ops/purchases', { who: ctx.F1, body: { stationId: 'main', lines: [{ productId: 'beer', qty: 1 }] } })).status, 403, 'the Manager asks');
  const r = ok(await ctx.call('POST', '/api/ops/purchases', { who: ctx.M1, body: { stationId: 'main', lines: [{ productId: 'beer', qty: 150 }], note: 'For the weekend' } }), 'ask');
  assert.match((await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'purchase', id: r.id, approve: true } })).data.error, /Finance checks it first/);
  assert.match((await ctx.call('POST', '/api/ops/purchases/check', { who: ctx.F1, body: { id: r.id } })).data.error, /over the maximum of 120/);
  ok(await ctx.call('POST', '/api/ops/purchases/check', { who: ctx.F1, body: { id: r.id, lines: [{ productId: 'beer', qty: 96 }] } }), 'finance lowers to 96');
  assert.match((await ctx.call('POST', '/api/ops/stock/received', { who: ctx.M1, body: { stationId: 'main', productId: 'beer', qty: 96, purchaseId: r.id } })).data.error, /isn’t approved/);
  const item = ok(await ctx.call('GET', '/api/ops/to-approve', { who: ctx.D2 }), 'director').items.find(i => i.kind === 'purchase');
  assert.equal(item.amountPesewas, 96 * 1200);
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D2, body: { kind: 'purchase', id: r.id, approve: true } }), 'approved');
  const d = ok(await ctx.call('POST', '/api/ops/stock/received', { who: ctx.M1, body: { stationId: 'main', productId: 'beer', qty: 96, totalCostPesewas: 115200, purchaseId: r.id } }), 'bought');
  ok(await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B1, body: { id: d.id, action: 'confirm' } }), 'bar confirms');
  assert.equal(ctx.store.get('purchase_requests', r.id).fields.status, 'bought');
  const after = ok(await ctx.call('GET', '/api/ops/purchases', { who: ctx.M1 }), 'after').stock.find(s => s.productId === 'beer');
  assert.equal(after.stockNow, 116);
});

test('cash goes to the Manager after the count; a difference needs a note', async () => {
  const ctx = setup();
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 4 }], method: 'cash' } }), 'sale');
  const sid = `${nightKey(new Date())}__b1`;
  assert.match((await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.M1, body: { id: sid, receivedPesewas: 10000 } })).data.error, /hasn’t counted/);
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.B1, body: { countedPesewas: 10000 } }), 'bar counts');
  assert.equal((await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.HR, body: { id: sid, receivedPesewas: 10000 } })).status, 403, 'the Manager receives cash');
  assert.match((await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.M1, body: { id: sid, receivedPesewas: 9000 } })).data.error, /counted GHS 100; you have GHS 90/);
  const r = ok(await ctx.call('POST', '/api/ops/cash/receive', { who: ctx.M1, body: { id: sid, receivedPesewas: 9000, note: 'GHS 10 short in the bag' } }), 'received');
  assert.equal(r.differencePesewas, -1000);
  const all = ok(await ctx.call('GET', '/api/ops/cash/all', { who: ctx.F1 }), 'finance sees').sessions.find(s => s.id === sid);
  assert.deepEqual([all.receivedPesewas, all.receivedByName], [9000, 'Akos Manager']);
});

test('customer reviews (no sign-in): the directors read them, the Manager or Human manager follows up a complaint; performance reviews reach the staff member', async () => {
  const ctx = setup();
  assert.match((await ctx.call('POST', '/api/guest/review', { body: { rating: 9 } })).data.error, /1 to 5/);
  ok(await ctx.call('POST', '/api/guest/review', { body: { rating: 5, comment: 'Great music!', source: 'qr' } }), 'good');
  ok(await ctx.call('POST', '/api/guest/review', { body: { rating: 1, comment: 'Waited 40 minutes for drinks', name: 'Akua', phone: '024 111 2222', source: 'bill' } }), 'bad');
  const d = ok(await ctx.call('GET', '/api/ops/reviews', { who: ctx.D1 }), 'director');
  assert.deepEqual([d.count, d.average, d.open, d.canHandle], [2, 3, 1, false]);
  assert.equal((await ctx.call('GET', '/api/ops/reviews', { who: ctx.W1 })).status, 403);
  const bad = d.reviews.find(r => r.complaint);
  ok(await ctx.call('POST', '/api/ops/reviews/handle', { who: ctx.M1, body: { id: bad.id, note: 'Called her; free drinks next visit' } }), 'manager follows up');
  assert.equal(ok(await ctx.call('GET', '/api/ops/reviews', { who: ctx.HR }), 'hr').open, 0);

  const month = nightKey(new Date()).slice(0, 7);
  assert.match((await ctx.call('POST', '/api/ops/perf', { who: ctx.HR, body: { uid: 'dj', month, scores: { punctual: 5 } } })).data.error, /from 1 to 5/);
  ok(await ctx.call('POST', '/api/ops/perf', { who: ctx.HR, body: { uid: 'dj', month, scores: { punctual: 5, attitude: 4, customers: 5, work: 5, rules: 3 }, comment: 'Great energy. Watch the volume after 3am.' } }), 'review');
  const mine = ok(await ctx.call('GET', '/api/ops/reviews/mine', { who: ctx.DJ }), 'dj reads');
  assert.deepEqual([mine.reviews[0].overall, mine.reviews[0].comment], [4.4, 'Great energy. Watch the volume after 3am.']);
  ok(await ctx.call('POST', '/api/ops/perf/reply', { who: ctx.DJ, body: { id: mine.reviews[0].id, reply: 'Thank you, noted.' } }), 'reply');
  // The directors review the Human manager; the Human manager can't review the managers.
  assert.equal((await ctx.call('POST', '/api/ops/perf', { who: ctx.HR, body: { uid: 'm1', month, scores: { punctual: 5, attitude: 5, customers: 5, work: 5, rules: 5 } } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/perf', { who: ctx.D1, body: { uid: 'hr', month, scores: { punctual: 5, attitude: 5, customers: 4, work: 4, rules: 5 }, comment: 'Good month.' } }), 'director reviews the Human manager');
  assert.equal(ok(await ctx.call('GET', '/api/ops/reviews/mine', { who: ctx.HR }), 'hr reads').reviews[0].byName, 'Nana Director');
  assert.equal(ok(await ctx.call('GET', `/api/ops/perf?month=${month}`, { who: ctx.D1 }), 'director sees').done, 2, 'the DJ and the Human manager');
});

test('the Event manager serves a table like a waiter: opens it, sends drinks, takes the cash', async () => {
  const ctx = setup();
  ctx.store.seed('users', 'ev', { name: 'Yaa Events', role: 'eventManager', phone: '0240000299' });
  const EV = { uid: 'ev', role: 'eventManager' };
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: EV, body: { table: 'VIP 2', customerName: 'Birthday group' } }), 'open');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: EV, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'drinks');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.id, action: 'hand' } }), 'bar');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: EV, body: { roundId: r.id, action: 'delivered' } }), 'got them');
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: EV, body: { tabId: tab.id, method: 'cash', amountPesewas: 5000 } }), 'cash');
  ok(await ctx.call('POST', '/api/ops/tabs/close', { who: EV, body: { tabId: tab.id } }), 'close');
  assert.equal(ok(await ctx.call('GET', '/api/ops/my-report', { who: EV }), 'report').figures.cashCollectedPesewas, 5000);
});

test('closing the night: the Manager (or a director) closes it; if the Manager can’t, they hand it over and the Human manager or Event manager who accepts closes it', async () => {
  const ctx = setup();
  ctx.store.seed('users', 'ev', { name: 'Yaa Events', role: 'eventManager', phone: '0240000299' });
  const EV = { uid: 'ev', role: 'eventManager' };
  const close = who => ctx.call('POST', '/api/ops/close-night', { who, body: { confirmEarly: true, closeAnyway: true } });
  assert.equal((await close(ctx.HR)).status, 403, 'not without a handover');
  let st = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.D1 }), 'director looks');
  assert.deepEqual([st.closer.canClose, st.closer.handover], [true, null], 'a director can end the night');
  // The Manager can't be there tonight: hands over with a reason.
  assert.equal((await ctx.call('POST', '/api/ops/close-night/hand-over', { who: ctx.HR, body: { note: 'x' } })).status, 403);
  assert.match((await ctx.call('POST', '/api/ops/close-night/hand-over', { who: ctx.M1, body: {} })).data.error, /Say why/);
  const ho = ok(await ctx.call('POST', '/api/ops/close-night/hand-over', { who: ctx.M1, body: { note: 'Family emergency, left at 1am' } }), 'handed over');
  assert.deepEqual(ho.told.sort(), ['Abena HR', 'Yaa Events'], 'the other managers are texted');
  assert.match(ctx.store.sms.at(-1).message, /can't close tonight \(Family emergency/);
  assert.equal(ok(await ctx.call('GET', '/api/ops/notices', { who: ctx.HR }), 'notice').notices[0].title, 'Akos Manager can’t close tonight');
  st = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.HR }), 'hr sees it');
  assert.deepEqual([st.closer.handover.note, st.closer.canAccept, st.closer.canClose], ['Family emergency, left at 1am', true, false]);
  assert.equal((await ctx.call('POST', '/api/ops/close-night/accept', { who: ctx.D1, body: {} })).status, 403, 'a director doesn’t take it');
  ok(await ctx.call('POST', '/api/ops/close-night/accept', { who: EV, body: {} }), 'the Event manager accepts');
  assert.match((await ctx.call('POST', '/api/ops/close-night/accept', { who: ctx.HR, body: {} })).data.error, /Yaa Events is already closing/);
  assert.equal((await close(ctx.HR)).status, 403, 'only the one who accepted');
  const done = ok(await close(EV), 'the Event manager closes');
  assert.equal(done.closed, true);
  st = ok(await ctx.call('GET', '/api/ops/closing', { who: ctx.D1 }), 'after');
  assert.deepEqual([st.night.status, st.night.closedByName, st.closer.handover.acceptedByName], ['closed', 'Yaa Events', 'Yaa Events']);
});

test('the Human manager sees only the staff he looks after: no directors, no shares', async () => {
  const ctx = setup();
  const hr = ok(await ctx.call('GET', '/api/admin/people', { who: ctx.HR }), 'hr list');
  const roles = hr.staff.map(s => s.role);
  assert.ok(roles.includes('dj') && roles.includes('barStaff') && roles.includes('waitStaff'), 'his staff');
  assert.ok(!roles.includes('director') && !roles.includes('manager') && !roles.includes('finance'), 'not the directors or other managers');
  assert.ok(!JSON.stringify(hr).includes('sharePct'));
  const d = ok(await ctx.call('GET', '/api/admin/people', { who: ctx.D1 }), 'director list');
  assert.ok(d.staff.some(s => s.role === 'director'), 'a director still sees everyone');
});

test('no fixed closing time: the night stays open until it is closed, then the next sale starts a new night', async () => {
  const ctx = setup();
  const day = ms => new Date(Date.now() + ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' });
  const yesterday = day(-864e5), today = day(0);
  // A night that started yesterday evening and is still going (it's long past 4AM).
  ctx.store.seed('config', 'night', { date: yesterday, startedAt: new Date(Date.now() - 864e5).toISOString() });
  const t1 = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.M1, body: { table: '3' } }), 'open late');
  assert.equal(ctx.store.get('tabs', t1.id).fields.businessDate, yesterday, 'still the open night, however late');
  const s1 = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.D1 }), 'sales');
  assert.deepEqual([s1.date, s1.isOpenNight], [yesterday, true]);
  // A director ends it.
  ok(await ctx.call('POST', '/api/ops/close-night', { who: ctx.D1, body: { date: yesterday } }), 'a director closes');
  const t2 = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.M1, body: { table: '4' } }), 'open after');
  assert.equal(ctx.store.get('tabs', t2.id).fields.businessDate, today, 'the next night has started');
  const s2 = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.M1 }), 'sales after');
  assert.deepEqual([s2.date, s2.previous?.date], [today, yesterday], 'last night is one tap away');
});

test('closing a tab: drinks the bar handed over count as delivered; only drinks still at the bar stop it', async () => {
  const ctx = setup();
  const W = ctx.M1;
  const t = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: W, body: { table: '7' } }), 'open');
  const r1 = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: W, body: { tabId: t.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'order');
  const rid = r1.roundId || r1.id;
  // Still at the bar: the close says so, and names it.
  const blocked = await ctx.call('POST', '/api/ops/tabs/checkout', { who: W, body: { tabId: t.id, method: 'cash' } });
  assert.equal(blocked.data.code, 'at_bar'); assert.equal(blocked.data.atBar.length, 1);
  // The bar hands it over; the waiter never taps "I got them".
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: rid, action: 'hand' } }), 'handed');
  const c = ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: W, body: { tabId: t.id, method: 'momo_club', momoRef: 'MP123456789' } }), 'close with MoMo to the club');
  assert.deepEqual([c.closed, c.momoPesewas], [true, 5000]);
  assert.equal(ctx.store.get('rounds', rid).fields.status, 'delivered');
  // An empty tab (opened by mistake) closes too.
  const e = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: W, body: { table: '8' } }), 'open empty');
  assert.equal(ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: W, body: { tabId: e.id, method: 'cash' } }), 'close empty').closed, true);
});

test('stock value: what finance recorded coming in, minus what left, at cost price; flags what makes it wrong', async () => {
  const ctx = setup();
  ctx.store.seed('menu_items', 'gin', { name: 'House gin', category: 'Spirits', unit: 'bottle', pricePesewas: 30000, available: true, tracked: true });
  ctx.store.seed('stock_moves', 'gin-in', { productId: 'gin', stationId: 'main', qty: 2, kind: 'received', businessDate: '2000-01-01' });
  ctx.store.seed('stock_moves', 'beer-out', { productId: 'beer', stationId: 'main', qty: -5, kind: 'issue', businessDate: '2000-01-02' });
  assert.equal((await ctx.call('GET', '/api/ops/stock/value', { who: ctx.B1 })).status, 403, 'not the bartenders');
  const v = ok(await ctx.call('GET', '/api/ops/stock/value', { who: ctx.D1 }), 'director');
  assert.equal(v.totals.costValuePesewas, 15 * 1200, '15 beers at cost (gin has no cost yet)');
  assert.equal(v.totals.priceValuePesewas, 15 * 2500 + 2 * 30000);
  assert.deepEqual(v.noCostPrice, ['House gin']);
  ok(await ctx.call('GET', '/api/ops/stock/value', { who: ctx.F1 }), 'finance');
});

test('Paystack asks for a code before the MoMo prompt: the customer types it on their bill link, the waiter does nothing', async () => {
  const ctx = setup();
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url?.url || url);
    if (u.startsWith('https://api.paystack.co/charge')) {
      calls.push([u.replace('https://api.paystack.co', ''), JSON.parse(init.body)]);
      const status = u.endsWith('/submit_otp') ? (JSON.parse(init.body).otp === '123456' ? 'pay_offline' : 'failed') : 'send_otp';
      return new Response(JSON.stringify({ status: true, data: { status } }), { status: 200 });
    }
    return real(url, init);
  };
  try {
    const t = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.M1, body: { table: '2' } }), 'open');
    const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.M1, body: { tabId: t.id, lines: [{ productId: 'beer', qty: 1 }] } }), 'order');
    ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.roundId || r.id, action: 'hand' } }), 'handed');
    const c = ok(await ctx.call('POST', '/api/ops/tabs/checkout', { who: ctx.M1, body: { tabId: t.id, method: 'momo', phone: '0241112222' } }), 'momo');
    assert.equal(c.otp, true); assert.match(c.message, /They type it on the link/);
    assert.equal(ctx.store.get('pending_checkouts', c.reference).fields.status, 'pending', 'still waiting, not failed');
    const sms = ctx.store.sms.at(-1); assert.equal(sms.to, '0241112222'); assert.match(sms.message, /Paystack has texted you a code/);
    const token = ctx.store.get('tabs', t.id).fields.billToken;
    const pub = await ctx.call('GET', `/api/guest/bill/${token}`); assert.equal(pub.data.codeNeeded, true, 'the bill page asks for the code');
    assert.match((await ctx.call('POST', `/api/guest/bill/${token}/code`, { body: { otp: '999999' } })).data.error, /didn’t accept/);
    const okc = await ctx.call('POST', `/api/guest/bill/${token}/code`, { body: { otp: '123 456' } });
    assert.equal(okc.data.accepted, true);
    assert.deepEqual(calls.at(-1), ['/charge/submit_otp', { otp: '123456', reference: c.reference }]);
    assert.equal((await ctx.call('GET', `/api/guest/bill/${token}`)).data.codeNeeded, false, 'asked once');
  } finally { globalThis.fetch = real; }
});

test('every sale, one by one: the directors see what was bought, by whom, how it was paid; filters narrow it', async () => {
  const ctx = setup();
  ctx.store.seed('users', 'w9', { name: 'Efua Waiter', role: 'waitStaff', phone: '0240009999' });
  const W = { uid: 'w9', role: 'waitStaff' };
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { lines: [{ productId: 'beer', qty: 1 }], method: 'cash', fromBar: true } }), 'bar cash');
  const t = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: W, body: { table: '6', customerName: 'Kofi' } }), 'open');
  const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: W, body: { tabId: t.id, lines: [{ productId: 'beer', qty: 3 }] } }), 'order');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.roundId || r.id, action: 'hand' } }), 'handed');
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: W, body: { tabId: t.id, method: 'momo', amountPesewas: 5000, momoRef: 'MP555666777' } }), 'part MoMo');
  assert.equal((await ctx.call('GET', '/api/ops/sales/list', { who: ctx.B1 })).status, 403, 'not the bar');
  const all = ok(await ctx.call('GET', '/api/ops/sales/list?period=today', { who: ctx.D1 }), 'all');
  assert.deepEqual([all.totals.count, all.totals.salesPesewas, all.totals.paidPesewas, all.totals.leftPesewas], [2, 10000, 7500, 2500]);
  const tab = all.sales.find(s => s.label === `Tab ${t.number}`);
  assert.deepEqual([tab.where, tab.servedByName, tab.customerName, tab.lines[0].qty, tab.payments[0].takenByName, tab.payments[0].ref, tab.statusLabel], ['Table 6', 'Efua Waiter', 'Kofi', 3, 'Efua Waiter', 'MP555666777', 'Part paid']);
  assert.equal(ok(await ctx.call('GET', '/api/ops/sales/list?method=cash', { who: ctx.D1 }), 'cash').totals.count, 1);
  assert.equal(ok(await ctx.call('GET', '/api/ops/sales/list?method=unpaid', { who: ctx.D1 }), 'unpaid').sales[0].label, `Tab ${t.number}`);
  assert.equal(ok(await ctx.call('GET', '/api/ops/sales/list?person=w9', { who: ctx.M1 }), 'one waiter').totals.count, 1);
  assert.deepEqual(ok(await ctx.call('GET', '/api/ops/sales/list?period=week&drink=Club%20beer', { who: ctx.F1 }), 'one drink').drinkTotals, { name: 'Club beer', qty: 4, amountPesewas: 10000 });
});

test('QR menu, pay cash at the bar: a code at once; the bar takes the cash; it counts as a cash sale everywhere', async () => {
  const ctx = setup();
  const guest = (path, body) => ctx.call(body ? 'POST' : 'GET', path, { body });
  const o = (await guest('/api/guest/counter/checkout', { station: 'a'.repeat(32), payWith: 'cash', phone: '0247778888', spot: '9', items: [{ itemId: 'beer', qty: 2 }] })).data;
  assert.equal(o.cash, true); assert.ok(o.pickupCode);
  assert.match(ctx.store.sms.at(-1).message, /pay GHS 50 cash/);
  assert.match((await guest('/api/guest/counter/checkout', { station: 'a'.repeat(32), payWith: 'cash', phone: '0247778888', items: [{ itemId: 'beer', qty: 1 }] })).data.error, /already have an order waiting/, 'one unpaid cash order per phone');
  assert.equal((await guest(`/api/guest/counter/${o.orderId}`)).data.status, 'cash_due');
  const q = ok(await ctx.call('GET', '/api/bar/queue', { who: ctx.B1 }), 'queue');
  assert.deepEqual([q.cashDue.length, q.cashDue[0].pickupCode, q.orders.length], [1, o.pickupCode, 0]);
  const r = ok(await ctx.call('POST', '/api/bar/order', { who: ctx.B1, body: { orderId: o.orderId, action: 'cash' } }), 'cash received');
  assert.equal(r.status, 'cash_paid');
  assert.equal((await guest(`/api/guest/counter/${o.orderId}`)).data.status, 'cash_paid');
  const s = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.M1 }), 'sales');
  assert.deepEqual([s.totals.cashPesewas, s.totals.digitalPesewas, s.totals.salesPesewas], [5000, 0, 5000], 'cash, counted once');
  const my = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.B1 }), 'bartender report');
  assert.equal(my.figures.cashCollectedPesewas, 5000, 'in the bartender’s cash');
  assert.equal((await ctx.call('POST', '/api/bar/order', { who: ctx.B1, body: { orderId: o.orderId, action: 'cash' } })).data.error, 'Already paid and handed over.');
});

test('finance approves up to GHS 2,000, never what finance recorded; bigger ones wait for a director', async () => {
  const ctx = setup();
  const exp = async (who, amount) => ok(await ctx.call('POST', '/api/ops/expenses', { who, body: { category: 'supplies', description: 'Ice', amountPesewas: amount } }), 'expense').id;
  const small = await exp(ctx.M1, 50000), big = await exp(ctx.M1, 300000), own = await exp(ctx.F1, 20000);
  const list = ok(await ctx.call('GET', '/api/ops/to-approve', { who: ctx.F1 }), 'finance list');
  const can = Object.fromEntries(list.items.map(i => [i.id, i.canDecide]));
  assert.deepEqual([can[small], can[big], can[own]], [true, false, false]);
  assert.match((await ctx.call('POST', '/api/ops/approve', { who: ctx.F1, body: { kind: 'expense', id: big, approve: true } })).data.error, /director approves/);
  assert.match((await ctx.call('POST', '/api/ops/approve', { who: ctx.F1, body: { kind: 'expense', id: own, approve: true } })).data.error, /someone else approves/);
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.F1, body: { kind: 'expense', id: small, approve: true } }), 'finance approves');
  assert.equal(ctx.store.get('expenses', small).fields.approval, 'approved');
  ok(await ctx.call('POST', '/api/ops/approve', { who: ctx.D1, body: { kind: 'expense', id: big, approve: true } }), 'a director approves the big one');
  assert.equal((await ctx.call('POST', '/api/ops/approve', { who: ctx.M1, body: { kind: 'expense', id: own, approve: true } })).status, 403, 'not the Manager');
});

test('a tab closes by itself as soon as it’s fully paid: cash, the customer’s bill link (Paystack), or paid before the bar hands the drinks over', async () => {
  const ctx = setup();
  const W = ctx.M1;
  const tabWith = async (qty, hand = true) => {
    const t = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: W, body: { table: String(qty) } }), 'open');
    const r = ok(await ctx.call('POST', '/api/ops/tabs/round', { who: W, body: { tabId: t.id, lines: [{ productId: 'beer', qty }] } }), 'order');
    if (hand) ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: r.roundId || r.id, action: 'hand' } }), 'handed');
    return { t, rid: r.roundId || r.id };
  };
  const status = id => ctx.store.get('tabs', id).fields.status;
  // Cash in two parts: open after the first, closed after the second.
  const a = await tabWith(2);
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: W, body: { tabId: a.t.id, method: 'cash', amountPesewas: 2000 } }), 'part');
  assert.equal(status(a.t.id), 'open');
  const last = ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: W, body: { tabId: a.t.id, method: 'cash', amountPesewas: 3000 } }), 'rest');
  assert.deepEqual([last.closed, status(a.t.id)], [true, 'closed']);
  assert.equal((await ctx.call('POST', '/api/ops/tabs/checkout', { who: W, body: { tabId: a.t.id, method: 'cash' } })).data.already, true, 'tapping Close again is fine');
  // Paystack on the customer's bill link.
  const b = await tabWith(1);
  const token = ctx.store.get('tabs', b.t.id).fields.billToken;
  const start = await ctx.call('POST', `/api/guest/bill/${token}/pay`, { body: {} });
  ctx.store.setPaystack(start.data.reference, { status: 'success', currency: 'GHS', amount: start.data.chargePesewas });
  ok(await ctx.call('POST', '/api/checkout/verify', { body: { reference: start.data.reference } }), 'verify');
  assert.equal(status(b.t.id), 'closed', 'paid on the phone: closed');
  // Paid while the drinks are still at the bar: closes when the bar hands them over.
  const c = await tabWith(1, false);
  ok(await ctx.call('POST', '/api/ops/tabs/pay', { who: W, body: { tabId: c.t.id, method: 'cash', amountPesewas: 2500 } }), 'paid early');
  assert.equal(status(c.t.id), 'open', 'the drink is still being made');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: c.rid, action: 'hand' } }), 'handed');
  assert.equal(status(c.t.id), 'closed');
});
