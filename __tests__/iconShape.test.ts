import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/**
 * The icon-button state layer gate.
 *
 * Amit, 2026-09-07: "clicking any icon shows a square container and not
 * contained within the button." The mechanism is in `Pressable`: `styles.clip`
 * carries `overflow: 'hidden'` but no radius of its own, and `borderRadius` is
 * deliberately NOT in `BOX_KEYS`, so it stays on the inner view and the state
 * layer is clipped to whatever radius THE CALLER happened to set. An icon button
 * is usually a bare square box, so the layer painted a full square behind a
 * ~20dp glyph. Of the 42 icon-only controls in `src/`, 26 already declared a
 * radius and one uses `ripple` (no clipped layer at all); 15 were silent, and 12
 * of those 15 used `highlight="dim"`, where the layer is a FULL-OPACITY fill
 * rather than a 10% tint. That is why it read as an unrelated container rather
 * than as the button reacting — at `dim` it is a solid block, not a shadow.
 *
 * Android's own answer for an icon-only control is the borderless ripple, which
 * is circular and extends past the view, as opposed to the bounded rectangular
 * one used for rows and cells:
 *
 *   "?android:attr/selectableItemBackground for a bounded ripple, or
 *    ?android:attr/selectableItemBackgroundBorderless for a ripple that extends
 *    beyond the view."
 *   https://developer.android.com/training/material/animations
 *
 * So the requirement this file asserts is: an icon-only control must SAY what
 * shape its state layer is, either by passing `shape` or by setting a radius in
 * its own style. Silence is what produced the bug, and silence is what the next
 * new icon button would default to.
 *
 * The file list is SCANNED, never hardcoded. A hardcoded list is how the next
 * icon button escapes the gate — it would simply not be in it.
 */

