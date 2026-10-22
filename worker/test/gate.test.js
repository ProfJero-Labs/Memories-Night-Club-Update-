// The gate (front office): selling tickets and tables at the entrance (cash, or a MoMo prompt on the
// customer's phone), checking anyone by phone, members let in once a night, and the organiser's view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv, idToken } from './mock-firestore.js';
import worker from '../src/index.js';

let ip = 0;
function setup() {
  const { store, env } = createMockEnv();
  env.PUBLIC_SITE_URL = 'https://memories.test';
  const tonight = new Date().toISOString();
  store.seed('events', 'ev1', { name: 'Afrobeats Friday', date: tonight, active: true, visibility: 'public', organiserId: 'org1' });
  store.seed('events', 'ev2', { name: 'Next Week', date: new Date(Date.now() + 7 * 864e5).toISOString(), active: true, visibility: 'public', organiserId: 'org2' });
  store.seed('ticket_types', 'reg', { eventId: 'ev1', name: 'Regular', pricePesewas: 8000, doorPricePesewas: 10000, admits: 1, remaining: 50, active: true });
  store.seed('ticket_types', 'duo', { eventId: 'ev1', name: 'Couple', pricePesewas: 15000, admits: 2, remaining: 1, active: true });
  store.seed('ticket_types', 'nxt', { eventId: 'ev2', name: 'Regular', pricePesewas: 8000, admits: 1, active: true });
  store.seed('table_packages', 'vip', { eventId: 'ev1', name: 'VIP table', pricePesewas: 300000, capacity: 8, remaining: 2, active: true });
  store.seed('members', 'mem1', { name: 'Esi Member', phone: '0245550001', status: 'active', type: 'member' });
  const people = { door: ['Kofi Door', 'doorStaff'], sec: ['Yaw Security', 'security'], mgr: ['Akos Manager', 'manager'], org1: ['Ama Organiser', 'organiser'], org2: ['Other Organiser', 'organiser'], w1: ['Efua Waiter', 'waitStaff'] };
  for (const [uid, [name, role]] of Object.entries(people)) store.seed('users', uid, { name, role, phone: `02400004${Object.keys(people).indexOf(uid)}0` });
  const call = async (method, path, { body, who } = {}) => {
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.96.${Math.floor(++ip / 250)}.${ip % 250}` };
    if (who) headers.Authorization = `Bearer ${await idToken({ role: people[who][1] }, { uid: who })}`;
    const r = await worker.fetch(new Request(`https://api.test${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, data: JSON.parse((await r.text()) || '{}') };
  };
  return { store, call };
}
const ok = (r, what) => { assert.ok(r.status === 200, `${what}: ${r.status} ${r.data.error || ''}`); return r.data; };
const orders = store => store.list('orders').map(o => ({ id: o.id, ...o.fields }));

test('a cash sale at the gate: door price, tickets admitted at once, cash in the seller’s cash, ticket by SMS', async () => {
  const { store, call } = setup();
  const night = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'night');
  assert.equal(night.canSell, true);
  assert.equal(night.ticketTypes.find(t => t.id === 'reg').pricePesewas, 10000, 'the door price, not the online one');
  const sale = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 2, phone: '024 555 1234', name: 'Kwame', method: 'cash' } }), 'sell');
  assert.deepEqual([sale.status, sale.amountPesewas, sale.people, sale.ticketIds.length], ['issued', 20000, 2, 2]);
  const o = orders(store).find(x => x.channel === 'gate');
  assert.deepEqual([o.paidWith, o.soldByName, o.buyerPhone, o.organizerId], ['cash', 'Kofi Door', '0245551234', 'org1']);
  assert.ok(o.memoriesSharePesewas + o.organizerSharePesewas + o.evolveitSharePesewas === 20000, 'shares recorded like an online sale');
  const t = store.get('tickets', sale.ticketIds[0]).fields;
  assert.deepEqual([t.status, t.channel, t.paidWith], ['used', 'gate', 'cash'], 'admitted at once');
  assert.equal(store.get('ticket_types', 'reg').fields.remaining, 48);
  const cash = store.list('cash_sessions')[0].fields;
  assert.equal(cash.payments[0].amountPesewas, 20000, 'the cash is expected at the count');
  assert.match(store.sms.at(-1).message, /Paid GHS 200 \(cash\) at the gate.*ticket\.html\?token=/s);
  assert.equal(store.sms.at(-1).to, '0245551234');
  const after = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'night after');
  assert.deepEqual([after.sales.cashPesewas, after.sales.people, after.sales.mine.count], [20000, 2, 1]);
  const summary = ok(await call('GET', '/api/door/summary?eventId=ev1', { who: 'door' }), 'headcount');
  assert.equal(summary.admitted, 2, 'gate sales count in the headcount');
});

