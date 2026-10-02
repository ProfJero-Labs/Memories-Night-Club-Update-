// Firestore + Storage security rules, run against Google's own emulators (not a mock).
//   cd firebase/test && npm install && npm test
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, collection, query, where, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const rules = f => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-memories-rules',
    firestore: { rules: rules('firestore.rules'), host: '127.0.0.1', port: 8080 },
    storage: { rules: rules('storage.rules'), host: '127.0.0.1', port: 9199 },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'events/pub'), { name: 'Public', visibility: 'public', active: true, organiserId: 'org-a' });
    await setDoc(doc(db, 'events/priv'), { name: 'Private', visibility: 'private', active: true, organiserId: 'org-b' });
    await setDoc(doc(db, 'tickets/secret-token'), { customerName: 'Ama', eventId: 'pub', status: 'valid' });
    await setDoc(doc(db, 'orders/o1'), { buyerPhone: '0241234567', eventId: 'pub' });
    await setDoc(doc(db, 'installment_plans/MEM-AB1234'), { buyerPhone: '0241234567' });
    await setDoc(doc(db, 'private_event_requests/r1'), { phone: '0241234567' });
    await setDoc(doc(db, 'settings/site'), { venue: 'SamRit Hotel' });
    await setDoc(doc(db, 'raffles/r'), { public: true, winnerDisplayName: 'Ama K.' });
    await setDoc(doc(db, 'raffle_entries/e'), { ticketId: 'secret-token' });
    await setDoc(doc(db, 'audit_logs/a'), { action: 'RAFFLE_DRAWN' });
  });
});
const anon = () => env.unauthenticatedContext().firestore();
const as = (uid, claims) => env.authenticatedContext(uid, claims).firestore();

test('no browser can open, list or query tickets, even with the token (the Worker serves tickets)', async () => {
  for (const db of [anon(), as('new-user', {}), as('org-a', { role: 'organiser' })]) await assertFails(getDoc(doc(db, 'tickets/secret-token')));
  await assertFails(getDocs(collection(anon(), 'tickets')));
  await assertFails(getDocs(query(collection(anon(), 'tickets'), where('eventId', '==', 'pub'))));
});

test('nobody writes business data from a browser — not the public, not a new signup, not even a super admin', async () => {
  for (const db of [anon(), as('new-user', {}), as('boss', { admin: true, role: 'superAdmin' })]) {
    await assertFails(setDoc(doc(db, 'tickets/forged'), { status: 'valid' }));
    await assertFails(setDoc(doc(db, 'events/pub'), { name: 'Hacked' }, { merge: true }));
    await assertFails(setDoc(doc(db, 'ticket_types/t'), { pricePesewas: 1 }));
    await assertFails(setDoc(doc(db, 'settings/site'), { phone: '000' }));
    await assertFails(setDoc(doc(db, 'raffles/r'), { status: 'drawn' }, { merge: true }));
    await assertFails(deleteDoc(doc(db, 'tickets/secret-token')));
  }
});

test('guest contact details are never readable from a browser', async () => {
  for (const db of [anon(), as('new-user', {}), as('org-a', { role: 'organiser' })]) {
    for (const p of ['orders/o1', 'installment_plans/MEM-AB1234', 'private_event_requests/r1', 'raffle_entries/e', 'audit_logs/a', 'checkins/x', 'pending_checkouts/x', 'members/x', 'member_passes/x', 'member_codes/x', 'member_entries/x', 'phone_sessions/x', 'recon_alerts/x', 'system/reconcile']) {
      await assertFails(getDoc(doc(db, p)));
    }
  }
});

test('public reads: live events, settings; not private nights, not raffles (the winner code admits at the door)', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'events/pub')));
  await assertFails(getDoc(doc(anon(), 'events/priv')));
  await assertSucceeds(getDoc(doc(anon(), 'settings/site')));
  await assertFails(getDoc(doc(anon(), 'raffles/r')));
  await assertFails(getDoc(doc(as('org-a', { role: 'organiser' }), 'raffles/r')));
  await assertSucceeds(getDoc(doc(as('boss', { admin: true, role: 'superAdmin' }), 'raffles/r')));
});

test('an organiser can read their own private night but not another organiser’s', async () => {
  await assertFails(getDoc(doc(as('org-a', { role: 'organiser' }), 'events/priv')));
  await assertSucceeds(getDoc(doc(as('org-b', { role: 'organiser' }), 'events/priv')));
});

test('flyer uploads: site staff only, images only, under 8 MB; anyone can view', async () => {
  const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const st = (uid, claims) => (uid ? env.authenticatedContext(uid, claims) : env.unauthenticatedContext()).storage();
  await assertFails(uploadBytes(ref(st(), 'event-art/a.jpg'), img, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('new', {}), 'event-art/a.jpg'), img, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('door', { role: 'doorStaff' }), 'event-art/a.jpg'), img, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(st('em', { role: 'eventManager' }), 'event-art/a.svg'), img, { contentType: 'image/svg+xml' }));
  await assertFails(uploadBytes(ref(st('em', { role: 'eventManager' }), 'elsewhere/a.jpg'), img, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(st('em', { role: 'eventManager' }), 'event-art/a.jpg'), img, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(ref(st('boss', { admin: true, role: 'superAdmin' }), 'event-art/b.webp'), img, { contentType: 'image/webp' }));
  await assertSucceeds(getBytes(ref(st(), 'event-art/a.jpg')));
});

test('hero videos: site staff only, MP4/WebM/MOV only, under 60 MB', async () => {
  const clip = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const st = (uid, claims) => (uid ? env.authenticatedContext(uid, claims) : env.unauthenticatedContext()).storage();
  await assertFails(uploadBytes(ref(st(), 'event-art/v.mp4'), clip, { contentType: 'video/mp4' }));
  await assertFails(uploadBytes(ref(st('door', { role: 'doorStaff' }), 'event-art/v.mp4'), clip, { contentType: 'video/mp4' }));
  await assertFails(uploadBytes(ref(st('em', { role: 'eventManager' }), 'event-art/v.avi'), clip, { contentType: 'video/x-msvideo' }));
  await assertSucceeds(uploadBytes(ref(st('em', { role: 'eventManager' }), 'event-art/v.mp4'), clip, { contentType: 'video/mp4' }));
  await assertSucceeds(uploadBytes(ref(st('mgr', { role: 'manager' }), 'event-art/v.webm'), clip, { contentType: 'video/webm' }));
  await assertFails(uploadBytes(ref(st('em', { role: 'eventManager' }), 'event-art/big.jpg'), new Uint8Array(9 * 1024 * 1024), { contentType: 'image/jpeg' }), 'images still capped at 8 MB');
  await assertSucceeds(getBytes(ref(st(), 'event-art/v.mp4')));
});
