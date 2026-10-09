// Dev-only fixture data. Every name, price and line here is placeholder content for local testing
// and screenshots — none of it is production data and none of it is shipped.
const day = 864e5;
function nextDow(dow, weeksAhead = 0, hour = 22) {
  const d = new Date(); d.setUTCHours(hour, 0, 0, 0);
  let add = (dow - d.getUTCDay() + 7) % 7; if (add === 0 && Date.now() > d.getTime()) add = 7;
  return new Date(d.getTime() + (add + weeksAhead * 7) * day).toISOString();
}

export function seed(store, origin) {
  const art = f => `${origin}/dev/fixtures/${f}`;
  store.seed('settings', 'site', {
    venue: 'SamRit Hotel, Cape Coast', nightsLine: 'Friday + Saturday', doorsLine: 'Doors 10PM',
    phone: '020 000 0000', whatsapp: '0249050086', email: 'dev@example.com', instagram: '@memoriesnightclub.gh', facebook: 'memoriesnightclub.gh', tiktok: '@memoriesnightclub.gh',
    mapUrl: '', address: '', heroImage: '', defaultLines: [], closedDates: [],
  });
  const lines = ['SAMPLE LINE ONE.', 'SAMPLE LINE TWO.', 'SAMPLE LINE THREE.', 'SAMPLE LINE FOUR.', 'SAMPLE LINE FIVE.', 'SAMPLE LINE SIX.'];
  const nights = [
    { id: 'dev-afro', name: 'Afrobeats Friday', date: nextDow(5), artwork: art('poster-a.svg'), organiserId: 'uid-org-a', description: 'Two rooms. One night. Dress like you meant it.' },
    { id: 'dev-piano', name: 'Amapiano Saturday', date: nextDow(6), artwork: art('poster-b.svg'), organiserId: 'uid-org-b', description: '' },
    { id: 'dev-dnd', name: 'DND — Dance. Network. Disconnect.', date: nextDow(5, 1), artwork: art('dnd-party-poster.jpeg'), organiserId: null, description: '' },
  ];
  for (const n of nights) {
    store.seed('events', n.id, { name: n.name, date: n.date, doors: '10PM', venue: 'SamRit Hotel, Cape Coast', description: n.description, artwork: n.artwork, heroImage: '', ticketLines: lines, visibility: 'public', active: true, soldOut: false, featured: false, organiserId: n.organiserId });
    store.seed('ticket_types', `${n.id}-reg`, { eventId: n.id, name: 'Regular', pricePesewas: 10000, admits: 1, remaining: 300, active: true, sortOrder: 1 });
    store.seed('ticket_types', `${n.id}-early`, { eventId: n.id, name: 'Early Bird', pricePesewas: 7000, admits: 1, remaining: 0, active: true, sortOrder: 0 });
    store.seed('ticket_types', `${n.id}-duo`, { eventId: n.id, name: 'Link Up (2)', pricePesewas: 18000, admits: 2, remaining: 8, active: true, sortOrder: 2 });
    [['Table', 200000, 6, 'Reserved table for the night'], ['Floor Table', 350000, 8, 'On the floor, by the booth'], ['Birthday Table', 450000, 10, 'Sparklers and a shout-out']].forEach(([name, price, cap, desc], i) =>
      store.seed('table_packages', `${n.id}-t${i}`, { eventId: n.id, name, pricePesewas: price, capacity: cap, description: desc, remaining: 4, active: true, sortOrder: i }));
  }
  store.seed('raffles', 'evt_dev-afro', { eventId: 'dev-afro', prize: 'Dev prize (placeholder)', cap: 20, spotsTaken: 6, enabled: true, public: true, status: 'open' });
  [['Dev Vodka', 'Spirits', 90000], ['Dev Whisky', 'Spirits', 120000], ['Dev Champagne', 'Champagne', 180000], ['Dev Rosé', 'Wine', 60000], ['Dev Mixers (x6)', 'Soft', 12000]]
    .forEach(([name, category, price], i) => store.seed('bottles', `dev-b${i}`, { eventId: 'all', name, category, pricePesewas: price, active: true }));
  const staff = [['admin@dev', 'uid-admin', { role: 'superAdmin', admin: true }], ['manager@dev', 'uid-mgr', { role: 'manager', admin: false }], ['door@dev', 'uid-door', { role: 'doorStaff', admin: false }], ['bar@dev', 'uid-bar', { role: 'barStaff', admin: false }], ['orga@dev', 'uid-org-a', { role: 'organiser', admin: false }], ['orgb@dev', 'uid-org-b', { role: 'organiser', admin: false }], ['guest@dev', 'uid-guest', {}]];
  store.claims = {};
  for (const [email, uid, claims] of staff) { store.authUsers.push({ email, localId: uid }); store.claims[uid] = claims; if (claims.role) store.seed('users', uid, { email, role: claims.role }); }
  // Every staff account is a member (no ticket at the gate). Organiser A's, linked to their sign-in:
  store.seed('members', 'dev-mem-orga', { name: 'Ama Organiser', phone: '0245552020', type: 'staff', status: 'active', validUntil: '', staffUid: 'uid-org-a', department: 'Events', position: 'Organiser', staffNo: '', notes: '', createdAt: new Date().toISOString() });
  // Scan to order: one bar (QR → /b/0123…cdef) and a short drinks menu. Dev placeholders.
  store.seed('bar_stations', 'dev-main-bar', { name: 'Main bar', token: '0123456789abcdef0123456789abcdef', open: true });
  for (const [id, name, category, pricePesewas, available] of [['dev-m-beer', 'Club beer', 'Beer', 2500, true], ['dev-m-stout', 'Stout', 'Beer', 3000, true], ['dev-m-shot', 'Tequila shot', 'Shots', 3000, true], ['dev-m-cock', 'House cocktail', 'Cocktails', 6000, true], ['dev-m-water', 'Water', 'Soft', 1000, true], ['dev-m-flute', 'Champagne flute', 'Wine', 9000, false]]) store.seed('menu_items', id, { name, category, pricePesewas, available, sortOrder: 0 });
  store.seed('private_event_requests', 'dev-req1', { eventType: 'Birthday', date: nextDow(6, 2).slice(0, 10), guests: 25, name: 'Dev Requester', phone: '0240000000', instagram: '@dev', message: 'Thirtieth. Want the booth.', status: 'NEW', createdAt: new Date().toISOString() });
}
