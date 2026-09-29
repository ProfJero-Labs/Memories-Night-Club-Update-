# Brief: give ticket buying its own page, and make Pay in bits open-ended (Memories public site)

**Repo:** `ProfJero-Labs/Memories-Night-Club-Update-`. `main` deploys to memoriesnightclub.com.
**Branch:** `ux/tickets-page`. If your environment assigns a branch name, use that one and say so in the report. Never push to `main`, never merge, never force-push. Leave the branch for review.
**Principle:** one tap, one page, one job.

---

## 0. Decisions (settled 2026-09-28)

| | Decision |
|---|---|
| **D1** | Base on **`origin/ProfJero-patch-2`** |
| **D2** | **(a)**: the line becomes optional on the server |
| **D3** | Pay in bits takes **any amount** above GHS 0 |

The reasoning follows, so a reviewer can check it. **First step, before any code:** confirm which Worker production uses (`apiBase` in the live `config.js`, and whether `/api/installments/start` without `acknowledged` returns *"Tick the box…"*). Put the answer in the report. If production runs a Worker that is *older* than patch-2, stop and report; these decisions assume patch-2's API.

### D1. Which `public/` is the base?

`origin/main` and `origin/ProfJero-patch-2` (the branch with the Worker) have **different public sites**:

| | `main` | `ProfJero-patch-2` |
|---|---|---|
| Page scripts | Inline `<script type="module">` in each HTML file | Split out into `public/pages/*.js`, plus `public/lib/shared.js` (shared with the Worker) |
| CSP `script-src` | Includes `'unsafe-inline'` | **No** `'unsafe-inline'`, so inline scripts are blocked |
| Pay in bits | Sends no `acknowledged` | Has a checkbox and sends `acknowledged: true` |
| Private night | Birthday / Corporate / Concert / … | "Book an event", which the owner already chose (`docs/OPEN_DECISIONS.md` #14) |
| Extras | none | `_redirects` (`/nights`, `/tables`, `/pay`…), webp logos, og image |

The patch-2 Worker's `/api/installments/start` rejects any request without `acknowledged: true`. **So if that Worker is the one in production, Pay in bits on `main` is already broken.** Confirm which Worker is live before anything else.

**Decided: base `ux/tickets-page` on `origin/ProfJero-patch-2`.** Put new page logic in `public/pages/tickets.js`, never in an inline script. Why:

1. **It matches the API.** The Worker only exists on patch-2, and its public site is the one written against it (it sends `acknowledged`, uses `lib/shared.js` for phone and money rules, and knows the ticket styles). Building on `main` means copying those fixes back by hand and still drifting.
2. **It's the newer, reviewed work.** Its last commit is 2026-09-28. `main`'s `public/` is a manual upload from 2026-09-23, and the owner's "Book an event" decision is only on patch-2.
3. **It's safer.** Its CSP blocks inline scripts. Building this feature on `main` would add more inline code that has to be moved out later anyway.
4. **The cost:** merging this branch into `main` also brings in all of patch-2's `public/` and `worker/`. That's a bigger review, but it has to happen anyway for `main` to match its API. Say so plainly in the PR description, and list the changes that come from patch-2 separately from this feature's changes.

`main` is rejected because it keeps the broken Pay in bits call and the inline scripts, and it forks the site away from the Worker.

### D2. The ticket line is required by the server

`worker/src/checkout.js`, `ticketContext()`, is used by both `/api/checkout/initiate` and `/api/installments/start`:

```js
if (lines.length && !identityLine) return { error: 'Pick a line or write your own.' };
```

When a night has lines (its own `ticketLines`, or `settings.defaultLines` as a fallback, which covers almost every night), **the server rejects an empty line**, so "Add a line (optional)" can't work on the client alone.

**Decided: (a), the line becomes optional on the server.** In `ticketContext()`, remove the `if (lines.length && !identityLine)` check; an empty line is stored as `''`. Why:

1. **It's the brief's own principle.** "One tap, one page, one job" and "no required creative step" can't both hold if the server insists on a line.
2. **Nothing breaks without a line.** The ticket and the share image already show the night's name in large type when there's no line (`ticket-art.js`: `t.line || t.eventName`), and comp tickets are already issued with `identityLine: ''` (`worker/src/admin.js`), so the door and ticket pages handle it today.
3. **It costs almost nothing.** It's a single check removed, plus tests: *empty line accepted when the night has lines*, and *a chosen night line and a custom line are still stored exactly as before*.
4. **It keeps what's good about the feature.** The line stays offered on checkout, easy to reach, and the live preview on desktop still shows it. Buyers who want it add it; others aren't blocked.

Rejected: **(b)**, which keeps it required on the same page (it still gates payment on a creative choice), and **a default line**, which would print words on someone's ticket that they never chose.

**Order:** this goes in the same Worker PR as §4.7 and is deployed before the public changes. Until then, the public checkout shows the server's "Pick a line or write your own." next to the line field and opens its `<details>`, so nobody gets stuck.

### D3. Pay in bits: no minimum (owner decision, settled)

**Any amount above GHS 0 is allowed**, for the first payment and for every top-up. The only upper limit is the balance left. Paystack's own minimum transaction amount (check Paystack's docs for GHS; don't guess it) is the only floor, and if Paystack refuses an amount, its message is shown to the buyer. This takes Worker changes, which §4.7 lists; they are part of this work.

---

## 1. Facts already established (don't re-derive them; spot-check if something looks different)

- `GET /api/checkout/status` returns `status, kind, eventId, eventName, packageName, amountPesewas, bottles, tickets[{token}], error` (plus plan fields for top-ups). There is **no ticket type id and no quantity**, so "Try again" can only go to `tickets.html?event={id}`.
- `GET /api/events/{id}` returns `event, lines, ticketTypes[{id,name,pricePesewas,admits,description,sortOrder,soldOut,lastFew…}], tablePackages, bottles, raffle`.
- The server allows quantity 1 to 6, a deposit no larger than the total, and lines of up to 40 characters (`LINE_MAX`). **Today** it also enforces a GHS 10 minimum (`MIN_TOPUP_PESEWAS` in `worker/src/checkout.js`, checked in `startInstallment` and `topupInstallment`), and the client repeats it in `checkout` (`amt >= 1000`, `min="10"`, the copy "Start with GHS 10 or more") and in `installment` (`Math.min(1000, left)`). D3 removes all of it.
- Money inputs use `step="1"`, which blocks amounts like GHS 12.50.
- **The deadline gap:** a Pay in bits order is forfeited when the night **starts** (`maybeForfeitPlan`: `event.date <= now`), but `ticketContext` keeps sales open until **8 hours after** the start (`isOver`). So someone can start a Pay in bits order after the night has begun, pay, and be forfeited at once. §4.7 closes this.
- **What a Pay in bits buyer gets today** after each payment:
  - SMS `balanceMessage`: *"GHS X received. Balance: GHS Y. Order MEM-…. Pay the rest: …/installment.html?code=…"*. No night, no date, **no deadline**, no warning about forfeiting, and nothing saying the ticket only comes once it's fully paid.
  - No email for part payments (only when paid in full).
  - `payment-return`: the balance, a progress bar, the order code and "Pay more now". No deadline, no ticket details, no way to send the payment link to someone else.
  - `/api/checkout/status` for `installment_topup` returns `planId, paidPesewas, totalPesewas, eventName, eventId, planStatus, planComplete, amountPesewas`. There's **no `eventDate`, ticket type, quantity or reference**, so the page can't show a deadline.
  - `/pay` already rewrites to `installment.html` (`_redirects` on patch-2).
- Phone numbers are Ghana-only **on the server too** (`normalizePhone` in `public/lib/shared.js`). Keep the client rule as it is; see "Report, do not fix".
- Links that send someone to buy a ticket (from `grep -rn "#tickets\|event.html\|checkout.html" public/`):
  - `index.html`: hero "Get tickets" → `event.html?id=…#tickets`
  - `event.html`: "Get tickets" → `#tickets`; buybar and inline button → `checkout.html…`
  - `checkout.html`: back link → `event.html`; "That ticket isn't available" → `event.html#tickets`
  - `payment-return.html`: `tryAgain` → `event.html#tickets`
  - These link to the event page and **stay as they are**: poster cards (`index`, `nights`), calendar "Tickets" (`nights`), "The night" (`ticket.html`), "Public page" (`admin.js`)
  - No Worker SMS or email links to `event.html` or `#tickets` (checked `worker/src/**`).
- CSS breakpoints: `.buybar` hides at **≥900px**, `.inline-go` shows at **≥900px**, and the `.flow.with-aside` two-column layout starts at **≥960px**. Between 900 and 959px there's no buybar and no aside, so test that range.

---

## 2. Scope

**Leave these alone:** the visual identity (palette, Anton/Archivo/Instrument Serif, ticket look, date stamps, crimson buttons, `styles.css` tokens) and the voice of the supporting copy. Also leave `tables.html`, `private.html`, `visit.html`, `ticket.html`, `ticket-art.js`, `admin*`, `organiser.html`, `checkin.html`, `staff.js`, `firebase.js`, `config.js`, `_headers`, `_redirects`, and every endpoint and Paystack flow.

**Exceptions:**
- D2(a): remove the required-line check in the Worker.
- The Pay in bits work in §4.7 and §4.8, which may touch `installment.html`/`pages/installment.js`, `lib/shared.js` (`BITS_ACK_TEXT` wording only, if needed), and the Worker. Worker changes are **additive** (new response fields, new message text) plus the removal of the minimum. No new endpoints, no renamed fields.

**Reuse:** `.types/.type`, `.qty`, `.buybar`, `.inline-go`, `.choice`, `.field`, `.summary`, `.notice`, `.state-msg`, `.flow.with-aside`. New CSS only where nothing existing fits, kept to a few lines in a page `<style>` block rather than in `styles.css`.

**Only these headings change:** "Choose your ticket" on the tickets page, and "Your details" and "Payment" on checkout.

---

## 3. Target path and URL contract

1. Home or Nights → **Event** (information about the night; exits: Get tickets | Book a table)
2. Get tickets → **`tickets.html`** (ticket type and quantity only)
3. Get in → **`checkout.html`** (details and payment on one page)
4. Paystack → `payment-return.html` → `ticket.html` (unchanged)

```
event.html?id={eventId}
tickets.html?event={eventId}[&type={typeId}][&qty=1..6]      (new)
checkout.html?event={eventId}&type={typeId}&qty={n}          (unchanged)
tables.html?event={eventId}                                  (unchanged)
```

**Old links must keep working.** Flyers and WhatsApp messages already carry the old URLs:

- `event.html?id=X#tickets` → `location.replace('tickets.html?event=X')` on load.
- `event.html?id=X&type=T` → `location.replace('tickets.html?event=X&type=T')`. (`type=none` → leave it and show the event page.)
- `checkout.html` with a missing or unknown `type` → `location.replace('tickets.html?event=X')`.

Refreshing any of these URLs must land in a valid state. The browser Back button on checkout returns to tickets with the selection kept.

---

## 4. Changes

### 4.1 New `tickets.html` (and `pages/tickets.js` on the patch-2 base)

- Same `<head>` as `event.html`, plus `<meta name="robots" content="noindex">`. Title `Tickets · Memories`. `chrome('nights')`.
- Data: `api('/api/events/{id}')`. Use only `event` and `ticketTypes`.
- Contents, top to bottom:
  1. `← {event name}` back link to `event.html?id=…`, and a kicker with `shortDate · doors`.
  2. `h1.display`: **Choose your ticket**
  3. The `.types` / `.type` markup copied from `event.html`, including `aria-pressed`, disabled when sold out, and the `.s` line ("Admits one / Admits N · Last few · description" or "Sold out").
  4. The `.qty` row: 1 to 6, `<button>` and `<output aria-live="polite">`. Minus is disabled at 1 and plus at 6. At 6, show a quiet hint: *"Up to 6 per order."* (No table link here.)
  5. The total, plus a CTA reading **Get in · GHS X →**: `.buybar` below 900px, `.inline-go` from 900px up, handled exactly as `event.html` does today (including `--bar-h`).
- Behaviour:
  - Preselect `?type=` if it exists and is available. Otherwise, if **exactly one** type is available, preselect it. Otherwise select nothing and keep the CTA hidden.
  - Read `qty` from the URL and clamp it to 1–6.
  - On every change, update the URL with `history.replaceState`, not `pushState`.
  - The CTA href is `checkout.html?event=…&type=…&qty=…`.
- States (each a `.state-msg` with **one** next action and no table links):

| Condition | Heading | Action |
|---|---|---|
| no `event` param / 404 | This night isn't on. | See what's on → `nights.html` |
| `event.over` | This night has passed. | See what's on → `nights.html` |
| no ticket types | Tickets aren't on sale yet. | ← The night → `event.html?id=…` |
| event sold out, or every type sold out | Sold out. | ← The night → `event.html?id=…` |
| network or 5xx | `errorState(root, e.message, load)` | Try again |

  Check these in the order shown: "over" wins over "sold out", and "no types" wins over "sold out".

### 4.2 `event.html` becomes the night's information page

- Order: artwork, date stamp, name, meta (date · doors · venue), description, actions, draw, share.
- **Primary:** `<a class="btn red" href="tickets.html?event={id}">Get tickets <span class="arrow">→</span></a>`. When it can't be bought, a disabled `<span class="btn" aria-disabled="true">` with an accurate label: over → *This night has passed*; no types → *Tickets aren't on sale yet*; otherwise → *Sold out*.
- **Secondary:** a single *Book a table* button → `tables.html?event={id}`, shown when `tablePackages.length && !over` (including when the night is sold out).
- **Tertiary:** *Share this night ↗* (`shareUrl`), styled as `.link` and quieter than both buttons.
- The venue appears once, in the meta line, linking to `visit.html`.
- The draw box stays, below the actions, as information only.
- **Remove:** the `#tickets` section, `#buybar`, `#inlineGo`, `sel`/`qty`/`update`/`--bar-h`, the "Tables from GHS X" block, `minTable`, the "Where" and "Bring people" rows, and the `?type=` preselect. Keep the legacy redirects from §3.
- Clear `--bar-h` and take out the buybar markup entirely, so no empty padding is left at the bottom of the page.

### 4.3 `index.html`

- Hero *Get tickets* → `tickets.html?event={hero.id}`. Keep *Book a table* → `tables.html?event={hero.id}`.
- Remove the `#lines` teaser and the extra `api('/api/events/{id}')` call that only feeds it.
- Posters and "Also coming" still go to the event page. Don't touch the Private night tile.

### 4.4 `checkout.html`: one page

- Keep `?event`, `?type` and `?qty` exactly as they are. Clamp `qty` to 1–6.
- **Remove:** `S.step`, `order()`, `at()`, `go()`, `#bar`, `.peek`, `.review-ticket`, the `lineReady()` gate and `#toWho`.
- Layout (`.flow.with-aside`), in a single `<form novalidate>`:
  1. `← Choose ticket` → `tickets.html?event=…&type=…&qty=…`, and the short date on the right.
  2. `h1.display`: **Your details**
  3. A ticket row: `{qty} × {type}` · total · a *Change* link (same URL as the back link).
  4. Name and phone, as they are now (inline `setErr`, `phoneOk`). Email stays optional, inside the existing `<details>`.
  5. **The line, per D2:**
     - A `<details>` labelled *Add a line to your ticket (optional)*, closed by default, holding the existing line buttons and the "write your own" input (`maxlength=40`). An empty line is valid.
  6. `h2`: **Payment**. The `.choice` radios, keyboard-operable (arrow keys move between options, as in a native radio group):
     - *Pay in full · GHS X* is the default and keeps the draw note.
     - *Pay in bits* reads **"Start with any amount. Pay the rest before {Fri 03 Oct, 10PM}. Ticket arrives when it's fully paid."** It shows the deposit field (`min="0.01"`, `step="0.01"`, no minimum in the hint) and, on the patch-2 base, the existing acknowledgement checkbox.
     - **Hide Pay in bits once the night has started** (`now >= event.date`). Pay in full stays available.
     - If the deposit equals the total, keep Pay in bits but add a quiet hint: *"That's the full price. Pay in full to get your ticket straight away."*
  7. When Pay in bits is selected, show *"Pay the rest before {Fri 03 Oct, 10PM}. Unpaid balances are forfeited once the night starts."* as a `.notice` directly above the Pay button. Use the real start time, formatted in UTC like every other date on the site.
  8. The summary, the `#payErr` notice, **Pay GHS X →**, and the Paystack footnote.
- On submit, check in this order, stop at the first problem, show its error next to the field and put focus on that field: name → phone → deposit (bits: more than GHS 0 and no more than the total; error *"Enter an amount up to {total}."*) → acknowledgement (bits, patch-2). Then call `pay()`, **with no change to its request body** (patch-2 already sends `acknowledged: true` for Pay in bits; keep it). Pressing Enter in any field submits the form.
- On `change` of name, phone and email, and on submit, call `remember.set`. Keep the line and payment mode in `sessionStorage`, keyed by event id, so "Change" followed by "Get in" doesn't lose them.
- Preview: the live ticket shows only in the desktop `.aside` (≥960px). Nothing sits above the fields on mobile.
- States: a sold-out type, sold-out event, or past night shows the existing message, with its button pointing to `tickets.html?event=…`. A missing or unknown type redirects (§3).

### 4.5 `payment-return.html`

- In `tryAgain`, make only this change: *Try again* → `tickets.html?event={s.eventId}` for ticket payments (`kind` `ticket`, or missing), falling back to `nights.html`. Don't add `type` or `qty` (the status response doesn't include them).
- The Pay in bits (`installment_topup`) branch changes as §4.8 describes. Don't change the table, still-confirming or multiple-ticket branches.

