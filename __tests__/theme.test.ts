import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DARK, LIGHT, TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe('generated theme', () => {
  it('is light-first, on warm paper rather than grey', () => {
    expect(TOKENS).toBe(LIGHT);
    expect(LIGHT.color.bg.base).toBe('#FBF8F5');
    expect(DARK.color.bg.base).toBe('#14110F');
  });

  /**
   * Warmth is the whole premise of the palette, so it is asserted rather than
   * described. A "warm off-white" that someone nudges towards #F5F5F5 during a
   * merge is a different product: cool greys are what made the old build read as
   * clinical, and nothing else in this file would notice the change.
   */
  it('keeps every neutral warm — red channel above blue', () => {
    for (const [name, hex] of Object.entries({
      base: LIGHT.color.bg.base,
      raised: LIGHT.color.bg.raised,
      sunken: LIGHT.color.bg.sunken,
      hairline: LIGHT.color.border.hairline,
      textPrimary: LIGHT.color.text.primary,
      textSecondary: LIGHT.color.text.secondary,
    })) {
      const r = parseInt(hex.slice(1, 3), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // raised is pure white, which has no temperature at all; everything else
      // must lean warm.
      const warmth = name === 'raised' ? 0 : 1;
      expect(r - b).toBeGreaterThanOrEqual(warmth);
    }
  });

  it('converts percentage line-height and tracking into absolute units', () => {
    // Body/Large is 17pt at 142% with -0.5% tracking.
    expect(LIGHT.typography.bodyLarge.fontSize).toBe(17);
    expect(LIGHT.typography.bodyLarge.lineHeight).toBe(24);
    expect(LIGHT.typography.bodyLarge.letterSpacing).toBeCloseTo(-0.09, 2);
  });

  it('shares space, radius and motion across both modes', () => {
    expect(DARK.space).toEqual(LIGHT.space);
    expect(DARK.radius).toEqual(LIGHT.radius);
    expect(DARK.motion).toEqual(LIGHT.motion);
  });

  it('keeps elevation shadows translucent', () => {
    // A bound Figma colour variable silently discarded these once already.
    for (const name of ['card', 'composer', 'sheet'] as const) {
      expect(LIGHT.elevation[name].shadowOpacity).toBeGreaterThan(0);
      expect(LIGHT.elevation[name].shadowOpacity).toBeLessThan(1);
    }
  });
});

/**
 * Type is bound to a bundled face, not to a weight.
 *
 * Every style names a concrete Urbanist file and none of them sets a
 * `fontWeight`, because on Android a concrete family plus a weight makes the
 * platform synthesise a weight the family already ships — it smears the
 * letterforms, and it is invisible until someone looks at a screenshot at 3x.
 */
describe('typography is bound to real font files', () => {
  const FACES = readdirSync(join(ROOT, 'assets/fonts')).filter(f => f.endsWith('.ttf'));

  it('bundles the faces it references', () => {
    expect(FACES.length).toBeGreaterThan(0);
    for (const style of Object.values(LIGHT.typography)) {
      expect(FACES).toContain(`${style.fontFamily}.ttf`);
    }
  });

  it('ships the OFL licence alongside them', () => {
    // Bundling an OFL font without its licence is the one part of using a free
    // typeface that is not optional.
    expect(readdirSync(join(ROOT, 'assets/fonts'))).toContain('OFL.txt');
  });

  it('never sets a fontWeight anywhere in the app', () => {
    const sources = ['src/components', 'src/screens']
      .flatMap(dir => readdirSync(join(ROOT, dir)).map(f => read(`${dir}/${f}`)))
      .concat(read('App.tsx'));
    for (const body of sources) {
      expect(body).not.toMatch(/fontWeight/);
    }
  });

  it('mounts the fonts directory into the Android build', () => {
    // Without this the faces resolve to the system font at runtime and the app
    // simply looks slightly wrong, with nothing failing anywhere.
    expect(read('android/app/build.gradle')).toContain("assets.srcDirs += ['../../assets']");
  });

  it('gives the token balance tabular numerals', () => {
    // A proportional 1 is narrower than a 9, so a non-tabular count makes the
    // pill twitch every time the balance passes a digit like 50 -> 49.
    expect(LIGHT.typography.numeralMedium.fontVariant).toEqual(['tabular-nums']);
    expect(LIGHT.typography.numeralSmall.fontVariant).toEqual(['tabular-nums']);
  });
});

/**
 * Motion is a token, and the physics are asserted rather than trusted.
 *
 * The prose in `design/tokens.json` claims that `smooth` does not overshoot and
 * that `bounce` does. Those are checkable statements about a damping ratio, and
 * the generator computes the ratio from the triplet — so if someone lowers
 * `smooth`'s damping to make sheets livelier, this fails instead of a sheet
 * quietly starting to wobble.
 */
describe('motion tokens', () => {
  const { spring, springMeta, press, gesture, decay } = LIGHT.motion;

  it('declares exactly the four named springs', () => {
    expect(Object.keys(spring).sort()).toEqual(['bounce', 'gentle', 'smooth', 'snap']);
  });

  it('derives the damping ratio from the physics', () => {
    for (const [name, s] of Object.entries(spring)) {
      const ratio = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
      expect(springMeta[name as keyof typeof springMeta].ratio).toBeCloseTo(ratio, 3);
    }
  });

  it('keeps smooth critically damped, so sheets do not wobble', () => {
    expect(springMeta.smooth.overshoots).toBe(false);
    expect(springMeta.smooth.ratio).toBeGreaterThanOrEqual(1);
  });

  it('keeps bounce visibly springy, since it is the signature moment', () => {
    expect(springMeta.bounce.overshoots).toBe(true);
    expect(springMeta.bounce.ratio).toBeLessThan(0.7);
  });

  it('settles feedback fast enough to feel attached to the finger', () => {
    // Under ~250ms for anything that answers a touch. Past that the press and
    // the response stop reading as one event.
    expect(springMeta.snap.settleMs).toBeLessThan(250);
  });

  it('tightens the rest thresholds rather than taking the defaults', () => {
    for (const s of Object.values(spring)) {
      expect(s.restDisplacementThreshold).toBeLessThanOrEqual(0.01);
      expect(s.restSpeedThreshold).toBeLessThanOrEqual(2);
    }
  });

  it('presses smaller targets harder than larger ones', () => {
    // The eye reads absolute pixel travel, not the ratio, so a chip needs a
    // bigger scale change than a card to register at all.
    expect(press.chip).toBeLessThan(press.button);
    expect(press.button).toBeLessThan(press.card);
    expect(press.send).toBeLessThan(press.chip);
  });

  it('squashes the send non-uniformly', () => {
    // Uniform scaling reads as "it got smaller"; a shorter Y reads as weight.
    expect(press.sendSquashY).toBeLessThan(press.send);
  });

  it('dismisses a sheet on distance or velocity, not distance alone', () => {
    expect(gesture.dismissDistance).toBeGreaterThan(0);
    expect(gesture.dismissDistance).toBeLessThan(0.5);
    expect(gesture.dismissVelocity).toBeGreaterThan(0);
    expect(decay.deceleration).toBeGreaterThan(0.9);
    expect(decay.deceleration).toBeLessThan(1);
  });
});

/**
 * No component is allowed its own physics.
 *
 * Motion is the part of a design system that gets tuned by feel, and a spring
 * hidden in a component is a spring nobody will find when the answer to "make
 * this calmer" is one number. Everything goes through src/theme/motion.ts.
 */
describe('motion lives in one module', () => {
  const sources = ['src/components', 'src/screens'].flatMap(dir =>
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.tsx'))
      .map(f => ({ file: `${dir}/${f}`, body: read(`${dir}/${f}`) })),
  );

  it('never hardcodes a damping, stiffness or mass outside the theme', () => {
    for (const s of sources) {
      expect(s.body).not.toMatch(/damping:\s*\d/);
      expect(s.body).not.toMatch(/stiffness:\s*\d/);
      expect(s.body).not.toMatch(/mass:\s*\d/);
    }
  });

  it('never calls withSpring directly — springTo carries the token', () => {
    for (const s of sources) {
      expect(s.body).not.toMatch(/\bwithSpring\(/);
    }
  });

  it('never writes a raw duration in milliseconds', () => {
    for (const s of sources) {
      // `duration: 240` is a token that escaped; `duration: DURATION.base` is
      // the same number spelled so it can be changed in one place.
      expect(s.body).not.toMatch(/duration:\s*\d/);
    }
  });

  it('routes the signature moment through the shared builder', () => {
    expect(read('src/components/Turn.tsx')).toContain('bubbleLaunch');
    expect(read('src/theme/motion.ts')).toContain("SPRING.bounce");
  });

  it('uses bounce nowhere except the send and the low-balance flinch', () => {
    const users = sources
      .filter(s => s.body.includes("'bounce'"))
      .map(s => s.file)
      .sort();
    // The flinch is the moment scarcity is felt; the send is the moment a token
    // is spent. Both are the same event from two ends, which is why they share
    // the one spring that overshoots. Everything else uses snap or smooth.
    expect(users).toEqual(['src/components/TokenCounter.tsx']);
  });

  it('honours the OS reduce-motion setting on every entrance', () => {
    // Checked per factory rather than by counting occurrences: the first version
    // compared a builder count against a `reduceMotion` count and failed because
    // the doc comment above them mentions the call, which is a test measuring
    // prose. Each exported entrance is now inspected on its own.
    const motion = read('src/theme/motion.ts');
    const factories = motion
      .split(/export function /)
      .slice(1)
      .filter(block => /FadeIn\w*\.delay/.test(block));
    expect(factories.length).toBeGreaterThan(0);
    for (const block of factories) {
      expect(block).toMatch(/reduceMotion\(ReduceMotion\.System\)/);
    }
  });
});

describe('accessibility budget', () => {
  it('holds AAA for body text in both modes', () => {
    expect(contrast(LIGHT.color.text.primary, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.primary, DARK.color.bg.base)).toBeGreaterThanOrEqual(7);
  });

  /**
   * AA, not AAA, and this is a deliberate loosening with a reason.
   *
   * The old palette hit AAA on secondary text by making it nearly black, which
   * is why timestamps and previews used to compete with the names above them.
   * 6.2:1 is comfortably past AA at every size we use it, and the hierarchy it
   * buys is worth more than the last 0.8 — but it is still asserted, because this
   * exact token shipped at 3.13:1 once and broke AA outright.
   */
  it('holds AA for secondary text in both modes', () => {
    expect(contrast(LIGHT.color.text.secondary, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.secondary, DARK.color.bg.base)).toBeGreaterThanOrEqual(4.5);
  });

  it('holds AA for the accent count on its tint', () => {
    expect(contrast(LIGHT.color.text.accent, LIGHT.color.bg.accentTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.accent, DARK.color.bg.accentTint)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The single most important assertion in this file.
   *
   * `bg.accent` is the bright coral and measures 3.4:1 against white — fine for
   * a glyph, a fail for a label. `bg.accentStrong` is the step that carries
   * text. Every message the member has ever sent sits on the second one, so a
   * merge that swaps them would put the entire transcript below AA, and it would
   * look *better* to whoever made the change.
   */
  it('keeps message text legible on the accent bubble', () => {
    expect(contrast(LIGHT.color.text.onAccent, LIGHT.color.bg.accentStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.onAccent, DARK.color.bg.accentStrong)).toBeGreaterThanOrEqual(4.5);
  });

  it('records that the bright accent cannot carry text', () => {
    // Asserted as a fact, so nobody "fixes" the two-step accent by collapsing it.
    expect(contrast('#FFFFFF', LIGHT.color.bg.accent)).toBeLessThan(4.5);
  });

  it('keeps the send glyph legible on its fill', () => {
    // A UI glyph needs 3:1, not 4.5:1 — it carries no text.
    expect(contrast(LIGHT.color.text.onAccent, LIGHT.color.bg.accentStrong)).toBeGreaterThanOrEqual(3);
  });

  it('keeps primary button text legible on the ink fill', () => {
    expect(contrast(LIGHT.color.text.onInverse, LIGHT.color.bg.inverse)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.onInverse, DARK.color.bg.inverse)).toBeGreaterThanOrEqual(7);
  });

  it('keeps the calm band and the token chip readable', () => {
    expect(contrast(LIGHT.color.text.positive, LIGHT.color.bg.positive)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.positive, DARK.color.bg.positive)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT.color.text.token, LIGHT.color.bg.token)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.token, DARK.color.bg.token)).toBeGreaterThanOrEqual(4.5);
  });

  it('makes the presence dot visible as a shape, not just as a colour', () => {
    // A dot has no text to fall back on, so it needs the 3:1 non-text minimum
    // against the page. The softer sage this replaced measured 2.2:1.
    expect(contrast(LIGHT.color.state.available, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.color.state.available, DARK.color.bg.base)).toBeGreaterThanOrEqual(3);
  });

  it('keeps danger distinguishable from the accent, not just from the page', () => {
    // Destructive and brand were both reds once. If they are within a hair of
    // each other, "Block" and "Send" are the same signal.
    expect(contrast(LIGHT.color.state.danger, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT.color.state.danger, LIGHT.color.bg.accent)).toBeGreaterThanOrEqual(2);
  });
});

describe('accent budget is enforced in code, not just documented', () => {
  const componentSources = readdirSync(join(ROOT, 'src/components'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: read(`src/components/${f}`) }));
  const screenSources = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: read(`src/screens/${f}`) }));

  it('uses the coral in only the permitted places', () => {
    const users = componentSources
      .concat(screenSources)
      .filter(s => /color\.(bg|border|text)\.accent/.test(s.body))
      .map(s => s.file)
      .sort();
    // Actions and states only, which is the rule that separates friendly from
    // flirty:
    //   Avatar        — the warm wash on *your* mark, never a stranger's
    //   Chip          — at most one warm starter per screen
    //   InboxScreen   — the unread count
    //   ProviderHomeScreen — the same count, for a member waiting on a reply
    //   SendButton    — the fill and the ring
    //   Toggle        — the track when on. A control in a colour that appears
    //                   nowhere else reads as a different system, which is
    //                   precisely how the stock Android teal looked
    //   TokenCounter  — the low-balance pill
    //   Turn          — the member's own bubble
    //   TypingIndicator — the three dots
    //
    // Nothing here is a page, a header, a divider or a provider's avatar. This
    // assertion exists to force the argument to be made, not to forbid it.
    expect(users).toEqual([
      'Avatar.tsx',
      'Chip.tsx',
      'InboxScreen.tsx',
      'ProviderHomeScreen.tsx',
      'SendButton.tsx',
      'Toggle.tsx',
      'TokenCounter.tsx',
      'Turn.tsx',
      'TypingIndicator.tsx',
    ]);
  });

  it('never uses the accent for a page background', () => {
    for (const s of componentSources.concat(screenSources)) {
      const page = /backgroundColor:\s*TOKENS\.color\.bg\.accent\w*,[\s\S]{0,80}(root|host:)/;
      expect(s.body).not.toMatch(page);
    }
  });

  it('has no gradients or glow anywhere', () => {
    for (const s of componentSources.concat(screenSources)) {
      expect(s.body).not.toMatch(/gradient/i);
      expect(s.body).not.toMatch(/accentGlow/);
    }
  });

  it('leaves the provider directory monochrome', () => {
    // The one screen where a member compares strangers. Tinting any of them is a
    // recommendation the product has not earned the right to make.
    expect(read('src/components/ProviderRow.tsx')).not.toMatch(/accent/);
  });
});

