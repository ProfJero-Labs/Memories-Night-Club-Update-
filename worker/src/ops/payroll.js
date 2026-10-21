// Staff pay: fixed monthly salaries, bonuses, deductions and loans.
//
//   staff_pay/{uid}    salaryPesewas, payMethod momo|bank, momoNumber, momoName, bankName,
//                      bankAccount, accountName, updatedByName, updatedAt (the Human manager)
//   pay_items/{id}     uid, name, month (YYYY-MM), kind bonus|deduction, amountPesewas, reason,
//                      byName, at, removed (the Human manager; before the month is sent)
//   loans/{id}         uid, name, amountPesewas, monthlyPesewas, reason, status requested →
//                      approved (a director) → paid (finance; the money left) → cleared, or
//                      rejected; repaid [{ month, amountPesewas }]
//   payrolls/{YYYY-MM} status draft → submitted (the Human manager) → approved (a director) →
//                      paid (finance pays each person); lines frozen when sent
//
// Pay for a month = salary + bonuses − deductions − loan repayment (the monthly amount, or what's
// left of the loan). When finance marks a person paid: their payslip is ready on My page, they get
// a text, the net pay is an expense (Staff pay) and the loan repayment is taken off the loan.
// A loan paid out is money out too (Staff loans); it comes back through the salaries.
import { getDoc, setDoc, queryWhere, listDocs } from '../lib/firestore.js';
import { now, id, clean, normalizePhone, maskPhone } from '../lib/util.js';
import { requireRole, uidOf, STAFF_ROLES } from '../lib/auth.js';
import { sendSms } from '../lib/notify.js';
import { ROLE_NAMES } from '../staffauth.js';
import { FORBIDDEN, bizDate, isDate, audit, int, ghs } from './common.js';

export const HR = ['superAdmin', 'hrManager'];
const DIRECTORS = ['superAdmin', 'director'];
const PAYERS = ['superAdmin', 'finance'];
const SEE = ['superAdmin', 'director', 'hrManager', 'finance'];
const isMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const thisMonth = () => bizDate().slice(0, 7);
const monthOr = m => (isMonth(m) ? m : thisMonth());
const monthLabel = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const LOAN_LABEL = { requested: 'Waiting for a director', approved: 'Approved: waiting for finance to pay', paid: 'Being repaid from salary', cleared: 'Repaid', rejected: 'Not approved' };
const PAYROLL_LABEL = { draft: 'Being prepared by the Human manager', submitted: 'Waiting for a director', approved: 'Approved: finance pays', paid: 'Paid' };
const loanLeft = l => Math.max(0, Number(l.amountPesewas) - sum(l.repaid || [], r => r.amountPesewas));
const payTo = p => (!p ? '' : p.payMethod === 'bank' ? [p.bankName, p.bankAccount, p.accountName].filter(Boolean).join(' · ') : p.momoNumber ? `MoMo ${maskPhone(p.momoNumber)}${p.momoName ? ` (${p.momoName})` : ''}` : '');
const staffOnly = d => !d.fields.removed && STAFF_ROLES.includes(d.fields.role) && !['organiser', 'superAdmin'].includes(d.fields.role) && d.fields.admin !== true;

// ── Payment details and salary (the Human manager) ──
export async function setPayDetails(env, b, user) {
  if (!requireRole(user, HR)) return { error: 'The Human manager sets pay.', status: 403 };
  const u = await getDoc(env, 'users', String(b?.uid || ''));
  if (!u || !staffOnly(u)) return { error: 'Staff member not found.', status: 404 };
  const salary = int(b?.salaryPesewas);
  if (!(salary >= 0)) return { error: 'Enter the monthly salary (0 if none).' };
  const method = b?.payMethod === 'bank' ? 'bank' : 'momo';
  const momo = b?.momoNumber ? normalizePhone(b.momoNumber) : '';
  if (method === 'momo' && b?.momoNumber && !momo) return { error: 'That MoMo number doesn’t look right.' };
  const old = (await getDoc(env, 'staff_pay', u.id))?.fields || {};
  await setDoc(env, 'staff_pay', u.id, { ...old, uid: u.id, salaryPesewas: salary, payMethod: method, momoNumber: momo, momoName: clean(b?.momoName, 60), bankName: clean(b?.bankName, 60), bankAccount: clean(b?.bankAccount, 30), accountName: clean(b?.accountName, 60), updatedBy: uidOf(user), updatedByName: user.name || '', updatedAt: now() });
  await audit(env, user, 'PAY_DETAILS_SET', { targetUid: u.id, salaryPesewas: salary, from: old.salaryPesewas ?? null });
  return { saved: true };
}