### 4.6 `nights.html`

No change. Confirm that posters and the calendar "Tickets" link go to the event page.

### 4.7 Worker: no minimum, and a real deadline (on the Worker branch, as its own PR with tests)

1. **Remove the minimum.** Delete `MIN_TOPUP_PESEWAS` and its checks in `startInstallment` and `topupInstallment`. The new rule is: a whole number of pesewas, `>= 1`, and `<= balance` (or `<= total` for the first payment). Error messages: *"Enter an amount."* and *"That's more than what's left to pay."*
2. **Close the deadline gap.** `startInstallment` and `topupInstallment` refuse once `now >= event.date`, with *"Pay in bits closes when the night starts. Pay in full instead."* (start) or *"This night has started, so this order can't be topped up."* (top-up). Pay in full is unaffected.
3. **Add to `checkoutStatus`** (only for `installment_topup`): `eventDate`, `deadline` (= `eventDate`; its own field so the rule can change later), `ticketTypeName`, `quantity`, `firstName`, `reference`, `paidAt`. Also make sure `amountPesewas` is **this payment**.
4. **Add `deadline`** to `planSummary`, which feeds the `installment.html` lookup.
5. **Rewrite `balanceMessage`** so each part-payment SMS stands on its own. Keep it within 2 SMS segments (≤306 GSM characters; test the longest event name you allow):
   ```
   MEMORIES
   GHS 50 received for DND PARTY, Fri 03 Oct.
   Paid GHS 150 of GHS 300. Left: GHS 150.
   Pay before Fri 03 Oct 10PM or the order is forfeited.
   Order MEM-AB1234
   Pay: memoriesnightclub.com/pay?code=MEM-AB1234
   ```
   Check that `/pay?code=` keeps the query string through the `_redirects` rewrite. If it doesn't, use `/installment.html?code=`.
