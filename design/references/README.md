# Layout references

Three mockups were supplied on 2026-08-22 as the target for the list and chat
redesign. The images themselves are not in the repo; this file records what they
specify so the intent survives a context reset. **Drop the source images beside
this file** (`inbox-light.png`, `chat-orange.png`, `inbox-sheets.png`) so the
comparison can be made against pixels rather than prose.

Source: Pinterest, credited `@uix.vikram` on two of the three.

## They are not one design

Worth stating first, because "copy exactly" cannot mean all three at once.

**References A and C** (light, credited `@uix.vikram`) are the same design at
different crops. White ground, **iOS system blue** accent, black text.

**Reference B** ("Let's Stay Connected") is a different aesthetic entirely: near
black ground with a heavy orange gradient across the header and the whole chat
screen, white text.

Amit's instruction distinguishes them: A and C are the **layout**, B is
"animation, look and feel inspiration". Read that way they do not conflict, and
B's orange is much closer to this project's existing coral than A's blue is.

## Reference A / C: the inbox

Top to bottom:

- **Title** left-aligned, large and bold ("Mengrobol"), **search glyph** top right.
  No search field visible until tapped.
- **Story rail**, horizontal: a dashed-border `+` circle labelled "Add story",
  then circular avatars with the first name beneath each. Avatars roughly 56pt,
  labels small and grey.
- **Section header** "Chats", small and bold, with a `...` overflow glyph right.
- **Rows**: circular avatar left (~44pt), name in bold above a single line of
  preview text, timestamp top right in grey, and a **blue filled pill with an
  unread count** at bottom right. A double-tick read receipt appears inline
  before the preview text on some rows.
- **No card, no border, no shadow.** Rows sit directly on the white ground.
- **No visible separator lines.** Rows are separated by vertical rhythm alone.
  This directly contradicts the verbal instruction "simple lines in between like
  ios whatsapp has". Unresolved; see the open question below.
- **Bottom bar**: home glyph left, a **floating black pill "+ New Chat"** centred,
  person glyph right. Three targets, not one.

## Reference A / C: the conversation

- **Header**: back chevron, small circular avatar, name with "Online" beneath it,
  then a **video glyph and a phone glyph** at the right.
- A centred grey "Today" date divider.
- **Bubbles**: incoming grey on the left, outgoing **blue** on the right, generous
  corner radius, no tails.
- **Long-press sheet** over a dimmed background: the message repeated at the top,
  then a **React** row of emoji with a `+`, then **Copy, Reply, Forward, Delete**
  as full-width rows each with a trailing icon.

## Reference C also shows a compose sheet

"New Chat / New Contact / New Community", each with an icon and a one-line
description, plus a Cancel pill. Not obviously applicable: this product has no
contacts and no communities.

## What these imply that is not currently built

Recorded so the scope is visible rather than discovered later:

| From the mockup             | Status here                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows with no container      | inbox uses cards with elevation, ADR-0002 era decision                                                                                          |
| Inset separators            | do not exist                                                                                                                                    |
| Story rail                  | exists as the "here now" rail, close already                                                                                                    |
| Add story                   | not a feature; ours leads to the directory instead                                                                                              |
| Unread count pill           | exists                                                                                                                                          |
| Read receipts (double tick) | `read_at` exists in the schema, not rendered                                                                                                    |
| Timestamp per row           | exists                                                                                                                                          |
| Presence "Online"           | user-declared `presence` enum (here / away / hidden), default hidden, both roles. Was `peer_available`, which is a listing switch: see ADR-0013 |
| Video and voice call glyphs | rendered and disabled behind `CALLS_ENABLED`; server side exists, no media layer                                                                |
| Emoji reactions             | six closed emoji, `toggle_reaction` RPC, rendered under the bubble                                                                              |
| Reply / quote               | `messages.reply_to_id`, quoted inside the bubble, non-interactive                                                                               |
| Forward                     | nothing, and it fights the screenshot-blocking intent                                                                                           |
| Delete message              | nothing, and it fights the abuse-evidence model                                                                                                 |
| Three-target bottom bar     | one floating pill; ADR argued two destinations is too few for a bar                                                                             |

## Open questions

1. **Separators**: the mockups have none, the instruction asks for iOS WhatsApp
   hairlines. Which wins?
2. **Accent**: adopt reference A's iOS blue, or keep this project's coral and take
   only the layout? Switching discards the palette and its contrast proofs.
3. **Action sheet**: which of React / Copy / Reply / Forward / Delete are actually
   in scope? Each is a feature, and two of them work against decisions already
   made about safety.

---

## The three Pinterest pins, reviewed 2026-08-22

Reviewed properly, in the browser, rather than inferred from their titles.

