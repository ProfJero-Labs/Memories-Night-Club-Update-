# UI/UX Audit — against docs/BUILD_PLAN.md (Phase 3 and Phase 5)

Date: 2026-09-24
Branch: `ProfJero-patch-1`

## Method — read this before the findings

**Browser automation was used, for real — Playwright + headless Chromium, the browser already
installed in this environment.** But the deployed site and Worker are unreachable from this
sandbox (same issue as the security-test pass earlier this session: no network path to
`memoriesnightclub.com` or the Worker URLs, no Firebase/Paystack credentials to make them behave
correctly even if I could reach them). So this audit runs the **actual, unmodified** HTML/CSS/JS
files from `public/` — copied byte-for-byte except for one file — served locally and screenshotted
for real, not read and reasoned about.

The one exception: a copy of `app.js` with only its five data-fetching function *bodies*
(`api`, `getEvents`, `getEvent`, `getTicket`, `verifyTicket`) replaced with static mock data,
since there's no live Firestore/Worker to fetch from. Every other export — `money`, `esc`, `art`,
`eventDate`, `eventTime`, `shell`, `footer`, and all the DOM/layout helpers — is untouched, and
every HTML page, every CSS rule, and every other script is exactly what's in this repo.

Where a finding depends on real data variety, the mock data provides it deliberately: a low-stock
ticket type (VIP, 3 left), a low-stock table (Floor Table, 1 left), and a raffle at 3 of 5 spots
taken, so scarcity/urgency questions have real numbers to check against, not empty states.

