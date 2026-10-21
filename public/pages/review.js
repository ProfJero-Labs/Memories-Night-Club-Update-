// review.html?s=bill|qr|table|site&r=…: a customer rates their night (1–5 stars and a comment, a name
// and phone if they want a reply), then follows the club on social media. No sign-in.
import { api, esc, params, getSettings, socials, $, $$ } from '../app.js';

const root = $('#root');
const source = ['bill', 'qr', 'table', 'site'].includes(params.get('s')) ? params.get('s') : 'site';
const follow = async () => {
  const s = await getSettings();
  const list = socials(s);
  return list.length ? `<h2 style="margin:22px 0 8px">Follow us</h2><p class="muted" style="margin:0 0 10px">See who’s playing next and the photos from tonight.</p>
    <div class="row-actions">${list.map(([name, href, handle]) => `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${esc(name)} ${esc(handle)}</a>`).join('')}</div>` : '';
};
let rating = 0;
function draw() {
  root.innerHTML = `<img src="/assets/logo-sm.webp" alt="Memories" width="110" height="26">
    <h1 class="display" style="font-size:clamp(40px,11vw,60px);margin:18px 0 4px">How was your night?</h1>
    <div class="stars" role="radiogroup" aria-label="Your rating" style="display:flex;gap:6px;font-size:44px;margin:14px 0">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${n === rating}" aria-label="${n} star${n > 1 ? 's' : ''}" data-star="${n}" style="background:none;border:0;cursor:pointer;color:${n <= rating ? '#f2b33d' : '#5b514c'};font-size:44px;line-height:1">★</button>`).join('')}</div>
    <div class="field"><label for="c">Tell us more (optional)</label><textarea id="c" rows="4" maxlength="1000" placeholder="The music, the drinks, the service…"></textarea></div>
    <div class="field"><label for="n">Your name (optional)</label><input id="n" maxlength="60" autocomplete="given-name"></div>
    <div class="field"><label for="p">Your phone, if you’d like us to call you back (optional)</label><input id="p" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567"></div>
    <div id="err"></div><button class="btn red" id="go" type="button">Send</button>`;
  $$('[data-star]').forEach(b => b.onclick = () => { const c = $('#c').value, n = $('#n').value, p = $('#p').value; rating = Number(b.dataset.star); draw(); $('#c').value = c; $('#n').value = n; $('#p').value = p; });
  $('#go').onclick = async () => {
    if (!rating) { $('#err').innerHTML = '<div class="notice bad" role="alert">Tap the stars first.</div>'; return; }
    $('#go').disabled = true;
    try {
      await api('/api/guest/review', { method: 'POST', body: { rating, comment: $('#c').value, name: $('#n').value, phone: $('#p').value, source, ref: (params.get('r') || '').slice(0, 64) } });
      root.innerHTML = `<img src="/assets/logo-sm.webp" alt="Memories" width="110" height="26"><h1 class="display" style="font-size:clamp(40px,11vw,60px);margin:18px 0 4px">Thank you!</h1>
        <p>${rating <= 2 ? 'We’re sorry it wasn’t better. A manager will read this tonight.' : 'We’re glad you came. See you next time.'}</p>${await follow()}<a class="btn" href="index.html" style="margin-top:16px">What’s on next</a>`;
    } catch (e) { $('#err').innerHTML = `<div class="notice bad" role="alert">${esc(e.message)}</div>`; $('#go').disabled = false; }
  };
}
draw();
