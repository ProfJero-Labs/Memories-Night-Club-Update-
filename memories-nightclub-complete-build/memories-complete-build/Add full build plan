Memories Night Club — Ticketing System: Findings & Build Plan

Sep 23, 2026 · prepared with @Jeffery Essel

What we are building

A guest opens a link from WhatsApp or Instagram, sees the night, feels like something is actually happening, buys a ticket in under a minute, and leaves with something worth posting. Twenty online buyers on that night are in a draw. Anyone can pay a ticket in pieces. Admin changes flyers and prices without a developer. An organiser sees only their own sales. Most guests are on a phone, the experience is built for that first, not adapted to it afterward.

The data layer stays Firebase: Firestore, Auth, and Storage. All server-side logic, checkout, the Paystack webhook, raffle, door check-in, admin actions, SMS, runs on a Cloudflare Worker, per the engineer's own stack, not Firebase Cloud Functions. The Worker talks to Firestore over its REST API with a service account rather than the Admin SDK, since the SDK doesn't run in the Workers runtime. The browser never decides that a payment succeeded, and it never decides who won.

On the look and feel: this is a real visual upgrade, not a coat of paint. The ticket is already the most distinctive thing in the current system, stamps, torn edges, condensed type, that's the design DNA the rest of the public site should extend, not a generic dark nightclub template. Live code: github.com/ProfJero-Labs/Memories-Night-Club-Update-, branch ProfJero-patch-1, path memories-nightclub-complete-build/memories-complete-build. Do not start a phase until the one before it is done. Do not open the Supabase repository, it is not part of this work.

Phase 1 — Security, before any new feature

The worker source is not in this repo. Where this plan says confirm, that means open the worker and check, do not assume it is safe.

Items 4 and 5 below are done: SMS sending and payment verification now run on the Cloudflare Worker (worker/src/index.js in the live repo), with real auth checks and server-recalculated pricing, not the old unauthenticated worker. What's still open from the actual repo, found by reading it directly, not assumed: the raffle draw's admin button is wired to a client-side Firestore write that the security rules block outright, so it fails every time; the Worker's own draw endpoint picks a winner correctly but doesn't wrap the read-check-write in a transaction, so two admins drawing at once can silently overwrite each other's result; the Worker's document-listing helper doesn't paginate past 300 results, which will quietly under-count once the venue has real volume; and wrangler.toml has two conflicting [vars] blocks that may be dropping real config on deploy.

Rotate the Brevo key today. It is exposed in index.html near line 805 and script.js line 6, sent from the browser, and it is in git history. Create a new key, revoke the old one, send mail only from the worker. Deleting the line is not enough.
Lock Firestore, without breaking admin. No rules file exists yet. Do not ban every client write outright, the admin pages currently write events, tickets, and check-ins from the browser, and a server-only rule turns the door and the CMS off until every form is rewritten. Shape: public may read active events and public prices only; public may get one ticket by its document id, never list or query tickets; public may not write anything; a signed-in user with custom claim admin true may write, a normal account may not; an organiser may read only events where organiserId is their own uid; smsHistory, contacts, checkins, bookings, and orders are never public. The Paystack worker writes with the Firebase Admin SDK, which rules do not govern, if it currently uses the public web key instead, change that in this phase.
Close self-signup and add a real admin. There is no role today, admin pages only hide themselves when nobody is logged in. Turn signup off, create staff in the console, set the admin claim from a trusted script, never from the client. Also in this phase: one message for both wrong email and wrong password, wire up Forgot password or remove it, remove the inert Remember me checkbox, and fix the absolute /event/dashboard.html redirect to a relative path.
Stop the SMS worker being callable by anyone. event/sms.js calls /send-sms and /balance with no ID token. The worker must reject any caller who isn't an admin, confirmed directly, not assumed.
The worker sets the price, not the browser. event-detail.html sends pricePesewas, quantity, and admits from the client. The worker must read the real price from ticket_types and verify the Paystack charge server-side with the secret key, ignoring both the browser's price and any callback URL not on an allowlist. Also swap the pk_test Paystack key for the live one before real money moves.
Comps stay an admin action, not a workaround. event/sms.js currently writes a ticket with any type and an admit count from 1 to 10 with no payment attached. Don't just cap admit count to 1, a table of six can be a legitimate comp, record who issued it, and keep comps out of the raffle unless an admin explicitly marks one in.
Stop stored data from running as script. The calendar note field in script.js, and guest name, phone, and ticket id in event/tickets.html, go into innerHTML unescaped. Use text content or escape everywhere.

