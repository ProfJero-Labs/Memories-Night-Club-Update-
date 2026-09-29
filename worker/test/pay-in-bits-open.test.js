// The open checkout: the ticket line is optional, Pay in bits takes any amount above zero, closes
// when the night starts, and every part payment leaves the guest enough to keep paying.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import worker, { fulfillInstallment } from '../src/index.js';
import { balanceMessage } from '../src/checkout.js';

const FUTURE = '2099-10-02T22:00:00.000Z';
let ipSeq = 0;
function setup({ date = FUTURE, lines = ['SAMPLE LINE ONE.', 'SAMPLE LINE TWO.'] } = {}) {
  const { store, env } = createMockEnv();
  store.seed('events', 'n1', { name: 'Afrobeats Friday', visibility: 'public', active: true, date, ticketLines: lines });
  store.seed('ticket_types', 't1', { eventId: 'n1', name: 'Regular', pricePesewas: 10000, admits: 1, remaining: 50, active: true });
  const post = async (path, b) => {
    const res = await worker.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'CF-Connecting-IP': `10.7.0.${++ipSeq % 250}` }, body: JSON.stringify(b) }), env);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { store, env, post };
}
const who = { eventId: 'n1', ticketTypeId: 't1', quantity: 1, buyerName: 'Ama Mensah', buyerPhone: '0241234567' };
const pending = store => store.list('pending_checkouts').map(d => d.fields);
const plans = store => store.list('installment_plans').map(d => ({ id: d.id, ...d.fields }));

test('a night with lines sells without one: pay in full and pay in bits both accept an empty line', async () => {
  const { store, post } = setup();
  const full = await post('/api/checkout/initiate', { ...who, identityLine: '' });
  assert.equal(full.status, 200, full.data.error);
  assert.equal(pending(store)[0].identityLine, '');
  const bits = await post('/api/installments/start', { ...who, depositPesewas: 2000, acknowledged: true });
  assert.equal(bits.status, 200, bits.data.error);
  assert.equal(plans(store)[0].identityLine, '');
});

test('a chosen night line and a custom line are still stored exactly as before', async () => {
  const { store, post } = setup();
  await post('/api/checkout/initiate', { ...who, identityLine: 'SAMPLE LINE TWO.' });
  await post('/api/checkout/initiate', { ...who, identityLine: '  birthday   girl ' });
  const lines = pending(store).map(p => p.identityLine).sort();
  assert.deepEqual(lines, ['SAMPLE LINE TWO.', 'birthday girl']);
});

test('pay in bits: any amount above zero starts an order; zero, blanks and more than the price do not', async () => {
  const { store, post } = setup();
  for (const depositPesewas of [0, -100, 'abc', 12.5, 10001]) {
    const r = await post('/api/installments/start', { ...who, depositPesewas, acknowledged: true });
    assert.equal(r.status, 400, `deposit ${depositPesewas} should be refused`);
  }
  assert.equal(plans(store).length, 0);
  for (const depositPesewas of [1, 50, 1250, 10000]) {
    const r = await post('/api/installments/start', { ...who, depositPesewas, acknowledged: true });
    assert.equal(r.status, 200, `deposit ${depositPesewas}: ${r.data.error}`);
  }
  assert.deepEqual(store.paystackInits.map(i => i.amount), [1, 50, 1250, 10000]);
});

test('pay in bits closes when the night starts (tickets in full stay on sale)', async () => {
  const started = new Date(Date.now() - 60 * 60e3).toISOString();
  const { store, post } = setup({ date: started });
  const bits = await post('/api/installments/start', { ...who, depositPesewas: 2000, acknowledged: true });
  assert.equal(bits.status, 400);
  assert.match(bits.data.error, /closes when the night starts/);
  assert.equal(plans(store).length, 0, 'no plan is created that would be forfeited at once');
  const full = await post('/api/checkout/initiate', { ...who });
  assert.equal(full.status, 200, full.data.error);
});

