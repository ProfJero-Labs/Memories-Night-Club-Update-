# Monitoring and automatic recovery

Goal: if something breaks at 1am, the money is protected automatically, the right person is
told within minutes, and a fix is waiting in the morning. Nothing here changes a price, issues a
refund, or edits code on its own.

| Layer | What it catches | Who fixes it |
|---|---|---|
| Reconciliation job (`worker/src/reconcile.js`) | Paid but no ticket (missed webhook, closed tab, brief outage) | The job, automatically |
| Reconciliation alerts | Paid but cannot be fulfilled (sold out after payment, amount mismatch, no record) | A human, by SMS |
| Heartbeat | The reconciliation job itself stopping | A human, phone call |
| Uptime monitor | Site or API down, Firestore or Paystack unreachable | A human, phone call |
| Sentry | Crashes and unexpected errors in the Worker and in guests' browsers | A human, with the cause already identified |
| Direct SMS on payment-route errors | Payment failures even if nobody is watching Sentry | A human, within seconds |
| Security alerts | Forged payment notices, someone guessing staff sign-ins or member gate codes, scripted floods | A human, by SMS, at most once an hour per kind |
| Dependabot + CI audit | Known vulnerabilities in the code's dependencies | A human merges the update pull request |
| System panel (control room → Tonight → System) | Whether the payment check is running, what was alerted, what isn't set up | A manager, at a glance |

## 1. The reconciliation job (built, in this change)

Every 10 minutes (`*/10 * * * *`) the Worker:

1. Finds checkouts still `pending` after 3 minutes (up to 72 hours old) and runs the normal
   `fulfill()` on them. `fulfill()` asks Paystack whether the charge succeeded and is idempotent per
   reference, so it cannot double-issue. Older ones are retried once an hour, not every run.
2. Lists successful Paystack payments from the last 6 hours and checks each has an issued order.
   Anything paid but not issued sends an SMS once (deduped through the `recon_alerts` collection).
3. Pings the heartbeat URL, only after a clean run.

Secrets to set (`cd worker`):

```bash
npx wrangler secret put ALERT_PHONES     # comma separated, e.g. 0244xxxxxx,0200xxxxxx
npx wrangler secret put HEALTH_KEY       # any long random string
npx wrangler secret put HEARTBEAT_URL    # from step 3 below
npx wrangler secret put ALERT_EMAIL      # optional, uses the existing Brevo setup
npx wrangler secret put SENTRY_DSN       # from step 4; leave unset to keep Sentry off
npm test && npm run deploy
```

Note: `paid_no_record` alerts fire for any successful Paystack payment whose reference starts with
`MEM-` but has no checkout record. If the old site shared this Paystack account and used the same
prefix, expect a few of those in the first hours. Check each once, then they stay quiet.

## 2. Uptime monitor (Better Stack or UptimeRobot, both have free tiers)

Create three monitors, 1 minute interval, alert by phone call or SMS, not email alone:

1. `https://memoriesnightclub.com` expects 200.
2. `https://memories-paystack-verify.diamondj04102026.workers.dev/api/events` expects 200. This
   exercises the Worker and Firestore through a real public route.
3. `https://memories-paystack-verify.diamondj04102026.workers.dev/api/health` with the header
   `x-health-key: <HEALTH_KEY>` expects 200. This also proves Firestore and Paystack are reachable.
   Without the header it only proves the Worker is up.

Alert on two consecutive failures so one blip does not wake anyone.

## 3. Heartbeat (the "who watches the watcher" check)

In Better Stack create a **Heartbeat** monitor: expected every 10 minutes, grace 5 minutes. It gives a
URL. Save that as `HEARTBEAT_URL` (step 1). If the reconciliation job stops, errors out, or Cloudflare
cron stops firing, the pings stop and the monitor calls you. Sentry's cron monitoring is an
alternative.

## 4. Sentry (applied in this change, switched on by one secret)

Code is in place and does nothing until `SENTRY_DSN` is set, so it ships safely first.

1. Create a free Sentry project, platform Cloudflare Workers. Copy the DSN.
2. `cd worker && npx wrangler secret put SENTRY_DSN`, then `npm run deploy`.
3. In Sentry, create two alert rules for the project: "a new issue is created" and "an issue is seen
   more than 5 times in 10 minutes". Send both to email and to the Sentry mobile app with push on.

