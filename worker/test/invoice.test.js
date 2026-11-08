// A bill above GHS 2,000 is sent as an invoice (one text with a link). The customer pays MoMo to the
// club's wallet and may give the MoMo transaction ID on their invoice page; the MoMo phone matches
// MTN's own text to the bill. The ID never confirms anything by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const MTN = (amount, bal, tx, from = 'KWAME MENSAH') => `Payment received for GHS ${amount} from ${from} Current Balance: GHS ${bal} . Available Balance: GHS ${bal}. Transaction Id: ${tx}.`;
const CASHOUT = (amount, bal, tx) => `Cash Out made for GHS ${amount} to AGENT. Current Balance: GHS ${bal}. Financial Transaction Id: ${tx}. Fee was GHS 0.50`;

function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('settings', 'commercial', {}); // the owner's rules, as live
  store.seed('bar_stations', 'main', { name: 'Main bar', token: 'a'.repeat(32), open: true });
  store.seed('menu_items', 'magnum', { name: 'Magnum', category: 'Bottles', pricePesewas: 150000, costPesewas: 70000, available: true, tracked: true });
  store.seed('stock_moves', 'in-magnum', { productId: 'magnum', stationId: 'main', qty: 30, kind: 'received', businessDate: '2000-01-01' });
  const people = { w1: ['Efua Waiter', 'waitStaff'], b1: ['Ama Bartender', 'barStaff'], m1: ['Akos Manager', 'manager'], hr: ['Abena HR', 'hrManager'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400006${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who, raw, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.98.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers };
    if (who) h.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: h, body: raw ?? (body ? JSON.stringify(body) : undefined) }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const phone = async () => {
    const { code } = ok(await call('POST', '/api/ops/momo-phone/code', { who: 'm1' }), 'code');
    const { deviceId, secret } = ok(await call('POST', '/api/momo-phone/pair', { body: { code, name: 'Business phone' } }), 'pair');
    const texts = async msgs => {
      const raw = JSON.stringify({ messages: msgs.map(body => ({ from: 'MobileMoney', body, receivedAt: new Date().toISOString() })) }), time = String(Date.now());
      const sign = createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex');
      return (await call('POST', '/api/momo-phone/texts', { raw, headers: { 'x-momo-device': deviceId, 'x-momo-time': time, 'x-momo-sign': sign } })).data.results.map(x => x.status);
    };
    await texts([CASHOUT('50.00', '1,000.00', '99887766')]); // starts the balance chain
    return { texts };
  };
  const barMakes = async rid => { for (const action of ['preparing', 'ready', 'hand']) ok(await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: rid, action } }), `bar ${action}`); };
  // A waiter's GHS 3,000 table, invoice sent to the customer's phone.
  const bigTab = async (table, custPhone) => {
    const o = ok(await call('POST', '/api/ops/tabs/order', { who: 'w1', body: { table, lines: [{ productId: 'magnum', qty: 2 }] } }), 'order');
    await barMakes(o.roundId);
    const sent = ok(await call('POST', '/api/ops/tabs/text-bill', { who: 'w1', body: { tabId: o.tabId, phone: custPhone } }), 'send the invoice');
    const wid = store.list('wallet_payments').find(w => w.fields.tabId === o.tabId).id;
    const token = store.get('tabs', o.tabId).fields.billToken;
    return { ...o, sent, wid, token };
  };
  return { store, env, call, phone, barMakes, bigTab };
}

test('the invoice: one text with a link; the page shows the bill and the number to pay to', async () => {
  const { store, call, bigTab } = setup();
  const t = await bigTab('VIP', '0244445555');
  assert.deepEqual([t.sent.sent, t.sent.wallet], [true, true]);
  const text = store.sms.filter(s => s.to === '0244445555').at(-1).message;
  assert.match(text, /^MEMORIES: your bill is GHS 3,100\. Open to pay: https:\/\/memories\.test\/bill\.html\?t=\w+$/, 'short, with the link');
  const page = ok(await call('GET', `/api/guest/bill/${t.token}`), 'invoice page');
  assert.deepEqual([page.walletWait.duePesewas, page.walletWait.number, page.bill.totalPesewas], [310000, '0595986313', 300000]);
  // Sent again: the same payment, the text goes again.
  ok(await call('POST', '/api/ops/tabs/text-bill', { who: 'w1', body: { tabId: t.tabId, phone: '0244445555' } }), 'again');
  assert.equal(store.list('wallet_payments').filter(w => w.fields.tabId === t.tabId).length, 1);
  assert.equal(store.sms.filter(s => s.to === '0244445555').length, 2);
});

