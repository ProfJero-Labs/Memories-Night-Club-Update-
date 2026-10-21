// Commissions: 10% to the person who brings a table deal over GHS 3,000.
//
// A deal is a table booked online (orders, kind 'table', confirmed) or a table in the club (a tab,
// not a quick sale) whose amount is over the line: for a booking, what the customer paid; for a table
// in the club, what has been paid on its bill. The commission is 10% of that whole amount.
//
// Who brought it: `broughtBy` { name, phone, setByName, at } on the booking or the tab, named by the
// waiter when opening the table, or later by the manager or finance. Paid: `commissionPaid`
// { amountPesewas, at, byName, expenseId }, set when finance pays the person (one expense per payout,
// under Commissions, so it counts in Money out).
// The director, the manager and finance see the deals, who is owed what, and what's been paid.
import { getDoc, setDoc, queryRecent, queryWhere } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, nightKey } from '../lib/util.js';
import { requireRole, uidOf, REPORTS } from '../lib/auth.js';
import { FORBIDDEN, bizDate, audit } from './common.js';
import { billOf } from './tabs.js';

export const COMMISSION_RATE_PCT = 10;
export const COMMISSION_OVER_PESEWAS = 300000;               // more than GHS 3,000
const ASSIGNERS = ['superAdmin', 'director', 'manager', 'finance'];
const PAYERS = ['finance', 'superAdmin'];
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const shiftMonth = (m, by) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
export const commissionOf = amount => (amount > COMMISSION_OVER_PESEWAS ? Math.round(amount * COMMISSION_RATE_PCT / 100) : 0);
const personKey = b => (b?.phone ? normalizePhone(b.phone) : '') || String(b?.name || '').trim().toLowerCase();

async function dealsIn(env, m) {
  const since = new Date(new Date(`${m}-01T00:00:00Z`).getTime() - 864e5);
  const [orders, tabs, rounds] = await Promise.all([queryRecent(env, 'orders', 'createdAt', since, 10000), queryRecent(env, 'tabs', 'createdAt', since, 10000), queryRecent(env, 'rounds', 'createdAt', since, 20000)]);
  const deals = [];
  for (const o of orders.map(d => ({ id: d.id, ...d.fields })).filter(o => o.kind === 'table' && o.status === 'confirmed' && nightKey(o.createdAt).slice(0, 7) === m)) {
    const amount = Number(o.amountPesewas || 0); if (!commissionOf(amount)) continue;
    deals.push({ kind: 'booking', id: o.id, date: nightKey(o.createdAt), label: `${o.packageName || 'Table'} booked online`, night: o.eventName || '', customer: o.buyerName || '', customerPhone: o.buyerPhone || '', amountPesewas: amount, broughtBy: o.broughtBy || null, paid: o.commissionPaid || null });
  }
  const R = rounds.map(r => ({ id: r.id, ...r.fields }));
  for (const t of tabs.map(d => ({ id: d.id, ...d.fields })).filter(t => !t.quick && t.status !== 'written_off' && String(t.businessDate || '').slice(0, 7) === m)) {
    const bill = billOf(t, R.filter(r => r.tabId === t.id)), amount = Math.min(bill.paidPesewas, bill.totalPesewas);
    if (!commissionOf(amount)) continue;
    deals.push({ kind: 'tab', id: t.id, date: t.businessDate, label: `${t.table === 'Walk-in' ? 'No table' : `Table ${t.table}`} · Tab ${t.number}`, night: '', customer: t.customerName || '', customerPhone: t.customerPhone || '', amountPesewas: amount, servedBy: t.waiterName || '', broughtBy: t.broughtBy || null, paid: t.commissionPaid || null });
  }
  return deals.map(d => ({ ...d, commissionPesewas: d.paid?.amountPesewas ?? commissionOf(d.amountPesewas) })).sort((a, b) => b.date.localeCompare(a.date) || b.amountPesewas - a.amountPesewas);
}

