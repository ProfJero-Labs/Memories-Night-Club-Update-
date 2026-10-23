// The night's accounts, for the bar manager (and the Manager, directors and finance). Plain steps:
//   1. The bar counts what's left (the closing count).
//   2. From the count: what left the bar, and the money those drinks should bring (at today's prices).
//   3. What accounts for it: cash, MoMo and online payments; what customers still owe (by name);
//      free drinks, breakages and discounts (all approved or recorded).
//   4. Each seller (waiters, the bar's own sales, the app): drinks taken from the bar, paid, still
//      owed, and their cash: recorded vs counted vs handed in. Anyone not aligned is flagged.
// Every drink that leaves the bar ends up on a bill, so the drinks side always balances seller by
// seller; a gap is either drinks missing at the bar (the count is lower than the records) or cash
// that isn't there (counted or handed in less than recorded). Both are named.
import { listDocs, queryWhere } from '../lib/firestore.js';
import { nightKey } from '../lib/util.js';
import { requireRole } from '../lib/auth.js';
import { FORBIDDEN, dateOr, nightState } from './common.js';
import { billOf } from './tabs.js';
import { cashFigures } from './cash.js';
import { stockSheet } from './stock.js';

export const ACCOUNTS = ['superAdmin', 'director', 'manager', 'finance', 'barManager'];
const sum = (arr, f) => arr.reduce((n, x) => n + Number(f(x) || 0), 0);
const HANDED = ['handed', 'received', 'delivered'], AT_BAR = ['waiting', 'preparing', 'ready', 'taken'];