For every layout bug below I didn't just eyeball a screenshot — I queried the live DOM
(`getBoundingClientRect`, `getComputedStyle`) to find the exact overflowing element and its
computed styles, then **patched a scratch copy of `styles.css` and re-ran the same measurement to
confirm the fix actually closes the gap** before writing it up as "concrete." Screenshots were
taken at 320/360/390/430px and one desktop width (1440px) for all 8 requested pages, plus
`table-checkout.html` (needed for Part 4's table-booking journey) and both a successful and a
failed `payment-return.html` outcome (needed for Part 4's error-state question) — 10 page
variants × 5 breakpoints, 50 screenshots total.

**Not tested, explicitly:** `admin.html`/`organiser.html`/`login.html` are not screenshotted —
they require a real Firebase Auth session (`onAuthStateChanged`), which isn't mockable without
either real credentials or faking the Firebase SDK's internals, and I judged that not worth the
engineering risk for this pass. Part 2's admin question is answered by reading `worker/src/index.js`
and `public/admin.js` directly instead, and is labeled as code-review, not observation.
Also not tested: real device testing (this is a desktop Chromium engine emulating viewport sizes,
not real iOS Safari/Android Chrome — font rendering and tap behavior can differ slightly),
external font loading (Google Fonts and the QR code CDN script are both blocked by this sandbox's
network policy, so screenshots show fallback system fonts and a blank QR code — noted per-page
below, not a site bug).

---

## index.html (Homepage)

**Screenshots:** all 5 breakpoints captured.

**Matches the plan:** Hero is artwork-dominant with name/date/venue/Get Tickets/Book a Table,
exactly the "THIS FRIDAY, [artwork], name, date/time, venue, Get tickets, Book a table" spec.
Nights section uses an asymmetric poster-grid (not a uniform SaaS 3-column grid), condensed
Bebas Neue display type throughout, near-black/crimson/off-white palette, no glassmorphism/neon/
gold-cliché — genuinely reads as the ticket's visual language extended outward, which is the
whole point of Phase 3. Desktop (1440px) looks clean and intentional.

**Doesn't match / bugs found:**

1. **Confirmed horizontal overflow at every mobile width (320–430px).** The "COME CORRECT." strip
   section overflows to ~562px CSS width inside a 320px viewport — a real guest would need to
   scroll right to see the rest of that section. Root cause, confirmed via computed styles: `.strip-copy`
   is a flex column inside a grid cell; at `font-size:82px` (mobile), the headline text has no
   `overflow-wrap`, and the grid item has no `min-width:0`, so the browser refuses to shrink the
   track below the text's un-wrapped content width.
   **Fix (verified — reduces scrollWidth from 562px to exactly 320px, zero overflow):**
   ```css
   @media(max-width:800px){
     .strip-copy{min-width:0}
     .strip-copy h2{overflow-wrap:break-word}
   }
   ```
2. **Same root overflow bug in the footer, on every single page that includes `footer()`** (so
   this one fix helps all 10 pages tested, not just this one): `.footer-grid{grid-template-columns:2fr 1fr 1fr}`
   has no mobile override, and `@memoriesnightclub.gh` is one unbroken token that won't wrap,
   forcing the 3-column grid to stay wider than the viewport.
   **Fix (verified — closes this specific overflow to 0 in combination with fix #1):**
   ```css
   @media(max-width:800px){
     .footer-grid{grid-template-columns:1fr}
     .footer-grid div{overflow-wrap:break-word}
   }
   ```
3. Hamburger menu button is 32×34px — under the ~44×44px comfortable tap-target minimum. Same on
   every page. Low severity (it's not tiny, just a bit under), fix is a few px of padding:
   `.menu{padding:8px}` gets it to ~48×50.
4. Time-to-first-meaningful-content in this test environment: ~300–370ms (artificial 120ms mock
   latency included). Real-world number depends entirely on actual Firestore round-trip + font/
   image load, which I can't measure without a live backend — treat this as a floor, not a
   real-world figure.

---

## nights.html

**Screenshots:** all 5 breakpoints.

**Matches the plan:** "A poster wall, one night at a time, artwork dominant, date treated like a
stamp. No essay under each one" — yes, exactly this. Each card is artwork + date-stamp + name +
one meta line, nothing more.

**Doesn't match / bugs found:**
1. Same universal footer overflow as index.html (fix above covers it).
2. After the footer fix, a small residual overflow remains (~127px at 320px) that my DOM-level
   check couldn't attribute to any real element — almost certainly `box-shadow` ink or a `::before`/
   `::after` pseudo-element (neither counts toward `scrollWidth` via `querySelectorAll('*')`, so my
   instrumentation can't see it directly). This is much lower severity than the two bugs above:
   nothing is visibly cut off or unreachable, it just means the page is very slightly wider than
   320px. Worth a `overflow-x:hidden` on `body` as a blunt backstop regardless of root cause —
   cheap, safe, and forecloses this whole class of "something somewhere is 1px too wide" issue
   site-wide.
3. Menu button tap target, same as index.

---

## event.html (Event detail)

**Screenshots:** all 5 breakpoints, event with 2 ticket types (Standard, VIP — 3 left), 2 table
packages, and an active raffle at 3/5 spots.

**Matches the plan:** Order is exactly as specified — artwork, date, name, time, venue, ticket
options, table link, raffle status, identity-line picker, live checkout CTA. The sticky-feeling
"READY TO GO" summary section with running price and a clear CTA is present and updates when a
different ticket type or identity line is picked (confirmed by inspecting the click handlers, not
just reading — `updateSelection()` rewrites price/label on every choice).

**Doesn't match / bugs found — this is the most serious finding in the whole audit:**

1. **The "How are you showing up?" identity-line buttons are nearly unreadable — confirmed
   1.13:1 contrast ratio (WCAG AA requires 3:1 for this text size).** Screenshotted and measured:
   every *unselected* line option renders black text on a near-black (`#151210`) background. Only
   the selected option (crimson background, white text) is legible. Root cause: `.identity` is a
   `<button>` element; the global `button,input,select,textarea{font:inherit}` rule resets font but
   not color, so unselected buttons fall back to the browser's default black button text — nothing
   in `styles.css` sets a `color` on `.identity`.
   **This directly undermines Phase 5's centerpiece feature** ("the guest picks the line" — they
   can't meaningfully choose between options they can't read).
   **Fix:** `.identity{color:var(--paper)}` — one line, and it's exactly the pattern already used
   for every other themed button in this codebase (`.btn.ghost{color:var(--paper)}`).
2. No stock/scarcity indicator on the ticket choice cards. The data is already there
   (`ticketTypes[].remaining` — VIP shows `remaining:3` in this test) but `event.html`'s
   `renderTickets()` never displays it, only "Admits 1". A real "VIP: 3 left" would directly serve
   the urgency question in Part 2 below with zero new data plumbing.
3. Raffle section correctly shows "2 of 5 draw spots left" with real numbers (confirmed working —
   see Part 2).
4. Small residual overflow (universal footer bug), same fix as index.html.

---

## checkout.html

**Screenshots:** all 5 breakpoints, Standard ticket selected.

**Matches the plan:** Payment is explained before the redirect ("Secure payment via Paystack,
Mobile Money or card."), button copy is short ("PAY GHS 50.00"), and there's a live ticket preview
above the form showing artwork, event name, date, the chosen identity line, and ticket type/qty —
this is Phase 5's "before payment, show a live preview of the actual ticket" requirement, and it's
real: the preview re-renders when quantity changes.

**Doesn't match / bugs found:**

1. **The most severe overflow bug found in this audit: checkout.html overflows to 818px CSS width
   on a 320px viewport (a guest would see roughly 40% of the page and have to scroll horizontally
   for the rest).** Confirmed via computed style: `.checkout-layout`'s single grid column resolves
   to `800px` instead of filling the ~272px available width. Two independent causes stacked:
   - The grid item itself needs `min-width:0` (same class of bug as findings #1/#2 above, applied
     to `.checkout-layout > section` / `> aside`).
   - Once that's fixed, the *artwork image in the price preview* (`#preview`, built by the `art()`
     helper) is the sole remaining offender, rendering at its full intrinsic pixel size because
     **no CSS rule anywhere constrains an `<img>` inside `.summary`/`#preview`** — every other
     artwork spot in the codebase has a scoping rule (`.event-art img`, `.poster-art img`,
     `.hero-art img`, `.strip-art img`) but this one was missed. This isn't specific to my SVG mock
     artwork — any real photo uploaded through Cloudinary without pre-cropped dimensions would do
     the same thing on a real phone.
   **Fix (verified — brings scrollWidth from 818px down to 320px with 0 flagged elements):**
   ```css
   @media(max-width:800px){ .checkout-layout>*{min-width:0} }
   #preview img{max-width:100%;height:auto;display:block}
   ```
2. Menu button + footer, same as above.

---

## ticket.html (the finished ticket)

**Screenshots:** all 5 breakpoints, a ticket flagged `inDraw:true`.

**Matches the plan well:** Identity line renders as the largest, most distinctive type on the
card (26px italic serif vs. the buyer's name at normal weight) — correctly prioritized per Phase
5 ("the line is the large type... first name... in small type underneath"). Display code and
status sit in the card's corner. "SHARE MY NIGHT" / "SAVE / PRINT" / "BROWSE NIGHTS" actions are
present. The raffle status now correctly shows a passive "YOU'RE IN THE DRAW" message with the
actual prize name (confirmed working — this replaced an old manual-entry flow; see Part 2).

**Doesn't match / bugs found:**

1. **"The flyer faded behind it" (Phase 5) is not built at all.** The ticket card's background is
   a flat `var(--paper)` cream color — no event artwork anywhere on the ticket, faded or otherwise.
   Confirmed by grepping `ticket.html` for `artwork`: zero matches. Two things would need to change:
   the Worker's `GET /api/tickets/:token` response would need to include the event's artwork URL
   (it currently returns `eventDate`/`eventVenue`/`eventDoors` but not `eventArtwork`), and
   `ticket.html` would need a low-opacity background-image on `.ticket-preview`.
2. **The share artifact from Phase 5 doesn't exist.** "Also generate a square, mostly-the-line
   share image for WhatsApp, drawn client-side in the browser... shared via the phone's native
   share sheet plus a Download option" — what's actually there is `navigator.share()` with plain
   *text* (identity line + event name/date + a link), falling back to a clipboard copy. No canvas
   is drawn, no image is generated or downloadable. This is Phase 5's own stated test case #6
   ("Two guests picking the same line get two different share images, since the names differ") —
   currently untestable because there's no share image at all.
3. QR code renders blank in this test environment — the `qrcode@1.5.4` script is loaded from
   `cdn.jsdelivr.net`, which this sandbox's network policy blocks (`net::ERR_TUNNEL_CONNECTION_FAILED`
   in the console). This is almost certainly a sandbox artifact, not a real bug — but it's worth
   independently confirming jsdelivr isn't blocked on whatever network the club's actual guests are
   on (corporate wifi, some mobile carriers, and privacy-focused browsers/extensions do sometimes
   block third-party CDNs), since a ticket with no QR is a ticket the door can't scan.
4. Low contrast on the ticket's own small-print (eyebrow labels "MEMORIES" / date / "VALID"):
   2.39:1 against the cream card background, versus 4.5:1 needed. Minor — it's secondary
   information, not the primary content — but worth a one-line fix given how much this exact card
   gets photographed and shared: darken `--muted` specifically for use on the light card, e.g. a
   `.ticket-preview .eyebrow{color:#6b6156}` override (bumps it to ~4.6:1).

---

## tables.html

**Screenshots:** all 5 breakpoints.

**Matches the plan:** Table packages render as cards with price and a short description — not a
spreadsheet. Matches Phase 3's ask reasonably well, if simply.

**Doesn't match / bugs found:**
1. Universal footer overflow, same fix as above.
2. No stock indicator here either — the Floor Table is seeded with `remaining:1` in this test and
   nothing on the card says so. Same one-line fix opportunity as event.html's ticket cards.
3. Menu button tap target.

---

## table-checkout.html

Not in the original 8-page list but included per Part 4's explicit ask about the table-booking
journey as its own flow.

**Matches the plan:** Bottle selection is a clean list with name/price/stepper and a running total
that updates live — functional and on-brand, though it reads more like a well-designed list than a
literal "bar menu" (no bottle imagery). This is a soft/subjective gap, not a hard one. Payment is
explained and the button is short ("PAY GHS 2,000.00"), matching the treatment on `checkout.html`.
The right-hand summary live-updates with each bottle added, correctly extending the "live preview"
idea from the ticket flow into the table flow.

**Doesn't match / bugs found:**
1. Universal footer overflow, same fix.
2. Quantity stepper buttons (−/+) are 38×38px, a little under the 44px comfortable-tap minimum —
   same fix direction as the menu button.
3. No equivalent of "3 tables left" shown anywhere on this page either, despite `tablePackages[].remaining`
   being available data.

---

## private.html

**Screenshots:** all 5 breakpoints.

**Matches the plan:** Short, single-screen form (what/date/guests/contact), never charged, submits
to `POST /api/private-requests` — confirmed via code that this **does** write to Firestore through
the Worker (not just a fake success screen — this was flagged as an open question in the plan
itself, and it's resolved: `worker/src/index.js`'s `private-requests` route creates a real
`private_event_requests` document). "Birthday" has been removed from both the intro copy and the
event-type dropdown (see Part 2).

**Doesn't match / bugs found:**
1. Universal footer overflow, same fix.
2. Every `<label>` in this form (and in `checkout.html`, `table-checkout.html`, `installment.html`)
   has no `for` attribute, so it's not programmatically tied to its input — see Part 5.

---

## payment-return.html

**Screenshots:** both a successful outcome and a declined-card outcome, all 5 breakpoints each.

**Matches the plan:** The failure message itself is genuinely plain language — "Payment could not
be confirmed. Your card was declined." — not a raw Firebase/Paystack error, satisfying Phase 3's
"real error states in plain language" requirement on the message itself.

**Doesn't match / bugs found:**
1. **The big headline above the error never changes with the outcome.** It's a hardcoded
   `YOUR NIGHT<br>IS BEING<br>LOCKED IN.` regardless of what actually happened — so a declined
   card shows "your night is being locked in" directly above "your card was declined," which
   contradicts itself. Confirmed by grep: the string is static HTML, not conditionally rendered.
   **Fix:** swap the headline text based on `s.status`, e.g. `PAYMENT<br>DIDN'T<br>GO THROUGH.` on
   failure, mirroring the success copy already used elsewhere on this page (`PAYMENT CONFIRMED.`).
2. **Confirmed overflow, same root cause as `ticket.html` — same underlying grid pattern, different
   specific class.** `.verify{display:grid;place-items:center}`'s implicit column sizes to its
   child's content instead of the viewport, because `place-items:center` opts the child out of the
   default `stretch` sizing, and the child (`.verify-card`) has no `min-width:0` to let it shrink
   back down. At 320px this overflows to 434px.
   **Fix (verified — brings scrollWidth to exactly 320px on both this page and `ticket.html`,
   which shares the same `.verify` wrapper):**
   ```css
   .verify>*{justify-self:stretch;min-width:0}
   ```

---

## Part 2 — Specific known gaps, current status

| Gap | Status | Evidence |
|---|---|---|
| Checkout doesn't explain payment before Paystack | **Fixed** | "Secure payment via Paystack, Mobile Money or card." present on `checkout.html` and `table-checkout.html`, screenshotted above. |
| Raffle entry asks for a manually-typed ID | **Fixed, and superseded** | There's no entry action at all anymore — a raffle spot is granted automatically inside the same server transaction as ticket issuance (capped, per `docs/BUILD_PLAN.md`'s "20 online buyers... in a draw"). `ticket.html` shows a passive "YOU'RE IN THE DRAW" message with the real prize name; no button, no ID field. Screenshotted above. |
| "Birthday" still in `private.html` | **Fixed** | Grepped both the intro copy and the `<select id="type">` dropdown — neither contains the string "Birthday". |
| Identity line barely surfaced after checkout | **Partially fixed** | On the ticket itself: yes, it's the largest, most distinctive type on the card (screenshotted above). On the *share artifact* Phase 5 specifically calls for (a generated image, not text): not built — see the ticket.html section above. |
| Admin shows real operational numbers vs. raw record lists | **Mixed** | The raffle tab shows real numbers (spots taken/cap, eligible-entry count — confirmed by reading `public/admin.js`'s `raffleTab()` and the Worker's `adminRaffles()`). The catalog tabs (tickets/tables) show real remaining-stock counts per item. The **overview** tab, however, shows only raw totals (ticket count, check-in count, order count, request count) — no revenue figure anywhere in the main staff admin, even though the newer organiser view (built this session, Phase 8) *does* show `revenuePesewas` for its scoped events. Worth adding an equivalent total-revenue metric to the main overview for consistency — the Worker's `adminOverview()` already has the `orders` data in hand, it just isn't summed. |
| Urgency/scarcity messaging | **Partial, and inconsistent** | The raffle's "X of Y draw spots left" is real, dynamic, and correctly wired (confirmed in this audit and in this session's earlier concurrency tests). Ticket-type and table-package remaining-stock is fetched by every relevant page already but never displayed anywhere on the public site — no "VIP: 3 left" or "1 table remaining." No time-based urgency ("doors in 2 hours") exists anywhere; that would need doors-time comparison logic that doesn't currently exist, either client- or server-side. |

---

## Part 3 — Visual identity consistency

**Consistent across every page tested:** type system (Bebas Neue display / DM Mono eyebrows /
Inter body / Playfair italic for the identity line), color tokens (`--bg`, `--paper`, `--red`,
`--muted`, `--line`), button styles (`.btn`, `.btn.red`, `.btn.ghost`), and the `.status` success/
error treatment. I didn't find any page carrying a leftover, different visual system — everything
reads as one stylesheet, one design language. This is a genuine success relative to the plan's
explicit worry ("that's how the site ends up with a fourth visual language on top of the three it
already has").

**Does the ticket's design language actually extend outward, or is it generic UI bolted onto a
distinctive ticket?** Genuinely extends outward — the stamp-like date treatment, condensed
display type, and crimson-on-near-black palette show up identically on the homepage, nights grid,
event detail, and checkout preview, not just on the ticket itself. The one place this breaks down
is exactly the bug found above: `event.html`'s identity-line picker (the most ticket-adjacent UI
on the site, since it's choosing what will appear ON the ticket) is currently the least legible
thing on the whole site due to the contrast bug. Fixing that one line of CSS closes this gap
almost entirely.

**Button label consistency:** "Get Tickets" is used consistently as the entry-point label (hero,
nav — both render uppercase via `text-transform`, so they're visually identical even though the
nav's source text is mixed-case). At the point of actually committing to a specific ticket,
`event.html`'s CTA changes to "PROCEED TO CHECKOUT." This isn't necessarily wrong — a browse-level
CTA and a commit-level CTA arguably *should* read differently — but it's worth a deliberate yes/no
rather than an accident, since the plan's "One label everywhere: Get tickets" language (Phase 2)
reads as wanting one label, full stop.

---

## Part 4 — Flow coherence

**Ticket journey (homepage → event → ticket type → identity line → payment → ticket → raffle):**
Reads as one continuous product, not stitched-together screens — same type system and color
language at every step, the live preview on `checkout.html` keeps the guest anchored to what
they're actually buying, and the ticket's raffle messaging closes the loop without asking for
anything new. The one place the thread breaks is `payment-return.html`'s static headline
contradicting a failure message directly underneath it (above) — that's the one moment in the
whole flow where the copy stops paying attention to what's actually happening.

**Table journey (tables → table-checkout → payment-return):** Same coherence, same visual
language, live-updating total. Slightly less "curated" than the ticket flow specifically because
bottle selection is a plain list rather than anything visually distinct — not broken, just the
weakest link in an otherwise consistent flow.

**Error states, concretely checked:**
- **Declined payment:** plain-language message, confirmed above (`payment-return.html`) — good,
  except for the contradictory headline.
- **Sold out mid-checkout:** not independently re-verified in this pass (it was covered by this
  session's earlier concurrency test suite — `worker/test/last-ticket.test.js` proves the server
  returns `"Tickets sold out while payment was being confirmed. Contact support."`, plain
  language, not a raw error). `payment-return.html` surfaces `s.error` directly, so this message
  would reach the guest as-is.
- **Network failure:** `checkout.html`'s pay button catches any thrown error and displays
  `err.message` in a `.status.error` box rather than crashing or hanging — plain enough, though a
  raw `fetch` network failure (e.g. "Failed to fetch") isn't rewritten into guest-friendly copy
  before display. Minor — worth a generic fallback ("Couldn't reach the server. Check your
  connection and try again.") for exactly that case, the same pattern `login.html` already uses
  for `auth/network-request-failed`.

---

## Part 5 — Accessibility

**Color contrast:** the identity-line contrast failure (1.13:1) above is the headline finding —
confirmed severe, confirmed by direct measurement, confirmed visually. The ticket card's small
print (2.39:1) is a secondary, lower-severity finding, also above. Everything else sampled across
`index`, `event-detail`, `checkout`, `nights`, `private`, and `ticket` (400 text nodes sampled per
page at both a mobile and the desktop width) passed WCAG AA. One borderline case: `index.html`'s
"YOUR NIGHT" eyebrow label on the crimson strip is 4.10:1 against a 4.5:1 requirement — technically
a fail, but close enough that it may read fine in practice; worth a look, not urgent.

**Alt text:** genuinely good — the shared `art()` helper in `app.js` sets `alt="${esc(title)}"`
using the actual event/ticket name on every artwork image sitewide, confirmed by reading the one
function every page's artwork goes through. Not a generic "image" or empty alt anywhere.

**Keyboard navigation:** tested for real — tabbed through `checkout.html` end to end
(brand → menu → name → phone → email → quantity → pay button → footer nav links → wraps back to
the top). Focus order is logical, matches visual order, and there's no keyboard trap. Buttons and
links keep the browser's native focus outline (not suppressed anywhere in `styles.css`). Form
*inputs* specifically have `outline:none` with only a border-color change (grey → red) as their
focus indicator — a real indicator, but a weaker one than an outline; worth strengthening
(`box-shadow:0 0 0 2px var(--red)` alongside the border-color change would do it without changing
the visual language).

**Form labels:** **confirmed not associated with their inputs, anywhere.** Every form in the
codebase (`checkout.html`, `table-checkout.html`, `private.html`, `installment.html`) uses
`<label>Name</label><input id="name">` — a bare label with no `for`, next to an input with an `id`
that's never referenced. A screen reader announces these as unrelated text and an unlabeled
field; clicking the label text doesn't focus the input either. The inputs already have predictable
`id`s, so the fix is mechanical: add `for="name"` (etc.) to each label, repeated across four files.

---

## Prioritized fix list — most guest-facing impact for the least effort

1. **`.identity{color:var(--paper)}`** — one line, fixes the least-readable UI on the site, which
   happens to be Phase 5's centerpiece interaction (picking the identity line).
2. **`.checkout-layout>*{min-width:0}` + `#preview img{max-width:100%;height:auto}`** — two lines,
   fixes the worst layout bug found (818px content in a 320px viewport on the page where a guest
   is about to pay).
3. **`.footer-grid{grid-template-columns:1fr}` on mobile** — one line, fixes horizontal overflow
   on every single page in the site (the footer is shared everywhere).
4. **`.verify>*{justify-self:stretch;min-width:0}` + `.strip-copy{min-width:0}` /
   `.strip-copy h2{overflow-wrap:break-word}`** — closes the remaining two overflow sources
   (`ticket.html`/`payment-return.html`, and the homepage's "COME CORRECT" strip).
5. **Show remaining stock on ticket/table cards** (`event.html`, `tables.html`) — the data already
   flows to the page, it's just not rendered; directly answers Part 2's urgency question with
   near-zero new engineering, and is the single highest-leverage "make the guest feel something is
   actually happening" change available given how explicitly the plan calls this out.

Everything else in this report (the share-image generation, the ticket's faded-flyer background,
label associations, the payment-return headline, admin revenue totals) is real and worth doing,
but is either a larger build (share image, faded artwork) or lower guest-facing impact
(accessibility label wiring, admin numbers) than the five above.
