import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/**
 * The icon-size scale gate.
 *
 * Amit, 2026-09-07: "no fix all icons please for standard view and token", then,
 * asked which scale to use, "follow the reference app here as i dont know standard".
 *
 * Before ADR-0030 there was no standard at all: 80 `<Icon>` call sites carried
 * 17 distinct raw sizes — 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 28,
 * 30, 34, 36, 40 — including the one-point neighbours 13/14/15 and 16/17/18/19,
 * and four empty-state marks that disagreed at 36/36/40/40. Those are not
 * design decisions, they are the residue of forty separate judgements about the
 * same handful of roles.
 *
 * The scale is `TOKENS.icon`, derived in `design/tokens.json` from the reference app
 * 12.10.1's own frame distribution through the measured 0.803 ink/frame ratio.
 * The derivation lives in that file's `$note`, next to the numbers, so it can be
 * re-checked rather than believed.
 *
 * WHAT THIS FILE ASSERTS is narrower and stronger than "no raw numbers": every
 * `<Icon>` in `src/` must take its `size` from `TOKENS.icon`, from a NAMED
 * exemption below, or from a named constant that is itself derived from a
 * measured source. A raw literal is the failure this was written for; an
 * unexplained bare identifier is the loophole that would replace it.
 *
 * The file list is SCANNED, never hardcoded — a hardcoded list is how the next
 * new icon escapes the gate, by simply not being in it.
 */

/**
 * Strip comments with a state machine rather than a regex.
 *
 * Lifted deliberately from `__tests__/iconShape.test.ts`, which carries the same
 * function and the reason for it. This repo has shipped FOUR gates that graded
 * their own explanatory prose: a naive `//` rule eats the `//` in every
 * `https://` inside a string, which in this codebase means eating exactly the
 * doc citations that RULE 1 requires, and `/^\s*\/\/.*$/gm` also eats a trailing
 * `// ...` after real code. Tracking string and template state is the only way
 * to strip comments without also deleting code.
 *
 * It is duplicated rather than imported because importing another `*.test.ts`
 * would re-register that file's `describe` blocks inside this suite — jest's
 * `testMatch` here is `__tests__/**\/*.test.ts`, so every test file is a suite,
 * and cross-importing one would double-count its assertions. No test in this
 * repo imports another; that convention is why the helper is copied.
 *
 * The point of stripping at all is that the comment you are reading — which
 * quotes raw sizes like `size={19}` and every step of the scale — must not be
 * able to satisfy or to break the gate below.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      // Newlines are kept so reported line numbers still match the real file.
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // Inside a string literal: copy through, honouring escapes, until it closes.
    if (c === '\\') {
      out += c + (d ?? '');
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * The index of the `>` that closes a JSX opening tag starting at `start`.
 *
 * Brace-depth aware, because a `>` inside an expression container is common
 * here — `color={on ? a : b}` and `size={TOKENS.icon.md}` both sit inside the
 * tag, and an arrow function in a sibling prop has a `=>` of its own.
 *
 * This is what makes the scan see MULTI-LINE tags. The first sweep of this
 * defect used `grep "<Icon[^>]*size={[0-9]"`, which is single-line by
 * construction: it found 67 of the 80 sites and reported 16 of the 17 sizes,
 * missing `size={19}` in SettingsSheet.tsx entirely because that tag wraps.
 */
function endOfOpenTag(src: string, start: number): number {
  let i = start;
  let depth = 0;
  let state: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < src.length) {
    const c = src[i];
    if (state === 'code') {
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) return i;
      i += 1;
      continue;
    }
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    i += 1;
  }
  return -1;
}

const TAG = '<Icon';
/** `[\s/>]` so `<IconButton` (were one ever added) does not also match. */
const isTagStart = (src: string, i: number): boolean =>
  src.startsWith(TAG, i) && /[\s/>]/.test(src[i + TAG.length] ?? '');

interface Site {
  file: string;
  line: number;
  /** The raw `size={...}` expression, or `''` when the prop is absent. */
  size: string;
}