Done when: a stranger cannot send mail, list tickets, write a ticket, or register as admin. A replayed Paystack reference cannot be counted twice, and this is checked on the worker, not assumed.

Phase 2 — Make the existing ticket flow reachable

These are bugs, not new work, and they come before any new page.

Every Tickets control on the homepage, nav, hero, footer, currently scrolls to a call-or-WhatsApp block instead of opening the real checkout at events.html / event-detail.html. Point them at the real flow. One label everywhere: Get tickets.
The calendar shows the real night. Delete the fixed 34-date array and the hardcoded year in script.js, it should query Firestore directly rather than merge onto a static list. Importantly, empty Fridays and Saturdays still need to exist as bookable slots even with no event, or nobody can request a table or a private night. A cell shows the event name and opens the ticket page if one exists, shows Held if a private night was accepted, otherwise shows open.
Host tiles do something. Birthdays, Corporate, Concerts, and Private currently look clickable and aren't. Wire each to a short form with that type pre-chosen: date, name, phone, Instagram, one line about the night. A date already booked with a public event isn't offered. Submitting writes a request, it isn't confirmed until admin accepts it. The current five-step public wizard (gate estimates, revenue splits, GHS 500 charge) comes out entirely, that's not a guest-facing form.
ticket.html always shows 72HOURS AFAHYE PARTY. It must read the actual event from the ticket document, fix before the next night goes on sale.
Both scan buttons currently toast "coming soon" and stop. Ship real camera scanning, or remove the buttons, manual phone/token search can stay in the meantime.
One phone number, one email, everywhere. The homepage, the WhatsApp line, and the generated booking PDF currently show different contact details. Pull all of it from one settings document, confirm with Jeffery which pair is actually correct before writing it in.

Done when: from the homepage a guest can open a real night and pay, a confirmed event's name is visible on its date, Birthday opens a form, and a ticket never says 72 Hours unless that was the actual event.

Phase 3 — The public site, rebuilt around the night, not the form

Sequencing note: Phase 1 and Phase 2 ship first, on the current visuals, so ticket sales are safe and reachable as soon as possible. This phase is the deliberate rebuild that follows, not something squeezed in alongside the urgent fixes. Don't restyle piecemeal while Phase 1/2 are still in flight, that's how the site ends up with a fourth visual language on top of the three it already has.

The goal: a guest who taps a WhatsApp or Instagram link should feel "something is happening here" within about three seconds, on a phone, not "here is a booking form." Every screen below is designed mobile-first, desktop is the secondary case, not the other way around.

Visual identity. One system for the whole public site, extended from the ticket itself, the strongest existing idea in the codebase: condensed display type, stamps, torn/perforated edges, strong date typography, editorial poster framing. Base is near-black, primary accent is Memories crimson, supporting tones are warm off-white and muted grey, event artwork supplies the rest of the colour. No glassmorphism, no neon glow, no generic gold-luxury cliché, no stock nightclub photography. Confident, not decorated. Admin can look more conventional and data-dense than the public site, but both share the same type, colour tokens, buttons, and status treatments, so they still read as one product.

Homepage / hero. Answers what's happening, when, where, and how to join, immediately, artwork-dominant. "THIS FRIDAY, [event artwork], event name, date/time, venue, Get tickets, Book a table." If nothing's on sale, it shows the next open night instead of a dead end.

Nights. Not a SaaS three-column grid. A poster wall, one night at a time, artwork dominant, date treated like a stamp. No essay under each one.

