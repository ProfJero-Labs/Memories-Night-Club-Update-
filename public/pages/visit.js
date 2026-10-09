// visit.html: page script (kept out of the HTML so the CSP can forbid inline scripts).
import { chrome, esc, $, waLink, socials, mapLink } from '../app.js';
const s = await chrome('visit');
const digits = x => String(x || '').replace(/\D/g, '');
const rows = [
  s.phone && `<a href="tel:${digits(s.phone)}"><span class="k">Call</span><span>${esc(s.phone)}</span></a>`,
  s.whatsapp && `<a href="${waLink(s.whatsapp)}" target="_blank" rel="noopener"><span class="k">WhatsApp</span><span>${esc(s.whatsapp)} ↗</span></a>`,
  ...socials(s).map(([name, url, h]) => `<a href="${esc(url)}" target="_blank" rel="noopener"><span class="k">${name}</span><span>${esc(h)} ↗</span></a>`),
  s.email && `<a href="mailto:${esc(s.email)}"><span class="k">Email</span><span>${esc(s.email)}</span></a>`,
].filter(Boolean).join('');
$('#root').innerHTML = `<div style="display:grid;grid-template-columns:minmax(0,1fr);gap:clamp(30px,6vw,60px)">
  <section style="display:grid;grid-template-columns:minmax(0,1fr);gap:14px">
    <h2 class="display lg">${esc(s.venue || 'SamRit Hotel, Cape Coast')}</h2>
    ${s.address ? `<p class="muted" style="margin:0;font-size:18px">${esc(s.address)}</p>` : ''}
    <div class="strip" style="max-width:640px"><span>${esc(s.nightsLine || 'Friday + Saturday')}</span><span>${esc(s.doorsLine || 'Doors 10PM')}</span><span>18+</span></div>
    <div class="row-actions" style="max-width:640px;margin-top:8px"><a class="btn red" href="${esc(mapLink(s))}" target="_blank" rel="noopener">Directions <span class="arrow">↗</span></a>${s.whatsapp ? `<a class="btn" href="${waLink(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
  </section>
  ${rows ? `<section class="info-rows" style="max-width:640px">${rows}</section>` : ''}
  <section class="info-rows" style="max-width:640px">
    <a href="nights.html"><span class="k">What’s on</span><span>Nights →</span></a>
    <a href="tables.html"><span class="k">Big group</span><span>Book a table →</span></a>
    <a href="private.html"><span class="k">Your own event</span><span>Book an event →</span></a>
  </section></div>`;
