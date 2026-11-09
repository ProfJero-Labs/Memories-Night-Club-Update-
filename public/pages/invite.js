// invite.html?event=ID: a guest asks for an invitation (e.g. Ladies Night). Three questions, picked
// at random from a pool each visit (any one can be swapped for another); then "the house is
// considering your request". Staff approve it, and the invitation arrives by text: the ladies' visa,
// or for a gentleman, a Memories card pass to witness the night.
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
// For gentlemen: same spirit, his side of the night.
export const QUESTIONS_HIM = [
  'Your drink of choice tonight?',
  'The song that gets you off the wall?',
  'Describe your look tonight in three words.',
  'Who are you coming with?',
  'Your best night out so far this year?',
  'One song the DJ must never play?',
  'Suit, smart casual, or all black?',
  'Your toast to the ladies, in one line?',
  'Whisky, cognac, or something cold?',
  'Dance floor or the best seat in the house?',
  'What makes a night unforgettable for you?',
  'Your colour for the night?',
];
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
let who = 'her', pool = [], picked = [];
const deal = () => { pool = shuffle(who === 'him' ? QUESTIONS_HIM : QUESTIONS); picked = pool.splice(0, 3); };
deal();

function form(ev, inv) {
  const him = who === 'him';
  root.innerHTML = `<section class="ask-hero ${him ? 'him' : ''}"><span class="k">By invitation · ${esc(shortDate(ev.date))}</span>
      <h1>${esc(inv.title)}</h1><p>${him ? `A pass to witness ${esc(inv.title)}` : esc(inv.tagline || '')}</p>
      <div class="chips">${(him ? [inv.dress] : [inv.perk, inv.dress]).filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}</div></section>
    <div class="ask-who" role="radiogroup" aria-label="Who is asking"><button type="button" role="radio" aria-checked="${!him}" data-who="her">I’m a lady</button><button type="button" role="radio" aria-checked="${him}" data-who="him">I’m a gentleman</button></div>
    <p class="ask-intro">Three quick questions, no wrong answers. If you’re chosen, your ${him ? 'pass' : 'invitation'} arrives by text.</p>
    <form id="ask" class="ask-form" novalidate>
      ${picked.map((q, i) => `<div class="ask-q"><span class="n"><span>${i + 1} of 3</span><button type="button" class="swap" data-swap="${i}">Another question</button></span>
        <label for="a${i}" data-q="${i}">${esc(q)}</label><input id="a${i}" maxlength="160" autocomplete="off"></div>`).join('')}
      <div class="ask-q"><span class="n"><span>Your phone</span></span><input id="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567" value="${esc(remember.get().phone || '')}" aria-label="Your phone number"><span class="hint">Your invitation is sent here. At the door, this number is your entry.</span></div>
      <div class="ask-q"><span class="n"><span>Instagram (optional)</span></span><input id="ig" maxlength="40" autocomplete="off" placeholder="@yourname" aria-label="Instagram (optional)"></div>
      <div class="notice" id="err" hidden role="alert"></div>
      <button class="btn red block" type="submit" id="go">Request my ${him ? 'pass' : 'invitation'} <span class="arrow">→</span></button>
      <p class="foot-small" style="margin:0;text-align:center">${esc(shortDate(ev.date))} · Memories Night Club · strictly 18+</p>
    </form>`;
  $$('[data-who]').forEach(b => b.onclick = () => { if (who === b.dataset.who) return; const ph = $('#phone').value, ig = $('#ig').value; who = b.dataset.who; deal(); form(ev, inv); $('#phone').value = ph; $('#ig').value = ig; });
  $$('[data-swap]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.swap);
    if (!pool.length) pool = shuffle((who === 'him' ? QUESTIONS_HIM : QUESTIONS).filter(q => !picked.includes(q)));
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
      await api('/api/invite-request', { method: 'POST', body: { eventId, phone: $('#phone').value, style: who, instagram: $('#ig').value, answers } });
      remember.set({ ...remember.get(), phone: $('#phone').value });
      root.innerHTML = `<section class="ask-done"><div>
        <div class="seal" aria-hidden="true"><svg viewBox="14 20 36 24" width="34" height="23"><path d="M18 32c0-4.4 3-7.5 6.6-7.5 6.8 0 8 15 14.8 15 3.6 0 6.6-3.1 6.6-7.5s-3-7.5-6.6-7.5c-6.8 0-8 15-14.8 15-3.6 0-6.6-3.1-6.6-7.5Z" fill="none" stroke="#fff3ea" stroke-width="3.2" stroke-linecap="round"/></svg></div>
        <span class="k">Request received</span>
        <h2>Thank you.</h2>
        <p>We’ll text you if you’re on the list.</p>
        <a href="event.html?id=${encodeURIComponent(eventId)}">Back to the night</a></div></section>`;
      scrollTo({ top: 0, behavior: 'instant' });
    } catch (x) { err.hidden = false; err.textContent = x.message; go.disabled = false; go.innerHTML = `Request my ${who === 'him' ? 'pass' : 'invitation'} <span class="arrow">→</span>`; }
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
