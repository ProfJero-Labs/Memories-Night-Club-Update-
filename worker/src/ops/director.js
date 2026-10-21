// Everything that needs a director, in one list. Any director can approve any of it, at any time.
//   salaries (the month's payroll, sent by the Human manager) · loans (recorded by the Human manager)
//   bills (added by finance) · commission payouts (asked by finance or a manager) · purchases
//   (asked by the Manager, checked by finance)
// Approved: finance can pay it. Refused: it goes back with the director's reason.
import { queryWhere, getDoc } from '../lib/firestore.js';
import { requireRole } from '../lib/auth.js';
import { FORBIDDEN } from './common.js';
import { decidePayroll, decideLoan, monthLabel } from './payroll.js';
import { decideBill } from './budget.js';
import { decidePayout } from './commission.js';
import { decidePurchase } from './purchases.js';
import { decideExpense, EXPENSE_CATEGORIES } from './money.js';

const DIRECTORS = ['superAdmin', 'director'];
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);

export async function toApprove(env, user) {
  if (!requireRole(user, DIRECTORS)) return FORBIDDEN;
  const [payrolls, loans, bills, payouts, buys, exps] = await Promise.all([
    queryWhere(env, 'payrolls', [{ field: 'status', value: 'submitted' }]), queryWhere(env, 'loans', [{ field: 'status', value: 'requested' }]),
    queryWhere(env, 'bills', [{ field: 'removed', value: false }]), queryWhere(env, 'commission_payouts', [{ field: 'status', value: 'requested' }]),
    queryWhere(env, 'purchase_requests', [{ field: 'status', value: 'checked' }]), queryWhere(env, 'expenses', [{ field: 'approval', value: 'pending' }]),
  ]);
  const items = [
    ...payrolls.map(p => ({ kind: 'payroll', id: p.id, title: `Salaries for ${monthLabel(p.id)}`, amountPesewas: sum(p.fields.lines || [], l => l.netPesewas), byName: p.fields.submittedByName, at: p.fields.submittedAt,
      detail: `${(p.fields.lines || []).length} people`, lines: (p.fields.lines || []).map(l => ({ label: `${l.name} (${l.roleName})`, amountPesewas: l.netPesewas, sub: l.lines.filter(x => x.label !== 'Monthly salary').map(x => `${x.label}${x.reason ? `: ${x.reason}` : ''} ${x.amountPesewas < 0 ? '−' : '+'}${Math.abs(x.amountPesewas / 100)}`).join(' · ') })) })),
    ...loans.map(l => ({ kind: 'loan', id: l.id, title: `Loan to ${l.fields.name}`, amountPesewas: l.fields.amountPesewas, byName: l.fields.requestedByName, at: l.fields.requestedAt, detail: `${l.fields.reason} · repaid ${(l.fields.monthlyPesewas / 100).toLocaleString('en-GH')} cedis a month from salary` })),
    ...bills.filter(b => !b.fields.approvedAt && !(b.fields.payments || []).length).map(b => ({ kind: 'bill', id: b.id, title: `Bill: ${b.fields.payee}`, amountPesewas: b.fields.amountPesewas, byName: b.fields.createdByName, at: b.fields.createdAt, detail: `${b.fields.description || ''}${b.fields.description ? ' · ' : ''}due ${b.fields.dueDate}` })),
    ...payouts.map(p => ({ kind: 'commission', id: p.id, title: `Commission: ${p.fields.name}`, amountPesewas: p.fields.amountPesewas, byName: p.fields.requestedByName, at: p.fields.requestedAt, detail: `${p.fields.deals} table deal${p.fields.deals > 1 ? 's' : ''} in ${monthLabel(p.fields.month)}` })),
    ...buys.map(r => ({ kind: 'purchase', id: r.id, title: `Buy drinks for ${r.fields.stationName}`, amountPesewas: r.fields.estTotalPesewas, byName: r.fields.requestedByName, at: r.fields.requestedAt, detail: `Checked by ${r.fields.checkedByName}${r.fields.checkNote ? `: ${r.fields.checkNote}` : ''}`,
      lines: r.fields.lines.map(l => ({ label: `${l.qty} × ${l.name}`, amountPesewas: l.qty * l.estUnitCostPesewas, sub: `has ${l.stockNow}${l.max ? `, max ${l.max}` : ''}` })) })),
    ...exps.filter(e => !e.fields.removed).map(e => ({ kind: 'expense', id: e.id, title: `Expense: ${e.fields.description}`, amountPesewas: e.fields.amountPesewas, byName: e.fields.recordedByName, at: e.fields.createdAt, detail: `${EXPENSE_CATEGORIES[e.fields.category] || e.fields.category} · above the limit set in the budget` })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { items, totalPesewas: sum(items, i => i.amountPesewas) };
}

export async function decide(env, b, user) {
  if (!requireRole(user, DIRECTORS)) return { error: 'A director approves payments.', status: 403 };
  const approve = b?.approve === true, note = b?.note || '';
  switch (b?.kind) {
    case 'payroll': return decidePayroll(env, b.id, approve, note, user);
    case 'loan': return decideLoan(env, b.id, approve, note, user);
    case 'bill': return decideBill(env, b.id, approve, note, user);
    case 'commission': return decidePayout(env, b.id, approve, note, user);
    case 'purchase': return decidePurchase(env, b.id, approve, note, user);
    case 'expense': return decideExpense(env, b.id, approve, note, user);
  }
  return { error: 'Unknown request.' };
}
export { getDoc };
