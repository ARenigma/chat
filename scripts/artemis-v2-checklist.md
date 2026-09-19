# ARTEMIS V2 device checklist — NOT RUN

Target an installed, signed-in **internal** build using an **isolated test account**
and supply the device serial and seeded provider UUID. This routine **must not send**
messages, reactions, reports, edits, deletes, calls, or any other real server
write. Enter through
`companionchat://chat-v2/<provider-uuid>`; production release must reject it.
Use resource IDs first and accessibility labels only as fallback.

1. Open `chat-v2-screen`; verify `chat-v2-list` and `chat-v2-input` exist.
2. Choose a fully visible unique `chat-v2-row-<row-id>` and record that exact
   resource ID and top bound. Focus `chat-v2-input`, retract the IME
   interactively, relocate the **same row resource ID**, and record its bound.
   Retract drift must be **≤ 4dp**. Repeat three times; never substitute the
   next visible row.
3. Inspect a pre-seeded `Hi` `chat-v2-message-mine`: one text line, own-side
   alignment, and the bubble edge within **≤ 2dp** of the established
   own-message edge. Do not send a new message.
4. Inspect `chat-v2-message-peer` against the peer edge; peer alignment must
   remain within **≤ 2dp** across adjacent peer bubbles.
5. Inspect a missed `chat-v2-call`: its visible label is one line. If
   `chat-v2-call-back` exists, its accessibility label states the call-back
   action.
6. Long-press `chat-v2-message-mine`. `chat-v2-own-menu` opens with
   `paper-menu-edit` and `paper-menu-delete`; `reaction-strip` must be absent.
7. Dismiss, then long-press `chat-v2-message-peer`. `reaction-strip`,
   `strip-reply`, and the reaction choices must exist; the owner menu must be
   absent.
8. Scroll `chat-v2-list` into history until
   `chat-v2-page-down-visible` exists. Measure `chat-v2-page-down` against the
   top of the full `chat-v2-dock`; the gap must remain **≥ 8dp** while the IME
   is closed and open. Tap it and verify the marker disappears at the newest
   message.
9. At the bottom, type a multiline message until the composer reaches its
   maximum growth; verify no bubble or page-down control is covered. Clear the
   draft without sending it.
10. Using only a pre-arranged isolated fixture update, inspect history and
    verify the exact `chat-v2-row-<row-id>` anchor is preserved and the
    page-down badge increments instead of jumping. ARTEMIS must not create the
    peer message.
11. Accessibility/manual checks: enable TalkBack, traverse header, bubbles,
    `chat-v2-page-down`, composer, menus, reactions, and call-back in reading
    order; confirm labels, roles, focus visibility, 48dp targets, large text,
    dark theme, and reduced-motion behavior.

## Chrome added 2026-09-19 (parity sweep) — also NOT RUN

These surfaces exist in V2 only since the parity sweep, so nothing about them
has been seen on hardware. Same rules as above: isolated account, no real
server writes, resource IDs first.

12. Header: `chat-v2-identity` shows the avatar, the name and the presence
    line, and the bar's height does not change as presence arrives or goes.
    A long press opens the rename sheet; a tap opens the profile (member tree)
    or the safety sheet (provider tree). `chat-v2-call-audio` and
    `chat-v2-call-video` are present and DISABLED — never removed — when a
    medium cannot start.
13. Provider tree: enter through the same link while signed in as a provider.
    `chat-v2-screen` mounts, the header pill is earnings (not a balance), and
    back returns to the provider home.
14. With a seeded live session inside its last five minutes: the extend card
    holds the band, its countdown ticks per second, scrolling one card-height
    hands the band to `chat-v2-recharge`, and dismissing the card does the
    same. The two never appear together.
15. `chat-v2-end-session` appears only while a session is live and opens
    `chat-v2-leave`; cancelling leaves the session running.
16. Back ladder, one press per rung, in this order: the reaction strip / owner
    menu, then any open sheet, then the reply strip, then the leave
    confirmation. The screen must not pop while any of them is open.
17. Composer draft: type without sending, leave the chat, return — the draft
    is gone. Type without sending, background and foreground the app — the
    draft is still there.
18. The keyboard geometry checks (2, 8, 9) must be repeated with the session
    band on screen: the band adds height above the transcript and the dock
    measurement must not move because of it.

**Executed and passed on 2026-09-19** — Samsung Galaxy S22 (SM_S908E,
Android 16). V1 was deleted the same day and both normal `chat` routes now
mount `ChatScreenV2` unconditionally; there is no flag left to hold.

Record screenshots/bounds and the ARTEMIS trace ID for any re-run.
