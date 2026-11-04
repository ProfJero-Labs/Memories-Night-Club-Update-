// The MoMo phone (src/ops/momophone.js): the business phone sends its texts, signed; a payment
// that checks out confirms the waiting MoMo-to-the-wallet bill by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';
import { readMomoText } from '../src/ops/momophone.js';
import { DEFAULT_ROUTES } from '../src/lib/routes.js';

let ip = 0;
const MTN = (amount, bal, tx, { from = 'KWAME MENSAH', ref = '' } = {}) => `Payment received for GHS ${amount} from ${from} Current Balance: GHS ${bal} . Available Balance: GHS ${bal}.${ref ? ` Reference: ${ref}.` : ''} Transaction ID: ${tx}. TRANSACTION FEE: 0.00`;
const CASHOUT = (amount, bal, tx) => `Cash Out made for GHS ${amount} to AGENT. Current Balance: GHS ${bal}. Financial Transaction Id: ${tx}. Fee was GHS 0.50`;

function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  store.seed('settings', 'commercial', { serviceCharge: { enabled: true, percent: 5, capPesewas: 10000 }, routes: { ...DEFAULT_ROUTES, enabled: true, paystackSubaccount: 'ACCT_89qd3ub03w61erk' } });
  store.seed('users', 'm1', { name: 'Akos Manager', role: 'manager', phone: '0240000001' });
  store.seed('users', 'h1', { name: 'Abena HR', role: 'hrManager', phone: '0240000002' });
  const call = async (method, path, { body, who, raw, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.66.${Math.floor(++ip / 250)}.${ip % 250}`, ...headers };
    if (who) h.Authorization = `Bearer ${await idToken({ role: who === 'm1' ? 'manager' : 'hrManager' }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers: h, body: raw ?? (body ? JSON.stringify(body) : undefined) }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  const phone = async () => {
    const { code } = (await call('POST', '/api/ops/momo-phone/code', { who: 'm1' })).data;
    const { deviceId, secret } = (await call('POST', '/api/momo-phone/pair', { body: { code, name: 'Business phone' } })).data;
    const send = async (path, payload, { badSign = false } = {}) => {
      const raw = JSON.stringify(payload), time = String(Date.now());
      const sign = createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex');
      return call('POST', path, { raw, headers: { 'x-momo-device': deviceId, 'x-momo-time': time, 'x-momo-sign': badSign ? sign.replace(/./, c => (c === 'a' ? 'b' : 'a')) : sign } });
    };
    return { deviceId, texts: (msgs, o) => send('/api/momo-phone/texts', { messages: msgs.map(body => ({ from: 'MobileMoney', body, receivedAt: new Date().toISOString() })) }, o), raw: send };
  };
  // A waiting MoMo-to-the-wallet payment (bill 3,000 + 100).
  const waiting = (wid, due = 310000, extra = {}) => { store.seed('tabs', `t_${wid}`, { number: 7, businessDate: '2026-11-04', table: '9', status: 'open', closeWhenPaid: true, walletWait: wid, payments: [], discounts: [], createdAt: new Date().toISOString() }); store.seed('wallet_payments', wid, { tabId: `t_${wid}`, tabNumber: 7, table: '9', billPesewas: due - 10000, chargePesewas: 10000, duePesewas: due, code: 'K7QX', status: 'waiting', businessDate: '2026-11-04', reason: 'big', wallet: { number: '0595986313', name: 'Samuel Forson / Memories Night Club' }, createdAt: new Date().toISOString(), ...extra }); };
  return { store, env, call, phone, waiting };
}

test('reading MTN texts: money in (amount, ID, balance, payer, reference) and money out (balance only)', () => {
  const r = readMomoText(MTN('3,100.00', '4,100.00', '51234567890', { ref: 'k7qx' }));
  assert.deepEqual([r.kind, r.amountPesewas, r.balancePesewas, r.txId, r.payerName, r.reference], ['credit', 310000, 410000, '51234567890', 'KWAME MENSAH', 'K7QX']);
  const o = readMomoText(CASHOUT('50.00', '1,000.00', '99887766'));
  assert.deepEqual([o.kind, o.balancePesewas], ['debit', 100000]);
});

test('pairing: a manager’s code, once; unsigned or wrongly signed calls are refused', async () => {
  const { call, phone } = setup();
  const p = await phone();
  assert.equal((await call('POST', '/api/momo-phone/texts', { body: { messages: [] } })).status, 401, 'unsigned');
  assert.equal((await p.raw('/api/momo-phone/ping', {}, { badSign: true })).status, 401, 'wrong signature');
  assert.equal((await p.raw('/api/momo-phone/ping', {})).status, 200);
  assert.equal((await call('POST', '/api/momo-phone/pair', { body: { code: '000000' } })).status, 403, 'a made-up code');
});

test('a payment text that checks out confirms the waiting bill by itself; the same text twice counts once', async () => {
  const { store, call, phone, waiting } = setup();
  waiting('w1');
  const p = await phone();
  // The first text with a balance starts the chain (money out here), then the payment.
  await p.texts([CASHOUT('50.00', '1,000.00', '99887766')]);
  const r = (await p.texts([MTN('3,100.00', '4,100.00', '51234567890')])).data;
  assert.equal(r.results[0].status, 'confirmed');
  const w = store.get('wallet_payments', 'w1').fields;
  assert.deepEqual([w.status, w.confirmedVia, w.momoRef], ['confirmed', 'sms', '51234567890']);
  assert.equal(store.get('tabs', 't_w1').fields.status, 'closed', 'the bill closes');
  assert.equal(store.list('evolveit_charges').length, 1, 'the GHS 100 is owed to EvolveIT');
  assert.equal((await p.texts([MTN('3,100.00', '4,100.00', '51234567890')])).data.results[0].status, 'duplicate');
  const st = (await call('GET', '/api/ops/momo-phone', { who: 'h1' })).data;
  assert.equal(st.anyOnline, true);
});

test('never trusted: a wrong sender, a balance that doesn’t add up, a used transaction ID, or the very first text', async () => {
  const { store, phone, waiting } = setup();
  waiting('w1');
  const p = await phone();
  assert.equal((await p.texts([MTN('3,100.00', '3,100.00', '11111111')])).data.results[0].status, 'check_balance', 'first text: no balance to check against');
  assert.equal((await p.raw('/api/momo-phone/texts', { messages: [{ from: 'MOMO-PROMO', body: MTN('3,100.00', '9,999.00', '22222222') }] })).data.results[0].status, 'bad_sender');
  assert.equal((await p.texts([MTN('3,100.00', '9,999.00', '33333333')])).data.results[0].status, 'check_balance', 'a fake: the balance jumps');
  assert.equal(store.get('wallet_payments', 'w1').fields.status, 'waiting', 'nothing confirmed by itself');
  store.seed('wallet_payments', 'old', { status: 'confirmed', momoRef: '44444444', duePesewas: 1 });
  assert.equal((await p.texts([MTN('3,100.00', '13,099.00', '44444444')])).data.results[0].status, 'used_id');
});

test('two bills waiting for the same amount: the reference picks; otherwise a person picks from the text', async () => {
  const { store, call, phone, waiting } = setup();
  waiting('wa', 310000, { code: 'AAAA' }); waiting('wb', 310000, { code: 'BBBB', tabId: 't_wb' });
  const p = await phone();
  await p.texts([CASHOUT('50.00', '1,000.00', '99887766')]);
  assert.equal((await p.texts([MTN('3,100.00', '4,100.00', '55555555', { ref: 'BBBB' })])).data.results[0].status, 'confirmed');
  assert.equal(store.get('wallet_payments', 'wb').fields.status, 'confirmed');
  waiting('wc', 310000, { code: 'CCCC' });
  assert.equal((await p.texts([MTN('3,100.00', '7,200.00', '66666666')])).data.results[0].status, 'ambiguous');
  const msg = store.list('momo_messages').find(m => m.fields.status === 'ambiguous');
  const ok = (await call('POST', '/api/ops/momo-phone/confirm', { who: 'h1', body: { messageId: msg.id, walletPaymentId: 'wa' } })).data;
  assert.equal(ok.confirmed, true, 'the Human manager picks the bill');
  assert.equal(store.get('wallet_payments', 'wa').fields.confirmedVia, 'text_by_hand');
});

test('the test box says how a pasted text would be read', async () => {
  const { call, waiting } = setup();
  waiting('w1');
  const r = (await call('POST', '/api/ops/momo-phone/test', { who: 'm1', body: { body: MTN('3,100.00', '4,100.00', '77777777') } })).data;
  assert.match(r.says, /Would confirm/);
  assert.match((await call('POST', '/api/ops/momo-phone/test', { who: 'm1', body: { body: 'Hello there' } })).data.says, /Couldn’t read/);
});
