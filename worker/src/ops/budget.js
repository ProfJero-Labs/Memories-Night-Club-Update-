// The month's budget and the payments due, set by finance so the director can see what's due.
//
//   budgets/{YYYY-MM}  lines { category: amountPesewas } (expense categories + 'drinks' for drinks
//                      bought), note, setByName, setAt
//   bills/{id}         month (YYYY-MM), payee, description, category, amountPesewas, dueDate,
//                      payments [{ id, amountPesewas, date, paidWith, byName, at, expenseId }],
//                      createdByName, removed (with a reason; never deleted)
//
// Paying a bill records it as an expense too (so it counts in Money out), except a drinks supplier
// bill: those drinks were already counted when finance recorded them as bought.
// Finance (and the system admin) set these; the director, the manager and finance can see them.
import { getDoc, setDoc, queryWhere, queryRecent } from '../lib/firestore.js';
import { now, id, clean, nightKey } from '../lib/util.js';
import { requireRole, uidOf, REPORTS } from '../lib/auth.js';
import { FORBIDDEN, bizDate, isDate, audit, int } from './common.js';
import { EXPENSE_CATEGORIES } from './money.js';

export const BUDGET_SETTERS = ['finance', 'superAdmin'];
export const BILL_CATEGORIES = { supplier: 'Drinks supplier (owed)', ...EXPENSE_CATEGORIES };
export const BUDGET_CATEGORIES = { drinks: 'Drinks bought', ...EXPENSE_CATEGORIES };
const PAID_WITH = { cash: 'Cash', momo: 'MoMo', bank: 'Bank' };
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const thisMonth = () => bizDate().slice(0, 7);
const monthOr = m => (isMonth(m) ? m : thisMonth());
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
const shiftMonth = (m, by) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return d.toISOString().slice(0, 7); };
const notFinance = { error: 'Only the finance officer sets the budget and the bills.', status: 403 };

const paidOf = b => sum(b.payments || [], p => p.amountPesewas);
function billView(d, today) {
  const f = d.fields, paid = paidOf(f), left = Math.max(0, f.amountPesewas - paid);
  const state = f.removed ? 'removed' : !left ? 'paid' : f.dueDate < today ? 'overdue' : paid ? 'part_paid' : 'due';
  return { id: d.id, month: f.month, payee: f.payee, description: f.description || '', category: f.category, categoryLabel: BILL_CATEGORIES[f.category] || f.category, amountPesewas: f.amountPesewas, dueDate: f.dueDate,
    paidPesewas: paid, leftPesewas: f.removed ? 0 : left, state, payments: (f.payments || []).map(p => ({ amountPesewas: p.amountPesewas, date: p.date, paidWith: PAID_WITH[p.paidWith] || '', byName: p.byName })),
    createdByName: f.createdByName || '', removedReason: f.removedReason || '' };
}

