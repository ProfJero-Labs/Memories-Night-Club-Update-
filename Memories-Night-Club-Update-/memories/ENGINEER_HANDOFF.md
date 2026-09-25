# Memories Night Club — Engineer Handoff

## What this repository is

This is the complete new-interface build foundation for Memories using:

- Static public UI
- Firebase Firestore as system of record
- Firebase Authentication for staff
- Cloudflare Worker as the trusted API/cloud layer
- Paystack for payments
- Brevo for email

The public interface is intended to replace the current public interface rather than receive a superficial CSS refresh.

## Preserve from the existing production system

Preserve working production data and proven payment logic where possible:
- Firestore events/ticket types
- pending_checkouts
- Paystack webhook flow
- payment verification
- idempotent ticket issuance
- ticket token model
- existing assets

## Replace/rebuild

- homepage
- event archive
- event detail
- ticket selection
- identity-line interaction
- checkout presentation
- ticket presentation/share artifact
- tables UX
- private-night UX
- raffle UX
- staff/admin UI
- mobile experience

## Cloudflare rule

Do not introduce Firebase Cloud Functions unless there is a specific requirement. The engineer's secure server layer is Cloudflare Workers. Firestore remains the database.

## Production warning

Do not deploy this over production without first mapping the actual production Firestore schema and testing against a staging project. The repository intentionally uses placeholders for Firebase, Paystack, Brevo and Cloudflare configuration.
