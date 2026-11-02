// Every drinks sale, one by one, for the directors (and the Manager and finance): tonight, this week
// or this month. Each sale is a bill (a table, a quick sale, a sale at the bar) or a QR order: when,
// where, who served it, who took the money and how, the customer, and every drink on it.
// Filters, all optional: how it was paid (cash | momo | phone | qr | unpaid), one staff member (who
// served it or took a payment), one drink (by name). Ticket sales are not here (the events side).
import { queryRecent, listDocs } from '../lib/firestore.js';
import { requireRole, REPORTS } from '../lib/auth.js';
import { FORBIDDEN, paidNight } from './common.js';
import { billOf } from './tabs.js';
import { periodOf } from './money.js';

const DAY = 864e5;
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);
export const SALE_METHODS = { cash: 'Cash', momo: 'MoMo to the club’s number', digital: 'MoMo / card on their phone', qr: 'QR order (MoMo / card)' };
const FILTERS = { cash: 'Cash', momo: 'MoMo to the club', phone: 'Paid on their phone', qr: 'QR orders', unpaid: 'Not fully paid' };
const where = t => (t.quick ? (t.soldAtBar ? 'At the bar' : 'Quick sale') : !t.table || t.table === 'Walk-in' ? 'No table' : `Table ${String(t.table).replace(/^table\s*/i, '')}`);
const STATUS = { paid: 'Paid', overpaid: 'Paid', part_paid: 'Part paid', unpaid: 'Not paid', written_off: 'Written off', empty: 'Nothing on it' };