Event detail. Artwork, date, name, time, venue, Get tickets, Book a table, then ticket options, table options, raffle if one's running, venue/location, share, in that order. Two lines of admin-editable description at most.

Mobile specifics. Large tap targets, a sticky bottom bar showing the running price and "Get tickets →" once a ticket type is selected, short forms (one or two fields per screen, not everything at once), fast-loading compressed artwork, real error states in plain language instead of a raw Firebase error or a screen that silently pretends something worked.

Table booking and Private Night both get the same treatment as the event flow: curated, visual, few words, no generic contact-form feel. Table packages shown as cards with what's included; bottle selection looks like a bar menu with a running total, not a spreadsheet. Private Night stays a short multi-step request (what, date, guest count, contact), never charged up front, and it must actually write to Firestore, not just show a success screen, confirm this is true today before assuming it's fine to leave as is.

See Phase 5 for the ticket purchase flow itself ("How are you showing up?", the live ticket preview, the ticket vs. the separate share card), that's the centrepiece of this rebuild and detailed enough to earn its own phase.

Phase 4 — Admin can change the site

This comes before the new ticket, the raffle, and tables, otherwise the next night is hardcoded again. Extend the admin that already exists, don't add a second admin login.

Upload a flyer and a hero image to Firebase Storage, save the URL on the event or on site settings, public pages already read artwork from that field.
Edit the night: name, start, doors, venue, short blurb, active, sold out.
Edit ticket types: name, admits count, price, on/off.
Edit that night's line list (Phase 5), raffle cap, and prize.
Edit table packages and the bottle list.
Edit the one phone, email, Instagram, and doors line.
See private-night requests, accept or decline.
See partial orders, resend the balance SMS.

Done when: a non-developer changes Saturday's flyer and price, reloads the public page, and sees it, with no deploy.

Phase 5 — The ticket people post, and the draw

The line. One ticket layout for every night, the guest picks the line, they don't type one and the system doesn't assign one at random.

Admin writes 8 to 12 lines per event (draft examples only, not live copy: Full repping. Fully active. Outside, correct. I came dressed. Cape Coast, locked in. The club replaces these before go-live).
At checkout, after name and phone: "How are you showing up?", they pick one line. The same line can be picked by more than one buyer, the ticket is theirs because of name plus line plus night.
On the ticket, the line is the large type, with first name, event, date, and Memories in small type underneath, QR and a short code in the corner, the flyer faded behind it.
Also generate a square, mostly-the-line share image for WhatsApp, drawn client-side in the browser (no extra server), shared via the phone's native share sheet plus a Download option.
If paying in installments, save the chosen line on the order at the start, print it only once the ticket is actually issued.
No rare line and no 1-in-50 ticket, that's a different mechanic from the draw below and deliberately kept separate.
Before payment, show a live preview of the actual ticket, artwork, event name, date, the line they picked, their name, updating as they fill in the form. This is the moment that should make someone actually want it, not just confirm what they typed.
The QR on the finished ticket encodes a secure verification token or URL, never the guest's name, phone, or email directly. The door's scanner looks that token up against Firestore, it doesn't read guest data off the code itself.

The draw. Not every ticket is in the raffle. Each event has a cap (default 20, admin-set) and a prize.

A spot is taken only when an online order becomes fully paid, and only if the cap isn't already full. The ticket and the raffle spot are written in one transaction, so two simultaneous payments can't both take the last place.
The event page shows "14 of 20 draw spots left", then "Draw closed", tickets keep selling after that.
A partial payment never takes a spot. A comp never takes a spot unless admin explicitly marks it in.
Those tickets look identical to every other ticket, plus the words "In the draw".
The draw itself runs server-side, or as a trusted admin action, never in the guest's browser. Store the winner, text them, show the name on the event page.
No separate raffle product, no extra fee.
Legal flag: a prize won only by paying can be treated as a lottery under Ghanaian law. This needs to read as a promotion attached to the ticket, not its own paid product, and Jeffery needs to confirm that framing with the club before the first prize of real value goes live. Don't launch a cash prize on an assumption.
The draw writes its own audit record: raffleId, eventId, drawnAt, drawnBy, eligibleEntryCount, winningTicketId. Anyone asking "was this draw fair" six months later should be answerable from that record alone.
Phase 6 — Tables

