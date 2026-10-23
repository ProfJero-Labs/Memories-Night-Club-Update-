# Roles: who opens what, and who can do what

Every rule here is enforced by the Worker (the back end), not only hidden on screen. Typing an address
doesn't get anyone past their role. The Firestore and Storage rules match for the website parts.

## Each role

| Role | Opens on | Can | Can't |
|---|---|---|---|
| **System admin** | Control room | Everything, including site settings, system health, bar station setup, and making other admins | – |
| **Director** (two) | Tonight · Money · To approve | Approve every payment (salaries, loans, bills, commissions, drinks purchases), money in/out/profit and their share, reports, staff, reviews, members | Set up the website or nights; ticket money is the Event manager's |
| **Manager** | Tonight | Tables, cash from the staff, approvals (free drinks, discounts, write-offs), **expenses**, buying drinks, stock and counts, closing the night, **nights coming up (read only)**, members | The website, nights, settings, payroll |
| **Human manager** | Human manager page | Staff accounts (front office, security, bar, floor, cashier, DJ, MC, **Media**), salaries, loans, payroll, notices, feedback, performance reviews, customer reviews; free drinks and discounts on the floor | Money approvals, the website |
| **Event manager** | Control room | Ticket money (tickets sold, payments, orders), organiser accounts, discounts, the door and gate sales, serving tables like a waiter | **The website and the nights (now Media's)** |
| **Media** | Control room → Nights | **The website and the nights**: nights, tickets and prices, table packages, bottles sold online, promotions, the prize draw, guest lists, flyers and videos, event requests | Money, settings, the door, staff |
| **Finance officer** | Finance | To pay (what directors approved), money, expenses, budget, stock and costs, end-of-day reports and sign-off, **each waiter's night and report** | Approve payments (directors do) |
| **Waiter / waitress** | My tables | Open tables (or walk-ins), send drinks, take cash or MoMo, send the bill, ask for approvals, their own report | See other waiters' money |
| **Bartender** | Bar | The bar queue, handovers, quick sales, breakages, stock counts | Prices, approvals |
| **Cashier** | Cashier | Find a bill, take cash, their cash shift | Approve refunds or payouts |
| **Front office** | Door | Tickets at the entrance, gate sales, table bookings and arrivals, issues, their report | Money reports |
| **Security** | Door | Entrance checks, incidents | Gate sales, tables |
| **DJ, MC** | My page | Notices, the team board, their pay, feedback, their reviews | – |
| **Organiser** (outside) | Organiser | Their own nights only | Anything else |

## Who approves what

| Request | Approved by (never by the person who asked) |
|---|---|
| Free drink | Manager, director, Human manager, admin |
| Discount | Manager, director, Human manager, Event manager, admin |
| Unpaid bill written off | Manager, director, finance, admin |
| Cash out | Manager, director, finance, admin |
| Stock count correction | Manager, director, finance, admin |
| Salaries, loans, bills, commissions, drinks purchases | A director (finance then pays) |
| An expense above the month's limit | A director |

## Who adds whom

- **System admin:** anyone, including other admins.
- **Director:** anyone except an admin.
- **Human manager:** front office, security, bartenders, waiters, cashiers, DJ, MC and **Media**. They set salaries for all of them.
- **Event manager:** organisers only.

## Where it lives in the code

- Role groups: `worker/src/lib/auth.js` (`CMS` = the website and nights, `NIGHTS_VIEW`,
  `TICKET_MONEY`, `REPORTS`, `STAFF_ADMIN`, `canAssign`, `HR_ROLES`).
- Approvals: `worker/src/ops/approvals.js`. Payroll: `worker/src/ops/payroll.js`.
- Home screens: `public/staff.js` (`HOMES`). Control room tabs: `public/admin.js` (`TABS`).
- The tests that hold it in place: `worker/test/authz-matrix.test.js` (every admin route, every role)
  and `worker/test/staffauth.test.js` (Media).
