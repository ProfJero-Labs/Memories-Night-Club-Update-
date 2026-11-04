// The autopilot: what happens every night without anyone having to remember (owner's rule, Nov
// 2026: the system must stay trustworthy even when one person fails). Runs every 10 minutes.
//
//   1. MoMo to the wallet waiting too long: 20 minutes → text the Manager and the Human manager;
//      an hour → text the directors too.
//   2. A forgotten night closes itself: still open past 5AM the next morning, with no sales for 3
//      hours. The report is made and sent, exactly as if the Manager had closed it.
//   3. The morning report, 10AM (Ghana time is UTC): to every finance officer and every director,
//      using the phones on their staff records. Sales, how it was paid, anyone short or not
//      handed in, tabs left open, stock missing, discounts, MoMo confirmed by hand.
//   4. Midday: a night finance hasn't signed off yet → the directors are told.
// Every send is recorded (config/autopilot, and on the report), so nothing is sent twice.
import { getDoc, setDoc, listDocs, queryWhere, queryRecent } from '../lib/firestore.js';
import { now, accraDayKey } from '../lib/util.js';
import { sendSms, siteUrl } from '../lib/notify.js';
import { bizDate, nightState, ghs, audit, loadNight } from './common.js';
import { closeNight } from './closing.js';

const MIN = 60e3, HOUR = 60 * MIN;
const SYSTEM = { uid: 'autopilot', name: 'Automatic', role: 'superAdmin' };
const sum = (xs, f) => xs.reduce((n, x) => n + Number(f(x) || 0), 0);
const dayAfter = d => new Date(new Date(`${d}T12:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10);

async function phonesOf(env, roles) {
  return (await listDocs(env, 'users')).filter(u => roles.includes(u.fields.role) && !u.fields.removed && u.fields.phone).map(u => u.fields.phone);
}
async function textAll(env, roles, message) {
  const phones = [...new Set(await phonesOf(env, roles))];
  for (const p of phones) await sendSms(env, p, message);
  return phones.length;
}

// 1. Wallet payments waiting.
export async function walletAlerts(env, at = Date.now()) {
  const waiting = (await queryWhere(env, 'wallet_payments', [{ field: 'status', value: 'waiting' }], { limit: 500 })).map(d => ({ id: d.id, ...d.fields }));
  let sent = 0;
  for (const w of waiting) {
    const age = at - new Date(w.createdAt).getTime();
    const where = w.tabNumber ? `Tab ${w.tabNumber}${w.table && w.table !== 'Walk-in' ? ` (table ${w.table})` : ''}` : w.table || 'A QR order';
    if (age >= 20 * MIN && !w.alerted20) {
      await textAll(env, ['manager', 'hrManager'], `MEMORIES\n${where}: MoMo to the wallet (${ghs(w.duePesewas)}, ref ${w.code}) is still waiting after 20 minutes. Check the wallet: Arrived or Not yet.`);
      const { id: wid, ...f } = w; await setDoc(env, 'wallet_payments', wid, { ...f, alerted20: now() }); sent++;
    } else if (age >= HOUR && !w.alerted60) {
      await textAll(env, ['director'], `MEMORIES\n${where}: MoMo to the wallet (${ghs(w.duePesewas)}) has waited over an hour and nobody has confirmed it. The bill stays open.`);
      const { id: wid, ...f } = w; await setDoc(env, 'wallet_payments', wid, { ...f, alerted60: now() }); sent++;
    }
  }
  return sent;
}

// When the night's last sale (or payment) happened.
async function lastActivity(env, date) {
  const [tabs, rounds] = await Promise.all([queryWhere(env, 'tabs', [{ field: 'businessDate', value: date }], { limit: 5000 }), queryWhere(env, 'rounds', [{ field: 'businessDate', value: date }], { limit: 10000 })]);
  const times = [...tabs.flatMap(t => [t.fields.createdAt, ...(t.fields.payments || []).map(p => p.at)]), ...rounds.map(r => r.fields.createdAt)].filter(Boolean).map(x => new Date(x).getTime()).filter(Number.isFinite);
  return { any: tabs.length > 0, last: times.length ? Math.max(...times) : 0 };
}

// 2. A forgotten night.
export async function autoClose(env, at = Date.now()) {
  const d = bizDate();
  if ((await nightState(env, d)).status === 'closed') return null;
  // Not before 5AM the morning after the night's date.
  if (at < new Date(`${dayAfter(d)}T05:00:00Z`).getTime()) return null;
  const act = await lastActivity(env, d);
  if (!act.any || at - act.last < 3 * HOUR) return null;
  const r = await closeNight(env, { date: d }, SYSTEM);
  if (r.error) return r;
  await audit(env, SYSTEM, 'NIGHT_AUTO_CLOSED', { date: d, lastActivity: new Date(act.last).toISOString() });
  await textAll(env, ['director', 'finance'], `MEMORIES\nThe night of ${d} was still open at ${new Date(at).toISOString().slice(11, 16)} with no sales for 3 hours, so it was closed automatically. The report is ready.`);
  await loadNight(env, { fresh: true });
  return { closed: d };
}

// The morning report's text for a closed night.
export async function morningText(env, date) {
  const eod = (await getDoc(env, 'eod_reports', date))?.fields;
  if (!eod?.report) return null;
  const r = eod.report, t = r.sales.totals;
  const short = (r.cash || []).filter(c => (c.differencePesewas || 0) < 0).map(c => `${String(c.name || '').split(' ')[0]} ${ghs(-c.differencePesewas)}`);
  const notIn = (r.cash || []).filter(c => c.expectedPesewas && !c.receivedAt).map(c => String(c.name || '').split(' ')[0]);
  const open = r.sales.unpaid || [];
  const missing = sum((r.bars || []).flatMap(b => b.rows || []).filter(x => x.difference < 0), x => -x.difference);
  const hand = (await queryRecent(env, 'wallet_payments', 'createdAt', new Date(new Date(`${date}T00:00:00Z`).getTime() - 864e5), 500))
    .map(x => x.fields).filter(w => w.businessDate === date && w.status === 'confirmed' && w.confirmedVia !== 'sms');
  const lines = [
    `MEMORIES · night of ${date}${eod.closedBy === 'autopilot' ? ' (closed automatically)' : ''}`,
    `Sales ${ghs(t.salesPesewas)} · Received ${ghs(t.paidPesewas)}: cash ${ghs(t.cashPesewas)}, MoMo ${ghs(t.momoPesewas || 0)}, card/Paystack ${ghs(t.digitalPesewas)}`,
    t.owedPesewas ? `Still owed ${ghs(t.owedPesewas)} (${open.length} bill${open.length === 1 ? '' : 's'})` : 'Nothing owed',
    short.length ? `Cash short: ${short.join(', ')}` : 'No cash short',
    ...(notIn.length ? [`Cash not handed in: ${notIn.join(', ')}`] : []),
    ...(missing ? [`Stock missing: ${missing} item${missing === 1 ? '' : 's'}`] : []),
    ...(t.discountsPesewas ? [`Discounts ${ghs(t.discountsPesewas)}`] : []),
    ...(hand.length ? [`MoMo confirmed by hand: ${hand.length} (${[...new Set(hand.map(w => String(w.confirmedByName || '').split(' ')[0]))].join(', ')})`] : []),
    `Details: ${siteUrl(env, `/finance.html#report/${date}`)}`,
  ];
  return lines.join('\n');
}

// 3 and 4. The morning report (10AM) and the midday reminder (12PM).
export async function morningAndMidday(env, at = Date.now()) {
  const hour = new Date(at).getUTCHours(), today = accraDayKey(new Date(at));
  const state = (await getDoc(env, 'config', 'autopilot'))?.fields || {};
  const out = {};
  if (hour >= 10 && state.morningDate !== today) {
    const reports = (await listDocs(env, 'eod_reports')).filter(r => !r.fields.morningSentAt && r.id < today).sort((a, b) => a.id.localeCompare(b.id)).slice(-3);
    for (const r of reports) {
      const text = await morningText(env, r.id);
      if (text) { out.morning = (out.morning || 0) + await textAll(env, ['finance', 'director'], text); await setDoc(env, 'eod_reports', r.id, { ...r.fields, morningSentAt: now() }); }
    }
    // A night with sales that still isn't closed by 10AM: say so (the autopilot closes it once quiet).
    const open = bizDate();
    if (open < today && (await nightState(env, open)).status !== 'closed') await textAll(env, ['director', 'finance'], `MEMORIES\nThe night of ${open} is still open (sales are still being recorded). Its report comes once it closes.`);
    await setDoc(env, 'config', 'autopilot', { ...state, morningDate: today, morningAt: now() });
  }
  if (hour >= 12 && state.middayDate !== today) {
    const fresh = (await getDoc(env, 'config', 'autopilot'))?.fields || state;
    const unsigned = (await listDocs(env, 'eod_reports')).filter(r => r.fields.morningSentAt && !r.fields.financeApprovedAt && !r.fields.middayAlertAt && r.id < today);
    for (const r of unsigned) {
      await textAll(env, ['director'], `MEMORIES\nFinance hasn’t signed off the night of ${r.id} yet. The report: ${siteUrl(env, `/finance.html#report/${r.id}`)}`);
      await setDoc(env, 'eod_reports', r.id, { ...r.fields, middayAlertAt: now() }); out.midday = (out.midday || 0) + 1;
    }
    await setDoc(env, 'config', 'autopilot', { ...fresh, middayDate: today, middayAt: now() });
  }
  return out;
}

export async function runAutopilot(env, at = Date.now()) {
  const res = {};
  for (const [k, fn] of [['wallet', walletAlerts], ['close', autoClose], ['report', morningAndMidday]]) {
    try { res[k] = await fn(env, at); } catch (e) { res[k] = { error: String(e?.message || e) }; }
  }
  return res;
}
