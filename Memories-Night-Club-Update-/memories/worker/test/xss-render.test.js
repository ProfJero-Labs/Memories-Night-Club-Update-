// Real browser test (Chromium via Playwright) of the exact `esc()` implementation used
// throughout the public site and admin panel to render guest-controlled text — verbatim copy
// from public/app.js:28 (re-exported and used by ticket.html, verify.html, checkout.html, etc.)
// and public/admin.js:18 (identical, standalone copy used to render private-night requests,
// event names, and everywhere else admin.js builds innerHTML from Firestore/Worker data).
//
// This loads a throwaway local HTML page (no live site, no live Firebase) that reproduces the
// actual rendering pattern used across the codebase — `container.innerHTML = \`<div>${esc(x)}</div>\``
// — with real XSS payloads in the position a guest's name / message / identity line would occupy,
// then asks a real browser whether the payload executed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

// Verbatim from public/app.js line 28 / public/admin.js line 18.
const ESC_SOURCE = `const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));`;

const PAYLOADS = [
  '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
  '<script>window.__xss=(window.__xss||0)+1</script>',
  '"><svg onload="window.__xss=(window.__xss||0)+1">',
  "'><img src=x onerror=window.__xss=(window.__xss||0)+1>",
  '<a href="javascript:window.__xss=(window.__xss||0)+1">click</a>',
];

let browser, page, dir;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  dir = mkdtempSync(path.join(tmpdir(), 'xss-check-'));
});

after(async () => {
  await browser?.close();
});

function shellHTML() {
  return `<!doctype html><html><body><div id="app"></div><script>${ESC_SOURCE}\nwindow.__xss = 0;</script></body></html>`;
}

test('XSS payloads in guest-controlled fields (name, message, identity line) render as inert text, not as executable markup', async () => {
  const file = path.join(dir, 'xss-check.html');
  writeFileSync(file, shellHTML());
  page = await browser.newPage();

  let dialogFired = false;
  page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });

  await page.goto('file://' + file);

  // Pass payloads in through Playwright's structured-clone bridge (page.evaluate argument),
  // exactly like the real app receives them — as already-parsed JS values from fetch()/JSON,
  // never as text embedded into an HTML/script literal. Rendering itself (the ${esc(...)} into
  // .innerHTML) mirrors admin.js's requestsTab()/eventsTab() and every app.js-consuming page.
  await page.evaluate((payloads) => {
    const guestRecords = payloads.map(p => ({ name: p, message: p }));
    document.querySelector('#app').innerHTML = guestRecords.map((r, i) =>
      `<article id="row${i}"><strong>${esc(r.name)}</strong><p>${esc(r.message)}</p></article>`
    ).join('');
  }, PAYLOADS);

  await page.waitForTimeout(300); // let any injected <script>/onerror actually get a chance to run

  const xssCount = await page.evaluate(() => window.__xss);
  assert.equal(xssCount, 0, `none of the ${PAYLOADS.length} payloads should have executed — window.__xss was incremented ${xssCount} time(s)`);
  assert.equal(dialogFired, false, 'no alert/confirm/prompt dialog should have fired');

  // Confirm the payload is present as literal, escaped text — not silently dropped (which would
  // hide a different bug), and not present as live markup.
  for (let i = 0; i < PAYLOADS.length; i++) {
    const html = await page.locator(`#row${i}`).innerHTML();
    assert.ok(!html.includes('<script>'), `row ${i} must not contain a live <script> tag`);
    assert.ok(!/<img[^>]*onerror=/i.test(html), `row ${i} must not contain a live onerror handler`);
    assert.ok(!/<svg[^>]*onload=/i.test(html), `row ${i} must not contain a live onload handler`);
    const text = await page.locator(`#row${i}`).innerText();
    assert.ok(text.includes(PAYLOADS[i].slice(0, 8)), `row ${i} should still show the payload as visible text (proves it was escaped, not stripped)`);
  }

  await page.close();
});