6. **Send the same information by email** on every part payment when the buyer gave an email (today email is only sent when paid in full).
7. **Tests:** update every test that assumes GHS 10. Add tests for a GHS 0.01 top-up, amount 0, amount over the balance, starting or topping up after `event.date`, and the SMS length with a 40-character event name.

### 4.8 The Pay in bits receipt (`payment-return` and `installment`)

After **every** part payment, including the first deposit, the buyer must be able to answer these from the screen alone: *what did I just pay, what's left, by when, how do I pay the rest, and what happens if I don't?*

In `payment-return`'s `installment_topup` branch (not complete), top to bottom:

1. A stamp showing *{GHS X} in*, and the heading *{GHS Y} to go.* (as today).
2. **Order code**, large, with a *Copy* button (`navigator.clipboard`, with the toast "COPIED.").
3. The night: `{eventName} · {shortDate} · {doors}` and `{quantity} × {ticketTypeName}`.
4. Money: the progress bar, then *This payment {X} · Paid so far {P} of {T} · Left {Y}*. Show the Paystack reference in small text for support.
5. **Deadline**, as a `.notice`: *"Pay the rest before {Fri 03 Oct, 10PM}. If it isn't fully paid by then, the order is forfeited and what you've paid isn't refunded."* Add *"{n} days left"* when more than one day remains, or *"Today"*.
6. **How to keep paying:**
   - *Pay more now* → `installment.html?code=…` (primary button)
   - *Send the payment link*: `shareUrl` with `…/pay?code=…` and the text *"Help me pay for my Memories ticket. Order {code}."* Say that **anyone can pay** with it.
   - *"Lost this? Go to memoriesnightclub.com/pay and enter your phone number; we'll text your order codes."* (This flow already exists: `textOrderCodes`.)
