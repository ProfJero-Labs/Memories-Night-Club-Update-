// scripts/restore-night-orders.mjs: a night's deleted orders and tickets come back from the payment
// records, with their original ids and ticket codes (the links customers were texted keep working).
// Only what's missing is written; nothing else is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockEnv } from './mock-firestore.js';
import { fulfillTicket, fulfillTable, fulfillInstallment } from '../src/index.js';
import { planRestore, applyRestore, describe } from '../../scripts/restore-night-orders.mjs';

const NIGHT = '2026-11-14', WHEN = '2026-11-14T22:00:00.000Z';
async function soldNight() {
  const { store, env } = createMockEnv();
  store.seed('events', 'nov14', { name: 'November Takeover', date: WHEN, visibility: 'public', active: true });
  store.seed('events', 'other', { name: 'Another night', date: '2026-11-21T22:00:00.000Z', visibility: 'public', active: true });
  store.seed('ticket_types', 'nov14-std', { eventId: 'nov14', name: 'Standard', pricePesewas: 15000, admits: 1, remaining: 100, active: true });
  store.seed('ticket_types', 'other-std', { eventId: 'other', name: 'Standard', pricePesewas: 15000, admits: 1, remaining: 100, active: true });
  store.seed('table_packages', 'nov14-floor', { eventId: 'nov14', name: 'Floor Table', pricePesewas: 350000, capacity: 8, remaining: 3, active: true });
  const paid = (ref, f, amount) => { store.seed('pending_checkouts', ref, { reference: ref, status: 'pending', ...f }); store.setPaystack(ref, { status: 'success', currency: 'GHS', amount }); };
  const ticket = (ref, eventId, name, qty) => paid(ref, { kind: 'ticket', eventId, eventName: 'N', ticketTypeId: `${eventId}-std`, ticketTypeName: 'Standard', admits: 1, quantity: qty, amountPesewas: 15000 * qty, buyerName: name, buyerPhone: '0241234567', buyerEmail: '', identityLine: 'A LINE.' }, 15000 * qty);
  ticket('t1', 'nov14', 'Kofi Boateng', 2); ticket('t2', 'nov14', 'Ama Mensah', 1); ticket('t3', 'other', 'Yaw Other', 1);
  paid('tb1', { kind: 'table', eventId: 'nov14', eventName: 'N', packageId: 'nov14-floor', packageName: 'Floor Table', bottles: [], amountPesewas: 350000, buyerName: 'Efua Table', buyerPhone: '0551234567' }, 350000);
  store.seed('installment_plans', 'MEM-PLAN1', { eventId: 'nov14', eventName: 'N', ticketTypeId: 'nov14-std', ticketTypeName: 'Standard', admits: 1, quantity: 1, totalPesewas: 15000, paidPesewas: 0, buyerName: 'Bits Payer', buyerPhone: '0200000000', identityLine: '', status: 'active', payments: [] });
  paid('bits1', { kind: 'installment_topup', planId: 'MEM-PLAN1', amountPesewas: 15000 }, 15000);
  const r = { t1: await fulfillTicket(env, 't1'), t2: await fulfillTicket(env, 't2'), t3: await fulfillTicket(env, 't3'), tb1: await fulfillTable(env, 'tb1'), bits1: await fulfillInstallment(env, 'bits1') };
  return { store, env, r };
}
const snapshot = (store, col) => Object.fromEntries(store.list(col).map(d => [d.id, d.fields]));
const strip = f => { const { restoredAt, restoredFrom, createdAt, issuedAt, ...rest } = f; return rest; };

test('deleted orders and tickets for a night come back with the same ids and codes; nothing else changes', async () => {
  const { store, env, r } = await soldNight();
  const before = { orders: snapshot(store, 'orders'), tickets: snapshot(store, 'tickets') };
  const stock = snapshot(store, 'ticket_types'), checkouts = snapshot(store, 'pending_checkouts');
  // Everything for 14 Nov is deleted; the other night's sale stays.
  for (const col of ['orders', 'tickets']) for (const d of store.list(col)) if (d.fields.eventId === 'nov14') store.delete(col, d.id);
  assert.equal(store.list('orders').length, 1);

  const plan = await planRestore(env, NIGHT);
  assert.deepEqual(plan.events.map(e => e.id), ['nov14'], 'only the 14 Nov night');
  assert.equal(plan.missing.length, 4, 'two ticket orders, the table and the paid-in-bits order');
  assert.match(describe(plan), /Total: 4 orders, 4 tickets, GHS 4,100/);
  assert.equal(store.list('orders').length, 1, 'the preview writes nothing');

  const res = await applyRestore(env, plan, { by: 'test' });
  assert.deepEqual(res, { orders: 4, tickets: 4 });
  const after = { orders: snapshot(store, 'orders'), tickets: snapshot(store, 'tickets') };
  assert.deepEqual(Object.keys(after.orders).sort(), Object.keys(before.orders).sort(), 'same order ids');
  assert.deepEqual(Object.keys(after.tickets).sort(), Object.keys(before.tickets).sort(), 'same ticket codes: the texted links work again');
  for (const [k, f] of Object.entries(before.orders)) assert.deepEqual(strip(after.orders[k]), strip(f), `order ${k} is as it was`);
  for (const [k, f] of Object.entries(before.tickets)) assert.deepEqual(strip(after.tickets[k]), strip(f), `ticket ${k} is as it was`);
  assert.ok(after.orders[r.t1.orderId].restoredFrom.startsWith('pending_checkouts/'), 'marked as restored');
  assert.equal(after.orders[r.bits1.orderId].paidInInstallments, true);
  assert.deepEqual(snapshot(store, 'ticket_types'), stock, 'stock counts unchanged');
  assert.deepEqual(snapshot(store, 'pending_checkouts'), checkouts, 'payment records unchanged');
  assert.ok(store.list('audit_logs').some(a => a.fields.action === 'ORDERS_RESTORED' && a.fields.orders === 4));

  const again = await planRestore(env, NIGHT);
  assert.equal(again.missing.length, 0, 'a second run finds nothing to do');
  assert.equal(again.present, 4);
});

test('only what is missing is written; a ticket already checked in comes back as used', async () => {
  const { store, env, r } = await soldNight();
  const [keep, gone] = r.t1.ticketIds;
  store.seed('checkins', 'c1', { ticketId: gone, eventId: 'nov14', admits: 1, checkedInAt: '2026-11-14T23:10:00.000Z' });
  store.delete('tickets', gone);                              // one ticket of an order lost; the order is still there
  store.seed('tickets', keep, { ...store.get('tickets', keep).fields, customerName: 'Edited by hand' });
  const plan = await planRestore(env, NIGHT);
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].order, null, 'the order is there, so it is not rewritten');
  await applyRestore(env, plan);
  assert.equal(store.get('tickets', gone).fields.status, 'used');
  assert.equal(store.get('tickets', gone).fields.checkedInAt, '2026-11-14T23:10:00.000Z');
  assert.equal(store.get('tickets', keep).fields.customerName, 'Edited by hand', 'an existing ticket is never overwritten');
});

test('a write is refused if the record came back in the meantime', async () => {
  const { store, env, r } = await soldNight();
  const lost = store.get('orders', r.t2.orderId).fields;
  store.delete('orders', r.t2.orderId);
  const plan = await planRestore(env, NIGHT);
  store.seed('orders', r.t2.orderId, { ...lost, note: 'put back by hand' });
  await assert.rejects(applyRestore(env, plan), /already exists/i);
  assert.equal(store.get('orders', r.t2.orderId).fields.note, 'put back by hand');
});
