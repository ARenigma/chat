# Performance scorecard (CTO Build Speed / Size / Asset gate §31)

Compiled 2026-09-10. Measured figures come from the S22 (Snapdragon 8 Gen 1,
the representative closed-testing device) unless noted. Dimensions that need a
device to measure and could not be captured this pass are marked
**unmeasured (device-gated)** rather than guessed — an empty cell is honest, a
fabricated number is not.

## Scorecard

| Dimension                | Measurement                                                     | Target                       | Status                    |
| ------------------------ | --------------------------------------------------------------- | ---------------------------- | ------------------------- |
| Cold startup (TTID)      | 246 → 189 → 159 ms across runs                                  | < 500 ms (M3 good)           | ✅ excellent              |
| Memory (PSS, steady)     | 131 MB                                                          | < ~200 MB on 8 Gen 1         | ✅ healthy                |
| JS bundle                | 5.26 MiB (release)                                              | < 6.0 MB gate                | ✅ under gate             |
| Delivered app size       | ~35 MB arm64 download                                           | —                            | ⚠️ Agora-bound, see below |
| R8 (release)             | minify + shrinkResources + `proguard-android-optimize`          | on                           | ✅ on                     |
| Baseline profiles        | present (`baselineProfiles/` generated)                         | present                      | ✅                        |
| Gradle config cache      | on (`assembleDebug --dry-run` 4s → 0.96s)                       | on                           | ✅                        |
| Release build (no-op)    | 12 m 18 s (25 tasks re-execute)                                 | —                            | ⚠️ see below              |
| Release ABIs             | arm64-v8a + armeabi-v7a (x86/x86_64 dropped, this pass)         | arm-only                     | ✅ applied                |
| Startup jank             | **unmeasured (device-gated)** — JankStats run returned 0 frames | < 5% janky                   | ⛔ retry on device        |
| Scroll jank (lists)      | **unmeasured (device-gated)**                                   | < 5% janky                   | ⛔                        |
| Memory under stress      | **unmeasured (device-gated)**                                   | no OOM / no unbounded growth | ⛔                        |
| Image/asset load timing  | **unmeasured (device-gated)**                                   | perceptible < 1s             | ⛔                        |
| Redmi pass               | **unmeasured** — device on a different subnet, unreachable      | parity with S22              | ⛔                        |
| Network-conditioned load | **unmeasured (device-gated)**                                   | usable on slow 3G            | ⛔                        |

## Notes

**App size is Agora-bound and already trimmed.** The ~35 MB arm64 download is
dominated by the Agora RTC native libraries (~28 MB rtc + ffmpeg per ABI), which
are irreducible for a video-calling product. The one applied lever is
`packagingOptions { exclude '**/libagora_*_extension.so' }` (removes ~40 MB of
unused extensions). Images/fonts/JS are a small fraction. There is no redundant
SDK to remove. The size-regression gate (`scripts/size-gate.mjs`) now guards the
one mutable vector — the JS bundle.

**Build speed.** Daily dev uses debug + active-arch-only and is fast. The 12 m
no-op release figure is release-specific: Metro bundle → dex → R8 → package, none
of which is incremental for a release build. The arm-only change applied this
pass (two native ABIs instead of four) is the one safe reduction of that time
with zero delivered-download impact.

**What remains for the device phase.** Every ⛔ row needs a booted device and, for
several, `adb`/JankStats/Macrobenchmark/Perfetto. The S22 wireless link and the
Play-signing mismatch (a Play-signed install can't be overwritten by a
local-upload-key build) are the current blockers. These are explicitly out of
scope for this pass by instruction ("except on-device verification").
