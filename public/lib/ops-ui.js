// Small helpers shared by the venue screens: money, a bottom sheet, confirmations, a bottom nav,
// polling while the screen is visible, and "saved" messages that only appear once the Worker says so.
import { $, $$, esc, money } from '../app.js';

export { money };
export const ghsIn = v => { const n = Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100); return Number.isFinite(n) ? n : NaN; };
export const when = d => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit' }) : '');
export const dayName = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
export const st = (key, label) => `<span class="st ${esc(key)}">${esc(label)}</span>`;

// A message in a box: kind good | bad | warn.
export function say(el, text, kind = 'good', title = '') {
  if (!el) return;
  el.innerHTML = text ? `<div class="say ${kind}" role="${kind === 'bad' ? 'alert' : 'status'}">${title ? `<b>${esc(title)}</b>` : ''}${esc(text)}</div>` : '';
  if (text && kind === 'good') setTimeout(() => { if (el.firstElementChild?.textContent.includes(text)) el.innerHTML = ''; }, 4000);
}

// A bottom sheet with a form inside. Returns { box, close }.
export function sheet(html, { label = 'Details' } = {}) {
  const box = document.createElement('div'); box.className = 'sheet-back';
  box.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  document.body.append(box);
  const close = () => { box.remove(); removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', key);
  box.onclick = e => { if (e.target === box) close(); };
  $$('[data-close]', box).forEach(b => b.onclick = close);
  // Focus the first field, unless the person has already started typing in the sheet (moving the
  // cursor then would send the rest of what they type into the wrong box).
  setTimeout(() => { if (!box.contains(document.activeElement)) box.querySelector('input, select, textarea, button')?.focus(); }, 30);
  return { box, close };
}

// Busy button while a request runs; the label comes back after.
export async function busy(btn, fn, text = 'Saving…') {
  const old = btn.innerHTML; btn.disabled = true; btn.textContent = text;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}

// Bottom navigation. items: [[key, label]]. onGo(key). Returns setActive(key) and setDot(key, n).
export function bottomNav(items, onGo) {
  const nav = document.createElement('nav'); nav.className = 'bnav'; nav.setAttribute('aria-label', 'Sections');
  nav.innerHTML = items.map(([k, l]) => `<button type="button" data-k="${esc(k)}">${esc(l)}</button>`).join('');
  document.body.append(nav);
  $$('button', nav).forEach(b => b.onclick = () => onGo(b.dataset.k));
  return {
    setActive: k => $$('button', nav).forEach(b => b.setAttribute('aria-current', String(b.dataset.k === k))),
    setDot: (k, n) => { const b = $(`[data-k="${k}"]`, nav); if (!b) return; b.querySelector('.dot')?.remove(); if (n) b.insertAdjacentHTML('beforeend', `<span class="dot">${n}</span>`); },
  };
}

// Run fn now and every `ms` while the screen is visible. Returns stop().
// fn gets alive(): false once stopped (the person has moved to another screen). A refresh that was
// already on its way checks it before drawing, so it never draws over the screen they moved to.
export function every(ms, fn) {
  let t = null, stopped = false;
  const alive = () => !stopped;
  const tick = async () => { clearTimeout(t); if (stopped) return; if (document.visibilityState === 'visible') { try { await fn(alive); } catch { /* next tick retries */ } } t = setTimeout(tick, ms); };
  const vis = () => { if (document.visibilityState === 'visible' && !stopped) tick(); };
  document.addEventListener('visibilitychange', vis);
  tick();
  return () => { stopped = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
}

// A money input in cedis that the Worker receives in pesewas.
export const moneyField = (id, label, value = '', hint = '') => `<div class="sfield"><label for="${id}">${esc(label)}</label><div class="money-in"><input id="${id}" inputmode="decimal" value="${esc(value)}" autocomplete="off"></div>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;
