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

// ── Going back ──
// Every screen reached inside the app is marked, so "Back" returns to where the person came from
// (the phone's back button and the on-screen ← do the same thing). A screen opened from a link or
// a bookmark has nowhere in the app to go back to, so ← goes to its parent instead.
addEventListener('hashchange', e => { if (!history.state) history.replaceState({ inApp: 1, from: new URL(e.oldURL).hash.slice(1) }, ''); });
// A panel closed by a button leaves a spent history entry behind; the back button skips it.
addEventListener('popstate', e => { if (e.state?.spentSheet) history.back(); });
export function goBack(fallback = '') {
  if (history.state?.inApp) history.back();
  else if (fallback.startsWith('@')) location.href = fallback.slice(1);
  else location.hash = fallback;
}
// Finished a task (drinks sent, sale done): return to the screen it was started from without
// leaving the finished step in the history, so Back never reopens it.
export function returnTo(hash) {
  // Still inside a panel: close it first (one step back), then return.
  if (history.state?.sheet || history.state?.spentSheet) { addEventListener('popstate', () => setTimeout(() => returnTo(hash), 0), { once: true }); history.back(); return; }
  if (history.state?.from === hash) history.back();
  else location.replace(`#${hash}`);
}
// The bar at the top of any screen that isn't a main tab: ← Back, then the screen's name.
export const backBar = (title = '', to = '') => `<div class="backbar"><button type="button" class="back-btn" data-goto="${esc(to)}" aria-label="Back">←<span>Back</span></button>${title ? `<b>${esc(title)}</b>` : ''}</div>`;
// Wires every ← on the screen (call after drawing it).
export const bindBackBar = (root = document) => $$('.back-btn[data-goto]', root).forEach(b => { b.onclick = () => goBack(b.dataset.goto); });

// A panel that slides up from the bottom, with a form inside. Returns { box, close }.
// The phone's back button closes it (it never leaves the screen behind), and so do ✕, a tap on
// the dark area around it, and Esc.
export function sheet(html, { label = 'Details', full = false } = {}) {
  const box = document.createElement('div'); box.className = 'sheet-back';
  box.innerHTML = `<div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}"><button type="button" class="sheet-x" aria-label="Close">✕</button>${html}</div>`;
  document.body.append(box);
  document.documentElement.classList.add('sheet-open');
  const id = `s${Date.now()}${Math.random()}`, at = location.href;
  history.pushState({ sheet: id }, '');
  let gone = false;
  const finish = () => {
    if (gone) return; gone = true; box.remove(); removeEventListener('keydown', key); removeEventListener('popstate', pop);
    if (!document.querySelector('.sheet-back')) document.documentElement.classList.remove('sheet-open');
  };
  const pop = () => { if (history.state?.sheet !== id) finish(); };
  // Closed from the screen: mark its history entry spent and step back over it, unless the code
  // that closed it has already moved to another screen.
  const close = () => {
    if (gone) return; finish();
    if (history.state?.sheet === id) { history.replaceState({ spentSheet: 1, inApp: 1 }, ''); setTimeout(() => { if (location.href === at && history.state?.spentSheet) history.back(); }, 0); }
  };
  const key = e => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', key); addEventListener('popstate', pop);
  box.onclick = e => { if (e.target === box) close(); };
  $$('[data-close], .sheet-x', box).forEach(b => b.onclick = close);
  // Typing: the box being typed in stays above the keyboard.
  box.addEventListener('focusin', e => { if (e.target.matches('input, textarea, select')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); });
  $$('textarea', box).forEach(autoGrow);
  // Focus the first field, unless the person has already started typing in the sheet (moving the
  // cursor then would send the rest of what they type into the wrong box).
  setTimeout(() => { if (!box.contains(document.activeElement)) box.querySelector('input:not([type=checkbox]), select, textarea')?.focus(); }, 30);
  return { box, close };
}

// A text box that grows as the person types (never a cramped two lines).
export function autoGrow(t) {
  if (t.dataset.grow) return; t.dataset.grow = '1';
  const fit = () => { t.style.height = 'auto'; t.style.height = `${Math.min(Math.max(t.scrollHeight + 2, 140), Math.round(innerHeight * 0.5))}px`; };
  t.addEventListener('input', fit); requestAnimationFrame(fit);
}
export const growAll = (root = document) => $$('textarea', root).forEach(autoGrow);
// Every writing box on every screen grows as the person types (screens redraw, so keep watching).
if (typeof MutationObserver !== 'undefined' && document.body) new MutationObserver(() => growAll()).observe(document.body, { childList: true, subtree: true });

