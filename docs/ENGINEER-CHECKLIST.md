# Engineer's checklist: go live with the new payments and the MoMo phone

Do these in order. Each step says how you know it worked. Background: `docs/HANDOVER-SMS-PHONE.md`,
the app: `android/momo-phone/README.md`.

## What to bring

- A laptop with **git** and **Node.js 22**, and access to the **Cloudflare account** that owns the
  Worker `memories-paystack-verify` (and to this GitHub repository).
- The **business phone** (Android 16, wallet SIM **0595986313**), charged.
- A **Manager login** for the staff site (phone number + PIN), and a **director login** for step 6.
- **Another phone with MoMo** and a few cedis, to send test payments.

## 1. Put the new server (Worker) live: about 10 minutes

GitHub can't deploy it by itself yet (no Cloudflare key in GitHub), so deploy from the laptop:

```bash
git clone https://github.com/ProfJero-Labs/Memories-Night-Club-Update-.git
cd Memories-Night-Club-Update-
npm ci --prefix worker
npx --prefix worker wrangler login
npm run worker:deploy
```

**Worked if:** on the staff site, signed in as the Manager, **More → MoMo phone** opens (before the
deploy it says "Couldn't load").

Optional, so future merges deploy themselves: in Cloudflare create an API token ("Edit Cloudflare
Workers"), then in GitHub **Settings → Secrets and variables → Actions → New repository secret**
named `CLOUDFLARE_API_TOKEN`.

## 2. Get the app file

GitHub → **Actions → MoMo phone app** → **Run workflow** (branch `main`) → wait ~2 minutes → open
the run → **Artifacts → memories-momo-phone-…** → download and unzip. Inside is the `.apk`.

Optional, before building: set the signing secrets in `android/momo-phone/README.md` ("Signing"), so
future versions install over this one without pairing again.

## 3. Install it on the business phone

1. Send the `.apk` to the phone (WhatsApp, or download it there) and tap it.
2. Allow installing from that app when asked; if **Play Protect** warns, **More details → Install
   anyway**.
3. Phone settings: **Date & time → automatic** (the phone's clock must be right, or the system refuses
   its messages).

## 4. Set up the app (on the business phone)

Open **Memories MoMo**:
1. **Allow texts and notifications** → Allow both. If Android says **"Restricted setting"**: tap
   **Open app info** → **⋮** (top right) → **Allow restricted settings** → confirm, go back, tap
   step 1 again.
2. **Keep it running (battery)** → Allow. Also **App info → Battery → Unrestricted**.

## 5. Pair it (needs step 1 done)

1. On the laptop (or any phone), sign in to the staff site as the **Manager** (the Human manager or a
   director also can) → **More → MoMo phone → Pair a phone**. A **6-digit code** appears (works
   once, for 15 minutes).
2. On the business phone, in the app: type the code → **Pair with the code**. It says "Paired".
3. Tap **Send a test** → "It works: the system heard this phone."

**Worked if:** the staff site's **MoMo phone** page shows the phone as **online**.

## 6. Check the phone reads MTN's texts correctly

1. On the business phone, open the Messages app and find 3–5 real **"payment received"** MoMo texts.
2. Copy each one exactly → staff site **More → MoMo phone → Test a text** → paste → **Read it**.
3. Check it shows the right **amount**, **transaction ID** and **balance**.

If any is wrong, fix `readMomoText` in `worker/src/ops/momophone.js`, add the real text as a test in
`worker/test/momophone.test.js`, run `npm test`, and deploy again (step 1). After the first real
payment, the **MoMo phone** page lists it: if it says **"Not from MTN: ignored"**, add the sender
name it shows to `DEFAULT_SENDERS` in the same file and deploy again.

## 7. Test each way of paying (a quiet moment, small amounts)

A **director** signs in → **More → Service charge & commission → New payment rules**: check the
partner's subaccount is `ACCT_89qd3ub03w61erk` and the wallet is `0595986313`, tick **Use the new
payment rules** → **Save**.

1. **Cash:** a waiter opens a tab, orders one drink, the bar hands it over, **Close tab → Cash**.
   The tab closes.
2. **Paystack:** another one-drink tab → **More → Show QR to pay** → pay on the test phone. The tab
   closes by itself. In the **Paystack dashboard**, the payment shows the split to the partner's
   subaccount.
3. **MoMo to the wallet** (normally only above GHS 2,000; to test small): director → **More →
   Paystack is down tonight**. A one-drink tab → **Close tab → MoMo to the wallet** → send exactly
   the amount shown from the test phone to 0595986313.
   - The **first** payment text can't be checked against an earlier balance, so it appears on
     Tonight under **MoMo to confirm**: tap **Arrived → This one**. The tab closes.
   - Do it **once more**: this time it confirms **by itself** within a minute (the waiter's screen
     says "Tab closed").
   - Then director → **Paystack works again**.

## 8. Leave it running

- Phone at the club, **plugged in**, data or Wi-Fi on. A small notification shows the app is
  listening. It restarts by itself after a reboot.
- If the phone is replaced: **MoMo phone → Unpair** the old one, then pair the new one (step 5).
- The payment rules can stay on, or a director can untick them until the staff are shown the new
  screens (**MoMo to confirm**, **QR orders paying cash**).

## If something goes wrong

| What you see | What to do |
|---|---|
| "Couldn't load" on new screens | The Worker isn't deployed: step 1. |
| Bills over GHS 2,000 still offer Paystack | The new rules are **off** until a director ticks **Use the new payment rules** (step 7), and the Worker must be deployed first (step 1). Then close and reopen the staff page so the phone loads the new version. |
| App: "Not paired any more, or the phone's clock is wrong" | Date & time → automatic; or pair again (step 5). |
| App: "No connection" | Data / Wi-Fi on; the app retries by itself. |
| MoMo phone page: offline | Open the app, tap **Send a test**; check battery is Unrestricted. |
| A payment text: "Balance didn't add up" | Someone used the wallet from another phone or the app missed a text: confirm by hand once; the next ones confirm themselves. |
| A payment text: "Couldn't read it" | Step 6: adjust the reader. |
