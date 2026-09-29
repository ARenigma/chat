import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';
import type { UsageRow } from '../src/api/usage';

/**
 * The usage ledger's two top-level KPIs.
 *
 * Amit, 2026-09-07: "usage ledger should have two total level KPIs for sessions
 * and spends at top and then ledger rows". Four things about that are worth a
 * gate rather than a comment, because each one is invisible on a screenshot and
 * each one has an obvious wrong version:
 *
 *   1. The count is a COUNT. A sum and a count look identical in a card, and
 *      the only fixture that tells them apart is one where the tokens do not
 *      happen to equal the number of rows — so that fixture is here.
 *   2. The money word follows the ROLE. A provider is being paid; a screen that
 *      tells them what they "spent" is wrong about the direction of the money,
 *      and the bug is a single shared string away.
 *   3. One row says "1 session". Plural-by-default is the classic tell, and it
 *      needs a one-row fixture to catch.
 *   4. An empty ledger has no KPIs at all — not two cards reading zero, which
 *      is the version that arrives if the count is computed unconditionally.
 *
 * The KPI logic lives in the screen and is pure, so it is executed here rather
 * than pattern-matched. The JSX around it cannot be executed — this repo has no
 * renderer in devDependencies — so the WIRING is checked as source text, and
 * every such check runs against `withoutComments` for the reason below.
 */

/*
 * Loading the screen means loading the theme, which means loading Reanimated,
 * which needs a native runtime this test has no business standing up. The proxy
 * answers any shape the animation layer is asked for (a hook, a mutable, an
 * easing curve, a chainable entering-animation builder) and is a deliberate
 * blank: nothing below asserts anything about animation. Written as a
 * self-completing stub rather than a list of named exports so that an unrelated
 * Reanimated import arriving in the theme does not fail this file, which gates
 * arithmetic and wording.
 */
jest.mock('react-native-reanimated', () => {
  const chain: unknown = new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === '__esModule') {
        return true;
      }
      return prop === 'value' ? 0 : chain;
    },
    set: () => true,
    apply: () => chain,
  });
  return chain;
});

/** The theme reads a stored light/dark preference; there is no MMKV here. */
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

/*
 * Imported after the mocks for readability only — babel-plugin-jest-hoist lifts
 * every `jest.mock` above the requires regardless, which is what makes the
 * stubs apply to this import at all.
 */
import { usageKpis } from '../src/screens/UsageLedgerScreen';

const ROOT = join(__dirname, '..');

/**
 * Source with comments removed, and it is MANDATORY here.
 *
 * Every string this file looks for — `usage-sessions`, `numeralLarge`,
 * `accessible`, `Tokens earned`, even the literal `1 sessions` — also appears
 * in the long comments in UsageLedgerScreen.tsx that explain why it is what it
 * is. A grep of the raw file would match that prose and pass whatever the code
 * did, which is a false gate this repo has already shipped more than once.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREEN = withoutComments(readFileSync(join(ROOT, 'src/screens/UsageLedgerScreen.tsx'), 'utf8'));

/** A billed chat session, overridable field by field. */
const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  session_id: 'session-1',
  channel: 'chat',
  started_at: null,
  ended_at: null,
  elapsed_seconds: null,
  minutes: 12,
  i_am_member: true,
  tokens: 22,
  earnings_status: null,
  peer_id: 'peer-1',
  peer_name: 'Someone',
  ...over,
});

/** N member rows, each costing `tokens`, with distinct ids. */
const spent = (count: number, tokens: number): UsageRow[] =>
  Array.from({ length: count }, (_unused, i) =>
    row({ session_id: `session-${i}`, tokens }),
  );

