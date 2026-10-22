// Every payment of the night, and who spent the most. For the manager (and the director, finance).
//
// A payment: when, how much, how (cash, MoMo to the club's number, MoMo/card on the phone, QR), who
// took it, who served, the table, the customer, and what was bought. A table's payment shows the
// table's whole bill (a payment pays the table, not single drinks); a quick sale or a QR order is
// exactly what was bought.
//
// Customers are known by phone: the phone on the table or quick sale, the MoMo number it was paid
// from, or the phone a QR order was paid with. Sales with no phone are counted, not named.
//
// The customer's own night (no sign-in): counter.html asks with the id of an order they paid (their
// key), and sees everything paid tonight from that phone.
import { getDoc, queryWhere, queryRecent, listDocs } from '../lib/firestore.js';
import { normalizePhone, maskPhone, nightKey } from '../lib/util.js';
import { requireRole, CUSTOMER_CARE } from '../lib/auth.js';
import { FORBIDDEN, bizDate, dateOr } from './common.js';
import { billOf } from './tabs.js';

const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const METHOD = { cash: 'Cash', momo: 'MoMo to the club’s number', digital: 'MoMo / card on their phone', qr: 'QR order (MoMo / card)' };
const where = t => (t.quick ? (t.soldAtBar ? 'At the bar' : 'Quick sale') : t.table === 'Walk-in' ? 'No table' : `Table ${t.table}`);

async function night(env, date) {
  const since = new Date(new Date(`${date}T00:00:00Z`).getTime() - 864e5);
  const [tabsRaw, roundsRaw, qrRaw, users, stations, tipsRaw] = await Promise.all([
    queryWhere(env, 'tabs', [{ field: 'businessDate', value: date }]), queryWhere(env, 'rounds', [{ field: 'businessDate', value: date }]),
    queryRecent(env, 'counter_orders', 'createdAt', since, 5000), listDocs(env, 'users'), listDocs(env, 'bar_stations'),
    queryWhere(env, 'tips', [{ field: 'businessDate', value: date }]),
  ]);
  // The tip that came with each payment (kept apart from the bill: it's the staff member's money).
  const tipBy = new Map(tipsRaw.filter(d => d.fields.status !== 'cancelled').flatMap(d => [d.fields.paymentId, d.fields.orderId].filter(Boolean).map(k => [k, { tipPesewas: d.fields.amountPesewas, tipToName: d.fields.toName || '' }])));
  const name = Object.fromEntries(users.map(u => [u.id, u.fields.name || '']));
  const stationName = Object.fromEntries(stations.map(s => [s.id, s.fields.name]));
  const rounds = roundsRaw.map(r => ({ id: r.id, ...r.fields }));
  const tabs = tabsRaw.map(t => ({ id: t.id, ...t.fields }));
  for (const t of tabs) { t.rounds = rounds.filter(r => r.tabId === t.id); t.bill = billOf(t, t.rounds); }
  const qr = qrRaw.map(o => ({ id: o.id, ...o.fields })).filter(o => ['paid', 'delivered', 'refund_due', 'refunded'].includes(o.status) && o.paidAt && nightKey(o.paidAt) === date);
  return { tabs, qr, name, stationName, tipBy };
}

