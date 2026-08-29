# ADR-0020, Ephemeral bilateral paid sessions

- **Status:** Accepted (2026-08-29)
- **Decision by:** Amit Ranjan
- **Resolves:** the backend session model left unbuilt by ADR-0019, and aligns
  the session store with Google Play policy on content recording.

---

## Context

ADR-0019 established per-minute pricing and described a session meter
(`open_session` / `tick_session` / `close_session`) as a follow-up. That
backend was never built. Meanwhile:

- The current schema stores message bodies indefinitely and bills on two meters
  (per-message via `send_message` + per-minute via `spend_chat_minute`), an
  inconsistency the UI already hides.
- Google Play policy
  ([support.google.com/googleplay/android-developer/answer/10281818](https://support.google.com/googleplay/android-developer/answer/10281818))
  exempts 1:1 paid online services from Play Billing's mandatory cut **only
  when the sessions are not recorded and not replayable.** Durable message
  history destroys that exemption.
- The dual meter (per-message + per-minute) is a billing bug: a member pays
  twice for the same minute.

---

## Decision

### Sessions are ephemeral

All paid sessions are ephemeral. Ordinary messages and media are purged from
every participant's view when the session ends. **Recent Chats shows only
metadata:** peer, date, channel (chat/audio/video), duration, spend, and
member rating. No message body, no voice note, no attachment.

This preserves the Play Billing service exemption while satisfying the
product intent (peer support, not a transcript service).

### Bilateral handshake gates every session

A session does not start because one party taps "Chat" or "Call". It starts
when **both participants have confirmed live server leases** — and, for calls,
when connected media is confirmed. Billing begins only then.

Handshake rules by initiator and role:

| Initiator | Recipient    | Rules                                                                  |
| --------- | ------------ | ---------------------------------------------------------------------- |
| Member    | Any provider | May initiate chat, audio, or video at any time.                        |
| Provider  | Prior member | May initiate chat or call to a member who has spoken with them before. |
| Provider  | New member   | Only when the member has an open, unanswered chat request.             |

Additional timing rules:

- Member chat requests expire in **24 hours** if not accepted.
- Provider "available" return invitations expire in **30 minutes**.
- Calls ring for **30 seconds** on the recipient's device.
- If the initiator is absent when the recipient accepts, the acceptance is
  converted to a provider return invitation (30m window).

The **both-present handshake is mandatory**: no session opens, and no billing
starts, until both sides have active server leases.

### Per-minute is the only meter

Per-message debit is retired. The sole meter is elapsed whole minutes of a
live session. The first minute is prepaid at session activation; subsequent
minutes tick on a server-side heartbeat. The rate is snapshotted at activation
and does not change mid-session.

Member always pays. Provider never pays to initiate.

### Session end rules

**Text sessions:**

- Immediate on a clean background/terminate event.
- 30-second disconnect grace: both sides may reconnect without a new handshake.
- 5-minute inactivity timer; 30-second warning before the session closes.

**Calls:**

- 30 seconds of unanswered ring.
- 90 seconds of silence (no audio detected on either side).

### Reporting

The end sheet offers two options: **End** and **Report and end**.

- **Report and end (text):** the reporter selects specific messages; those
  messages plus limited surrounding context are copied before purge. The copied
  extract and the reporter statement go to the moderation queue.
- **Report and end (call):** retains metadata only (category, duration, parties,
  reporter statement). No recording is retained.

Retained evidence is kept for one year from moderation case closure, then
permanently deleted.

---

## What this retires

| Retiring                                  | Replacement                                  |
| ----------------------------------------- | -------------------------------------------- |
| `spend_chat_minute` / dual-meter pattern  | Single server-tick per-minute session meter  |
| Per-message token debit in `send_message` | Meter runs only on active, bilateral session |
| Client-side chat timer in `src/lib/`      | Server-authoritative session tick            |
| 5-token flat call rate                    | Per-minute call rate (same as chat/video)    |
| `conversation_summaries.last_body` select | Metadata-only summary (no body field)        |

Existing message history is purged at cutover. There is no migration path for
retained message bodies — this is deliberate and required for the exemption.

---

## Consequences

- `conversation_summaries` must stop projecting `last_body` entirely. Any
  client code reading that field will receive null after cutover; treat null as
  "session ended" for display purposes.
- The bilateral handshake requires a new presence/lease layer. The existing
  `declare_presence` declared-presence model is member-facing and does not
  carry the per-session lease semantics needed here.
- Evidence retention requires a separate, append-only moderation table that
  survives the session purge. It must never be readable by either participant.
- The 30-second disconnect grace window prevents billing a reconnect as a new
  session; the server must hold the rate snapshot and elapsed minutes during
  the grace period.
