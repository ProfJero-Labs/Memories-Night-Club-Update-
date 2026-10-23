# Running the night: staff guide and how it works

This covers the venue side of the system: signing in, waiters' tabs, the bar, stock, cash, the
front office and security, and closing the night. Written in plain words so it can be used for
training.

## Using the screens (everyone)

Every screen follows the same few rules, so nothing new has to be learned on a busy night:

- **← Back** sits at the top of every screen that isn't a main tab, and returns to where you came
  from. The phone's back button does the same, and it closes a panel without leaving the screen.
  Panels slide up from the bottom and always have ✕. The Memories logo goes to your work screen.
- **Lists first, details on tap**: people, drinks, stock and payments are one line each; tap one to
  see everything about it and what you can do. Long lists have a search box.
- **One main button** (crimson) per screen. Forms open only when you tap "+ Add".
- **Writing**: boxes are big and grow as you type; Send stays above the keyboard. Where it helps,
  one-tap quick replies (e.g. "Wrong amount", "Not in this month’s budget" when refusing).
- **Numbers** open the number keyboard; phone numbers open the phone keyboard.
- **Smart paste**: when recording MoMo, tap **Paste the MoMo text**: the transaction ID (and the
  amount and number where it can) is read from the customer's MoMo message; just check it.
- **Payment texts for the Manager**: every MoMo or card payment (bill link, QR menu, and MoMo a waiter
  or bartender records) texts the Manager with the amount and tonight's MoMo/card total. Cash isn't
  texted (it's counted at the cash count). A Manager can be switched off with `paymentAlerts: false`
  on their staff record.
- **Signing in**: the phone saves the everyday PIN once and fills it in after that. A PIN that comes
  by text ("New or forgot PIN? Text me one") is read from the SMS by Android, and offered above the
  keyboard on an iPhone.
- **Bar**: Orders · Sell · Stock · My shift. Bar settings (which bar, pause app orders, QR codes,
  sound) are behind the ⚙ line at the top. Counts are under Stock.
- **Automatic checks**: `dev/ux.test.mjs` measures every screen on a phone-sized browser on every
  change (text size, box size, button size, a way back, no sideways scroll), so these can't slip back.

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
| Manager | **Tonight** | **Expenses** (More → Expenses: tonight, 7 days, this month; add one, take one off), **Nights coming up** (More: tickets sold and left, tables booked; read only), purchases (*Buying drinks*: ask for what to buy), sales, stock and counts (explains differences), **cash from the staff** (receives each person's counted cash), customers (reviews, top customers), approvals, closing the night. Bottom: Tonight · Tables · Customers · More. Members. |
| Human manager | **Human manager** (hr.html) | The floor (open tables, free drinks and discounts) and the people: **staff accounts** (adds, changes, removes; texts PINs), members and attendance, **salaries** and payment details, bonuses, deductions, **loans**, the month's payroll (sends it to the directors), notices, **staff feedback**, **performance reviews**, customer reviews and complaints. |
| Event manager | **Control room** | Ticket money (tickets sold, payments, orders), **organiser accounts**, table service, **discounts** (approves them), members, the door and gate sales. **Serves tables like a waiter** (name menu → *Serve tables*): opens a table, sends drinks, takes cash or MoMo, closes it. The website and the nights are now Media's. |
| Media | **Control room → Nights** | **The website and the nights**: add and change nights, tickets and prices, table packages, bottles sold online, promotions, the prize draw, guest lists (free tickets), flyers and videos, event requests from the website. On payroll: the Human manager adds them and sets their pay. No money, no settings, no door. |
| Director (two) | **Tonight**, **Money**, **To approve** | **Approves every payment** (salaries, loans, bills, commissions, drinks purchases); either director can approve. Money shows money in, out, profit and **their own share** (e.g. 35% / 65%, set by the system admin). More: reports, salaries, bills and budget, commissions, customer reviews, staff feedback, performance reviews, tables, staff, members. Nothing from the ticket side. |
| DJ, MC (and every staff member) | **My page** (me.html) | Notices, the team message board, **My pay** (salary, payslips, loans; not for the directors, who aren't on payroll), feedback or complaints (to the Human manager or the directors, anonymous if they like), their performance reviews. Everyone else opens it from the name menu. |
| System admin | **Control room** | Everything technical: the site, nights, tickets, promos, settings, system health, bar setup, and every report. |
| Finance officer | **Finance** | Today, **Money** (in, out, profit; add expenses), Stock (*Record drinks bought*, stock the manager added, the bar's counts and the manager's explanations; drinks, prices and costs), Check (staff reports, cash, approvals), Reports (end of day, sign off, print, CSV; **Waiters, one by one**: each waiter's sales, paid and unpaid, cash and MoMo they took, drinks not delivered, breakages, free drinks, tips, and their report or that it's missing) |
| Events manager | Control room | Nights, tickets, tables, promos, bar setup (no money reports) |

## The gate (front office, security, organisers)

The Door screen is where the entrance is run. Phone numbers are the main ID: a person's number shows everything they have for the night. Scanning QR codes still works.

**Front office** (tabs: Entrance, Sell, Check, Tables, More):
- **Sell**: pick a ticket (the price at the door) or a table, type their phone number (it's their ticket) and, if you like, their name. Then:
  - **Took GHS … cash**: the sale is recorded at once, the ticket is texted to them and they count as in. The cash goes into your cash for the night; hand it in from the same screen (**Hand in my cash**) and the Manager counts it.
  - **MoMo prompt on their phone**: a payment prompt appears on the customer's phone; the sale records itself when they approve. If the prompt can't be sent, a payment link is texted to them and shown as a QR on your screen. Nothing counts as sold until MoMo confirms it, so a sale can't be faked. The Manager is not texted for gate sales.
  - **Customers scan to buy**: a big QR for the queue; they buy on their own phone at the online price.
- **Tables**: how many of each table are free, held or booked. Sell one, or **Hold 30 min** for a name; a hold lets go by itself after 30 minutes, or tap **Let it go**.
- **Members**: type their number, they read you the code from their app. Someone already in tonight can't be let in again with a code: if they went out and came back, they show their app and you tap **Back in**.
- **More**: Counts, Issues and the End of night report.

**Security** (tabs: Check, Entrance, Issues): type anyone's number (or their ticket code) on **Check**. The screen says **PAID**, **MEMBER** or **NOT IN THE SYSTEM**, whether they have **VIP access** (a table, or a ticket marked VIP), and the detail: how they paid, who sold it and when they came in. Someone not in the system: tap **Report to the Manager** (it goes to Issues).

**Friends joining a table**: on Check, open *A friend joining a table*, type the table code and the friend's number. The table's owner gets a 4-digit code by text; if they know the friend, they read it to you and you confirm. The friend then has VIP access too. A table never takes more people than it holds.

**Organisers** see only their own night: Entrance, Check (the same as security) and **Counts**: everyone inside, online tickets in, bought at the gate (cash and MoMo), tables arrived, free passes and members. They can hold anyone at the entrance until Check shows they paid, are a member or have a table.

**Control room**: each ticket can have a price **At the door** (blank means the same as online) and a **VIP** tick (gets into the VIP area). A ticket named "VIP" counts as VIP too.

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

Every step is one tap, and the waiter is never stuck on one table.

1. **New tab**: one screen has the drinks, the table (empty if they're standing) and, if they
   like, the customer's phone → **Send to bar**. The waiter is straight back on **My tables**,
   free to open another tab or do a **Quick sale**.
2. Bar: the order appears with the table, tab number and waiter. **Start** → **Ready** →
   **Hand to Efua**. At that moment the drinks leave the bar's stock.
   - If the waiter picks the drinks up without the bartender tapping anything, the waiter taps
     **I took them from the bar**. The bar sees "Efua says they took Tab 3" and taps **Confirm**
     (the drinks leave the stock) or **Not taken** (back on the list).
3. Waiter: **I got them ✓**. The drinks are on the tab.
4. Back on the tab (tap it on My tables): **Add drinks** or **Close tab**.
   - **Return or swap**: on a delivered order. Pick the drink and how many → **Swap** (it goes
     back to the bar and the menu opens for the new drink) or **Just return it**. It comes off the
     bill when the bar taps *Got them back*. **Broken**: off the bill, in the waiter's report.
   On **My tables** every open tab shows **Add drinks** and **Close tab** right on it.
5. **Close tab** asks one question: **Cash or MoMo?** (Every order must be collected first, so
   the bill is final.)
   - **Cash** → **Got GHS … cash · close**: it goes in the waiter's cash for the night, the tab
     closes, and the receipt is texted if there's a number.
   - **MoMo** → a MoMo prompt goes to the customer's phone and the invoice (every drink, the total
     and a pay link) is texted to them. They approve the prompt, or pay from the link, or scan the
     QR on the waiter's screen. The tab closes by itself once Paystack confirms the payment; the
     waiter can go back to My tables meanwhile.
- **More** on a tab: show the QR to pay, text the invoice now, a part payment or MoMo sent to the
  club's number (with its transaction ID), and **Ask the manager** (a free drink, money off, or a
  customer who can't pay; nothing changes until someone else approves it).
- The bar's **Waiters** tab shows every waiter's tables tonight: the drinks the bar gave them,
  table by table, and what's still unpaid.
- Customers who prefer the QR at the bar still order that way; both use the same menu and stock.

## Table bookings reach the team

A table booked online shows straight away on the waiter's **Bookings**, the front office's
**Tables** and the manager's **Tables** screens: tonight's, and **Coming up** for the next 30
nights (who, which table, the door code, bottles paid). The event managers and managers are also
texted who booked it (name, phone, table, night, bottles, door code). Anyone who doesn't want
these texts: set `bookingAlerts: false` on their staff record.

If a guest pays but the booking doesn't appear: the payment check runs every 10 minutes, finishes
any paid booking it finds and texts the people on the alert list if it can't.

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
  A QR order being paid holds its drinks (30 minutes), so two guests can't buy the last bottle.
  It's checked before anyone pays, so there are no refunds for finished drinks.
- **No refunds at the bar**: once an order is paid (a QR order or a quick sale), the bar can't
  cancel it. Only the Manager can, as a last resort (e.g. a bottle broke), and it goes to Refunds.
  A table order isn't paid yet, so the bar can still say it can't make it.
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

## Tips

A tip is the staff member's money, never the club's: it is kept apart from the bill, so it is
never in sales, money in or profit.

- **Who can be tipped**: anyone on the team (waiters, bartenders, security, DJ, MC, managers…), not
  the directors or the system admin. The customer says who; the person serving is picked by default.
- **With a payment**: on *Customer paid* (a table) or a quick sale, open **Customer gave a tip**,
  enter the amount and who it's for. With MoMo, one transaction for bill and tip is fine: they
  share the transaction ID.
- **Without a bill** (e.g. a customer tips the DJ): **Record a tip (no bill)** on the waiter's and
  the bar's screens. Only people who take payments can record one.
- **On the bill link and the QR menu** the customer picks a tip (GHS 10, 20, 50 or another amount)
  and who it's for. It's charged with the drinks and split off when Paystack confirms it. If the
  Manager cancels a paid QR order (last resort), the tip is refunded with the drinks.
- **Cash tips**: the person keeps them. They are not in the cash the waiter or bartender hands in.
- **MoMo and card tips** come into the club's account, so the club owes them to the person.
  **Finance pays them out weekly** (*To pay → Tips owed to staff*), with no director needed since
  it's the staff's own money. MoMo tips sent to the club's number show their transaction IDs:
  check them on the statement first. The person gets a text when a tip arrives and when it's paid.
- **Each person** sees their tips on **My page → My pay → My tips**: tonight, this week, owed to me,
  paid to me, cash I kept. Waiters and bartenders also see *My tips tonight* on their report.
- **Reports**: the night's sales report and the Money screen show tips separately (MoMo on the
  statement = MoMo sales + MoMo tips), and *Payments tonight* shows the tip on each payment.

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

## Who closes the night

- **The Manager closes the night.** Not the directors (they can look: *How closing is going*).
- If the Manager can't be there: Close the night → **I can't close tonight**, with the reason. The
  Human manager and the Event manager are texted, and a notice goes to the managers. The first to tap
  **I'll close tonight** is responsible for closing that night, and only they (or the Manager) can.

## Payments need a director (any director)

- **Salaries**: fixed monthly. The Human manager sets each person's salary and how they're paid
  (MoMo or bank), adds bonuses and deductions during the month, and **sends the month** to the
  directors. A director approves (or sends it back with what to change); finance pays each person;
  they get a text and their payslip on My page. It shows in Money out (Staff pay).
  The directors aren't on payroll: the Human manager can't set a salary, bonus or loan for a
  director, and directors don't count in the month's salaries.
- **Loans**: the Human manager records it (amount, what for, how much comes off each salary); a
  director approves; finance pays it out (Staff loans); the repayment comes off each month's pay.
- **Bills** (finance) and **commissions** (finance or a manager asks): a director approves; then
  finance pays.
- **Buying drinks**: the Manager asks (the screen shows each drink's stock against its minimum and
  maximum, and suggests how many); finance checks it (above the maximum needs a reason); a director
  approves the money; the Manager buys it and records it on Stock against that purchase; the bar
  confirms it arrived.
- **Expenses** (manager or finance, on the night): finance sets in the month's budget **the most one
  expense can be without a director**. At or under it, it counts at once; above it, it waits on
  **To approve** and doesn't count in Money out until a director approves. No limit set yet: every
  expense waits.
- **Performance reviews**: the Human manager reviews the staff; the directors review the managers,
  the Human manager included.
- Directors see all of it on **To approve**; finance sees what's ready on **To pay**.

## Cash

- Cashier opens the shift with the **float**. Cash taken is added automatically from the bills.
- **Expected cash** = float + cash taken + float added − put in the safe − refunds − payouts.
- At the end: count the cash (waiters and bartenders: *Hand in my cash*). The cash then goes to the
  **Manager**, who confirms what they received (*Cash from the staff*); a difference needs a note.
- At the end: count the cash. Any difference needs an explanation. The system never changes the
  figures to make them match. A manager or finance marks the count reviewed (not the same person).

## Closing the night

Four steps, and nothing blocks the close:

1. **Every tab closed, paid or owed.** That is the waiter's report: there is nothing else to
   submit. **Close tab** → Cash, MoMo, or **They can't pay now: customer owes** (their name and
   phone; they're texted the invoice to pay later, and the Manager sees it under what's owed).
2. **Cash in: waiters → the bar → the Manager.** The bar person is the custodian of the drinks,
   so the cash goes there. The waiter: *My report* → **Hand GHS … to the bar**. The bar person:
   *Waiters* tab → *Cash from waiters* → **Received** (a different amount needs a note). It joins
   the bar person's own cash, and they **Hand all my cash to the Manager** (My shift); the Manager
   confirms it. Waiters take cash without any setting.
3. **The bar counts its stock** (Stock → the closing count).
4. **Close**: Control room → Tonight → *Close the night*. The end-of-day report is saved and sent
   to finance (email set under End-of-day reports → *Where the report is sent*). Anything not done
   yet is listed in it. Finance opens it (Finance → Reports) and signs it off; the person who
   closed the night can't sign off for finance. Finance's **Today** shows cash and MoMo up front.

Closing is for the accounts only. It never stops anyone working: staff can keep opening tabs,
selling, taking payments and counting stock after it. A night can be closed at any time, and
closed again later (**Close again and send the updated report**). Each close saves a new version
of the report.

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
