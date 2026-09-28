# How Memories works

**Firebase** (Firestore, Auth, Storage) holds the data. **One Cloudflare Worker** (`worker/`) runs every piece of server logic. The **static site** (`public/`) is plain HTML/CSS/ES modules with no build step.

```
guest phone ──► public/*.html ──► Worker /api/* ──► Firestore (REST, service account)
                                     │   ├─► Paystack (initialize / verify, secret key)
                                     │   ├─► SMS worker (service binding)
                                     │   └─► Brevo (email)
Paystack ──► Worker /api/paystack/webhook (HMAC-SHA512 signed)
staff ──► login.html (Firebase Auth) ──► admin / organiser / checkin ──► Worker /api/admin/*  (ID token + role claim)
                                     └─► Firebase Storage event-art/ (flyer uploads, staff only)
```

Rules that hold everywhere:
- The browser never writes Firestore. `firebase/firestore.rules` denies every client write, including for admins.
- The browser never sets a price and never decides that a payment succeeded. The Worker computes every amount from Firestore and confirms every charge with Paystack's verify API before it issues anything.
- Issuing a ticket, a table, a raffle spot or a check-in happens inside a Firestore transaction that is retried on contention. Every issue is idempotent per Paystack reference.

## Code map

| Path | What |
|---|---|
| `worker/src/index.js` | Router: every route, and the role each one requires |
| `worker/src/public.js` | Events, calendar, settings, private-night requests, public ticket view |
| `worker/src/checkout.js` | Tickets, tables, pay in bits (installments), Paystack verify and fulfilment |
| `worker/src/raffle.js` | Draw spots, admin raffle edits, the draw |
| `worker/src/door.js` | Check-in (needs a chosen night; by token or, from search, by display code), headcount summary, door search, public verify |
| `worker/src/admin.js` | Control room: nights, catalog, comps, orders, requests, installments, settings, staff, organiser view |
| `worker/src/lib/*` | Firestore REST + transactions, auth, HTTP/CORS/rate limits (per IP or per phone/code), SMS/email, redacting logger (`log.js`), helpers |
| `public/lib/shared.js` | One copy of `esc`, `normalizePhone`, `pes`, and Africa/Accra dates (`accraDayKey`, `nightKey`), imported by pages and bundled into the Worker |
| `public/pages/*.js` | Each page's script (no inline scripts, so the CSP can forbid them) |
| `public/app.js` | Shared public-page code: API client, header/footer from settings, dates, states, remembered buyer details (clearable) |
| `public/ticket-art.js` | The ticket layout (live preview and real ticket) and the 1080×1080 share image |
| `public/staff.js`, `admin.js`, `admin.css` | Staff pages |
| `firebase/*.rules` | Firestore and Storage rules |
| `dev/` | Local run: dev server, seed data, end-to-end tests, screenshot tools |

## Roles

Roles are Firebase Auth custom claims (`role`, plus `admin: true` for super admins). Only `/api/admin/set-role` (super admin) or `scripts/set-role.mjs` can set them.

| Can… | superAdmin | manager | eventManager | doorStaff | organiser |
|---|:-:|:-:|:-:|:-:|:-:|
| Check in at the door | ✓ | ✓ | ✓ | ✓ | own nights only |
| Nights, lines, tickets, tables, bar, draw, comps, bookings, private nights | ✓ | ✓ | ✓ | | |
| Site settings, pay-in-bits orders, SMS | ✓ | ✓ | | | |
| Staff roles, delete a night | ✓ | | | | |
| Organiser dashboard (own nights: sales, owed, check-ins, draw) | ✓ | | | | ✓ |

## Data (Firestore)

| Collection | Written by | Notes |
|---|---|---|
| `events` | admin | `name, date (ISO, Ghana = UTC), doors, venue, description, artwork, heroImage, ticketLines[≤12], visibility, active, soldOut, featured, organiserId` |
| `ticket_types` | admin | `eventId, name, pricePesewas, admits, remaining (null = unlimited), active, sortOrder` |
| `table_packages` | admin | Same shape plus `capacity`. New nights are seeded with Table 2,000 / Floor Table 3,500 / Birthday Table 4,500 (BUILD_PLAN), all editable |
| `bottles` | admin | `eventId: 'all'` for the bar menu on every night |
| `pending_checkouts/{reference}` | Worker | One per Paystack charge; `status: pending → issued/failed` makes fulfilment idempotent |
| `orders` | Worker | `kind: ticket / table / comp`, amounts, buyer contact, `inDraw` |
| `tickets/{token}` | Worker | The document id is the bearer token (≈244 random bits) the QR's verify URL carries. `phoneLast4` (never the full number) for door search |
| `installment_plans/{MEM-XXXXX-XXXXX}` | Worker | Pay in bits: total, paid, payments[] keyed by reference, chosen line, status `active / completed / forfeited / sold_out`. Codes: 10 Crockford Base32 chars (older `MEM-AB1234` codes still work). The public lookup never returns ticket ids; paid tickets go by SMS (`/api/installments/find`, `/resend-link`). |
| `raffles/evt_{eventId}` | admin + Worker | `prize, cap (default 20), spotsTaken, status open/closed/drawn`, winner *display* name/code only |
| `raffle_entries` | Worker | One per spot: `ticketId, orderId, status eligible/won` |
| `checkins` | Worker | One per admitted ticket |
| `private_event_requests` | guest (via Worker), admin | `eventType, date, guests, name, phone, instagram, message, status NEW/ACCEPTED/DECLINED, note (staff only)` |
| `settings/site` | admin | Venue, phone, WhatsApp, email, Instagram, map, hero image, default lines, closed dates |
| `users/{uid}` | Worker | Mirror of staff roles, for the Staff screen |
| `audit_logs` | Worker | Every admin write, role change, comp, draw (`raffleId, eventId, drawnAt, drawnBy, eligibleEntryCount, winningTicketId`) |

## Money flows

**Ticket.** `checkout.html` → `POST /api/checkout/initiate` (price from `ticket_types`, the line must be one of the night's lines, callback URL must be on the allowlist) → Paystack → `payment-return.html` polls `POST /api/checkout/verify` while Paystack also calls the webhook. Whichever arrives first verifies with Paystack and issues the ticket in a transaction. That transaction also takes a draw spot if the draw is open and not full. The other arrival sees `issued` and returns the same tickets.

**Pay in bits.** `POST /api/installments/start` creates the order (`MEM-AB1234`) with the server price and the chosen line, then charges the first amount (GHS 10 or more). Each top-up is a normal charge recorded by reference. Before the balance reaches zero there is no ticket, no share image, no draw spot and no stock held. The payment that completes it issues the ticket and takes a draw spot in one transaction. Every top-up sends one text with the amount, the balance, the order code and the link. A daily cron forfeits orders still unpaid when the night starts.

**Tables.** Package plus bottles, priced by the Worker from Firestore and paid in full. Stock is re-checked inside the fulfilment transaction.