/**
 * Strip comments with a state machine rather than a regex.
 *
 * This repo has shipped four gates that graded their own explanatory prose, and
 * `platform.test.ts`'s `code()` helper shows the usual shape of the mistake:
 * `/^\s*\/\/.*$/gm` also eats a trailing `// ...` after real code, and a naive
 * `//` rule eats the `//` in every `https://` URL inside a string, which in this
 * codebase means eating the doc citations that the same rules require. Tracking
 * string and template state is the only way to strip comments without also
 * deleting code — and the point of stripping at all is that a comment
 * explaining this very bug (there are now thirteen of them, each quoting
 * "borderRadius" and "shape") must not be able to satisfy the gate.
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
 * here — `onPress={() => setX(v => !v)}` has two of them before the tag ends.
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

const TAG = '<Pressable';
const isTagStart = (src: string, i: number): boolean =>
  src.startsWith(TAG, i) && /[\s/>]/.test(src[i + TAG.length] ?? '');

/** The index of the `</Pressable` that closes the tag opened before `from`. */
function matchingClose(src: string, from: number): number {
  let i = from;
  let depth = 1;
  while (i < src.length) {
    if (isTagStart(src, i)) {
      const e = endOfOpenTag(src, i);
      if (e !== -1 && src[e - 1] !== '/') depth += 1;
      i = e === -1 ? i + TAG.length : e + 1;
      continue;
    }
    if (src.startsWith('</Pressable', i)) {
      depth -= 1;
      if (depth === 0) return i;
      i += 11;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * Every top-level `name: { ... }` entry of every `StyleSheet.create({ ... })` in
 * a file, so `style={styles.foo}` can be resolved to the declaration it names.
 *
 * Resolving matters more than it looks. The first sweep of this bug listed 42
 * offenders by grepping for style NAMES with no `borderRadius`, which counted
 * `style={[styles.action, danger && styles.danger]}` as a defect: `danger` is
 * colour-only, and `action` — the base in the same array — carries
 * `borderRadius: 36`. Sixteen sites were actually silent. A gate that cannot
 * union an array would demand `shape` on 26 controls that are already correct.
 */
export function styleBodies(src: string): Map<string, string> {
  const map = new Map<string, string>();
  let idx = 0;
  for (;;) {
    const at = src.indexOf('StyleSheet.create(', idx);
    if (at === -1) break;
    const objStart = src.indexOf('{', at);
    if (objStart === -1) break;
    let depth = 0;
    let objEnd = objStart;
    while (objEnd < src.length) {
      if (src[objEnd] === '{') depth += 1;
      else if (src[objEnd] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      objEnd += 1;
    }
    depth = 0;
    for (let k = objStart; k < objEnd; k += 1) {
      const c = src[k];
      if (c === '}') {
        depth -= 1;
        continue;
      }
      if (c !== '{') continue;
      depth += 1;
      if (depth !== 2) continue;
      // At a nested object opening — back up over `key:` to name it.
      const ch = (n: number): string => src[n] ?? '';
      let m = k - 1;
      while (m > objStart && /\s/.test(ch(m))) m -= 1;
      if (ch(m) !== ':') continue;
      let e = m - 1;
      while (e > objStart && /\s/.test(ch(e))) e -= 1;
      let s = e;
      while (s > objStart && /[A-Za-z0-9_$]/.test(ch(s))) s -= 1;
      let bodyDepth = 1;
      let q = k + 1;
      while (q < objEnd && bodyDepth > 0) {
        if (src[q] === '{') bodyDepth += 1;
        else if (src[q] === '}') bodyDepth -= 1;
        q += 1;
      }
      map.set(src.slice(s + 1, e + 1), src.slice(k, q));
    }
    idx = objEnd;
  }
  return map;
}

/**
 * Any corner radius counts, not just the shorthand.
 *
 * PaymentSheet's grouped rows round only their outer corners
 * (`borderTopLeftRadius` on the first, `borderBottomLeftRadius` on the last),
 * which is a deliberate rectangular answer and a correct one — a middle row of a
 * grouped list IS square-cornered. Demanding the shorthand would have forced a
 * wrong shape onto a control that had already said what it wanted.
 */
const RADIUS = /border(?:Top|Bottom)?(?:Left|Right|Start|End)?Radius\s*:/;

interface Site {
  file: string;
  line: number;
  styles: string[];
  declaresShape: boolean;
  declaresRadius: boolean;
  /**
   * `highlight="ripple"` has no clipped state layer to be the wrong shape.
   *
   * `Pressable` hard-wires `layerOpacity = dim ? 1 : ripple ? 0 : statePressed`,
   * so under `ripple` the Reanimated layer is invisible at every point of the
   * press and the feedback is `android_ripple` with `borderless: true` — the
   * platform's own unbounded, circular ink, which is not clipped by
   * `overflow: hidden` at all. Asking such a site for a radius would be asking
   * it to describe a layer it does not draw. This is a RULE, not a per-name
   * waiver, so a new ripple button is covered without an exemption entry.
   * https://developer.android.com/training/material/animations
   */
  ripple: boolean;
}

/** Every icon-only `<Pressable>` in one file: contains an `<Icon>`, no `<Text>`. */
export function iconPressables(source: string, file: string): Site[] {
  const src = stripComments(source);
  const bodies = styleBodies(src);
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
    const openTag = src.slice(at, e + 1);
    let children = '';
    if (src[e - 1] !== '/') {
      const close = matchingClose(src, e + 1);
      children = close === -1 ? '' : src.slice(e + 1, close);
    }
    /*
     * `[\s/>]` so `<Text` does not also match `<TextField`.
     *
     * `<RupeeAmount` counts as text too, added 2026-09-08: it is a component
     * that renders a `<Text>` internally, and a SOURCE scan cannot see through
     * a component boundary to know that. Without this, TokenCounter's wallet
     * pill — Icon + RupeeAmount, no literal `<Text` in this file at all since
     * the ₹ glyph sweep — was misread as an icon-ONLY control and flagged for
     * a shape prop it does not need, because it is not icon-only.
     */
    if (
      /<Icon[\s/>]/.test(children) &&
      !/<Text[\s/>]/.test(children) &&
      !/<RupeeAmount[\s/>]/.test(children)
    ) {
      const match = /\bstyle\s*=\s*\{/.exec(openTag);
      let styleSrc = '';
      if (match !== null) {
        const st = match.index + match[0].length - 1;
        let depth = 0;
        let q = st;
        while (q < openTag.length) {
          if (openTag[q] === '{') depth += 1;
          else if (openTag[q] === '}') {
            depth -= 1;
            if (depth === 0) {
              q += 1;
              break;
            }
          }
          q += 1;
        }
        styleSrc = openTag.slice(st, q);
      }
      const names = [...styleSrc.matchAll(/styles\.([A-Za-z0-9_$]+)/g)].map(m => m[1] ?? '');
      const declaresRadius =
        RADIUS.test(styleSrc) ||
        names.some(n => {
          const body = bodies.get(n);
          return body !== undefined && RADIUS.test(body);
        });
      sites.push({
        file,
        line: src.slice(0, at).split('\n').length,
        styles: names,
        declaresShape: /\bshape\s*=/.test(openTag),
        declaresRadius,
        ripple: /\bhighlight\s*=\s*"ripple"/.test(openTag),
      });
    }
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
  .flatMap(p => iconPressables(readFileSync(p, 'utf8'), relative(ROOT, p).split('\\').join('/')));

/**
 * Icon-only controls whose state layer is deliberately NOT round, and which say
 * so with a radius rather than with `shape`. Keyed `file#styleName`.
 *
 * Empty on purpose, and that is the useful state: every genuinely rectangular
 * icon control in the app — PaymentSheet's grouped payment rows, the photo tiles
 * on ProviderHomeScreen, the terms checkbox, ChatScreen's `navButton` — already
 * declares a radius in its own style, so it satisfies the rule the ordinary way.
 * The mechanism stays because the next such control may want a genuinely square
 * layer (a full-bleed middle row of a grouped list has square corners), and
 * `shape` cannot express "square" — its whole contract is to fill in a MISSING
 * answer, never to override a given one.
 *
 * A stale entry is a failure below, so this cannot rot into a blanket waiver.
 */
const RECTANGULAR_BY_DESIGN: Record<string, string> = {};

/**
 * Known-defective sites in files owned by another agent mid-edit, 2026-09-07.
 *
 * These are NOT exemptions — they are the same square-layer bug, listed with the
 * edit that fixes them, because the files were locked while this sweep ran. Each
 * is asserted to be STILL FAILING below, so applying the fix turns this list
 * red and forces the entry out. An exemption that survives its own fix is how a
 * gate quietly stops gating.
 */
/*
 * Empty, and it should stay that way.
 *
 * It briefly held `src/screens/HomeScreen.tsx#navIcon` — the control Amit
 * actually reported — because the file was being edited by another pass at the
 * time and could not be touched. Both call sites (`home-search-close` and
 * `home-search`) now declare `shape="circle"`, so the waiver is gone with them.
 *
 * The mechanism stays for the same reason the empty `RECTANGULAR_BY_DESIGN`
 * does: a waiver that cannot be expressed is a waiver someone will express by
 * deleting the test instead. Anything added here is asserted to still NEED
 * waiving, so a stale entry fails the build and cannot outlive its own fix.
 */
const PENDING_NOT_MINE: Record<string, string> = {};

/**
 * Has this site said what shape its state layer is?
 *
 * Three ways, all legitimate: `shape` names it, its own style sets a radius, or
 * it uses `ripple` and therefore draws no clipped layer at all.
 */
const satisfied = (s: Site): boolean => s.declaresShape || s.declaresRadius || s.ripple;

const keyOf = (s: Site): string => `${s.file}#${s.styles[0] ?? ''}`;
const where = (s: Site): string =>
  `${s.file}:${s.line} style=[${s.styles.join(', ') || '(none)'}]`;

describe('icon-only Pressables declare their state-layer shape', () => {
  it('finds icon Pressables to check, so a broken scanner cannot pass vacuously', () => {
    // The scan found 42 at the time of writing. A parser regression that matched
    // nothing would otherwise make every assertion below trivially true.
    expect(SITES.length).toBeGreaterThanOrEqual(35);
    expect(new Set(SITES.map(s => s.file)).size).toBeGreaterThanOrEqual(15);
  });

  it('every icon-only Pressable passes shape= or sets a corner radius', () => {
    const offenders = SITES.filter(
      s =>
        !satisfied(s) &&
        RECTANGULAR_BY_DESIGN[keyOf(s)] === undefined &&
        PENDING_NOT_MINE[keyOf(s)] === undefined,
    ).map(where);
    // A bare square box gives the state layer the touch box's shape, which is the
    // "square container not contained within the button" defect. Pass
    // shape="circle" for an icon button, or set the radius the control actually
    // has. https://developer.android.com/training/material/animations
    expect(offenders).toEqual([]);
  });

  it('keeps no stale exemption', () => {
    const live = new Set(SITES.filter(s => !satisfied(s)).map(keyOf));
    const stale = [...Object.keys(RECTANGULAR_BY_DESIGN), ...Object.keys(PENDING_NOT_MINE)]
      .filter(k => !live.has(k))
      .map(k => `${k} — now declares a shape or radius, so delete the entry`);
    expect(stale).toEqual([]);
  });

  it('the primitive still clips the state layer to the inner view', () => {
    // The gate above is only meaningful while the layer is clipped by the
    // caller's radius. If `clip` ever gains a radius of its own, or `borderRadius`
    // is added to BOX_KEYS and moves to the unclipped root, every assertion here
    // starts measuring nothing.
    const src = stripComments(readFileSync(join(SRC, 'components/Pressable.tsx'), 'utf8'));
    expect(src).toMatch(/shape === 'circle'\s*\?\s*\{\s*borderRadius:\s*TOKENS\.radius\.pill/);
    expect(src).toMatch(/overflow:\s*'hidden'/);
    // Order matters: shapeStyle before innerStyle, so a caller's own radius wins.
    const shapeAt = src.indexOf('shapeStyle');
    const innerAt = src.indexOf('innerStyle, animated');
    expect(shapeAt).toBeGreaterThan(-1);
    expect(innerAt).toBeGreaterThan(shapeAt);
    expect(src).not.toMatch(/BOX_KEYS[\s\S]{0,400}'borderRadius'/);
    // And the `ripple` carve-out above is only sound while the Reanimated layer
    // is genuinely hidden in that mode. If this ever becomes non-zero, ripple
    // sites start drawing a clipped layer and must declare a shape like the rest.
    // `none` (2026-09-26, a caller that paints its own pressed state) shares
    // the zero, for the same reason.
    expect(src).toMatch(
      /layerOpacity\s*=\s*dim\s*\?\s*1\s*:\s*ripple\s*\|\|\s*bare\s*\?\s*0\s*:/,
    );
    expect(src).toMatch(/borderless:\s*true/);
  });

  it('strips comments without eating code or URLs', () => {
    // The failure mode this file exists to avoid, asserted directly: thirteen
    // call sites now carry a comment quoting both `borderRadius` and `shape`, and
    // every one of them cites an https:// URL.
    const sample = [
      'const a = 1; // shape="circle" borderRadius: 4',
      '/* borderRadius: 9 */',
      'const url = "https://developer.android.com/x"; // note',
      'const t = `a//b`;',
    ].join('\n');
    const out = stripComments(sample);
    expect(out).not.toMatch(/shape=/);
    expect(out).not.toMatch(/borderRadius/);
    expect(out).toContain('https://developer.android.com/x');
    expect(out).toContain('`a//b`');
    // Line count preserved, so reported line numbers stay usable.
    expect(out.split('\n')).toHaveLength(4);
  });
});
