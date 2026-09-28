// Shared code for the public pages. No framework, no Firebase: everything goes through the Worker.
const CFG = window.MEMORIES_CONFIG || {};
export const params = new URLSearchParams(location.search);
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
import { esc } from './lib/shared.js';
export { esc, normalizePhone, pes, formatAccra, accraDayKey, nightKey } from './lib/shared.js';
export const money = p => `GHS ${(Number(p || 0) / 100).toLocaleString('en-GH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// ── Dates: Ghana is UTC+0, so every date is formatted in UTC ──
const D = (d, o) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o }).toUpperCase();
export const dow = d => D(d, { weekday: 'short' });
export const dd = d => D(d, { day: '2-digit' });
export const mon = d => D(d, { month: 'short' });
export const longDate = d => D(d, { weekday: 'long', day: 'numeric', month: 'long' });
export const shortDate = d => `${dow(d)} ${dd(d)} ${mon(d)}`;
export const time = d => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(' ', '').toUpperCase();
export const doors = e => (e.doors ? `DOORS ${String(e.doors).replace(/^doors\s*/i, '').toUpperCase()}` : `DOORS ${time(e.date)}`);
export const dateStamp = (d, cls = '') => `<div class="date-stamp ${cls}"><span class="dow">${dow(d)}</span><span class="dd">${dd(d)}</span><span class="mon">${mon(d)}</span></div>`;
// "TONIGHT" / "THIS FRIDAY" / "NEXT AT MEMORIES" for the lead night.
export function whenLabel(d) {
  const day = x => new Date(x).toISOString().slice(0, 10);
  const days = Math.round((new Date(day(d)) - new Date(day(Date.now()))) / 864e5);
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow night';
  if (days > 1 && days < 7) return `This ${new Date(d).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long' })}`;
  return 'Next at Memories';
}
export const img = (src, alt, cls = '', eager = false) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" class="${cls}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : '';

