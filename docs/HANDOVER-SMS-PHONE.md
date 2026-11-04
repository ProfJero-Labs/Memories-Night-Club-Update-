# Handover: where the payment work stands, and the SMS phone (next build)

Written 2 November 2026 at the end of a working session, so the next session (and the engineer)
can pick up exactly here. Branch: `claude/gracious-carson-pfyozr`. Nothing on this branch is live
until the Worker is deployed (`npm run worker:deploy`) and the branch is merged.

## Done on this branch (all tested: 334 Worker tests, 58 browser tests passing)

1. **Nights close when the club closes.** No 4AM rule: a night stays open until the Manager or a
   director closes it (`loadNight`, `config/night` in `worker/src/ops/common.js`).
2. **Staff fixes from the first live weekend:** tabs close without tapping "I got them" on every
   order; empty tabs close; drink search (spelling-tolerant) in every staff drink list; stock value
   report (at cost and selling price); cash recorded the moment it's paid; cash with each staff
   member on Tonight; clearing old tabs can record cash the waiter took; QR "Pay cash"; directors'
   "Every sale" list (tap any figure); Paystack's OTP typed by the customer on their own bill link.
3. **Payment rules (owner's decision, November 2026).** See `docs/PAYMENTS-FINANCE.md`.
   - Cash: any amount, no charge.
   - Paystack up to GHS 300: 5% charge, customer pays all of it.
   - GHS 300.01 to 2,000: 5% split 50/50 customer/venue, customer pays at least GHS 15.
   - Above GHS 2,000: no Paystack anywhere (waiter close, bill link, QR menu). Only cash, or MoMo to
     the partner's merchant wallet **0595986313, Samuel Forson / Memories Night Club**, plus a flat
     GHS 100 the customer pays, owed to EvolveIT.
   - The whole bill decides the route. Charge after discounts, never on tips.
   - Paystack split: partner's subaccount **ACCT_89qd3ub03w61erk** gets everything but the charge;
     EvolveIT's account keeps the 5% (plus its 10% ticket/table share) and bears Paystack's fee.
   - Refunds: customer gets everything back; Paystack keeps its fee; the venue bears it.
   - Every number is a director setting; each payment keeps a copy of its rule.
   - **Switched OFF** until a director turns it on (More → Service charge & commission → New payment
     rules). Turning it on needs the subaccount code (already known, above).
4. **MoMo to the wallet** (`worker/src/ops/wallet.js`): waiter / bill link / QR menu start it; the
   bill waits; a manager confirms on Tonight → "MoMo to confirm" (amount + MoMo transaction ID, once
   ever; short refused unless accepted with a reason). Confirmed GHS 100s go to `evolveit_charges`.
   "Paystack is down tonight" switch for directors. "MoMo to the club's number" removed for staff
   when the rules are on.
5. **Due to EvolveIT** (`worker/src/ops/evolveit.js`): directors only. Day by day, over 10 days in
   red; a director may tick off what the partner paid (oldest first, mismatch flagged). EvolveIT
   figures are hidden from the Manager and finance everywhere.
6. **Whoever serves takes the cash.** QR "Pay cash" orders show on the waitress's My tables (Cash
   received → her cash; the bar makes it as her order) and on the bar screen (served at once).

Owner decisions also recorded: one venue; tickets stay online; table bookings will become
reservations with no payment (arrival time; held one hour; no action on no-shows; paid bookings
honoured; big-table commission based on what the table actually spends) — **not built yet**.
Daily MoMo statement upload: **dropped** (too hard to get the statement).

## Before switching the rules on

1. Deploy the Worker, then merge the branch.
2. A few-cedi real test of each route: Paystack (check the split reached the partner's subaccount
   in the Paystack dashboard), cash, and MoMo to the wallet (manager confirms).
3. Show waitresses "QR orders paying cash" and managers "MoMo to confirm".

## Next build: the SMS phone (confirms wallet payments automatically)

**How it works.** The business phone holds the wallet SIM (0595986313) and runs a small Android app.
When a "money received" SMS arrives, the app sends it, signed, to the Worker. The Worker reads
amount, payer number and name, transaction ID and new balance, and matches a waiting wallet
payment: same amount (bill + charge) → then reference code → then payer number.
- One clear match and the checks pass → confirmed automatically (same as a manager confirming).
- Two waiting with the same amount, or anything unclear → shown on "MoMo to confirm" with the
  details filled in; the manager picks.
