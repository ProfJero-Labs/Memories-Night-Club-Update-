# Memories Night Club — repository map

This repository contains two applications. Only one of them is current.

## ✅ Canonical app: `memories-nightclub-complete-build/memories-complete-build/`

This is the live product — public site, Cloudflare Worker API, Firestore security rules, admin
console, organiser view, and test suite. All active development happens here. See
[`memories-nightclub-complete-build/memories-complete-build/README.md`](memories-nightclub-complete-build/memories-complete-build/README.md)
for architecture and setup, and
[`memories-nightclub-complete-build/memories-complete-build/docs/BUILD_PLAN.md`](memories-nightclub-complete-build/memories-complete-build/docs/BUILD_PLAN.md)
for the product spec this build was built against.

## 🗄️ Archived: `MemoriesNightClub/`

An earlier, superseded version of the site (static HTML pages with client-side Firestore writes,
no Worker layer, no security-rules enforcement of the sensitive-mutation paths). Kept in the
repository for reference only — see [`MemoriesNightClub/README.md`](MemoriesNightClub/README.md).
**Do not build on this folder.** New work goes in the canonical app above.
