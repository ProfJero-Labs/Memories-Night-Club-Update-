# Deployment

## 1. Firebase

Create/confirm the Firebase project and enable:
- Firestore
- Authentication (Email/Password for staff)
- Storage

Create a service account with only the permissions needed to read/write the Firestore database used by the Worker.

## 2. Cloudflare Worker

From `worker/`:

```bash
npm install
npx wrangler login
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler secret put PAYSTACK_SECRET_KEY
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put BREVO_SENDER_EMAIL
npx wrangler secret put BREVO_SENDER_NAME
npx wrangler deploy
```

Set the variables in `worker/wrangler.toml`:
- FIREBASE_PROJECT_ID
- ALLOWED_ORIGINS
- PUBLIC_SITE_URL

## 3. Frontend

Edit `public/config.js` with the public Firebase web configuration and Worker URL. Never put a service-account JSON, Paystack secret or Brevo secret in this file.

The public folder can be deployed with Cloudflare Pages or another static host. The Worker remains the API layer.

## 4. Paystack

Configure the webhook to:

`https://YOUR-WORKER/api/paystack/webhook`

Use the same callback origin configured in `ALLOWED_ORIGINS`.

## 5. Brevo

Use the Worker secret. Rotate any Brevo credential that was previously exposed in frontend code.

## 6. Staff roles

Create Firebase Auth users and set custom claims outside the public client. Supported roles:
- superAdmin
- manager
- eventManager
- doorStaff

## 7. Staging checklist

- successful ticket payment
- failed payment
- duplicate webhook
- amount mismatch
- sold-out ticket race
- table purchase
- table inventory race
- ticket QR/token verification
- simultaneous check-in
- raffle entry duplication
- raffle draw
- private request
- staff role restrictions
- mobile layout at 320/360/390/430px