### `pin/734368283032602485`: motion, not layout

A wallet onboarding by `nickpylll for fusewallet`. Nothing to copy structurally;
what it demonstrates is a **focus carousel**: a vertical list of words where the
selected item is fully opaque with a small leading icon and its neighbours drop to
near-zero opacity. Beneath it a soft gradient blooms from the bottom edge, and two
stacked pill buttons sit on top of it, one solid and one translucent.

Applicable here as opacity-driven focus and generous pill radii. The gradient is
not applicable: this project's surfaces are flat by decision.

The carousel is now built (`src/components/WordCarousel.tsx`, on the sign-in
screen), along with the stepper, the accent ramp, the self-narrating buttons and
the opacity-only text swaps. The gradient stayed out, and the full argument for
that, including the fact that it is now technically buildable in RN core with no
dependency, is in `motion-system.md`. Five of the seven rules landed; see that
file for which two did not and why.

### `pin/1136033074757394200`: the closest thing to our product

A chat screen with payments built into the composer. The visible frame shows:

- A **voice message** row: play glyph, waveform, a `2x` speed pill, and a
  "Transcribe" affordance above it.
- A **typing indicator** that is two things at once: the line "IamCK is typing…"
  with a small coloured presence dot, _and_ a separate three-dot bubble below it.
- A **composer** with four leading glyphs (person-add, image, mic), a rounded
  "Message" field, and a **currency button** on the trailing edge.

The currency button is the interesting part, because this product already meters
messages in tokens and has nowhere prominent to surface that.

The typing indicator exists. Voice notes now exist too, and three parts of that
row were deliberately not followed:

- **The waveform is flat.** There is no peaks column, and no platform API returns
  amplitudes for a file you did not record, so a shaped waveform on a received
  note would be a picture of nothing presented as a picture of what somebody said.
  The recorder's real peaks are shown once, in the composer, where they exist. See
  ADR-0014.
- **The `2x` pill was kept**, cycling 1x, 1.5x, 2x, and it renders only on the row
  that is playing. A speed control on every note is a setting pretending to be a
  per-message choice.
- **"Transcribe" was not built.** It is the single biggest lever on accessibility
  here (a deaf member currently cannot use half the product) and on moderation
  cost (a transcript is greppable, audio is not), and it also means sending user
  speech to a third-party model, which contradicts "we never analyse the contents
  of your messages". That is a product decision, not an implementation gap.

### `pin/579557045824357127`: the notification centre

A screen this app does not have at all. We send push notifications; there is no
in-app place to read them back.

Its structure, which is worth copying closely:

- Title "Notifications", small avatar at the leading edge.
- **Time buckets** as section headers: `Today`, `This Week`, `Earlier`.
- Each row: circular avatar with a **small type badge overlaid at its lower
  trailing corner** (person, comment, calendar), then one line of text mixing
  **bold subject and subject matter** with regular connecting words, then a
  relative timestamp.
- Timestamps degrade sensibly: `4h ago`, `7h ago`, `4d ago`, then absolute dates
  (`14 Aug`, `29 Jul`) once relative stops being useful.
- Some rows carry an optional grey body paragraph, truncated.
- No containers and no separators. Rows on white, separated by rhythm.

Note the separator question resolves differently here than in the chat list: at
five or six notification rows with varied heights, whitespace is enough. The chat
list is uniform rows, which is where hairlines earn their place.

## Settled decisions (2026-08-22)

- **Accent stays coral.** Reference A's iOS blue is rejected explicitly.
- **Ground is true white in light, true black in dark**, matching iOS
  `systemBackground` rather than the `#F2F2F7` this project currently uses for
  `bg/base`. This is a token change with a knock-on: `bg/raised` is currently
  `#FFFFFF`, so it collapses into the new base and the ramp has to be re-derived.
- **Separators: inset hairlines**, iMessage-style, in the chat list.
- **Action sheet: React and Reply only.** Forward, Delete and Copy are rejected on
  safety grounds.
- **Bottom bar: three targets**, retiring the header overflow glyph.
- **Presence is user-controlled**, not derived. Like WhatsApp's setting, not like
  real presence. Settled in full by migration 012 and ADR-0013: a three-value
  `presence` enum defaulting to hidden, offered to both roles in one place, and
  deliberately not `is_available`, which is the provider's directory listing
  switch and was being rendered as a dot in four places.