test('top-ups take any amount above zero up to the balance', async () => {
  const { store, post } = setup();
  store.seed('installment_plans', 'MEM-7K3QX-9WP2M', { eventId: 'n1', eventName: 'Afrobeats Friday', eventDate: FUTURE, totalPesewas: 10000, paidPesewas: 4000, buyerName: 'Ama', buyerPhone: '0241234567', status: 'active', payments: [] });
  assert.equal((await post('/api/installments/topup', { planId: 'MEM-7K3QX-9WP2M', amountPesewas: 0 })).status, 400);
  assert.equal((await post('/api/installments/topup', { planId: 'MEM-7K3QX-9WP2M', amountPesewas: 6001 })).status, 400);
  const small = await post('/api/installments/topup', { planId: 'MEM-7K3QX-9WP2M', amountPesewas: 1 });
  assert.equal(small.status, 200, small.data.error);
  assert.equal(store.paystackInits.at(-1).amount, 1);
});

test('after a part payment: the text and email give the night, what is left, the deadline and the pay link', async () => {
  const { store, env } = setup();
  store.seed('installment_plans', 'MEM-7K3QX-9WP2M', {
    eventId: 'n1', eventName: 'Afrobeats Friday', eventDate: FUTURE, ticketTypeId: 't1', ticketTypeName: 'Regular', admits: 1, quantity: 1,
    totalPesewas: 10000, paidPesewas: 0, buyerName: 'Ama Mensah', firstName: 'Ama', buyerPhone: '0241234567', buyerEmail: 'ama@test.com', status: 'active', payments: [],
  });
  store.seed('pending_checkouts', 'topX', { reference: 'topX', kind: 'installment_topup', planId: 'MEM-7K3QX-9WP2M', amountPesewas: 3000, status: 'pending' });
  store.setPaystack('topX', { status: 'success', currency: 'GHS', amount: 3000 });
  await fulfillInstallment(env, 'topX');
  const sms = store.sms[0].message;
  for (const want of [/GHS 30 received for Afrobeats Friday, Fri 02 Oct\./, /Paid GHS 30 of GHS 100\. Left: GHS 70\./, /Pay the rest before Fri 02 Oct, 10PM or the order is forfeited\./, /Order MEM-7K3QX-9WP2M/, /installment\.html\?code=MEM-7K3QX-9WP2M/]) assert.match(sms, want);
  assert.ok(/^[\x20-\x7e\n]*$/.test(sms), 'plain ASCII, so it stays a normal SMS');
  assert.equal(store.emails.length, 1);
  assert.match(JSON.stringify(store.emails[0]), /GHS 70 left to pay/);
});

test('the part-payment text fits in two SMS parts even with a long night name and big amounts', () => {
  const P = { eventName: 'X'.repeat(80), eventDate: FUTURE, totalPesewas: 999999900 };
  const sms = balanceMessage({ PUBLIC_SITE_URL: 'https://memoriesnightclub.com' }, 'MEM-7K3QX-9WP2M', 123456700, 876543200, P);
  assert.ok(sms.length <= 306, `${sms.length} characters`);
  const short = balanceMessage({ PUBLIC_SITE_URL: 'https://memoriesnightclub.com' }, 'MEM-7K3QX-9WP2M', 0, 5000);
  assert.match(short, /Balance: GHS 50/, 'callers without the plan still get the short text');
});

test('payment status for a part payment carries the receipt details, and only a masked phone', async () => {
  const { store, env } = setup();
  store.seed('installment_plans', 'MEM-7K3QX-9WP2M', {
    eventId: 'n1', eventName: 'Afrobeats Friday', eventDate: FUTURE, ticketTypeName: 'Regular', quantity: 2,
    totalPesewas: 20000, paidPesewas: 5000, buyerName: 'Ama Mensah', buyerPhone: '0241234567', status: 'active', payments: [],
  });
  store.seed('pending_checkouts', 'topY', { reference: 'topY', kind: 'installment_topup', planId: 'MEM-7K3QX-9WP2M', amountPesewas: 5000, status: 'issued' });
  const res = await worker.fetch(new Request('https://worker.test/api/checkout/status?reference=topY'), env);
  const text = await res.text(); const d = JSON.parse(text);
  assert.equal(d.amountPesewas, 5000);
  assert.equal(d.deadline, FUTURE);
  assert.equal(d.eventDate, FUTURE);
  assert.equal(d.ticketTypeName, 'Regular');
  assert.equal(d.quantity, 2);
  assert.equal(d.firstName, 'Ama');
  assert.equal(d.phoneHint, '024***4567');
  assert.equal(d.reference, 'topY');
  assert.ok(!text.includes('0241234567'), 'never the full phone number');
});