export async function addPayItem(env, b, user) {
  if (!requireRole(user, HR)) return { error: 'The Human manager adds bonuses and deductions.', status: 403 };
  const m = monthOr(b?.month), u = await getDoc(env, 'users', String(b?.uid || ''));
  if (!u || !staffOnly(u)) return { error: 'Staff member not found.', status: 404 };
  const kind = b?.kind === 'deduction' ? 'deduction' : 'bonus', amount = int(b?.amountPesewas), reason = clean(b?.reason, 160);
  if (!(amount >= 100)) return { error: 'Enter the amount (at least GHS 1).' };
  if (!reason) return { error: kind === 'bonus' ? 'Say what the bonus is for.' : 'Say why it’s deducted.' };
  const pr = await getDoc(env, 'payrolls', m);
  if (pr && pr.fields.status !== 'draft') return { error: `${monthLabel(m)} has been sent to the directors. Add it to next month.` };
  const iid = id();
  await setDoc(env, 'pay_items', iid, { uid: u.id, name: u.fields.name || '', month: m, kind, amountPesewas: amount, reason, by: uidOf(user), byName: user.name || '', at: now(), removed: false });
  await audit(env, user, kind === 'bonus' ? 'BONUS_ADDED' : 'DEDUCTION_ADDED', { targetUid: u.id, month: m, amountPesewas: amount });
  return { id: iid };
}
export async function removePayItem(env, b, user) {
  if (!requireRole(user, HR)) return FORBIDDEN;
  const it = await getDoc(env, 'pay_items', String(b?.id || '')); if (!it) return { error: 'Not found.', status: 404 };
  const pr = await getDoc(env, 'payrolls', it.fields.month);
  if (pr && pr.fields.status !== 'draft') return { error: 'That month has been sent to the directors.' };
  await setDoc(env, 'pay_items', it.id, { ...it.fields, removed: true, removedByName: user.name || '', removedAt: now() });
  return { removed: true };
}

// ── Loans: the Human manager records it, a director approves, finance pays it out ──
export async function requestLoan(env, b, user) {
  if (!requireRole(user, HR)) return { error: 'The Human manager records loans.', status: 403 };
  const u = await getDoc(env, 'users', String(b?.uid || ''));
  if (!u || !staffOnly(u)) return { error: 'Staff member not found.', status: 404 };
  const amount = int(b?.amountPesewas), monthly = int(b?.monthlyPesewas), reason = clean(b?.reason, 160);
  if (!(amount >= 100)) return { error: 'Enter the loan amount.' };
  if (!(monthly >= 100 && monthly <= amount)) return { error: 'Enter how much comes off each month’s salary (no more than the loan).' };
  if (!reason) return { error: 'Say what the loan is for.' };
  const lid = id();
  await setDoc(env, 'loans', lid, { uid: u.id, name: u.fields.name || '', amountPesewas: amount, monthlyPesewas: monthly, reason, status: 'requested', requestedBy: uidOf(user), requestedByName: user.name || '', requestedAt: now(), repaid: [] });
  await audit(env, user, 'LOAN_REQUESTED', { loanId: lid, targetUid: u.id, amountPesewas: amount });
  return { id: lid };
}
export async function decideLoan(env, lid, approve, note, user) {
  if (!requireRole(user, DIRECTORS)) return { error: 'A director approves loans.', status: 403 };
  const l = await getDoc(env, 'loans', String(lid || '')); if (!l) return { error: 'Loan not found.', status: 404 };
  if (l.fields.status !== 'requested') return { error: 'This loan has already been decided.' };
  await setDoc(env, 'loans', l.id, { ...l.fields, status: approve ? 'approved' : 'rejected', decidedBy: uidOf(user), decidedByName: user.name || '', decidedAt: now(), decisionNote: clean(note, 200) });
  await audit(env, user, approve ? 'LOAN_APPROVED' : 'LOAN_REJECTED', { loanId: l.id });
  return { decided: true };
}
export async function payLoan(env, b, user) {
  if (!requireRole(user, PAYERS)) return { error: 'Finance pays out loans.', status: 403 };
  const l = await getDoc(env, 'loans', String(b?.id || '')); if (!l) return { error: 'Loan not found.', status: 404 };
  if (l.fields.status !== 'approved') return { error: l.fields.status === 'requested' ? 'A director must approve this loan first.' : 'This loan isn’t waiting to be paid.' };
  const at = now(), payRef = clean(b?.payRef, 60), expenseId = id();
  await setDoc(env, 'expenses', expenseId, { date: bizDate(), category: 'loans', description: `Loan to ${l.fields.name}: ${l.fields.reason}`, amountPesewas: l.fields.amountPesewas, paidWith: ['cash', 'momo', 'bank'].includes(b?.paidWith) ? b.paidWith : 'momo', loanId: l.id, recordedBy: uidOf(user), recordedByName: user.name || '', recordedRole: user.role, createdAt: at, removed: false });
  await setDoc(env, 'loans', l.id, { ...l.fields, status: 'paid', paidBy: uidOf(user), paidByName: user.name || '', paidAt: at, payRef, expenseId });
  const u = await getDoc(env, 'users', l.fields.uid);
  if (u?.fields?.phone) await sendSms(env, u.fields.phone, `MEMORIES\nYour loan of ${ghs(l.fields.amountPesewas)} has been paid to you. ${ghs(l.fields.monthlyPesewas)} comes off your salary each month. See My page.`);
  await audit(env, user, 'LOAN_PAID', { loanId: l.id, amountPesewas: l.fields.amountPesewas });
  return { paid: true };
}

