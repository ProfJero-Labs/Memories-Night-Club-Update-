# Firestore Schema Map

## Existing / retained

### events/{eventId}
Expected public fields:
- name
- slug (optional)
- artwork
- date
- doors
- venue
- active
- visibility
- featured (optional)
- ticketLines (optional array)

### ticket_types/{ticketTypeId}
- eventId
- name
- pricePesewas
- admits
- remaining
- active

### pending_checkouts/{reference}
Created only by the Worker. Never client-written.

## New/extended collections

### table_packages/{packageId}
- eventId
- name
- pricePesewas
- description
- remaining (optional)
- active

### orders/{orderId}
- kind
- reference
- eventId
- eventName
- packageId/packageName or item details
- amountPesewas
- buyerName
- buyerPhone
- buyerEmail
- status
- createdAt

### tickets/{secureToken}
Public ticket document should contain only the information needed to display/verify the ticket:
- customerName
- type
- admitCount
- eventId
- eventName
- identityLine
- displayCode
- status
- revoked
- cancelled
- issuedAt
- reference

Do not store phone/email in public ticket documents unless the security model is changed accordingly.

### raffles/{raffleId}
- eventId
- enabled
- public
- title
- prize
- description
- status
- winnerEntryId
- winnerTicketId
- drawnAt
- drawnBy

### raffle_entries/{entryId}
- raffleId
- eventId
- ticketId
- status
- createdAt

### checkins/{checkinId}
- ticketId
- eventId
- checkedInAt
- checkedInBy

### private_event_requests/{requestId}
- name
- phone
- email
- date
- guests
- eventType
- message
- status
- createdAt

### audit_logs/{logId}
Recommended for future admin auditability.

### installment_plans/{planId}
`planId` is a short human-typeable order code (`MEM-####`), not an opaque id — the buyer's only
handle on the plan besides their phone number. Created only by the Worker. Never client-written
or client-read directly — buyers look themselves up through
`GET /api/installments/lookup?phone=` or `?code=`.
- eventId, eventName
- ticketTypeId, ticketTypeName, admits, quantity
- totalPesewas, paidPesewas
- buyerName, buyerPhone, buyerEmail
- identityLine
- status: `active` | `completed` | `forfeited`
- payments (array of `{reference, amountPesewas, paidAt}`)
- ticketIds, orderId (set once completed)
- createdAt, updatedAt

### events/{eventId} — added field
- organiserId (optional): uid of the Firebase Auth account granted the `organiser` role for
  this night. Powers the organiser-only overview (`GET /api/admin/organiser/overview`).