export async function nightAccounts(env, user, { date } = {}) {
  if (!requireRole(user, ACCOUNTS)) return FORBIDDEN;
  const d = dateOr(date);
  const [tabsRaw, roundsRaw, cashRaw, stations, items, qrRaw] = await Promise.all([
    queryWhere(env, 'tabs', [{ field: 'businessDate', value: d }]), queryWhere(env, 'rounds', [{ field: 'businessDate', value: d }]),
    queryWhere(env, 'cash_sessions', [{ field: 'date', value: d }]), listDocs(env, 'bar_stations'), listDocs(env, 'menu_items'),
    Promise.all(['paid', 'delivered'].map(st => queryWhere(env, 'counter_orders', [{ field: 'status', value: st }]))).then(x => x.flat()),
  ]);
  const price = Object.fromEntries(items.map(i => [i.id, Number(i.fields.pricePesewas || 0)]));
  const rounds = roundsRaw.map(r => ({ id: r.id, ...r.fields })).filter(r => r.status !== 'cancelled');
  const tabs = tabsRaw.map(t => ({ id: t.id, ...t.fields }));
  for (const t of tabs) { t.rounds = rounds.filter(r => r.tabId === t.id); t.bill = billOf(t, t.rounds); }
  const cash = cashRaw.map(c => ({ id: c.id, ...c.fields }));

  // ── 1–2. The count: what left each bar, and what it should bring ──
  const bars = [];
  for (const s of stations) {
    const sheet = await stockSheet(env, { stationId: s.id, date: d }, user);
    if (sheet.error) continue;
    const counted = !!sheet.closing;
    const rows = sheet.rows.map(r => {
      const left = r.counted ?? r.expected;
      const gone = r.opening + r.received + r.transferIn + r.returns + (r.corrections || 0) - r.transferOut - r.waste - left;
      return { name: r.name, gone, missing: counted && r.difference < 0 ? -r.difference : 0, extra: counted && r.difference > 0 ? r.difference : 0, unit: price[r.productId] || 0 };
    }).filter(r => r.gone || r.missing || r.extra);
    bars.push({
      stationId: s.id, name: s.fields.name || 'Bar', counted, countedByName: sheet.closing?.byName || '',
      shouldMakePesewas: sum(rows, r => Math.max(0, r.gone) * r.unit),
      missing: rows.filter(r => r.missing).map(r => ({ name: r.name, qty: r.missing, valuePesewas: r.missing * r.unit })),
      missingPesewas: sum(rows, r => r.missing * r.unit), extraPesewas: sum(rows, r => r.extra * r.unit),
    });
  }

  // ── 3. What accounts for it ──
  const pays = tabs.flatMap(t => (t.payments || []).map(p => ({ ...p, tabId: t.id })));
  const byMethod = m => sum(pays.filter(p => p.method === m), p => p.amountPesewas);
  const qr = qrRaw.map(o => ({ id: o.id, ...o.fields })).filter(o => o.paidAt && nightKey(o.paidAt) === d);
  const qrValue = sum(qr, o => o.totalPesewas);
  const lineSum = (rs, k) => sum(rs.flatMap(r => r.lines), l => Number(l[k] || 0) * l.unitPesewas);
  const handed = rounds.filter(r => HANDED.includes(r.status)), atBar = rounds.filter(r => AT_BAR.includes(r.status));
  const owedTabs = tabs.filter(t => ['open', 'owed'].includes(t.status) && t.bill.balancePesewas > 0);
  const money = {
    cashPesewas: byMethod('cash'), momoPesewas: byMethod('momo'), onlinePesewas: byMethod('digital') + qrValue,
    owedPesewas: sum(owedTabs, t => t.bill.balancePesewas),
    freePesewas: lineSum(handed, 'compQty'), brokenPesewas: lineSum(handed, 'brokenQty'), discountsPesewas: sum(tabs, t => t.bill.discountPesewas),
    pendingReturnsPesewas: lineSum(handed, 'returnPending'),
    writtenOffPesewas: sum(tabs.filter(t => t.status === 'written_off'), t => t.bill.balancePesewas), // approved by a manager
    // Billed, but still at the bar (not given out yet): not part of what left the bar.
    stillAtBarPesewas: sum(atBar.flatMap(r => r.lines), l => l.qty * l.unitPesewas),
  };
  money.receivedPesewas = money.cashPesewas + money.momoPesewas + money.onlinePesewas;
  const shouldMake = sum(bars, b => b.shouldMakePesewas), missing = sum(bars, b => b.missingPesewas), extra = sum(bars, b => b.extraPesewas);
  const accountedFor = money.receivedPesewas + money.owedPesewas + money.freePesewas + money.brokenPesewas + money.discountsPesewas + money.pendingReturnsPesewas + money.writtenOffPesewas - money.stillAtBarPesewas;

  // ── 4. Each seller ──
  const sellerIds = [...new Set(tabs.map(t => t.waiterUid).filter(Boolean))];
  const sessionOf = uid => cash.find(c => c.uid === uid);
  const sellers = sellerIds.map(uid => {
    const mine = tabs.filter(t => t.waiterUid === uid), rs = mine.flatMap(t => t.rounds), given = rs.filter(r => HANDED.includes(r.status));
    const mp = mine.flatMap(t => t.payments || []);
    const s = sessionOf(uid), cf = s ? cashFigures(s) : null;
    const owing = mine.filter(t => ['open', 'owed'].includes(t.status) && t.bill.balancePesewas > 0);
    const out = {
      uid, name: mine[0]?.waiterName || 'Seller', role: s?.role || '', tabs: mine.length,
      takenPesewas: sum(given.flatMap(r => r.lines), l => (l.qty - Number(l.returnedQty || 0)) * l.unitPesewas),
      soldPesewas: sum(mine, t => t.bill.totalPesewas),
      cashPesewas: sum(mp.filter(p => p.method === 'cash'), p => p.amountPesewas), momoPesewas: sum(mp.filter(p => p.method === 'momo'), p => p.amountPesewas), onlinePesewas: sum(mp.filter(p => p.method === 'digital'), p => p.amountPesewas),
      owedPesewas: sum(owing, t => t.bill.balancePesewas),
      owing: owing.map(t => ({ tabNumber: t.number, table: t.table || '', customer: t.debt?.name || t.customerName || '', phoneKnown: !!(t.debt?.phone || t.customerPhone), status: t.status, balancePesewas: t.bill.balancePesewas })),
      freePesewas: lineSum(given, 'compQty'), brokenPesewas: lineSum(given, 'brokenQty'),
      stillAtBar: rs.filter(r => AT_BAR.includes(r.status)).length,
      cash: cf ? { recordedPesewas: cf.expectedPesewas, countedPesewas: cf.countedPesewas, receivedPesewas: s.receivedPesewas ?? null, receivedByName: s.receivedByName || '', status: s.status } : null,
    };
    // What's not aligned, in plain words.
    const flags = [];
    if (out.cash) {
      const c = out.cash;
      if (c.countedPesewas == null) { if (c.recordedPesewas) flags.push({ level: 'warn', text: `Hasn’t counted their cash yet (${fmt(c.recordedPesewas)} recorded)` }); }
      else {
        if (c.countedPesewas < c.recordedPesewas) flags.push({ level: 'bad', text: `Cash short: counted ${fmt(c.countedPesewas)}, recorded ${fmt(c.recordedPesewas)} (${fmt(c.recordedPesewas - c.countedPesewas)} short)` });
        if (c.receivedPesewas != null && c.receivedPesewas < c.countedPesewas) flags.push({ level: 'bad', text: `Handed in ${fmt(c.receivedPesewas)} of ${fmt(c.countedPesewas)} counted (${fmt(c.countedPesewas - c.receivedPesewas)} short)` });
        if (c.receivedPesewas == null && c.countedPesewas) flags.push({ level: 'warn', text: `Cash counted, not handed in yet (${fmt(c.countedPesewas)})` });
      }
    }
    const nameless = out.owing.filter(o => o.status === 'open');
    if (nameless.length) flags.push({ level: 'bad', text: `Unpaid and still open: ${nameless.map(o => `Tab ${o.tabNumber} ${fmt(o.balancePesewas)}`).join(', ')}` });
    const debts = out.owing.filter(o => o.status === 'owed');
    if (debts.length) flags.push({ level: 'warn', text: `Customers owe: ${debts.map(o => `${o.customer || `Tab ${o.tabNumber}`} ${fmt(o.balancePesewas)}`).join(', ')}` });
    if (out.stillAtBar) flags.push({ level: 'warn', text: `${out.stillAtBar} order${out.stillAtBar > 1 ? 's' : ''} not collected from the bar` });
    if (out.momoPesewas) flags.push({ level: 'info', text: `MoMo ${fmt(out.momoPesewas)} recorded: check on the MoMo statement` });
    out.flags = flags;
    out.state = flags.some(f => f.level === 'bad') ? 'short' : flags.some(f => f.level === 'warn') ? 'check' : 'ok';
    return out;
  }).sort((a, b) => ({ short: 0, check: 1, ok: 2 }[a.state] - { short: 0, check: 1, ok: 2 }[b.state]) || b.takenPesewas - a.takenPesewas);

  const cashShort = sum(sellers, s => (s.cash?.countedPesewas != null ? Math.max(0, s.cash.recordedPesewas - s.cash.countedPesewas) : 0))
    + sum(sellers, s => (s.cash?.receivedPesewas != null && s.cash.countedPesewas != null ? Math.max(0, s.cash.countedPesewas - s.cash.receivedPesewas) : 0));
  return {
    date: d, night: await nightState(env, d),
    steps: { counted: bars.length > 0 && bars.every(b => b.counted), cashIn: sellers.every(s => !s.cash || s.cash.receivedPesewas != null || !s.cash.recordedPesewas) },
    shouldMakePesewas: shouldMake, money, accountedForPesewas: accountedFor,
    missingAtBarPesewas: missing, extraAtBarPesewas: extra, otherDifferencePesewas: shouldMake - accountedFor - missing + extra,
    cashShortPesewas: cashShort, bars, sellers,
    app: qr.length ? { orders: qr.length, valuePesewas: qrValue } : null,
  };
}
const fmt = p => `GHS ${(Number(p || 0) / 100).toLocaleString('en-GH', { maximumFractionDigits: 2 })}`;