7. **What happens next:** *"Your ticket comes by text to {masked phone} the moment it's fully paid. No ticket until then."* Use `maskPhone`, never the full number.
8. Help: a WhatsApp link from settings.
9. *Save this receipt*: `print()`, with a print style that hides the header and footer (the existing `.no-print` class).

In `installment.html`, each active plan card shows the same **deadline notice and days left**, and the pay field has no minimum (`min="0.01"`, `step="0.01"`, error *"Enter an amount up to {left}."*). The "Half" quick button stays; add *"Any amount"* as the input's placeholder.

If a status field is missing because the Worker PR isn't deployed yet, **leave that line out; never show a blank or "undefined"**. The page must still work with today's status response.

---

## 5. Commits (small, each one leaves the site working)

1. Add `tickets.html` (not linked from anywhere yet).
2. Point Get tickets at it from home and event; add the legacy redirects; clean up the event page.
3. Make checkout a single page.
4. Change the payment-return retry link.
5. Remove the minimum on the client (checkout and installment) and add the deadline copy.
6. The Pay in bits receipt on payment-return and the deadline on installment cards.
7. Screenshots and the test script, under `docs/ux/tickets-page/` (never in `public/`).

The Worker changes (§4.7 and D2a) go in their own PR on the Worker branch, with tests, and **ship before** the public changes that depend on them. The public changes must still work (without a minimum being enforced on the client) against the old Worker; the old Worker's "The smallest payment is GHS 10." error simply shows up until it's deployed.

