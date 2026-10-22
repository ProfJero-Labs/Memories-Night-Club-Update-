// review.html?s=bill|qr|table|site&r=…: a customer rates their night (1–5 stars and a comment, a name
// and phone if they want a reply), then follows the club on social media. No sign-in.
import { api, esc, params, getSettings, socials, $, $$ } from '../app.js';

const root = $('#root');
// Where they came from (the bar menu or their bill): always a way back to ordering. Only this
// site's own ordering pages, never another address.
const back = /^(counter|bill)\.html\?[\w=&%.-]*$/.test(params.get('back') || '') ? params.get('back') : '';
const backLink = back ? `<a class="btn red" href="${esc(back)}">${back.startsWith('bill') ? 'Back to my bill' : 'Back to the menu'}</a>` : '';
const source = ['bill', 'qr', 'table', 'site'].includes(params.get('s')) ? params.get('s') : 'site';
const follow = async () => {
  const s = await getSettings();
  const list = socials(s);
  return list.length ? `<div><h2 class="display" style="font-size:28px;margin:6px 0 8px">Follow us</h2><p style="margin:0 0 12px;color:var(--paper-2)">See who’s playing next and the photos from tonight.</p>
    <div class="row-actions">${list.map(([name, href, handle]) => `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${esc(name)} ${esc(handle)}</a>`).join('')}</div></div>` : '';
};
let rating = 0;
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const SAY = ['', 'Bad', 'Not great', 'Okay', 'Good', 'Amazing'];
const LOGO = '<img src="/assets/logo-sm.webp" alt="Memories" width="110" height="26">';
function draw() {
  root.innerHTML = `${LOGO}
    <form id="rf" novalidate>
      ${back ? `<p style="margin:0"><a href="${esc(back)}">← Back to ordering</a> · rating is optional</p>` : ''}
      <div><h1 class="display">How was your night?</h1></div>
      <div class="stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}: ${SAY[n]}" data-star="${n}" tabindex="${n === 1 ? 0 : -1}">${STAR}</button>`).join('')}</div>
      <p class="stars-say" id="say" aria-live="polite"></p>
      <div class="field"><label for="c">Tell us more (optional)</label><textarea id="c" rows="5" maxlength="1000" placeholder="The music, the drinks, the service…"></textarea></div>
      <div class="field"><label for="n">Your name (optional)</label><input id="n" maxlength="60" autocomplete="given-name" autocapitalize="words"></div>
      <div class="field"><label for="p">Your phone, if you’d like us to call you back (optional)</label><input id="p" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567"></div>
      <div id="err"></div><button class="btn red" id="go" type="submit">Send</button>
    </form>`;
  // Stars change in place (no redraw), so what's typed stays and focus stays on the star.
  const stars = $$('[data-star]');
  const paint = () => {
    stars.forEach(b => { const n = Number(b.dataset.star); b.classList.toggle('on', n <= rating); b.setAttribute('aria-checked', String(n === rating)); b.tabIndex = n === (rating || 1) ? 0 : -1; });
    $('#say').textContent = rating ? `${rating} of 5 · ${SAY[rating]}` : '';
  };
  const choose = n => { rating = n; paint(); $('#err').innerHTML = ''; };
  stars.forEach(b => {
    b.onclick = () => choose(Number(b.dataset.star));
    b.onkeydown = e => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return;
      e.preventDefault(); const n = Math.min(5, Math.max(1, (rating || 1) + (rating ? d : 0))); choose(n); stars[n - 1].focus();
    };
  });
  paint();
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    if (!rating) { $('#err').innerHTML = '<div class="notice bad" role="alert">Tap the stars first.</div>'; stars[0].focus(); return; }
    $('#go').disabled = true; $('#go').textContent = 'Sending…';
    try {
      await api('/api/guest/review', { method: 'POST', body: { rating, comment: $('#c').value, name: $('#n').value, phone: $('#p').value, source, ref: (params.get('r') || '').slice(0, 64) } });
      root.innerHTML = `${LOGO}<div class="done"><h1 class="display">Thank you!</h1>
        <p class="sub" style="margin:0">${rating <= 2 ? 'We’re sorry it wasn’t better. A manager will read this tonight.' : 'We’re glad you came. See you next time.'}</p>${backLink ? `<div class="row-actions">${backLink}</div>` : ''}${await follow()}<a class="btn" href="index.html">What’s on next</a></div>`;
    } catch (e) { $('#err').innerHTML = `<div class="notice bad" role="alert">${esc(e.message)}</div>`; $('#go').disabled = false; $('#go').textContent = 'Send'; }
  };
}
draw();
