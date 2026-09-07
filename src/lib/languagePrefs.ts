/**
 * The member's language preference: what is offered, how it is toggled, and how
 * it reorders the directory.
 *
 * Pure, and a sibling of `providerFilters.ts` rather than part of it, because
 * the two answer opposite questions and the difference is the product decision
 * (Amit, 2026-09-07): "sort not filter for language". `providerFilters.ts`
 * REMOVES people; nothing in this file ever does. On a roster this size a
 * language filter can empty the screen, and an empty screen is a worse answer
 * than a well-ordered one.
 *
 * No `react-native` import anywhere in here, for the reason `bloom.ts` and
 * `onboarding.ts` give: there is no renderer in devDependencies, so a lib file
 * is the only thing this repo can actually test.
 */
import type { ProviderSummary } from './database.types';

/**
 * The languages a member may say they want, and where the list comes from.
 *
 * **Derived, not invented.** It is the set a provider can actually claim, which
 * is `LANGUAGES` in `src/screens/ProviderApplicationScreen.tsx:56` — the only
 * place in the app that decides what goes into `profiles.languages`, and
 * therefore the only set a match can ever be found in. Offering a member a
 * language no provider is able to tick would be a question whose answer can
 * never change the order of anything.
 *
 * `scripts/seed-dev.sql:87-96` uses five of the six (English, Hindi, Marathi,
 * Tamil, Bengali); Telugu is offered to providers and simply has no seeded
 * speaker yet, which is a fact about the fixture rather than about the product.
 * The seed is therefore a subset and not the source — taking the list from it
 * would drop Telugu the moment a real Telugu provider signed up.
 *
 * Order is the provider form's order, unchanged, so the same six read the same
 * way on both sides of the marketplace. `__tests__/languagePrefs.test.ts` gates
 * the two against each other so neither can drift.
 */
export const OFFERED_LANGUAGES: readonly string[] = [
  'English',
  'Hindi',
  'Tamil',
  'Telugu',
  'Bengali',
  'Marathi',
];

/**
 * The database's own ceiling, mirrored from migration 072's
 * `language_list_is_sane`, so the UI cannot build a selection the server will
 * reject with a constraint violation the member cannot act on.
 *
 * Twice the offered set: the constraint is a paste-bomb floor, not a product
 * rule, and the product must be able to offer a seventh language without a
 * migration.
 */
export const MAX_PREFERRED_LANGUAGES = 12;

/**
 * Case- and whitespace-insensitive, because the two sides of the match are
 * written by different people. `profiles.languages` is typed by a provider
 * through a chip row today, but it has been writable by the admin console and
 * by `scripts/seed-dev.sql` since 006 and has no CHECK constraint, so 'hindi'
 * and ' Hindi' both exist as possibilities. A sort that silently failed to
 * match them would look like the feature doing nothing.
 */
function fold(language: string): string {
  return language.trim().toLowerCase();
}

/**
 * Toggle one language, keeping `OFFERED_LANGUAGES` order rather than tap order.
 *
 * The same rule as `toggleBand` in `providerFilters.ts` and for the same
 * reason: a chip row that reorders itself under the finger loses the member's
 * place in it. Anything already selected that is no longer offered is preserved
 * in its existing relative order, so a language retired from the form does not
 * silently drop a preference the member never revisited.
 */
export function toggleLanguage(
  selected: readonly string[],
  language: string,
): string[] {
  const key = fold(language);
  if (selected.some(l => fold(l) === key)) {
    return selected.filter(l => fold(l) !== key);
  }
  if (selected.length >= MAX_PREFERRED_LANGUAGES) {
    return [...selected];
  }
  const next = [...selected, language];
  const rank = new Map(OFFERED_LANGUAGES.map((l, i) => [fold(l), i]));
  const unknown = OFFERED_LANGUAGES.length;
  return next
    .map((l, i) => ({ l, i, r: rank.get(fold(l)) ?? unknown + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.l);
}

/** Whether a language is in the current selection, folded both sides. */
export function isLanguageSelected(
  selected: readonly string[],
  language: string,
): boolean {
  const key = fold(language);
  return selected.some(l => fold(l) === key);
}

/**
 * How many of the member's chosen languages this provider speaks.
 *
 * The RANK, and the reason it is a plain count rather than a ratio:
 *
 *   - **Two of three beats one of three.** More shared languages is more room
 *     for the conversation to go somewhere, which is the only monotone reading
 *     of "sort by language" and the one a member would predict.
 *   - **Not a share of the PROVIDER's languages.** `matched / p.languages.length`
 *     ranks a provider who speaks only Hindi above one who speaks Hindi and
 *     four others, which penalises exactly the people best placed to help.
 *   - **Not a share of the MEMBER's selection either.** For a fixed selection
 *     that is the raw count divided by a constant, so it produces an identical
 *     order and only adds a way to get the arithmetic wrong.
 *
 * Exported because it is the whole ranking rule, and a rule that can only be
 * observed through a sorted array is a rule that cannot be tested directly.
 */
export function languageMatchCount(
  provider: Pick<ProviderSummary, 'languages'>,
  selected: readonly string[],
): number {
  if (selected.length === 0) {
    return 0;
  }
  const want = new Set(selected.map(fold));
  // Deduplicated, so a provider row carrying 'Hindi' twice — possible, since
  // `profiles.languages` has no uniqueness constraint — cannot score twice.
  const spoken = new Set((provider.languages ?? []).map(fold));
  let n = 0;
  for (const l of spoken) {
    if (want.has(l)) {
      n += 1;
    }
  }
  return n;
}

/**
 * The directory, reordered so the people a member can talk to come first.
 *
 * **Every row that went in comes out.** This is a sort, never a filter, and
 * `__tests__/languagePrefs.test.ts` asserts the length and the membership on
 * every case rather than only the order.
 *
 * The full ordering, in the order the comparator applies it:
 *
 *   1. **More matched languages first.** See `languageMatchCount`. A provider
 *      matching two of the member's three outranks one matching one, which
 *      outranks one matching none.
 *   2. **Ties keep the order they arrived in.** That order is not arbitrary and
 *      is not this function's to invent: `useProviders` in `src/api/chat.ts`
 *      asks the server for `is_available desc, created_at asc` — listed
 *      providers first, then oldest-joined first — and `filterProviders`
 *      preserves it. So availability and seniority remain the tie-break they
 *      already were, and a member with no language preference sees precisely
 *      the screen they see today.
 *
 * The incoming index is carried explicitly rather than leaning on
 * `Array.prototype.sort` being stable. It is stable — required since ES2019,
 * and Hermes implements it — but "the tie-break is the previous order" is a
 * stated ranking rule here, and a rule that depends on an engine guarantee
 * nobody restates is a rule that quietly becomes false. Decorating also makes
 * it directly assertable.
 *
 * A provider with no languages at all scores zero, so they sink below anyone
 * who matches and hold their place among the other non-matchers. They are never
 * dropped — a provider row that predates the languages column is not a provider
 * a member should stop being able to see.
 *
 * An empty selection short-circuits: every score is zero, so the comparator
 * would return the input order anyway, and the copy makes that a fact rather
 * than an inference.
 */
export function sortByLanguageMatch<T extends Pick<ProviderSummary, 'languages'>>(
  rows: readonly T[],
  selected: readonly string[],
): T[] {
  if (selected.length === 0) {
    return [...rows];
  }
  return rows
    .map((row, index) => ({ row, index, score: languageMatchCount(row, selected) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(x => x.row);
}