test('who may sell: the front office, tonight only; not security, an organiser or a waiter; the phone is required', async () => {
  const { call } = setup();
  for (const who of ['sec', 'org1', 'w1']) assert.equal((await call('POST', '/api/door/gate/sell', { who, body: { eventId: 'ev1', ticketTypeId: 'reg', phone: '0245551234', method: 'cash' } })).status, 403, who);
  assert.match((await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev2', ticketTypeId: 'nxt', phone: '0245551234', method: 'cash' } })).data.error, /tonight/);
  assert.match((await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', method: 'cash' } })).data.error, /phone number/);
  assert.match((await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'duo', quantity: 2, phone: '0245551234', method: 'cash' } })).data.error, /Only 1 left/);
});

test('MoMo at the gate: a prompt on the customer’s phone; nothing issued until Paystack confirms; once only; no text to the Manager', async () => {
  const { store, call } = setup();
  const s = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 1, phone: '0245551234', method: 'momo' } }), 'momo');
  assert.equal(s.prompt, true);
  const charge = store.paystackCharges.at(-1);
  assert.deepEqual([charge.amount, charge.mobile_money.phone, charge.mobile_money.provider], [10000, '0245551234', 'mtn']);
  let st = ok(await call('GET', `/api/door/gate/sale/${s.reference}`, { who: 'door' }), 'waiting');
  assert.notEqual(st.status, 'issued'); assert.equal(store.list('tickets').length, 0, 'nothing before they approve');
  store.setPaystack(s.reference, { status: 'success', currency: 'GHS', amount: 10000 });
  st = ok(await call('GET', `/api/door/gate/sale/${s.reference}`, { who: 'door' }), 'approved');
  assert.equal(st.status, 'issued');
  ok(await call('GET', `/api/door/gate/sale/${s.reference}`, { who: 'door' }), 'again');
  assert.equal(store.list('tickets').length, 1, 'issued once');
  const o = orders(store).find(x => x.channel === 'gate');
  assert.deepEqual([o.paidWith, o.amountPesewas], ['momo', 10000]);
  assert.equal(store.list('cash_sessions').length, 0, 'MoMo isn’t in anyone’s cash');
  assert.ok(!store.sms.some(x => /MoMo\/card confirmed/.test(x.message)), 'no gate alert to the Manager');
  assert.equal((await call('GET', `/api/door/gate/sale/${s.reference}`, { who: 'sec' })).status, 403);
});

test('MoMo prompt can’t be sent: the customer gets a payment link by SMS (and a QR to scan)', async () => {
  const { store, call } = setup();
  store.chargeStatus = 'error';
  const s = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', phone: '0205551234', method: 'momo' } }), 'momo');
  assert.equal(s.prompt, false); assert.ok(s.link);
  assert.match(store.sms.at(-1).message, /Pay GHS 100 for Afrobeats Friday: https:/);
  assert.equal(store.paystackInits.at(-1).amount, 10000);
});

