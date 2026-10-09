# System map (audit baseline)

Written before the Phase 1 hardening work, from reading the code on `ProfJero-patch-2` after the
layout move (the project now lives at the repo root). Every item here was **verified by reading
code** unless it says otherwise. Findings and fixes are tracked in `SECURITY_AUDIT.md`; business
questions in `OPEN_DECISIONS.md`.

## Pieces

| Piece | Where | Deploys to |
|---|---|---|
| Public site + staff pages | `public/` (static HTML, ES modules, no build) | Cloudflare Pages (from `main`, output `public`) |
| API | `worker/` (one Cloudflare Worker, `memories-paystack-verify`) | `wrangler deploy` (manual, not from git) |
| Data | Firestore, Firebase Auth (staff only), Firebase Storage (`event-art/`) | `firebase deploy` of `firebase/*.rules` |
| Payments | Paystack full-page redirect; webhook `POST /api/paystack/webhook` | |
| SMS | Separate `memories-sms` Worker via service binding `SMS` (not in this repo) | |
| Email | Brevo, from the Worker only | |

## Pages and the API calls they make

| Page | Who | Calls |
|---|---|---|
| `index.html` | public | `GET /api/events`, `GET /api/calendar` (only when nothing is on sale), `GET /api/settings` (every page, via `chrome()`) |
| `nights.html` | public | `GET /api/events`, `GET /api/calendar` |
| `event.html` | public | `GET /api/events/:id` |
| `checkout.html` | public | `GET /api/events/:id`, `POST /api/checkout/initiate` (full) or `POST /api/installments/start` (bits) |
| `tables.html` | public | `GET /api/events`, `GET /api/events/:id`, `POST /api/table-checkout/initiate` |
| `private.html` ("Book an event") | public | `GET /api/calendar`, `POST /api/private-requests` |
| `installment.html` (`/pay`) | public | `GET /api/installments/lookup?phone=|code=`, `POST /api/installments/topup` |
| `payment-return.html` | public | `POST /api/checkout/verify`, `GET /api/checkout/status` |
| `ticket.html` | ticket holder | `GET /api/tickets/:token` |
| `verify.html` | anyone with the QR | `GET /api/verify/:token` |
| `visit.html` | public | settings only |
| `login.html` | staff | Firebase Auth (email + password) |
| `admin.html` (`admin.js`) | CMS/MONEY/superAdmin | `/api/admin/*` (see matrix) |
| `organiser.html` | organiser | `GET /api/admin/organiser/overview` |
| `checkin.html` (`/door`) | door roles | `GET /api/door/events`, `POST /api/checkin` |

## Worker routes and who may call them

Role groups (`worker/src/lib/auth.js`): **CMS** = superAdmin, manager, eventManager.
**MONEY** = superAdmin, manager. **DOOR** = all five roles (organiser limited to own nights).
Staff routes need a Firebase ID token verified against Google's keys (issuer + audience = project).

| Route | Auth | Notes |
|---|---|---|
| `GET /api/events`, `/api/events/:id`, `/api/settings`, `/api/calendar` | none | Only public + active nights |
| `POST /api/checkout/initiate`, `/api/table-checkout/initiate`, `/api/installments/start`, `/api/installments/topup` | none, rate-limited | Server prices everything; `callbackUrl` must be an allowed origin |
| `GET /api/installments/lookup` | none, strict rate limit | **Returns ticket tokens for completed plans (finding A1)** |
| `POST /api/checkout/verify`, `GET /api/checkout/status` | none | By Paystack reference (`MEM-<ms>-<8 hex>`) |
| `GET /api/tickets/:token`, `/api/verify/:token` | token is the credential | ~244-bit random token (`worker/src/lib/util.js`) |
| `POST /api/private-requests` | none, strict rate limit | |
| `POST /api/paystack/webhook` | HMAC-SHA512 signature | Re-verifies with Paystack before fulfilling |
| `POST /api/checkin`, `GET /api/door/events` | DOOR | Organiser: own nights only |
| `POST /api/send-sms`, `GET /api/balance` | MONEY | Pass-through to the SMS worker |
| `GET /api/admin/me` | any staff | |
| `GET/POST /api/admin/events`, catalog (ticket-types, table-packages, bottles), orders, comps, requests, raffles, draw | CMS | |
| `DELETE /api/admin/events/:id` | superAdmin | Only if nothing sold |
| `GET /api/admin/installments`, `POST .../resend-sms`, `GET/POST /api/admin/settings` | MONEY | |
| `GET /api/admin/staff`, `POST /api/admin/set-role` | superAdmin | Can't demote yourself; audited |
| `GET /api/admin/organiser/overview` | organiser, superAdmin | Own nights only |

