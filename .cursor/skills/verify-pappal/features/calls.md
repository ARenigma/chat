# Calls

Outgoing/incoming voice and video calls, native ringing, Agora media, controls,
media upgrades, and paid duration.

## Sub-features

- Foreground and FCM/notification incoming paths
- Accept/decline, timeout, reconnect, and hang-up
- Mic, speaker route, camera, self-view drag, and voice-to-video upgrade
- Agora network fallback and actual elapsed settlement

## How to get to it (user POV)

Member: provider detail → voice/video call. Provider: accept from the in-app
ring or Android notification. Use two authenticated endpoints for connected-call
proof.

## Driving it with control-pappal

Use `scripts/call-sim.mjs` and `.maestro/call-sim-*.yaml` to coordinate both
endpoints. Once active:

```bash
npm run control -- tap --id call-speaker
npm run control -- tap --id call-video-toggle
npm run control -- snapshot --out artifacts/verification/call-active.xml
npm run control -- screenshot artifacts/verification/call-active.png
```

Stable IDs include `call-status`, `call-accept`, `call-decline`, `call-mute`,
`call-end`, `call-video-toggle`, and `call-local-pip`.

Proof includes both endpoints, Agora/logcat callbacks, real audio route, camera
state, duration settlement, and frame/video evidence for motion.

## Gotchas

- A successful fallback does not prove Agora’s primary path ran; read SDK logs.
- Notification answer must preserve `medium=video`.
- Audio route can change from Bluetooth/wired/system events without a button tap.
- Never judge drag direction or interruption from a still screenshot.
