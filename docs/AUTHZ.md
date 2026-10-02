# Staff API authorization

One row per staff route. ✅ = allowed, — = 403. Every route also returns 401 with no token, a bad token, a token from another Firebase project, or an account with no staff role. Each row is a test in `worker/test/authz-matrix.test.js` (run `npm test`). Roles are Firebase custom claims set only by a superAdmin through `/api/admin/set-role`; nobody can change their own role, and every change is written to `audit_logs`.

| Route | superAdmin | manager | eventManager | doorStaff | organiser |
|---|---|---|---|---|---|
| `POST /api/members/door/pass`, `/request-code`, `/confirm` (verify staff and members at the gate; the code appears in the member's app) | ✅ | ✅ | ✅ | ✅ | — |
| `GET /api/admin/members`, `POST /api/admin/members`, `POST /api/admin/members/activation`, `GET /api/admin/attendance` | ✅ | ✅ | — | — | — |
| `POST /api/members/my-pass`, `GET /api/members/my-gate` (a staff member's own pass and gate code; 404 if their account has no membership) | ✅ | ✅ | ✅ | ✅ | ✅ |
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

Public (no sign-in, rate limited): `POST /api/members/activate` (a one-time activation code a manager showed the member; strict rate limit), `POST /api/members/pass-status` (authenticated by a fresh pass QR), `GET /api/guest/menu`, `POST /api/guest/counter/checkout`, `GET /api/guest/counter/:orderId` (the random order id is the guest's key), `GET /api/guest/receipt/:code`, `POST /api/installments/phone-code` and `/phone-verify`.