test('check by phone: paid at the gate (how, by whom), online, a table, a member, or not in the system', async () => {
  const { store, call } = setup();
  ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', phone: '0245551234', name: 'Kwame Asante', method: 'cash' } }), 'sell');
  const c = ok(await call('GET', '/api/door/gate/check?eventId=ev1&phone=024%20555%201234', { who: 'sec' }), 'security checks');
  assert.deepEqual([c.verdict, c.message, c.name], ['ok', 'PAID', 'Kwame']);
  assert.match(c.lines[0].sub, /Paid GHS 100 cash at the gate, sold by Kofi · in at/);
  const none = ok(await call('GET', '/api/door/gate/check?eventId=ev1&phone=0249999999', { who: 'sec' }), 'nobody');
  assert.deepEqual([none.verdict, none.message], ['not_found', 'NOT IN THE SYSTEM']);
  ok(await call('POST', '/api/door/gate/report', { who: 'sec', body: { eventId: 'ev1', phone: '0249999999', note: 'At the bar, says he paid' } }), 'report');
  assert.match(store.list('incidents').at(-1).fields.note, /Not in the system: 024\*+999.*Found by Yaw Security/);
  const m = ok(await call('GET', '/api/door/gate/check?eventId=ev1&phone=0245550001', { who: 'org1' }), 'organiser checks a member');
  assert.deepEqual([m.verdict, m.message], ['ok', 'MEMBER']);
  assert.equal((await call('GET', '/api/door/gate/check?eventId=ev1&phone=0245551234', { who: 'org2' })).status, 403, 'not their night');
  assert.equal((await call('GET', '/api/door/gate/check?eventId=ev1&phone=0245551234', { who: 'w1' })).status, 403, 'not a waiter');
});

test('tables at the gate: free and booked, hold for a name, sell from the hold, let a hold go; holds run out', async () => {
  const { store, call } = setup();
  const h = ok(await call('POST', '/api/door/gate/hold', { who: 'door', body: { eventId: 'ev1', packageId: 'vip', name: 'Mr Boateng', phone: '0245550009' } }), 'hold');
  let n = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'night');
  assert.deepEqual([n.tables[0].free, n.tables[0].held[0].name], [1, 'Mr Boateng']);
  const sold = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', holdId: h.id, phone: '0245550009', name: 'Mr Boateng', method: 'cash' } }), 'sell held');
  assert.equal(sold.kind, 'table');
  assert.equal(store.get('orders', h.id).fields.status, 'sold');
  n = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'night');
  assert.deepEqual([n.tables[0].free, n.tables[0].booked.length, n.tables[0].booked[0].arrived], [1, 1, true]);
  const h2 = ok(await call('POST', '/api/door/gate/hold', { who: 'door', body: { eventId: 'ev1', packageId: 'vip', name: 'Ms Adjei' } }), 'hold 2');
  assert.match((await call('POST', '/api/door/gate/hold', { who: 'door', body: { eventId: 'ev1', packageId: 'vip', name: 'Third' } })).data.error, /No table/);
  ok(await call('POST', '/api/door/gate/release', { who: 'door', body: { id: h2.id } }), 'let it go');
  assert.equal(store.get('table_packages', 'vip').fields.remaining, 1);
  // A hold that runs out goes back on sale by itself.
  const h3 = ok(await call('POST', '/api/door/gate/hold', { who: 'door', body: { eventId: 'ev1', packageId: 'vip', name: 'Late' } }), 'hold 3');
  store.seed('orders', h3.id, { ...store.get('orders', h3.id).fields, heldUntil: new Date(Date.now() - 1000).toISOString() });
  n = ok(await call('GET', '/api/door/gate/night?eventId=ev1', { who: 'door' }), 'night');
  assert.equal(n.tables[0].free, 1); assert.equal(store.get('orders', h3.id).fields.status, 'released');
  const check = ok(await call('GET', '/api/door/gate/check?eventId=ev1&phone=0245550009', { who: 'sec' }), 'table check');
  assert.match(check.lines[0].title, /Table: VIP table/); assert.match(check.lines[0].sub, /Paid GHS 3,000 cash at the gate · arrived/);
});

