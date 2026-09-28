# Open decisions (owner)

Business rules the code must not guess. Each has a proposed default. Until the owner answers,
**the current behaviour stays**; where a default is built, it sits behind one named constant.

| # | Decision | Current behaviour | Proposed default | Where it lives |
|---|---|---|---|---|
| 1 | Do unpaid pay-in-bits plans get forfeited? | **Yes.** BUILD_PLAN: "Decided: an unfinished payment plan is forfeited… the amount already paid is kept… no refund." Daily cron marks them `forfeited` after the night. | Keep as decided unless the owner changes it. An external review proposed "no forfeit; staff settle or refund". Owner to confirm either way. | `forfeitStalePlans`, `worker/src/checkout.js` |
| 2 | Final pay-in-bits cutoff | Top-ups accepted until the night starts | 18:00 Africa/Accra on the event date | not built; needs #1 |
| 3 | Acknowledgement tick box for pay-in-bits | **Built** for the current rule: required tick box, version + time stored on the plan | Reword if #1 changes | `BITS_ACK_TEXT`, `BITS_POLICY_VERSION` in `public/lib/shared.js` |
| 4 | When does "tonight" end at the door? | n/a | 04:00 Africa/Accra next day (built) | `NIGHT_ROLLOVER_HOUR` in `public/lib/shared.js` |
| 5 | Re-entry | A second scan says ALREADY CHECKED IN | Allowed, audited, doesn't change headcount | not built |
| 6 | Undo an admission | Not possible | 2 min for door staff; managers any time; audited | not built |
| 7 | Settle a balance at the door | Not possible | Cash or MoMo, manager/superAdmin only, note required | not built |
| 8 | Reminder texts before the cutoff | Balance text after each payment only | 48h, 24h, 6h before cutoff | not built |
| 9 | Customers writing their own ticket line | Allowed, 40 characters, no filter | Keep; add a word filter, or staff approval | `LINE_MAX`, `worker/src/checkout.js` |
| 10 | Offline admits at the door | Never admits offline | Keep: show "No connection", admit by search once back | `public/pages/checkin.js` |
| 11 | Door QR vs ticket link | The ticket URL is the only credential (QR = verify link with the same token) | Keep for launch; later consider a short-lived door code shown on the ticket page | see SECURITY_AUDIT A3 |
| 12 | Raffle framing (Ghana lottery law) | Admin warning shown | Owner to confirm with the club | `admin.js` draw card |
| 13 | Privacy notice, terms, refund policy | None | Owner supplies text; launch requirement since the site collects names, phones, emails | footer links once text exists |
| 14 | "Private night" vs "Book an event" | **Owner decided: "Book an event"** (Corporate, Event organiser, Large group, Other) | Keep | `public/private.html` |
| 15 | Make the GitHub repo private | Public | Private | GitHub settings (owner) |

## Owner-only actions (not code)

- Revoke the Brevo API key in Brevo (it is in git history).
- Replace the Firebase service-account key in Google Cloud (it was shared in a zip).
- Lock the `memories-sms` Worker (turn off workers.dev or require `SMS_WORKER_KEY`).
- Restrict the Firebase browser API key to the production domains in Google Cloud.
- Turn off public sign-up in Firebase Authentication.
- Confirm the live Worker's deployment date and that `PUBLIC_SITE_URL` is set.
