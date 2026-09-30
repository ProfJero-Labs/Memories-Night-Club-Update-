# UX debt register

Problems found in UX audits, so they don't vanish between cycles. Evidence says how we know:
**observed** (used the app), **measured** (a number from a test run), **code** (read, not seen), **heuristic** (judgement).
Audit 1: 29–30 Sep 2026, run locally (real Worker, fake Paystack) at 360px and 1280px, slow 4G + 4× CPU, offline.

| # | Issue | User impact | Evidence | Priority | Status |
|---|---|---|---|---|---|
| 1 | A declined or abandoned payment showed "PAID · YOU'RE IN" | Guest thinks they're in; argument at the door | observed | P0 | **Fixed**: only an issued checkout shows as paid; e2e test for decline |
| 2 | Payment that landed but sold out said "Nothing was taken" | Guest thinks no money left their MoMo | code | P0 | **Fixed**: says a refund is owed and keeps the reference |
| 3 | "Get tickets" below the fold on home and night pages (y≈1074 at 360×740); no price before the tickets page | Main job needs a scroll past the flyer | measured | P1 | **Fixed**: flyer capped on phones, "from GHS X" on the button, sticky buy bar |
| 4 | Checkout long: Pay at y=1195, summary twice, pay mode as a second big choice | Friction and abandonment | measured | P1 | **Fixed**: phone first, one summary, Pay pinned; Pay at y=712. Pay in bits is a quiet link |
| 5 | Night editor one 8,909px page on a phone | Staff lose their place; changes missed | observed | P1 | **Fixed**: Details · Look · Tickets · Tables · Draw · Comps, one at a time |
| 6 | No way back to a lost ticket when paid in full | WhatsApp support load on the night | code | P1 | **Fixed**: `find.html` texts upcoming tickets to the phone that bought them |
| 7 | Table bookings: no pass, not findable at the door | Door can't confirm a table guest | code | P1 | **Fixed**: door search finds tables (name, last 4, TBL- code) and seats once; the text carries the code |
| 8 | Ten admin tabs in a sideways scroller, cut off at 360px | Hidden features | observed | P1 | **Fixed**: five places (Tonight, Nights, Money, Requests, Setup) with a row underneath |
| 9 | Tap targets under 44px (nav 32px, WhatsApp 36px, folds 26px, admin buttons 40px) | Mis-taps on phones | measured | P2 | **Fixed** for the public pages and staff buttons. Nav text stays 12px to fit 360px |
| 10 | "Get in" opened a form, not entry; Bookings vs orders | Confusing labels | observed | P2 | **Fixed**: "Continue"; admin "Orders"; footer "Pay the rest (pay in bits)" |
| 11 | Bottle prices cut off at 360px ("GHS 1,8…") | Guest can't see the price | observed | P2 | **Fixed** |
| 12 | Ticket QR ~90px wide on a phone | Slow scans in the dark | observed / heuristic | P2 | **Fixed**: tap the QR for full screen on white (≥300px), screen kept awake |
| 13 | No undo for a mistaken admit | A tap uses up someone's ticket | code | P2 | **Fixed** with decision #6's default; owner to confirm |
| 14 | No purchase funnel | Owner can't see drop-off | code | P3 | **Fixed**: 7-day started / paid / left at Paystack / failed on Overview |
| 15 | Colour contrast unmeasured | Hard to read in sunlight | measured | P3 | **Checked**: axe WCAG 2 AA (incl. contrast) passes on every public page in the e2e suite |
| 16 | Nothing works offline (payments need the network; the door never admits offline) | Door stalls when signal drops | observed | P1 | **Open, by owner decision #10.** Door shows "No connection. Not checked" and search stays usable when back |
| 17 | Stock isn't held during checkout: a rush can sell past capacity and refund after payment | Paid-then-refunded guests | code | P1 | Open (not in this UX round) |
| 18 | Ticket line in checkout; could move to after payment on the ticket page | Shorter checkout | heuristic | P2 | Open: waiting on the owner's answer |
| 19 | Header nav text is 12px at 360px | Small text | measured | P3 | Open: larger text doesn't fit 360px without dropping a link |