// Quick replies above a writing box: one tap adds the phrase (they can still type their own).
export function addQuick(textarea, list) {
  if (!textarea || !list?.length) return;
  const row = document.createElement('div'); row.className = 'quick'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'Quick replies');
  row.innerHTML = list.map(q => `<button type="button" class="chip">${esc(q)}</button>`).join('');
  $$('button', row).forEach(b => b.onclick = () => { textarea.value = textarea.value.trim() ? `${textarea.value.trim()} ${b.textContent}` : b.textContent; textarea.dispatchEvent(new Event('input')); textarea.focus(); });
  (textarea.closest('.sfield') || textarea).before(row);
}

// Writing something: a full panel with a big box that grows, quick replies to tap, and the send
// button always above the keyboard (like a chat app). Resolves with the text, or null if closed.
//   ask({ title, label, hint, quick: ['Wrong amount', …], send: 'Refuse', required: true, value })
export function ask({ title, label = '', hint = '', quick = [], send = 'Send', required = true, value = '', max = 600, danger = false } = {}) {
  return new Promise(resolve => {
    const { box, close } = sheet(`<h2>${esc(title)}</h2>
      ${quick.length ? `<div class="quick" role="group" aria-label="Quick replies">${quick.map(q => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
      <div class="sfield">${label ? `<label for="askT">${esc(label)}</label>` : ''}<textarea id="askT" maxlength="${max}" placeholder="${esc(hint)}" ${label ? '' : `aria-label="${esc(title)}"`}>${esc(value)}</textarea></div>
      <div id="askM"></div>
      <div class="sheet-dock"><button class="big ${danger ? 'red' : ''}" id="askGo">${esc(send)}</button></div>`, { label: title, full: true });
    let done = false;
    const t = $('#askT', box);
    $$('[data-q]', box).forEach(b => b.onclick = () => { t.value = t.value.trim() ? `${t.value.trim()} ${b.dataset.q}` : b.dataset.q; t.dispatchEvent(new Event('input')); t.focus(); });
    $('#askGo', box).onclick = () => {
      const v = t.value.trim();
      if (required && !v) { say($('#askM', box), 'Write a few words first, or tap a quick reply.', 'bad'); return t.focus(); }
      done = true; close(); resolve(v);
    };
    // Closed without sending (✕, back, outside): nothing happens.
    new MutationObserver((_, o) => { if (!document.body.contains(box)) { o.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
  });
}

// Smart paste: the details in a pasted MoMo text (MTN MoMo, Telecel Cash, AT Money) so staff check
// them instead of retyping. Returns { ref, amountPesewas, phone } with whatever it could find.
export function readMomo(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  const out = {};
  const ref = s.match(/(?:transaction|trans\.?|txn|financial transaction)\s*(?:id|ref(?:erence)?|no\.?|number)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9.]{5,39})/i) || s.match(/\b(?:ref(?:erence)?|id)\s*[:#]?\s*([A-Z0-9]{6,40})\b/i) || s.match(/\b(?!0[235]\d{8}\b)(\d{10,14})\b/);
  if (ref) out.ref = ref[1].replace(/\.$/, '').toUpperCase();
  const amt = s.match(/(?:GHS|GH₵|GHC|₵|cedis?)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i) || s.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:GHS|GHC|cedis?)/i);
  if (amt) out.amountPesewas = Math.round(Number(amt[1].replace(/,/g, '')) * 100);
  const ph = s.match(/(?:from|by|sender|payer)[^0-9+]{0,40}((?:\+?233|0)\s?[235]\d(?:\s?\d){7})/i) || s.match(/((?:\+?233|0)[235]\d{8})/);
  if (ph) out.phone = ph[1].replace(/\s/g, '').replace(/^\+?233/, '0');
  return out;
}
// A "Paste MoMo text" button for a form: fills the transaction ID (and amount and number when
// asked) from the MoMo message on the clipboard, or from what the person pastes if the phone
// won't let the page read the clipboard. fill({ ref, amountPesewas, phone }).
export function pasteMomoButton(fill) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'paste-btn'; b.textContent = 'Paste the MoMo text';
  b.onclick = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* not allowed: ask for it */ }
    if (!text) text = await ask({ title: 'Paste the MoMo text', label: 'Long-press, then Paste', hint: 'The MoMo message the customer received or sent', send: 'Read it', max: 2000 }) || '';
    const got = readMomo(text);
    if (!got.ref && !got.amountPesewas) { b.textContent = 'Couldn’t read it: type the ID'; return; }
    fill(got); b.textContent = 'Read from the MoMo text ✓';
  };
  return b;
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
