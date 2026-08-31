# Play upload pack — drop into Console

Organised for a **public listing setup** + **internal beta** (approved testers only).
Nothing here makes the app searchable on the public store until you publish to **Production**.

## Can we release only to approved testers?

**Yes — that is Internal testing** (your choice for this beta).

| Track          | Visible on public search? | Who installs                                    | Versioning                               |
| -------------- | ------------------------- | ----------------------------------------------- | ---------------------------------------- |
| **Internal**   | No                        | Only emails / Google Group you add (up to ~100) | Each upload needs a higher `versionCode` |
| Closed testing | No (opt-in link / list)   | Larger approved cohort                          | Same global `versionCode` ladder         |
| Production     | Yes                       | Everyone in targeted countries                  | Same ladder                              |

`versionCode` is **global across all tracks**. Internal already has **2** (`1.0.38`). The next build must be **3+**.

### Internal beta loop

1. Play Console → **Testing → Internal testing → Testers** → email list.
   Same people as Firebase App Distribution group **`internal-testers`** — see
   `06-testers/internal-testers-emails.txt` (Play cannot read Firebase groups;
   paste the three addresses or a Google Group that mirrors them).
2. Testers open the Play **opt-in link** once (separate from the Firebase invite).
3. Upload a new AAB to Internal (or promote later).
4. Bump `CI_PIPELINE_IID` / `-PversionCode=N` each time; keep `VERSION_NAME` in `android/gradle.properties` for the human-facing name.

Production stays empty until you explicitly publish there.

---

## Folder map — pick & drop

| Folder                       | Console destination               | Files                                                                                   |
| ---------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `01-app-icon/`               | Store listing → App icon          | `play-icon-512.png` (512×512, no alpha)                                                 |
| `02-feature-graphic/`        | Store listing → Feature graphic   | `feature-graphic-1024x500.png`                                                          |
| `03-phone-screenshots/`      | Store listing → Phone screenshots | **5× PNG 1080×1920 (9:16)** — home, chat, recharge sheet, leave sheet, provider         |
| `07-tablet-7in-screenshots/` | Store listing → 7-inch tablet     | **PNG 1440×2560 (9:16)** — onboarding/auth from tablet AVD + product frames scaled 9:16 |
| `04-listing-copy/`           | Store listing text                | `title.txt`, `short_description.txt`, `full_description.txt`                            |
| `05-release/`                | Internal testing → Create release | `app-release-*.aab`, `whatsnew-en-IN.txt`                                               |

Also fill in Console (not files):

- Privacy policy: `https://bond-app.vercel.app/privacy.html`
- Support email: `testrelay97@gmail.com` (see `docs/play/listing.md`)
- **Data safety** + **Content rating** questionnaires (`docs/play/listing.md` §§4–5)

## Why the store page still says `com.companionchat (unreviewed)` with no icon

**Not a metadata bug.** The listing is committed and correct — verified against the
Play Developer API on 2026-08-31: `en-IN`, `en-US` and `en-GB` all carry
`title: Pappal`, 1 icon, 1 feature graphic, 5 phone and 7 seven-inch screenshots,
`defaultLanguage: en-IN`.

The cause is app state, and it is documented behaviour:

> Before your app receives its **first review**, users see a **temporary name** for
> the app on Google Play. You can find your app's temporary name in the app summary
> on your app's Dashboard.
> — [Set up an open, closed, or internal test](https://support.google.com/googleplay/android-developer/answer/9845334)

The Dashboard confirms it in words: _Draft app · Temporary app name
`com.companionchat (unreviewed)`_. An internal-testing build installs and runs
before first review; the **store listing does not render** until that review passes.
`https://play.google.com/store/apps/details?id=com.companionchat` returns 404 for
the same reason.

Uploading an AAB does not request a review, and neither does the API `edits:commit`
we use for the listing — those only stage the change. Store listings currently read
**"Ready to send for review"** in the Console, which is the staged state.

### To fix (Console only — no API for these)

1. **App content** — the store page shows `Unrated` and _Data safety: No information
   available_, so at minimum the **Content rating** questionnaire and the **Data
   safety** form are outstanding. Also confirm target audience, privacy policy, app
   access, ads, and the government/financial/health declarations
   (`docs/play/listing.md` §§4–5).
2. **Publishing overview → Send changes for review.**
3. Wait for the first review — hours to ~7 days
   ([Control when app changes are reviewed](https://support.google.com/googleplay/android-developer/answer/9859654)).
   The name and brand assets replace the temporary name automatically once it passes.

Nothing in this repo needs to change for that; re-running the listing upload will
not shorten it.

## Notes

- Phone/tablet screenshots are **Play-valid 9:16** (old 1080×2400 assets were invalid). Recapture: `scripts/play-screenshots.sh phone|tablet <serial> <slug>`. Release builds enable `FLAG_SECURE` — capture from debug/internal for listing pixels.
- The AAB is large; keep it local. Rebuild with:
  `CI_PIPELINE_IID=3 ./android/gradlew -p android bundleRelease -PversionCode=3`
