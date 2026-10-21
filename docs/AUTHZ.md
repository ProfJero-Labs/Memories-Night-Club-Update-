# Staff API authorization

One row per staff route. ✅ = allowed, — = 403. Every route also returns 401 with no token, a bad token, a token from another Firebase project, or an account with no staff role. Each row is a test in `worker/test/authz-matrix.test.js` (run `npm test`). Roles are Firebase custom claims set only by a superAdmin through `/api/admin/set-role`; nobody can change their own role, and every change is written to `audit_logs`.

| Route | superAdmin | manager | eventManager | doorStaff | organiser |
|---|---|---|---|---|---|
| `POST /api/members/door/request-code`, `/confirm` (verify staff and members at the gate: the code appears in their app; there is no QR route) | ✅ | ✅ | ✅ | ✅ | — |
| `GET /api/admin/members`, `POST /api/admin/members`, `POST /api/admin/members/activation`, `POST /api/admin/members/delete`, `GET /api/admin/attendance` | ✅ | ✅ | — | — | — |
| `POST /api/members/my-pass`, `GET /api/members/my-gate` (a staff member's own pass and gate code; 404 if their account has no membership) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /api/admin/promos`, `POST /api/admin/promos` (ticket promos per night) | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/system` | ✅ | ✅ | — | — | — |
| `GET /api/bar/queue`, `POST /api/bar/order`, `POST /api/bar/station-open` | ✅ | ✅ | ✅ | — (barStaff ✅) | — |
| `GET /api/admin/bar-setup`, `POST /api/admin/bar-stations`, `POST /api/admin/menu-items` | ✅ | ✅ | ✅ | — | — |
| `POST /api/checkin` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/checkin` with `table` (seat a table booking) | ✅ | ✅ | ✅ | ✅ | own nights |
| `POST /api/checkin/undo` | ✅ any time | ✅ any time | own admits, 2 min | own admits, 2 min | own admits, 2 min |
| `GET /api/door/events` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /api/door/summary` | ✅ | ✅ | ✅ | ✅ | own nights |
| `GET /api/door/search` | ✅ | ✅ | ✅ | ✅ | own nights |
| `POST /api/send-sms` | ✅ | ✅ | — | — | — |
| `GET /api/balance` | ✅ | ✅ | — | — | — |
| `POST /api/admin/sms/send` | ✅ | ✅ | — | — | — |
| `GET /api/admin/sms/balance` | ✅ | ✅ | — | — | — |
| `GET /api/admin/me` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /api/admin/overview` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/events` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/events/:id` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/events` | ✅ | ✅ | ✅ | — | — |
| `DELETE /api/admin/events/:id` | ✅ | — | — | — | — |
| `POST /api/admin/ticket-types` | ✅ | ✅ | ✅ | — | — |
| `DELETE /api/admin/ticket-types/:id` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/table-packages` | ✅ | ✅ | ✅ | — | — |
| `DELETE /api/admin/table-packages/:id` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/bottles` | ✅ | ✅ | ✅ | — | — |
| `DELETE /api/admin/bottles/:id` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/bottles` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/orders` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/comps` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/raffles` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/raffle/draw` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/requests` | ✅ | ✅ | ✅ | — | — |
| `POST /api/admin/requests/:id` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/installments` | ✅ | ✅ | — | — | — |
| `GET /api/admin/refunds` | ✅ | ✅ | — | — | — |
| `POST /api/admin/refunds/mark` | ✅ | ✅ | — | — | — |
| `POST /api/admin/installments/resend-sms` | ✅ | ✅ | — | — | — |
| `GET /api/admin/settings` | ✅ | ✅ | — | — | — |
| `POST /api/admin/settings` | ✅ | ✅ | — | — | — |
| `GET /api/admin/organisers` | ✅ | ✅ | ✅ | — | — |
| `GET /api/admin/staff` | ✅ | — | — | — | — |
| `POST /api/admin/set-role` | ✅ | — | — | — | — |
| `GET /api/admin/organiser/overview` | ✅ | — | — | — | ✅ |

Scoping inside allowed routes: an organiser can check in only tickets for nights where they are the organiser, and sees only their own nights in `/api/door/events` and `/api/admin/organiser/overview` (tested). Public routes (events, checkout, pay-in-bits, tickets by token, webhook) are listed in `AUDIT.md`.

**barStaff** (role added with scan to order) can use the bar routes above and nothing else; they sign in straight to `bar.html`.

Public (no sign-in, rate limited): `POST /api/checkout/quote` (the exact price with any promo; a typed promo code gets a strict limit, as it does on `/api/checkout/initiate` and `/api/installments/start`), `POST /api/members/activate` (a one-time activation code a manager showed the member; strict rate limit), `POST /api/members/pass-status` (authenticated by a fresh pass QR), `GET /api/guest/menu`, `POST /api/guest/counter/checkout`, `GET /api/guest/counter/:orderId` (the random order id is the guest's key), `GET /api/guest/receipt/:code`, `POST /api/installments/phone-code` and `/phone-verify`.

**Director and waitress roles.** `director` has exactly the manager's access in every row above (it is in the Worker's `CMS`, `MONEY` and `DOOR` lists and in the Firestore/Storage `staff()` rule). `waitStaff` (waitresses and waiters) has only the bar routes, like `barStaff`. Neither can manage staff: that stays superAdmin only. `POST /api/admin/members/delete` is manager/director/superAdmin only.

## Venue operations (staff sign-in by PIN, tabs, bar, stock, cash, closing)

The role on the staff record (`users/{uid}`) is checked on every request, so a job change or a
removal applies at once. Each row is covered by `worker/test/staffauth.test.js` or
`worker/test/ops-night.test.js`.

| Route | Who |
|---|---|
| `POST /api/staff-auth/sign-in`, `/send-pin` | Public, rate limited per address and per phone; PIN lockout after 5 and 10 wrong; a texted PIN lasts 30 minutes and never replaces the old one until used |
| `GET /api/ops/me`, `POST /api/ops/change-pin` | Any staff (their own) |
| `GET/POST /api/admin/people`, `/people/add`, `/update`, `/reset-pin`, `/send-pins`, `/remove` | System admin, director, manager. Managers can't give or change director, manager, finance or admin; directors can't make admins; nobody changes their own job |
| `POST /api/ops/tabs/open`, `/round`, `/round-action`, `/close`, `/text-bill` | Waiters (their own tabs), manager, director, admin |
| `POST /api/ops/tabs/cash`, `/tabs/pay` | Cashier, waiters, bartenders, manager, director, admin, and staff marked "can collect cash" |
| `GET /api/ops/bar/rounds`, `POST /api/ops/bar/round` | Bartender, manager, director, admin |
| `GET /api/ops/products` | Waiters, bar, cashier, finance, managers (costs only for manager, director, finance, admin) |
| `POST /api/ops/products` (selling price and cost price, both required) | Finance, admin |
| `POST /api/ops/products/available`, `/stock/transfer`, `/stock/waste`, `/stock/count` | Bartender, manager, director, finance, admin |
| `POST /api/ops/stock/received` | Finance, director, admin: a purchase, in stock at once. Manager: waits for the bar to confirm. Bartender: waits for finance or a manager |
| `GET /api/ops/stock/deliveries`, `POST /api/ops/stock/delivery` (confirm or refuse) | Bartender, manager, director, finance, admin; never your own; the bar's needs finance or a manager |
| `GET /api/ops/stock/to-explain` | Manager, director, finance, admin. `POST /api/ops/stock/explain`: manager, director, admin |
| `POST /api/ops/quick-sale` | Waiters; from the bar (`fromBar`): bartender, manager, director, admin |
| `GET /api/ops/money`, `/payments`, `/budget` | Manager, director, finance, admin |
| `POST /api/ops/expenses`, `/expenses/remove` | Manager, director, finance, admin (taking one off: finance, director, admin, or whoever added it) |
| `POST /api/ops/budget`, `/bills`, `/bills/pay`, `/bills/remove`, `/bills/copy` | Finance, admin |
| `GET /api/guest/counter-night/:orderId` | A QR customer: everything paid tonight from the phone that paid that order |
| `POST /api/ops/stock/review`, `GET /api/ops/changes` | Manager, director, finance, admin (not your own count) |
| `POST /api/ops/cash/open`, `/move`, `/close`, `GET /api/ops/cash` | Whoever takes cash (their own shift); refunds and payouts become approvals |
| `POST /api/ops/cash/review`, `GET /api/ops/cash/all` | Manager, director, finance, admin (not your own) |
| `POST /api/ops/approvals/request` | Depends on the kind (waiters ask for free drinks, discounts, write-offs) |
| `POST /api/ops/approvals/decide` | Free drink, discount: manager, director, admin. Write-off, cash out: also finance. Count correction: manager, director, finance, admin. Never your own request |
| `GET /api/ops/sales`, `/closing`, `/eod`, `/eod/list`, `/finance-contact` | Manager, director, finance, admin |
| `POST /api/ops/close-night` | Manager, director, admin |
| `POST /api/ops/eod/sign-off` | Finance, director, admin; not the person who closed the night |
| `GET/POST /api/ops/tables`, `/incidents`, `/front-report` | Front office, security (no report), managers; waiters and bar see tables and tick bottles served |
| `GET /api/guest/bill/:token`, `POST /api/guest/bill/:token/pay` | The customer's bill link: read and pay only; prices from the Worker |

## Who sees what (from October 2026)

| Area | Who | Routes |
|---|---|---|
| The site: nights, tickets, promos, draws, bar setup, comps, event requests, uploads | System admin, events manager | `/api/admin/events…`, `/ticket-types`, `/table-packages`, `/bottles`, `/comps`, `/raffles`, `/requests`, `/promos`, `/bar/setup`; Storage uploads |
| Site settings, system health | System admin | `/api/admin/settings`, `/api/admin/system` |
| Ticket money (read) | System admin, events manager (not the director) | `/api/admin/overview`, `/orders`, `/payments`, `/events` (list), `/settlements` (list) |
| Money: refunds, pay in bits, SMS, members, attendance, organiser settlements | System admin, director | `/api/admin/refunds…`, `/installments…`, `/sms…`, `/members…`, `/attendance`, `/settlements` |
| The night: sales, tables, approvals, closing, drinks & prices, stock, staff | System admin, director, manager (finance for reports and stock) | `/api/ops/*`, `/api/admin/people*` |