What is wired:

- `src/index.js` wraps the handler with `Sentry.withSentry`, only when a DSN exists.
- Every unexpected error caught by the router goes to Sentry, tagged `where` (route group, never the
  full path) and `critical`.
- A failure on a payment route (`/api/checkout`, `/api/table-checkout`, `/api/installments`,
  `/api/paystack`) also texts `ALERT_PHONES`, at most once per 15 minutes per route. The text names the
  route and time, never the cause, so it carries no personal data.
- Reconciliation and cron errors are reported. Failed ticket SMS sends are reported as warnings.
- Guests' browsers report real script errors through `public/lib/report.js` to `/api/client-error`,
  which forwards them to Sentry. First party, so the Content-Security-Policy is unchanged. It skips
  network failures, browser extensions and API errors, caps at 3 per page load, and never sends the
  query string (ticket and order links carry secrets there).
- `compatibility_flags = ["nodejs_als"]` is the only runtime flag added. It is narrower than
  `nodejs_compat` on purpose. `[version_metadata]` tags each error with the deployed version.

Privacy: `scrubEvent` in `src/lib/monitor.js` runs on every event before it leaves. It deletes the
request (URLs hold ticket tokens), user, extras and breadcrumbs, and redacts messages and transaction
names with the same `redact` used for logs. `test/monitor-sentry.test.js` captures the real Sentry
envelope and fails if a token, phone number or key appears in it.

## 4b. Security alerts (built)

`securitySignal` in `src/lib/monitor.js` texts `ALERT_PHONES` (once an hour per kind, never with an IP,
phone or token in it) when:

| Signal | When |
|---|---|
| `webhook_forged` | A Paystack notice arrives with a bad signature. It is always ignored; this tells you someone tried. |
| `staff_denied` | 15 refused staff requests (bad or missing sign-in, wrong role) from one address in 10 minutes. |
| `member_code_guessing` | 10 wrong member gate codes from one address in 10 minutes. |
| `rate_limited` | One address hits the rate limits 60 times in 10 minutes. |

Counts are per Worker instance, so they are floors, not exact totals. Each signal also goes to Sentry as
a warning. Alerts are listed in the control room under Tonight → System, with the last payment check
(flagged if it hasn't run for 30 minutes).

## 4c. Vulnerable dependencies (built)

- `.github/dependabot.yml` checks the Worker's npm packages weekly and the CI actions monthly, and
  opens a pull request for each update. In GitHub → Settings → Code security, turn on **Dependabot
  alerts** and **Dependabot security updates** so you're emailed the day a vulnerability is published.
- CI runs `npm audit --omit=dev --audit-level=high` on every push: a known high or critical
  vulnerability turns the build red. (On the first run it caught a high-severity `undici` issue in
  the deploy tool; `npm audit fix` updated it.)

## 5. AI fixer (later, after 1 to 4 have been quiet for a few weeks)

Claude Code can run in GitHub Actions: when a Sentry issue is created, a workflow opens a pull
request with the diagnosis and a proposed fix. Rules that should stay in place:

- It opens a pull request only. It never pushes to `main`.
- CI must pass (`npm test`) before anyone can merge.
- Any change under `worker/src/checkout.js` or `worker/src/reconcile.js` needs a human to read the
  plain-language summary first.

## 6. Prove it works before relying on it

Do these once in Paystack test mode, then once more in live mode with a GHS 1 payment.

1. **Missed webhook drill.** Temporarily set the Paystack webhook URL to a wrong address. Pay, close
   the tab before the return page loads. Within about 13 minutes the ticket SMS should arrive and the
   owner should get "fixed automatically". Restore the webhook URL.
2. **Dead job drill.** Remove the `*/10` cron (or unset the heartbeat ping) for 20 minutes. The
   heartbeat monitor should call you. Restore it.
3. **Site down drill.** Point monitor 3 at a wrong key header. It should go red. Restore it.
4. **Error drill.** Once `SENTRY_DSN` is set, in test mode temporarily set a wrong `PAYSTACK_SECRET_KEY`
   and start a checkout. You should get one SMS within seconds and a new issue in Sentry. Restore the
   key straight after. A normal 404 will not trigger this, only a real server error does.

If a drill does not alert, the setup is not finished.
