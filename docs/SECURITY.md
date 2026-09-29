# Security controls and the tests that prove them

| Control | Where | Test |
|---|---|---|
| Browsers can't write any business data (even admins) | `firebase/firestore.rules` | `firebase/test/rules.test.js`: "nobody writes business data…" |
| Tickets never read from a browser (not even by token); guests open them through the Worker | rules + `GET /api/tickets/:token` returns first name only | rules test: "no browser can open…"; `acceptance`: "public ticket shows a first name only" |
| Ticket links on the payment page need the buyer's claim, not just the Paystack reference (which staff, receipts and every ticket of the order carry); a pay-in-bits helper never gets the ticket | `claimedTokens`, `checkoutStatus` (`X-Checkout-Claim`), `/api/checkout/verify` returns the outcome only | `ticket-links` |
| The draw winner's ticket code never reaches a public page (the door can admit by code); only the winner's own ticket says it won | `eventBundle`, `publicTicket`, raffles readable by staff only | `ticket-links`; rules test: "public reads…" |
| Guest contact data never readable from a browser | rules | rules test: "guest contact details…" |
| Flyer uploads: staff only, images only, < 8 MB | `firebase/storage.rules` | rules test: "flyer uploads…" |
| No public sign-up; a signed-in account without a role gets nothing | Auth setting + `verifyStaff` | `acceptance`: "a brand-new signup…"; e2e: "no-role account is refused" |
| Every staff route checks the role | `worker/src/index.js`, `admin.js` | `acceptance`: logged-out 401s, door staff, organiser 403s |
| Organiser isolation (read + door) | `organiserOverview`, `checkin` | `acceptance` + e2e: "organiser A…" |
| Server sets price, ignores browser amounts | `checkout.js` | `security-webhook`: client price ignored; `acceptance`: tables |
| Guest can't write their own ticket text | line must be in the night's list | `acceptance`: "a guest cannot put their own words…" |
| Callback URL allowlist | `allowedOrigin` | `security-webhook` |
| Webhook signature (HMAC-SHA512) | `index.js` | `security-webhook`: forged / missing / valid |
| Paystack verify before issuing, amount + currency match | `confirmCharge` | `last-ticket`, `installment-race` |
| One reference counts once (webhook + page, retries) | `pending_checkouts` status in a transaction | `acceptance`: duplicate reference; `notifications`: no duplicate SMS |
| Draw cap holds under simultaneous payments; partial and comp orders stay out | `raffle.js` in the issuing transaction | `raffle-spot-race`, `acceptance`: order 20/21, partial, comps |
| Draw runs server-side, once, audited; winner token never public | `drawRaffle` | `raffle-draw` |
| Atomic check-in; second scan refused | `door.js` | `checkin`, `retry-cap`, e2e door |
| Unguessable ticket tokens; verify endpoint throttled | `ticketToken`, rate limits | `security-misc`, `acceptance`: enumeration |
| Share image carries no QR (a posted QR is a stolen ticket) | `ticket-art.js` | by construction; e2e renders it |
| Guest/admin text escaped everywhere (pages and staff emails) | `esc()` | e2e XSS on public + admin pages; `acceptance`: email escaping |
| Rate limits on checkout, verify, lookup, private requests, SMS, check-in, draw | `lib/http.js` + `wrangler.toml` | `new-admin-routes`: limiter |
| CSP and security headers | `public/_headers` | e2e runs every page under the production CSP |
| No secrets in the browser | `public/config.js` holds only public Firebase config | secrets are Worker secrets (`docs/DEPLOYMENT.md`) |

## Known, outside the code
- The old Brevo key is in git history until it is revoked in Brevo.
- The SMS worker stays publicly callable until its public route is turned off or it checks `SMS_WORKER_KEY` (`docs/DEPLOYMENT.md` step 4).
- Ticket links are bearer credentials. Anyone who has the link can open the ticket. The QR works once at the door.