describe('usageKpis: two figures, and what each one means', () => {
  it('returns both a session count and a token total', () => {
    const kpis = usageKpis(spent(3, 22));
    expect(kpis).not.toBeNull();
    expect(kpis?.sessions).toBe(3);
    expect(kpis?.tokens).toBe(66);
  });

  it('counts the sessions instead of summing them', () => {
    /*
     * The fixture is the whole test. Three rows at 22 tokens give 3 and 66,
     * two numbers a sum could not produce for the count; and three rows at ZERO
     * tokens still give 3, which is the case a `reduce` over `tokens` fails
     * outright rather than merely getting wrong. A ledger of free sessions is
     * not hypothetical either: `minutes_billed > 0` is what gets a row into
     * migration 069, and a provider's share is `coalesce(provider_tokens, 0)`,
     * so a row worth nothing to the caller is reachable today.
     */
    const paid = usageKpis(spent(3, 22));
    expect(paid?.sessions).toBe(3);
    expect(paid?.sessions).not.toBe(paid?.tokens);

    const free = usageKpis(spent(3, 0));
    expect(free?.sessions).toBe(3);
    expect(free?.tokens).toBe(0);

    // And it is the row count, not a distinct-peer count or a minutes total.
    const manyWithOnePeer = usageKpis(spent(7, 5));
    expect(manyWithOnePeer?.sessions).toBe(7);
  });

  it('says "1 session", never "1 sessions"', () => {
    const one = usageKpis(spent(1, 22));
    expect(one?.sessionsLabel).toBe('Session');
    expect(one?.sessionsSpoken).toBe('1 session in this ledger');
    expect(one?.sessionsSpoken).not.toContain('1 sessions');

    const two = usageKpis(spent(2, 22));
    expect(two?.sessionsLabel).toBe('Sessions');
    expect(two?.sessionsSpoken).toBe('2 sessions in this ledger');
  });

  it('tells a provider what they earned and a member what they spent', () => {
    /*
     * The role comes off `i_am_member`, which the server sets per row
     * (migration 069) — the same field the screen title already branches on.
     * The two labels must DIFFER: one shared string is the bug this asserts
     * against, and it would tell someone being paid that they spent the money.
     */
    const member = usageKpis(spent(2, 22));
    const provider = usageKpis([
      row({ i_am_member: false, tokens: 13, earnings_status: 'pending' }),
      row({ session_id: 'session-2', i_am_member: false, tokens: 13 }),
    ]);

    expect(member?.earning).toBe(false);
    expect(provider?.earning).toBe(true);

    /*
     * "Spent" / "Earned", not "Tokens spent" / "Tokens earned" (2026-09-08).
     * The figure beneath already carries ₹, so the unit word was the second
     * naming of one unit. What this test actually guards is unchanged and is
     * the line below: the two sides must not read the same.
     */
    expect(member?.tokensLabel).toBe('Spent');
    expect(provider?.tokensLabel).toBe('Earned');
    expect(provider?.tokensLabel).not.toBe(member?.tokensLabel);

    expect(member?.tokensSpoken).toContain('spent');
    expect(provider?.tokensSpoken).toContain('earned');
    expect(provider?.tokensSpoken).not.toContain('spent');

    // The count is the same question from either side, so its wording is not
    // role-dependent — and asserting that stops a future edit from splitting it.
    expect(provider?.sessionsLabel).toBe(member?.sessionsLabel);
  });

  it('has nothing to total when the ledger is empty', () => {
    /*
     * `null`, so the screen cannot render two cards reading zero above an empty
     * state. A first-time member gets one message, not one message and two
     * figures they have to read past to reach it.
     */
    expect(usageKpis([])).toBeNull();
  });

  it('groups a large figure the way the rest of the app does', () => {
    // formatTokens is en-IN grouping (1,20,000), not en-US. Same function the
    // wallet pill and the row amounts use, so the KPI cannot disagree with the
    // rows underneath it about how a number is written.
    const big = usageKpis(spent(50, 2400));
    expect(big?.sessions).toBe(50);
    expect(big?.tokens).toBe(120000);
    /*
     * No unit word beside the figure: `amount` already renders ₹1,20,000, and
     * "₹1,20,000 tokens spent" would name two units for one number. Amit,
     * 2026-09-08: "remove tokens and replace with rs everywhere".
     */
    expect(big?.tokensSpoken).toBe('₹1,20,000 spent across these sessions');
  });

  it('spells out what each number means, not just the number', () => {
    /*
     * "Describe each UI element": a description conveys purpose, not visual
     * detail. "3" and "Sessions" read as two fragments; "3 sessions in this
     * ledger" is the fact.
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     */
    const kpis = usageKpis(spent(3, 22));
    for (const spoken of [kpis?.sessionsSpoken, kpis?.tokensSpoken]) {
      expect(spoken).toBeDefined();
      // A label that is only the digits is the failure being gated.
      expect(spoken).not.toMatch(/^[\d,]+$/);
      expect((spoken ?? '').split(' ').length).toBeGreaterThan(2);
    }
    expect(kpis?.sessionsSpoken).toContain('sessions');
    /*
     * The spoken figure must say what it IS, not just how much. It used to
     * assert the word "tokens"; with the unit in the ₹ symbol, the meaning-
     * bearing word is the verb.
     */
    expect(kpis?.tokensSpoken).toMatch(/spent|earned/);
  });
});

