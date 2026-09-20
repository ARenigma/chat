# Chat

The shared V2 transcript, composer, paid-session handshake, media rows, and
member/provider conversation routes.

## Sub-features

- Text send, persistence, retry, read receipts, and typing
- Voice notes, reactions, reply/edit/delete
- Session request, bilateral consent, billing, and ended-session rows
- Offline/reconnect, page-down, unread, and long-system-message behavior

## How to get to it (user POV)

From Home, open a provider and choose Chat, or open an existing conversation.
For provider-side proof, sign in as that provider and open the same thread from
Provider Home.

## Driving it with control-pappal

Debug/internal setup may use:

```bash
npm run control -- open companionchat://chat-v2/<provider-uuid>
npm run control -- tap --id composer-send
npm run control -- wait-settle
npm run control -- screenshot artifacts/verification/chat-after-send.png
```

Then exercise the actual row/composer controls. Existing end-to-end recipes are
`.maestro/02-send-and-persist.yaml`, `04-network-faults.yaml`, and
`05-offline-resume.yaml`. Stable IDs include `chat-v2-screen`, `chat-v2-list`,
`chat-v2-dock`, `chat-v2-system`, `chat-v2-page-down`, and `chat-v2-consent`.

Proof includes the visible row on both roles and the database/realtime side
effect, not only the optimistic sender UI.

## Gotchas

- Verify shared transcript changes from both member and provider trees.
- Harness deep links are setup conveniences and unavailable in production.
- Paid-session and wallet correctness require `npm run test:db`.
- System rows, dividers, and call logs are distinct row kinds.
