// Ledger: who earns what, per paid order.
//
// Money flow
// ----------
// Every payment lands in EvolveIT's Paystack account. EvolveIT distributes the Memories share
// and the organizer share out of band. There is no Paystack split — this module just computes
// the three amounts so every order carries its own audit trail and the admin dashboard can show
// each party what they're owed without recomputing anything.
//
// Three parties per sale:
//   EvolveIT    — set per event by a super admin (falls back to EVOLVEIT_SHARE_PCT env var)
//   Organizer   — set per event by the club (0 for club nights)
//   Memories    — the remainder
//
// The snapshot is taken at checkout-initiation time and copied onto the order at fulfillment, so
// a later change to the event's rates never rewrites what someone already earned.

export const EVOLVEIT_DEFAULT_PCT = 20;

export function computeShares(amountPesewas, { evolveitSharePct, organizerSharePct } = {}, fallbackEvolveitPct) {
  const amount = Math.max(0, Math.round(Number(amountPesewas) || 0));

  let evolveit = Number(evolveitSharePct);
  if (!Number.isInteger(evolveit) || evolveit < 0 || evolveit > 100) {
    evolveit = Number(fallbackEvolveitPct);
    if (!Number.isInteger(evolveit) || evolveit < 0 || evolveit > 100) evolveit = EVOLVEIT_DEFAULT_PCT;
  }

  let organizer = Number(organizerSharePct);
  if (!Number.isInteger(organizer) || organizer < 0 || organizer > 100) organizer = 0;

  // If the two rates sum over 100, reduce the organizer's — never produce a negative Memories share.
  if (evolveit + organizer > 100) organizer = Math.max(0, 100 - evolveit);

  const evolveitSharePesewas = Math.round(amount * evolveit / 100);
  const organizerSharePesewas = Math.round(amount * organizer / 100);
  const memoriesSharePesewas = amount - evolveitSharePesewas - organizerSharePesewas;

  return {
    amountPesewas: amount,
    evolveitSharePct: evolveit,
    organizerSharePct: organizer,
    memoriesSharePct: 100 - evolveit - organizer,
    evolveitSharePesewas,
    organizerSharePesewas,
    memoriesSharePesewas,
    capturedAt: new Date().toISOString(),
  };
}