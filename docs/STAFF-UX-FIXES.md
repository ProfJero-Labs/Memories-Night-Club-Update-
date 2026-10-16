# Staff and usability fix list

From a functionality review (16 Oct 2026): every staff role walked through on a phone-size screen
(390px) in the dev build, from the invite text to each role's daily work, plus code review of what
each role can and can't do. Staff complaints were (1) signing in is hard, and (2) each role's screen
doesn't match or cover the job. Each item has an ID so fixes can be ticked off.

Priority: **P1** blocks work or is a security risk · **P2** slows staff down every night ·
**P3** polish. Status: ☐ open · ☑ fixed.

---

## A. Signing in and accounts (every staff member)

| ID | P | Status | Problem (what was seen) | Fix |
|---|---|---|---|---|
| A1 | P1 | ☐ | Staff sign in with an **email**, but they're invited and known by **phone**. Bouncers, bar staff and waitresses often don't use or remember the email the club typed for them. | Sign in with **phone number + password** (look the account up by its phone). Keep email as an option for managers. |
| A2 | P1 | ☐ | The invite text says *"Change it after your first sign-in"*, but **there is no way to change a password** anywhere in the system. | Force a new password on first sign-in; add **Change password** to every staff screen. |
| A3 | P1 | ☐ | **Forgot password** only sends a reset link by email. Staff with an unused or made-up email can never reset. | Reset by a code **texted to the phone on file**. Also a **Reset sign-in** button for managers that texts a new password. |
| A4 | P1 | ☐ | Changing or removing someone's role takes effect only when their sign-in token renews (**up to an hour**). A removed staff member keeps access; someone given a new role still sees the old screen or is refused. | Revoke the person's sessions on every role change, and have the Worker check the role on file (not only the token). Staff screens refresh the token on a 403. |
| A5 | P1 | ☐ | **Only the super admin** can add, change or remove staff. A manager or director can't add a new waitress or remove a door person who has left. | Managers and directors can invite, change and remove non-admin roles (door, bar, waitress, organiser, event manager). Only the super admin can make admins. |
| A6 | P1 | ☐ | The invite form and the change-role form both **default to Super admin**. One careless tap gives full control. | No default (must pick), or default to the lowest role. Confirm before making anyone super admin or director. |
| A7 | P2 | ☐ | Changing a role means **typing the person's email exactly**. The staff list has no Edit, Remove or Resend button per person, and shows a meaningless **UID** column. | One staff list: name, phone, role, last sign-in, and per-row **Change role · Reset sign-in · Remove**. Drop the UID column. |
| A8 | P2 | ☐ | The role key at the bottom of the Staff page is **out of date**: no Director, Waitress or Bar. | One role description, shown next to the role picker, always current. |
| A9 | P2 | ☐ | **Shared phones** (the door phone, the bar tablet) stay signed in forever. The next person works under the last person's name, so attendance and "admitted by" are wrong. | **Switch person** on the staff header; automatic sign-out at 6AM after a night; show who's signed in clearly at the top. |
| A10 | P2 | ☐ | **One role per person.** A manager can use the door, but bar staff covering the door, or a waitress helping the bar, can't without a new role from the super admin. | Allow more than one role per person, with a role switcher on the header. |
| A11 | P3 | ☐ | No **show password** toggle on sign-in (hard on a phone). | Add it. |
| A12 | P3 | ☐ | The invite password is sent in plain text and never expires. | Invite link with a one-time code that sets the password on first use (pairs with A2). |
| A13 | P2 | ☐ | Every staff header shows **App · My pass · Sign out** side by side; at the door a mis-tap signs the phone out mid-shift. | Put these in a small account menu (name ▾): My pass, Change password, Install app, Switch person, Sign out. |

