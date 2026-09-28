// index.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, api, esc, img, dateStamp, doors, shortDate, whenLabel, $, loading, errorState } from '../app.js';

const s = await chrome('home');
$('#facts').innerHTML = [s.venue || 'SamRit Hotel, Cape Coast', s.nightsLine || 'Friday + Saturday', s.doorsLine || 'Doors 10PM'].map(x => `<span>${esc(x)}</span>`).join('');

const poster = e => `<a class="poster" href="event.html?id=${encodeURIComponent(e.id)}">
  <div class="poster-art">${img(e.artwork, `${e.name} flyer`)}${dateStamp(e.date)}${e.soldOut ? '<span class="flag">Sold out</span>' : ''}</div>
  <h3>${esc(e.name)}</h3><span class="sub">${esc(doors(e))}</span></a>`;

async function load() {
  const next = $('#next');
  next.innerHTML = '<p class="kicker red">Next at Memories</p>' + loading('PULLING UP YOUR NIGHT…');
  let events;
  try { events = (await api('/api/events')).events; }
  catch (e) { return errorState(next, e.message, load); }

  if (!events.length) {
    // Nothing on sale: point at the next open night instead of a dead end.
    const cal = await api('/api/calendar?weeks=6').catch(() => ({ days: [] }));
    const open = cal.days.find(d => d.state === 'open' && d.date > new Date().toISOString().slice(0, 10));
    next.innerHTML = `<p class="kicker red">Next at Memories</p>
      ${open ? dateStamp(open.date + 'T22:00:00Z', 'red') : ''}
      <h2 class="display">${open ? 'The next night drops soon.' : 'New nights drop soon.'}</h2>
      <p class="muted" style="margin:0;max-width:34ch">Want ${open ? esc(shortDate(open.date + 'T00:00:00Z')) : 'a night'} for your event? Book it.</p>
      <div class="row-actions"><a class="btn red" href="private.html${open ? `?date=${open.date}` : ''}">Book an event <span class="arrow">→</span></a></div>`;
    return;
  }
  const hero = events.find(e => e.featured && !e.soldOut) || events.find(e => !e.soldOut) || events[0];
  const art = $('#heroArt');
  art.href = `event.html?id=${encodeURIComponent(hero.id)}`; art.setAttribute('aria-label', hero.name);
  // The blurred copy fills the frame behind the flyer, so any flyer shape sits well in a tall frame.
  art.innerHTML = hero.artwork ? `<span class="art-fill" style="background-image:url('${esc(hero.artwork)}')" aria-hidden="true"></span>${img(hero.artwork, `${hero.name} flyer`, '', true)}` : dateStamp(hero.date, 'red');
  art.hidden = false;
  next.innerHTML = `
      <p class="kicker red">${esc(whenLabel(hero.date))}</p>
      <h2 class="display">${esc(hero.name)}</h2>
      <div class="meta"><span>${esc(shortDate(hero.date))}</span><span class="muted">${esc(doors(hero))}</span></div>
      <div class="row-actions">
        ${hero.soldOut ? '<span class="btn" aria-disabled="true">Sold out</span>' : `<a class="btn red" href="event.html?id=${encodeURIComponent(hero.id)}#tickets">Get tickets <span class="arrow">→</span></a>`}
        <a class="btn" href="tables.html?event=${encodeURIComponent(hero.id)}">Book a table</a>
      </div>`;
  const rest = events.filter(e => e.id !== hero.id).slice(0, 3);
  if (rest.length) { $('#more').hidden = false; $('#moreRow').innerHTML = rest.map(poster).join(''); }
}
load();
