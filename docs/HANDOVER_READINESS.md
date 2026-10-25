# Handover readiness audit (25 October 2026)

Is the system ready to hand over to the club this week? Checked: the code on `main` (4fb5a93), every
doc in `docs/`, the open pull requests, the GitHub Actions runs on `main`, and all test suites run
again from scratch. Not checked: the live database and the Cloudflare, Firebase and Paystack
dashboards (they can't be reached from where this audit ran). Anything that depends on them is
marked **verify live**.

## Verdict

**The software is in good shape, but the system isn't ready to hand over yet.** All 296 Worker
tests pass, the browser journeys and the database-rules tests pass in CI, and the security work is
thorough. What's missing is around the software, not in it:

1. The waiters' trial data (the open tabs) is still live, and the tool that clears it isn't merged.
2. Automatic deploys of the Worker have failed on every merge, so the live API may be behind `main`.
3. Several accounts (Worker host, Paystack, GitHub, Cloudflare) sit with the developers, and who owns
   what after handover isn't written down.
4. The owner security actions from September are still open on paper.
5. The site takes payments and collects phone numbers with no privacy notice, terms or refund policy.

Each of these can be done in two or three days. Section 1 is the order to do them in.

---

## 1. Blockers: do these before handing over

### 1.1 Trial data: the waiters' open tabs

**What's there.** Nights before 24 Oct 2026 were practice. Their tabs, rounds, cash shifts, tips and
approvals are in the live database, and every tab that's still `open` shows on the waiter's
*My tables* screen no matter how old it is (`myTabs` lists all open tabs, any night, in
`worker/src/ops/tabs.js`). Closing a night doesn't close its tabs: *Every tab closed* is a checklist
step, not a lock (`worker/src/ops/closing.js`), so old tabs never go away on their own.

**The fix exists but isn't live.** [PR #36](https://github.com/ProfJero-Labs/Memories-Night-Club-Update-/pull/36)
adds a one-time *Waiters' trial nights* reset (preview, then confirm, super admin only). Its tests
pass. It's still open, and once merged the Worker still has to be deployed by hand (see 1.2).

**Gaps found in PR #36, and what was done** (the first three are fixed on the PR):

| Gap | Effect | Done |
|---|---|---|
| Only role `waitStaff` was cleared. Managers, the event manager, directors and the bar (quick sales) also open tabs. | Tabs a manager or bartender opened during practice stayed open. | **Fixed:** every tab from before 24 Oct goes, whoever opened it. Tips on those tabs go too (owed tips stay). |
| Staff removed through the old *set role → none* path have `role: ''`. | Their practice tabs and cash shifts weren't found. | **Fixed:** tabs by night; waiters also recognised from their old cash shifts and reports. |
| Practice tabs closed as *owed* were kept with no way to clear them. | Made-up "customers" stayed on the Manager's *what's owed* list. | **Fixed:** the preview lists them (night, tab, customer, waiter, amount); the admin ticks the practice ones. Unticked ones stay. |
| Deletes are permanent. | No undo. | **Warned** on the card: export the database first. |
| Stock moves and the payment ledger are kept. | Bar stock is still reduced by the practice drinks. | **Kept on purpose** (the ledger is real money). The card says to recount the bar's stock afterwards. |
| Tabs still open from **24 Oct onward** aren't touched. | If a real night left tabs open, they stay. | **By design.** Close them the normal way: take payment, or a write-off (manager or finance approves). |

**Also check for other trial data the reset doesn't cover** (verify live): test nights and ticket
types on the public site, test orders and tickets, test members, test staff accounts (the dev
logins are only in `dev/seed.mjs` and never reach production, but trial accounts made on the live
site would), placeholder drinks and prices on the bar menu, and the site settings (phone, email,
map link).

### 1.2 The Worker isn't deploying

The last five CI runs on `main` (#32 to #35) all ended red. On the latest one the tests pass and
the **Deploy Worker (Cloudflare)** job fails with *"it's necessary to set a CLOUDFLARE_API_TOKEN environment variable"*. The GitHub
environment `production` has no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` (DEPLOYMENT.md §8).
Separately, Cloudflare's own *Workers Builds: memories-paystack-verify* check fails on every PR
(its log is only in the Cloudflare dashboard; NIGHT-AUDIT.md says the Root directory must be
`worker`).

Meanwhile the **site** (Cloudflare Pages) deploys on every push. So the live pages may call Worker
routes the live Worker doesn't have yet (the service charge, payment ledger, stock fixes, drink
delete from #33–#35). Pages then say *"needs the latest Worker"*, or a payment screen shows a
different total from what's charged.

**Do:** add the two secrets to the `production` environment (or fix Workers Builds and remove the
CI deploy job, so there's one path, not two), deploy, then confirm in Cloudflare that the live
Worker's version matches `main`. **Verify live.**

### 1.3 Who owns what after handover

| Thing | Where it is now | Decide |
|---|---|---|
| Worker (the whole API) | `memories-paystack-verify.diamondj04102026.workers.dev`: a personal Cloudflare account's subdomain, hard-coded in `public/config.js`, the Paystack webhook and the CSP | Move to the club's Cloudflare account and a club domain (e.g. `api.memoriesnightclub.com`), or document that the developers host it |
| SMS worker | `memories-sms.diamondj04102026.workers.dev`, not in this repo | Same; it also needs locking (1.4) |
| Paystack | All payments land in **EvolveIT's** Paystack account; EvolveIT pays the club its share out of band (`worker/src/shares.js`) | Confirm the club agreed in writing, or switch to the club's own Paystack account |
| Firebase project `memoriesnightclub-2717f` | Unknown who's owner | Make the club an Owner in Google Cloud IAM |
| GitHub repo | `ProfJero-Labs` org, **public** | Make it private (OPEN_DECISIONS #15); decide if the club gets access |
| Cloudflare Pages, Brevo, Sentry, domain | Not visible from here | List the login for each, and who holds it |
| Super admin account | Not visible from here | The club's owner should hold super admin. A developer account should be removed or downgraded at handover |

**Money to the developers, for the club to see clearly before handover:**
- The *EvolveIT share* on tickets: **10%** in `wrangler.toml`, but the code falls back to **20%** if
  that variable is ever missing (`EVOLVEIT_DEFAULT_PCT` in `worker/src/shares.js`). Make them match.
- The *developer commission* on Paystack payments (`worker/src/lib/fee.js`): off until a director
  or the admin sets it.
- The 5% customer service charge (capped at GHS 100) on every online payment.
- "Platform designed & built by EvolveIT" on every page and "Ticketing by EvolveIT" on every ticket.

### 1.4 Security actions that only the account holders can do

From OPEN_DECISIONS.md and SECURITY_AUDIT.md, none is ticked off. **Verify live** and tick each:

- [ ] Revoke the old Brevo API key (it's in git history, commits `5730d76`, `c016b4c`, `32ede69`, `037f127`).
- [ ] Replace the Firebase service-account key (it was shared in a zip).
- [ ] Lock the `memories-sms` Worker (turn off workers.dev, or require `SMS_WORKER_KEY`). Right now anyone with its URL can send texts as MEMORIES.
- [ ] Restrict the Firebase browser API key to the production domains.
- [ ] Turn off public sign-up in Firebase Authentication.
- [ ] Paystack on **live** keys; webhook URL set.
- [ ] Make the GitHub repo private.
- [ ] Remove developers' and testers' staff accounts that the club won't use.

**One code fix (done, ships with the next Worker deploy):** `ALLOWED_ORIGINS` in
`worker/wrangler.toml` listed `http://localhost:5500` and `http://127.0.0.1:5500`, though
SECURITY_AUDIT.md said they were removed, so any page served on that port of someone's own computer
could call the live API. They're removed.

### 1.5 Privacy notice, terms and refund policy

OPEN_DECISIONS #13: none exist. The site collects names, phones and emails, takes payments, charges
a service fee, and forfeits unfinished pay-in-bits plans with no refund. Ghana's Data Protection Act
expects a privacy notice. The club supplies the text; the footer links then take an hour.

---

## 2. Should do before handover

- **Stop tabs carrying over.** After the reset, the same thing can happen again from real nights.
  Suggest: a *Tabs from earlier nights* list for the Manager, and the close step warns in red when
  tabs from the night are still open.
- **Owner decisions still open** (OPEN_DECISIONS.md): #1 forfeit pay-in-bits (decided, but the club
  should confirm), #2 cutoff, #5 re-entry, #6 undo admission, #7 settle balance at the door, #8
  reminder texts, #9 ticket-line word filter, #12 raffle framing under Ghana lottery law, #16 link
  previews. Take the list to the handover meeting.
- **Repo housekeeping:** 9 Dependabot PRs open (two major: `firebase` 13, `@firebase/rules-unit-testing`
  6); an old `master` branch next to `main`; merged `claude/*` branches.
- **Stale docs:** NIGHT-AUDIT.md says nothing reaches the live site until the Cloudflare build is
  fixed (still true, see 1.2); SECURITY_AUDIT.md's CORS line was wrong until the 1.4 fix.

## 3. Known gaps to tell the club about (not blockers)

Open P1 items from STAFF-UX-FIXES.md and ux-debt.md, so the club hears them from you, not on a
busy night:

- The door needs mobile data; it never admits offline (B3, owner decision #10).
- A rush can sell tickets past capacity and refund after payment (ux-debt #17).
- Organisers can't see a guest list or their earnings (E1, E2).
- Putting a night on sale takes 11 steps; a new night starts hidden (G1).
- No walk-in sales at the door, no guest list the door can fill, no capacity warning (B7–B9).
- One role per person (A10).

## 4. What's in good shape

- **Tests:** 296/296 Worker tests pass (payments, idempotency, roles, door races, logging, CSP,
  no committed secrets). All 55 browser journeys pass (re-run for this audit), and the Firestore/Storage rules tests pass in CI on `main`.
- **Security:** XSS, token leaks, authorisation (34 routes × every wrong role), payment replay,
  check-in races, rate limits and the rules are all covered by tests (SECURITY_AUDIT.md).
- **No test data ships in the code:** dev logins, seed nights and fake Paystack live only in `dev/`.
  The only built-in contact is the WhatsApp number `0249050086` in `worker/src/public.js`; confirm
  it's the club's.
- **Docs:** OPERATIONS.md is a plain-words staff guide that can be used for training.

## 5. Handover checklist

1. PR #36's gaps are fixed (1.1). Export Firestore, merge, deploy, run the preview, tick the practice
   debts with the club, then clear.
2. Close or write off any open tabs from 24 Oct onward; recount bar stock.
3. Fix the Worker deploy; confirm the live version matches `main`.
4. Deploy the Worker so the `localhost:5500` removal takes effect (the code change is done).
5. Owner security actions (1.4), each ticked with a date.
6. Ownership table (1.3) agreed and signed; super admin moved to the club.
7. Privacy, terms and refund pages live.
8. Smoke test on production (DEPLOYMENT.md §9): one real low-price ticket, SMS, door scan twice,
   order under Bookings, and one tab opened, paid by MoMo and closed.
9. Handover meeting: walk the club through sections 2 and 3.