function paymentsOf({ tabs, qr, name, stationName, tipBy = new Map() }) {
  const out = [];
  for (const t of tabs) for (const p of t.payments || []) {
    out.push({ id: p.id, at: p.at, amountPesewas: p.amountPesewas, method: p.method, methodLabel: METHOD[p.method] || p.method, takenByName: p.method === 'digital' ? 'Customer, on their phone' : p.byName || '',
      servedByName: t.waiterName || '', where: where(t), tab: `Tab ${t.number}`, bar: stationName[t.stationId] || t.stationName || '', customerName: t.customerName || '', customerPhone: t.customerPhone || p.momoFrom || '',
      momoRef: p.momoRef || p.reference || '', wholeBill: !t.quick, lines: t.bill.lines.map(l => ({ qty: l.qty, name: l.name, amountPesewas: l.amountPesewas })), billTotalPesewas: t.bill.totalPesewas, billLeftPesewas: t.bill.balancePesewas, ...(tipBy.get(p.id) || {}) });
  }
  for (const o of qr) {
    out.push({ id: o.id, at: o.paidAt, amountPesewas: o.totalPesewas, method: 'qr', methodLabel: METHOD.qr, takenByName: 'Customer, by QR', servedByName: o.deliveredBy ? name[o.deliveredBy] || 'The bar' : o.status === 'paid' ? 'Not collected yet' : '',
      where: o.spot ? `Table ${o.spot}` : 'QR at the bar', tab: `Code ${o.pickupCode || ''}`, bar: o.stationName || '', customerName: '', customerPhone: o.phone || '', momoRef: o.reference || '', wholeBill: false,
      lines: (o.lines || []).map(l => ({ qty: l.qty, name: l.name, amountPesewas: l.qty * l.unitPesewas })), refund: ['refund_due', 'refunded'].includes(o.status) ? o.status : '', ...(tipBy.get(o.id) || {}) });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export async function nightPayments(env, user, { date } = {}) {
  if (!requireRole(user, CUSTOMER_CARE)) return FORBIDDEN;
  const d = dateOr(date), data = await night(env, d), payments = paymentsOf(data);
  // Who spent the most: what they bought tonight (a table's bill, a quick sale, a QR order).
  const people = new Map(); let noPhone = 0;
  const add = (phone, nameHint, amount, at, what) => {
    const ph = normalizePhone(phone);
    if (!ph) { noPhone += amount; return; }
    const c = people.get(ph) || { phone: ph, name: '', spentPesewas: 0, visits: 0, lastAt: '', where: new Set() };
    c.spentPesewas += amount; c.visits += 1; if (nameHint && !c.name) c.name = nameHint; if (String(at) > c.lastAt) c.lastAt = String(at); c.where.add(what); people.set(ph, c);
  };
  for (const t of data.tabs) if (t.bill.totalPesewas) add(t.customerPhone || (t.payments || []).find(p => p.momoFrom)?.momoFrom, t.customerName, t.bill.totalPesewas, t.createdAt, where(t));
  for (const o of data.qr.filter(o => ['paid', 'delivered'].includes(o.status))) add(o.phone, '', o.totalPesewas, o.paidAt, 'QR');
  const customers = [...people.values()].sort((a, b) => b.spentPesewas - a.spentPesewas).slice(0, 30).map(c => ({ ...c, where: [...c.where].join(', ') }));
  const byMethod = Object.entries(METHOD).map(([k, label]) => ({ method: k, label, amountPesewas: sum(payments.filter(p => p.method === k), p => p.amountPesewas), count: payments.filter(p => p.method === k).length })).filter(x => x.count);
  return { date: d, payments, totalPesewas: sum(payments, p => p.amountPesewas), byMethod, customers, noPhonePesewas: noPhone };
}

// ── The customer's own night ──
export async function guestNight(env, orderId) {
  if (!/^[0-9a-f]{32}$/.test(String(orderId || ''))) return null;
  const o = await getDoc(env, 'counter_orders', orderId);
  if (!o || !o.fields.phone) return null;
  const phone = o.fields.phone, date = nightKey(o.fields.paidAt || o.fields.createdAt);
  if (date !== bizDate()) return { date, totalPesewas: 0, items: [], phoneHint: maskPhone(phone), over: true };
  // Their tables and quick sales tonight: the phone on the table, or the MoMo number that paid it.
  const [orders, tonight] = await Promise.all([queryWhere(env, 'counter_orders', [{ field: 'phone', value: phone }]), queryWhere(env, 'tabs', [{ field: 'businessDate', value: date }])]);
  const tabs = tonight.filter(t => t.fields.customerPhone === phone || (t.fields.payments || []).some(p => p.momoFrom === phone));
  const items = [];
  for (const x of orders.map(d => d.fields).filter(f => ['paid', 'delivered'].includes(f.status) && f.paidAt && nightKey(f.paidAt) === date)) {
    items.push({ at: x.paidAt, where: x.stationName || 'Bar', how: 'QR order', lines: x.lines.map(l => ({ qty: l.qty, name: l.name })), totalPesewas: x.totalPesewas });
  }
  for (const t of tabs) {
    const bill = billOf(t.fields, (await queryWhere(env, 'rounds', [{ field: 'tabId', value: t.id }])).map(r => r.fields));
    if (!bill.totalPesewas) continue;
    items.push({ at: t.fields.createdAt, where: where(t.fields), how: t.fields.quick ? 'Paid to staff' : `Served by ${String(t.fields.waiterName || '').split(/\s+/)[0]}`, lines: bill.lines.map(l => ({ qty: l.qty, name: l.name })), totalPesewas: bill.totalPesewas, leftPesewas: bill.balancePesewas });
  }
  items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { date, phoneHint: maskPhone(phone), totalPesewas: sum(items, i => i.totalPesewas), items };
}