export async function salesList(env, user, q = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const p = periodOf(q);
  const inRange = d => d >= p.from && d <= p.to;
  const since = new Date(new Date(`${p.from}T00:00:00Z`).getTime() - DAY);
  const [tabsRaw, roundsRaw, qrRaw, stations] = await Promise.all([
    queryRecent(env, 'tabs', 'createdAt', since, 10000), queryRecent(env, 'rounds', 'createdAt', since, 30000),
    queryRecent(env, 'counter_orders', 'createdAt', since, 10000), listDocs(env, 'bar_stations'),
  ]);
  const barName = Object.fromEntries(stations.map(s => [s.id, s.fields.name]));
  const rounds = roundsRaw.map(r => ({ id: r.id, ...r.fields }));
  const all = [];
  for (const d of tabsRaw) {
    const t = { id: d.id, ...d.fields };
    if (!inRange(t.businessDate || '')) continue;
    const bill = billOf(t, rounds.filter(r => r.tabId === t.id));
    if (!bill.totalPesewas && !(t.payments || []).length) continue;
    const pays = (t.payments || []).map(x => ({ method: x.method, methodLabel: SALE_METHODS[x.method] || x.method, amountPesewas: Number(x.amountPesewas || 0), at: x.at,
      takenByName: x.method === 'digital' ? 'Customer, on their phone' : x.byName || '', takenBy: x.by || '', ref: x.momoRef || x.reference || '', late: !!x.recordedLateBy }));
    all.push({ id: t.id, kind: 'bill', date: t.businessDate, at: t.createdAt, where: where(t), label: `Tab ${t.number}`, bar: barName[t.stationId] || t.stationName || '',
      servedByName: t.waiterName || '', servedBy: t.waiterUid || '', customerName: t.debt?.name || t.customerName || '', customerPhone: t.customerPhone || '',
      lines: bill.lines.map(l => ({ qty: l.qty, name: l.name, amountPesewas: l.amountPesewas })), discountPesewas: bill.discountPesewas,
      totalPesewas: bill.totalPesewas, paidPesewas: bill.paidPesewas, leftPesewas: t.status === 'written_off' ? 0 : bill.balancePesewas,
      status: t.status === 'owed' && bill.balancePesewas ? 'owed' : bill.status, statusLabel: t.status === 'owed' && bill.balancePesewas ? 'Customer owes' : STATUS[bill.status] || bill.status,
      payments: pays, methods: [...new Set(pays.map(x => x.method))] });
  }
  for (const d of qrRaw) {
    const o = { id: d.id, ...d.fields };
    if (!['paid', 'delivered', 'refund_due', 'refunded'].includes(o.status) || !inRange(paidNight(o))) continue;
    const refund = ['refund_due', 'refunded'].includes(o.status);
    all.push({ id: o.id, kind: 'qr', date: paidNight(o), at: o.paidAt, where: o.spot ? `Table ${o.spot}` : 'QR at the bar', label: `QR ${o.pickupCode || ''}`.trim(), bar: o.stationName || '',
      servedByName: o.status === 'paid' ? 'Not collected yet' : 'The bar', servedBy: o.deliveredBy || '', customerName: '', customerPhone: o.phone || '',
      lines: (o.lines || []).map(l => ({ qty: l.qty, name: l.name, amountPesewas: l.qty * l.unitPesewas })), discountPesewas: 0,
      totalPesewas: o.totalPesewas, paidPesewas: o.totalPesewas, leftPesewas: 0, status: refund ? o.status : 'paid', statusLabel: refund ? (o.status === 'refunded' ? 'Refunded' : 'Refund owed') : 'Paid',
      payments: [o.paidVia === 'wallet' ? { method: 'momo', methodLabel: 'MoMo to the wallet (confirmed)', amountPesewas: o.totalPesewas, at: o.paidAt, takenByName: 'Confirmed by a manager', takenBy: '', ref: o.momoRef || '' } : { method: 'qr', methodLabel: SALE_METHODS.qr, amountPesewas: o.totalPesewas, at: o.paidAt, takenByName: 'Customer, by QR', takenBy: '', ref: o.reference || '' }], methods: [o.paidVia === 'wallet' ? 'momo' : 'qr'] });
  }

  // Who can be picked: everyone who served or took a payment in the period.
  const people = new Map();
  for (const s of all) { if (s.servedBy) people.set(s.servedBy, s.servedByName); for (const x of s.payments) if (x.takenBy) people.set(x.takenBy, x.takenByName); }
  const drinks = [...new Set(all.flatMap(s => s.lines.map(l => l.name)))].sort();

  // Filters.
  const method = FILTERS[q.method] ? q.method : '', person = String(q.person || ''), drink = String(q.drink || '');
  let list = all;
  if (method === 'unpaid') list = list.filter(s => s.leftPesewas > 0);
  else if (method) { const m = method === 'phone' ? 'digital' : method; list = list.filter(s => s.methods.includes(m)); }
  if (person) list = list.filter(s => s.servedBy === person || s.payments.some(x => x.takenBy === person));
  if (drink) list = list.filter(s => s.lines.some(l => l.name === drink));
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // For one drink: how many of it were in these sales, and their value.
  const drinkTotals = drink ? { name: drink, qty: sum(list, s => sum(s.lines.filter(l => l.name === drink), l => l.qty)), amountPesewas: sum(list, s => sum(s.lines.filter(l => l.name === drink), l => l.amountPesewas)) } : null;
  // Money taken by the method picked (a bill can be paid partly in cash and partly by MoMo).
  const methodKey = method === 'phone' ? 'digital' : method;
  const takenPesewas = methodKey && methodKey !== 'unpaid' ? sum(list, s => sum(s.payments.filter(x => x.method === methodKey && (!person || x.takenBy === person || s.servedBy === person)), x => x.amountPesewas)) : sum(list, s => s.paidPesewas);
  return {
    period: p, filters: { method, person, drink }, methodOptions: FILTERS,
    people: [...people.entries()].map(([uid, name]) => ({ uid, name })).sort((a, b) => a.name.localeCompare(b.name)), drinks,
    totals: { count: list.length, salesPesewas: sum(list, s => s.totalPesewas), paidPesewas: takenPesewas, leftPesewas: sum(list, s => s.leftPesewas) }, drinkTotals,
    sales: list.slice(0, 500), more: Math.max(0, list.length - 500),
  };
}
