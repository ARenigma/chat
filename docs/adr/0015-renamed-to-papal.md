# ADR-0015: renamed to Pappal, but the package did not change

Status: **accepted**
Date: 2026-08-23

The product is called Pappal. This records what was renamed, what was not, and why
the difference matters.

## Renamed

| Where                          | Was           | Now    |
| ------------------------------ | ------------- | ------ |
| Launcher label (`strings.xml`) | CompanionChat | Pappal |
| `app.json` `displayName`       | CompanionChat | Pappal |
| The five public web pages      | CompanionChat | Pappal |
| `docs/play/listing.md`         | CompanionChat | Pappal |

## Deliberately not renamed

**The applicationId stays `com.companionchat`.** It is the identity that Play, the
Firebase project, the upload keystore and the `companionchat://auth-callback`
OAuth redirect are all keyed to. Changing it means a new Play listing with no
history, a new Firebase app with new push tokens, and a sign-in redirect that
Supabase would reject until its allow-list was updated. A user never reads an
applicationId, so the rename costs nothing by leaving it.

**`app.json`'s `name` stays `CompanionChat`.** It has to keep matching
`AppRegistry.registerComponent` in `index.js` and `getMainComponentName()` in
`MainActivity.kt`. It is an internal registration key, not a name.

**The ADRs keep the old name.** ADR-0008 and ADR-0009 describe decisions taken
when the product was called CompanionChat. Rewriting them would make the record
claim a name that did not exist at the time, and the point of a decision log is
that it is not edited to look tidy afterwards.

**The repository directory stays `chatapp`.** Renaming it breaks every absolute
path in tooling, CI and the two git remotes for no user-visible gain.

## The wordmark

The owner asked for the display face sold at Envato as "Chunk", specifying a free
source. That item is a repackaging of an open-source design; the free original and
its licence are established in `design/references/build-spec.md`, and the wordmark
token is added there rather than here, because it is a design decision with a
measurement behind it rather than a naming one.
