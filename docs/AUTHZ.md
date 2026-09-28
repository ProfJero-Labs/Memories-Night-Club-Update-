# Staff API authorization

One row per staff route. ✅ = allowed, — = 403. Every route also returns 401 with no token, a bad token, a token from another Firebase project, or an account with no staff role. Each row is a test in `worker/test/authz-matrix.test.js` (run `npm test`). Roles are Firebase custom claims set only by a superAdmin through `/api/admin/set-role`; nobody can change their own role, and every change is written to `audit_logs`.

| Route | superAdmin | manager | eventManager | doorStaff | organiser |
|---|---|---|---|---|---|
| `POST /api/checkin` | ✅ | ✅ | ✅ | ✅ | ✅ |
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