/**
 * Material 3 conformance, as far as it can be asserted from source.
 *
 * The parts of M3 that are *numbers* — state-layer opacities, the 48dp target,
 * the switch anatomy, a bottom sheet's 28dp corner — are checkable, so they are
 * checked. The parts that are judgement (when to use a spring, how expressive to
 * be) are not, and pretending otherwise would be theatre.
 *
 * Backward compatibility comes from the same decision that makes this testable:
 * every control is drawn by us from these tokens, so it renders identically from
 * minSdk 24 to the current platform. The only controls that would differ across
 * Android versions are platform widgets, and there are none left.
 */
describe('Material 3 conformance', () => {
  const { interaction, toggle, radius } = LIGHT;

  it('uses M3 state-layer opacities', () => {
    expect(interaction.stateHover).toBeCloseTo(0.08, 3);
    expect(interaction.stateFocus).toBeCloseTo(0.1, 3);
    expect(interaction.statePressed).toBeCloseTo(0.1, 3);
    expect(interaction.stateDragged).toBeCloseTo(0.16, 3);
  });

  it('keeps the 48dp minimum touch target', () => {
    expect(interaction.minTarget).toBe(48);
  });

  it('matches the M3 switch anatomy to the dp', () => {
    expect(toggle.trackWidth).toBe(52);
    expect(toggle.trackHeight).toBe(32);
    expect(toggle.thumbOff).toBe(16);
    expect(toggle.thumbOn).toBe(24);
    expect(toggle.thumbPressed).toBe(28);
    // The growth is the whole point: off < on < held.
    expect(toggle.thumbOff).toBeLessThan(toggle.thumbOn);
    expect(toggle.thumbOn).toBeLessThan(toggle.thumbPressed);
  });

  it('uses the M3 bottom-sheet corner', () => {
    expect(radius.sheet).toBe(28);
    expect(read('src/components/Sheet.tsx')).toContain('TOKENS.radius.sheet');
  });

  it('draws every control itself — no platform widgets left', () => {
    // A platform widget is the one thing that cannot be backward compatible:
    // it renders whatever that Android version's framework draws, and on API 31+
    // Material You would recolour it from the user's wallpaper. RN's Switch was
    // rendering Android's stock teal here.
    const sources = ['src/components', 'src/screens'].flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: f, body: withoutJsxComments(read(`${dir}/${f}`)) })),
    );
    // Checked at the *import*, not the tag: `<Button` matches our own Button
    // too, and an assertion that cannot tell them apart is worse than none.
    for (const s of sources) {
      const rnImport = s.body.match(/import \{([^}]*)\} from 'react-native';/)?.[1] ?? '';
      const imported = rnImport.split(',').map(n => n.trim());
      for (const widget of ['Switch', 'Button', 'Alert', 'ToastAndroid', 'ProgressBarAndroid']) {
        expect(imported).not.toContain(widget);
      }
      expect(s.body).not.toMatch(/Alert\.alert/);
    }
  });

  it('gives every pressable surface a state layer', () => {
    // Asserted on the primitive rather than per caller: everything interactive
    // goes through it, which is the reason it exists.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toContain('INTERACTION.statePressed');
    expect(pressable).toContain("overflow: 'hidden'");
  });

  it('states the minSdk this all has to work on', () => {
    // 24. Nothing here depends on a platform API, so this is a floor rather than
    // a constraint — but it should be a known floor.
    expect(read('android/build.gradle')).toMatch(/minSdkVersion\s*=\s*24/);
  });
});

/** JSX comments quote the things these assertions forbid. */
function withoutJsxComments(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
}