- **Search must not filter per keystroke.** It fires only once typing settles.
- **iOS is the reference for the surface language**, and Material 3 keeps the
  interaction model. This was the decision the audit was blocked on and it splits
  cleanly: sheet corners, page colours, the type ladder, list separators, dates
  and casing are now iOS, while `Pressable` still drives M3's scale-plus-state-layer
  by default and offers `highlight="ios"` for the surfaces where a scaling row is
  the loudest tell. `interaction.minTarget` stays 48, which clears iOS's 44, so one
  number satisfies both. The switch anatomy stays M3: a toggle's dp is not the
  app's language, and it is one control scheduled to become a grouped switch row.
  `__tests__/theme.test.ts` carries both halves as `iOS conformance` and
  `Material 3 interaction survives`.
- **Bubbles lose their tail.** Both sides are 18 on all four corners and **fill
  plus side carry the speaker**. `Turn.tsx` used to argue the opposite, that the
  tail corner carried the speaker, and that argument was also what made the two
  sides different shapes, which contradicted the symmetry the same file was built
  on. `radius.tail` now has no consumer and is kept with a note saying why.
- **The incoming bubble is `bg/sunken`.** Not a style preference: `bg/raised` is
  `#FFFFFF` in light mode and so is `bg/base`, so an incoming bubble had no fill
  at all and its 1px outline was the only thing there. The border goes with the
  change, because it was compensating for the missing fill.
- **The React row ships without the reference's trailing `+`.** There is no picker
  behind it, and the closed emoji set is the safety argument for the whole feature.
- **The reply quote is non-interactive in v1.** Tapping to scroll to the parent
  needs `scrollToIndex` on an inverted variable-height list, which throws on an
  unmeasured index without `getItemLayout`, and the parent is frequently outside
  the loaded page.
- **The chat header sheds the standalone shield glyph.** Safety is reached by
  tapping the identity block, which is where iOS Messages puts a details push. The
  arithmetic forced it: back, avatar, video, phone and the token counter come to
  about 232pt of fixed width on a 360pt screen, and four grey circles in one row is
  chrome the reference does not have. The token counter stays because
  `.maestro/03-token-economy.yaml` asserts `3 left` on this screen.
- **The call glyphs ship visible and disabled.** Migration 011 shipped the whole
  server half of calling; there is no media layer, so a tap would ring a phone that
  can never connect. Hiding them would mean the header changes shape on the commit
  that turns calling on. See `CALLS_ENABLED` in `src/api/calls.ts`.

## Built as of 1.0.3 (2026-08-22)

Phases 1 to 3 of the redesign are in and distributed. What that covered:

- **Tokens.** `bg/base` is true white and true black; `border/hairline` moved to
  iOS `opaqueSeparator` so a separator on a white page is visible (1.30:1 to
  1.71:1). `press.row` added at 0.99, gentler than a card, because a flat row with
  no edge of its own looks like it is peeling off the page if it scales visibly.
  The two measured Fuse timings landed as `duration.accentShift` and
  `duration.stepPromote`.
- **Both lists flat.** Inbox and directory rows sit on the page, divided by a
  hairline inset to the text edge. No radius, no border, no elevation. The
  directory's language pills went: they were the only thing making rows disagree
  about their height, and a list whose rows disagree cannot carry a hairline
  convincingly.
- **The bottom bar has two targets, not three.** The reference has home, compose
  and profile. Home is dropped because the bar only renders on the inbox, so it
  would navigate to the screen you are already on. Settings moved off the header
  `...` glyph into the bar, which was the point of adopting a bar at all.
- **Search.** Debounced at 250ms, and it now spans the directory as well as your
  threads. Both halves of the reported bug. The three-thread gate is gone, so an
  empty inbox is searchable, which is when finding somebody matters most.
- **Back.** A parent map in `src/lib/routes.ts`, with the chat route carrying the
  door it was opened from so back returns to the directory when you came from the
  directory. Sheets close before screens pop.
- **Screen capture blocked.** `FLAG_SECURE` on every installable build, exempt in
  debug so on-device verification still works.

## Built as of the iOS pass (2026-08-22)

- **The chat screen restyle.** Symmetric bubbles on `bg/sunken` and
  `bg/accentStrong`, per-day dividers computed from the transcript, group-boundary
  spacing keyed off the flag the memo already computed for the avatar, a nav bar
  instead of a Toolbar, a persistent presence line, and the typing indicator in a
  bubble that also renders in an empty thread.
- **Reactions and reply, both wired to real RPCs.** `toggle_reaction` and
  `send_message(p_reply_to_id)`, both from migration 011. The long-press sheet is
  `src/screens/MessageActionsSheet.tsx`.
- **The iOS language pass**, across every screen: title-style capitalization on
  controls, one date module (`src/lib/datetime.ts`) replacing two divergent `ago()`
  copies and a hardcoded 24-hour clock, `borderCurve: 'continuous'` on every
  rounded surface, filled fields at `radius.field` instead of Material outlined
  ones, sheet bar actions instead of a full-width dismiss button, an inset-grouped
  settings table, disclosure chevrons, separators that reach the trailing edge and
  stop before the last row, and the five surfaces that were invisible in light mode
  because `bg/raised` equals `bg/base` there.

