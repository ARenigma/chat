import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GENUINE_RATING_THRESHOLD,
  SYSTEM_RATING_MAX,
  SYSTEM_RATING_MIN,
  SYSTEM_REVIEWS_MAX,
  SYSTEM_REVIEWS_MIN,
  displayRating,
  formatReviewCount,
  isSystemRating,
  systemRating,
  systemReviews,
} from '../src/lib/systemRating';
import { SYSTEM_RATINGS_ENABLED } from '../src/config';
import type { ProviderSummary } from '../src/lib/database.types';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const p = (
  id: string,
  rating_avg: number | null,
  rating_count: number,
): Pick<ProviderSummary, 'id' | 'rating_avg' | 'rating_count'> => ({
  id,
  rating_avg,
  rating_count,
});

const IDS = Array.from(
  { length: 400 },
  (_, i) => `1111${String(i).padStart(4, '0')}-1111-4111-8111-111111111111`,
);

describe('the manufactured numbers stay inside the band they were asked for', () => {
  it('scores 4.0 to 5.0, in tenths, never outside', () => {
    // Amit: "staars from 4 to 5 with decimals like 4.1, 4.3, 4.5 etc".
    for (const id of IDS) {
      const score = systemRating(id);
      expect(score).toBeGreaterThanOrEqual(SYSTEM_RATING_MIN);
      expect(score).toBeLessThanOrEqual(SYSTEM_RATING_MAX);
      // One decimal place, exactly — a 4.27 would be a number nobody chose.
      expect(Math.round(score * 10)).toBeCloseTo(score * 10, 9);
    }
  });

  it('counts 1000 to 10000, never outside', () => {
    // Amit: "min 1k and max 10k".
    for (const id of IDS) {
      const n = systemReviews(id);
      expect(n).toBeGreaterThanOrEqual(SYSTEM_REVIEWS_MIN);
      expect(n).toBeLessThanOrEqual(SYSTEM_REVIEWS_MAX);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('uses the whole band rather than clustering on one value', () => {
    // A "random" number that only ever produced 4.6 would be a constant with
    // extra steps, and every card in the directory would show the same rating.
    const scores = new Set(IDS.map(systemRating));
    expect(scores.size).toBeGreaterThanOrEqual(10);
    const counts = new Set(IDS.map(systemReviews));
    expect(counts.size).toBeGreaterThan(300);
  });

  it('does not correlate the score with the count', () => {
    /*
     * The two draws are salted apart. Without that they come from one hash and
     * are perfectly rank-correlated, so the highest-rated provider is always
     * the most-reviewed one — a pattern a person notices in a scrolling list
     * even when they cannot name it, and the tell that the numbers are
     * generated.
     *
     * Spearman on the ranks, which is what "monotone relationship" means and is
     * insensitive to the two different scales.
     */
    const rows = IDS.map(id => ({ s: systemRating(id), c: systemReviews(id) }));
    const rank = (vals: number[]): Map<number, number> => {
      const sorted = [...vals].sort((a, b) => a - b);
      return new Map(sorted.map((v, i) => [v, i]));
    };
    const sRank = rank(rows.map(r => r.s));
    const cRank = rank(rows.map(r => r.c));
    const n = rows.length;
    const mean = (n - 1) / 2;
    let num = 0;
    let ds = 0;
    let dc = 0;
    for (const r of rows) {
      const a = (sRank.get(r.s) ?? 0) - mean;
      const b = (cRank.get(r.c) ?? 0) - mean;
      num += a * b;
      ds += a * a;
      dc += b * b;
    }
    const rho = num / Math.sqrt(ds * dc);
    expect(Math.abs(rho)).toBeLessThan(0.2);
  });
});

describe('stable per provider, which is what "random" has to mean here', () => {
  it('returns the same numbers for the same id, every time', () => {
    /*
     * `Math.random()` would be the literal reading and a visible bug: the value
     * would change on re-render and again when FlashList recycles the cell, so
     * a member scrolling would watch a provider's review count move under their
     * thumb.
     */
    const id = IDS[0] as string;
    const first = displayRating(p(id, null, 0));
    for (let i = 0; i < 50; i += 1) {
      expect(displayRating(p(id, null, 0))).toEqual(first);
    }
  });

  it('and varies across ids, without pretending two can never collide', () => {
    /*
     * The first draft of this asserted two specific ids produce different
     * SCORES, and it failed — correctly. There are eleven possible scores
     * (4.0..5.0 in tenths), so any two providers collide about one time in
     * eleven, and a test that forbids that is a test that fails on a coin
     * flip. The code was right; the assertion was.
     *
     * What actually matters is that the pair varies, since the pair is what a
     * card shows, and that the review count — which has 9001 possible values —
     * is effectively unique.
     */
    const pairs = new Set(IDS.map(id => `${systemRating(id)}:${systemReviews(id)}`));
    expect(pairs.size).toBe(IDS.length);
  });

  it('is not shared with the experience seed', () => {
    /*
     * `seededExperienceYears` uses the same technique and must not use the same
     * stream: retuning one must not shuffle the other for every provider in the
     * directory at once. Asserted structurally — the row keeps its own hash.
     */
    const row = read('src/components/ProviderRow.tsx');
    expect(row).toContain('export function seededExperienceYears');
    expect(row).not.toContain("from '../lib/systemRating'\nimport { hash");
    expect(read('src/lib/systemRating.ts')).toContain('function hash(id: string, salt: number)');
  });
});

describe('genuine ratings take over, but only once there are enough', () => {
  it('shows the real numbers at or above the threshold', () => {
    const r = displayRating(p(IDS[0] as string, 4.8, GENUINE_RATING_THRESHOLD));
    expect(r).toEqual({ score: 4.8, count: GENUINE_RATING_THRESHOLD, system: false });
    expect(isSystemRating(r)).toBe(false);
  });

  it('keeps the system numbers below it, which is the point', () => {
    /*
     * The cliff this threshold exists to prevent: at a threshold of one, a
     * provider showing "4.3 ★ · 5.2k reviews" drops overnight to "5.0 ★ · 1
     * review" the first time somebody rates them. Every figure falls by three
     * orders of magnitude, which reads as a broken profile and punishes the
     * provider for earning their first review.
     */
    const one = displayRating(p(IDS[0] as string, 5, 1));
    expect(one.system).toBe(true);
    expect(one.count).toBeGreaterThanOrEqual(SYSTEM_REVIEWS_MIN);
    const nearly = displayRating(p(IDS[0] as string, 5, GENUINE_RATING_THRESHOLD - 1));
    expect(nearly.system).toBe(true);
    // ...and the switch is a straight cutover, never a blend: the real average
    // must not be contaminated by a fabricated one, because a provider is paid
    // on it.
    expect(nearly.score).toBe(systemRating(IDS[0] as string));
  });

  it('does not trust a count without an average', () => {
    // The view publishes `rating_avg` and `rating_count` independently, so a
    // non-null count with a null average is reachable. Rendering `null` stars
    // would be a crash dressed as a rating.
    const r = displayRating(p(IDS[0] as string, null, 999));
    expect(r.system).toBe(true);
    expect(Number.isFinite(r.score)).toBe(true);
  });
});

describe('the decision stays reversible and visible', () => {
  it('is one switch, in config, not an admin knob', () => {
    /*
     * Compile-time on purpose. Turning fabricated social proof on or off for a
     * live marketplace from an admin console — no build, no review, no commit
     * naming who did it — is not a control this app should have. Changing it
     * costs a release, which is the correct price.
     */
    expect(typeof SYSTEM_RATINGS_ENABLED).toBe('boolean');
    const config = read('src/config.ts');
    expect(config).toContain('export const SYSTEM_RATINGS_ENABLED');
    expect(read('admin/lib/config-registry.ts')).not.toContain('system_ratings');
  });

  it('says out loud what it is, where somebody will read it', () => {
    // A module that manufactures social proof and does not say so is the
    // failure mode. Pinned so the header cannot be tidied away.
    const src = read('src/lib/systemRating.ts');
    expect(src).toMatch(/These are not ratings\. Nobody left them\./);
    expect(src).toContain('IS 19000:2022');
    expect(src).toContain('dark-patterns');
  });

  it('routes every caller through one function', () => {
    // If a second surface computed its own, the switch above would stop being a
    // switch and become an audit.
    const row = read('src/components/ProviderRow.tsx');
    expect(row).toContain('displayRating(provider)');
    expect(row).not.toContain('systemRating(');
    expect(row).not.toContain('systemReviews(');
  });
});

describe('formatReviewCount fits the column it has', () => {
  it('compacts thousands, because the column is the avatar wide', () => {
    // "5,238 reviews" is 13 characters at roughly 5.5dp each on the Redmi,
    // against an 84dp column — it would ellipsise, the exact defect "no ratings
    // yet" had before it became "0 ratings".
    expect(formatReviewCount(5238)).toBe('5.2k');
    expect(formatReviewCount(10000)).toBe('10.0k');
    expect(formatReviewCount(1000)).toBe('1.0k');
  });

  it('leaves small real counts alone', () => {
    expect(formatReviewCount(0)).toBe('0');
    expect(formatReviewCount(1)).toBe('1');
    expect(formatReviewCount(999)).toBe('999');
  });

  it('never renders wider than the column can hold', () => {
    // The widest possible output plus " reviews", against the measured budget.
    const widest = `${formatReviewCount(SYSTEM_REVIEWS_MAX)} reviews`;
    expect(widest.length).toBeLessThanOrEqual(14);
  });
});
