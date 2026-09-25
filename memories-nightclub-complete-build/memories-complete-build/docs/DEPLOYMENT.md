# Going live

Do these in order. Steps marked **(club)** need a decision or an account only the club has.

## 1. Before anything else

1. **(club) Revoke the old Brevo key.** It was published in the old site's JavaScript and is still in git history. Removing it from the files doesn't make it safe. In Brevo, create a new key and delete the old one.
2. **(club) Swap Paystack to live keys** once testing is done. The secret key goes into the Worker (step 3); the site itself never needs a Paystack key.

## 2. Firebase

```bash
npm i -g firebase-tools && firebase login
firebase use memoriesnightclub-2717f
firebase deploy --only firestore:rules,storage      # from this folder (firebase.json is here)
gsutil cors set firebase/storage-cors.json gs://memoriesnightclub-2717f.firebasestorage.app
```

- **Turn off public sign-up:** Firebase Console → Authentication → Settings → User actions → untick *Enable create (sign-up)*. Staff accounts are then created only in the console.
- The CORS rule lets the ticket page draw the flyer into the share image. Without it, the image is still made, just without the faded flyer.
- **Map the production data first.** The Worker expects the fields listed in `docs/ARCHITECTURE.md`. Check-in accepts any existing ticket id, so old tickets scan too, as long as their documents use `status: 'valid' / 'used'` (and `revoked`/`cancelled` flags). Confirm that on real ticket documents. Old events need `visibility: 'public'`, `active: true`, and prices in `pricePesewas` on `ticket_types`. Check this against a copy of production before switching the site over.

## 3. The Worker

```bash
cd worker && npm install
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON   # whole service-account JSON (Firestore + Identity Toolkit access)
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put BREVO_API_KEY                   # the NEW key
npx wrangler secret put BREVO_SENDER_EMAIL
npx wrangler secret put BREVO_SENDER_NAME               # optional
npx wrangler secret put SMS_WORKER_KEY                  # optional, see step 4
npm run check    # dry-run bundle + config validation
npm run deploy
```

`wrangler.toml` deploys to the name `memories-paystack-verify`, the host the site's `public/config.js → apiBase` already points at. Check `ALLOWED_ORIGINS` and `PUBLIC_SITE_URL` against the real domain. Checkout callback URLs are only accepted from those origins.

Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:
`https://memories-paystack-verify.diamondj04102026.workers.dev/api/paystack/webhook`

Edge rate limits (`RL_STRICT` 10/min, `RL_STANDARD` 60/min per IP and route) come with the deploy. For extra protection, add a Cloudflare WAF rate-limiting rule on `/api/*` in the dashboard.

## 4. Lock the SMS worker

The API reaches the SMS worker through a Cloudflare **service binding** (`[[services]] SMS → memories-sms`). That traffic never touches the public internet. Once the new API is live, **(club)** do one of these on the `memories-sms` worker:
- turn off its `workers.dev` route (Settings → Domains & Routes), so only the binding can reach it; **or**
- make it reject any request whose `X-Memories-Key` header doesn't match a secret, and set the same value as `SMS_WORKER_KEY` here.

Until then the SMS worker is still callable by anyone who knows its URL. That URL was published in the old site.

## 5. The site (Cloudflare Pages)

Deploy `public/` as a Pages project (no build command, output directory `public`). `_headers` sets the security headers and Content-Security-Policy; `_redirects` gives short URLs (`/nights`, `/tables`, `/private`, `/visit`, `/door`, `/pay`).

## 6. First staff

1. Console → Authentication → Add user (email + password) for the owner.
2. From a trusted machine: `node scripts/set-role.mjs ./service-account.json owner@example.com superAdmin`
3. Sign in at `/login.html`. Add everyone else under **Staff** in the control room (their accounts are created in the console first).

## 7. (club) Fill in what only the club knows

In the control room → **Site settings**: the one public phone number, WhatsApp, email, map link. The old site showed three different numbers, so confirm which is right before entering it. Then per night: flyer, the 8–12 lines, ticket prices, table prices, and on **Bar menu** the real bottles and prices. Nothing placeholder ships: blank settings just don't show, and a night without lines sells tickets that lead with the night's name.

Before the first prize of real value, confirm the draw's framing with the club (BUILD_PLAN: Ghana lottery law).

## 8. Smoke test on production

Buy one real low-price ticket end to end, then check:
- the SMS arrives;
- the ticket page opens and its QR checks in once at `/door`;
- a second scan says already checked in;
- the order shows under Bookings.