Voice notes shipped for both roles: tap to record rather than hold to talk (the
hold cannot be expressed to a screen reader, and it would need a pan competing
with the transcript's scroll), a stop-then-send review step so the three-minute
cap cannot send a cut-off sentence, and a flat waveform with a real playhead. The
composer's mic replaces the send button rather than sitting beside it.

Not built yet: the pseudonymous profile UI, transcription, and calling's client
half. Calling is the large one, the schema, the meter and the blocking gates
exist, and the media layer, signalling and in-call surface do not.

## Verified on a device, 2026-08-23

The gap this closes: until now every visual claim in this file was reasoned from
code. `scripts/dev-session.mjs` mints a real session and injects it, so screens
behind auth can be looked at. What that immediately found:

**Two bugs that passed every gate.**

1. The inbox rendered `Nobody matching "".` above the empty state, because the
   section header fell through to the no-matches branch when there were no rows
   AND no query. A brand new member's first screen said nobody matched a search
   they had not run.
2. The directory's section header read `4 AVAILABLE NOW` above five rows. It
   counted people whose listing switch was on while the list showed everyone, so
   the header contradicted its own section. It counts the list now, and
   availability stays on the row that has it.

Both are fixed and both now have contract assertions.

**Confirmed working, by looking:** true white ground, inset hairline separators on
both lists, disclosure chevrons, the coral unread badge, the "here now" rail, the
iOS-style sunken search field, real provider data with ages and headlines, and the
provider home screen with its stats row.

**How to look at it yourself**

```
node scripts/dev-session.mjs            # provider tree
node scripts/dev-session.mjs --member   # member tree
```

Three things about that tool are worth knowing before trusting it, because each
cost a wasted cycle:

- It mints via `admin/generate_link` plus `verify`, not the password grant. The
  live project has the email provider **off** while `supabase/config.toml`
  declares it on, so the grant answers 422. Fixing that drift needs a
  `config push`, which would blank the Google OAuth secret because it only exists
  as `env(SUPABASE_AUTH_GOOGLE_SECRET)` and that is not available locally. That is
  exactly how Google sign-in went down on 2026-08-21.
- AsyncStorage on this app is a Room database called `AsyncStorage` with a table
  called `Storage`, not the `RKStorage` / `catalystLocalStorage` every article
  describes. Writing to the old names succeeds, reports one row, and the app never
  opens the file.
- `migrateLegacyStorage()` short-circuits on an MMKV flag any previous launch has
  already set, so the tool deletes the MMKV store to make the migration run again.
  That throws away local-only state, which is why it is emulator-only.

`FLAG_SECURE` is now per build type: `release` blocks capture, `internal` and
`debug` do not. A secure window returns nothing at all to `screencap`, so leaving
it on everywhere is what made the app impossible to look at.

## The crash the whole gate could not see

Worth its own section because it is the strongest argument for the device harness
that exists in this repo.

`Spinner` calls `spokeOpacity` from `src/lib/spinner.ts` inside
`useAnimatedStyle`. That runs on the UI runtime, and Reanimated treats an
ordinary imported function called from there as a **remote function**:

```
FATAL EXCEPTION: main
[Worklets] Tried to synchronously call a Remote Function.
  at SpinnerTsx1
  at styleUpdater_reactNativeReanimated_useAnimatedStyleTs3
```

The app died on the first frame the spinner rendered. What it got past:

- 497 jest tests, eight of them written specifically for that function
- `tsc --noEmit`
- `eslint --max-warnings=0`
- the full `npm run verify` chain
- a successful release build

None of them can see it. jest imports the module into the JS runtime, where the
function is perfectly callable, so the unit tests passed against code that
crashed. The fix is a `'worklet'` directive in the function body, which the babel
plugin compiles into a UI-runtime copy while leaving the JS one alone, so the
maths stays testable where it is.

There is now a contract assertion that the directive is present, and it was proved
to fire by removing it. But the assertion only exists because somebody opened the
screen.

## Two more found the same way

- The **refill sheet's header collided**: the bar actions shared a row with the
  title at `flex: 1`, so a sheet with a leading action and no trailing one
  rendered "Not Now 75 Tokens Left" as one broken line. The actions have their
  own row above the title now, which is the iOS structure it was reaching for.
- The **directory's section header contradicted its own list**: `4 AVAILABLE NOW`
  above five rows, because it counted the listing switch while the list showed
  everyone.
