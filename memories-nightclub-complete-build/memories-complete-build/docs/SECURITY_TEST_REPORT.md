# Security & Functional Test Report

Date: 2026-09-23
Branch: `ProfJero-patch-1`
Path: `memories-nightclub-complete-build/memories-complete-build`

## Environment actually tested against — read this first

**I did not test against production, staging, or any live Paystack account, and I want to be
explicit about why, since the request specifically asked me to confirm this before anything
else.**

This session has **zero credentials** for any of the three systems involved:

- **Cloudflare**: `wrangler whoami` → not authenticated. No API token, no `wrangler login`. I
  cannot deploy the Worker, read its secrets, or find out whether `PAYSTACK_SECRET_KEY` is a live
  or test key. Per your instruction, not being able to confirm that is itself a reason to stop,
  not proceed.
- **Firebase**: no `firebase` CLI session, no service-account JSON, no `FIREBASE_*` env vars
  anywhere in this container. I cannot seed data, create accounts, or run Admin SDK writes.
- **Paystack**: no keys of any kind. I cannot initiate a real charge or receive a real webhook.

I also could not reach the deployed Worker or the public site from this sandbox
(`memories-paystack-verify.diamondj04102026.workers.dev` and `memoriesnightclub.com` both timed
out — network-policy-blocked, or not currently deployed, I can't tell which from here). No
browser-automation tool was available either; Chromium/Playwright is installed in the image but
there was nothing live to point it at.

**One live thing I did touch, read-only, no credentials, zero side effects:** a handful of plain
`curl` GETs to `firestore.googleapis.com` for the project named in `public/config.js`
(`memoriesnightclub-2717f`), to establish whether that project is reachable and what its current
*deployed* rules actually allow — as distinct from what's sitting in this repo's
`firebase/firestore.rules`, since those can drift apart. Result: it's a live project with real
data already in it (an event, ticket types), and reads behaved exactly as this repo's rules
file says they should (public/active-only for `events`/`ticket_types`, `403` for
`tickets`/`orders`/`checkins`/`pending_checkouts`/`private_event_requests`/`users`/`audit_logs`).
I made **zero writes** anywhere. There is no evidence anywhere in this repo of a separate
staging Firebase project or staging Worker deployment — everything (`config.js`,
`wrangler.toml`'s `ALLOWED_ORIGINS`/`PUBLIC_SITE_URL`) points at the one production-looking
setup. **I did not seed demo data into it** — I have no write credentials, so I couldn't have
even if I'd wanted to.

**What I actually ran instead, per your direction to descope to what's safely testable:**

1. **Google's real Firestore Rules Emulator**, loaded with this repo's actual
   `firebase/firestore.rules` (not a rewrite, not a mock — the literal file), driven by
   `@firebase/rules-unit-testing`. This is Google's own rules-evaluation engine, run locally,
   fully disposable, zero live data. 14 tests, `firebase/test/rules.test.js`.
2. **The Worker's actual `src/index.js`**, imported directly and invoked both as internal
   functions and through its real HTTP `fetch()` router, against an in-memory Firestore/Paystack
   mock (`worker/test/mock-firestore.js`, built in an earlier part of this session and extended
   here) that enforces the same optimistic-concurrency conflict rules as real Firestore. 25 tests
   across `worker/test/*.test.js`.
3. **A real headless Chromium browser** (Playwright, using this image's pre-installed browser),
   for the XSS-escaping check, since "does this execute in a browser" isn't something a Node
   string assertion can honestly answer.

Every number, pass/fail, and reproduction command below is something I actually ran in this
session. Where I could not run something, it's called out explicitly under **Untested**, not
silently skipped.

Run everything yourself:
```
cd worker && npm test                         # 25 tests — Worker logic + HTTP routing
cd firebase/test && npm install && npm test    # 14 tests — real Firestore rules emulator
```

---

## Confirmed vulnerabilities

**None found.** Every attack I was able to actually execute against real code (the Worker's own
`src/index.js`, the real `firestore.rules` file, and the real `esc()` sanitizer, all run for
real, not read and inferred) was rejected correctly. See below for exactly what that covers and
what it doesn't.

One thing worth flagging even though it isn't a vulnerability in the app: while building the XSS
test I initially got a false positive (3 payloads appeared to "execute") because *my test
harness* embedded a JSON array containing `</script>` into an inline `<script>` block — the HTML
parser closes the script tag at that literal substring regardless of it being inside a JS string,
independent of any escaping. That's a real, well-known class of bug — but it's in how *I*
constructed the test fixture, not in this app: I checked, and nowhere in `public/*.html`,
`public/*.js`, or `worker/src/index.js` does guest-controlled data ever get embedded into a raw
`<script>` block this way — every incoming payload arrives already-parsed via `fetch()`/`.json()`
and is rendered through `esc()` into `.innerHTML`, never through raw HTML text construction. I
fixed the test to pass data via Playwright's `page.evaluate(fn, args)` bridge (structured clone,
never touches HTML text) instead, which is what a genuine test of `esc()`'s actual usage pattern
requires, and it now correctly confirms the real behavior — see below.

---

## Confirmed working correctly

### Part 3 — Concurrency / race conditions

All four scenarios you called out, run for real against `src/index.js`'s actual transactional
functions (`checkin`, `fulfillTicket`, `drawRaffle`, `fulfillInstallment`), fired concurrently via
`Promise.all`, against a mock Firestore that enforces the same optimistic-concurrency (read a
version, 409 on commit if it changed) semantics real Firestore transactions do:

| Scenario | File | Result |
|---|---|---|
| Two simultaneous checkout completions for the same low-stock ticket type (`remaining: 1`, two buyers, qty 1 each) | `worker/test/last-ticket.test.js` | Exactly one issued, one `sold_out_after_payment`; stock lands at exactly `0`, never negative; exactly 1 ticket doc, 1 order doc created |
| Two simultaneous raffle draws on the same raffle | `worker/test/raffle-draw.test.js` | Exactly one produces a winner; the other gets a clean `"This raffle has already been drawn."` error, not a silent overwrite; exactly 1 audit-log entry |
| Two simultaneous check-in attempts on the same ticket token | `worker/test/checkin.test.js` | Exactly one succeeds (`ENTRY CONFIRMED`); the other gets `TICKET ALREADY USED`; exactly 1 `checkins` doc |
| The same Paystack webhook reference processed twice (simulating webhook + client-poll both landing, or a retried delivery) | `worker/test/last-ticket.test.js` ("same reference verified twice") and `worker/test/security-webhook.test.js` ("positive control") | Both calls return the *same* ticket ID; exactly 1 ticket doc; stock decremented exactly once |

Also covered, beyond what was asked, since I'd already built the harness and these are the same
class of bug: two installment top-ups racing to complete the same payment plan
(`worker/test/installment-race.test.js` — both amounts land, no lost update, ticket issued
exactly once even though both payments individually looked valid at initiation time), two ticket
orders racing for the last raffle spot (`worker/test/raffle-spot-race.test.js` — cap never
exceeded), `listDocs()` pagination past 300 docs (`worker/test/list-pagination.test.js`), and the
retry loop's cap under permanent contention — 5 attempts, not infinite
(`worker/test/retry-cap.test.js`).

**Reproduce:** `cd worker && npm test`

### Part 4 — Security model

**Server-computed price, ignored client price.** `initiateTicket()` never reads a price field
from the request body at all — I sent `{..., pricePesewas: 1, amountPesewas: 1, price: 1,
total: 1}` alongside a real `eventId`/`ticketTypeId`, and the resulting `pending_checkouts`
document's `amountPesewas` came out as `5000` (the seeded `ticket_types.pricePesewas`), not `1`.
`worker/test/security-webhook.test.js`.

**`callback_url` allowlist.** A checkout-initiate request with `callbackUrl:
"https://evil-phishing-site.example/steal"` is rejected with a 400 and *no* `pending_checkouts`
document is created. Same file.

**Paystack webhook signature.** Ran all three cases through the Worker's actual `fetch()` router
(`export default { fetch }`), not just the internal fulfillment function:
- A forged signature → response is `200 "ignored"`, and the targeted `pending_checkouts` doc
  stays `pending` — nothing is fulfilled.
- No signature header at all → same, `"ignored"`, nothing fulfilled.
- A correctly-computed HMAC-SHA512 signature (using the same secret the Worker holds) →
  processed for real, ticket issued. This positive control matters: it proves the first two
  results are the signature check actually working, not the route being broken outright.

**Unauthenticated / non-admin access to locked Firestore collections — tested against Google's
real rules emulator, not inferred from the rules text:**
- Anonymous reads: `tickets` (get-by-id only, `list` denied), `orders`, `checkins`,
  `pending_checkouts`, `private_event_requests`, `installment_plans`, `audit_logs` — all denied,
  both read and write, including writes to the ones with a narrow read allowance.
- `events`/`ticket_types`/`table_packages`/`bottles`: public read only for `visibility=='public'
  && active==true` (I additionally seeded an inactive-but-public event, `evtInactive`, and a
  private one, `evtPrivate` — both denied to anonymous readers).
- A signed-in account with *no* custom claims (exactly what a fresh self-signup produces) has the
  identical restrictions as anonymous — it does not implicitly gain anything by being signed in.
- `doorStaff`/`manager`/`eventManager` role claims (i.e. real staff, just not `superAdmin`) get
  **zero** extra direct-Firestore access beyond a plain customer — confirmed they cannot
  check in a ticket, edit an event, or list orders via the client SDK. This is by design: those
  roles operate only through the Worker, which checks the role claim itself
  (`requireRole()`, separately unit-tested below).
- `admin:true` (superAdmin) — positive control — can read/write everything the above couldn't,
  proving the emulator and rules are actually wired up, not just failing shut on everything.
- **Organiser scoping**, the exact case `docs/BUILD_PLAN.md`'s own test checklist names —
  *"Organiser A can't open organiser B's event"*: `organiser-uid-A` (matching the event's
  `organiserId`) can read a *private*, non-public event assigned to them; `organiser-uid-B`
  (a different organiser) cannot. Also confirmed the organiser role never grants write access,
  even to an event they do own. (First pass of this test gave a false pass for the wrong reason —
  I'd seeded the test event as `visibility:'public', active:true`, so the public clause alone was
  granting access to everyone and the organiser-specific rule branch was never actually being
  exercised. Fixed by adding a genuinely private, organiser-owned event and re-running; see
  `firebase/test/rules.test.js`.)

**Reproduce:** `cd firebase/test && npm install && npm test`

**Admin-only Worker routes.** Every route under `/api/admin/*`, plus `/api/checkin`, refuses a
request with no `Authorization` header (`401`) and refuses a syntactically-invalid bearer token
the same way (`verifyStaff()` fails closed on any JWT-verification error). I could not mint a
*valid* Firebase ID token for a non-admin account (no Firebase Auth credentials — see Untested),
so I unit-tested `requireRole()` directly instead — this is the exact function every one of those
routes calls to make its allow/deny decision, so this is a direct test of the real authorization
logic, not a proxy for it:
- `admin:true` passes any route regardless of listed roles.
- A role claim only passes routes that explicitly list it (`doorStaff` passes check-in, correctly
  fails an events/catalog-edit route that only lists `superAdmin`/`manager`/`eventManager`;
  `organiser` fails ordinary admin routes).
- No user, an empty claims object, and an unrecognized role string all fail closed.
- The literal string `"superAdmin"` sitting in a `role` claim does **not** bypass anything on a
  route that doesn't list it — there's no string-matching shortcut being exploited here.

`worker/test/security-misc.test.js`, `worker/test/security-webhook.test.js`.

**Ticket token guessing.** `ticketToken()` is two concatenated `crypto.randomUUID()` values — 64
lowercase-hex characters, ~244 bits of real randomness (each UUIDv4 carries 122 bits; the other 6
of each 128 are fixed version/variant markers). I generated 200 real tickets through the actual
issuance path and confirmed: exact 64-hex-char shape, zero collisions. A ticket is only ever
looked up by this exact token (`GET /api/tickets/:token`, or the QR code's embedded verify URL) —
guessing or enumerating one is not a runtime-testable claim beyond confirming the actual output
space, which I did; the infeasibility itself is a property of `crypto.randomUUID()`'s
specification, not something I can additionally prove by running more of the same test.
`worker/test/security-misc.test.js`.

**XSS in guest-controlled free text.** The exact `esc()` implementation used across
`public/app.js:28` (re-exported to `ticket.html`, `verify.html`, `checkout.html`,
`payment-return.html`, `installment.html`, `checkin.html`, `private.html`) and `public/admin.js:18`
(identical, standalone copy — event names, private-night requests, catalog rows, etc.) — loaded
into a real headless Chromium page, rendering 5 payloads (`<img onerror=...>`, `<script>...`,
`"><svg onload=...>`, `'><img onerror=...>`, `<a href="javascript:...">`) through the same
`${esc(x)}` → `.innerHTML` pattern used throughout the app, with data passed in the same shape the
real app receives it (already-parsed values, not raw HTML text — see the note above about my own
test-construction bug). Result: zero executions (`window.__xss` stayed `0`), zero dialogs, and
the payload text is visibly present as literal escaped text in the DOM (proving it was neutralized,
not silently dropped, which would hide a different bug). `worker/test/xss-render.test.js`.

---

## Untested — and why

I'm listing these explicitly rather than omitting them, per your instruction.

| Item | Why I couldn't test it | What would unblock it |
|---|---|---|
| Full guest journey through a real browser against the deployed site (Part 2) | No browser-automation tool available with a live target; the deployed Worker/site is unreachable from this sandbox | Reachable staging URL + a browser tool, or run this from an environment with real network access |
| A real Paystack test-card checkout end to end | No Paystack keys of any kind | A `sk_test_...` key |
| Admin panel: create/edit event, upload a flyer, edit price, confirm reflects live | No browser, no live Firestore write access, and (per your item 6) `eventForm`/`catalogForm` in `admin.js` still write directly via the client Firestore SDK rather than through the Worker | Staging Firebase project + browser tool |
| A real Paystack webhook delivered by Paystack itself (vs. a correctly-signed synthetic one I constructed) | No Paystack account to trigger a real delivery | A test-mode Paystack account with a webhook pointed at a reachable staging Worker |
| A genuinely non-admin **but valid** Firebase ID token against every admin route (vs. my `requireRole()` unit test, which tests the same decision function but not the JWT-verification step itself) | No Firebase Auth credentials to sign up/sign in a real account or mint a token | A staging Firebase project I can create a test account in |
| Self-signup via real Firebase Auth, confirming zero admin capability | Same — no Firebase Auth access | Same |
| Rate-limiting / abuse burst against the live checkout-initiate and raffle-entry endpoints (Part 5) | No reachable live endpoint, and deliberately did not attempt this against anything that might be production even if I could reach it | A staging Worker URL, explicit go-ahead to burst it |
| Whether Cloudflare's platform-level protections (vs. in-Worker code) rate-limit anything | Same, plus this specifically requires the live platform, not something a local test can answer | Same |

**One code-reading-only observation for Part 5, explicitly not a live test:** I read every route
in `worker/src/index.js` and there is no in-Worker rate-limiting or throttling logic anywhere —
no request counters, no IP-based backoff, nothing. Whether that matters in practice depends on
Cloudflare's platform-level protections, which I have no way to observe from here. Worth deciding
deliberately before real traffic, not something I can tell you is fine or not fine.

---

## Demo data

**None was created.** I have no write credentials to the live Firebase project, so Part 1's
seeding step (2–3 demo events, low-stock ticket type, capped raffle, etc.) was not performed
there. Everything above runs against fixtures seeded into local, disposable test environments
(the Firestore Rules Emulator's in-memory state, and the Worker test suite's in-memory mock) that
cease to exist the moment each test run ends — there is nothing to clean up.

If you want Part 1's seeding actually done against a real project, I'll need a service-account
JSON for a project you've confirmed is not production (or explicit sign-off to use
`memoriesnightclub-2717f` as one), and I'd do it through the Firebase Admin SDK, labeled exactly
as asked (`"DEMO — ..."` prefixes).

---

## Test files added this session

- `worker/test/mock-firestore.js` — in-memory Firestore/Paystack mock with real
  optimistic-concurrency semantics (built earlier this session for the original concurrency-proof
  requirement; reused and extended here).
- `worker/test/security-webhook.test.js` — webhook signature, price manipulation, callback_url
  allowlist, admin-route auth-header checks.
- `worker/test/security-misc.test.js` — token entropy, `requireRole()` authorization logic.
- `worker/test/xss-render.test.js` — real-browser XSS-escaping check.
- `firebase/test/rules.test.js`, `firebase/test/package.json`, `firebase/firebase.test.json` —
  real Firestore Rules Emulator test suite. `firebase.test.json` is a separate config file
  sitting alongside the real `firebase/firebase.json` (the actual deploy config, untouched) so
  the emulator has its own project/port settings without risk of the two colliding.