Tables start at GHS 2,000. The guest picks the night, picks a package, adds bottles, pays the total, this replaces the old venue-deposit form entirely.

Seed packages, all editable: Table 2,000. Floor table 3,500. Birthday table 4,500. Bottle list and prices come from the club, don't invent them.
The total can't fall below the package minimum, bottles are the actual bill, not a mystery fee on top.
Pay in full. No deposit that holds nothing, an unpaid booking is a phone call, not a mode inside this form.
Staff see the booking: night, package, bottles, amount, contact, paid status.
Phase 7 — Pay a ticket in bits

Not a MoMo number per guest, that can't be provisioned and Firebase can't watch a personal MoMo inbox. The memory is an order document, not a phone number.

One document per order, a short code like MEM-4821. Fields: phone, event, ticket type, quantity, server-computed price at creation time, the line they picked, first name, total due, amount paid, status.
Phone is only how they find the order again, a friend can pay from a different phone, the code is the real id.
Each top-up is a normal Paystack charge for whatever amount they choose, minimum GHS 10, up to the remaining balance, tagged with the order code.
Each payment is stored keyed by its Paystack reference, the same reference can't be applied twice.
Once amount paid reaches the total: issue one ticket, send it, only then take a raffle spot if any remain.
Until fully paid: no ticket, no share image, no raffle spot, no stock held against it, a GHS 10 deposit must never block a guest who's ready to pay in full elsewhere.
After every top-up, SMS the new balance and the same continuation link.
The continuation page looks up by order code or phone via the worker, it never lists orders straight from the browser.
An overpayment stays on the order for a manual refund, never issue a second ticket.
Decided: an unfinished payment plan is forfeited. If the balance isn't paid before the event, the amount already paid is kept and no ticket is issued, no refund.
Phase 8 — Organiser

A separate home, not the club admin. An organiser sees only events where organiserId is their own uid: tickets sold by type, money collected, money still owing on partial orders, check-in count, raffle spots taken, and the winner once drawn. They can't change price, flyer, lines, or the raffle cap. Checking in their own night is the only write they're allowed.

Not in this build
Any other repository, including the Supabase venue system.
A new backend, a mobile app, Apple or Google Wallet.
A MoMo number per customer.
Guest-typed text on the ticket.
A raffle entry on every ticket, a rare-line lottery, or bonus entries.
The promoter revenue split shown on a public page.
Holding stock against a half-paid ticket.
A second cloud platform for data storage. "No new backend" means no Express server, no separate database, nothing beyond Firebase (data) and Cloudflare Workers (all server-side logic), the two are the whole stack, not one or the other.
Confirm before the matching phase
Which phone number and email are the real public ones.
The real line list for the first night, placeholders must never go live.
Bottle names and prices, and whether the 2,000 / 3,500 / 4,500 package tiers are right.
Whether the organiser sees actual money figures or only counts, this plan currently gives them money for their own event only.
The first raffle prize, and the club's sign-off that the lottery-law framing above is acceptable.
Whether admin needs real role separation (super admin, event manager, door staff, promoter) or a single admin claim is enough for now, given Memories is one venue with a small staff. The organiser role in Phase 8 already covers the promoter case, door staff sharing the admin login is a smaller risk than the other gaps in this plan, but worth a deliberate yes or no rather than defaulting into it.
How to test
A logged-out browser can't list tickets or send SMS, but can open one ticket by its link.
A new signup can't open admin.
Homepage Get tickets opens a real event.
A Saturday with a confirmed event shows its name, with no hand-written date row.
Birthday opens the short form.
Changing a flyer and a price in admin shows on the public page with no deploy.
Two guests picking the same line get two different share images, since the names differ.
Paying the same Paystack reference twice doesn't double the balance, and creates only one ticket.
Order 20 is in the draw, order 21 isn't, a partial order never is.
Organiser A can't open organiser B's event.