export async function commissions(env, user, { month } = {}) {
  if (!requireRole(user, REPORTS)) return FORBIDDEN;
  const m = isMonth(month) ? month : bizDate().slice(0, 7);
  const deals = await dealsIn(env, m);
  const payouts = Object.fromEntries((await queryWhere(env, 'commission_payouts', [{ field: 'month', value: m }])).map(p => [p.fields.key, p.fields]));
  const people = new Map();
  for (const d of deals.filter(x => x.broughtBy)) {
    const k = personKey(d.broughtBy), p = people.get(k) || { key: k, name: d.broughtBy.name, phone: d.broughtBy.phone || '', deals: 0, owedPesewas: 0, paidPesewas: 0 };
    p.deals += 1; if (d.paid) p.paidPesewas += d.commissionPesewas; else p.owedPesewas += d.commissionPesewas; people.set(k, p);
  }
  return {
    month: m, label: new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), prev: shiftMonth(m, -1), next: shiftMonth(m, 1),
    ratePct: COMMISSION_RATE_PCT, overPesewas: COMMISSION_OVER_PESEWAS, canAssign: !!requireRole(user, ASSIGNERS), canPay: !!requireRole(user, PAYERS),
    deals, people: [...people.values()].map(p => ({ ...p, payout: payouts[p.key] && p.owedPesewas ? { status: payouts[p.key].status, amountPesewas: payouts[p.key].amountPesewas, decidedByName: payouts[p.key].decidedByName || '' } : null })).sort((a, b) => b.owedPesewas - a.owedPesewas || b.paidPesewas - a.paidPesewas),
    totals: { commissionPesewas: sum(deals.filter(d => d.broughtBy), d => d.commissionPesewas), owedPesewas: sum(deals.filter(d => d.broughtBy && !d.paid), d => d.commissionPesewas),
      paidPesewas: sum(deals.filter(d => d.paid), d => d.commissionPesewas), unassigned: deals.filter(d => !d.broughtBy).length, unassignedPesewas: sum(deals.filter(d => !d.broughtBy), d => d.commissionPesewas) },
  };
}

// Who brought the deal (or nobody: name left blank clears it). Not after the commission is paid.
export async function assignDeal(env, b, user) {
  if (!requireRole(user, ASSIGNERS)) return FORBIDDEN;
  const col = b?.kind === 'booking' ? 'orders' : b?.kind === 'tab' ? 'tabs' : null;
  if (!col) return { error: 'Pick the deal.' };
  const d = await getDoc(env, col, String(b?.id || ''));
  if (!d || (col === 'orders' && d.fields.kind !== 'table')) return { error: 'Deal not found.', status: 404 };
  if (d.fields.commissionPaid) return { error: 'The commission on this deal is already paid.' };
  const name = clean(b?.name, 60), phone = b?.phone ? normalizePhone(b.phone) : '';
  if (b?.phone && !phone) return { error: 'That phone number doesn’t look right, or leave it blank.' };
  const broughtBy = name ? { name, phone, setBy: uidOf(user), setByName: user.name || '', at: now() } : null;
  await setDoc(env, col, d.id, { ...d.fields, broughtBy });
  await audit(env, user, 'DEAL_BROUGHT_BY', { col, id: d.id, name });
  return { saved: true };
}

