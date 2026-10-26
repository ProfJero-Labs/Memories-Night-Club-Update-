// src/fixes/nov14-ticket.js: the one 14 Nov ticket deleted by mistake comes back, valid, with the
// same code the buyer was texted; nothing else is written, and it only ever runs once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillTicket } from '../src/index.js';
import { restoreNov14Ticket, FIX_ID } from '../src/fixes/nov14-ticket.js';

async function night() {
  const { store, env } = createMockEnv();
  store.seed('events', 'nov14', { name: 'November Night', date: '2026-11-14T22:00:00.000Z', visibility: 'public', active: true });
  store.seed('ticket_types', 'std', { eventId: 'nov14', name: 'Standard', pricePesewas: 15000, admits: 1, remaining: 100, active: true });
  const sell = async (ref, name, phone) => {
    store.seed('pending_checkouts', ref, { reference: ref, status: 'pending', kind: 'ticket', eventId: 'nov14', eventName: 'November Night', ticketTypeId: 'std', ticketTypeName: 'Standard', admits: 1, quantity: 1, amountPesewas: 15000, buyerName: name, buyerPhone: phone, buyerEmail: '', identityLine: '' });
    store.setPaystack(ref, { status: 'success', currency: 'GHS', amount: 15000 });
    return fulfillTicket(env, ref);
  };
  return { store, env, mine: await sell('pay-c', 'Buyer C', '0550008168'), other: await sell('pay-o', 'Other Buyer', '0241234567') };
}

test('the deleted ticket comes back valid with its original code; only that one', async () => {
  const { store, env, mine, other } = await night();
  const order = store.get('orders', mine.orderId).fields, code = order.ticketIds[0];
  const ticket = store.get('tickets', code).fields;
  store.delete('orders', mine.orderId); store.delete('tickets', code);
  store.delete('orders', other.orderId); // another missing sale: this fix leaves it alone

  const r = await restoreNov14Ticket(env);
  assert.equal(r.status, 'restored');
  assert.deepEqual([r.orders, r.tickets], [1, 1]);
  const back = store.get('tickets', code).fields;
  assert.equal(back.status, 'valid'); assert.equal(back.revoked, false); assert.equal(back.displayCode, ticket.displayCode);
  assert.equal(store.get('orders', mine.orderId).fields.status, 'confirmed');
  assert.equal(store.get('orders', other.orderId), null, 'no one else is touched');
  assert.equal(store.get('system_fixes', FIX_ID).fields.status, 'restored');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'ORDERS_RESTORED' && a.fields.fix === FIX_ID));

  store.delete('orders', mine.orderId);
  assert.equal(await restoreNov14Ticket(env), null, 'never runs twice');
  assert.equal(store.get('orders', mine.orderId), null);
});

test('nothing missing: writes only the marker', async () => {
  const { store, env } = await night();
  const orders = store.list('orders').length;
  assert.equal((await restoreNov14Ticket(env)).status, 'nothing_missing');
  assert.equal(store.list('orders').length, orders);
});
