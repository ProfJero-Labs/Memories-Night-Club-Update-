// private.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, normalizePhone, api, esc, params, $, $$, remember, dow, dd, mon, longDate } from '../app.js';
chrome();
const TYPES = ['Corporate', 'Event organiser', 'Large group', 'Other'];
const r = remember.get();
const S = { step: 1, type: TYPES.find(t => t.toLowerCase() === (params.get('type') || '').toLowerCase()) || '', date: params.get('date') || '', guests: '', name: r.name || '', phone: r.phone || '', instagram: '', message: '' };
if (S.type) S.step = 2;
let days = [];
const root = $('#root');
const phoneOk = p => normalizePhone(p) !== null;
const bar = () => `<div class="steps" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('')}</div>`;
const nav = (label, id = 'next') => `<div class="step-nav">${S.step > 1 ? '<button class="btn back" type="button" data-back aria-label="Back">←</button>' : ''}<button class="btn red" type="submit" id="${id}">${label} <span class="arrow">→</span></button></div>`;
const err = msg => `<div class="notice" role="alert">${esc(msg)}</div>`;

function render(problem = '') {
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  if (S.step === 1) root.innerHTML = `${bar()}<form class="step" novalidate><h2 class="display">What are you planning?</h2>
    <ol class="lines" role="radiogroup" aria-label="Type of event">${TYPES.map((t, i) => `<li><button type="button" class="line-btn" role="radio" aria-checked="${S.type === t}" data-type="${esc(t)}"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="tx">${esc(t)}</span><span class="mk" aria-hidden="true">✓</span></button></li>`).join('')}</ol>
    ${problem ? err(problem) : ''}${nav('Next')}</form>`;
  if (S.step === 2) {
    const open = days.filter(d => d.date >= tomorrow);
    root.innerHTML = `${bar()}<form class="step" novalidate><h2 class="display">When?</h2>
      <div class="field"><span class="label" id="dLbl">Open Fridays + Saturdays</span>
        <div class="dates" role="radiogroup" aria-labelledby="dLbl">${open.slice(0, 12).map(d => { const at = d.date + 'T00:00:00Z'; const free = d.state === 'open'; return `<button type="button" role="radio" aria-checked="${S.date === d.date}" data-date="${d.date}" ${free ? '' : 'disabled'} title="${free ? '' : d.state === 'event' ? esc(d.name) : 'Taken'}"><small>${dow(at)}</small><b>${dd(at)}</b><small>${mon(at)}</small></button>`; }).join('')}</div></div>
      <div class="field"><label for="other">Or another date</label><input id="other" type="date" min="${tomorrow}" value="${esc(S.date)}"></div>
      <div class="field"><label for="guests">How many people?</label><input id="guests" type="number" inputmode="numeric" min="1" max="3000" placeholder="e.g. 40" value="${esc(S.guests)}"></div>
      ${problem ? err(problem) : ''}${nav('Next')}</form>`;
  }
  if (S.step === 3) root.innerHTML = `${bar()}<form class="step" novalidate><h2 class="display">How do we reach you?</h2>
    <p class="muted" style="margin:-8px 0 0">${esc(S.type)} · ${esc(longDate(S.date + 'T00:00:00Z'))} · ${esc(S.guests)} people</p>
    <div class="field"><label for="name">Name</label><input id="name" autocomplete="name" value="${esc(S.name)}"></div>
    <div class="field"><label for="phone">Phone</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(S.phone)}"></div>
    <div class="field"><label for="ig">Instagram (optional)</label><input id="ig" autocapitalize="off" placeholder="@yourhandle" value="${esc(S.instagram)}"></div>
    <div class="field"><label for="msg">Anything we should know? (optional)</label><textarea id="msg" maxlength="500" placeholder="One line is enough.">${esc(S.message)}</textarea></div>
    ${problem ? err(problem) : ''}${nav('Send request', 'send')}
    <p class="foot-small" style="margin:0">Nothing to pay now. It’s held once we confirm with you.</p></form>`;
  if (S.step === 4) root.innerHTML = `<div class="state-msg"><span class="stamp">Received</span><h2 class="display" style="font-size:clamp(52px,13vw,110px)">Got it. We’ll get back to you.</h2>
    <p>${esc(S.type)} on ${esc(longDate(S.date + 'T00:00:00Z'))}. We’ll text ${esc(S.phone)} once it’s confirmed.</p><a class="btn" href="index.html">Back to Memories</a></div>`;
  bind();
}

function bind() {
  $$('[data-type]').forEach(b => b.onclick = () => { S.type = b.dataset.type; $$('[data-type]').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
  $$('[data-date]').forEach(b => b.onclick = () => { S.date = b.dataset.date; $('#other').value = S.date; $$('[data-date]').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
  $('#other') && ($('#other').onchange = e => { S.date = e.target.value; $$('[data-date]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.date === S.date))); });
  $$('[data-back]').forEach(b => b.onclick = () => { S.step--; render(); });
  const form = $('form'); if (!form) return;
  form.onsubmit = async ev => {
    ev.preventDefault();
    if (S.step === 1) { if (!S.type) return render('Pick one.'); S.step = 2; return render(); }
    if (S.step === 2) {
      S.guests = $('#guests').value;
      if (!S.date) return render('Pick a date.');
      const taken = days.find(d => d.date === S.date && d.state !== 'open');
      if (taken) return render(taken.state === 'event' ? `${taken.name} is on that night. Pick another date.` : 'That date is taken. Pick another.');
      if (!(Number(S.guests) >= 1)) return render('How many people are coming?');
      S.step = 3; return render();
    }
    S.name = $('#name').value.trim(); S.phone = $('#phone').value.trim(); S.instagram = $('#ig').value.trim(); S.message = $('#msg').value.trim();
    if (S.name.length < 2) return render('Add your name.');
    if (!phoneOk(S.phone)) return render('Use a Ghana number, e.g. 024 123 4567.');
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('/api/private-requests', { method: 'POST', body: { eventType: S.type, date: S.date, guests: Number(S.guests), name: S.name, phone: S.phone, instagram: S.instagram, message: S.message } });
      remember.set({ ...remember.get(), name: S.name, phone: S.phone });
      S.step = 4; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { render(e.message); }
  };
}

api('/api/calendar?weeks=10').then(d => { days = d.days; }).catch(() => {}).finally(render);
root.innerHTML = '<div class="loading">LOADING…</div>';
