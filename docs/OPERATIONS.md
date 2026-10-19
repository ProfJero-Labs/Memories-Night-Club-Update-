# Running the night: staff guide and how it works

This covers the venue side of the system: signing in, waiters' tabs, the bar, stock, cash, the
front office and security, and closing the night. Written in plain words so it can be used for
training.

## Signing in (everyone)

- Staff sign in with their **phone number and PIN**. Floor staff have a **4-number PIN**; managers,
  directors, finance and the system admin have **6 numbers** (they control money, stock and staff).
- **Adding staff:** a manager (or director, or the system admin) adds each person once: Control room
  → People → Staff → *Add a staff member* (name, phone, job) → **Add and text their PIN**. The
  system picks their PIN and texts it to them; the manager also sees it on screen, in case the text
  doesn't arrive. They sign in straight away with their phone number and that PIN.
- **Staff added before PINs** (or anyone without one): Staff → **Text PINs to everyone without one**.
- **Changing the PIN is optional:** name button (top right) → *Change my PIN*.
- **Forgot PIN:** on the sign-in page, type the phone number and tap *First time, or forgot your
  PIN? Text me one*. The new PIN works for 30 minutes; the old one keeps working until the new one
  is used. Or a manager taps **Send a new PIN** on their row.
- **Who can add whom:** the system admin adds and changes anyone (managers, directors, finance,
  other admins). A director adds anyone except system admins. A manager adds floor staff (not
  managers, directors or finance).
