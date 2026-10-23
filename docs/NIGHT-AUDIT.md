# How the night works between the staff: audit (October 2026)

Each question asked, how the system answers it, and what was added. "Tested" means a test in
`worker/test/` or `dev/e2e.test.mjs` runs it.

## Waiters and the bar

| Question | Answer | |
|---|---|---|
| Can a waiter easily open a tab? | Yes: *Take an order* opens a table (a number, or none for someone standing at the bar) and sends the drinks to the bar in one step. | Tested |
| Several tabs open while serving others? | Yes: every open table stays on *My tables* until it's closed. | Tested |
| Take drinks from the bar, with records between them? | Yes. The bar taps *Hand to Efua* (or the waiter taps *I took them* and the bar confirms). That moment is recorded: who, what, when, and the drinks leave the bar's stock. The bar's *Waiters* tab (bar manager: *Sellers*) lists what each waiter was given and what's still unpaid. | Tested |
| Add drinks to a tab? | Yes: *Add drinks* on the table, any time while it's open. | Tested |
| Replace a drink? | Yes: *Return or swap* → *Swap*. The drink goes back to the bar (off the bill once the bar has it) and the new one goes to the bar. | Existing |
| Close the tab? | Yes: *Close* → cash (taken there and then), MoMo (a prompt on the customer's phone, closes itself once paid), or *they owe it* (name and phone, so it can be collected). Every drink must be collected first, so the bill is final. | Tested |
| An invoice must not look paid | It says **INVOICE … TO PAY GHS X** until fully paid; only then **RECEIPT**, with how it was paid and who took it. | Tested |
| Can the customer pay from the text? | Yes: the invoice has a link to the bill, which pays by MoMo or card (Paystack). | Tested |
| Can a waiter mark an online payment as paid? | No. Online payments count only when Paystack confirms them. The waiter sees it arrive on the table. MoMo sent to the club's own number is recorded with its transaction ID (once only) and listed for finance to check against the statement. | Tested |

## New: the bar manager

A separate role from bartenders (the Human manager or a director adds them). Everything a bartender
does, plus:
- **Approves the bar's stock:** new stock the bar recorded, the closing count, count corrections.
- **Receives cash** from waiters **and** bartenders, then hands it all to the Manager.
- **Sellers:** everyone selling tonight: what they took from the bar, what's paid, what's owed.
- **Night accounts** (below).

Anyone selling can record a cash sale: waiters and the bar (*Sell*: a quick sale, cash or MoMo).

## New: the night's accounts, made simple

1. The bar counts what's left.
2. The system works out what left the bar, and the money those drinks should bring.
3. It adds up what accounts for it: cash, MoMo and online payments, what customers still owe (by
   name), approved free drinks, breakages and discounts.
4. **Short = drinks missing at the bar + cash missing.** Every seller is listed with their drinks,
   payments and cash (recorded, counted, handed in). Whoever isn't aligned is red, with the reason in
   plain words.

Every drink that leaves the bar ends up on a bill, so the drinks side always balances seller by
seller. A shortage can only be drinks missing at the bar (the count) or cash that isn't there, and
the screen names which and who. Tested with a worked example in `worker/test/ops-night.test.js`.

## Tickets and orders

| Question | Answer | |
|---|---|---|
| Does the Manager see ticket sales, not just the nights? | Now yes: More → **Tickets tonight**: sold online and at the gate (cash, MoMo, by seller), by type, guest list, tables, how many came in. | Tested |
| Does the front office have a report of tickets sold? | Now yes: the end-of-night report shows tickets sold (online, gate, gate cash and MoMo, guest list), and More → *Tickets sold*. | Tested |
| A table order nobody could find | Fixed: **Find an order** (Manager, front office, bar manager and others). Type the table code (TBL-…), the phone number or the name: the night, package, bottles, paid how, arrived, table number. Phones show only the last four digits. | Tested |

## Still to watch

- MoMo sent to the club's own number is only as good as the transaction ID typed. Finance should
  tick them off against the MoMo statement (they're listed in Today's sales and Night accounts).
- *Should bring* uses today's prices: a price changed during the night shows as "Other difference".
- None of this reaches the live site until the Cloudflare build for the Worker is fixed (Root
  directory = `worker`).
