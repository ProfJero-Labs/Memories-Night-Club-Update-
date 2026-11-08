# Moving Memories from Firebase to Supabase

The club's database and staff sign-in move from Firebase to Supabase. **No old sales move**: all of it was
test data. Only the setup comes across: the drinks, the bars, the staff and the upcoming event.
Everything is switched by one Worker setting, so going back is as quick as going forward.

What changes: where records are kept (Supabase instead of Firebase's Firestore) and how staff stay signed
in (a token the Worker signs itself instead of one from Firebase). Pictures stay on Cloudinary, payments
on Paystack, texts on the SMS worker: none of that changes.

Supabase project: **memories** (`itebqtwpobjostoerijl`, address `https://itebqtwpobjostoerijl.supabase.co`).
The tables and functions are already created (`supabase/migrations/001_docs_and_functions.sql`).

## 0. You need

- A computer with **Node.js 22** and this project (the same as for `npm run worker:deploy`), after
  `npm ci --prefix worker`.
- The **Firebase key file** (the service-account JSON the Worker already uses; or make a new one in the
  Firebase console → Project settings → Service accounts → Generate new private key). It is only read from.
- Access to the **Supabase dashboard** for the `memories` project, and to **Cloudflare** for the Worker.

## 1. Before anything else: the paid plan

On the Supabase dashboard (Organization → Billing) move the project to the **Pro plan**. The free plan pauses
a project after a week with no activity, and a paused database means the club's system is down. Do this
before real customers use it.

## 2. Two secrets and one setting on the Worker

Supabase dashboard → **Project Settings → API**: copy the **service_role** (secret) key. Then, in the
`worker` folder:

```bash
npx wrangler secret put SUPABASE_URL
```

(paste `https://itebqtwpobjostoerijl.supabase.co`)

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

(paste the service_role key; never put it in chat, a text or the repository)

```bash
openssl rand -hex 32
```

Copy that output, then:

```bash
npx wrangler secret put APP_JWT_SECRET
```

Do **not** set `DB_BACKEND` yet: that is the switch (step 5).

## 3. Copy the setup (drinks, bars, staff, the upcoming event)

First look at what it would copy (nothing is written):

```bash
FIREBASE_SERVICE_ACCOUNT_FILE=./service-account.json SUPABASE_URL=https://itebqtwpobjostoerijl.supabase.co SUPABASE_SERVICE_ROLE_KEY=PASTE_KEY node scripts/copy-setup-from-firebase.mjs
```

Read the list. Then copy it by adding `--go`:

```bash
FIREBASE_SERVICE_ACCOUNT_FILE=./service-account.json SUPABASE_URL=https://itebqtwpobjostoerijl.supabase.co SUPABASE_SERVICE_ROLE_KEY=PASTE_KEY node scripts/copy-setup-from-firebase.mjs --go
```

It prints, for each kind of record, how many it copied and how many are now on Supabase. If a line says
"FEWER THAN COPIED", send the output to the developer. It is safe to run again.

Not copied, on purpose: tabs, orders, tickets sold, payments, cash, stock counts and movements, expenses,
payroll, reviews and logs. **Stock starts from an opening count** on the new database. Check the "left"
numbers on the tickets and tables of the upcoming event in the admin before tickets go on sale (test sales
may have reduced them). The picture on the event is a Cloudinary link and comes with it.

Staff PINs are not copied: each person taps **First time, or forgot your PIN?** on the login page and gets a
text with a new one.

## 4. The first admin's PIN

So there is someone who can sign in straight away (6 numbers for an admin):

```bash
SUPABASE_URL=https://itebqtwpobjostoerijl.supabase.co SUPABASE_SERVICE_ROLE_KEY=PASTE_KEY node scripts/set-pin.mjs 0244XXXXXXX 123456
```

(the admin's phone number, then the PIN you chose). Everyone else texts themselves a PIN, or the admin
sends them one from **More → Staff**.

## 5. Flip the switch

Cloudflare → Workers → `memories-paystack-verify` → **Settings → Variables and Secrets** → add a plain
**Variable**: `DB_BACKEND` = `supabase`. Save and deploy (the Worker picks it up within a minute).

Check `https://memories-paystack-verify.diamondj04102026.workers.dev/api/health` in a browser. You want
`"ok":true` and `"supabase":true,"sessionSecret":true` under `configured`.

## 6. Check it works (about 15 minutes)

1. Sign in on the staff login with the admin's phone and PIN. You land on the admin's page.
2. A manager signs in the same way (after texting themselves a PIN).
3. **Control room → Nights**: the upcoming event is there with its tickets and tables.
4. A bar does its **opening stock count**, then a waiter opens a tab, orders, the bar hands it over, and the
   waiter closes it with cash. It shows on the Manager's Tonight.
5. **Pairing the MoMo phone**: Control room → Setup → MoMo phone → Pair a phone (the pairing code is kept on
   Supabase now, so pair again if it was paired before).
6. One small real Paystack payment and one MoMo-to-the-wallet payment, as in `docs/ENGINEER-CHECKLIST.md`.

## 7. Going back (if something is wrong)

Delete the `DB_BACKEND` variable (or set it to `firebase`) and deploy. The Worker is back on Firebase within
a minute, with the old data and logins there. People signed in with the new kind of session just sign in
again with their PIN. Nothing on Firebase was changed by any of this.

## 8. After a calm week

Nothing needs removing: Firebase can sit idle. When you are sure, the Firebase settings on the Worker
(`FIREBASE_*`) can be deleted.

## If something shows up

| What you see | What it means |
|---|---|
| `SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set` | Step 2 wasn't done on this Worker. |
| `APP_JWT_SECRET is not set` (staff can't sign in) | Step 2: the third secret. |
| `Could not find the function public.m_…` | The tables weren't created: run `supabase/migrations/001_docs_and_functions.sql` in Supabase → SQL editor. |
| `Something went wrong on our side (code 401)` or a Supabase key error | The service_role key was pasted wrongly (use the *service_role* one, not the anon key). |
| "You don't have a PIN yet" | Tap **First time, or forgot your PIN?** on the login page, or run step 4 for that person. |
| The site slows down or fails after a quiet week | The project was on the free plan and paused: restore it on the Supabase dashboard, then do step 1. |
