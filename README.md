# Memories Night Club

The Memories website, ticketing, tables, pay-in-bits, the draw, door check-in, and the staff control room.

- **Product spec:** [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md)
- **How it works** (code map, roles, data, money flows): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Going live:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- **Security controls and their tests:** [`docs/SECURITY.md`](docs/SECURITY.md), audit: [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md), who can call what: [`docs/AUTHZ.md`](docs/AUTHZ.md)
- **System map** (pages, routes, states): [`docs/AUDIT.md`](docs/AUDIT.md). **Owner decisions:** [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md)

The live site deploys `public/` from `main` (Cloudflare Pages). The Worker is deployed separately with `npm run worker:deploy`: deploy the Worker **before** merging front-end changes that depend on it. CI (`.github/workflows/ci.yml`) runs all three test suites and a secret scan on every push and pull request.

Stack: Firebase (Firestore, Auth, Storage) for data, one Cloudflare Worker for all server logic, a static site on Cloudflare Pages. Paystack for payments, the club's existing SMS worker for texts, Brevo for email.

## Run it locally (no credentials needed)

```bash
cd worker && npm install && cd ..
npm run dev            # http://localhost:8787
```

This runs the real Worker code against an in-memory Firestore, a fake Paystack checkout (a Pay / Decline page) and dev staff logins. The password is `memories-dev` for all of them: `admin@dev`, `manager@dev`, `door@dev`, `orga@dev`, `orgb@dev`, and `guest@dev` (no role). Seed nights, lines and prices are dev placeholders from `dev/seed.mjs`; none of it is production data.

## Tests

```bash
npm test               # Worker: payments, idempotency, the draw, roles, check-in, calendar… (node:test)
npm run test:e2e       # Real browser journeys: buy, pay in bits, tables, private night, admin edits, door, organiser, XSS, 320px
npm run test:rules     # Firestore + Storage rules in Google's emulators (needs Java; cd firebase/test && npm install first)
```

`node dev/flow.mjs <ticket|table|private|bits|admin|door|organiser> [width]` walks a journey and saves screenshots; `node dev/shoot.mjs "index.html,nights.html" 320,390,1280` screenshots pages and reports horizontal overflow.

## Layout

```
public/     the site (public pages + staff pages), no build step
worker/     Cloudflare Worker API + unit/acceptance tests
firebase/   Firestore/Storage rules + emulator tests
dev/        local server, seed data, e2e tests, screenshot tools
scripts/    set-role.mjs: grant the first super admin from a trusted machine
docs/       spec, architecture, deployment, security
```
