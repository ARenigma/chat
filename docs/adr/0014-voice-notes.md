# 0014. Voice notes: the library, the waveform, and what the microphone costs

Status: accepted
Date: 2026-08-22
Completes the client half of migration 011. Changes what ADR-0004's privacy
claims and the Play Data Safety declaration say.

## Context

Migration 011 already shipped the server half: `messages.voice_path` and
`voice_duration_ms`, a `message_carries_one_payload` constraint that makes a row
with both text and audio unrepresentable, a `voice_path_is_scoped` constraint
pinning the object key to `<conversation>/<uuid>.m4a`, a private `voice-notes`
bucket whose read policy authorises on that first path segment, a `send_message`
overload that takes the pair, `submit_report` snapshotting the path as evidence,
and `purge_orphaned_voice_notes` on a nightly cron. None of it had a caller.

What follows are the decisions the client half needed, in the order they were
forced.

## Decision 1: react-native-nitro-sound, 0.2.19

The obvious candidate, `react-native-audio-recorder-player`, is npm-deprecated
**in favour of this package**, by the same author, with the deprecation notice
naming it. That is the `react-native-callkeep` situation with a signpost.

The others were ruled out for reasons rather than by feel:

- `react-native-track-player` has shipped two stable releases in two and a half
  years, has no recorder at all, and would contribute a foreground service and
  media permissions to the merged manifest for no product gain.
- `expo-av` and its maintained successor `expo-audio` both require the `expo`
  peer, which rewires both native builds in a bare app.
- `@dr.pogodin/react-native-audio` is genuinely maintained, and requires
  `react-native-permissions`: a second native dependency for something
  `PermissionsAndroid` already does in core.

nitro-sound was published fifteen days before this landed, its own
devDependencies pin `react-native` and `@react-native/babel-preset` to 0.86.2
exactly, and its `react-native-nitro-modules` peer is already installed for
react-native-mmkv, so no new native dependency _tree_ arrives with it.

**The risk that mattered, and how it resolved.** Its generated glue was produced
with nitrogen 0.36.5 while this app resolves nitro-modules to 0.37.0, and no
native build in this repo had ever run against 0.37.0. `./gradlew
:app:assembleRelease` was run as part of this change: it configured and built the
nitro CMake for all four ABIs, bundled the JS, ran R8, and produced a signed-shape
release APK. The skew is not a problem today. If a future bump breaks it, pin
`react-native-nitro-modules` to `0.36.5`, which both nitro-sound and mmkv accept.

## Decision 2: tap to record, not hold to talk

WhatsApp's gesture is hold the mic, slide left to cancel, slide up to lock. It is
not copied, and the reasons are not aesthetic.

TalkBack and VoiceOver cannot express "hold and slide", and a sustained hold
excludes people with tremor or limited grip. So any hold-to-talk implementation
needs a tap path _as well_, for exactly the users a peer-support product should
least want to shut out. Having built the tap path, the hold is a second way to do
the same thing.

It also costs a `Gesture.Pan` in a row that sits above an inverted list, where a
horizontal pan and the list's scroll have to be taught not to fight.
`contract.test.ts` asserts Sheet is still the only file declaring a gesture,
precisely so the next pan is a decision rather than a copy, and this particular
interaction cannot be verified anywhere except on a device.

So: tap the mic, watch the meter, tap stop, then send or discard. If the hold is
added later it belongs on top of this, not instead of it.

The **review** state between stop and send is not decoration. The recorder stops
itself at the three-minute ceiling, and auto-sending there sends a sentence that
was cut off mid-word.

## Decision 3: the waveform is flat, and that is the honest answer

There is no peaks column. 011 stores a path and a duration, and no platform API
gives amplitudes for a file you did not record: the sender's own metering is the
only real waveform that ever exists, and it is not persisted.

Two options, then. Derive a plausible-looking shape from the message id, which is
what a fabricated waveform is: a picture of nothing, presented as a picture of
what somebody said. Or draw every bar at the same height, which reads as a track
with a playhead, which is exactly what it is.

The second. The recorder's real peaks are shown once, in the composer's review
state, because that is the one moment they exist.

Storing them would fix it and it is a schema change, not a component change: a
`voice_peaks` column, a line in the guard trigger that already names
`voice_path`, a pgTAP assertion and a migration. Worth doing. Not worth
pretending to have done.

## Decision 4: the upload is hand-rolled, because storage-js cannot do it

`supabase.storage.from(b).upload(path, body)` throws in React Native before a
byte leaves the device. storage-js's FormData branch calls
`body.has('cacheControl')`, and RN's FormData polyfill implements only `append`,
`getAll` and `getParts`. The Blob branch is no help either: RN's Blob cannot be
constructed from a file path.