// ── The month's payroll ──
async function draftLines(env, m) {
  const [users, pays, items, loans] = await Promise.all([listDocs(env, 'users'), listDocs(env, 'staff_pay'), queryWhere(env, 'pay_items', [{ field: 'month', value: m }]), queryWhere(env, 'loans', [{ field: 'status', value: 'paid' }])]);
  const pay = Object.fromEntries(pays.map(p => [p.id, p.fields]));
  const live = items.map(i => ({ id: i.id, ...i.fields })).filter(i => !i.removed);
  return users.filter(staffOnly).map(u => {
    const p = pay[u.id] || {}, mine = live.filter(i => i.uid === u.id);
    const repay = loans.map(l => ({ id: l.id, ...l.fields })).filter(l => l.uid === u.id && !(l.repaid || []).some(r => r.month === m))
      .map(l => ({ loanId: l.id, amountPesewas: Math.min(l.monthlyPesewas, loanLeft(l)), reason: l.reason })).filter(r => r.amountPesewas > 0);
    const salary = Number(p.salaryPesewas || 0);
    const lines = [
      ...(salary ? [{ label: 'Monthly salary', amountPesewas: salary }] : []),
      ...mine.filter(i => i.kind === 'bonus').map(i => ({ label: 'Bonus', reason: i.reason, amountPesewas: i.amountPesewas, itemId: i.id })),
      ...mine.filter(i => i.kind === 'deduction').map(i => ({ label: 'Deduction', reason: i.reason, amountPesewas: -i.amountPesewas, itemId: i.id })),
      ...repay.map(r => ({ label: 'Loan repayment', reason: r.reason, amountPesewas: -r.amountPesewas, loanId: r.loanId })),
    ];
    return { uid: u.id, name: u.fields.name || '', role: u.fields.role, roleName: ROLE_NAMES[u.fields.role] || u.fields.role, phone: u.fields.phone || '', salaryPesewas: salary, payTo: payTo(p), hasPayTo: !!payTo(p),
      lines, netPesewas: Math.max(0, sum(lines, l => l.amountPesewas)) };
  }).filter(l => l.lines.length).sort((a, b) => a.name.localeCompare(b.name));
}

