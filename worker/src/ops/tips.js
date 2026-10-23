// Tips: a customer tips the person who served them (or anyone on the team they name). A tip is the
// staff member's money, never the club's: it is kept apart from the bill, so it is never in sales,
// money in or profit.
//   Cash tip: the person keeps it (it isn't in anyone's cash to hand in).
//   MoMo to the club's number, or MoMo / card on the bill link or the QR menu: the money lands in
//   the club's account, so the club owes it to the person. Finance pays tips out (weekly), no
//   director needed: it's the staff member's own money.
//
//   tips/{id}         toUid, toName, toRole, amountPesewas, method cash|momo|digital, momoRef,
//                     reference (Paystack), source tab|quick|tip|bill|qr, tabId, tabNumber, orderId,
//                     businessDate, at, by, byName, status cash (kept) | owed → paid | cancelled,
//                     payoutId, paidAt
//   tip_payouts/{id}  toUid, toName, amountPesewas, tipIds, paidWith, ref, by, byName, at
import { getDoc, setDoc, queryWhere, listDocs, batchGet, commitTx, updateWrite, foundFields, withTransaction } from '../lib/firestore.js';
import { now, id, clean, nightKey } from '../lib/util.js';
import { requireRole, uidOf, STAFF_ROLES } from '../lib/auth.js';
import { sendSms } from '../lib/notify.js';
import { ROLE_NAMES } from '../staffauth.js';
import { FORBIDDEN, bizDate, audit, int, ghs } from './common.js';
import { payTo } from './payroll.js';

// Who can be tipped: the team, not the directors, the system admin or event organisers.
const NOT_TIPPED = ['director', 'superAdmin', 'organiser'];
const MIN_TIP = 100, MAX_TIP = 1000000; // GHS 1 to GHS 10,000 (a slip of the finger, not a real tip)
const PAYERS = ['finance', 'superAdmin'];                    // pay tips out
const OWED_VIEW = [...PAYERS, 'director', 'manager'];        // see what's owed
export const TIP_STATUS = { cash: 'Cash: they kept it', owed: 'Owed: finance pays it out', paid: 'Paid out', cancelled: 'Cancelled (refunded)' };
const METHOD = { cash: 'Cash', momo: 'MoMo to the club’s number', digital: 'MoMo / card on their phone' };
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);
const tippable = d => !d.fields.removed && STAFF_ROLES.includes(d.fields.role) && !NOT_TIPPED.includes(d.fields.role) && d.fields.admin !== true;
const first = n => String(n || '').trim().split(/\s+/)[0] || 'Staff';
// "Kofi M." so two Kofis can be told apart, without putting full names on a public page.
const shortName = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Staff'; };

