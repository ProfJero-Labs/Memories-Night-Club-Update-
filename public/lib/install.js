// The Memories app (a PWA), installable from any page by anyone: guests, members, staff.
// Registers the service worker (offline pass, offline page), and offers installing:
//   Android / desktop Chrome / Edge: the browser's own install prompt, behind our "Install" button.
//   iPhone / iPad (Safari has no prompt): the two steps, Share → Add to Home Screen.
// The sheet appears once the browser says the site can be installed, never when already installed,
// and "Not now" hides it for two weeks. Any element with [data-install] opens it on demand.
const DISMISSED = 'mem-install-dismissed';
const WAIT_DAYS = 14;
let deferred = null, sheet = null;

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const recentlyDismissed = () => { try { return Date.now() - Number(localStorage.getItem(DISMISSED) || 0) < WAIT_DAYS * 864e5; } catch { return false; } };
const dismiss = () => { try { localStorage.setItem(DISMISSED, String(Date.now())); } catch { /* private mode */ } };

// The service worker sits at the site root next to this folder, whatever server is in front.
if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});

// Offered everywhere it isn't installed yet: with the browser's prompt when there is one, else the steps.
export const canInstall = () => !standalone();
const android = () => /android/i.test(navigator.userAgent);

// Two apps: guests get "Memories" (tickets, pass, bar orders); staff pages offer "Memories Staff",
// which opens straight to their own dashboard (control room, door, bar or organiser).
const staffApp = () => /staff\.webmanifest/.test(document.querySelector('link[rel=manifest]')?.getAttribute('href') || '');

function close() { sheet?.remove(); sheet = null; }
function draw() {
  if (!sheet) return;
  const staff = staffApp();
  const how = deferred ? '' : ios()
    ? '<ol class="ios-steps"><li>Tap <b>Share</b> <span aria-hidden="true">⬆︎</span> at the bottom of Safari</li><li>Tap <b>Add to Home Screen</b></li></ol>'
    : android()
      ? '<ol class="ios-steps"><li>Tap the browser menu <b>⋮</b> (top right)</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b></li></ol>'
      : '<ol class="ios-steps"><li>Click the install icon <b>⊕</b> at the right of the address bar</li><li>Or open the browser menu (<b>⋮</b>) → <b>Cast, save and share</b> → <b>Install</b></li></ol><p class="sheet-note">Already installed? Open it from your apps. Your browser offers the button above when it’s ready: give it a few seconds.</p>';
  const icon = new URL(staff ? '../assets/icon-staff-192.png' : '../assets/icon-192.png', import.meta.url);
  sheet.innerHTML = `<img src="${icon}" alt="" width="48" height="48">
    <div class="txt"><strong>${staff ? 'Get the Memories Staff app' : 'Get the Memories app'}</strong><span>${staff ? 'Opens straight to your dashboard. Your pass and gate codes in one tap.' : 'Tickets, your pass and bar orders on your home screen. Works with weak signal.'}</span>${how}</div>
    <div class="acts">${deferred ? '<button type="button" class="btn red" data-go>Install</button>' : ''}<button type="button" class="link" data-later>${deferred ? 'Not now' : 'Got it'}</button></div>`;
  sheet.querySelector('[data-later]').onclick = () => { dismiss(); close(); };
  sheet.querySelector('[data-go]')?.addEventListener('click', install);
}
function show(force = false) {
  if (sheet || standalone() || (!force && recentlyDismissed())) return false;
  sheet = document.createElement('aside');
  sheet.className = 'install-sheet'; sheet.setAttribute('aria-label', 'Install the app');
  document.body.append(sheet); draw();
  return true;
}

export async function install() {
  if (deferred) {
    const e = deferred; deferred = null; close();
    e.prompt(); await e.userChoice.catch(() => {});
    return;
  }
  show(true);
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferred = e;
  document.querySelectorAll('[data-install]').forEach(b => { b.hidden = false; });
  if (sheet) draw(); // the steps were showing: now it's one tap
  else setTimeout(() => show(), 2500);
});
addEventListener('appinstalled', () => { deferred = null; close(); document.querySelectorAll('[data-install]').forEach(b => { b.hidden = true; }); });

// iPhone: no event to wait for, so offer the steps after a short look around.
if (ios() && !standalone()) setTimeout(() => show(), 4000);

// Links that open it on demand ("Get the app" in the footer, the pass page, staff headers).
document.addEventListener('click', ev => { const b = ev.target.closest?.('[data-install]'); if (b) { ev.preventDefault(); install(); } });
const reveal = () => document.querySelectorAll('[data-install]').forEach(b => { b.hidden = !canInstall(); });
new MutationObserver(reveal).observe(document.documentElement, { childList: true, subtree: true });
reveal();
