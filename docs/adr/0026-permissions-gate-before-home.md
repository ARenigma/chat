# ADR-0026, Permissions are asked for on one explained screen before Home

Status: **amended and shipped**
Date: 2026-09-06
Guard: `__tests__/contract.test.ts` › "asks for permissions on one explained screen before Home, never as bare dialogs over it"

---

## 1. The decision

After sign-in and after the policy gate, and before Home, the app shows one
screen (`PermissionsScreen`) that names the three runtime permissions Pappal
needs — microphone, camera, and on Android 13+ notifications — each with the
reason it exists, and asks Android for them one dialog at a time. Home is not
reachable until all that apply are granted. The way out for someone who will
not grant them is **Sign out**, offered on the same screen.

The gate is a phase of the boot machine in `App.tsx` (`'permissions'`, between
`'policyGate'` and `'ready'`), for the same reason the policy gate is: nothing
can route around a phase. `bootPhaseAfterAuth` only **checks**; the screen does
the asking.

Product decision: Amit, 2026-09-05, goal item 15 — "permissions screen before
home, all mandatory".

## 2. What it replaces

Until this change the `ready` effect in `App.tsx` fired `startPush()` (which
requests `POST_NOTIFICATIONS`), then `RECORD_AUDIO`, then `CAMERA`, the moment
Home appeared — three bare system dialogs over the first screen a new member
sees, with a one-line rationale each and nothing about what Pappal is. Android
treats the second "Deny" for a permission as permanent, so a member who tapped
through those dialogs to get to the app had, twice, spent a grant they could
only get back through Settings.

## 3. Where this departs from the platform docs, and why

`developer.android.com/training/permissions/requesting` says, in order: ask in
context when the user starts the feature; show educational UI only when
`shouldShowRequestPermissionRationale()` says so; **don't block the user
interface** with a full-screen wall; **always provide the option to cancel** an
educational flow; degrade gracefully on denial. The notification-permission
page adds: let people use the app first, ask when they tap the bell.

This screen keeps what it can of that and departs on one point deliberately:

- **Kept.** It is the educational UI, so the system dialogs carry no second
  rationale (the old code passed a `rationale` object, which makes
  `PermissionsAndroid` show its own Alert first). Dialogs are strictly
  sequential — Android drops a request while another is pending. A permanent
  denial is shown as such, with Settings one tap away, and the screen re-checks
  on foreground so a grant made in Settings is picked up without a tap.
- **Departed.** The screen is mandatory. The argument: Pappal has no feature
  that is not a call or a chat with a real person, so Home _is_ the context —
  there is nothing to explore first that does not need a microphone or a
  notification. "Cancel" is honoured as Sign out rather than as a Home without
  calls, which would be a Pappal no one can use.
- **Not built.** An admin kill switch for the gate. If Play review or the
  funnel says the wall costs more than it saves, that switch is the first thing
  to add (`permissions` config domain, migration 026 seeds).

## 4. Consequences

- New members see one screen instead of three dialogs; the copy can say what
  Pappal is before Android asks for anything.
- Existing members with everything granted never see it (the check passes and
  the phase is skipped).
- Revoking a permission in Settings later does not re-gate a running session;
  the event-time guards in recorder / composer remain the fallback for that.
- The `permissions` admin config (`*_internal` / `*_production` levels) no
  longer decides _whether_ to ask — the gate asks for all three — only whether
  `push.ts` shows the blocked-settings alert on a later permanent denial.

## 5. Amendment, 2026-09-19 — notifications are opt-in

Microphone and camera remain required by this gate. Notifications do not.
`POST_NOTIFICATIONS` is still explained and requested, but denying or
permanently blocking it cannot prevent Home, re-open the boot gate, or force a
trip to Settings.

This removes the notification-specific departure above. Android's notification
guidance says non-exempt notifications should use a dismissible, contextual
opt-in and that the app should remain usable after denial:

- https://developer.android.com/develop/ui/views/notifications/notification-permission
- https://developer.android.com/design/ui/mobile/guides/home-screen/notifications

Migration 121 publishes `notification_internal=optional` and
`notification_production=optional` in both config environments. It also
unschedules the automatic 18:30 IST engagement nudge.
