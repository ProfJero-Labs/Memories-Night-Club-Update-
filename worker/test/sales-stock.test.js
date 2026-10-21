// Waiter and bar sales against real stock: nothing sells past zero (waiter orders, quick sales, QR
// orders before the guest pays), new stock counts only once a second person confirms it, quick
// sales by a waiter or at the bar, and bartenders taking cash like waiters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'beer', { name: 'Club beer', category: 'Beer', unit: 'bottle', pricePesewas: 2500, available: true, tracked: true });
  store.seed('menu_items', 'mojito', { name: 'Mojito', category: 'Cocktails', unit: 'glass', pricePesewas: 6000, available: true, tracked: false });
  const people = { w1: ['Efua Waiter', 'waitStaff'], b1: ['Ama Bartender', 'barStaff'], b2: ['Kwame Bartender', 'barStaff'], m1: ['Akos Manager', 'manager'], f1: ['Esi Finance', 'finance'], fo: ['Kofi Front', 'doorStaff'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400000${Object.keys(people).indexOf(uid)}0` });
  const as = uid => ({ uid, role: people[uid][1] });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.70.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: who.role }, { uid: who.uid })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await r.text();
    return { status: r.status, data: JSON.parse(text || '{}') };
  };
  return { store, env, call, W1: as('w1'), B1: as('b1'), B2: as('b2'), M1: as('m1'), F1: as('f1'), FO: as('fo') };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const left = async (ctx, pid = 'beer') => ok(await ctx.call('GET', '/api/ops/products?stationId=main', { who: ctx.W1 }), 'products').products.find(p => p.id === pid).left;
async function addStock(ctx, qty, by = ctx.F1, confirmBy = ctx.B1) {
  const d = ok(await ctx.call('POST', '/api/ops/stock/received', { who: by, body: { stationId: 'main', productId: 'beer', qty, supplier: 'Guinness Ghana' } }), 'record stock');
  ok(await ctx.call('POST', '/api/ops/stock/delivery', { who: confirmBy, body: { id: d.id, action: 'confirm' } }), 'confirm stock');
}

test('no stock: the waiter, the bar and the QR menu can’t sell it; QR is refused before any payment starts', async () => {
  const ctx = setup();
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '4' } }), 'open');
  assert.match((await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 1 }] } })).data.error, /Club beer is finished/);
  // Drinks the bar doesn't count (cocktails) never block.
  ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'mojito', qty: 2 }] } }), 'cocktail');
  assert.match((await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 1 }], method: 'cash' } })).data.error, /finished/);
  const menu = ok(await ctx.call('GET', `/api/guest/menu?station=${'a'.repeat(32)}`), 'menu');
  assert.equal(menu.items.find(i => i.id === 'beer').available, false, 'the QR menu shows it finished');
  const qr = await ctx.call('POST', '/api/guest/counter/checkout', { body: { station: 'a'.repeat(32), items: [{ itemId: 'beer', qty: 1 }], phone: '0241234567' } });
  assert.match(qr.data.error, /Sorry, Club beer is finished/);
  assert.equal(ctx.store.paystackInits.length, 0, 'no payment was started');
});

test('only what’s left: orders not yet handed over hold their drinks; QR refuses more than is left', async () => {
  const ctx = setup();
  await addStock(ctx, 3);
  assert.equal(await left(ctx), 3);
  const tab = ok(await ctx.call('POST', '/api/ops/tabs/open', { who: ctx.W1, body: { table: '4' } }), 'open');
  ok(await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } }), 'two beers');
  assert.equal(await left(ctx), 1, 'the two at the bar are held');
  assert.match((await ctx.call('POST', '/api/ops/tabs/round', { who: ctx.W1, body: { tabId: tab.id, lines: [{ productId: 'beer', qty: 2 }] } })).data.error, /Only 1 Club beer left/);
  const qr = await ctx.call('POST', '/api/guest/counter/checkout', { body: { station: 'a'.repeat(32), items: [{ itemId: 'beer', qty: 2 }], phone: '0241234567' } });
  assert.match(qr.data.error, /only 1 Club beer left/);
  assert.equal(ctx.store.paystackInits.length, 0);
});

test('new stock takes two people: finance records, the bar confirms; the bar records, finance or a manager confirms', async () => {
  const ctx = setup();
  const d = ok(await ctx.call('POST', '/api/ops/stock/received', { who: ctx.F1, body: { stationId: 'main', productId: 'beer', qty: 24, supplier: 'Guinness Ghana', reference: 'INV-88' } }), 'finance records');
  assert.equal(d.pending, true);
  assert.equal(await left(ctx), 0, 'not counted until confirmed');
  assert.equal((await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.F1, body: { id: d.id, action: 'confirm' } })).status, 403, 'not by the person who recorded it');
  const list = ok(await ctx.call('GET', '/api/ops/stock/deliveries?stationId=main', { who: ctx.B1 }), 'bar sees it');
  assert.deepEqual([list.forMe, list.deliveries[0].recordedByName, list.deliveries[0].canConfirm], [1, 'Esi Finance', true]);
  // The bar counted 22, not 24: allowed, with a note, and both numbers stay on record.
  assert.match((await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B1, body: { id: d.id, action: 'confirm', qty: 22 } })).data.error, /24 were recorded but you counted 22/);
  ok(await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B1, body: { id: d.id, action: 'confirm', qty: 22, note: 'Two short in the crate' } }), 'bar confirms 22');
  assert.equal(await left(ctx), 22);
  const rec = ctx.store.get('stock_deliveries', d.id).fields;
  assert.deepEqual([rec.qty, rec.confirmedQty, rec.recordedByName, rec.confirmedByName], [24, 22, 'Esi Finance', 'Ama Bartender']);
  assert.match((await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B1, body: { id: d.id, action: 'confirm' } })).data.error, /Already confirmed/);

  // The bar records it: another bartender can't confirm it, a manager can.
  const d2 = ok(await ctx.call('POST', '/api/ops/stock/received', { who: ctx.B1, body: { stationId: 'main', productId: 'beer', qty: 6 } }), 'bar records');
  assert.equal(d2.confirmBy, 'finance or a manager');
  assert.equal((await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B2, body: { id: d2.id, action: 'confirm' } })).status, 403);
  ok(await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.M1, body: { id: d2.id, action: 'confirm' } }), 'manager confirms');
  assert.equal(await left(ctx), 28);

  // Didn't arrive: refused with a reason, and nothing is added.
  const d3 = ok(await ctx.call('POST', '/api/ops/stock/received', { who: ctx.M1, body: { stationId: 'main', productId: 'beer', qty: 12 } }), 'manager records');
  assert.match((await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B1, body: { id: d3.id, action: 'reject' } })).data.error, /Say what happened/);
  ok(await ctx.call('POST', '/api/ops/stock/delivery', { who: ctx.B1, body: { id: d3.id, action: 'reject', note: 'Never came' } }), 'refused');
  assert.equal(await left(ctx), 28);
  assert.equal((await ctx.call('POST', '/api/ops/stock/received', { who: ctx.W1, body: { stationId: 'main', productId: 'beer', qty: 5 } })).status, 403, 'waiters can’t add stock');
});

test('stock added on an earlier night with no count since still counts tonight', async () => {
  const ctx = setup();
  ctx.store.seed('stock_moves', 'old', { productId: 'beer', stationId: 'main', qty: 10, kind: 'received', businessDate: '2026-01-02' });
  ctx.store.seed('stock_moves', 'old2', { productId: 'beer', stationId: 'main', qty: -4, kind: 'issue', businessDate: '2026-01-03' });
  assert.equal(await left(ctx), 6);
  const sheet = ok(await ctx.call('GET', '/api/ops/stock?stationId=main', { who: ctx.B1 }), 'sheet');
  assert.equal(sheet.rows.find(r => r.productId === 'beer').opening, 6);
  // The bar can still do its first opening count.
  ok(await ctx.call('POST', '/api/ops/stock/count', { who: ctx.B1, body: { stationId: 'main', kind: 'opening', lines: [{ productId: 'beer', counted: 5 }] } }), 'first count');
  assert.equal(await left(ctx), 5);
});

test('bar quick sale: cash or MoMo over the counter, out of stock at once, closed, in the bartender’s report and cash bag', async () => {
  const ctx = setup();
  await addStock(ctx, 10);
  const s = ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 3 }], method: 'cash' } }), 'cash sale');
  assert.deepEqual([s.totalPesewas, s.method], [7500, 'cash']);
  assert.equal(ctx.store.get('tabs', s.id).fields.status, 'closed');
  assert.equal(await left(ctx), 7, 'out of the bar’s stock straight away');
  assert.match((await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 1 }], method: 'momo' } })).data.error, /transaction ID/);
  ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 2 }], method: 'momo', momoRef: '77665544332' } }), 'momo sale');
  assert.match((await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 1 }], method: 'momo', momoRef: '77665544332' } })).data.error, /already recorded/);
  const mine = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.B1 }), 'bartender report').figures;
  assert.deepEqual([mine.salesPesewas, mine.cashCollectedPesewas, mine.momoRecordedPesewas, mine.withYouQty], [12500, 7500, 5000, 0]);
  const bag = ok(await ctx.call('GET', '/api/ops/cash', { who: ctx.B1 }), 'cash bag').session;
  assert.equal(bag.expectedPesewas, 7500);
  ok(await ctx.call('POST', '/api/ops/cash/close', { who: ctx.B1, body: { countedPesewas: 7500 } }), 'hand in cash');
  assert.match((await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.B1, body: { fromBar: true, lines: [{ productId: 'beer', qty: 1 }], method: 'cash' } })).data.error, /already handed in your cash/);
  const sales = ok(await ctx.call('GET', '/api/ops/sales', { who: ctx.F1 }), 'sales').totals;
  assert.deepEqual([sales.cashPesewas, sales.momoPesewas], [7500, 5000]);
  assert.equal((await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.FO, body: { fromBar: true, lines: [{ productId: 'beer', qty: 1 }], method: 'cash' } })).status, 403);
});

test('waiter quick sale: paid first, the bar makes it, the waiter confirms with one tap and it closes itself', async () => {
  const ctx = setup();
  await addStock(ctx, 10);
  const s = ok(await ctx.call('POST', '/api/ops/quick-sale', { who: ctx.W1, body: { lines: [{ productId: 'beer', qty: 2 }], method: 'cash' } }), 'waiter sale');
  assert.equal(await left(ctx), 8, 'held while at the bar');
  ok(await ctx.call('POST', '/api/ops/bar/round', { who: ctx.B1, body: { roundId: s.roundId, action: 'hand' } }), 'bar hands over');
  assert.equal(ctx.store.get('tabs', s.id).fields.status, 'open', 'not closed until the waiter confirms');
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: s.roundId, action: 'delivered' } }), 'I got them');
  assert.equal(ctx.store.get('tabs', s.id).fields.status, 'closed');
  // A drink the customer didn't take can still go back to the bar after that.
  const line = ctx.store.get('rounds', s.roundId).fields.lines[0];
  ok(await ctx.call('POST', '/api/ops/tabs/round-action', { who: ctx.W1, body: { roundId: s.roundId, action: 'return', lineId: line.lineId, qty: 1 } }), 'send one back');
  const fig = ok(await ctx.call('GET', '/api/ops/my-report', { who: ctx.W1 }), 'report').figures;
  assert.equal(fig.cashCollectedPesewas, 5000);
});