export async function payroll(env, user, { month } = {}) {
  if (!requireRole(user, SEE)) return FORBIDDEN;
  const m = monthOr(month), pr = await getDoc(env, 'payrolls', m);
  const status = pr?.fields?.status || 'draft';
  const lines = status === 'draft' ? await draftLines(env, m) : pr.fields.lines;
  const [users, pays, loans] = await Promise.all([listDocs(env, 'users'), listDocs(env, 'staff_pay'), listDocs(env, 'loans')]);
  const pay = Object.fromEntries(pays.map(p => [p.id, p.fields]));
  return {
    month: m, label: monthLabel(m), status, statusLabel: PAYROLL_LABEL[status], note: pr?.fields?.decisionNote || '',
    submittedByName: pr?.fields?.submittedByName || '', approvedByName: pr?.fields?.decidedByName || '',
    lines: lines.map(l => ({ ...l, paid: !!l.paidAt, paidAt: l.paidAt || '', paidByName: l.paidByName || '' })),
    totals: { netPesewas: sum(lines, l => l.netPesewas), paidPesewas: sum(lines.filter(l => l.paidAt), l => l.netPesewas), people: lines.length },
    staff: users.filter(staffOnly).map(u => ({ uid: u.id, name: u.fields.name || '', roleName: ROLE_NAMES[u.fields.role] || '', salaryPesewas: Number(pay[u.id]?.salaryPesewas || 0), payMethod: pay[u.id]?.payMethod || 'momo', momoNumber: pay[u.id]?.momoNumber || '', momoName: pay[u.id]?.momoName || '', bankName: pay[u.id]?.bankName || '', bankAccount: pay[u.id]?.bankAccount || '', accountName: pay[u.id]?.accountName || '', payTo: payTo(pay[u.id]) })).sort((a, b) => a.name.localeCompare(b.name)),
    loans: loans.map(l => ({ id: l.id, ...l.fields })).filter(l => l.status !== 'cleared' && l.status !== 'rejected').map(l => ({ id: l.id, uid: l.uid, name: l.name, amountPesewas: l.amountPesewas, monthlyPesewas: l.monthlyPesewas, reason: l.reason, status: l.status, statusLabel: LOAN_LABEL[l.status], leftPesewas: loanLeft(l), requestedByName: l.requestedByName })),
    can: { edit: !!requireRole(user, HR) && status === 'draft', submit: !!requireRole(user, HR) && status === 'draft', approve: !!requireRole(user, DIRECTORS) && status === 'submitted', pay: !!requireRole(user, PAYERS) && status === 'approved', setPay: !!requireRole(user, HR), payLoans: !!requireRole(user, PAYERS) },
  };
}

export async function submitPayroll(env, b, user) {
  if (!requireRole(user, HR)) return { error: 'The Human manager sends the payroll.', status: 403 };
  const m = monthOr(b?.month), pr = await getDoc(env, 'payrolls', m);
  if (pr && pr.fields.status !== 'draft') return { error: 'This month has already been sent.' };
  const lines = await draftLines(env, m);
  if (!lines.length) return { error: 'Nobody has pay this month. Set salaries first.' };
  const missing = lines.filter(l => l.netPesewas && !l.hasPayTo);
  if (missing.length && b?.confirmMissing !== true) return { error: `${missing.map(l => l.name).join(', ')} ha${missing.length > 1 ? 've' : 's'} no MoMo or bank details. Add them, or send anyway.`, code: 'missing_details' };
  await setDoc(env, 'payrolls', m, { month: m, status: 'submitted', lines, submittedBy: uidOf(user), submittedByName: user.name || '', submittedAt: now() });
  await audit(env, user, 'PAYROLL_SUBMITTED', { month: m, netPesewas: sum(lines, l => l.netPesewas) });
  return { submitted: true, netPesewas: sum(lines, l => l.netPesewas) };
}
export async function decidePayroll(env, m, approve, note, user) {
  if (!requireRole(user, DIRECTORS)) return { error: 'A director approves salaries.', status: 403 };
  const pr = await getDoc(env, 'payrolls', String(m || '')); if (!pr) return { error: 'Payroll not found.', status: 404 };
  if (pr.fields.status !== 'submitted') return { error: 'This payroll isn’t waiting for approval.' };
  if (!approve && !clean(note, 200)) return { error: 'Say what needs changing.' };
  // Sent back: it's a draft again for the Human manager to fix.
  await setDoc(env, 'payrolls', pr.id, { ...pr.fields, status: approve ? 'approved' : 'draft', decidedBy: uidOf(user), decidedByName: user.name || '', decidedAt: now(), decisionNote: clean(note, 200) });
  await audit(env, user, approve ? 'PAYROLL_APPROVED' : 'PAYROLL_SENT_BACK', { month: pr.id });
  return { decided: true };
}

