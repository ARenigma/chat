/**
 * What a provider says they help with: the offered set, how it is toggled, and
 * how many of it a row shows.
 *
 * A sibling of `languagePrefs.ts` and deliberately the same shape — a frozen
 * vocabulary, a fold-insensitive toggle that preserves the offered order, and a
 * ceiling mirrored from the database. Two lists of short strings attached to a
 * provider is one problem, and solving it twice differently is how the second
 * one ends up subtly wrong.
 *
 * No `react-native` import, for the reason `languagePrefs.ts` and `bloom.ts`
 * give: there is no renderer in devDependencies, so a lib file is the only
 * thing this repo can actually test.
 */
import type { ProviderSummary } from './database.types';
import { categoryOf } from './providerFilters';

/**
 * The topics a provider may claim, grouped by who claims them.
 *
 * **Two groups, because the roster has two kinds of person and one vocabulary
 * would misdescribe both.** A listener helping with a breakup and an astrologer
 * reading a birth chart are not doing the same job, and a single flat list
 * would either offer Tarot to a listener or drop it entirely. `provider_category`
 * (migration 065) already splits the directory into the Listeners and
 * Astrologers tabs, so the split exists; this follows it rather than inventing
 * a second axis.
 *
 * **Where the values come from.** The listener column is the topic vocabulary
 * Clarity uses on its own rows, which is what Amit asked for by name and by
 * example ("ex: anxiety|stress"). The astrologer column is the set Astrotalk's
 * `skillET` line actually renders — measured on the Redmi, where the visible
 * rows read "Vedic,  AI Astrologer" and "Numerology,  Vastu,  Tarot". Neither
 * is copied wholesale: this is the intersection with what a provider on THIS
 * roster could honestly claim, which is why there is no "AI Astrologer".
 *
 * **Title Case, not the lowercase of the brief.** Amit wrote "anxiety|stress"
 * and the tags render beside language chips reading "English" and "Hindi" in
 * the same strip. Two casings in one row of chips reads as a bug rather than a
 * style, so the case follows the neighbour it sits next to. Cheap to reverse —
 * one edit here, and the fold below means stored values keep matching.
 *
 * Frozen so a caller cannot sort or splice the shared array in place; the
 * toggle below returns a new one every time.
 */
export const OFFERED_EXPERTISE = Object.freeze({
  listener: Object.freeze([
    'Anxiety',
    'Stress',
    'Relationships',
    'Breakup',
    'Loneliness',
    'Family',
    'Career',
    'Self-esteem',
    'Sleep',
    'Grief',
  ]),
  astrologer: Object.freeze([
    'Vedic',
    'Tarot',
    'Numerology',
    'Palmistry',
    'Vastu',
    'Love',
    'Marriage',
    'Career',
  ]),
});

/**
 * The set offered to one provider, given their category.
 *
 * Falls back to the listener list for an unrecognised category rather than
 * returning nothing, which is the same defaulting `categoryOf` does and for the
 * same reason: a row from an older server must not become unpickable.
 */
export function expertiseFor(category: string): readonly string[] {
  return category === 'astrologer'
    ? OFFERED_EXPERTISE.astrologer
    : OFFERED_EXPERTISE.listener;
}

/**
 * The database's own ceiling, mirrored from migration 083's
 * `expertise_list_is_sane`, so the form cannot build a selection the server
 * will reject with a constraint violation the provider cannot act on.
 *
 * Eight, where languages get twelve. 083 records the reason: a language list is
 * a capability and longer is strictly more useful, while a topic list is a
 * CLAIM, and a provider expert in twelve things has said nothing.
 */
export const MAX_EXPERTISE = 8;

/**
 * How many tags an explore row shows.
 *
 * THREE, and this is a layout fact rather than a taste: the row gives the tag
 * line one non-wrapping line at the text column's width, and the row's height
 * is fixed so FlashList's `overrideItemLayout` hint stays true. Three of the
 * longest offered tags ("Relationships", "Self-esteem", "Numerology") is what
 * fits; a fourth pushes past the CTA. The full set is on the profile.
 */
export const ROW_EXPERTISE_LIMIT = 3;

/**
 * Case- and whitespace-insensitive, for the reason `languagePrefs.fold` gives:
 * the two sides of a match are written by different people. `profiles.expertise`
 * is typed through a chip row today but is writable by the admin console and by
 * `scripts/seed-dev.sql`, and 083's CHECK is a shape floor that permits any
 * value — so 'anxiety' and ' Anxiety' both exist as possibilities.
 */
function fold(topic: string): string {
  return topic.trim().toLowerCase();
}

/**
 * Toggle one topic, keeping the offered order rather than tap order.
 *
 * The same rule as `toggleLanguage` and `toggleBand`, and for the same reason: a
 * chip row that reorders itself under the finger loses the provider's place in
 * it. Anything already selected that is no longer offered is preserved in its
 * existing relative order, so retiring a topic from the form does not silently
 * drop a claim somebody made.
 *
 * At the ceiling the selection is returned unchanged rather than evicting the
 * oldest. Silently dropping a tag the provider chose, to make room for one they
 * just tapped, is a worse answer than the tap doing nothing — and the form
 * disables unselected chips at the ceiling so the dead tap is visible before it
 * happens.
 */
export function toggleExpertise(
  selected: readonly string[],
  topic: string,
  offered: readonly string[],
): string[] {
  const key = fold(topic);
  if (selected.some(t => fold(t) === key)) {
    return selected.filter(t => fold(t) !== key);
  }
  if (selected.length >= MAX_EXPERTISE) {
    return [...selected];
  }
  const next = [...selected, topic];
  const rank = new Map(offered.map((t, i) => [fold(t), i]));
  const unknown = offered.length;
  return next
    .map((t, i) => ({ t, i, r: rank.get(fold(t)) ?? unknown + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.t);
}

/** Whether a topic is in the current selection, folded both sides. */
export function isExpertiseSelected(
  selected: readonly string[],
  topic: string,
): boolean {
  const key = fold(topic);
  return selected.some(t => fold(t) === key);
}

/**
 * The tags an explore row renders for one provider.
 *
 * Deduplicated on the fold, because the column has no uniqueness constraint —
 * 083's CHECK bounds the length and the element size and nothing else — so a
 * row carrying 'Anxiety' and 'anxiety' would otherwise show the same chip
 * twice. The FIRST spelling wins, which is the provider's own most recent
 * ordering rather than a normalisation we invented.
 *
 * Empty in, empty out. A provider with no tags is a legal provider (083 does
 * not make this a promotion requirement the way 075 does for languages), so the
 * row must render without the line rather than with a blank one.
 */
export function rowExpertise(
  provider: Pick<ProviderSummary, 'expertise'>,
  limit: number = ROW_EXPERTISE_LIMIT,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const topic of provider.expertise ?? []) {
    const trimmed = topic.trim();
    if (trimmed === '') {
      continue;
    }
    const key = fold(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * The offered set for a provider row, read through `categoryOf`.
 *
 * A convenience over `expertiseFor(categoryOf(p))` that exists so the two are
 * never called with the raw column in between — `provider_category` defaults
 * for an older row and `categoryOf` is the one place that knows it.
 */
export function offeredFor(
  provider: Pick<ProviderSummary, 'provider_category'>,
): readonly string[] {
  return expertiseFor(categoryOf(provider));
}
