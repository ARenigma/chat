# ADR-0028, The transcript carries no peer avatar, so both bubble edges sit on the composer's grid

Status: **decided and shipped**
Date: 2026-09-07
Guard: `__tests__/chatSurface.test.ts` › "lands an INCOMING bubble on the content edge, with no avatar column"
Reference: [layout basics](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-basics)
("Provide consistent alignment between similar content and UI elements",
"Establish consistent spacing between like elements") ·
[grids and units](https://developer.android.com/design/ui/mobile/guides/layout-and-content/grids-and-units)
("If using a baseline grid, stick to measurements of 4 and 8") ·
`design/references/telegram.md:127` under [ADR-0025](0025-reference-harvesting.md)

---

## 1. The decision

There is no avatar inside the chat transcript. An incoming bubble starts at the
same 16dp content edge an outgoing bubble ends at, and the composer capsule
traces both.

Amit, asked directly and answering directly: **"Remove it, align the grid."**

This is a product decision, not a structural one, which is why it is written
down rather than inferred: the platform does not forbid an avatar in a
transcript, and several messaging apps ship one. What the platform does ask for
is the consistency the avatar was breaking.

## 2. What was there, in numbers

`Turn.tsx`'s `peerRow` was `flexDirection: 'row'` holding a 26dp `AVATAR_SLOT`
spacer and a `space.xs` (8) gap before the bubble. So:

| Edge                   | Before               | After  |
| ---------------------- | -------------------- | ------ |
| Incoming bubble, left  | 16 + 26 + 8 = **50** | **16** |
| Outgoing bubble, right | 16                   | 16     |
| Composer capsule, left | 16                   | 16     |

One grid on one edge and a different grid on the other. Two consequences, both
measurable rather than aesthetic:

1. **The capsule could not trace the bubble grid on the left.** Aligning the
   composer to the transcript is what `Composer.tsx`'s `CAPSULE_MIN_H` and
   `ChatScreen`'s `list.paddingHorizontal` are jointly about, and only the
   outgoing half of it was ever true. `chatSurface.test.ts` could assert the
   outgoing edge and nothing else, because the incoming edge was wrong.
2. **`maxWidth: '80%'` was a lie on one side.** Both sides read `'80%'`, but the
   peer's 80% was taken of a column already 34dp narrower. `peerRow` is now the
   mirror of `myColumn` — full width, `2xs` gap, aligned to its own side — so the
   two percentages finally measure against the same width.

50dp is also off the baseline grid the platform asks for: not a multiple of 8,
nor of 4. 16 is.

## 3. Why removing it loses nothing

- **The app is exclusively 1:1.** [ADR-0020](0020-ephemeral-bilateral-paid-sessions.md)
  is "Ephemeral **bilateral** paid sessions" — a session is a lease between two
  parties, and the Play Billing exemption it turns on is written for "1:1 paid
  online services" (`:21`). There is no group thread to disambiguate.
  An avatar in a two-party
  transcript answers a question nobody asked: every bubble on the left is the
  one other person in the thread, and the side already says so.
- **The header carries the identity.** `ChatScreen`'s identity block is a 30dp
  `Avatar` plus the name and a presence line, one tap target, always visible.
  The transcript avatar repeated it once per group boundary.
- **The primary reference agrees, and its own numbers say why.** Telegram's
  in-transcript avatar is a GROUP avatar — `design/references/telegram.md:127`,
  "Group avatar beside incoming 42 dp … n/a (1:1)" — and its max-width
  expression is `screen − dp(80 + 42 if avatar)` (`:123`), i.e. the 42 is
  conditional on there being an avatar at all. In a 1:1 thread there is none,
  which is exactly why Telegram's input bar can trace its bubble grid. Read
  clean-room under ADR-0025: measured and re-expressed, no Telegram code.
- **WhatsApp's 26dp, the number Pappal originally copied, is the same GROUP
  measurement.** `docs/android-audit.md` › "WhatsApp physical-device visual
  benchmark" recorded it and applied it without asking what it was a measurement
  of. That row is now marked superseded and points here.

## 4. What the removal deleted

From `src/components/Turn.tsx`: `AVATAR_SLOT`, the `slot` spacer, the `initial`
and `avatarUri` props, the `first` prop, `peerColumn`, and `peerRow`'s row
direction and gap. From `src/screens/ChatScreen.tsx`: the `avatarUri={avatarUrl}`
call site.

`first` still exists in `ChatScreen`, where it drives `turnOpensGroup`'s larger
top padding. **Grouping survives the avatar; it was never the avatar's job** —
the vertical rhythm between an older turn and a new speaker's first turn is a
`paddingTop` on the row, unrelated to the horizontal slot.

`avatarUrl` and `initial` also survive in `ChatScreen`, feeding the header
identity block and the empty-state 56dp avatar. Both are live.

## 5. If it ever comes back

It comes back **on both sides or on neither**. A slot on the incoming side only
is what produced the asymmetry twice; the third occurrence should not be allowed
to look accidental. Trigger to revisit: group threads. Nothing else in the
product changes the answer, because nothing else changes the fact that a 1:1
transcript has one possible author per side.
