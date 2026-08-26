# ADR-0017, minSdk 24 and the device matrix

Status: **decided**
Date: 2026-08-26

---

## 1. The problem this fixes

`minSdkVersion = 24` has been in `android/build.gradle` since the first commit
with no recorded reasoning. That made 99.1% device reach an accident: nobody
could say whether raising it was safe, and nobody had ever run the app below
API 34, so the floor was also a claim nobody had tested. This ADR makes the
number a decision and the matrix that proves it a checklist.

## 2. The decision: keep minSdk 24

Play Console distribution (December 2025, via
[composables.com/android-distribution-chart](https://composables.com/android-distribution-chart)):

| minSdk                   | Cumulative reach | Given up vs 24 |
| ------------------------ | ---------------- | -------------- |
| **24 (Android 7, ours)** | **99.1%**        | —              |
| 26 (Android 8)           | 98.3%            | 0.8pp          |
| 28 (Android 9)           | 95.2%            | 3.9pp          |
| 29 (Android 10)          | 90.7%            | 8.4pp          |

API 24 itself is 0.4% of devices, and the _entire_ current cost of supporting
everything from 24 up is one `SDK_INT >= Q` guard in `MainActivity.kt`. Against
that cost, 3.9 points of reach is not a close call for this product: India is
~95% Android on Xiaomi/Oppo/Vivo hardware that skews old
([StatCounter India](https://gs.statcounter.com/android-version-market-share/mobile/india)),
and India's version distribution is much flatter than the US's — the long tail
here is customers, not noise.

**Revisit trigger, so this is not permanent by inertia:** raise the floor when
supporting it costs a real fork — a second code path, a dependency held back, or
a per-version bug class — not when the number merely looks old. Review at each
targetSdk bump.

## 3. The matrix

One emulator cannot cover this app's claims. Each AVD below exists because some
capability is exclusive to its image, which was learned the hard way (a stale
Play services build made a broken Credential Manager path look healthy for two
days — the browser fallback carried every sign-in).

| AVD               | Image                                          | Window           | Proves                                              |
| ----------------- | ---------------------------------------------- | ---------------- | --------------------------------------------------- |
| `cc_api34`        | android-34 `google_apis` (**userdebug**)       | compact 411dp    | Baseline Profile generation; day-to-day UI checks   |
| `cc_api36_play`   | android-36 `google_apis_playstore` (GMS 25.08) | compact 411dp    | Credential Manager; enforced edge-to-edge (SDK 35+) |
| `cc_api24`        | android-24 `google_apis`                       | compact          | the minSdk floor actually boots and signs in        |
| `cc_api34_fold`   | android-34 `google_apis`                       | ~841×701dp inner | foldable / medium-expanded boundary, posture resize |
| `cc_api34_tablet` | android-34 `google_apis`                       | 1280×800dp       | expanded class, large-screen quality guidance       |

Mutually exclusive capabilities, for the record: Baseline Profile recording
needs `userdebug`, which `google_apis_playstore` images never are; Credential
Manager needs current Play services, which `google_apis` images ship stale and
cannot update.

## 4. What no emulator here can prove

Stated so the matrix is not oversold:

- **Performance.** Every AVD on this machine renders through SwiftShader (no
  GPU), so jank numbers are meaningless on all of them. Startup/jank claims need
  a physical mid-range device — the market hardware is a ₹10–20k
  Xiaomi/Oppo/Vivo, not a Pixel.
- **Third-party IMEs.** `disableFullscreenUI` is verified on Gboard only;
  Samsung Keyboard, SwiftKey and Indic keyboards need real devices.
- **OEM push behaviour.** Data-only FCM under MIUI/ColorOS battery killers
  cannot be emulated, and that is precisely our market's failure mode.
- **The Google token exchange.** Needs a human-signed-in account.

## 5. On "Pixel 6 is old"

The AVD device profile sets screen geometry and nothing else — no API surface,
no vendor behaviour. What changes behaviour is the API level and the GMS build,
which is why the matrix varies those and not the phone name. A "Pixel 10"
profile would have identical behaviour at the same API level.