## B. Door (door staff; also managers and organisers)

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| B1 | P1 | ☐ | After every scan the door must tap **Next** before the camera scans again: one extra tap per guest. | Keep scanning automatically; show each result for ~2 seconds, then scan again. |
| B2 | P1 | ☐ | The camera switches off when the phone screen locks; staff must tap **Scan QR** again. | Keep the screen awake while scanning; restart the camera by itself when the page comes back. |
| B3 | P1 | ☐ | Every check needs mobile data. With weak signal at the gate: *"No connection. Not checked."* | Offline mode: download tonight's ticket list when the night is chosen; check offline and sync when back (block duplicates on sync). |
| B4 | P1 | ☐ | Staff and members can only get in with the code in their app. If their phone is **dead or has no data**, there's no way in and **no manager override**. | Manager **Let in** with a reason (logged in attendance), and door lookup by name with the photo/ID check note. |
| B5 | P2 | ☐ | Name is optional when buying, so most tickets are **"Guest"**. Search by name doesn't work at the door; only the last 4 digits of the phone do. | Ask for the first name at checkout (still one field), or search by the full phone. Make the search hint say "last 4 of phone". |
| B6 | P2 | ☐ | A seated **table counts as 1** and isn't added to the door headcount. The door doesn't see the table's size, number or bottles. | Count table guests (package capacity, or ask how many arrived); show table number and bottles on seating. |
| B7 | P2 | ☐ | **No walk-in sales.** Guests paying cash or MoMo at the door can't be recorded, so revenue and headcount miss them. | **Walk-in** button: ticket type × number, cash or MoMo, recorded under the door person. |
| B8 | P2 | ☐ | The door can't add a **guest-list name** or a comp (artists, organiser's guests); only the control room can. | A night's guest list the organiser or manager fills; the door admits from it. Optional door comp with a reason, limited per night. |
| B9 | P2 | ☐ | No **capacity** limit or warning. | Capacity per night; the headcount turns amber and red near it. |
| B10 | P3 | ☐ | No list of who's **still expected** (tables not arrived, VIP names). | An "Expected" list under the headcount. |
| B11 | P3 | ☐ | A refused entry (cancelled or used ticket) isn't recorded. | Log refusals for the manager. |
| B12 | P3 | ☐ | "Or paste the ticket link" is a developer tool on the main door screen. | Hide it behind "Type a code". |

## C. Bar (bar staff)

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| C1 | P1 | ☐ | Bar staff **can't mark a drink "out tonight"**. The menu is control room only, so guests keep paying for drinks that have run out (then need refunds). | **Out / back** toggle per drink on the bar screen. |
| C2 | P2 | ☐ | The bar screen covers **app orders only**. Cash and MoMo orders at the counter aren't recorded, so bar sales totals are incomplete. | Quick **Sell** pad on the bar screen (drink × number, cash or MoMo). |
| C3 | P2 | ☐ | No **shift totals** (money in, by method, by drink). | Totals strip and an end-of-shift summary. |
| C4 | P3 | ☐ | "Can't make it" asks for a reason in a browser pop-up. | A one-tap list of reasons (out of stock, too busy…). |

## D. Waitress / waiter

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| D1 | P1 | ☐ | A waitress lands on the **bar screen**, whose main controls are bar decisions (**Pause app orders**, **QR codes**). There is **nothing for table service**. | A **Tables** screen of its own (the waitress home). |
| D2 | P1 | ☐ | Nobody's screen lists **tonight's tables**: who booked, table number, arrived or not, and the **bottles already paid for**. The bottles a table booked are invisible to the staff who serve them. | Tonight's tables: name, package, size, arrived, bottles booked, **Served** tick per bottle. |
| D3 | P2 | ☐ | App orders show "Table 4" but aren't assigned to anyone; two waitresses can take the same order. | **I'm taking it** on an order; shows who's serving it. |
| D4 | P2 | ☐ | A waitress can't take an order **at the table** for a guest (extra bottles). | Add to table: pick drinks; pay by MoMo prompt or record cash. |
| D5 | P3 | ☐ | Waitress sees "Pause app orders", which only the bar should control. | Hide bar controls for waitstaff. |

## E. Organiser

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| E1 | P1 | ☐ | **No guest list**: numbers only. An organiser can't see who bought, or check a name. | Guest list (first name, ticket type, checked in), searchable. |
| E2 | P1 | ☐ | **No view of their earnings.** "Money in" is the gross; their share and what's been paid out (settlements exist in the Worker, with no screen) are hidden. | Earnings: their share, paid out, still owed, per night, as a statement. |
| E3 | P2 | ☐ | Can't promote their own night: no **share link**, no **promo code** of their own. | Share link, and their own promo code (counted under their name). |
| E4 | P2 | ☐ | Can't add their own **guest list** names or request comps. | Ties to B8. |
| E5 | P3 | ☐ | Can't suggest changes to their night (time, flyer) except by calling the club. | "Request a change" sends to Event requests. |