// Paying a commission takes a director's approval: finance (or a manager) asks, a director
// approves the amount, finance pays. commission_payouts/{month}__{key}: name, amountPesewas,
// deals, status requested → approved → paid, or refused.
const payoutId = (m, key) => `${m}__${key.replace(/[^a-z0-9]/gi, '_')}`;
export async function requestPayout(env, b, user) {
  if (!requireRole(user, ASSIGNERS)) return FORBIDDEN;
  const m = isMonth(b?.month) ? b.month : bizDate().slice(0, 7), key = String(b?.key || '');
  const owed = (await dealsIn(env, m)).filter(d => d.broughtBy && !d.paid && personKey(d.broughtBy) === key);
  if (!owed.length) return { error: 'Nothing is owed to this person for that month.' };
  const pid = payoutId(m, key), old = await getDoc(env, 'commission_payouts', pid);
  if (old && ['requested', 'approved'].includes(old.fields.status)) return { error: old.fields.status === 'requested' ? 'Already waiting for a director.' : 'Already approved: finance pays it.' };
  await setDoc(env, 'commission_payouts', pid, { month: m, key, name: owed[0].broughtBy.name, phone: owed[0].broughtBy.phone || '', amountPesewas: sum(owed, d => d.commissionPesewas), deals: owed.length, status: 'requested', requestedBy: uidOf(user), requestedByName: user.name || '', requestedAt: now() });
  await audit(env, user, 'COMMISSION_PAYOUT_REQUESTED', { payoutId: pid });
  return { requested: true, id: pid };
}
export async function decidePayout(env, pid, approve, note, user) {
  if (!requireRole(user, ['superAdmin', 'director'])) return { error: 'A director approves payments.', status: 403 };
  const p = await getDoc(env, 'commission_payouts', String(pid || '')); if (!p) return { error: 'Not found.', status: 404 };
  if (p.fields.status !== 'requested') return { error: 'Already decided.' };
  await setDoc(env, 'commission_payouts', p.id, { ...p.fields, status: approve ? 'approved' : 'refused', decidedBy: uidOf(user), decidedByName: user.name || '', decidedAt: now(), decisionNote: clean(note, 200) });
  await audit(env, user, approve ? 'COMMISSION_PAYOUT_APPROVED' : 'COMMISSION_PAYOUT_REFUSED', { payoutId: p.id });
  return { decided: true };
}

// Pay a person everything approved for the month: each deal is marked paid, one expense.
export async function payCommission(env, b, user) {
  if (!requireRole(user, PAYERS)) return { error: 'Finance pays commissions.', status: 403 };
  const m = isMonth(b?.month) ? b.month : bizDate().slice(0, 7), key = String(b?.key || '');
  const owed = (await dealsIn(env, m)).filter(d => d.broughtBy && !d.paid && personKey(d.broughtBy) === key);
  if (!owed.length) return { error: 'Nothing is owed to this person for that month.' };
  const approval = await getDoc(env, 'commission_payouts', payoutId(m, key));
  if (approval?.fields?.status !== 'approved') return { error: 'A director must approve this payment first.' };
  const total = sum(owed, d => d.commissionPesewas), at = now(), expenseId = id(), who = owed[0].broughtBy;
  if (total !== approval.fields.amountPesewas) return { error: `The amount changed since a director approved ${(approval.fields.amountPesewas / 100).toLocaleString('en-GH')} cedis. Ask again.` };
  const paidWith = ['cash', 'momo', 'bank'].includes(b?.paidWith) ? b.paidWith : 'momo';
  await setDoc(env, 'expenses', expenseId, { date: bizDate(), category: 'commission', description: `Commission: ${who.name} (${owed.length} deal${owed.length > 1 ? 's' : ''}, ${m})`, amountPesewas: total, paidWith,
    recordedBy: uidOf(user), recordedByName: user.name || '', recordedRole: user.role, createdAt: at, removed: false, commissionFor: key });
  for (const d of owed) {
    const col = d.kind === 'booking' ? 'orders' : 'tabs', doc = await getDoc(env, col, d.id);
    await setDoc(env, col, d.id, { ...doc.fields, commissionPaid: { amountPesewas: d.commissionPesewas, at, byName: user.name || '', expenseId } });
  }
  await setDoc(env, 'commission_payouts', approval.id, { ...approval.fields, status: 'paid', paidAt: at, paidByName: user.name || '', expenseId });
  await audit(env, user, 'COMMISSION_PAID', { key, month: m, amountPesewas: total, deals: owed.length, expenseId });
  return { paid: true, amountPesewas: total, deals: owed.length };
}