// Finance pays one person (or everyone left): payslip, text, expense, loan repayment.
export async function payPayroll(env, b, user) {
  if (!requireRole(user, PAYERS)) return { error: 'Finance pays salaries.', status: 403 };
  const m = monthOr(b?.month), pr = await getDoc(env, 'payrolls', m);
  if (!pr || pr.fields.status === 'draft' || pr.fields.status === 'submitted') return { error: 'A director must approve this month’s salaries first.' };
  const who = b?.uid ? [String(b.uid)] : pr.fields.lines.filter(l => !l.paidAt).map(l => l.uid);
  const at = now(), payRef = clean(b?.payRef, 60), paidWith = ['cash', 'momo', 'bank'].includes(b?.paidWith) ? b.paidWith : 'momo';
  const lines = pr.fields.lines.map(l => ({ ...l }));
  let paid = 0, total = 0;
  for (const l of lines.filter(x => who.includes(x.uid) && !x.paidAt)) {
    l.paidAt = at; l.paidBy = uidOf(user); l.paidByName = user.name || ''; l.payRef = payRef; paid += 1; total += l.netPesewas;
    if (l.netPesewas) await setDoc(env, 'expenses', id(), { date: bizDate(), category: 'staff', description: `Salary ${monthLabel(m)}: ${l.name}`, amountPesewas: l.netPesewas, paidWith, payrollMonth: m, staffUid: l.uid, recordedBy: uidOf(user), recordedByName: user.name || '', recordedRole: user.role, createdAt: at, removed: false });
    for (const r of l.lines.filter(x => x.loanId)) {
      const loan = await getDoc(env, 'loans', r.loanId);
      if (!loan) continue;
      const repaid = [...(loan.fields.repaid || []), { month: m, amountPesewas: -r.amountPesewas }];
      await setDoc(env, 'loans', loan.id, { ...loan.fields, repaid, status: loanLeft({ ...loan.fields, repaid }) ? 'paid' : 'cleared' });
    }
    if (l.phone) await sendSms(env, l.phone, `MEMORIES\nYour pay for ${monthLabel(m)}, ${ghs(l.netPesewas)}, has been paid${l.payTo ? ` to ${l.payTo}` : ''}. See your payslip on My page.`);
  }
  if (!paid) return { error: 'Already paid.' };
  const all = lines.every(l => l.paidAt);
  await setDoc(env, 'payrolls', pr.id, { ...pr.fields, lines, status: all ? 'paid' : 'approved' });
  await audit(env, user, 'PAYROLL_PAID', { month: m, people: paid, netPesewas: total });
  return { paid, netPesewas: total, done: all };
}

// ── My pay (every staff member, their own) ──
export async function myPay(env, user) {
  if (!user || !STAFF_ROLES.includes(user.role) || user.role === 'organiser') return FORBIDDEN;
  const uid = uidOf(user), m = thisMonth();
  const [p, loans, prs] = await Promise.all([getDoc(env, 'staff_pay', uid), queryWhere(env, 'loans', [{ field: 'uid', value: uid }]), listDocs(env, 'payrolls')]);
  const cur = await getDoc(env, 'payrolls', m);
  const draft = cur && cur.fields.status !== 'draft' ? (cur.fields.lines || []).find(l => l.uid === uid) : (await draftLines(env, m)).find(l => l.uid === uid);
  const slips = prs.map(d => ({ month: d.id, status: d.fields.status, line: (d.fields.lines || []).find(l => l.uid === uid) })).filter(x => x.line && ['approved', 'paid'].includes(x.status))
    .sort((a, b) => b.month.localeCompare(a.month)).slice(0, 24)
    .map(x => ({ month: x.month, label: monthLabel(x.month), lines: x.line.lines, netPesewas: x.line.netPesewas, paidAt: x.line.paidAt || '', payRef: x.line.payRef || '', statusLabel: x.line.paidAt ? 'Paid' : 'Approved: being paid' }));
  const L = loans.map(l => ({ id: l.id, ...l.fields }));
  return {
    salaryPesewas: Number(p?.fields?.salaryPesewas || 0), payTo: payTo(p?.fields),
    loanLeftPesewas: sum(L.filter(l => l.status === 'paid'), loanLeft),
    loans: L.filter(l => l.status !== 'rejected').map(l => ({ amountPesewas: l.amountPesewas, monthlyPesewas: l.monthlyPesewas, reason: l.reason, statusLabel: LOAN_LABEL[l.status], leftPesewas: l.status === 'paid' ? loanLeft(l) : l.status === 'cleared' ? 0 : l.amountPesewas })),
    thisMonth: { label: monthLabel(m), lines: draft?.lines || [], netPesewas: draft?.netPesewas || 0 },
    payslips: slips,
  };
}

// For the directors' and finance's month view (Bills and budget): salaries this month.
export async function payrollSummary(env, m) {
  const pr = await getDoc(env, 'payrolls', m);
  const status = pr?.fields?.status || 'draft', lines = status === 'draft' ? await draftLines(env, m) : pr.fields.lines;
  return { status, statusLabel: PAYROLL_LABEL[status], netPesewas: sum(lines, l => l.netPesewas), paidPesewas: sum(lines.filter(l => l.paidAt), l => l.netPesewas), people: lines.length };
}
export { LOAN_LABEL, PAYROLL_LABEL, monthLabel };
