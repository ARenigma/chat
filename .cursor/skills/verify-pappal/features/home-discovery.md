# Home and discovery

Member Home, search/filtering, favourites, provider details, and chat entry.

## Sub-features

- Here-now chats rail and See all
- Provider categories, search, and Top picks
- Favourites
- Provider detail and availability actions

## How to get to it (user POV)

Sign in as a member and finish first-user setup. Home is the default route.
Scroll Explore, choose a provider, favourite them, then open chat or call.

## Driving it with control-pappal

```bash
npm run control -- tap --id home
npm run control -- tap --id explore-tabs
npm run control -- tap --id top-picks
npm run control -- snapshot --out artifacts/verification/home.xml
```

Use `scripts/v2-device-gates.mjs --serial <serial> --provider <uuid>` for the
geometry/inset contract. Stable IDs include `home-scroll-listener` / `home-scroll-astrologer` (one list per pager page), `home-pager`, `explore-tabs-listener` / `explore-tabs-astrologer`, `search-filters`,
`chats-see-all`, `detail-favorite`, `hero-pager`, and `favourites`.

Proof is the selected filter/provider reflected in the visible results and the
expected destination reached through the user-facing control.

## Gotchas

- First install can show HomeTour and SpotlightCard before normal interaction.
- Presence is provider-declared, not inferred from recent activity.
- A favourite mutation also has a provider-notification side effect; verify both.