What works needs no filesystem module and puts no bytes through JS. RN's
networking layer streams a file part natively when given `{ uri, name, type }`,
so `src/api/voice.ts` posts the same multipart shape storage-js sends for a
browser Blob, to the same endpoint.

Two properties of that path are deliberate:

- **Upload first, insert second.** `voice_path` is not client-writable after the
  fact, so the row is written once and has to reference audio that already
  exists. The cost is an orphaned object when the RPC rejects after a successful
  upload, and `purge_orphaned_voice_notes` sweeps those after 24 hours.
- **No upsert, ever.** The bucket has no UPDATE policy on purpose: a sender who
  could replace the audio under a note that has been read or reported would make
  the recording worthless as evidence. A retry mints a new key.

## Decision 5: playback streams and is never cached

`startPlayer` hands an `http` URL straight to the platform player, so no received
audio is written to the recipient's disk. That is the right default for a product
that sets `FLAG_SECURE`. The cost is that a replay refetches a few hundred
kilobytes, and the signed URL is minted on the tap rather than per row: one
credential per note on screen, whether or not anybody listens, is a lifetime
nobody asked for.

The player is a singleton with one `mediaPlayer` field, so starting note B stops
note A whether or not anything asked it to. "Which note is playing" is therefore
one value in the store, and every bubble reads it behind a selector keyed on its
own id, so the ten-times-a-second playhead re-renders one bubble rather than the
list.

## Decision 6: one output file on disk, and no filesystem dependency

With no `uri` argument the recorder invents `sound_<timestamp>.mp4` in the app's
private directory and nothing ever deletes it, so every cancelled and every
already-sent recording would accumulate forever. The app has no filesystem
module and adding one to call `unlink` would be a native dependency bought for
one line.

Instead the first path the recorder chooses is remembered in MMKV and handed back
on every later recording. `MediaRecorder.setOutputFile` and `AVAudioRecorder`
both truncate, so at most one outgoing audio file ever exists and the next
recording is what deletes the last one.

## What this costs, stated rather than buried

**A gate got weaker.** `scripts/verify-manifest.mjs` listed `RECORD_AUDIO` as
forbidden, which meant no dependency could quietly acquire the microphone. It is
in the allowlist now, so only a _new_ permission is caught. The narrower
protection that replaced it is a contract assertion that
`react-native-nitro-sound` is imported by exactly one file. `CAMERA` stays
forbidden: there is no video call and no photo input.

**Two documents had to change, and one console form still does.**
`web/privacy.html` no longer says the app holds no microphone, and says what is
recorded, where it lives and for how long. `docs/play/listing.md` gains an Audio
row in the Data Safety table and loses audio from its "not collected" line.
**The Play Console Data Safety declaration must be amended before an AAB
declaring RECORD_AUDIO is uploaded.** That is out-of-band, nobody can do it from
this repo, and uploading first is a policy violation rather than a paperwork nit.

**Audio defeats the screenshot story in a way `FLAG_SECURE` cannot address.** A
voice note can be recorded off the speaker by a second device. No copy anywhere
should imply otherwise.

**A reported recording outlives the account that sent it**, for the same 90 days
and the same reason as a reported message. It is a louder version of the same
trade because it is somebody's voice, so the privacy page says it in plain words
rather than leaving it to be inferred from the messages paragraph.

## One thing fixed on the way past

The provider side of `ChatScreen` could not resolve a conversation id at all.
`open_conversation` takes a **provider** id and raises `not an admitted provider`
for anything else, and the provider tree renders that screen with a _member's_
profile id. So the transcript never loaded and the composer stayed disabled.

Voice notes made that visible rather than causing it, and a feature written for
both roles and reachable by one is worse than one that is honestly absent. The
fix does not touch the RPC, which is security-relevant and correct: the
`conversation_summaries` row already carries the id, and `i_am_member` is the
authoritative answer to which side of a thread the caller is on.

## What is not built

- **No preview before sending.** The review state shows the length and the real
  waveform, and there is no way to hear it back. Reusing the player for a local
  file is cheap and it is a second playback route to keep in step with the first.
- **No peaks column**, so no true waveform on a received note. See decision 3.
- **Nothing stops a recording during a call**, because there are no calls yet.
  When `CALLS_ENABLED` flips, recording has to be refused while a call is active
  and the call path has to stop playback, or one of the two silently fails on the
  audio session.
- **Playback speed is applied but only lightly exercised.** Writing
  `playbackParams` on a _paused_ MediaPlayer is known to resume it on some Android
  builds; the rate is only ever set immediately after `startPlayer`, which avoids
  that, and it has not been checked on a device.

## Review trigger

Revisit if `react-native-nitro-sound` stops publishing for more than four months
(its cadence to date has no gap longer than that), or if the nitrogen/nitro-modules
version skew breaks a build.