// ── API ──
// Human copy for anything that goes wrong between the phone and the server.
export const MSG = {
  network: 'CONNECTION DROPPED. WE HAVEN’T LOST YOUR ORDER. TRY AGAIN.',
  server: 'SOMETHING WENT WRONG ON OUR SIDE. TRY AGAIN IN A MOMENT.',
  busy: 'TOO MANY TRIES. GIVE IT A MINUTE.',
};
export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
export async function api(path, { method = 'GET', body, token, retries = method === 'GET' ? 1 : 0, timeout = 15000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`${CFG.apiBase || ''}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.success !== false) return d;
      if (r.status === 429) throw new ApiError(MSG.busy, 429);
      if (r.status >= 500 && attempt < retries) continue;
      throw new ApiError(r.status >= 500 ? MSG.server : (d.error || MSG.server), r.status);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (attempt < retries) { await new Promise(res => setTimeout(res, 600)); continue; }
      throw new ApiError(MSG.network, 0);
    } finally { clearTimeout(t); }
  }
}

// ── Settings (one document drives every phone/email/Instagram on the site) ──
let settingsP;
export const getSettings = () => (settingsP ||= api('/api/settings').then(d => d.settings).catch(() => ({})));
const digits = s => String(s || '').replace(/\D/g, '');
export const waLink = n => { const d = digits(n); return d ? `https://wa.me/${d.startsWith('0') ? '233' + d.slice(1) : d}` : ''; };
const handle = h => String(h || '').trim().replace(/^@/, '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
export const igLink = h => (handle(h) ? `https://www.instagram.com/${handle(h)}/` : '');
export const fbLink = h => (handle(h) ? `https://www.facebook.com/${handle(h)}` : '');
export const ttLink = h => (handle(h) ? `https://www.tiktok.com/@${handle(h)}` : '');
// Every social account the site shows, in one place: [label, link, @handle]
export const socials = s => [['Instagram', igLink(s.instagram), s.instagram], ['Facebook', fbLink(s.facebook), s.facebook], ['TikTok', ttLink(s.tiktok), s.tiktok]]
  .filter(([, url]) => url).map(([name, url, h]) => [name, url, '@' + handle(h)]);
const SOCIAL_ICONS = {
  Instagram: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  Facebook: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8.5a.5.5 0 0 1 .5-.5z"/></svg>',
  TikTok: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16 3c.3 2.2 1.8 3.8 4 4v3.2c-1.5 0-2.9-.4-4-1.2v6.5a5.5 5.5 0 1 1-5.5-5.5l1 .1v3.3a2.3 2.3 0 1 0 1.3 2.1V3H16z"/></svg>',
};
// Clickable icon row for every social account that's set: "Follow us".
export const followRow = s => {
  const list = socials(s);
  return list.length ? `<div class="follow"><p class="kicker">Follow us</p><div class="follow-icons">${list.map(([name, url, h]) => `<a href="${esc(url)}" target="_blank" rel="noopener" aria-label="${name} ${esc(h)}" title="${name} ${esc(h)}">${SOCIAL_ICONS[name]}</a>`).join('')}</div><p class="foot-small">${esc(list[0][2])}</p></div>` : '';
};
export const mapLink = s => s.mapUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.venue || 'SamRit Hotel Cape Coast')}`;

const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.4.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';

export async function chrome(active = '') {
  const head = document.createElement('header');
  head.className = 'site-head';
  head.innerHTML = `<div class="wrap"><a class="logo" href="index.html" aria-label="Memories — home"><img src="assets/logo.png" alt="Memories" width="93" height="22"></a>
    <nav class="nav" aria-label="Main">${[['nights', 'Nights'], ['tables', 'Tables'], ['visit', 'Visit']].map(([k, l]) => `<a class="nav-${k}" href="${k}.html"${active === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}<span id="waSlot"></span><a class="get" href="nights.html">Get<span class="long"> tickets</span><span class="short">Tickets</span></a></nav></div>`;
  document.body.prepend(head);
  const foot = document.createElement('footer');
  foot.className = 'site-foot';
  document.body.append(foot);
  const s = await getSettings();
  if (s.whatsapp) $('#waSlot').outerHTML = `<a class="wa" href="${waLink(s.whatsapp)}" target="_blank" rel="noopener" aria-label="WhatsApp us">${WA_ICON}<span>WhatsApp</span></a>`;
  const items = [
    `<li><a href="${esc(mapLink(s))}" target="_blank" rel="noopener">${esc(s.venue || 'SamRit Hotel, Cape Coast')} ↗</a></li>`,
    s.whatsapp && `<li><a href="${waLink(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp ${esc(s.whatsapp)}</a></li>`,
    s.phone && `<li><a href="tel:${digits(s.phone)}">${esc(s.phone)}</a></li>`,
    s.email && `<li><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>`,
  ].filter(Boolean).join('');
  foot.innerHTML = `<div class="wrap foot-grid">
    <div><a class="logo" href="index.html"><img src="assets/logo.png" alt="Memories" width="110" height="26"></a><p class="foot-small" style="margin-top:14px">${esc(s.nightsLine || 'Friday + Saturday')} · ${esc(s.doorsLine || 'Doors 10PM')}</p>${followRow(s)}</div>
    <ul class="foot-list">${items}</ul>
    <ul class="foot-list"><li><a href="nights.html">Nights</a></li><li><a href="nights.html#calendar">Calendar</a></li><li><a href="tables.html">Tables</a></li><li><a href="private.html">Book an event</a></li><li><a href="installment.html">Pay the rest of a ticket</a></li></ul>
    <div><span class="age" title="Strictly 18 and over">18+</span><p class="foot-small" style="margin-top:10px">Strictly 18+.</p></div>
  </div>`;
  return s;
}

// ── UI states ──
export const loading = text => `<div class="loading" role="status">${esc(text)}</div>`;
export function errorState(el, message, retry) {
  el.innerHTML = `<div class="state-msg"><h2 class="display">${esc(message.includes('CONNECTION') ? 'CONNECTION DROPPED.' : 'THAT DIDN’T WORK.')}</h2><p>${esc(message.includes('CONNECTION') ? 'Check your signal and try again.' : message)}</p>${retry ? '<button class="btn" data-retry>TRY AGAIN</button>' : '<a class="btn" href="index.html">BACK TO MEMORIES</a>'}</div>`;
  if (retry) $('[data-retry]', el).onclick = retry;
}
let toastT;
export function toast(msg) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

// Remember who's buying so a second purchase is one tap shorter (this device only).
export const remember = {
  get: () => { try { return JSON.parse(localStorage.getItem('mem-buyer') || '{}'); } catch { return {}; } },
  set: v => { try { localStorage.setItem('mem-buyer', JSON.stringify(v)); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem('mem-buyer'); } catch { /* private mode */ } },
  has: () => { const r = remember.get(); return !!(r.name || r.phone || r.email); },
};
// "Not you? Clear saved details": a small button that forgets this device's details and empties the
// given fields. Returns '' when nothing is saved.
export const forgetButton = () => (remember.has() ? '<button type="button" class="link forget" data-forget>Not you? Clear saved details</button>' : '');
export function bindForget(root, fields, onClear) {
  root.querySelectorAll('[data-forget]').forEach(b => b.onclick = () => {
    remember.clear();
    for (const id of fields) { const el = root.querySelector('#' + id); if (el) el.value = ''; }
    b.remove(); onClear?.(); toast('Saved details cleared from this phone.');
  });
}

export async function shareUrl(title, url = location.href) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(url); toast('LINK COPIED.'); } catch { toast(url); }
}
