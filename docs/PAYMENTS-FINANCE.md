# Payments, costs and the night's finances

Three separate things, never mixed:

| | What it is | Who pays | Where it's set |
|---|---|---|---|
| **Service charge** | Added to the customer's bill when paying through the site | The customer | More → Service charge & commission (director or admin) |
| **Paystack's processing fee** | What Paystack takes on each payment | Deducted by Paystack from what it settles | Paystack's terms; read from Paystack per payment |
| **Developer commission** | What the club owes the developers per eligible successful payment | The club (recorded as payable) | More → Service charge & commission (off until agreed) |

## Formulas

- **Service charge** = `min(product subtotal × rate, cap)`, once per bill, never below 0; 0 when off.
  Defaults: rate 5%, cap GHS 100. The product subtotal is after discounts and excludes tips.
- **Total payable** = product subtotal + service charge (+ a tip, if the customer adds one).
  This is the exact amount sent to Paystack and checked when Paystack confirms.
- **Paystack fee** = Paystack's own `fees` figure for the payment. If Paystack hasn't given it, the
  payment says *fee pending*; it is left out of totals (never estimated) and the payment check fills
  it in later. Settlement matching also fills it from Paystack's settlement records.
- **Developer commission** (when on) = `rate × basis` or a fixed amount per payment, where basis is
  one of: the products (default), products + service charge, or the service charge only. Only for
  the payment kinds and channels ticked. Refunded payment: reversed (default) or kept, as configured;
  if it was already paid out, it's marked *to recover*.
- **Club-borne payment cost** (per payment) = `max(0, Paystack fee + commission − service charge)`.
  On a big bill the capped charge doesn't cover the costs; the club bears the rest, shown openly.
- **Expected settlement** (per night) = collected through Paystack − Paystack fees − refunds paid
  back. The commission is not deducted by Paystack: it is payable separately.
- **Outstanding settlement** = expected settlement − what Paystack's settlements say was settled.
  Payments not matched to a successful Paystack settlement are pending, never shown as received.
- **Net product sales** = gross product sales − discounts − product refunds. The service charge and
  tips are reported separately and are not product sales.

## The payment ledger

Every successful Paystack payment gets one record, `payment_ledger/{reference}`, written when
Paystack confirms it (the reference is the id, so repeated notices or retries can't duplicate it):
product subtotal, discount, service charge with its rate and cap, tip, collected, channel,
Paystack's fee and its status, commission with the rule it used, club-borne cost, expected net,
settlement status, refund status. Failed, abandoned or mismatched payments get none. Changing the
settings never changes a record.

## The night's finances (directors: More; finance: Reports)

A. Sales · B. Payments and settlement · C. Every transaction (completed, paying, left at Paystack,
failed, refund owed, refunded), filterable by payment channel, downloadable as a spreadsheet.
- **Check Paystack settlements** asks Paystack for its settlements and matches each payment.
- **Record what was received** stores what actually reached the club for the night (with where
  it came from); every change is kept.
- **Commission paid** (a director) marks the night's payable commission as paid, with a note.
- **Pricing simulation** (on the settings screen): charge, total, Paystack fee (the club's actual
  average from recorded payments, or an estimate clearly labelled, or *unknown*), commission,
  club-borne cost and proceeds per bill size; drinks' margins after payment costs, and draft prices.
  Nothing is saved; prices change only when finance edits them.

## Needs management approval / not settled by the code

1. **Who holds the Paystack account.** The code says every online payment lands in **EvolveIT's**
   Paystack account and EvolveIT pays Memories out of band. "Settled per Paystack" is therefore
   what Paystack settled to that account; "Received by the club" is what finance records.
2. **The existing EvolveIT share.** Tickets and tables already carry an EvolveIT share (10% by
   default, `EVOLVEIT_SHARE_PCT`, or per night). If EvolveIT is the development team, the new
   developer commission could double up with it. The commission is **off**; agree one arrangement
   before turning it on.
3. **Commission terms.** No rate is built in: rate, basis, kinds, channels and refund treatment must
   be agreed and then entered by a director or the admin. Chargebacks: there is no chargeback feed
   from Paystack in this system; mark a chargeback as a refund to reverse the commission.
4. **Who may change settings.** Directors and the admin (the night Manager runs drinks and tables
   only, as agreed earlier). Finance can view.
5. **Settlement splitting.** Not set up (no Paystack subaccounts/split codes in this system). The
   commission is recorded as payable only; nothing is deducted from anyone's settlement.
6. **Shifts.** The system has one shift per night, so the report filters by night and channel, not
   by shift.
7. **Compliance.** Confirm with the accountant how the service charge and the commission are booked
   (chart of accounts, tax), and that a customer service charge on electronic payments is
   acceptable under Ghanaian rules and Paystack's merchant terms. The charge is disclosed before
   payment; no separate processing surcharge is added.
