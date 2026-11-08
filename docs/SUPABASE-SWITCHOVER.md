# Moving Memories from Firebase to Supabase (a short job)

The club's database and staff sign-in move from Firebase to Supabase. **Nothing is copied**: all the old
data was test data. The drinks, the bars, the event and the staff are set up again in the app, and everyone
gets a new PIN by text. Pictures stay on Cloudinary, payments on Paystack, texts on the SMS worker.

The Supabase side is already done: the project **memories** (`itebqtwpobjostoerijl`) has its tables, they
are locked so only the Worker can use them, and the first staff are already in. The Worker's code and the
test suite (both databases) are ready. What is left is these steps, about 15 minutes.

## What you do

**1. Upgrade the Supabase plan (the owner does this).** Supabase dashboard → the organization → Billing →
Pro. The free plan pauses a project after a week with no activity; a paused database means the club's system
is down. Do it before real customers use the system.

**2. Put the new code on the Worker.** In the project folder:

```bash
npm ci --prefix worker
```

```bash
npm run worker:deploy
```

(This also sets `SUPABASE_URL`, which is in `worker/wrangler.toml`. Nothing uses Supabase yet.)

**3. Give the Worker the Supabase key (one secret).** Supabase dashboard → project **memories** →
**Project Settings → API Keys** → the **service_role** key (click Reveal, Copy). Use the *service_role* one,
not the anon or publishable one. Then:

```bash
cd worker
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

and paste it when asked. (Never put it in chat, in a text, or in the project files.)

**4. Flip the switch.** Cloudflare dashboard → Workers → `memories-paystack-verify` → **Settings →
Variables and Secrets** → **Add** a plain *Variable* named `DB_BACKEND` with the value `supabase` → Deploy.

**5. Check.** Open `https://memories-paystack-verify.diamondj04102026.workers.dev/api/health` in a browser. You
want `"ok":true` and `"supabase":true` under `configured`. Then tell the owner: staff can sign in.

## Then, in the app (the owner and managers)

1. **Sign in.** On the staff login page, enter your phone number and tap **First time, or forgot your PIN?**:
   a text arrives with your PIN. (Everyone does this once; no PIN carries over from before.)
2. **Control room → Setup:** the **bars** (one or three; if the bar QR cards were printed already, print new
   ones: each bar's QR code is new), **drinks and prices**, and **Nights**: create the event on the 14th with its
   tickets and tables.
3. **More → Staff:** add anyone who isn't there yet; each gets a PIN by text.
4. Each bar does its **opening stock count** before the first order.
5. **Pair the MoMo phone** again: Control room → Setup → MoMo phone → Pair a phone.
6. Then the small real payments in `docs/ENGINEER-CHECKLIST.md`.

## Going back

Delete the `DB_BACKEND` variable (Cloudflare → the Worker → Settings → Variables and Secrets) and deploy.
The Worker is back on Firebase within a minute, with its old data and logins. Nothing on Firebase was
changed by any of this.

## If something shows up

| What you see | What it means |
|---|---|
| `SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set` | Step 2 (the address) or step 3 (the key) wasn't done on this Worker. |
| `/api/health` says `"supabase":false` | Same: the key or the address is missing. |
| `Something went wrong on our side (code 401)` | The wrong key was pasted: use *service_role*, not anon or publishable. |
| `Could not find the function public.m_…` | Ask the developer: the tables are missing from the project. |
| "You don't have a PIN yet" | Tap **First time, or forgot your PIN?** on the login page. |
| "That phone number and PIN don't match" for someone who should be in | They aren't in the staff list yet (or the number is typed differently): the owner adds them under More → Staff, or asks the developer. |
| The site fails after a quiet week | The project was on the free plan and paused: restore it on the Supabase dashboard, then do step 1. |

Anything else: copy the exact message and send it to the developer.
