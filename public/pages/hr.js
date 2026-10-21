// hr.html: the Human manager. The floor and the people.
//   Floor: open tables and what they owe, approvals (free drinks, discounts), payments tonight.
//   Staff: add, change and remove staff (texts their PIN), members and attendance.
//   Pay: salaries, payment details, bonuses, deductions and loans; the month's payroll goes to the
//        directors to approve, then finance pays and each person is told.
//   Customers: top customers tonight, customer reviews and complaints.
//   More: staff feedback and complaints, notices, performance reviews, my page.
import { $, $$, esc } from '../app.js';
import { requireStaff, staffHeader, sapi } from '../staff.js';
import { bottomNav, sheet, st, every, money, when } from '../lib/ops-ui.js';
import { approvalsView, paymentsView, feedbackInboxView } from '../lib/ops-views.js';
import { staffView } from '../lib/staff-view.js';
import * as people from '../lib/people-views.js';

const user = await requireStaff(['hrManager', 'director', 'superAdmin']);
staffHeader(user, 'Human manager');
const app = $('#app');
let stop = null;
const nav = bottomNav([['floor', 'Floor'], ['staff', 'Staff'], ['pay', 'Pay'], ['customers', 'Customers'], ['more', 'More']], k => { if (k === 'more') more(); else location.hash = k; });
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${esc(e.message)}</div><button class="big ghost" id="retry">Try again</button>`; $('#retry').onclick = route; };
const back = (label, to) => `<button class="link" data-goto="${to}" style="justify-self:start">← ${esc(label)}</button>`;
const bindBack = () => $$('[data-goto]', app).forEach(b => b.onclick = () => { location.hash = b.dataset.goto; });

async function route() {
  if (stop) { stop(); stop = null; }
  const [k, arg] = location.hash.slice(1).split('/');
  const key = k || 'floor';
  nav.setActive(['floor', 'staff', 'pay', 'customers'].includes(key) ? key : key === 'payments' ? 'floor' : 'more');
  scrollTo(0, 0);
  try {
    if (key === 'staff') { app.innerHTML = '<div class="btn-row"><a class="big ghost" href="admin.html#members">Members and passes</a><a class="big ghost" href="admin.html#attendance">Attendance</a></div><div id="sv"></div>'; return await staffView($('#sv'), user); }
    if (key === 'pay') return await people.payView(app, arg);
    if (key === 'customers') { app.innerHTML = '<div id="rv"></div><div id="cv" style="margin-top:20px"></div>'; await people.reviewsView($('#rv')).catch(() => {}); return await paymentsView($('#cv'), { tab: 'customers' }); }
    if (key === 'payments') { app.innerHTML = `${back('Floor', 'floor')}<div id="pv"></div>`; bindBack(); return await paymentsView($('#pv')); }
    if (key === 'feedback') { app.innerHTML = '<div id="fv"></div>'; return await feedbackInboxView($('#fv')); }
    if (key === 'perf') return await people.perfView(app, arg);
    stop = every(10000, () => floor().catch(fail));
  } catch (e) { fail(e); }
}
addEventListener('hashchange', route);

// ── Floor: tables open now, what needs approving ──
async function floor() {
  const { tabs } = await sapi('/api/ops/tabs?all=1');
  const open = tabs.filter(t => t.status === 'open' && !t.quick);
  app.innerHTML = `<h1>Floor</h1><p class="lead" style="margin:0">${open.length} table${open.length === 1 ? '' : 's'} open · ${money(open.reduce((n, t) => n + t.bill.balancePesewas, 0))} still to pay</p>
    <div class="pos-tables">${open.map(t => `<div class="pos-row"><span class="where">${esc(t.table === 'Walk-in' ? 'No table' : `Table ${t.table}`)}<small>${esc(t.label)} · ${esc(t.waiterName.split(' ')[0])}${t.customerName ? ` · ${esc(t.customerName)}` : ''}</small></span><span class="amt">${money(t.bill.balancePesewas || t.bill.totalPesewas)}${st(t.payStatus, t.payLabel)}</span></div>`).join('') || '<p class="muted">No tables open.</p>'}</div>
    <div class="btn-row"><button class="big ghost" data-goto="payments">Payments tonight</button><button class="big ghost" data-goto="customers">Top customers</button></div>
    <div id="ap"></div>`;
  bindBack();
  await approvalsView($('#ap'));
}

function more() {
  const items = [['feedback', 'Staff feedback', 'Complaints and ideas from the staff'], ['perf', 'Performance reviews', 'Each person, every month'], ['@me.html#notices', 'Notices and messages', 'Post to everyone or a team'], ['@me.html', 'My page', 'My own pay and messages']];
  const { box, close } = sheet(`<h2>More</h2><div class="more-list">${items.map(([k, l, sub]) => `<button type="button" data-more="${esc(k)}"><b>${esc(l)}</b><span>${esc(sub)}</span></button>`).join('')}</div><button class="big ghost" data-close>Close</button>`, { label: 'More' });
  $$('[data-more]', box).forEach(b => b.onclick = () => { close(); const k = b.dataset.more; if (k.startsWith('@')) location.href = k.slice(1); else location.hash = k; });
}

route();
