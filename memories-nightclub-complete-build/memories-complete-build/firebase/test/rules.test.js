// Real Firestore Security Rules test, run against Google's own rules emulator (not a mock we
// wrote ourselves) — loads the actual firebase/firestore.rules from this repo and fires real
// authenticated/unauthenticated read+write attempts at it, exactly as a client SDK would.
// No live project, no real credentials, no network egress to production: everything here is
// local and disposable.
//
// Run with: firebase emulators:exec --project=security-test-demo-project --only firestore
//           "node --test ."
// (see ../firebase.json / package.json in this folder)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

let testEnv;

before(async () => {
  // Resolved relative to this file, not cwd, so it doesn't matter whether this is invoked via
  // `npm test` from firebase/test/ or via `firebase emulators:exec` from firebase/.
  const rulesPath = fileURLToPath(new URL('../firestore.rules', import.meta.url));
  testEnv = await initializeTestEnvironment({
    projectId: 'security-test-demo-project',
    firestore: {
      rules: readFileSync(rulesPath, 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

// Seed fixtures as the emulator's built-in admin bypass (ignores rules entirely — this is how
// we get known data into place before testing whether *other* callers can read/write it).
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('events').doc('evtPublic').set({ name: 'DEMO Night', visibility: 'public', active: true, date: '2027-01-01T00:00:00.000Z', organiserId: 'organiser-uid-A' });
    await db.collection('events').doc('evtPrivate').set({ name: 'DEMO Private Night', visibility: 'private', active: true, date: '2027-01-01T00:00:00.000Z' });
    // Must be non-public, otherwise the visibility=='public' clause alone would grant read access
    // to anyone and the test wouldn't actually exercise organiser-scoping at all.
    await db.collection('events').doc('evtOrganiserOwned').set({ name: 'DEMO Organiser Night', visibility: 'private', active: true, date: '2027-01-01T00:00:00.000Z', organiserId: 'organiser-uid-A' });
    await db.collection('events').doc('evtInactive').set({ name: 'DEMO Inactive Night', visibility: 'public', active: false, date: '2027-01-01T00:00:00.000Z' });
    await db.collection('ticket_types').doc('ttActive').set({ eventId: 'evtPublic', name: 'Standard', pricePesewas: 5000, active: true });
    await db.collection('ticket_types').doc('ttInactive').set({ eventId: 'evtPublic', name: 'Retired', pricePesewas: 5000, active: false });
    await db.collection('tickets').doc('tok1').set({ customerName: 'Ama', eventId: 'evtPublic', status: 'valid' });
    await db.collection('orders').doc('order1').set({ eventId: 'evtPublic', buyerPhone: '0240000000', amountPesewas: 5000 });
    await db.collection('checkins').doc('c1').set({ ticketId: 'tok1', eventId: 'evtPublic' });
    await db.collection('raffles').doc('raffle1').set({ eventId: 'evtPublic', public: true, enabled: true, status: 'open' });
    await db.collection('raffle_entries').doc('e1').set({ raffleId: 'raffle1', ticketId: 'tok1', status: 'eligible' });
    await db.collection('pending_checkouts').doc('ref1').set({ reference: 'ref1', buyerEmail: 'a@test.com', status: 'pending' });
    await db.collection('private_event_requests').doc('req1').set({ name: 'Ama', phone: '024', email: 'a@test.com' });
    await db.collection('installment_plans').doc('MEM-1234').set({ buyerPhone: '024', totalPesewas: 10000, paidPesewas: 0 });
    await db.collection('users').doc('uidA').set({ email: 'a@test.com', role: 'organiser' });
    await db.collection('audit_logs').doc('log1').set({ action: 'RAFFLE_DRAWN' });
    await db.collection('settings').doc('site').set({ phone: '0555000000', venue: 'Cape Coast' });
  });
}

test('setup: seed fixtures via rules-disabled admin context', async () => { await seed(); });

// ── Unauthenticated (anonymous, no sign-in at all) ──
test('anonymous: can read a public+active event, but not a private or inactive one', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(db.collection('events').doc('evtPublic').get());
  await assertFails(db.collection('events').doc('evtPrivate').get());
  await assertFails(db.collection('events').doc('evtInactive').get());
});

test('anonymous: can read an active ticket type, not an inactive one', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(db.collection('ticket_types').doc('ttActive').get());
  await assertFails(db.collection('ticket_types').doc('ttInactive').get());
});

test('anonymous: can get a ticket by its own id, but cannot list the tickets collection', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(db.collection('tickets').doc('tok1').get());
  await assertFails(db.collection('tickets').get());
});

test('anonymous: can read a public raffle, not raffle_entries', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(db.collection('raffles').doc('raffle1').get());
  await assertFails(db.collection('raffle_entries').doc('e1').get());
});

test('anonymous: every staff-only / write-only collection refuses both read and write', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const cases = [
    ['orders', 'order1'], ['checkins', 'c1'], ['pending_checkouts', 'ref1'],
    ['private_event_requests', 'req1'], ['installment_plans', 'MEM-1234'], ['audit_logs', 'log1'],
  ];
  for (const [col, id] of cases) {
    await assertFails(db.collection(col).doc(id).get());
    await assertFails(db.collection(col).doc(id).set({ hacked: true }));
  }
});

test('anonymous: cannot write to any locked collection, including the ones it can read', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(db.collection('events').doc('evtPublic').set({ name: 'PWNED' }));
  await assertFails(db.collection('events').doc('newEvt').set({ name: 'PWNED', visibility: 'public', active: true }));
  await assertFails(db.collection('tickets').doc('tok1').update({ status: 'used' }));
  await assertFails(db.collection('raffles').doc('raffle1').update({ status: 'drawn', winnerTicketId: 'tok1' }));
  await assertFails(db.collection('ticket_types').doc('ttActive').update({ pricePesewas: 1 }));
});