export function iconSites(source: string, file: string): Site[] {
  const src = stripComments(source);
  const sites: Site[] = [];
  let i = 0;
  for (;;) {
    const at = src.indexOf(TAG, i);
    if (at === -1) break;
    if (!isTagStart(src, at)) {
      i = at + TAG.length;
      continue;
    }
    const e = endOfOpenTag(src, at);
    if (e === -1) break;
    const tag = src.slice(at, e + 1);
    const m = /\bsize\s*=\s*\{([^}]*)\}/.exec(tag);
    sites.push({
      file,
      line: src.slice(0, at).split('\n').length,
      size: m === null ? '' : (m[1] ?? '').trim(),
    });
    i = e + 1;
  }
  return sites;
}

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, acc);
    else if (entry.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const SITES: Site[] = tsxFiles(SRC)
  .sort()
  .flatMap(p =>
    iconSites(readFileSync(p, 'utf8'), relative(ROOT, p).split('\\').join('/')),
  );

/**
 * Sizes that are deliberately NOT a step on the scale, keyed by the identifier
 * the call site names, with the reason it is exempt.
 *
 * Every entry is asserted to still be REACHABLE below — the identifier must
 * actually appear as an `<Icon size={...}>` somewhere in `src/` — so an entry
 * cannot outlive the site it was written for and rot into a blanket waiver.
 * That is the same anti-rot mechanism `iconShape.test.ts` uses for its own two
 * exemption maps.
 */
const EXEMPT: Record<string, string> = {
  /*
   * SearchBar's two glyphs are matched to the REFERENCE'S ACTUAL INK for that
   * one component, which is a stronger claim than a step on a scale and
   * predates it. the reference app's magnifier inks 13.94dp inside its 24dp frame and
   * its clear cross 11-12dp, both measured at `ScaleType.CENTER` where the
   * frame never scales the mark; SEARCH_GLYPH_SIZE = 14 lands 14.16dp of
   * Phosphor ink and CLEAR_GLYPH_SIZE = 15 lands 11.52dp. The full arithmetic and the
   * File.java:line citations are in SearchBar.tsx's own docblocks.
   *
   * Snapping these to `icon.sm` (16) would be a regression, not a cleanup: it
   * would put 16dp of ink where the reference has 13.94, and the whole point of
   * the search field is that it IS the reference app's. Pinned independently by
   * __tests__/homeSurface.test.ts.
   */
  SEARCH_GLYPH_SIZE: 'SearchBar: matched to the reference glyph ink, 13.94dp',
  /*
   * The chat header's handset. Not a step, deliberately: two controls sitting
   * beside each other must present the same INK, and at 20dp the handset's
   * outline inks 20.0dp against the video camera's 19.3dp. Measured on the
   * Redmi at density 440. Same class as SEARCH_GLYPH_SIZE above — a different
   * source of truth (matched ink), not a different opinion about the scale.
   */
  CALL_GLYPH_SIZE: 'ChatScreen header: matched to the video glyph ink, 19.3dp',
  /*
   * A DIFFERENT KIND OF EXEMPTION from the two above, and the difference is the
   * point: `STAR` is not off-scale at all. It IS `TOKENS.icon.xs`, aliased in
   * RatingStars.tsx because the component's clip arithmetic needs the same
   * number three times (STARS_WIDTH, the empty row, the filled row) and a
   * five-star row whose total width drifted from its glyph size would mis-fill
   * every rating in the directory.
   *
   * Inlining `TOKENS.icon.xs` at the JSX call site would satisfy this gate and
   * break that guarantee, which would be the gate winning an argument it should
   * lose. Named here so the alias is a decision on record rather than a hole.
   */
  STAR: 'RatingStars: an alias of TOKENS.icon.xs, shared with the clip width',
  CLEAR_GLYPH_SIZE: 'SearchBar: matched to the reference clear mark, 11-12dp',
  /*
   * Sizes translated from the measured Fuse onboarding source (RULE 3), which
   * `src/lib/onboarding.ts` records as SOURCE_METRICS. The 28pt carousel glyph
   * is the stated departure CLAUDE.md names by example; the others are the
   * source's own ternaries. These are a different source of truth, not a
   * different opinion about this one.
   */
  'SOURCE_METRICS.doneIcon': 'CompletionRow: measured from the Fuse source',
  ICON_EXPANDED: 'OnboardingStep: SOURCE_METRICS.iconOpen, from Step.swift',
  GLYPH: 'WordColumn: SOURCE_METRICS.carouselGlyph, the stated 28pt departure',
  /*
   * The M3 switch's selection check is sized against the thumb BOX it renders
   * in (28), not against the icon scale: at the on-scale 24/28 it settles to
   * ~14dp, about 57% of the thumb, which is Material's own proportion. A step
   * here would decouple the check from the anatomy it belongs to.
   */
  CHECK: 'Toggle: sized against the M3 thumb box, not the icon scale',
  /*
   * The filter chip's leading check is 18dp because the Material 3 chip spec
   * says 18dp, and it is between two steps of this scale. Read from source
   * rather than from m3.material.io (client-rendered, returns a page title to a
   * fetch): `m3_chip_icon_size` in
   * material-components-android/lib/java/com/google/android/material/chip/res/values/dimens.xml,
   * agreed by `FilterChipTokens.IconSize get() = 18.0.dp` and by the
   * `m3_comp_filter_chip_with_icon_icon_size` token.
   *
   * `icon.sm` (16) shrinks a mark that already sits inside a 32dp container and
   * has to read at a glance as "this one is on"; `icon.md` (20) grows the chip,
   * because the 18dp slot is what `filterIconSlot` reserves to stop the chip
   * resizing on selection. Same class of exemption as the Fuse SOURCE_METRICS
   * above: a different source of truth, not a different opinion about this one.
   */
  FILTER_CHIP_ICON: 'FilterChip: M3 m3_chip_icon_size, 18dp, between two steps',
};

/** `TOKENS.icon.md` / `TOKENS.icon['2xl']` / `theme.icon.lg` — any of them. */
const STEPS = Object.keys(TOKENS.icon);
const isScaleRef = (expr: string): boolean =>
  STEPS.some(
    s =>
      expr === `TOKENS.icon.${s}` ||
      expr === `TOKENS.icon['${s}']` ||
      expr === `theme.icon.${s}` ||
      expr === `theme.icon['${s}']`,
  );

const isRawNumber = (expr: string): boolean => /^[0-9]+(?:\.[0-9]+)?$/.test(expr);

const where = (s: Site): string => `${s.file}:${s.line}`;

describe('the icon scale is the only source of icon sizes', () => {
  /**
   * Non-vacuity, first and loudest.
   *
   * A parser regression is the one way this whole file could pass while
   * asserting nothing: `endOfOpenTag` returning -1, or `isTagStart` rejecting
   * every tag, would make `SITES` empty and every `every()` below trivially
   * true. There were 87 `<Icon>` sites when the scale landed; the floor is set
   * well under that so ordinary edits do not trip it, but a scan that finds
   * nothing — or that silently stops seeing multi-line tags — fails here.
   */
  it('finds the icons it is supposed to be grading', () => {
    expect(SITES.length).toBeGreaterThanOrEqual(70);
    // At least some must be MULTI-LINE tags, which is what the single-line grep
    // this gate replaces could not see. `SettingsSheet.tsx` and
    // `ProviderDetailScreen.tsx` both wrap their `<Icon>` props.
    const files = new Set(SITES.map(s => s.file));
    expect(files.size).toBeGreaterThanOrEqual(20);
    expect(SITES.filter(s => isScaleRef(s.size)).length).toBeGreaterThanOrEqual(70);
  });

  it('has a scale of six steps on the 4dp grid', () => {
    expect(Object.keys(TOKENS.icon)).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);
    const vals = Object.values(TOKENS.icon);
    expect(vals).toEqual([12, 16, 20, 24, 28, 32]);
    // Every step is on the 4dp grid the space scale already uses, and the
    // sequence is strictly increasing — a scale with a flat or inverted step is
    // a typo that would otherwise only show up on a device.
    for (const v of vals) expect(v % 4).toBe(0);
    for (let i = 1; i < vals.length; i += 1) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1] as number);
    }
  });

  /**
   * The scale really is the reference app's, mapped through the measured ink ratio.
   *
   * Asserted rather than described, because the `$note` in tokens.json is the
   * kind of claim that survives someone editing the numbers underneath it. Each
   * step must land within 1.6dp of a real the reference app frame taken through 0.803 —
   * their frame scale is 16/20/24/28/36/40 and the worst case is `lg`, 28dp of
   * frame giving 22.49 of ink against a 24 step.
   */
  it('keeps every step within 1.6dp of a the reference app frame through the ink ratio', () => {
    const RATIO = 0.803;
    const FRAMES: Record<string, number> = {
      xs: 16,
      sm: 20,
      md: 24,
      lg: 28,
      xl: 36,
      '2xl': 40,
    };
    for (const [step, value] of Object.entries(TOKENS.icon)) {
      const ink = (FRAMES[step] as number) * RATIO;
      expect(Math.abs(value - ink)).toBeLessThanOrEqual(1.6);
    }
    // md is the default, and it is their 62% case (24dp frame, 289 of 466
    // drawables). If the default ever stops being the modal the reference app frame the
    // scale has stopped being the reference app's.
    expect(TOKENS.icon.md).toBe(20);
    expect(FRAMES.md).toBe(24);
    expect(Math.round((FRAMES.md as number) * RATIO)).toBe(19);
  });

  it('passes no raw numeric size to an Icon', () => {
    const raw = SITES.filter(s => isRawNumber(s.size));
    expect(
      raw.map(s => `${where(s)} size={${s.size}} -> use a TOKENS.icon step`),
    ).toEqual([]);
  });

  it('takes every icon size from the scale or from a named exemption', () => {
    const bad = SITES.filter(
      s =>
        s.size !== '' &&
        !isScaleRef(s.size) &&
        EXEMPT[s.size] === undefined &&
        // A conditional between two scale steps is still on the scale.
        !(
          s.size.includes('?') &&
          STEPS.some(k => s.size.includes(`icon.${k}`) || s.size.includes(`icon['${k}']`))
        ),
    );
    expect(
      bad.map(s => `${where(s)} size={${s.size}} -> not a scale step, and not in EXEMPT`),
    ).toEqual([]);
  });

  /**
   * No exemption may outlive its call site.
   *
   * An exemption for an identifier nobody passes any more is a waiver waiting to
   * be reused for something it was never argued for. Deleting the site must
   * force deleting the entry.
   */
  it('keeps no stale exemption', () => {
    const used = new Set(SITES.map(s => s.size));
    const stale = Object.keys(EXEMPT).filter(k => !used.has(k));
    expect(stale).toEqual([]);
  });

  /**
   * The two SearchBar values are the exemption's whole reason, so they are
   * pinned here as well as in homeSurface.test.ts. If someone "tidies" them to
   * `icon.sm` the EXEMPT entry above goes stale and this fails with the number
   * that was measured, rather than the gate quietly agreeing.
   */
  it('leaves the SearchBar glyphs matched to the reference ink', () => {
    const bar = readFileSync(join(SRC, 'components/SearchBar.tsx'), 'utf8');
    expect(bar).toContain('const SEARCH_GLYPH_SIZE = 14;');
    expect(bar).toContain('const CLEAR_GLYPH_SIZE = 15;');
  });

  /**
   * `size` is ink-dp, which is the property that makes the scale meaningful, and
   * it holds only while `ICON_SCALE` is 1.2. That constant is Amit's own call
   * ("the icons were reading too small") and it multiplies every icon in the
   * app, so this does not police its VALUE — it policies the assumption the
   * scale rests on, and names what to redo if the value ever moves.
   */
  it('still renders a step as approximately its own dp of ink', () => {
    const icon = readFileSync(join(SRC, 'components/Icon.tsx'), 'utf8');
    expect(icon).toContain('const ICON_SCALE = 1.2;');
    // A full-bleed Phosphor glyph inks ~19.97 of 24 em units: 208 of its 256
    // grid, mapped through the generator's 250-unit EM_WINDOW (median over the
    // set, fontTools BoundsPen over assets/fonts/Phosphor.ttf; the glyf header's
    // xMin/yMin are zeroed by svg2ttf and must not be trusted). That is the same
    // 19.97 the scale was first set against in Lucide, by construction — see
    // EM_WINDOW in scripts/gen-icons-font.mjs. So ink = round(size * 1.2) *
    // 19.97/24, and every step must land within 3% of its own nominal dp.
    const window = /const EM_WINDOW = \{ origin: (\d+), size: (\d+) \}/.exec(
      readFileSync(join(ROOT, 'scripts/gen-icons-font.mjs'), 'utf8'),
    );
    expect(window?.slice(1)).toEqual(['3', '250']);
    for (const value of Object.values(TOKENS.icon)) {
      const ink = (Math.round(value * 1.2) * 19.97) / 24;
      expect(Math.abs(ink / value - 1)).toBeLessThan(0.03);
    }
  });
});
