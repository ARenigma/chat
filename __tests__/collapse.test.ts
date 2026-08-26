import { readFileSync } from 'fs';
import { join } from 'path';
import {
  COLLAPSE_TRAVEL,
  COLLAPSE_WINDOW,
  collapseFrame,
  ramp,
} from '../src/lib/collapse';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * The collapsing large-title bar.
 *
 * The build spec calls item 4 the riskiest in the plan, and the reason is that a
 * header which jitters, double-exposes its two titles or loses the scroll is
 * invisible to every gate this repo has. These tests cannot see jitter either.
 * What they can do is pin the shape of the curve, so that when the bar is looked
 * at on a device and adjusted, the adjustment is a token change and not a
 * rewrite.
 */
describe('the collapse travel', () => {
  it('is the title strip alone, not the whole bar', () => {
    // 52 and not 104. The search strip stays visible when the bar collapses:
    // 148 = 44 + 52 + 52 expanded, 97 = 44 + 52 + 1 collapsed.
    expect(COLLAPSE_TRAVEL).toBe(52);
    expect(148 - COLLAPSE_TRAVEL).toBe(96);
    expect(44 + 52 + 1).toBe(97);
  });

  it('derives every window from the travel or a space step', () => {
    // The point of the assertion: retuning the bar has to be one number. If a
    // window ever stops being derivable, this fails and says so.
    expect(COLLAPSE_WINDOW.titleHold).toBe(COLLAPSE_TRAVEL / 2);
    expect(COLLAPSE_WINDOW.titleGone).toBe(COLLAPSE_TRAVEL - TOKENS.space.xs);
    expect(COLLAPSE_WINDOW.inlineIn).toBe(COLLAPSE_TRAVEL / 2 + TOKENS.space['2xs']);
    expect(COLLAPSE_WINDOW.hairlineIn).toBe(TOKENS.space.xs);
  });

  it('keeps its private space constants equal to the tokens', () => {
    // collapse.ts deliberately does not import the theme, so that the one module
    // holding the bar's arithmetic has no dependencies at all. This is the seam
    // that stops those two literals drifting from the token table in silence.
    expect(COLLAPSE_WINDOW.hairlineIn).toBe(TOKENS.space.xs);
    expect(COLLAPSE_WINDOW.inlineIn - COLLAPSE_WINDOW.titleHold).toBe(
      TOKENS.space['2xs'],
    );
  });

  it('matches the four windows the build spec measured', () => {
    expect(COLLAPSE_WINDOW.titleHold).toBe(26);
    expect(COLLAPSE_WINDOW.titleGone).toBe(44);
    expect(COLLAPSE_WINDOW.inlineIn).toBe(30);
    expect(COLLAPSE_WINDOW.hairlineIn).toBe(8);
  });
});

describe('ramp', () => {
  it('holds the end values instead of extrapolating', () => {
    // An over-scroll at the top gives a negative offset, and a long list gives a
    // very large one. Neither may push an opacity outside 0 to 1.
    expect(ramp(-200, [0, 10], [0, 1])).toBe(0);
    expect(ramp(9999, [0, 10], [0, 1])).toBe(1);
  });

  it('interpolates linearly inside a segment', () => {
    expect(ramp(5, [0, 10], [0, 1])).toBeCloseTo(0.5, 6);
    expect(ramp(2.5, [0, 10], [0, 1])).toBeCloseTo(0.25, 6);
  });

  it('handles a plateau followed by a fall', () => {
    // The large title's own shape: hold, then go.
    expect(ramp(13, [0, 26, 44], [1, 1, 0])).toBe(1);
    expect(ramp(26, [0, 26, 44], [1, 1, 0])).toBe(1);
    expect(ramp(35, [0, 26, 44], [1, 1, 0])).toBeCloseTo(0.5, 6);
    expect(ramp(44, [0, 26, 44], [1, 1, 0])).toBe(0);
  });
});

