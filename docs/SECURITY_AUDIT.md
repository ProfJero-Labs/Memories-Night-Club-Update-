# Security audit

Branch `ProfJero-patch-2`, September 2026. Each item says **what was checked, how, and the
result**. "Test" means an automated test that runs in `npm test`, `npm run test:e2e` or
`npm run test:rules` (all three run in CI on every push). "Code" means verified by reading the
code only. "Owner" means it needs someone with access to an outside account.

| Area | How checked | Result |
|---|---|---|
| **XSS** | Code: every template interpolation goes through `esc()` (one copy, `public/lib/shared.js`). Test: `shared.test.js` fails if any file defines its own `esc`; e2e "XSS" journey renders `<img onerror>` names without executing them; CSP forbids inline scripts (`csp-and-images.test.js`). | **Pass** |
| **Ticket token in API responses** | Test: `installment-lookup.test.js` (lookup by code/phone returns no token, link, QR data or phone), `door.test.js` (search returns no token), `acceptance.test.js` (public event payload has no token). Code: `/api/tickets/:token` and `/api/verify/:token` only answer someone already holding the token. | **Fixed + tested** (lookup used to return tokens: A1) |
| **Token in URLs / referrers** | Code + test: ticket, verify, admin, organiser, checkin, login send `Referrer-Policy: no-referrer` and `noindex`. The share image draws no QR or code (`ticket-art.js`). | **Pass** |
| **Token in logs** | Test: `logging.test.js`. All Worker logging goes through `redact()` (tokens, document paths, order codes, phones, keys, bearer tokens); a test fails if any file calls `console.*`. | **Fixed + tested** (errors could quote `tickets/<token>`: A8) |
| **Authorization bypass / IDOR** | Test: `authz-matrix.test.js`, 34 routes × (no token, garbage token, other project's token, no-role account, each wrong role). Organisers can't admit, search, count or view another organiser's night. | **Pass** (no gaps found) |
| **Privilege escalation via set-role** | Test: only superAdmin may call it; a manager can't grant or raise themselves; a superAdmin can't demote themselves; `admin: true` only with superAdmin; every change in `audit_logs`. | **Pass** |
| **Payment replay / duplicate fulfilment** | Test: same reference verified twice or webhook redelivered → same ticket set, nothing new (`acceptance`, `last-ticket`, `installment-race`, `security-webhook`); webhook signature (HMAC-SHA512) checked; amount + currency compared with Paystack's verify call; overpayment recorded, never a second ticket. | **Pass** |
| **Paystack return URL** | Test: a browser-supplied `callbackUrl` never reaches Paystack; the Worker uses `PUBLIC_SITE_URL/payment-return.html`, and refuses to start a payment without it. | **Fixed + tested** (A4) |
| **Check-in races** | Test: 20 simultaneous scans of one ticket → exactly one entry and one check-in record (`door.test.js`); retries give up after 5 attempts under permanent contention. | **Pass** |
| **Door: wrong night** | Test: the server refuses to admit without a night (`no_event`); a ticket for another night is WRONG NIGHT; the page has no "Any night". | **Fixed + tested** (C) |
| **Rate limiting / order-code brute force** | Code + test: strict limits per IP and, new, per phone and per order code (`throttled(..., subject)`). Order codes are now 10 Crockford Base32 characters (50 bits); old `MEM-AB1234` codes (~5.8 million values) keep working until those plans close. | **Fixed + tested** (A2) |
| **Phone enumeration** | Test: "lost code" and "text me the link" give identical responses for known/unknown numbers and right/wrong phones; the text is sent after the response, so timing doesn't differ. `?phone=` lookup returns nothing. | **Fixed + tested** (A1) |
| **Firebase rules** | Test (emulators, `npm run test:rules`, 6 tests): browsers can't write any business data (not even a super admin); tickets readable one-by-id only, never listed; guest contact details unreadable; flyer uploads staff-only, images only, < 8 MB. | **Pass** (runs in CI) |
| **Event images** | Test: the Worker only accepts images uploaded to this project's Storage (`event-art/`); an image a night already has still saves. CSP `img-src` deliberately still allows `https:` so existing production flyers hosted elsewhere don't vanish. | **Fixed + tested**; tighten `img-src` after checking production data |
| **CSP / headers** | Test: `script-src` has no `unsafe-inline`; `connect-src` names the Worker host (not `*.workers.dev`) and the Firebase hosts; HSTS present. The dev server applies the production CSP, so all browser journeys run under it. Real Firebase sign-in (identitytoolkit/securetoken hosts) can't run locally. | **Fixed + tested** (sign-in hosts: code only) |
| **CORS** | Code: `ALLOWED_ORIGINS` is the production domains + Pages host; the `localhost:5500` entries were removed. | **Fixed** |
| **Worker secrets** | Code: Paystack, Brevo, service account and SMS key are Worker secrets, never in `public/`. Test: `no-secrets.test.js` fails if a key is committed; TruffleHog scans every push. | **Pass** for the current tree |
| **Secrets in git history** | Scan of all history: a real **Brevo API key** is in commits `5730d76`, `c016b4c`, `32ede69`, `037f127` (old site JS). A Paystack *public* test key also appears (low risk). No private keys or service-account files were ever committed. | **Owner**: revoke the Brevo key. History can't be un-published. |
| **Shared service-account key** | The Firebase admin key was in the engineer's zip (Drive, two chats). Never committed. | **Owner**: replace it in Google Cloud. |
| **SMS worker exposure** | `memories-sms` is a separate Worker (not in this repo) whose URL was published by the old site. | **Owner**: turn off its workers.dev route or require `SMS_WORKER_KEY`. |
| **Repo visibility** | The repo is public: full API surface, Worker URL and Firebase project are visible (no secrets in the current tree). | **Owner**: make it private. |
| **Door QR vs ticket link (A3)** | Code: tokens are ~244-bit random (`ticketToken`); the ticket URL is the only credential and the QR is a verify link with the same token. Recommendation: keep for launch; later, show a short-lived door code on the ticket page so a forwarded screenshot of the link is worth less. | **Documented** (OPEN_DECISIONS #11) |

## Not covered by this pass

- Refunds owed after "sold out after payment" are recorded on the checkout but not listed in the
  control room (Phase 2, with the pay-in-bits decisions).
- Customers' own ticket lines aren't filtered (OPEN_DECISIONS #9).
- Lighthouse / performance and a full accessibility pass (Phase 2, workstream G).
