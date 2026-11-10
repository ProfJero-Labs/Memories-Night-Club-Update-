// invite.html?event=ID: a guest asks for an invitation (e.g. Ladies Night). Three questions, picked
// at random from a pool each visit (any one can be swapped for another); then "the house is
// considering your request". Staff approve it, and her invitation (the visa) arrives by text. Ladies
// only: the gentlemen's passes are sent by staff.
import { chrome, api, esc, params, $, $$, errorState, normalizePhone, remember, shortDate } from '../app.js';
chrome();
const root = $('#root');
const eventId = params.get('event') || '';

// Easy to answer, a little glamorous: the point is the feeling of being chosen.
export const QUESTIONS = [
  'Your signature drink for the night?',
  'The song that makes you take over the dance floor?',
  'Describe your going-out look in three words.',
  'Who are you bringing, and why does she deserve it?',
  'Your main-character moment of the year so far?',
  'If tonight had one rule, yours, what would it be?',
  'Heels, sneakers or barefoot by 2AM?',
  'Which queen, real or fictional, walks in with you?',
  'One song the DJ must never play?',
  'Your toast to the ladies, in one line?',
  'Champagne, cocktails, or something with a story?',
  'What does a perfect night out feel like to you?',
  'Your colour for the night?',
  'The compliment you love to receive?',
  'Dance first, or make an entrance first?',
];
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
let pool = shuffle(QUESTIONS), picked = pool.splice(0, 3);

function form(ev, inv) {
  root.innerHTML = `<section class="ask-hero"><span class="k">By invitation · ${esc(shortDate(ev.date))}</span>
      <h1>${esc(inv.title)}</h1>${inv.tagline ? `<p>${esc(inv.tagline)}</p>` : ''}
      <div class="chips">${[inv.perk, inv.dress].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</div></section>
    <p class="ask-intro">Three quick questions, no wrong answers. If you’re chosen, your invitation arrives by text.</p>
    <form id="ask" class="ask-form" novalidate>
      ${picked.map((q, i) => `<div class="ask-q"><span class="n"><span>${i + 1} of 3</span><button type="button" class="swap" data-swap="${i}">Another question</button></span>
        <label for="a${i}" data-q="${i}">${esc(q)}</label><input id="a${i}" maxlength="160" autocomplete="off"></div>`).join('')}
      <div class="ask-q"><span class="n"><span>Your name</span></span><input id="gname" maxlength="60" autocomplete="name" placeholder="Your name" aria-label="Your name"><span class="hint">It appears on your card.</span></div>
      <div class="ask-q"><span class="n"><span>Your phone</span></span><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(remember.get().phone || '')}" aria-label="Your phone number"><span class="hint">Your invitation is sent here. At the door, this number is your entry.</span></div>
      <div class="ask-q"><span class="n"><span>Instagram (optional)</span></span><input id="ig" maxlength="40" autocomplete="off" placeholder="@yourname" aria-label="Instagram (optional)"></div>
      <div class="notice" id="err" hidden role="alert"></div>
      <button class="btn red block" type="submit" id="go">Request my invitation <span class="arrow">→</span></button>
      <p class="foot-small" style="margin:0;text-align:center">${esc(shortDate(ev.date))} · Memories Night Club · strictly 18+</p>
    </form>`;
  $$('[data-swap]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.swap);
    if (!pool.length) pool = shuffle(QUESTIONS.filter(q => !picked.includes(q)));
    picked[i] = pool.shift();
    $(`[data-q="${i}"]`).textContent = picked[i]; $(`#a${i}`).value = ''; $(`#a${i}`).focus();
  });
  $('#ask').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err'); err.hidden = true;
    const answers = picked.map((q, i) => ({ q, a: $(`#a${i}`).value.trim() }));
    const empty = answers.findIndex(x => x.a.length < 2);
    if (empty >= 0) { err.hidden = false; err.textContent = 'Answer all three, even in a few words.'; return $(`#a${empty}`).focus(); }
    if (!normalizePhone($('#phone').value)) { err.hidden = false; err.textContent = 'Use a Ghana number, e.g. 024 123 4567.'; return $('#phone').focus(); }
    const go = $('#go'); go.disabled = true; go.textContent = 'Sending…';
    try {
      await api('/api/invite-request', { method: 'POST', body: { eventId, name: $('#gname').value.trim(), phone: $('#phone').value, instagram: $('#ig').value, answers } });
      remember.set({ ...remember.get(), phone: $('#phone').value });
      root.innerHTML = `<section class="ask-done"><div>
        <div class="seal" aria-hidden="true"><svg viewBox="14 20 36 24" width="34" height="23"><path d="M18 32c0-4.4 3-7.5 6.6-7.5 6.8 0 8 15 14.8 15 3.6 0 6.6-3.1 6.6-7.5s-3-7.5-6.6-7.5c-6.8 0-8 15-14.8 15-3.6 0-6.6-3.1-6.6-7.5Z" fill="none" stroke="#fff3ea" stroke-width="3.2" stroke-linecap="round"/></svg></div>
        <span class="k">Request received</span>
        <h2>Thank you.</h2>
        <p>We’ll text you if you’re on the list.</p>
        <a href="event.html?id=${encodeURIComponent(eventId)}">Back to the night</a></div></section>`;
      scrollTo({ top: 0, behavior: 'instant' });
    } catch (x) { err.hidden = false; err.textContent = x.message; go.disabled = false; go.innerHTML = 'Request my invitation <span class="arrow">→</span>'; }
  };
}

async function load() {
  if (!eventId) return errorState(root, 'This link is missing its night.');
  try {
    const b = await api(`/api/events/${encodeURIComponent(eventId)}`);
    document.title = `${b.invitation?.title || b.event.name} · Ask for your invitation · Memories`;
    if (!b.invitation) { root.innerHTML = `<div class="state-msg"><h2 class="display">Requests are closed.</h2><p>${esc(b.event.name)} isn’t taking requests right now.</p><a class="btn red" href="event.html?id=${encodeURIComponent(eventId)}">See the night</a></div>`; return; }
    form(b.event, b.invitation);
  } catch (e) { errorState(root, e.status === 404 ? 'This night isn’t on.' : e.message, e.status === 404 ? undefined : load); }
}
load();
