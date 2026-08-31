## fastlane documentation

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Android

### android metadata

```sh
[bundle exec] fastlane android metadata
```

Push store listing metadata (and optionally images); no AAB

### android internal

```sh
[bundle exec] fastlane android internal
```

Upload the gated AAB to internal testing

### android beta

```sh
[bundle exec] fastlane android beta
```

Promote internal -> closed beta at a staged percentage

### android widen

```sh
[bundle exec] fastlane android widen
```

Widen an in-progress rollout

### android halt_rollout

```sh
[bundle exec] fastlane android halt_rollout
```

Stop a rollout dead. Called when release health drops below threshold.

---

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
