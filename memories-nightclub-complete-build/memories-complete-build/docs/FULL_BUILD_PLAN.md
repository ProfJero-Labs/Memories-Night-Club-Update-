# Memories Night Club — Full Build Plan

This repository is the complete Firebase + Cloudflare implementation foundation for the redesigned Memories public and staff experience.

## Architecture

- Public UI: static HTML/CSS/ES modules in `public/`.
- Secure API: Cloudflare Worker in `worker/`.
- Data: existing Firebase Firestore.
- Staff authentication: Firebase Authentication.
- Payment: Paystack through Cloudflare Worker only.
- Email: Brevo through Cloudflare Worker only.
- Assets: Firebase Storage or existing asset URLs.

## Build phases represented in this repository

1. Audit/integration: map production collections and fields.
2. Design system: shared Memories visual language.
3. Public experience: home, nights, event, ticketing.
4. Ticketing/payment: Paystack, webhook, idempotency, secure tickets.
5. Tables/bottles: package selection, inventory, payment.
6. Raffle: entry, eligibility, server-side draw, winner.
7. Check-in: QR/token verification and atomic check-in.
8. Private Night: request workflow.
9. Admin: overview, events, ticket types, tables, raffle, requests, check-in.
10. Security hardening: secrets, role checks, validation, audit log.
11. Migration: preserve existing production records.
12. QA and deployment.

## Important deployment principle

Do not replace the existing production Firebase data blindly. Deploy the Worker and public interface against a staging project first, map existing documents, run payment/webhook tests, and only then promote.
