// me.html: every staff member's own page (DJs and MCs open here; everyone else from the name menu).
//   Notices: from management, to everyone or to my team.
//   Messages: the team message board (to everyone, or to my team).
//   My pay: payslips, bonuses, deductions, loans (filled in by the Human manager; paid by finance).
//   Me: feedback or a complaint (to the Human manager or the directors, anonymous if I like), and
//       the answers; my performance reviews.
import { $, $$, esc } from '../app.js';
import { requireStaff, staffHeader, sapi, ROLE_LABEL, home } from '../staff.js';
import { say, every, bottomNav, busy, money, when, dayName, backBar, bindBackBar, growAll } from '../lib/ops-ui.js';

const user = await requireStaff(['superAdmin', 'director', 'manager', 'hrManager', 'finance', 'eventManager', 'doorStaff', 'security', 'barStaff', 'waitStaff', 'cashier', 'dj', 'mc']);
staffHeader(user, 'My page');
const app = $('#app');
// Someone whose work screen is elsewhere (the Human manager, a waiter…) can always get back to it.
if (home(user.role) !== 'me.html') {
  const top = document.createElement('div'); top.className = 'ops'; top.style.paddingBottom = '0';
  top.innerHTML = backBar('My page', `@${home(user.role)}`); app.before(top); bindBackBar(top);
}
let stop = null;
// Directors aren't on payroll (the Human manager doesn't pay them), so they have no My pay.
const onPayroll = !['director', 'superAdmin'].includes(user.role);
const nav = bottomNav([['notices', 'Notices'], ['messages', 'Messages'], ...(onPayroll ? [['pay', 'My pay']] : []), ['me', 'Me']], k => { location.hash = k; });
const fail = e => { app.innerHTML = `<div class="say bad" role="alert"><b>Couldn’t load</b>${esc(e.message)}</div><button class="big ghost" id="retry">Try again</button>`; $('#retry').onclick = route; };
const day = at => { const d = new Date(at); return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Accra' })} · ${when(at)}`; };

function route() {
  if (stop) { stop(); stop = null; }
  const k = location.hash.slice(1) || 'notices';
  nav.setActive(k); scrollTo(0, 0);
  const go = { notices, messages, ...(onPayroll ? { pay } : {}), me }[k] || notices;
  go().catch(fail);
}
addEventListener('hashchange', route);

// ── Notices ──
async function notices() {
  const d = await sapi('/api/ops/notices');
  app.innerHTML = `<h1>Notices</h1><p class="lead" style="margin:0">Hello ${esc(user.name.split(' ')[0] || '')}. ${esc(ROLE_LABEL[user.role] || '')}.</p>
    ${d.canPost ? '<details class="fold"><summary>Post a notice</summary><div class="sfield"><label for="nT">Title</label><input id="nT" maxlength="80" placeholder="e.g. Staff meeting Friday 6pm"></div><div class="sfield"><label for="nB">Details (optional)</label><textarea id="nB" maxlength="1000"></textarea></div>' +
      `<div class="sfield"><label for="nTo">For</label><select id="nTo"><option value="all">Everyone</option>${Object.entries(d.teams).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div><div id="nMsg"></div><button class="big" id="nGo">Post notice</button></details>` : ''}
    <div class="cards">${d.notices.map(n => `<div class="tcard" style="cursor:default"><span class="row"><span class="t">${esc(n.title)}</span><span class="sub">${esc(n.teamLabel)}</span></span>
      ${n.body ? `<span>${esc(n.body)}</span>` : ''}<span class="sub">${esc(n.byName)}${n.byRole ? `, ${esc(n.byRole)}` : ''} · ${esc(day(n.at))}</span>
      ${d.canPost ? `<span><button class="sbtn" data-rmn="${esc(n.id)}">Take down</button></span>` : ''}</div>`).join('') || '<div class="empty-box"><b>No notices</b>Notices from management show here.</div>'}</div>`;
  growAll(app);
  $('#nGo') && ($('#nGo').onclick = async () => {
    try { await busy($('#nGo'), () => sapi('/api/ops/notices', { method: 'POST', body: { title: $('#nT').value, body: $('#nB').value, team: $('#nTo').value } })); notices(); }
    catch (e) { say($('#nMsg'), e.message, 'bad'); }
  });
  $$('[data-rmn]').forEach(b => b.onclick = async () => { if (!confirm('Take this notice down?')) return; await sapi('/api/ops/notices/remove', { method: 'POST', body: { id: b.dataset.rmn } }); notices(); });
}

// ── Messages ──
async function messages() {
  app.innerHTML = '<h1>Messages</h1><div id="post"></div><div id="list" class="cards"><div class="loading">Loading…</div></div>';
  let drawnPost = false;
  stop = every(10000, async alive => {
    const d = await sapi('/api/ops/board');
    if (!alive()) return;
    if (!drawnPost) {
      drawnPost = true;
      const teams = d.teams ? Object.entries(d.teams) : d.myTeam ? [[d.myTeam, d.myTeamLabel]] : [];
      $('#post').innerHTML = `<div class="sfield"><label for="mTo">To</label><select id="mTo"><option value="all">Everyone</option>${teams.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
        <div class="sfield"><label for="mT">Message</label><textarea id="mT" maxlength="500" placeholder="Write to the team"></textarea></div>
        <div id="mMsg"></div><button class="big red" id="mGo">Send</button>`;
      growAll($('#post'));
      $('#mGo').onclick = async () => {
        try { await busy($('#mGo'), () => sapi('/api/ops/board', { method: 'POST', body: { text: $('#mT').value, team: $('#mTo').value } })); $('#mT').value = ''; route(); }
        catch (e) { say($('#mMsg'), e.message, 'bad'); }
      };
    }
    $('#list').innerHTML = d.messages.map(m => `<div class="tcard" style="cursor:default;${m.mine ? 'border-color:var(--crimson)' : ''}"><span class="row"><span class="t" style="font-size:15px">${esc(m.byName)}${m.byRole ? ` <small class="muted">${esc(m.byRole)}</small>` : ''}</span><span class="sub">${esc(m.teamLabel)}</span></span>
      <span>${esc(m.text)}</span><span class="row"><span class="sub">${esc(day(m.at))}</span>${m.canRemove ? `<button class="sbtn" data-rmm="${esc(m.id)}">Delete</button>` : ''}</span></div>`).join('') || '<div class="empty-box"><b>No messages yet</b>Say hello to the team.</div>';
    $$('[data-rmm]').forEach(b => b.onclick = async () => { if (!confirm('Delete this message?')) return; await sapi('/api/ops/board/remove', { method: 'POST', body: { id: b.dataset.rmm } }); route(); });
  });
}

// ── My pay ──
async function pay() {
  let d = null, t = null;
  [d, t] = await Promise.all([sapi('/api/ops/my-pay').catch(() => null), sapi('/api/ops/my-tips').catch(() => null)]); // null: an older Worker
  if (d && d.onPayroll === false) { app.innerHTML = '<h1>My pay</h1><div class="empty-box"><b>Not on payroll</b>Directors aren’t paid through the Human manager.</div>'; return; }
  if (!d) { app.innerHTML = '<h1>My pay</h1><div class="empty-box"><b>Nothing yet</b>Your payslips show here once the Human manager sets up your pay.</div>'; return; }
  const tips = t?.onTips ? `<h2>My tips</h2>
    <div class="nums"><div><span>Tonight</span><b>${money(t.tonightPesewas)}</b></div><div><span>This week</span><b>${money(t.weekPesewas)}</b></div>
      <div class="${t.owedPesewas ? 'warn' : 'good'}"><span>Owed to me</span><b>${money(t.owedPesewas)}</b><small class="muted">MoMo / card tips: finance pays them out weekly</small></div>
      <div class="good"><span>Paid to me</span><b>${money(t.paidPesewas)}</b></div><div><span>Cash tips I kept</span><b>${money(t.cashPesewas)}</b></div></div>
    ${t.tips.length ? `<details class="fold"><summary>Every tip (${t.tips.length})</summary><div class="lines-list">${t.tips.map(x => `<div class="ln"><span>${esc(dayName(x.date))} · ${esc(x.from)}<br><small class="muted">${esc(x.methodLabel)} · ${esc(x.statusLabel)}${x.byName ? ` · recorded by ${esc(x.byName)}` : ''}</small></span><span>${money(x.amountPesewas)}</span></div>`).join('')}</div></details>` : '<p class="muted" style="margin:0">No tips yet. When a customer tips you, it shows here.</p>'}
    ${t.payouts.length ? `<details class="fold"><summary>Tip payouts</summary><div class="lines-list">${t.payouts.map(p => `<div class="ln"><span>${esc(day(p.at))}<br><small class="muted">${esc(p.paidWith === 'momo' ? 'MoMo' : p.paidWith === 'bank' ? 'Bank' : 'Cash')}${p.ref ? ` · ref ${esc(p.ref)}` : ''} · ${p.count} tip${p.count === 1 ? '' : 's'}</small></span><span>${money(p.amountPesewas)}</span></div>`).join('')}</div></details>` : ''}` : '';
  app.innerHTML = `<h1>My pay</h1>
    ${tips}
    <h2>My salary</h2>
    <div class="nums"><div><span>Monthly salary</span><b>${money(d.salaryPesewas)}</b></div><div class="${d.loanLeftPesewas ? 'warn' : 'good'}"><span>Loan still to repay</span><b>${money(d.loanLeftPesewas)}</b></div></div>
    ${d.payTo ? `<p class="muted" style="margin:0">Paid to: ${esc(d.payTo)}. Wrong? Tell the Human manager.</p>` : '<div class="say warn"><b>No payment details yet</b>Give the Human manager your MoMo number or bank account.</div>'}
    ${d.thisMonth.lines.length ? `<h2>This month so far (${esc(d.thisMonth.label)})</h2><div class="lines-list">${d.thisMonth.lines.map(l => `<div class="ln"><span>${esc(l.label)}${l.reason ? `<br><small class="muted">${esc(l.reason)}</small>` : ''}</span><span>${l.amountPesewas < 0 ? '−' : ''}${money(Math.abs(l.amountPesewas))}</span></div>`).join('')}
      <div class="ln total"><span>To be paid</span><span>${money(d.thisMonth.netPesewas)}</span></div></div>` : ''}
    <h2>Payslips</h2>
    ${d.payslips.length ? d.payslips.map(p => `<details class="fold"><summary>${esc(p.label)} · ${money(p.netPesewas)} ${p.paidAt ? `· paid ${esc(dayName(p.paidAt.slice(0, 10)))}` : `· ${esc(p.statusLabel)}`}</summary>
      <div class="lines-list">${p.lines.map(l => `<div class="ln"><span>${esc(l.label)}${l.reason ? `<br><small class="muted">${esc(l.reason)}</small>` : ''}</span><span>${l.amountPesewas < 0 ? '−' : ''}${money(Math.abs(l.amountPesewas))}</span></div>`).join('')}
      <div class="ln total"><span>Paid to you</span><span>${money(p.netPesewas)}</span></div></div>${p.payRef ? `<p class="muted" style="margin:0">Reference: ${esc(p.payRef)}</p>` : ''}</details>`).join('') : '<p class="muted">No payslips yet.</p>'}
    ${d.loans.length ? `<h2>Loans</h2><div class="lines-list">${d.loans.map(l => `<div class="ln"><span>${money(l.amountPesewas)} · ${esc(l.statusLabel)}<br><small class="muted">${esc(l.reason)} · ${money(l.monthlyPesewas)} a month</small></span><span>${money(l.leftPesewas)} left</span></div>`).join('')}</div>` : ''}`;
}

// ── Me: feedback, complaints, reviews ──
async function me() {
  const [f, r] = await Promise.all([sapi('/api/ops/feedback/mine'), sapi('/api/ops/reviews/mine').catch(() => ({ reviews: [] }))]);
  app.innerHTML = `<h1>Me</h1>
    <h2>Say something</h2>
    <div class="sfield"><label for="fK">What is it?</label><select id="fK"><option value="feedback">Feedback or an idea</option><option value="complaint">A complaint</option></select></div>
    <div class="sfield"><label for="fT">Tell us</label><textarea id="fT" maxlength="1500" placeholder="Say it in your own words"></textarea></div>
    <div class="sfield"><label for="fTo">Send it to</label><select id="fTo"><option value="hr">The Human manager</option><option value="director">The directors</option></select></div>
    <label class="check"><input type="checkbox" id="fA"> Don’t show my name</label>
    <div id="fMsg"></div><button class="big" id="fGo">Send</button>
    ${f.feedback.length ? `<h2>What I sent</h2><div class="cards">${f.feedback.map(x => `<div class="tcard" style="cursor:default"><span class="row"><span class="t" style="font-size:15px">${esc(x.kindLabel)} to ${esc(x.toLabel.toLowerCase())}</span><span class="sub">${esc(day(x.at))}${x.anonymous ? ' · no name' : ''}</span></span>
      <span>${esc(x.text)}</span>${x.reply ? `<span class="say good" style="margin:0"><b>${esc(x.replyByName)} answered</b>${esc(x.reply)}</span>` : '<span class="sub">Waiting for an answer.</span>'}</div>`).join('')}</div>` : ''}
    ${r.reviews.length ? `<h2>My reviews</h2>${r.reviews.map(v => `<details class="fold"><summary>${esc(v.label)} · ${v.overall}/5</summary><div class="lines-list">${v.scores.map(s => `<div class="ln"><span>${esc(s.label)}</span><span>${s.score}/5</span></div>`).join('')}</div>${v.comment ? `<p>${esc(v.comment)}</p>` : ''}<p class="muted" style="margin:0">By ${esc(v.byName)}</p></details>`).join('')}` : ''}`;
  growAll(app);
  $('#fGo').onclick = async () => {
    try {
      const x = await busy($('#fGo'), () => sapi('/api/ops/feedback', { method: 'POST', body: { kind: $('#fK').value, text: $('#fT').value, to: $('#fTo').value, anonymous: $('#fA').checked } }));
      await me(); say($('#fMsg'), x.to === 'director' ? 'Sent to the directors. Thank you.' : 'Sent to the Human manager. Thank you.');
    } catch (e) { say($('#fMsg'), e.message, 'bad'); }
  };
}

route();