- Manager's manual confirm stays as the fallback.

**Protection without a statement:** only the network's real sender name; only the paired phone,
messages signed; **balance check** (previous balance + amount = new balance, else flagged, never
auto-confirmed); transaction ID once ever; every raw SMS stored so readers can be fixed and texts
re-read; "Phone offline" on Tonight when the phone hasn't checked in for a few minutes.

**Build order**
1. Worker side, fully testable without a phone: pair a phone with a 6-digit code (manager screen),
   per-phone secret, signed message endpoint, raw SMS store (`momo_messages`), one reader per
   network (MTN, Telecel, AirtelTigo), matching, auto-confirm through the existing `confirmWallet`,
   duplicate SMS ignored, "Phone offline", a "Send a test text" box for managers.
2. Android app (Kotlin): listens for incoming SMS, queues when offline and sends in order, pairing
   screen, "Send test" button. APK built by GitHub Actions; installed on the business phone with
   "Install unknown apps" (Google Play doesn't allow SMS-reading apps of this kind).

**Still needed from the owner before the readers can be finished**
1. 5–10 real "money received" SMS from the wallet phone (payments from MTN, Telecel and
   AirtelTigo numbers), names and numbers replaced with X.
2. The SMS sender name (e.g. "MobileMoney").
3. The business phone: Android version; wallet SIM in it; stays at the club during opening hours.
4. Yes/no: confirm automatically on one clear match with the balance adding up (recommended), or
   only pre-fill for a manager to tap.

## Owner's direction (2–4 Nov 2026): automate; split the jobs; directors are informed

- **The Manager isn't diligent.** Nothing important may depend on him alone; the system does it
  automatically, and anything he does by hand is reported without him being able to stop it.
- **The directors are busy.** They're informed automatically and can open any figure, sale,
  payment or record themselves, any time, without asking anyone. They act only on big things.
- **Finance is never at the club.** Finance handles the money away from the club: reviews and
  signs off each night, chases shortfalls, approves the "To approve" items up to a limit.
- **At the club: the Manager and the Human manager** (one or both is always there) handle what
  happens on the night, e.g. confirming MoMo by hand when the SMS phone can't.
- **There are no free drinks and no write-offs** at the club: switch those options off for staff
  (and the "Ask the manager" free-drink / write-off requests), so they can't be used to hide sales.
  (Discounts weren't mentioned: ask the owner.)

| On the night / after | Who acts, what's automatic | Directors |
|---|---|---|
| MoMo to the wallet | The SMS phone confirms automatically. By hand only when the phone is offline or the match is unclear: **the Manager or the Human manager** (add `hrManager` to the confirmers, and the MoMo-to-confirm list to the Human manager's screen). A short payment: accepted only with a reason. Every hand confirm is recorded with who did it. | Every hand confirm and short payment in the morning text. |
| Wallet payment waiting too long | After 20 minutes: text **the Manager and the Human manager**. | Still waiting after an hour: text the directors. |
| Closing the night | If still open with no sales for 3 hours after 5AM, the system closes it and sends the report (owner to confirm). | In the morning text. |
| End-of-day report (used to depend on the Manager closing) | **Finance's morning summary** (text + screen) every day regardless: sales, cash, MoMo, Paystack, shortfalls, cash not handed in (named), tabs left open by waiter, stock missing by bar and drink, hand-confirmed MoMo. Finance signs it off. | **Directors' morning text**: the headline figures, plus anything finance hasn't signed off by midday. |
| Staff cash | Short or not handed in by morning: named for finance to chase; the Manager's own received cash checked the same way. | In the morning text. |
| Stock differences | Missing stock and its value go to finance to chase. | In the morning text. |
| "To approve" (salaries, loans, bills, purchases, commissions, big expenses) | **Finance** approves up to a set amount, never what finance itself recorded or paid; above it, a director. (Owner to confirm.) | Everything finance approved is listed for them. |

Owner to decide: auto-close yes/no; morning text time and phones (finance + directors); the limit
up to which finance approves "To approve" items; whether discounts stay. Unchanged: **Due to
EvolveIT stays directors only**.

## Later (agreed, not started)

- Table bookings → reservations without payment (see owner decisions above).
- MTN's own Collection API may replace the SMS phone for MTN payments; the wallet code is the place
  to plug it in (it only needs "this transaction arrived").
