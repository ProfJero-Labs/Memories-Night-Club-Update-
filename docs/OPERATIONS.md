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
| Waiter / waitress | **Tables** | *Quick sale* (drinks → Cash or MoMo), *Open a table* (number or no table, customer's name and phone), add drinks, *I got them* when the bar hands them over, *Send invoice (SMS)*, *Show bill (QR)*, *Customer paid* (cash or MoMo), close, *Bookings*, *My report* (sold, cash, MoMo, hand in my cash, submit) |
| Bartender | **Bar** | Waiter orders (Start → Ready → Hand to the waiter), confirm drinks a waiter took, drinks coming back, app (QR) orders; **Sell** (quick sale over the counter for cash or MoMo, my sales tonight, hand in my cash, my report); Stock (*Count the stock I met* when the bar opens, confirm new stock the manager added, record new stock, broken, move to another bar, mark a drink finished); Count (closing count) |
| Cashier | **Cashier** | Find a bill, record cash, receipts; My cash: open with the float, put cash in the safe, refund or pay out (manager approves), count the cash at the end |
| Front office | **Door** | Entrance (scan tickets, search), staff and members (code in their app, or *let in by name* if their phone is dead), Tables (arrivals, table number, people), Issues, end-of-night Report |
| Security | **Door** | Entrance and Issues only |
| Manager | **Tonight** | Purchases (*Buying drinks*: ask for what to buy), sales, stock and counts (explains differences), **cash from the staff** (receives each person's counted cash), customers (reviews, top customers), approvals, closing the night. Bottom: Tonight · Tables · Customers · More. Members. |
| Human manager | **Human manager** (hr.html) | The floor (open tables, free drinks and discounts) and the people: **staff accounts** (adds, changes, removes; texts PINs), members and attendance, **salaries** and payment details, bonuses, deductions, **loans**, the month's payroll (sends it to the directors), notices, **staff feedback**, **performance reviews**, customer reviews and complaints. |
| Event manager | **Control room** | Nights, tickets, prices, promotions, bookings, **organiser accounts**, table service, **discounts** (approves them), members. |
| Director (two) | **Tonight**, **Money**, **To approve** | **Approves every payment** (salaries, loans, bills, commissions, drinks purchases); either director can approve. Money shows money in, out, profit and **their own share** (e.g. 35% / 65%, set by the system admin). More: reports, salaries, bills and budget, commissions, customer reviews, staff feedback, performance reviews, tables, staff, members. Nothing from the ticket side. |
| DJ, MC (and every staff member) | **My page** (me.html) | Notices, the team message board, **My pay** (salary, payslips, loans), feedback or complaints (to the Human manager or the directors, anonymous if they like), their performance reviews. Everyone else opens it from the name menu. |
| System admin | **Control room** | Everything technical: the site, nights, tickets, promos, settings, system health, bar setup, and every report. |
| Finance officer | **Finance** | Today, **Money** (in, out, profit; add expenses), Stock (*Record drinks bought*, stock the manager added, the bar's counts and the manager's explanations; drinks, prices and costs), Check (staff reports, cash, approvals), Reports (end of day, sign off, print, CSV) |
| Events manager | Control room | Nights, tickets, tables, promos, bar setup (no money reports) |

## Quick sale (waiter or bar)

- **Bar → Sell**: pick the drinks → the customer pays → **Cash received** or **MoMo received**
  (with the MoMo transaction ID). Serve the drinks. Done: it's out of the bar's stock and in the
  bartender's sales and cash.
- **Waiter → Quick sale**: same, then the order goes to the bar. When the bar hands it over the
  waiter taps **I got them** and the sale closes by itself.
- A drink that has run out at the bar shows as *finished* and can't be picked, for waiters, the bar
  and the QR menu. The QR menu refuses before the customer pays, so nobody pays for a drink the
  bar doesn't have.
- End of shift (waiter: My report; bar: Sell): **Hand in my cash** (count it; a difference needs a
  reason) and **Submit my report**.

## A customer orders from a waiter (no QR)

1. Waiter: **Open a table** → table number (or **Walk-in**), and the customer's name and phone if
   they want the invoice by text → **Add drinks** → **Send to bar**.
2. Bar: the order appears with the table, tab number and waiter. **Start** → **Ready** →
   **Hand to Efua**. At that moment the drinks leave the bar's stock.
   - If the waiter picks the drinks up without the bartender tapping anything, the waiter taps
     **I took them from the bar**. The bar sees "Efua says they took Tab 3" and taps **Confirm**
     (the drinks leave the stock) or **Not taken** (back on the list). Nothing leaves the stock
     until the bar confirms. **Handed over tonight** lists every order that left the bar.
3. Waiter: **I got them ✓** (one tap). Drinks the customer didn't take: **Send back to bar** (the
   bar taps *Got them back*). Broken: **Broken** (off the bill, shows in the waiter's report).
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

- **Drinks & prices** (finance sets them; others look): name, group, unit, selling price, **cost price
  (required, so the profit can be worked out)**, low-stock warning,
  counted at the bar or not, on sale. New orders use the current price; a bill keeps the price it
  was sent with. Every change records who, when, the old value and the new value (*Who changed what*).
- **Drinks bought** (finance): the manager buys the drinks and brings them in; finance records each
  purchase (drink, how many, total paid, supplier, receipt). It is the bar's stock straight away,
  and the cost goes into the money report.
- **New stock during the night** (manager): recorded on Stock; finance sees it, and the bartender
  taps **Got 12** (or *Different number*, with what happened) before it counts. Stock a bartender
  records needs finance or a manager to confirm. Nobody confirms their own.
- **Moved between bars**, **broken**: recorded by the bar, the manager or finance. Nothing in the
  stock records is ever deleted.
- **Expected stock** = opening + received + moved in + returned − handed out − broken − moved out.
  Stock carries on from night to night even without a count.
- **When the bar opens (Friday, Saturday):** the bartender taps **Count the stock I met** and enters
  what's there. Sales don't wait for it. Any difference against the system ("3 fewer Club beer") is
  flagged on the manager's Tonight screen; the manager explains it (the manager holds the keys) and
  finance sees the explanation. From the count on, the bar sells from what it actually found.
- **Nothing sells past zero**: what's left = expected stock − orders at the bar not yet handed over.
- **Closing count:** the bar types what it counts; any difference shows straight away ("3 fewer than
  expected") and needs a reason. A submitted count is locked; a correction needs approval from
  someone else, and the first count is kept.

## Money and expenses

- **Expenses** (manager or finance): what for (staff pay, DJ and artists, rent, light and water,
  fuel, security, cleaning, repairs, adverts, ice and supplies, transport, other), details, amount,
  paid with, which night. A mistake is *taken off* with a reason and stays on record, crossed out.
- **Money** (director, manager, finance) for tonight, this week or this month:
  **Money in** = drinks paid for + the club's share of tickets and tables; **Money out** = drinks
  bought + expenses; **Profit** = in − out. Drinks also show *sold*, *what they cost us* (from each
  drink's cost price) and *made on drinks*. Drinks with no cost price are listed so finance can add it.

## Bills and the month's budget (finance)

- **Finance sets them** (Money → *Bills this month*): each bill is who it's owed to (staff salaries,
  landlord, a drinks supplier…), what for, the amount and the date it must be paid by. **Pay** records
  all or part of it; the payment counts as an expense in Money out (a drinks supplier bill doesn't:
  those drinks were counted when finance recorded them as bought). A bill added by mistake is
  *taken off* with a reason.
- **The budget**: how much the club plans to spend this month on each thing (drinks, staff pay,
  rent…), shown against what's actually been spent; over budget is flagged.
- **Copy last month's bills and budget** starts a new month with the same salaries, rent and so on,
  unpaid, due on the same day.
- **The director** sees it all (bills this month, paid, still to pay, overdue, budget against
  spending) but doesn't change it.

## Commissions (10% on tables over GHS 3,000)

- A **deal** is a table that sells for more than GHS 3,000: a table booked online (what the customer
  paid), or a table in the club (what's been paid on its bill). The person who brought it earns
  **10% of the whole amount**. (The rate and the line are `COMMISSION_RATE_PCT` and
  `COMMISSION_OVER_PESEWAS` in `worker/src/ops/commission.js`.)
- **Who brought it**: the waiter can say when opening the table (*Did someone bring this table?*);
  the manager or finance can name or change it on Money → *Commissions* (until it's paid).
- **Finance pays** a person everything owed for the month in one tap; it becomes one expense under
  *Commissions* (Money out). A paid deal can't be moved to someone else.
- **The director** sees, month by month: what's still to pay out, what's been paid, who is owed, and
  every deal (sold for how much, served by whom, brought by whom).

## Customer reviews

- After paying (the bill link, the QR receipt, *My night*), customers are asked **How was your
  night?** (1–5 stars, a comment, a name and phone if they want a call back), then shown the club's
  Instagram, Facebook and TikTok to follow. The review page is `review.html` (a table card can link
  to `review.html?s=table`).
- A low rating (1–2) is a complaint: the Manager or the Human manager follows it up and notes what
  was done. The directors read every review, with the average per night.

## Payments tonight and top customers (manager, director, finance)

- **Tonight → Payments tonight**: every payment, newest first: time, amount, how it was paid, who
  served. Tap one for what was bought, who took the payment, who served, the table, the customer and
  the MoMo reference. A table's payment shows the table's whole bill.
- **Top customers**: who spent the most tonight, by phone number (the phone on the table or quick
  sale, the MoMo number that paid, or the QR order's phone). Waiters and the bar can add the
  customer's phone on a quick sale; sales with no phone are counted but not named.
- **QR customers** see *My night: what I've spent* on the menu after their first paid order:
  everything paid tonight from their phone. The menu has a search box that forgives spelling
  mistakes ("henikin" finds Heineken; "coke" finds Coca-Cola).

## Payments need a director (any director)

- **Salaries**: fixed monthly. The Human manager sets each person's salary and how they're paid
  (MoMo or bank), adds bonuses and deductions during the month, and **sends the month** to the
  directors. A director approves (or sends it back with what to change); finance pays each person;
  they get a text and their payslip on My page. It shows in Money out (Staff pay).
- **Loans**: the Human manager records it (amount, what for, how much comes off each salary); a
  director approves; finance pays it out (Staff loans); the repayment comes off each month's pay.
- **Bills** (finance) and **commissions** (finance or a manager asks): a director approves; then
  finance pays.
- **Buying drinks**: the Manager asks (the screen shows each drink's stock against its minimum and
  maximum, and suggests how many); finance checks it (above the maximum needs a reason); a director
  approves the money; the Manager buys it and records it on Stock against that purchase; the bar
  confirms it arrived.
- Directors see all of it on **To approve**; finance sees what's ready on **To pay**.

## Cash

- Cashier opens the shift with the **float**. Cash taken is added automatically from the bills.
- **Expected cash** = float + cash taken + float added − put in the safe − refunds − payouts.
- At the end: count the cash (waiters and bartenders: *Hand in my cash*). The cash then goes to the
  **Manager**, who confirms what they received (*Cash from the staff*); a difference needs a note.
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
