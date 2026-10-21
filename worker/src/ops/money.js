// Money: is the club making money? For the director (and the manager and finance), in plain words.
//
//   expenses/{id}  date (the night it belongs to), category, description, amountPesewas, paidWith
//                  cash|momo|bank, recordedBy(Name), createdAt; removed (with a reason) is kept, never
//                  deleted. The manager and finance record them.
//
// The money report, for tonight, this week or this month:
//   Money in  = drinks paid for (waiters, bar, QR) + the club's share of table bookings
//               (ticket sales are left out: they're the events side, not the director's)
//   Money out = drinks bought (purchases recorded with what was paid) + expenses
//   Profit    = money in − money out
// Plus drinks on their own: what was sold, what those drinks cost the club, and the difference.
import { setDoc, getDoc, queryRecent, listDocs } from '../lib/firestore.js';
import { now, id, clean, nightKey } from '../lib/util.js';
import { requireRole, uidOf, REPORTS } from '../lib/auth.js';
import { FORBIDDEN, bizDate, isDate, audit, int, ghs } from './common.js';
import { billOf } from './tabs.js';

export const EXPENSE_HANDS = ['superAdmin', 'director', 'manager', 'finance'];
export const EXPENSE_CATEGORIES = { staff: 'Staff pay', dj: 'DJ and artists', rent: 'Rent', power: 'Light and water', fuel: 'Fuel / generator', security: 'Security', cleaning: 'Cleaning', repairs: 'Repairs', marketing: 'Adverts and promotion', supplies: 'Ice, cups and supplies', transport: 'Transport', commission: 'Commissions', other: 'Other' };
const PAID_WITH = { cash: 'Cash', momo: 'MoMo', bank: 'Bank' };
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const DAY = 864e5;

// ── Expenses ──
export async function addExpense(env, b, user) {
  if (!requireRole(user, EXPENSE_HANDS)) return { error: 'The manager or finance records expenses.', status: 403 };
  const amount = int(b?.amountPesewas);
  if (!(amount >= 100)) return { error: 'Enter the amount (at least GHS 1).' };
  if (!EXPENSE_CATEGORIES[b?.category]) return { error: 'Pick what it was for.' };
  const description = clean(b?.description, 160);
  if (!description) return { error: 'Say what it was, e.g. “DJ Kofi, Saturday”.' };
  const date = isDate(b?.date) ? b.date : bizDate();
  if (date > bizDate()) return { error: 'That date is in the future.' };
  const eid = id();
  await setDoc(env, 'expenses', eid, { date, category: b.category, description, amountPesewas: amount, paidWith: PAID_WITH[b?.paidWith] ? b.paidWith : 'cash',
    receipt: clean(b?.receipt, 60), recordedBy: uidOf(user), recordedByName: user.name || '', recordedRole: user.role, createdAt: now(), removed: false });
  await audit(env, user, 'EXPENSE_ADDED', { expenseId: eid, amountPesewas: amount, category: b.category, date });
  return { id: eid };
}

// Taken off (a mistake): kept on record with who and why. Finance, the director, or whoever added it.
export async function removeExpense(env, b, user) {
  if (!requireRole(user, EXPENSE_HANDS)) return FORBIDDEN;
  const e = await getDoc(env, 'expenses', String(b?.id || ''));
  if (!e) return { error: 'Expense not found.', status: 404 };
  if (e.fields.removed) return { error: 'Already taken off.' };
  if (e.fields.recordedBy !== uidOf(user) && !requireRole(user, ['finance', 'director', 'superAdmin'])) return { error: 'Only finance, the director, or the person who added it can take it off.', status: 403 };
  const reason = clean(b?.reason, 200);
  if (!reason) return { error: 'Say why it’s being taken off.' };
  await setDoc(env, 'expenses', e.id, { ...e.fields, removed: true, removedByName: user.name || '', removedAt: now(), removedReason: reason });
  await audit(env, user, 'EXPENSE_REMOVED', { expenseId: e.id, amountPesewas: e.fields.amountPesewas, reason });
  return { removed: true };
}

