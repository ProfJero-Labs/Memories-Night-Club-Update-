// Payment alerts by text: the Manager is texted each time MoMo or card money comes in, so he knows
// it has gone through without opening the app. Cash isn't texted (he counts it at the cash count).
//   Paystack-confirmed: the customer's bill link and QR orders.
//   MoMo to the club's number: recorded by a waiter or bartender with its transaction ID (to check
//   on the statement).
// Every current Manager with a phone gets it, unless their staff record says paymentAlerts: false.
import { queryWhere } from '../lib/firestore.js';
import { nightKey } from '../lib/util.js';
import { sendSms } from '../lib/notify.js';
import { bizDate, ghs } from './common.js';

const first = n => String(n || '').trim().split(/\s+/)[0];

// MoMo and card money received tonight (tabs paid by MoMo or on the bill link, and QR orders).
async function tonightDigital(env, date) {
  const [tabs, paid, delivered] = await Promise.all([
    queryWhere(env, 'tabs', [{ field: 'businessDate', value: date }]),
    queryWhere(env, 'counter_orders', [{ field: 'status', value: 'paid' }]),
    queryWhere(env, 'counter_orders', [{ field: 'status', value: 'delivered' }]),
  ]);
  const fromTabs = tabs.flatMap(t => t.fields.payments || []).filter(p => p.method === 'momo' || p.method === 'digital').reduce((n, p) => n + Number(p.amountPesewas || 0), 0);
  const fromQr = [...paid, ...delivered].filter(o => o.fields.paidAt && nightKey(o.fields.paidAt) === date).reduce((n, o) => n + Number(o.fields.totalPesewas || 0), 0);
  return fromTabs + fromQr;
}

// { amountPesewas, kind: 'momo' | 'digital', where: 'Tab 12' | 'QR order, Main bar', byName, tipPesewas }
export async function paymentAlert(env, p) {
  try {
    const managers = (await queryWhere(env, 'users', [{ field: 'role', value: 'manager' }]))
      .filter(d => !d.fields.removed && d.fields.phone && d.fields.paymentAlerts !== false);
    if (!managers.length) return 0;
    const total = await tonightDigital(env, bizDate()).catch(() => null);
    const how = p.kind === 'momo' ? `MoMo recorded by ${first(p.byName) || 'staff'} (check the statement)` : 'MoMo/card confirmed';
    const text = [`MEMORIES: ${ghs(p.amountPesewas)} ${how}`, `${p.where}${p.byName && p.kind !== 'momo' ? ` (${first(p.byName)})` : ''}`,
      ...(p.tipPesewas ? [`+ tip ${ghs(p.tipPesewas)} for staff`] : []),
      ...(total != null ? [`MoMo/card tonight: ${ghs(total)}`] : [])].join('\n');
    let sent = 0;
    for (const m of managers) if (await sendSms(env, m.fields.phone, text)) sent += 1;
    return sent;
  } catch { return 0; } // an alert never gets in the way of a payment
}