describe('the KPIs are wired above the rows', () => {
  it('renders two of them, and both are reachable by testID', () => {
    expect(SCREEN.match(/<Kpi\b/g)).toHaveLength(2);
    expect(SCREEN).toContain('testID="usage-sessions"');
    expect(SCREEN).toContain('testID="usage-total"');
    // Fed from the pure helper, so the card cannot compute a second, different
    // answer from the one the tests above pin.
    /*
     * TWO formatters, and the split matters. A session COUNT is not money —
     * renaming every formatTokens call site to formatRupees rendered "₹5
     * sessions", which this suite caught. formatCount is the old plain-digits
     * behaviour under an honest name.
     */
    expect(SCREEN).toContain('value={formatCount(kpis.sessions)}');
    /*
     * The tokens KPI passes a NODE now, not a `formatRupees(...)` string — the
     * ₹ glyph sweep (2026-09-08) routes it through `RupeeAmount` so the rupee
     * mark renders lighter than the figure, same as every other headline
     * price. `Kpi.value` was widened to `React.ReactNode` for exactly this.
     */
    expect(SCREEN).toContain('<RupeeAmount value={kpis.tokens}');
    expect(SCREEN).not.toContain('value={formatRupees(kpis.tokens)}');
    expect(SCREEN).toContain('label={kpis.sessionsLabel}');
    expect(SCREEN).toContain('label={kpis.tokensLabel}');
  });

  it('puts them at the top, before the ledger rows', () => {
    /*
     * Amit 2026-09-29: the list is now a SectionList with month headers.
     * The KPIs live in ListHeaderComponent, which SectionList renders ABOVE all
     * sections. The source-order check becomes: ListHeaderComponent (the prop
     * that receives the KPI row) comes before renderItem (the prop that draws
     * each data row). The prop order in JSX reflects the semantic: header first,
     * then the per-row renderer.
     */
    const headerPos = SCREEN.indexOf('ListHeaderComponent');
    const renderItemPos = SCREEN.indexOf('renderItem={');
    expect(headerPos).toBeGreaterThan(-1);
    expect(renderItemPos).toBeGreaterThan(-1);
    expect(headerPos).toBeLessThan(renderItemPos);
    // The kpiRow style is inside ListHeaderComponent, confirming it IS the header.
    const kpiRowPos = SCREEN.indexOf('style={styles.kpiRow}');
    expect(kpiRowPos).toBeGreaterThan(headerPos);
    expect(kpiRowPos).toBeLessThan(renderItemPos);
    // The old flat-map pattern is gone — rows are rendered through renderItem.
    expect(SCREEN).not.toContain('rows.map(');
  });

  it('renders the KPIs or the empty state, never both', () => {
    /*
     * The branch is on the helper's `null`, which is the only thing that makes
     * "no zero cards over an empty ledger" structural rather than remembered.
     * Bounded to the component: `rows.length === 0` is legitimately the guard
     * INSIDE usageKpis, and an unbounded `not.toContain` would be asserting
     * against the very line that makes this work.
     */
    const body = SCREEN.slice(SCREEN.indexOf('export function UsageLedgerScreen'));
    expect(body).toContain('kpis === null ? (');
    expect(body).not.toContain('rows.length === 0');
    expect(body).not.toContain('rows.length > 0');
  });

  it('merges each card into one TalkBack node', () => {
    /*
     * `accessible` on the container is React Native's `mergeDescendants`: the
     * figure and its word are one meaningful unit, and unmerged TalkBack reads
     * them as two.
     * https://developer.android.com/guide/topics/ui/accessibility/principles
     */
    const kpi = SCREEN.slice(SCREEN.indexOf('function Kpi('), SCREEN.indexOf('export function UsageLedgerScreen'));
    expect(kpi).toContain('accessible');
    expect(kpi).toContain('accessibilityLabel={spoken}');
    expect(SCREEN).toContain('spoken={kpis.sessionsSpoken}');
    expect(SCREEN).toContain('spoken={kpis.tokensSpoken}');
  });

  it('uses a filled channel glyph with no circle container', () => {
    /*
     * Amit 2026-09-29: remove the 36dp bg.sunken disc; pass `active` to Icon
     * so the fill variant is selected (chat-circle-fill, phone-fill,
     * video-camera-fill). The glyph shape already names the channel — the
     * circle was redundant chrome.
     */
    const body = SCREEN.slice(SCREEN.indexOf('export function UsageLedgerScreen'));
    // `active` prop on the channel Icon.
    expect(body).toContain('<Icon');
    expect(body).toContain('active');
    // No 36dp circle container: bg.sunken must not appear in the row styles.
    const rowStyles = SCREEN.slice(SCREEN.indexOf('makeStyles'));
    expect(rowStyles).not.toContain('bg.sunken');
    expect(rowStyles).not.toContain('width: 36');
  });

  it('drops the channel label from the secondary line', () => {
    /*
     * Amit 2026-09-29: secondary is elapsed · date only. The channel label
     * ("Chat · ", "Voice call · ") is redundant — the icon already names it.
     * CHANNEL_LABEL is removed from the screen; the meta line reads
     * `${elapsedLabel(row)} · ${listStamp(...)}` with no channel word.
     */
    expect(SCREEN).not.toContain('CHANNEL_LABEL');
    // The secondary line contains the elapsed label and the date, not a
    // channel word before them.
    expect(SCREEN).toContain('elapsedLabel(row)');
    // One date form across the money screens (moneyDate, 2026-09-29).
    expect(SCREEN).toContain('moneyDate(row.started_at)');
  });

  it('groups rows into month sections', () => {
    /*
     * Amit 2026-09-29: FlashList with "SEPTEMBER 2026" headers.
     * SectionList is banned (contract.test.ts); the flat-array + getItemType
     * pattern interleaves string month-headers into the data array.
     */
    expect(SCREEN).toContain('FlashList');
    expect(SCREEN).toContain('getItemType');
    expect(SCREEN).toContain('groupByMonth');
  });

  it('sets the values in a tabular numeral, on the app spacing scale', () => {
    const styles = SCREEN.slice(SCREEN.indexOf('kpiRow: {'));

    /*
     * Tabular is the point: two KPIs that change as sessions land must not
     * shift their own digits sideways. Asserted against the token rather than
     * the string, so a future rename of the role cannot quietly drop it.
     */
    expect(TOKENS.typography.numeralLarge.fontVariant).toContain('tabular-nums');
    expect(styles).toContain('kpiValue: { ...TOKENS.typography.numeralLarge');

    // Equal halves, gapped and padded from design/tokens.json — no raw pixels.
    expect(styles).toContain('flex: 1');
    expect(styles).toContain('gap: TOKENS.space.xs');
    expect(styles).toContain('padding: TOKENS.space.lg');
    expect(styles).toContain('borderRadius: TOKENS.radius.lg');
    expect(styles.slice(0, styles.indexOf('kpiLabel'))).not.toMatch(
      /(padding|margin|gap|borderRadius)[A-Za-z]*:\s*\d/,
    );

    // The single total card it replaced is gone, not merely unused.
    expect(SCREEN).not.toContain('totalCard');
    expect(SCREEN).not.toContain('totalValue');
    expect(SCREEN).not.toContain('totalLabel');
  });
});

describe('payment state and the one money date (2026-09-29)', () => {
  const { paymentState, PENDING_WINDOW_MS } = require('../src/lib/paymentStatus');
  const { moneyDate } = require('../src/lib/datetime');
  const NOW = Date.parse('2026-09-29T12:00:00Z');
  it('calls an order pending only inside the window', () => {
    expect(paymentState('created', new Date(NOW - 60_000).toISOString(), NOW)).toBe('pending');
    expect(paymentState('created', new Date(NOW - PENDING_WINDOW_MS - 1).toISOString(), NOW)).toBe('incomplete');
    expect(paymentState('created', '2026-08-30T07:00:00Z', NOW)).toBe('incomplete');
    expect(paymentState('succeeded', '2026-08-30T07:00:00Z', NOW)).toBe('paid');
    expect(paymentState('failed', '2026-08-30T07:00:00Z', NOW)).toBe('failed');
  });
  it('writes one short date', () => {
    expect(moneyDate('2026-09-13T12:00:00Z')).toBe('13 Sep 2026');
    expect(moneyDate('not a date')).toBe('');
  });
});
