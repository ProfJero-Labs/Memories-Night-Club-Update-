# Memories Night Club — New Interface / Firebase + Cloudflare

This is a new public-facing interface and a Cloudflare-first secure API layer designed to sit on top of the existing Memories Firebase/Firestore data model.

## Architecture

- **Public UI:** static HTML/CSS/ES modules, deployable to Cloudflare Pages or any static host.
- **Cloud/API:** Cloudflare Worker.
- **Database:** existing Firebase Firestore.
- **Authentication:** Firebase Authentication for staff/admin.
- **Payments:** Paystack through the Worker only.
- **Email:** Brevo through the Worker only.
- **Media:** Firebase Storage can remain the source of existing assets.

## Important

This is a rebuild foundation, not a blind production replacement. Before deployment, the engineer must map the existing production Firestore documents and migrate/alias fields where necessary.

### Required Cloudflare secrets

```bash
cd worker
npm install
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put BREVO_SENDER_EMAIL
npx wrangler secret put BREVO_SENDER_NAME
```

`FIREBASE_SERVICE_ACCOUNT_JSON` is the full service-account JSON for the Firebase project. Do not commit it.

### Worker configuration

Edit `worker/wrangler.toml`:

- `FIREBASE_PROJECT_ID`
- `ALLOWED_ORIGINS`
- `PUBLIC_SITE_URL`

### Frontend configuration

Edit `public/config.js` with the public Firebase web configuration and Cloudflare Worker URL. Only public Firebase web configuration belongs here. Never put service-account credentials, Paystack secret keys, Brevo keys or SMS secrets here.

### Paystack webhook

Set the Paystack webhook URL to:

`https://YOUR-WORKER.workers.dev/api/paystack/webhook`

The Worker validates the Paystack signature, independently verifies the transaction, and then issues/fulfils the order idempotently.

### Existing data

The Worker currently understands the existing-style collections:

- `events`
- `ticket_types`
- `pending_checkouts`
- `tickets`
- `table_packages`
- `raffles`
- `raffle_entries`
- `orders`
- `checkins`
- `private_event_requests`

Field names must be checked against the production project before launch.

## Public pages

- `index.html` — event-first homepage
- `nights.html` — poster-style event archive
- `event.html` — event experience + ticket/identity selection
- `checkout.html` — ticket checkout
- `table.html` / `tables.html` — table discovery and checkout
- `private.html` — private night request
- `payment-return.html` — payment confirmation
- `ticket.html` — secure ticket display
- `verify.html` — door verification
- `login.html` — staff login
- `admin.html` — operations overview

## UX direction

The interface is intentionally a new product experience, not a CSS refresh of the old pages. It is built around:

**EVENT ARTWORK → NIGHT → IDENTITY → TICKET → PAYMENT → ENTRY**

The visual system uses a restrained dark base, Memories crimson, warm paper tones, condensed display typography, editorial poster layouts and a tactile ticket language.

## Production checklist

1. Rotate the previously exposed Brevo key.
2. Configure Worker secrets.
3. Confirm Firebase service account has only the required project permissions.
4. Review Firestore rules.
5. Map current event/ticket fields to the new API.
6. Configure Paystack webhook.
7. Test successful and failed payments.
8. Test duplicate webhook delivery.
9. Test sold-out race conditions.
10. Test table concurrency.
11. Test QR verification and duplicate check-in.
12. Test raffle eligibility and server-side draw.
13. Test staff roles and Firebase Auth custom claims.
14. Test mobile layouts at 320/360/390/430px.
15. Run a production build and visual QA before launch.
