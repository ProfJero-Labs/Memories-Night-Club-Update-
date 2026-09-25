# ⚠️ Archived — not the current app

This folder is an earlier version of the Memories Night Club site, superseded by the app in
[`memories-nightclub-complete-build/memories-complete-build/`](../memories-nightclub-complete-build/memories-complete-build/)
(see the [repository root README](../README.md)).

It's kept for reference only:

- No Cloudflare Worker / server-authoritative API layer — `script.js` writes to Firestore
  directly from the browser for flows (raffle entry, ticket issuance) that the canonical app now
  routes through a Worker with transactional writes, Paystack signature verification, and
  Firestore Security Rules that deny the equivalent direct client writes.
- No automated test suite.
- No installment/partial-payment support, no organiser view, no admin private-request or
  settings management.

**Do not develop against this folder.** If you're looking for the live product, its Worker API,
its Firestore rules, or its test suite, they're all in the canonical app directory linked above.