// ── Signed in, but no staff custom claims at all (a plain customer account) ──
test('a signed-in customer with no custom claims has the same restrictions as anonymous', async () => {
  const db = testEnv.authenticatedContext('customer-uid', {}).firestore();
  await assertFails(db.collection('events').doc('evtPrivate').get());
  await assertFails(db.collection('tickets').get());
  await assertFails(db.collection('events').doc('evtPublic').set({ name: 'PWNED' }));
  await assertFails(db.collection('orders').doc('order1').get());
  await assertFails(db.collection('users').doc('uidA').get(), 'a customer cannot read someone else\'s user/role record');
});

test('a signed-in customer CAN read their own users/{uid} record', async () => {
  const db = testEnv.authenticatedContext('uidA', {}).firestore();
  await assertSucceeds(db.collection('users').doc('uidA').get());
});

// ── Signed in with a staff role claim, but not the admin boolean claim ──
// This is the exact shape setRole() in the Worker issues for manager/eventManager/doorStaff —
// only superAdmin gets admin:true. Confirms firestore.rules' role() helper is unused/dead: these
// roles get NO extra direct-Firestore access beyond a plain customer, by design (they operate
// through the Worker, which checks the role claim itself).
test('doorStaff / manager / eventManager custom claims grant no extra direct Firestore access', async () => {
  for (const role of ['doorStaff', 'manager', 'eventManager']) {
    const db = testEnv.authenticatedContext(`staff-${role}`, { role }).firestore();
    await assertFails(db.collection('tickets').doc('tok1').update({ status: 'used' }), `${role} should not be able to check in a ticket via direct Firestore write`);
    await assertFails(db.collection('events').doc('evtPublic').set({ name: 'PWNED' }), `${role} should not be able to edit an event directly`);
    await assertFails(db.collection('orders').get(), `${role} should not be able to list orders directly`);
  }
});

// ── superAdmin (admin:true) — positive control, proves the emulator+rules aren't just denying
// everything indiscriminately ──
test('admin:true can read and write the collections locked to everyone else', async () => {
  const db = testEnv.authenticatedContext('super-1', { admin: true }).firestore();
  await assertSucceeds(db.collection('events').doc('evtPrivate').get());
  await assertSucceeds(db.collection('events').doc('evtPublic').set({ name: 'Renamed', visibility: 'public', active: true }, { merge: true }));
  await assertSucceeds(db.collection('orders').get());
  await assertSucceeds(db.collection('ticket_types').doc('ttActive').update({ pricePesewas: 6000 }));
});

// ── organiser role, scoped strictly to events they own — the exact scenario BUILD_PLAN.md's
// own "how to test" checklist calls out: "Organiser A can't open organiser B's event." ──
test('organiser can read their own PRIVATE event (not visible to the public), but a stranger organiser cannot', async () => {
  const ownerDb = testEnv.authenticatedContext('organiser-uid-A', { role: 'organiser' }).firestore();
  await assertSucceeds(ownerDb.collection('events').doc('evtOrganiserOwned').get(), 'organiser-uid-A owns evtOrganiserOwned (organiserId set in seed) and it is not public, so this can only succeed via organiserOf()');

  const strangerDb = testEnv.authenticatedContext('organiser-uid-B', { role: 'organiser' }).firestore();
  await assertFails(strangerDb.collection('events').doc('evtOrganiserOwned').get(), 'organiser-uid-B does NOT own evtOrganiserOwned — this is the "Organiser A can\'t open organiser B\'s event" case from docs/BUILD_PLAN.md\'s own test checklist');
});

test('an organiser with no role claim mismatch cannot read a public+active event through anything but the public clause (sanity check organiserOf is not accidentally too permissive)', async () => {
  const strangerDb = testEnv.authenticatedContext('some-other-uid', {}).firestore();
  // evtPublic is public+active, so this SHOULD succeed — via the public clause, not organiserOf.
  await assertSucceeds(strangerDb.collection('events').doc('evtPublic').get());
  // evtOrganiserOwned is private and owned by someone else — this must fail.
  await assertFails(strangerDb.collection('events').doc('evtOrganiserOwned').get());
});

test('organiser role never grants write access, even to their own event', async () => {
  const db = testEnv.authenticatedContext('organiser-uid-A', { role: 'organiser' }).firestore();
  await assertFails(db.collection('events').doc('evtOrganiserOwned').update({ active: false }), 'organiser is read-only per docs/BUILD_PLAN.md ("can\'t touch price, artwork, or the raffle")');
});

// ── site settings — public read (the public site displays contact info directly), admin write ──
test('settings: anyone (including anonymous) can read, nobody but admin:true can write', async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(anon.collection('settings').doc('site').get());
  await assertFails(anon.collection('settings').doc('site').set({ phone: 'PWNED' }));

  const customer = testEnv.authenticatedContext('some-uid', {}).firestore();
  await assertFails(customer.collection('settings').doc('site').set({ phone: 'PWNED' }));

  const organiser = testEnv.authenticatedContext('organiser-uid-A', { role: 'organiser' }).firestore();
  await assertFails(organiser.collection('settings').doc('site').update({ phone: 'PWNED' }), 'organiser is read-only everywhere, settings included');

  const admin = testEnv.authenticatedContext('super-1', { admin: true }).firestore();
  await assertSucceeds(admin.collection('settings').doc('site').set({ phone: '0555111111', venue: 'Cape Coast' }));
});
