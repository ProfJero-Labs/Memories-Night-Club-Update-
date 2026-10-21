// The people side, shared by the Human manager (hr.html), the directors (night.html) and finance:
//   payView      salaries, payment details, bonuses, deductions, loans and the month's payroll
//                (the Human manager prepares and sends it; a director approves; finance pays)
//   reviewsView  what customers say (stars, comments, complaints to follow up)
//   perfView     monthly performance reviews of each staff member
import { $, $$, esc } from '../app.js';
import { sapi } from '../staff.js';
import { sheet, say, st, busy, ghsIn, moneyField, money, when, dayName } from './ops-ui.js';

const mon = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short' });
const shift = (m, by) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7); };
const monthBar = (m, label) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="sbtn" data-mon="${shift(m, -1)}">← ${esc(mon(shift(m, -1)))}</button><b style="font-size:18px">${esc(label)}</b><button class="sbtn" data-mon="${shift(m, 1)}">${esc(mon(shift(m, 1)))} →</button></div>`;
const signed = p => `${p < 0 ? '−' : ''}${money(Math.abs(p))}`;

// ── Pay ──
export async function payView(el, month) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/payroll${month ? `?month=${month}` : ''}`);
  const stKey = { draft: 'unpaid', submitted: 'part_paid', approved: 'ready', paid: 'paid' }[d.status];
  el.innerHTML = `<h1 style="margin:0">Salaries</h1>${monthBar(d.month, d.label)}
    <div class="pos-money"><div class="big-line"><span>To pay this month</span><b>${money(d.totals.netPesewas)}</b></div>
      <div class="big-line good"><span>Paid</span><b>${money(d.totals.paidPesewas)}</b></div><p class="how">${st(stKey, d.statusLabel)} ${d.totals.people} ${d.totals.people === 1 ? 'person' : 'people'}${d.approvedByName ? ` · approved by ${esc(d.approvedByName)}` : ''}</p></div>
    ${d.note && d.status === 'draft' ? `<div class="say warn"><b>Sent back by a director</b>${esc(d.note)}</div>` : ''}
    <div id="pMsg"></div>
    ${d.can.submit ? '<button class="big" id="pSend">Send to the directors</button>' : ''}
    ${d.can.pay ? '<button class="big" id="pPayAll">Mark everyone paid</button>' : ''}
    <h2>${d.status === 'draft' ? 'This month so far' : 'Payroll'}</h2>
    <div class="lines-list">${d.lines.map(l => `<div class="ln"><span><b>${esc(l.name)}</b> <small class="muted">${esc(l.roleName)}</small><br>
      <small class="muted">${l.lines.map(x => `${esc(x.label)}${x.reason ? ` (${esc(x.reason)})` : ''} ${signed(x.amountPesewas)}`).join(' · ')}</small><br><small class="muted">${l.payTo ? `To ${esc(l.payTo)}` : '<b style="color:var(--mustard)">No MoMo or bank details</b>'}</small></span>
      <span>${money(l.netPesewas)}${l.paid ? `<br>${st('paid', 'Paid')}` : d.can.pay ? `<br><button class="sbtn" data-payone="${esc(l.uid)}">Paid</button>` : ''}</span></div>`).join('') || '<div class="ln"><span class="muted">Nobody has pay yet. Set salaries below.</span></div>'}
      <div class="ln total"><span>Total</span><span>${money(d.totals.netPesewas)}</span></div></div>
    ${d.can.edit ? '<div class="btn-row"><button class="mid" id="pBonus">Add a bonus</button><button class="mid" id="pDed">Add a deduction</button><button class="mid" id="pLoan">Record a loan</button></div>' : ''}
    ${d.loans.length ? `<h2>Loans</h2><div class="lines-list">${d.loans.map(l => `<div class="ln"><span><b>${esc(l.name)}</b> · ${money(l.amountPesewas)}<br><small class="muted">${esc(l.reason)} · ${money(l.monthlyPesewas)} a month · ${esc(l.statusLabel)}</small></span>
      <span>${money(l.leftPesewas)} left${l.status === 'approved' && d.can.payLoans ? `<br><button class="sbtn" data-payloan="${esc(l.id)}">Pay out</button>` : ''}</span></div>`).join('')}</div>` : ''}
    <h2>Salaries and payment details</h2>
    <div class="lines-list">${d.staff.map(s => `<div class="ln"><span><b>${esc(s.name)}</b> <small class="muted">${esc(s.roleName)}</small><br><small class="muted">${s.payTo ? esc(s.payTo) : 'No payment details'}</small></span>
      <span>${s.salaryPesewas ? money(s.salaryPesewas) : '—'}${d.can.setPay ? `<br><button class="sbtn" data-set="${esc(s.uid)}">Change</button>` : ''}</span></div>`).join('')}</div>`;
  const again = () => payView(el, d.month);
  $$('[data-mon]', el).forEach(b => b.onclick = () => payView(el, b.dataset.mon));
  const staffSel = id => `<div class="sfield"><label for="${id}">Who</label><select id="${id}">${d.staff.map(s => `<option value="${esc(s.uid)}">${esc(s.name)} (${esc(s.roleName)})</option>`).join('')}</select></div>`;
  $('#pSend', el) && ($('#pSend', el).onclick = async () => {
    if (!confirm(`Send ${d.label}’s salaries (${money(d.totals.netPesewas)}) to the directors to approve? You can’t change them after.`)) return;
    try { await sapi('/api/ops/payroll/submit', { method: 'POST', body: { month: d.month } }); again(); }
    catch (e) {
      if (e.code === 'missing_details' && confirm(`${e.message}\n\nSend anyway?`)) { await sapi('/api/ops/payroll/submit', { method: 'POST', body: { month: d.month, confirmMissing: true } }); return again(); }
      say($('#pMsg', el), e.message, 'bad');
    }
  });
  const pay = body => { const { box, close } = sheet(`<h2>Mark paid</h2><div class="sfield"><label for="ppW">Paid with</label><select id="ppW"><option value="momo">MoMo</option><option value="bank">Bank</option><option value="cash">Cash</option></select></div>
      <div class="sfield"><label for="ppR">Reference (optional)</label><input id="ppR" maxlength="60"></div><p class="muted" style="margin:0">Each person is texted and their payslip shows on their page.</p>
      <div id="ppM"></div><button class="big" id="ppGo">Mark paid</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Mark paid' });
    $('#ppGo', box).onclick = async () => { try { await busy($('#ppGo', box), () => sapi('/api/ops/payroll/pay', { method: 'POST', body: { month: d.month, ...body, paidWith: $('#ppW', box).value, payRef: $('#ppR', box).value } })); close(); again(); } catch (e) { say($('#ppM', box), e.message, 'bad'); } }; };
  $('#pPayAll', el) && ($('#pPayAll', el).onclick = () => pay({}));
  $$('[data-payone]', el).forEach(b => b.onclick = () => pay({ uid: b.dataset.payone }));
  $$('[data-payloan]', el).forEach(b => b.onclick = async () => {
    if (!confirm('Mark this loan as paid out to them? It goes in Money out and they are texted.')) return;
    try { await sapi('/api/ops/loans/pay', { method: 'POST', body: { id: b.dataset.payloan } }); again(); } catch (e) { say($('#pMsg', el), e.message, 'bad'); }
  });
  const item = kind => { const { box, close } = sheet(`<h2>${kind === 'bonus' ? 'Add a bonus' : 'Add a deduction'}</h2>${staffSel('piU')}${moneyField('piA', 'Amount (GHS)')}
      <div class="sfield"><label for="piR">${kind === 'bonus' ? 'What for' : 'Why'}</label><input id="piR" maxlength="160" placeholder="${kind === 'bonus' ? 'e.g. Best sales in October' : 'e.g. Late three times'}"></div>
      <div id="piM"></div><button class="big" id="piGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#piGo', box).onclick = async () => { try { await busy($('#piGo', box), () => sapi('/api/ops/pay/item', { method: 'POST', body: { uid: $('#piU', box).value, month: d.month, kind, amountPesewas: ghsIn($('#piA', box).value), reason: $('#piR', box).value } })); close(); again(); } catch (e) { say($('#piM', box), e.message, 'bad'); } }; };
  $('#pBonus', el) && ($('#pBonus', el).onclick = () => item('bonus'));
  $('#pDed', el) && ($('#pDed', el).onclick = () => item('deduction'));
  $('#pLoan', el) && ($('#pLoan', el).onclick = () => {
    const { box, close } = sheet(`<h2>Record a loan</h2><p class="muted" style="margin:0">A director approves it, then finance pays it out. It comes off their salary each month.</p>${staffSel('lnU')}${moneyField('lnA', 'Loan amount (GHS)')}${moneyField('lnM', 'Taken off each month’s salary (GHS)')}
      <div class="sfield"><label for="lnR">What it’s for</label><input id="lnR" maxlength="160"></div><div id="lnMs"></div><button class="big" id="lnGo">Send to the directors</button><button class="big ghost" data-close>Cancel</button>`);
    $('#lnGo', box).onclick = async () => { try { await busy($('#lnGo', box), () => sapi('/api/ops/loans', { method: 'POST', body: { uid: $('#lnU', box).value, amountPesewas: ghsIn($('#lnA', box).value), monthlyPesewas: ghsIn($('#lnM', box).value), reason: $('#lnR', box).value } })); close(); again(); } catch (e) { say($('#lnMs', box), e.message, 'bad'); } };
  });
  $$('[data-set]', el).forEach(b => b.onclick = () => {
    const s = d.staff.find(x => x.uid === b.dataset.set);
    const { box, close } = sheet(`<h2>${esc(s.name)}’s pay</h2>${moneyField('sdS', 'Monthly salary (GHS)', s.salaryPesewas ? String(s.salaryPesewas / 100) : '')}
      <div class="sfield"><label for="sdM">Paid by</label><select id="sdM"><option value="momo" ${s.payMethod !== 'bank' ? 'selected' : ''}>MoMo</option><option value="bank" ${s.payMethod === 'bank' ? 'selected' : ''}>Bank</option></select></div>
      <div id="sdMomo"><div class="sfield"><label for="sdN">MoMo number</label><input id="sdN" type="tel" inputmode="tel" value="${esc(s.momoNumber)}"></div><div class="sfield"><label for="sdNm">Name on the MoMo account</label><input id="sdNm" maxlength="60" value="${esc(s.momoName)}"></div></div>
      <div id="sdBank" hidden><div class="sfield"><label for="sdB">Bank</label><input id="sdB" maxlength="60" value="${esc(s.bankName)}"></div><div class="sfield"><label for="sdA">Account number</label><input id="sdA" maxlength="30" value="${esc(s.bankAccount)}"></div><div class="sfield"><label for="sdAn">Account name</label><input id="sdAn" maxlength="60" value="${esc(s.accountName)}"></div></div>
      <div id="sdMs"></div><button class="big" id="sdGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    const sync = () => { $('#sdMomo', box).hidden = $('#sdM', box).value !== 'momo'; $('#sdBank', box).hidden = $('#sdM', box).value !== 'bank'; };
    $('#sdM', box).onchange = sync; sync();
    $('#sdGo', box).onclick = async () => { try { await busy($('#sdGo', box), () => sapi('/api/ops/pay/details', { method: 'POST', body: { uid: s.uid, salaryPesewas: $('#sdS', box).value === '' ? 0 : ghsIn($('#sdS', box).value), payMethod: $('#sdM', box).value, momoNumber: $('#sdN', box).value, momoName: $('#sdNm', box).value, bankName: $('#sdB', box).value, bankAccount: $('#sdA', box).value, accountName: $('#sdAn', box).value } })); close(); again(); } catch (e) { say($('#sdMs', box), e.message, 'bad'); } };
  });
}

// ── Customer reviews ──
export async function reviewsView(el) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi('/api/ops/reviews');
  const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
  el.innerHTML = `<h1>Customer reviews</h1>
    <div class="nums"><div><span>Average (30 days)</span><b>${d.average ?? '—'}${d.average ? '/5' : ''}</b><small class="muted">${d.count} review${d.count === 1 ? '' : 's'}</small></div><div><span>Tonight</span><b>${d.tonight ?? '—'}</b></div><div class="${d.open ? 'bad' : 'good'}"><span>Complaints to follow up</span><b>${d.open}</b></div></div>
    <div class="lines-list">${d.stars.map(s => `<div class="ln"><span>${stars(s.stars)}</span><span>${s.count}</span></div>`).join('')}</div>
    <div class="cards">${d.reviews.map(r => `<div class="tcard" style="cursor:default;${r.complaint && r.status === 'new' ? 'border-color:#ff7a9c' : ''}"><span class="row"><span class="t" style="color:var(--mustard)">${stars(r.rating)}</span><span class="sub">${esc(dayName(r.night))} · ${when(r.at)}</span></span>
      ${r.comment ? `<span>${esc(r.comment)}</span>` : ''}<span class="sub">${esc(r.name || 'No name')}${r.phone ? ` · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''} · ${esc(r.source)}</span>
      ${r.status === 'handled' ? `<span class="say good" style="margin:0"><b>${esc(r.handledByName)}</b>${esc(r.handledNote)}</span>` : r.complaint && d.canHandle ? `<span><button class="mid" data-handle="${esc(r.id)}">Follow up</button></span>` : ''}</div>`).join('') || '<div class="empty-box"><b>No reviews yet</b>Customers are asked after they pay.</div>'}</div>`;
  $$('[data-handle]', el).forEach(b => b.onclick = () => {
    const { box, close } = sheet(`<h2>Follow up</h2><div class="sfield"><label for="rhN">What was done</label><textarea id="rhN" rows="3" maxlength="500" placeholder="e.g. Called her, apologised, free drinks on her next visit"></textarea></div>
      <div id="rhM"></div><button class="big" id="rhGo">Save</button><button class="big ghost" data-close>Cancel</button>`);
    $('#rhGo', box).onclick = async () => { try { await busy($('#rhGo', box), () => sapi('/api/ops/reviews/handle', { method: 'POST', body: { id: b.dataset.handle, note: $('#rhN', box).value } })); close(); reviewsView(el); } catch (e) { say($('#rhM', box), e.message, 'bad'); } };
  });
}

// ── Performance reviews ──
export async function perfView(el, month) {
  el.innerHTML = '<div class="loading">Loading…</div>';
  const d = await sapi(`/api/ops/perf${month ? `?month=${month}` : ''}`);
  el.innerHTML = `<h1 style="margin:0">Performance reviews</h1>${monthBar(d.month, d.label)}<p class="lead" style="margin:0">${d.done} of ${d.staff.length} reviewed.</p>
    <div class="lines-list">${d.staff.map(s => `<div class="ln"><span><b>${esc(s.name)}</b> <small class="muted">${esc(s.roleName)}</small>${s.review ? `<br><small class="muted">${s.review.scores.map(x => `${esc(x.label)} ${x.score}`).join(' · ')}</small>${s.review.comment ? `<br><small>${esc(s.review.comment)}</small>` : ''}${s.review.reply ? `<br><small class="muted">Their reply: ${esc(s.review.reply)}</small>` : ''}` : ''}</span>
      <span>${s.review ? `<b>${s.review.overall}/5</b>` : '—'}${s.canWrite ? `<br><button class="sbtn" data-rev="${esc(s.uid)}">${s.review ? 'Change' : 'Review'}</button>` : ''}</span></div>`).join('')}</div>`;
  $$('[data-mon]', el).forEach(b => b.onclick = () => perfView(el, b.dataset.mon));
  $$('[data-rev]', el).forEach(b => b.onclick = () => {
    const s = d.staff.find(x => x.uid === b.dataset.rev), cur = Object.fromEntries((s.review?.scores || []).map(x => [x.key, x.score]));
    const { box, close } = sheet(`<h2>${esc(s.name)} · ${esc(d.label)}</h2><p class="muted" style="margin:0">1 = poor, 5 = excellent. They see this on their page.</p>
      ${Object.entries(d.scores).map(([k, label]) => `<div class="sfield"><label for="pf_${k}">${esc(label)}</label><select id="pf_${k}">${[5, 4, 3, 2, 1].map(n => `<option ${cur[k] === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`).join('')}
      <div class="sfield"><label for="pfC">Comment</label><textarea id="pfC" rows="3" maxlength="1000">${esc(s.review?.comment || '')}</textarea></div>
      <div id="pfM"></div><button class="big" id="pfGo">Save review</button><button class="big ghost" data-close>Cancel</button>`, { label: 'Performance review' });
    $('#pfGo', box).onclick = async () => {
      const scores = Object.fromEntries(Object.keys(d.scores).map(k => [k, Number($(`#pf_${k}`, box).value)]));
      try { await busy($('#pfGo', box), () => sapi('/api/ops/perf', { method: 'POST', body: { uid: s.uid, month: d.month, scores, comment: $('#pfC', box).value } })); close(); perfView(el, d.month); } catch (e) { say($('#pfM', box), e.message, 'bad'); }
    };
  });
}