// ── The period ──
// today: tonight. week: the last 7 nights. month: this calendar month. Or from/to (YYYY-MM-DD).
export function periodOf({ period, from, to } = {}) {
  const today = bizDate();
  if (isDate(from) && isDate(to) && from <= to) return { from, to, label: from === to ? from : `${from} to ${to}`, key: 'custom' };
  if (period === 'week') return { from: nightKey(new Date(Date.now() - 6 * DAY)), to: today, label: 'The last 7 days', key: 'week' };
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today, label: 'This month', key: 'month' };
  return { from: today, to: today, label: 'Tonight', key: 'today' };
}

export async function moneyReport(env, user, q = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const p = periodOf(q);
  const inRange = d => d >= p.from && d <= p.to;
  // Everything created from the day before the period (a night runs past midnight), filtered by night.
  const since = new Date(new Date(`${p.from}T00:00:00Z`).getTime() - DAY);
  const [tabsRaw, roundsRaw, qrRaw, ordersRaw, buysRaw, expRaw, items] = await Promise.all([
    queryRecent(env, 'tabs', 'createdAt', since, 10000), queryRecent(env, 'rounds', 'createdAt', since, 20000), queryRecent(env, 'counter_orders', 'createdAt', since, 10000),
    queryRecent(env, 'orders', 'createdAt', since, 10000), queryRecent(env, 'stock_deliveries', 'recordedAt', since, 5000), queryRecent(env, 'expenses', 'createdAt', since, 5000),
    listDocs(env, 'menu_items'),
  ]);
  const cost = Object.fromEntries(items.map(i => [i.id, Number(i.fields.costPesewas || 0)]));
  const rounds = roundsRaw.map(r => ({ id: r.id, ...r.fields })).filter(r => r.status !== 'cancelled');
  const tabs = tabsRaw.map(t => ({ id: t.id, ...t.fields })).filter(t => inRange(t.businessDate));
  for (const t of tabs) t.bill = billOf(t, rounds.filter(r => r.tabId === t.id));
  const qr = qrRaw.map(o => ({ id: o.id, ...o.fields })).filter(o => ['paid', 'delivered'].includes(o.status) && o.paidAt && inRange(nightKey(o.paidAt)));
  const orders = ordersRaw.map(o => ({ id: o.id, ...o.fields })).filter(o => o.status === 'confirmed' && o.kind === 'table' && Number(o.amountPesewas) > 0 && inRange(nightKey(o.createdAt)));
  const buys = buysRaw.map(d => ({ id: d.id, ...d.fields })).filter(d => d.status === 'confirmed' && inRange(d.businessDate || nightKey(d.recordedAt)));
  const expenses = expRaw.map(e => ({ id: e.id, ...e.fields })).filter(e => inRange(e.date));
  const live = expenses.filter(e => !e.removed);

  // Drinks: money received (cash, MoMo, phone payments) and what was sold.
  const pays = tabs.flatMap(t => (t.payments || []).map(p => ({ ...p, date: t.businessDate })));
  const night = (k, x) => (k === 'qr' ? nightKey(x.paidAt) : x.date);
  const drinksPaid = sum(pays, x => x.amountPesewas) + sum(qr, o => o.totalPesewas);
  const soldLines = [
    ...tabs.flatMap(t => rounds.filter(r => r.tabId === t.id).flatMap(r => r.lines.map(l => ({ ...l, n: Math.max(0, l.qty - (l.returnedQty || 0) - (l.brokenQty || 0) - (l.compQty || 0)) })))),
    ...qr.flatMap(o => (o.lines || []).map(l => ({ productId: l.itemId, name: l.name, unitPesewas: l.unitPesewas, n: l.qty }))),
  ].filter(l => l.n > 0);
  const byDrink = new Map();
  for (const l of soldLines) { const d = byDrink.get(l.name) || { name: l.name, qty: 0, salesPesewas: 0, costPesewas: 0 }; d.qty += l.n; d.salesPesewas += l.n * l.unitPesewas; d.costPesewas += l.n * (cost[l.productId] || 0); byDrink.set(l.name, d); }
  const drinkRows = [...byDrink.values()].map(d => ({ ...d, profitPesewas: d.salesPesewas - d.costPesewas })).sort((a, b) => b.salesPesewas - a.salesPesewas);
  const drinksSold = sum(drinkRows, d => d.salesPesewas), drinksCost = sum(drinkRows, d => d.costPesewas);
  const noCost = drinkRows.filter(d => !d.costPesewas).map(d => d.name);

  // Table bookings: the club's share (organiser and platform shares are not the club's money).
  const share = o => Number(o.shares?.memoriesSharePesewas ?? o.amountPesewas);
  const tables = orders;

  const buyCost = d => Number(d.totalCostPesewas ?? (d.unitCostPesewas != null ? d.unitCostPesewas * (d.confirmedQty ?? d.qty) : 0));
  const bought = sum(buys, buyCost), spent = sum(live, e => e.amountPesewas);
  const moneyIn = drinksPaid + sum(tables, share), moneyOut = bought + spent;

  // Night by night.
  const days = new Map();
  const day = d => days.get(d) || days.set(d, { date: d, inPesewas: 0, outPesewas: 0 }).get(d);
  for (const x of pays) day(night('tab', x)).inPesewas += Number(x.amountPesewas || 0);
  for (const o of qr) day(night('qr', o)).inPesewas += o.totalPesewas;
  for (const o of orders) day(nightKey(o.createdAt)).inPesewas += share(o);
  for (const d of buys) day(d.businessDate || nightKey(d.recordedAt)).outPesewas += buyCost(d);
  for (const e of live) day(e.date).outPesewas += e.amountPesewas;

  const byCat = new Map();
  for (const e of live) byCat.set(e.category, (byCat.get(e.category) || 0) + e.amountPesewas);
  return {
    period: p, categories: EXPENSE_CATEGORIES, paidWith: PAID_WITH, canAddExpense: !!requireRole(user, EXPENSE_HANDS),
    totals: { inPesewas: moneyIn, outPesewas: moneyOut, profitPesewas: moneyIn - moneyOut },
    moneyIn: [
      { key: 'drinks', label: 'Drinks (bar and waiters)', amountPesewas: drinksPaid },
      { key: 'tables', label: `Tables (${tables.length} booked, club’s share)`, amountPesewas: sum(tables, share) },
    ],
    moneyOut: [
      { key: 'drinks_bought', label: 'Drinks bought', amountPesewas: bought },
      ...[...byCat.entries()].map(([k, v]) => ({ key: k, label: EXPENSE_CATEGORIES[k] || k, amountPesewas: v })).sort((a, b) => b.amountPesewas - a.amountPesewas),
    ],
    drinks: { soldPesewas: drinksSold, costPesewas: drinksCost, profitPesewas: drinksSold - drinksCost, paidPesewas: drinksPaid, unpaidPesewas: sum(tabs.filter(t => t.status !== 'written_off'), t => t.bill.balancePesewas), rows: drinkRows.slice(0, 40), missingCost: noCost },
    purchases: buys.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt))).slice(0, 50).map(d => ({ id: d.id, date: d.businessDate || nightKey(d.recordedAt), productName: d.productName, qty: d.confirmedQty ?? d.qty, costPesewas: buyCost(d), recordedByName: d.recordedByName, supplier: d.supplier || '' })),
    expenses: expenses.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100).map(e => ({ id: e.id, date: e.date, category: e.category, categoryLabel: EXPENSE_CATEGORIES[e.category] || e.category, description: e.description, amountPesewas: e.amountPesewas, paidWith: PAID_WITH[e.paidWith] || '', recordedByName: e.recordedByName, removed: !!e.removed, removedReason: e.removedReason || '', removedByName: e.removedByName || '', canRemove: !e.removed && (e.recordedBy === uidOf(user) || !!requireRole(user, ['finance', 'director', 'superAdmin'])) })),
    byNight: [...days.values()].filter(d => d.inPesewas || d.outPesewas).map(d => ({ ...d, profitPesewas: d.inPesewas - d.outPesewas })).sort((a, b) => b.date.localeCompare(a.date)),
    summary: `${p.label}: ${ghs(moneyIn)} in, ${ghs(moneyOut)} out, ${moneyIn - moneyOut >= 0 ? `${ghs(moneyIn - moneyOut)} profit` : `${ghs(moneyOut - moneyIn)} loss`}.`,
  };
}