---

## 6. Verify for real

Serve `public/` with `python3 -m http.server`. Drive it with Playwright, using the pre-installed Chromium at `/opt/pw-browsers`; don't run `playwright install`. Intercept `**/api/**` with fixtures **shaped like `worker/src/public.js`**, not invented ones:

- an event with one type; an event with three types (one sold out, one `lastFew`); a sold-out event; a past event; an event with no types; an event with lines and one without
- a 404; a network failure (`route.abort()`); a 500
- `checkout/initiate` and `installments/start` replies whose `authorizationUrl` points to a local stub page. **Record the request body** and check it: `identityLine` empty or set, `quantity`, `ticketTypeId`, `depositPesewas`, and `acknowledged` on patch-2.

Viewports: **390×844**, **920×800** (the band between breakpoints) and **1280×800**.

Screenshots: the event page; tickets with one type and with many; checkout with Pay in full and with Pay in bits; one error state.

Checks:

1. **Taps from home to Paystack**, counted as clicks or taps on controls (typing doesn't count), for a single-type night and a multi-type night, before (original code) and after. Expected from reading the code, for a returning buyer whose details are remembered: before = Get tickets → Get in → pick a line → This is me → Next → Pay = **6** (7 if they want something other than the auto-selected first type); after = Get tickets → Get in → Pay = **3** (4 for a multi-type night). Report the real counts.
2. No `#tickets`, table information, "Where" or "Bring people" anywhere on `tickets.html` or `checkout.html`, in any state.
3. Refreshing tickets and checkout keeps the state. Back from checkout keeps the selection. The legacy `event.html#tickets` and `?type=` URLs redirect.
4. An empty name or an invalid phone shows an error and puts focus on that field.
5. Pay in bits: GHS 0, an empty field and total + 0.01 are rejected; **GHS 0.50 and GHS 12.50 are accepted** and sent as `50` and `1250` pesewas. Pay in bits is hidden once `now >= event.date`.
5b. Receipt: with a fixture `installment_topup` status that has the new fields, every item in §4.8 is present; with the **old** status shape, the page shows no "undefined" or empty lines. The share and copy buttons work; the print preview hides the header and footer.
6. Keyboard: tab order, a visible focus outline, the quantity buttons, arrow keys inside both radio groups, and Enter submits.
7. The console shows no errors, **and the CSP is enforced**: serve `_headers`' CSP as a header (for example with a tiny Python handler) so any inline script would fail on the patch-2 base.

**Say plainly what wasn't tested:** real Paystack, the live Worker, SMS delivery, and iOS Safari (Chromium only).

---

## 7. Done means

- Get tickets opens `tickets.html` from home and the event page. No scroll-jump is left, and old links redirect.
- The event page shows the night, Get tickets, one Book a table, and Share.
- Checkout is one page, with no required creative step; the server accepts an empty line.
- A failed ticket payment's "Try again" lands on the tickets page.
- Pay in full is the visible default, and Pay in bits works end to end against the fixture, including `acknowledged`.
- Pay in bits accepts any amount above zero, up to what's left, and closes when the night starts.
- After every part payment, the receipt page, the SMS and the email (if given) each say what was paid, what's left, the deadline, how to pay the rest, and that the ticket only comes when it's fully paid.
- No visual redesign, no new dependency, and no backend change beyond §4.7 and D2a.

## 8. Final report

1. Which Worker production runs (the §0 first step), and confirmation that the work is based on patch-2 (D1) with the line optional (D2a).
2. The files changed, with one line on why for each.
3. Tap counts before and after.
4. What was tested: how, at which viewports, and what was stubbed. What couldn't be tested.
5. Anything in the code that contradicts this brief, stated plainly rather than worked around.
6. **Report, don't fix:**
   - Pay in bits on `main` doesn't send `acknowledged` (D1); this is a production bug if the patch-2 Worker is live.
   - Phone numbers are Ghana-only on both client and server, so visitors from abroad in Cape Coast can't buy.
   - Private events: the owner chose "Book an event" (Corporate, Event organiser, Large group, Other). patch-2 has it, but check that the **home tile** on patch-2 no longer links Birthday or Concert. If it still does, report it.
   - The home page waits for `/api/settings` before `/api/events` (`await chrome()`); fetching both at once would show the main event sooner.
   - Nothing lets a guest find their ticket again if they lose the SMS.
   - Cost of having no minimum: each part payment sends an SMS (a fixed cost per message) and a Paystack charge. Very small top-ups repeated many times cost the club more than they bring in. Report how many top-ups under GHS 5 happen after launch, if the admin data allows it; don't add a limit.