test('members: one entry a night (a second try is stopped); “back in” is recorded; the organiser sees every way in', async () => {
  const { store, call } = setup();
  ok(await call('POST', '/api/members/door/manual', { who: 'door', body: { phone: '0245550001', reason: 'Phone dead' } }), 'first entry');
  const again = ok(await call('POST', '/api/members/door/request-code', { who: 'door', body: { phone: '0245550001' } }), 'second try');
  assert.equal(again.code, 'already_in'); assert.match(again.hint, /let in by Kofi Door/);
  const manual2 = ok(await call('POST', '/api/members/door/manual', { who: 'door', body: { phone: '0245550001', reason: 'x' } }), 'by hand again');
  assert.equal(manual2.code, 'already_in');
  // Back in: they show their phone (the app says they're in tonight); no reason to type.
  const back = ok(await call('POST', '/api/members/door/reentry', { who: 'door', body: { phone: '0245550001' } }), 'back in');
  assert.equal(store.list('member_entries').find(e => e.fields.method === 'reentry').fields.note, 'Showed their app');
  assert.equal(back.message, 'BACK IN');
  assert.deepEqual(store.list('member_entries').map(e => e.fields.method).sort(), ['manual', 'reentry']);
  ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', quantity: 3, phone: '0245551234', method: 'cash' } }), 'gate');
  const counts = ok(await call('GET', '/api/door/gate/counts?eventId=ev1', { who: 'org1' }), 'organiser');
  assert.deepEqual([counts.gate.people, counts.gate.cashPesewas, counts.members, counts.inside], [3, 30000, 1, 4]);
  assert.equal((await call('GET', '/api/door/gate/counts?eventId=ev1', { who: 'org2' })).status, 403);
});

test('VIP access: a table (theirs or as a friend the owner confirmed) or a VIP ticket; a friend joins only with the owner’s code', async () => {
  const { store, call } = setup();
  store.seed('ticket_types', 'vipt', { eventId: 'ev1', name: 'VIP pass', pricePesewas: 50000, admits: 1, active: true });
  ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'reg', phone: '0245551111', method: 'cash' } }), 'regular');
  ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', ticketTypeId: 'vipt', phone: '0245552222', method: 'cash' } }), 'vip ticket');
  const t = ok(await call('POST', '/api/door/gate/sell', { who: 'door', body: { eventId: 'ev1', packageId: 'vip', phone: '0245553333', name: 'Kojo Table', method: 'cash' } }), 'table');
  const check = phone => call('GET', `/api/door/gate/check?eventId=ev1&phone=${phone}`, { who: 'sec' }).then(r => ok(r, phone));
  assert.equal((await check('0245551111')).vip, false, 'a regular ticket: not VIP');
  assert.equal((await check('0245552222')).vip, true, 'a VIP ticket');
  assert.equal((await check('0245553333')).vip, true, 'the table’s owner');
  // A friend: security asks; the owner gets a code by SMS and reads it out.
  const code = `TBL-${t.orderId.slice(0, 6).toUpperCase()}`;
  assert.equal((await check('0245554444')).vip, false);
  const req = ok(await call('POST', '/api/door/gate/table-guest/request', { who: 'sec', body: { eventId: 'ev1', tableCode: code, phone: '0245554444' } }), 'ask the owner');
  assert.match(req.message, /texted to Kojo/);
  const sms = store.sms.filter(x => x.to === '0245553333').at(-1).message;
  assert.match(sms, /024\*+4444 wants to join your table/);
  const pin = /code: (\d{4})/.exec(sms)[1];
  assert.match((await call('POST', '/api/door/gate/table-guest/confirm', { who: 'sec', body: { eventId: 'ev1', tableCode: code, phone: '0245554444', code: pin === '0000' ? '1111' : '0000' } })).data.error, /isn’t right/);
  ok(await call('POST', '/api/door/gate/table-guest/confirm', { who: 'sec', body: { eventId: 'ev1', tableCode: code, phone: '0245554444', code: pin } }), 'owner confirmed');
  const friend = await check('0245554444');
  assert.deepEqual([friend.vip, friend.verdict], [true, 'ok']); assert.match(friend.lines[0].title, /Guest at Kojo’s table/);
  assert.match((await call('POST', '/api/door/gate/table-guest/request', { who: 'sec', body: { eventId: 'ev1', tableCode: code, phone: '0245554444' } })).data.error, /already on this table/);
  // The organiser can check on their own night too.
  assert.equal((ok(await call('GET', '/api/door/gate/check?eventId=ev1&phone=0245552222', { who: 'org1' }), 'organiser')).vip, true);
});