describe('collapseFrame', () => {
  it('is fully expanded at rest', () => {
    expect(collapseFrame(0)).toEqual({
      titleY: 0,
      titleOpacity: 1,
      inlineOpacity: 0,
      hairlineOpacity: 0,
    });
  });

  it('is fully collapsed once the travel is spent', () => {
    const frame = collapseFrame(COLLAPSE_TRAVEL);
    expect(frame.titleY).toBe(-COLLAPSE_TRAVEL);
    expect(frame.titleOpacity).toBe(0);
    expect(frame.inlineOpacity).toBe(1);
    expect(frame.hairlineOpacity).toBe(1);
  });

  it('stays collapsed past the travel rather than continuing to move', () => {
    // Otherwise the title keeps sliding up behind the status bar for the whole
    // length of the list, which nothing shows but everything pays for.
    const far = collapseFrame(4000);
    expect(far).toEqual(collapseFrame(COLLAPSE_TRAVEL));
  });

  it('survives a rubber-band over-scroll', () => {
    // iOS-style bounce at the top hands back a negative offset. The bar must
    // read that as "fully expanded", not push the title down out of the bar.
    expect(collapseFrame(-80)).toEqual(collapseFrame(0));
  });

  it('never lets both titles be at full strength together', () => {
    // The double-exposure failure, stated as an invariant rather than as a
    // number. Anywhere in the travel, the two opacities cannot both be high.
    for (let y = 0; y <= COLLAPSE_TRAVEL; y += 0.5) {
      const { titleOpacity, inlineOpacity } = collapseFrame(y);
      expect(Math.min(titleOpacity, inlineOpacity)).toBeLessThan(0.8);
    }
  });

  it('brings the hairline in before either title has finished moving', () => {
    // The hairline answers "has this list moved at all", so it must be certain
    // while the titles are still mid-cross-fade.
    const early = collapseFrame(COLLAPSE_WINDOW.hairlineIn);
    expect(early.hairlineOpacity).toBe(1);
    expect(early.titleOpacity).toBe(1);
    expect(early.inlineOpacity).toBe(0);
  });

  it('moves the title monotonically and never past the travel', () => {
    let previous = 1;
    for (let y = 0; y <= COLLAPSE_TRAVEL * 2; y += 1) {
      const { titleY } = collapseFrame(y);
      expect(titleY).toBeLessThanOrEqual(previous);
      expect(titleY).toBeGreaterThanOrEqual(-COLLAPSE_TRAVEL);
      previous = titleY;
    }
  });

  it('fades every opacity monotonically in its own direction', () => {
    let title = 1.1;
    let inline = -0.1;
    let hairline = -0.1;
    for (let y = 0; y <= COLLAPSE_TRAVEL; y += 0.5) {
      const f = collapseFrame(y);
      expect(f.titleOpacity).toBeLessThanOrEqual(title);
      expect(f.inlineOpacity).toBeGreaterThanOrEqual(inline);
      expect(f.hairlineOpacity).toBeGreaterThanOrEqual(hairline);
      title = f.titleOpacity;
      inline = f.inlineOpacity;
      hairline = f.hairlineOpacity;
    }
  });

  it('keeps every opacity inside 0 to 1 across the whole range', () => {
    for (let y = -200; y <= 600; y += 3) {
      const f = collapseFrame(y);
      for (const o of [f.titleOpacity, f.inlineOpacity, f.hairlineOpacity]) {
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the collapse module contract', () => {
  it('does not import react-native, which is what makes it testable', () => {
    // The whole reason this file exists separately from motion.ts. If somebody
    // imports reanimated here, every test above stops running and the failure
    // looks like a jest configuration problem rather than a design decision.
    const body = read('src/lib/collapse.ts');
    expect(body).not.toMatch(/from 'react-native/);
    expect(body).not.toMatch(/from '\.\.\/theme/);
  });

  it('marks the functions the UI thread calls as worklets', () => {
    // Without this the bar throws [Worklets] Tried to synchronously call a
    // Remote Function on its first frame. No unit test above can see it: jest
    // runs these in the JS runtime where they are perfectly callable.
    const body = read('src/lib/collapse.ts');
    for (const name of ['ramp', 'collapseFrame']) {
      const start = body.indexOf(`export function ${name}`);
      expect(start).toBeGreaterThan(-1);
      expect(body.slice(start, body.indexOf('\n}', start))).toContain("'worklet';");
    }
  });

  it('is re-exported from motion.ts so components have one front door', () => {
    expect(read('src/theme/motion.ts')).toContain("from '../lib/collapse'");
  });
});