test('two tables owe the same amount: the ID the customer gives tells the phone which one paid (text first, or ID first)', async () => {
  const { store, call, phone, bigTab } = setup();
  const p = await phone();
  const a = await bigTab('VIP 1', '0244445555'), b = await bigTab('VIP 2', '0244446666');
  // The text arrives first: two bills wait for GHS 3,100, so nobody is guessed.
  assert.deepEqual(await p.texts([MTN('3,100.00', '4,100.00', '51111111111')]), ['ambiguous']);
  assert.equal(store.get('wallet_payments', a.wid).fields.status, 'waiting');
  // The customer of table 1 gives the ID from their payment message: matched at once.
  const c = ok(await call('POST', `/api/guest/bill/${a.token}/claim`, { body: { txId: '51111111111' } }), 'claim');
  assert.deepEqual([c.claimed, c.confirmed], [true, true]);
  const wa = store.get('wallet_payments', a.wid).fields;
  assert.deepEqual([wa.status, wa.momoRef, wa.confirmedVia], ['confirmed', '51111111111', 'sms']);
  assert.equal(store.get('tabs', a.tabId).fields.status, 'closed', 'the bill closed itself');
  assert.equal(store.get('wallet_payments', b.wid).fields.status, 'waiting', 'the other table is untouched');
  // The same ID can't be used again, by the other table or anyone.
  assert.match((await call('POST', `/api/guest/bill/${b.token}/claim`, { body: { txId: '51111111111' } })).data.error, /already used/);

  // ID first, then the text: matched by the ID, even with another bill waiting for the same amount.
  const c2 = await bigTab('VIP 3', '0244447777'); // b and c2 both wait
  const claim2 = ok(await call('POST', '/api/ops/wallet/claim', { who: 'w1', body: { id: c2.wid, txId: '52222222222' } }), 'the waiter types it');
  assert.deepEqual([claim2.claimed, claim2.confirmed], [true, false]);
  assert.deepEqual(await p.texts([MTN('3,100.00', '7,200.00', '52222222222')]), ['confirmed']);
  assert.equal(store.get('wallet_payments', c2.wid).fields.status, 'confirmed');
  assert.equal(store.get('wallet_payments', b.wid).fields.status, 'waiting');
});

test('the ID is never a confirmation: no text, a wrong amount, or a made-up ID leaves the bill waiting', async () => {
  const { store, call, phone, bigTab } = setup();
  const p = await phone();
  const a = await bigTab('VIP 1', '0244445555');
  assert.match((await call('POST', `/api/guest/bill/${a.token}/claim`, { body: { txId: '123' } })).data.error, /at least 6/);
  const c = ok(await call('POST', `/api/guest/bill/${a.token}/claim`, { body: { txId: '53333333333' } }), 'claim, no text yet');
  assert.equal(c.confirmed, false, 'a typed ID alone confirms nothing');
  assert.equal(store.get('wallet_payments', a.wid).fields.status, 'waiting');
  // A text with that ID but the wrong amount is not used.
  assert.deepEqual(await p.texts([MTN('2,000.00', '3,000.00', '53333333333')]), ['waiting']);
  assert.equal(store.get('wallet_payments', a.wid).fields.status, 'waiting');
  // Two bills wait for GHS 3,100 and one customer gave an ID, but the payment came from a number that
  // isn't theirs: the ID alone doesn't decide; a manager picks.
  const b = await bigTab('VIP 2', '0244446666');
  ok(await call('POST', `/api/guest/bill/${b.token}/claim`, { body: { txId: '54444444444' } }), 'the other table gives the ID');
  const other = 'Payment received for GHS 3,100.00 from 0209998888 KOFI ASANTE Current Balance: GHS 6,100.00 . Available Balance: GHS 6,100.00. Transaction Id: 54444444444.';
  assert.deepEqual(await p.texts([other]), ['ambiguous']);
  assert.deepEqual([store.get('wallet_payments', a.wid).fields.status, store.get('wallet_payments', b.wid).fields.status], ['waiting', 'waiting']);
});

test('the bar sends the invoice: drinks go over only once it shows Paid', async () => {
  const { store, call, phone, barMakes } = setup();
  const p = await phone();
  const o = ok(await call('POST', '/api/ops/tabs/order', { who: 'b1', body: { stationId: 'main', customerPhone: '0244448888', sendInvoice: true, payFirst: true, lines: [{ productId: 'magnum', qty: 2 }] } }), 'bartender sends the invoice');
  assert.deepEqual([o.invoice.sent, o.invoice.wallet], [true, true]);
  assert.match(store.sms.filter(s => s.to === '0244448888').at(-1).message, /^MEMORIES: your bill is GHS 3,100\. Open to pay: https:\/\/memories\.test\/bill\.html\?t=/);
  const q = ok(await call('GET', '/api/ops/bar/rounds', { who: 'b1' }), 'bar queue');
  assert.equal(q.rounds.find(r => r.id === o.roundId).payFirst, true, 'the bar queue knows to wait for payment');
  for (const action of ['preparing', 'ready']) ok(await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: o.roundId, action } }), action);
  const early = await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: o.roundId, action: 'hand' } });
  assert.deepEqual([early.status, early.data.code], [400, 'pay_first'], 'not handed over unpaid');
  assert.deepEqual(await p.texts([MTN('3,100.00', '4,100.00', '55555555555')]), ['confirmed']);
  ok(await call('POST', '/api/ops/bar/round', { who: 'b1', body: { roundId: o.roundId, action: 'hand' } }), 'handed once paid');
  void barMakes;
});