// The month: budget against what's been spent, and the bills (due, overdue, paid).
export async function monthBudget(env, user, { month } = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const m = monthOr(month), from = `${m}-01`, to = lastDay(m), today = bizDate();
  const since = new Date(new Date(`${from}T00:00:00Z`).getTime() - 864e5);
  const [bud, billDocs, exp, buys] = await Promise.all([
    getDoc(env, 'budgets', m), queryWhere(env, 'bills', [{ field: 'month', value: m }]),
    queryRecent(env, 'expenses', 'createdAt', since, 5000), queryRecent(env, 'stock_deliveries', 'recordedAt', since, 5000),
  ]);
  const inMonth = d => d >= from && d <= to;
  const spent = {};
  for (const e of exp.map(x => x.fields).filter(e => !e.removed && inMonth(e.date))) spent[e.category] = (spent[e.category] || 0) + Number(e.amountPesewas);
  spent.drinks = sum(buys.map(x => x.fields).filter(d => d.status === 'confirmed' && inMonth(d.businessDate || nightKey(d.recordedAt))), d => d.totalCostPesewas ?? (d.unitCostPesewas != null ? d.unitCostPesewas * (d.confirmedQty ?? d.qty) : 0));
  const planned = bud?.fields?.lines || {};
  const cats = [...new Set([...Object.keys(planned), ...Object.keys(spent).filter(k => spent[k])])];
  const lines = cats.map(k => ({ category: k, label: BUDGET_CATEGORIES[k] || k, budgetPesewas: Number(planned[k] || 0), spentPesewas: spent[k] || 0 }))
    .map(l => ({ ...l, leftPesewas: l.budgetPesewas - l.spentPesewas, over: l.budgetPesewas > 0 && l.spentPesewas > l.budgetPesewas, unplanned: !l.budgetPesewas && l.spentPesewas > 0 }))
    .sort((a, b) => b.budgetPesewas - a.budgetPesewas || b.spentPesewas - a.spentPesewas);
  const bills = billDocs.map(d => billView(d, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const live = bills.filter(b => b.state !== 'removed');
  return {
    month: m, label: new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), prev: shiftMonth(m, -1), next: shiftMonth(m, 1), today,
    canEdit: !!requireRole(user, BUDGET_SETTERS), categories: BUDGET_CATEGORIES, billCategories: BILL_CATEGORIES,
    budget: { lines, totalPesewas: sum(lines, l => l.budgetPesewas), spentPesewas: sum(lines, l => l.spentPesewas), setByName: bud?.fields?.setByName || '', note: bud?.fields?.note || '' },
    bills, totals: { billsPesewas: sum(live, b => b.amountPesewas), paidPesewas: sum(live, b => b.paidPesewas), duePesewas: sum(live, b => b.leftPesewas),
      overduePesewas: sum(live.filter(b => b.state === 'overdue'), b => b.leftPesewas), overdue: live.filter(b => b.state === 'overdue').length,
      dueSoon: live.filter(b => b.leftPesewas && b.state !== 'overdue' && b.dueDate <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).length },
  };
}

export async function setBudget(env, b, user) {
  if (!requireRole(user, BUDGET_SETTERS)) return notFinance;
  const m = monthOr(b?.month), lines = {};
  for (const [k, v] of Object.entries(b?.lines || {})) {
    if (!BUDGET_CATEGORIES[k]) continue;
    if (v === '' || v == null) continue;
    const n = int(v); if (!(n >= 0)) return { error: `${BUDGET_CATEGORIES[k]}: enter an amount, or leave it blank.` };
    if (n) lines[k] = n;
  }
  await setDoc(env, 'budgets', m, { month: m, lines, note: clean(b?.note, 300), setBy: uidOf(user), setByName: user.name || '', setAt: now() });
  await audit(env, user, 'BUDGET_SET', { month: m, totalPesewas: sum(Object.values(lines), x => x) });
  return { saved: true };
}

export async function addBill(env, b, user) {
  if (!requireRole(user, BUDGET_SETTERS)) return notFinance;
  const payee = clean(b?.payee, 80), amount = int(b?.amountPesewas);
  if (!payee) return { error: 'Who is it owed to? e.g. “Guinness Ghana”, “Staff salaries”.' };
  if (!BILL_CATEGORIES[b?.category]) return { error: 'Pick what it is for.' };
  if (!(amount >= 100)) return { error: 'Enter the amount (at least GHS 1).' };
  if (!isDate(b?.dueDate)) return { error: 'Pick the date it must be paid by.' };
  const bid = id();
  await setDoc(env, 'bills', bid, { month: b.dueDate.slice(0, 7), payee, description: clean(b?.description, 160), category: b.category, amountPesewas: amount, dueDate: b.dueDate, payments: [], removed: false,
    createdBy: uidOf(user), createdByName: user.name || '', createdAt: now() });
  await audit(env, user, 'BILL_ADDED', { billId: bid, amountPesewas: amount, dueDate: b.dueDate });
  return { id: bid };
}

// Pay all or part of a bill. It goes into the expenses (except drinks supplier bills, see above).
export async function payBill(env, b, user) {
  if (!requireRole(user, BUDGET_SETTERS)) return notFinance;
  const d = await getDoc(env, 'bills', String(b?.id || ''));
  if (!d) return { error: 'Bill not found.', status: 404 };
  const f = d.fields;
  if (f.removed) return { error: 'This bill was taken off.' };
  const left = f.amountPesewas - paidOf(f);
  if (left <= 0) return { error: 'This bill is already paid.' };
  const amount = b?.amountPesewas == null || b.amountPesewas === '' ? left : int(b.amountPesewas);
  if (!(amount >= 100)) return { error: 'Enter the amount paid (at least GHS 1).' };
  if (amount > left) return { error: `Only ${(left / 100).toLocaleString('en-GH')} cedis is left to pay on this bill.` };
  const date = isDate(b?.date) ? b.date : bizDate(), paidWith = PAID_WITH[b?.paidWith] ? b.paidWith : 'bank', at = now();
  let expenseId = null;
  if (f.category !== 'supplier') {
    expenseId = id();
    await setDoc(env, 'expenses', expenseId, { date, category: f.category, description: `${f.payee}${f.description ? `: ${f.description}` : ''}`, amountPesewas: amount, paidWith, billId: d.id,
      recordedBy: uidOf(user), recordedByName: user.name || '', recordedRole: user.role, createdAt: at, removed: false });
  }
  await setDoc(env, 'bills', d.id, { ...f, payments: [...(f.payments || []), { id: id(), amountPesewas: amount, date, paidWith, by: uidOf(user), byName: user.name || '', at, expenseId }] });
  await audit(env, user, 'BILL_PAID', { billId: d.id, amountPesewas: amount, expenseId });
  return { paid: true, leftPesewas: left - amount };
}

export async function removeBill(env, b, user) {
  if (!requireRole(user, BUDGET_SETTERS)) return notFinance;
  const d = await getDoc(env, 'bills', String(b?.id || ''));
  if (!d) return { error: 'Bill not found.', status: 404 };
  if (d.fields.removed) return { error: 'Already taken off.' };
  if ((d.fields.payments || []).length) return { error: 'Part of this bill is paid already. Take off the payment’s expense instead, or leave it.' };
  const reason = clean(b?.reason, 200); if (!reason) return { error: 'Say why it’s being taken off.' };
  await setDoc(env, 'bills', d.id, { ...d.fields, removed: true, removedReason: reason, removedByName: user.name || '', removedAt: now() });
  await audit(env, user, 'BILL_REMOVED', { billId: d.id, reason });
  return { removed: true };
}

// A new month from the last one: the same bills (salaries, rent…) due on the same day, unpaid, and
// the same budget if this month has none yet. Bills already in this month aren't copied twice.
export async function copyMonth(env, b, user) {
  if (!requireRole(user, BUDGET_SETTERS)) return notFinance;
  const to = monthOr(b?.month), from = shiftMonth(to, -1);
  const [prev, have, bud, hasBud] = await Promise.all([queryWhere(env, 'bills', [{ field: 'month', value: from }]), queryWhere(env, 'bills', [{ field: 'month', value: to }]), getDoc(env, 'budgets', from), getDoc(env, 'budgets', to)]);
  const key = f => `${f.payee}|${f.category}|${f.amountPesewas}`;
  const seen = new Set(have.filter(x => !x.fields.removed).map(x => key(x.fields)));
  let copied = 0;
  for (const x of prev.filter(x => !x.fields.removed && x.fields.category !== 'supplier')) {
    if (seen.has(key(x.fields))) continue;
    const day = Math.min(Number(x.fields.dueDate.slice(8, 10)), Number(lastDay(to).slice(8, 10)));
    await setDoc(env, 'bills', id(), { month: to, payee: x.fields.payee, description: x.fields.description || '', category: x.fields.category, amountPesewas: x.fields.amountPesewas, dueDate: `${to}-${String(day).padStart(2, '0')}`,
      payments: [], removed: false, createdBy: uidOf(user), createdByName: user.name || '', createdAt: now(), copiedFrom: x.id });
    copied++;
  }
  let budget = false;
  if (bud && !hasBud) { await setDoc(env, 'budgets', to, { ...bud.fields, month: to, setBy: uidOf(user), setByName: user.name || '', setAt: now() }); budget = true; }
  await audit(env, user, 'MONTH_COPIED', { from, to, copied, budget });
  return { copied, budget };
}