## States

**Paystack checkout** (`pending_checkouts/{reference}`): `pending` → `issued` | `failed`.
Kinds: `ticket`, `table`, `installment_topup`. `failed` with `refundStatus: 'manual_required'`
when stock ran out after payment. Amount and currency are checked against Paystack's verify call.

**Ticket** (`tickets/{token}`): `valid` → `used` (check-in, once, in a transaction). Flags
`revoked`, `cancelled`, `comp`. Document id = bearer token.

**Pay-in-bits plan** (`installment_plans/{code}`): `active` → `completed` (ticket issued) |
`forfeited` (daily cron after the night; paid amount kept, per BUILD_PLAN) | `sold_out` (paid in
full but stock gone; manual refund). Overpayment kept on the plan, never a second ticket.

**Table order**: `confirmed` once paid. **Event request**: `NEW` → `ACCEPTED` | `DECLINED`.
**Raffle**: `open` → `closed` → `drawn`; entries `eligible` / `won`.

## Known gaps at baseline (fixed or tracked in Phase 1)

1. Installment lookup returns ticket tokens (by phone or order code).
2. Order codes are 2 letters + 4 digits (~5.8 million values).
3. Door page offers "Any night"; headcount is per device.
4. `callbackUrl` comes from the browser (validated against an allow-list, not ignored).
5. Every page has an inline module script, so the CSP needs `'unsafe-inline'`; `connect-src`
   allows all of `*.workers.dev`; event images may be any https URL.
6. Money parsing `pes()` accepts garbage; phone check duplicated in three pages.
7. Remembered buyer details can't be cleared.
8. The Brevo API key is in git history (commits `5730d76`, `c016b4c`, `32ede69`, `037f127`).
   Must be revoked in Brevo; history can't be un-published.
9. No CI; tests only run locally.

## Performance check (phone, local dev server)

Measured with Playwright at 390px (fonts blocked offline, so real pages add the Google Fonts CSS
+ woff2). Lighthouse was not run in this environment.

| Page | Requests | Transfer before → after the logo change | Script | CSS |
|---|---|---|---|---|
| Home | 14 | 263 KB → 166 KB | 19 KB | 32 KB |
| Nights | 14 | 176 KB → 140 KB | 18 KB | 32 KB |
| Event | 12 | 148 KB → 77 KB | 24 KB | 32 KB |
| Checkout | 13 | 115 KB → 87 KB | 34 KB | 32 KB |
| Tables | 11 | 150 KB → 71 KB | 25 KB | 32 KB |
| Ticket | 11 | 148 KB → 77 KB | 27 KB | 32 KB |

- No page makes the same API call twice; settings are fetched once per page and shared.
- The 44 KB, 2083 px PNG logo was loaded on every page to show at 93 px. Now: `logo-sm.webp`
  (320 px, 8 KB) for header/footer/login/staff, `logo.webp` (1200 px, 26 KB) for the homepage
  hero and the share image. `logo.png` is kept for other uses.
- Flyers load lazily except the one above the fold; the 130 KB QR scanner (`jsQR`) loads only on
  the door page when the camera starts. Fonts already use `display=swap`.
- The rest of the weight is the flyers themselves (uploaded images are resized to 1600 px WebP
  in the control room).