export async function tipPeopleList(env) {
  return (await listDocs(env, 'users')).filter(tippable)
    .map(d => ({ uid: d.id, name: d.fields.name || '', nickname: d.fields.nickname || '', shortName: d.fields.nickname || shortName(d.fields.name), role: d.fields.role, roleName: ROLE_NAMES[d.fields.role] || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
// For staff screens (the pay sheet's "Tip for" list).
export async function tipPeople(env, user) {
  if (!user || !STAFF_ROLES.includes(user.role) || user.role === 'organiser') return FORBIDDEN;
  // Staff see the official name, with the nickname customers use.
  return { people: (await tipPeopleList(env)).map(({ uid, name, nickname, roleName }) => ({ uid, name: nickname ? `${name} (“${nickname}”)` : name, roleName })) };
}
// For the customer's bill link and the QR menu: short names and jobs only.
export async function guestTipPeople(env) {
  return { people: (await tipPeopleList(env)).map(({ uid, shortName: n, roleName }) => ({ id: uid, name: n, job: roleName })) };
}

// A tip that comes with a payment: { tipPesewas, tipToUid }. No tip → { none: true }.
export async function prepareTip(env, b) {
  const raw = b?.tipPesewas;
  if (raw === undefined || raw === null || raw === '' || Number(raw) === 0) return { none: true };
  const amount = int(raw);
  if (!(amount >= MIN_TIP)) return { error: 'A tip is at least GHS 1, or leave it empty.' };
  if (amount > MAX_TIP) return { error: `A tip can’t be more than ${ghs(MAX_TIP)}. Check the amount.` };
  const u = await getDoc(env, 'users', String(b?.tipToUid || b?.tipTo || ''));
  if (!u || !tippable(u)) return { error: 'Pick who the tip is for.' };
  return { amount, to: { uid: u.id, name: u.fields.name || '', role: u.fields.role } };
}
// The tip record. Cash is kept by the person; anything else the club now owes them.
export function tipFields(t, { method, source, user = null, date = bizDate(), at = now(), ...more }) {
  return {
    toUid: t.to.uid, toName: t.to.name, toRole: t.to.role, amountPesewas: t.amount, method, source, businessDate: date, at,
    by: user ? uidOf(user) : '', byName: user ? user.name || '' : 'Customer, on their phone',
    status: method === 'cash' ? 'cash' : 'owed', ...more,
  };
}
export const tipText = (t, method) => `MEMORIES\nYou got a tip: ${ghs(t.amount)}${method === 'cash' ? ' (cash)' : ''}. Thank you for the great service!${method === 'cash' ? '' : '\nIt’s in My page → My pay → Tips. Finance pays tips out weekly.'}`;
export const textTip = (env, phone, t, method) => (phone ? sendSms(env, phone, tipText(t, method)).catch(() => false) : false);
export async function phoneOf(env, uid) { return (await getDoc(env, 'users', uid))?.fields?.phone || ''; }

// A tip on its own (no bill): e.g. a customer tips the DJ in cash or by MoMo to the club's number.
// Recorded by someone who takes payments; MoMo needs the transaction ID, once only.
export async function recordTip(env, b, user, { canTakeCash, momoCheck }) {
  if (!(await canTakeCash(env, user))) return { error: 'Your job doesn’t include recording payments. Ask a manager.', status: 403 };
  const t = await prepareTip(env, b);
  if (t.none) return { error: 'Enter the tip amount.' };
  if (t.error) return t;
  const method = b?.method === 'momo' ? 'momo' : 'cash', date = bizDate();
  let momo = null;
  if (method === 'momo') { momo = await momoCheck(env, b, date); if (momo.error) return momo; }
  const tid = id();
  await setDoc(env, 'tips', tid, tipFields(t, { method, source: 'tip', user, date, ...(momo ? { momoRef: momo.ref, momoFrom: momo.from } : {}), note: clean(b?.note, 120) }));
  await audit(env, user, method === 'momo' ? 'TIP_MOMO' : 'TIP_CASH', { tipId: tid, toUid: t.to.uid, amountPesewas: t.amount, ...(momo ? { momoRef: momo.ref } : {}) });
  if (t.to.uid !== uidOf(user) || method !== 'cash') await textTip(env, await phoneOf(env, t.to.uid), t, method);
  return { id: tid, toName: t.to.name, amountPesewas: t.amount, method, status: method === 'cash' ? 'cash' : 'owed' };
}

const tipView = x => ({ id: x.id, amountPesewas: x.amountPesewas, method: x.method, methodLabel: METHOD[x.method] || x.method, status: x.status, statusLabel: TIP_STATUS[x.status] || x.status,
  date: x.businessDate, at: x.at, from: x.source === 'qr' ? 'QR order' : x.tabNumber ? `Tab ${x.tabNumber}` : x.source === 'bill' ? 'Bill link' : 'Tip', byName: x.byName || '', momoRef: x.momoRef || x.reference || '', paidAt: x.paidAt || '' });
const weekStart = () => { const d = new Date(`${bizDate()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }; // Monday

// My tips (every staff member, their own): tonight, this week, owed to me, paid to me.
export async function myTips(env, user) {
  if (!user || !STAFF_ROLES.includes(user.role) || NOT_TIPPED.includes(user.role)) return { tips: [], onTips: false };
  const all = (await queryWhere(env, 'tips', [{ field: 'toUid', value: uidOf(user) }])).map(d => ({ id: d.id, ...d.fields })).filter(x => x.status !== 'cancelled');
  const tonight = bizDate(), week = weekStart(), live = all;
  const payouts = (await queryWhere(env, 'tip_payouts', [{ field: 'toUid', value: uidOf(user) }])).map(d => ({ id: d.id, ...d.fields })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    onTips: true,
    tonightPesewas: sum(live.filter(x => x.businessDate === tonight), x => x.amountPesewas),
    weekPesewas: sum(live.filter(x => x.businessDate >= week), x => x.amountPesewas),
    totalPesewas: sum(live, x => x.amountPesewas),
    cashPesewas: sum(live.filter(x => x.status === 'cash'), x => x.amountPesewas),
    owedPesewas: sum(live.filter(x => x.status === 'owed'), x => x.amountPesewas),
    paidPesewas: sum(live.filter(x => x.status === 'paid'), x => x.amountPesewas),
    tips: live.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60).map(tipView),
    payouts: payouts.slice(0, 24).map(p => ({ amountPesewas: p.amountPesewas, at: p.at, paidWith: p.paidWith, ref: p.ref || '', byName: p.byName || '', count: (p.tipIds || []).length })),
  };
}

// Finance: who is owed tips (money that came in by MoMo or card), with each tip's ID to check.
export async function tipsOwed(env, user) {
  if (!requireRole(user, OWED_VIEW)) return FORBIDDEN;
  const [owed, pays, recent] = await Promise.all([
    queryWhere(env, 'tips', [{ field: 'status', value: 'owed' }]), listDocs(env, 'staff_pay'),
    listDocs(env, 'tip_payouts'),
  ]);
  const pay = Object.fromEntries(pays.map(p => [p.id, p.fields]));
  const people = new Map();
  for (const d of owed) {
    const x = { id: d.id, ...d.fields };
    const p = people.get(x.toUid) || { uid: x.toUid, name: x.toName, roleName: ROLE_NAMES[x.toRole] || '', owedPesewas: 0, tips: [], payTo: payTo(pay[x.toUid]) };
    p.owedPesewas += Number(x.amountPesewas || 0); p.tips.push(tipView(x)); people.set(x.toUid, p);
  }
  const list = [...people.values()].map(p => ({ ...p, tips: p.tips.sort((a, b) => String(a.at).localeCompare(String(b.at))), needsCheck: p.tips.some(t => t.method === 'momo') })).sort((a, b) => b.owedPesewas - a.owedPesewas);
  return {
    canPay: !!requireRole(user, PAYERS),
    owedPesewas: sum(list, p => p.owedPesewas), people: list,
    paid: recent.map(d => ({ id: d.id, ...d.fields })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 30)
      .map(p => ({ name: p.toName, amountPesewas: p.amountPesewas, at: p.at, paidWith: p.paidWith, ref: p.ref || '', byName: p.byName || '' })),
  };
}

// Finance pays one person all the tips owed to them. { uid, paidWith momo|bank|cash, ref }
export async function payTips(env, b, user) {
  if (!requireRole(user, PAYERS)) return { error: 'Finance pays tips out.', status: 403 };
  const uid = String(b?.uid || ''), paidWith = ['momo', 'bank', 'cash'].includes(b?.paidWith) ? b.paidWith : 'momo', ref = clean(b?.ref, 60);
  if (paidWith !== 'cash' && !ref) return { error: 'Enter the MoMo or bank reference of the payment.' };
  const owed = (await queryWhere(env, 'tips', [{ field: 'toUid', value: uid }])).filter(d => d.fields.status === 'owed');
  if (!owed.length) return { error: 'Nothing is owed to this person.' };
  const pid = id(), at = now();
  const res = await withTransaction(env, async tx => {
    const got = await batchGet(env, owed.map(d => `tips/${d.id}`), tx);
    const fresh = owed.map(d => ({ id: d.id, fields: foundFields(got, `/tips/${d.id}`)?.fields })).filter(d => d.fields && d.fields.status === 'owed');
    if (!fresh.length) return { error: 'Someone just paid these. Refresh.' };
    const amount = sum(fresh, d => d.fields.amountPesewas), f = fresh[0].fields;
    await commitTx(env, [
      ...fresh.map(d => updateWrite(env, 'tips', d.id, { ...d.fields, status: 'paid', payoutId: pid, paidAt: at, paidByName: user.name || '' })),
      updateWrite(env, 'tip_payouts', pid, { toUid: uid, toName: f.toName, amountPesewas: amount, tipIds: fresh.map(d => d.id), paidWith, ref, by: uidOf(user), byName: user.name || '', at, businessDate: nightKey(at) }),
    ], tx);
    return { paid: true, amountPesewas: amount, count: fresh.length, name: f.toName };
  });
  if (res.paid) {
    await audit(env, user, 'TIPS_PAID', { payoutId: pid, toUid: uid, amountPesewas: res.amountPesewas, count: res.count, paidWith });
    const phone = await phoneOf(env, uid);
    if (phone) await sendSms(env, phone, `MEMORIES\nHi ${first(res.name)}, your tips are paid: ${ghs(res.amountPesewas)} by ${paidWith === 'momo' ? 'MoMo' : paidWith === 'bank' ? 'bank transfer' : 'cash'}${ref ? ` (ref ${ref})` : ''}. See My page → My pay.`).catch(() => false);
  }
  return res;
}

// For reports: tips in a set of nights. Not the club's money.
export function tipTotals(tips) {
  const live = tips.filter(x => x.status !== 'cancelled');
  return {
    totalPesewas: sum(live, x => x.amountPesewas),
    cashPesewas: sum(live.filter(x => x.method === 'cash'), x => x.amountPesewas),
    momoPesewas: sum(live.filter(x => x.method === 'momo'), x => x.amountPesewas),
    digitalPesewas: sum(live.filter(x => x.method === 'digital'), x => x.amountPesewas),
    owedPesewas: sum(live.filter(x => x.status === 'owed'), x => x.amountPesewas),
    paidOutPesewas: sum(live.filter(x => x.status === 'paid'), x => x.amountPesewas),
    count: live.length,
  };
}
export async function tipsOn(env, date) { return (await queryWhere(env, 'tips', [{ field: 'businessDate', value: date }])).map(d => ({ id: d.id, ...d.fields })); }
