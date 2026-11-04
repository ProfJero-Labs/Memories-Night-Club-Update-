# Memories MoMo phone app

A small Android app for the business phone that holds the wallet SIM (0595986313). It passes every
incoming text to the Memories system, signed, and the system confirms MoMo-to-the-wallet payments by
itself when everything checks out (see `worker/src/ops/momophone.js`). The club's phone runs
Android 16; the app works on Android 6 and later.

## Get the app file

1. On GitHub, open **Actions → MoMo phone app**. It builds by itself whenever the app changes; or tap
   **Run workflow** to build it now.
2. Open the latest green run, scroll to **Artifacts**, download `memories-momo-phone-…`. It's a zip
   with the app file (`…-release.apk`) inside.

## Install it on the business phone (once)

1. Copy the `.apk` to the phone (WhatsApp it to yourself, or download it on the phone directly).
2. Tap it. Android asks to allow installing from that app (Chrome, Files or WhatsApp): **Settings →
   Allow from this source → on**, go back, **Install**. If Play Protect warns about an unknown app,
   tap **More details → Install anyway** (it's our own app, not from the Play Store).
3. Open **Memories MoMo** and do the three steps on the screen:
   1. **Allow texts and notifications** → Allow both. If Android says **"Restricted setting"**
      (Android 15 and 16 do this for apps not from the Play Store): the app offers **Open app info**
      → tap the **⋮** menu at the top right → **Allow restricted settings** → confirm, come back
      and tap step 1 again.
   2. On the Memories system, the admin opens **Control room → Setup → MoMo phone → Pair a phone** (or the Manager: **More → MoMo phone**): a 6-digit code
      appears. Type it in the app → **Pair with the code**.
   3. **Keep it running (battery)** → Allow. On Samsung, Tecno, Infinix, Xiaomi and similar
      phones, also open **App info → Battery** and choose **Unrestricted**, so the phone's own
      battery saver never stops it.
4. Tap **Send a test**: "It works" means the system hears the phone. The MoMo phone page on the
   system now says **online**.

Keep the phone at the club, plugged in, with mobile data or Wi-Fi on. A small notification shows the
app is listening. If the phone restarts, the app starts again by itself.

## Check it reads the texts right (do this first)

On the system, **More → MoMo phone → Test a text**: paste a real "payment received" text from the
wallet, exactly as it arrived. It shows the amount, transaction ID and balance it read. If anything is
wrong, send the text (names and numbers replaced with X) to the engineer to adjust the reader in
`worker/src/ops/momophone.js` (`readMomoText`). Every text the phone sent is kept, so they can be
read again after a fix.

## For the engineer

- Plain Java, no libraries, `minSdk 23`, `targetSdk 34`; always-on as a `specialUse` foreground
  service (no daily time limit, may start after boot on Android 15+). Built by `.github/workflows/momo-phone.yml` (Gradle 8.9,
  Android Gradle Plugin 8.5.2, JDK 17). Type-checked in development with `javac` against Robolectric's
  `android-all` jar.
- **Signing:** set these repository secrets once so each new version installs over the old one
  (otherwise uninstall, reinstall and pair again):
  `MOMO_KEYSTORE_B64` (`base64 -w0 momo.jks`), `MOMO_KEYSTORE_PASSWORD`, `MOMO_KEY_ALIAS`,
  `MOMO_KEY_PASSWORD`. Make the keystore with
  `keytool -genkeypair -v -keystore momo.jks -alias momo -keyalg RSA -keysize 2048 -validity 10000`.
  Keep `momo.jks` safe and out of the repository.
- **Certificates:** `app/src/main/assets/roots` holds ISRG Root X1/X2 (Let's Encrypt) and GTS Root
  R1/R3/R4 (Google Trust Services), trusted alongside the phone's own. Only needed on old phones
  (Android 7 and below); harmless on Android 16.
- **Protocol:** `POST /api/momo-phone/pair {code, name}` → `{deviceId, secret}`. Then signed:
  headers `x-momo-device`, `x-momo-time` (ms), `x-momo-sign` = hex HMAC-SHA256(secret,
  `time + "." + body`). `POST /api/momo-phone/texts {messages:[{from, body, receivedAt}]}` (oldest
  first, up to 20 per call); `POST /api/momo-phone/ping {}` every 5 minutes. The phone's clock must be
  within 10 minutes of the real time.
- **Sender names:** the system trusts MTN's sender names (`DEFAULT_SENDERS` in `momophone.js`;
  override with `routes.smsSenders` in settings/commercial). Check the real one in the MoMo phone page
  ("Not from MTN: ignored" means the name needs adding).