- **Wrong PINs:** 5 in a row locks the PIN for 15 minutes; 10 locks it until a new PIN is sent.
- **The name button** has: My pass (for the gate), Change my PIN, Install the app, Sign out.
- **Staff are full-time:** they stay signed in every night until they tap *Sign out*. (Temporary
  staff aren't added to the system for now.) On a shared phone, sign out at the end of the shift.
- Older accounts can still use *Sign in with email instead*. To move them to PIN sign-in, add their
  phone number (Staff → Change), then *Send PIN*.
- A job change or removal works **at once**, on every phone, without waiting.

## Who does what

| Job | Opens on | Does |
|---|---|---|
| Waiter / waitress | **Tables** | Open a table (number or walk-in, customer's name and phone), add drinks, send to the bar, *I took them from the bar*, follow each order, *Send invoice (SMS)*, *Show bill (QR)*, *Customer paid* (cash or MoMo), close, *Bookings*, *My report* |
| Bartender | **Bar** | Waiter orders (Start → Ready → Hand to the waiter), confirm drinks a waiter took (*Confirm* / *Not taken*), *Handed over tonight*, drinks coming back, app (QR) orders, Stock (deliveries, broken, move to another bar, mark a drink finished), Count (closing count) |
| Cashier | **Cashier** | Find a bill, record cash, receipts; My cash: open with the float, put cash in the safe, refund or pay out (manager approves), count the cash at the end |
| Front office | **Door** | Entrance (scan tickets, search), staff and members (code in their app, or *let in by name* if their phone is dead), Tables (arrivals, table number, people), Issues, end-of-night Report |
| Security | **Door** | Entrance and Issues only |
| Manager / director | **Control room → Today’s sales** | Today’s sales, Close the night, Approvals, Drinks & prices, Stock, End-of-day reports, Staff, everything else in the control room |
| Finance officer | **Finance** | Today, Check (staff reports, cash and stock differences, approvals), Stock (received, counts), Reports (end of day, sign off, print, CSV), Prices (and who changed what) |
| Events manager | Control room | Nights, tickets, tables, promos, bar setup (no money reports) |

## A customer orders from a waiter (no QR)

1. Waiter: **Open a table** → table number (or **Walk-in**), and the customer's name and phone if
   they want the invoice by text → **Add drinks** → **Send to bar**.
2. Bar: the order appears with the table, tab number and waiter. **Start** → **Ready** →
   **Hand to Efua**. At that moment the drinks leave the bar's stock.
   - If the waiter picks the drinks up without the bartender tapping anything, the waiter taps
     **I took them from the bar**. The bar sees "Efua says they took Tab 3" and taps **Confirm**
     (the drinks leave the stock) or **Not taken** (back on the list). Nothing leaves the stock
     until the bar confirms. **Handed over tonight** lists every order that left the bar.
3. Waiter: **I have them** → **Delivered**. Drinks not taken: **Send back to bar** (the bar taps
   *Got them back*). Broken: **Broken** (off the bill, shows in the waiter's report).
4. **Show bill to customer**: the customer scans the QR (or gets the link by text), sees every
   drink and pays with **Pay now** (MoMo or card on Paystack). It shows as paid only once Paystack
   confirms it on the server. If drinks are added while they pay, the new drinks stay owed.
   **Send invoice (SMS)** texts the customer every drink, the total, what's paid and what's left,
   with the pay link.
5. Cash or MoMo to the club's number: the waiter taps **Customer paid** → **Cash** or **MoMo**.
   For MoMo, type the **transaction ID** from the MoMo text (and the number it came from, if you
   like). The same ID can't be recorded twice, and Today's sales lists every MoMo ID for finance
   to check against the MoMo statement. Cash goes in the waiter's cash for the night (their
   report). The cashier can also take cash.
6. **Close tab** when everything is delivered and paid.
- More rounds: **Add drinks** again on the same tab. Part payments are fine.
- Free drink, money off, or a customer who can't pay: **Ask the manager**. Nothing changes until
  someone else approves it.
- Customers who prefer the QR at the bar still order the old way; both use the same menu and stock.

## Discounted tickets (promos)

- The price a customer pays is always worked out by the system: with a promo, Paystack is asked for
  the discounted price. Pay in bits starts from the discounted total, so "left to pay" is the
  discounted rest.
- The ticket says it was discounted: the promo, what was paid and the full price (crossed out). The
  text message and the pay-in-bits pages say it too.

## Prices and stock

- **Drinks & prices** (manager, finance): name, group, unit, selling price, cost, low-stock warning,
  counted at the bar or not, on sale. New orders use the current price; a bill keeps the price it
  was sent with. Every change records who, when, the old value and the new value (*Who changed what*).
- **Stock received**, **moved between bars**, **broken**: recorded by the bar or by the manager or
  finance. Nothing in the stock records is ever deleted.
- **Expected stock** = opening + received + moved in + returned − handed out − broken − moved out.
  The opening comes from the last closing count (or a first opening count on the very first night).
- **Closing count:** the bar types what it counts; any difference shows straight away ("3 fewer than
  expected") and needs a reason. A submitted count is locked; a correction needs approval from
  someone else, and the first count is kept.

## Cash

- Cashier opens the shift with the **float**. Cash taken is added automatically from the bills.
- **Expected cash** = float + cash taken + float added − put in the safe − refunds − payouts.
- At the end: count the cash. Any difference needs an explanation. The system never changes the
  figures to make them match. A manager or finance marks the count reviewed (not the same person).

## Closing the night

1. **Waiters** submit *My report*. Drinks still with them, or unpaid bills, need an explanation.
2. **Bar** submits the closing count.
3. **Cashier** submits the cash count.
4. **Front office** submits its report (open issues handed over or explained).
5. **Manager**: Control room → Tonight → *Close the night*. Each step shows who has finished.
   Review the differences, decide the approvals, then **Close the night and send the report**. If
   something is missing, it asks first and lists it in the report.
6. The **end-of-day report** is saved and emailed to the finance email (set it under End-of-day
   reports → *Where the report is sent*). If the email can't be sent, the screen says so: the
   report is always saved in the system.
7. **Finance** opens it (Finance → Reports), checks it, and signs it off. The person who closed the
   night can't sign off for finance. A closed night is locked: no new drinks or stock entries for
   it. An unpaid bill can still be paid later, or written off with approval.

## Setting up for live use

- Deploy the Worker (`cd worker && npm ci && npm run deploy`) and the site (Cloudflare Pages).
- Email for the end-of-day report: set the Worker secrets `BREVO_API_KEY` and `BREVO_SENDER_EMAIL`,
  then set the finance email in the control room. Without them, reports are saved, not emailed.
- Existing staff: add their phone numbers (Staff → Change), then tap *Text PINs to everyone without
  one*. Then People → Members → *Make them all members*.
- Products: check each drink's price, cost and "counted at the bar" under Drinks & prices. Then each
  bar does an **opening count** (Bar → Stock) the first night.

## How it's built (for developers)

- Worker: `worker/src/staffauth.js` (PIN sign-in, staff), `worker/src/ops/` (`stock.js`, `tabs.js`,
  `cash.js`, `approvals.js`, `frontoffice.js`, `closing.js`, `router.js`). Routes: `/api/staff-auth/*`
  (public, rate limited), `/api/ops/*` (signed-in staff; the role is checked in each function),
  `/api/guest/bill/:token` (the customer's bill link: read and pay only).
- Pages: `login.html`, `waiter.html`, `bar.html` (+ `pages/bar-ops.js`), `cashier.html`,
  `finance.html`, `checkin.html` (+ `pages/front-ops.js`), `bill.html`; shared `public/lib/ops-ui.js`
  and `public/lib/ops-views.js`; styles `public/ops.css`.
- New collections (server only): `tabs`, `rounds`, `stock_moves`, `stock_counts`, `cash_sessions`,
  `approvals`, `staff_reports`, `eod_reports`, `shifts`, `incidents`, `change_log`, `counters`,
  `config`. Staff records `users/{uid}` now hold name, phone, PIN hash (PBKDF2), lock state.
- Tests: `worker/test/staffauth.test.js`, `worker/test/ops-night.test.js` (the brief's scenarios),
  and the browser journeys in `dev/e2e.test.mjs` ("staff sign-in…", "a night at the bar…").
  Dev logins: phones `0200000001`–`0200000012`, PIN `2580` (or `258025` for 6-number roles); see
  `dev/seed.mjs`.