## F. Director

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| F1 | P1 | ☐ | A director gets exactly the **manager's editing screens**, with no reports. That doesn't match a director's job (oversight). | Director home: **reports**: sales by day, week and month; by night; tickets vs tables vs bar; promos; refunds; organiser payouts; attendance. |
| F2 | P1 | ☐ | **No sales report or export** anywhere (only attendance has a CSV). | Date-range report with **Download CSV/PDF** for directors and managers. |
| F3 | P2 | ☐ | Approvals (large refunds, comps over a limit, new admins) have no sign-off step. | Optional director approval for these. |

## G. Manager and event manager (control room)

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| G1 | P1 | ☐ | Putting a night on sale takes **11 actions in 3 sections**: a new night starts hidden, and staff must remember to go back to Details, tick "On the public site" and save again, or it never goes on sale. | **New night wizard**: name, date, flyer, tickets → **Go live** (one checklist with what's missing). |
| G2 | P1 | ☐ | Five existing staff accounts show as **"without a membership"**, so they'd be stopped at the gate, despite "every staff member is a member automatically". | Create the missing memberships automatically (ask only for phones that are missing). |
| G3 | P2 | ☐ | The control room is large: **5 groups, 16 tabs**, and inside each night **7 sections plus 3 buttons** before content. | Role-based homes: each role sees only its jobs; group the rest under "More". |
| G4 | P2 | ☐ | Long pages on a phone: **Bar setup 5.4 screens, ticket and table editors 3.4, Overview 2.6**. | Compact lists with tap-to-edit; editors open as a sheet. |
| G5 | P2 | ☐ | **One Save button per row** in the ticket, table and drinks lists: edits on one row are lost when another is saved; "×" doesn't say if it removes or hides. | One Save per list, or autosave with an "Undo"; label actions ("Hide from sale"). |
| G6 | P2 | ☐ | **Jargon**: Comps, the draw, Pay in bits, Organizers' share, ledger, UID, heartbeat, health key, "Expected". | Plain words, with a short "what's this?" on the few that must stay. |
| G7 | P2 | ☐ | No **staff rota / who's working tonight** (attendance is after the fact). | Tonight's team: who's expected at door, bar and floor; who has checked in. |
| G8 | P3 | ☐ | Site settings: closed dates typed as YYYY-MM-DD text; file pickers show cut-off text ("No …sen"). | Date picker list; custom upload buttons. |
| G9 | P3 | ☐ | Payments tab opens with a long paragraph of explanation. | One line; details behind "How this works". |
| G10 | P3 | ☐ | Overview leads with finance terms (Memories' share, Organizers' share) for every CMS role. | Tonight first (tickets, in the door, bar orders); money for those who need it. |

## H. Members and staff passes

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| H1 | P1 | ☐ | Gate check takes **two people about six steps** (door types the number, taps Send, the member opens the app, reads the code, the door types it, taps Verify). | Pair with B4. Also: the member's open pass shows their name and photo large, and the door taps **Admit** after a visual check. |
| H2 | P2 | ☐ | No **photo** on member and staff passes (the door can't see it's the right person). | Photo on the member record and pass. |

## I. Guests (public site), smaller

| ID | P | Status | Problem | Fix |
|---|---|---|---|---|
| I1 | P3 | ☐ | Homepage is 3.7 screens long, with "Get tickets" twice; nights page nearly 5 screens. | Shorter homepage; one main action. |
| I2 | P3 | ☐ | Pay in bits forfeit rules are a lot to take in at checkout. | One sentence plus "Read more". |

---

## Suggested order

1. **Sign-in that works for staff:** A1–A6, A13. Phone sign-in, change and reset password by text, immediate role changes, and managers can manage staff.
2. **The door at full speed:** B1–B5, H1, G2.
3. **Screens that match each job:** D1–D3 (waitress Tables screen), C1 (drink out), E1–E2 (organiser guest list and earnings), F1–F2 (director reports and export).
4. **A simpler control room:** G1 (go-live wizard), G3–G6.
5. The rest (P3).
