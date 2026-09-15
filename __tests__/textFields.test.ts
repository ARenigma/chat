/**
 * The app's text fields are ONE Material 3 text field.
 *
 * Four screens had each hand-rolled a field container and they had drifted —
 * heights of 48, 52 and 52, border widths of `hairlineWidth` and `1`, background
 * of `bg.base` on three and `bg.sunken` on the fourth, and two separate copies
 * of a local `Field` label wrapper. Amit, 2026-09-07: "use m3 native input
 * components please for these numerical and text inputs everywhere".
 *
 * These gates keep that from coming back. There is no renderer in this repo's
 * devDependencies, so nothing here mounts a component; the numeric assertions
 * run against the generated tokens, and the structural ones against source text
 * with comments stripped first.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Comments removed, string and template literals preserved.
 *
 * Duplicated from `iconScale.test.ts` rather than imported, which is this
 * repo's convention: importing another `*.test.ts` would re-register that
 * file's `describe` blocks inside this suite, because jest's `testMatch` makes
 * every file in `__tests__` a suite.
 *
 * It has to be quote-aware. A naive `//` rule eats the `//` in every `https://`,
 * and this change added roughly a dozen doc citations to the files below — so a
 * naive stripper would delete exactly the RULE 1 citations and then grade the
 * wreckage. It also means the prose in those citations cannot satisfy a gate:
 * the comment in `TextField.tsx` quotes `ContainerHeight get() = 56.0.dp`, and
 * that string must not be what makes the 56 assertion pass.
 */
function stripComments(src: string): string {
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
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
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

/** The screens whose fields must all come from the one component. */
const FIELD_SCREENS = [
  'src/screens/ProviderBankScreen.tsx',
  'src/screens/ProfileSetupScreen.tsx',
  'src/screens/ProviderApplicationScreen.tsx',
] as const;

describe('M3 text field geometry comes from the spec', () => {
  /*
   * Numbers read on 2026-09-07 from the token source androidx generates the M3
   * spec into — m3.material.io is client-rendered and returns only a title to a
   * fetch, so it is not the source:
   *
   *   OutlinedTextFieldTokens.kt  ContainerHeight get() = 56.0.dp
   *   TextFieldDefaults.kt        MinHeight: Dp = 56.dp
   *   TextFieldImpl.kt            TextFieldPadding get() = 16.dp
   *   TextFieldImpl.kt            SupportingTopPadding get() = 4.dp
   *   TextFieldImpl.kt            AboveLabelBottomPadding get() = 4.dp
   */
  it('container height is M3 ContainerHeight, 56dp', () => {
    expect(TOKENS.layout.field).toBe(56);
  });

  it('horizontal padding is M3 TextFieldPadding, 16dp', () => {
    expect(TOKENS.space.md).toBe(16);
  });

  it('supporting-text and label gaps are M3 4dp', () => {
    expect(TOKENS.space['2xs']).toBe(4);
  });

  it('input font is M3 BodyLarge and supporting text is BodySmall', () => {
    // M3 bodyLarge is 16/24, bodySmall is 12/16.
    expect(TOKENS.typography.bodyLarge.fontSize).toBe(16);
    expect(TOKENS.typography.bodyLarge.lineHeight).toBe(24);
    expect(TOKENS.typography.bodySmall.fontSize).toBe(12);
    expect(TOKENS.typography.bodySmall.lineHeight).toBe(16);
  });

  it('the field height is its own token, not borrowed from the list row', () => {
    // Both are 56 today. They are separate keys so that changing a list row
    // cannot silently resize every text field, which is the failure mode the
    // layout note in design/tokens.json calls out.
    const spec = JSON.parse(read('design/tokens.json')) as {
      layout: Record<string, unknown>;
    };
    expect(spec.layout).toHaveProperty('field');
    expect(spec.layout).toHaveProperty('rowOneLine');
  });
});

describe('the M3 field is the only field', () => {
  const component = stripComments(read('src/components/TextField.tsx'));

  it('exports M3Field and still exports the unstyled primitive', () => {
    // The primitive has to survive: the composer, the emoji search and the OTP
    // field need the disableFullscreenUI guarantee WITHOUT text-field chrome.
    expect(component).toMatch(/export const M3Field\b/);
    expect(component).toMatch(/export const TextField\b/);
  });

  it('builds M3Field on the primitive, so the IME guarantee is inherited', () => {
    // If M3Field rendered a raw TextInput it would reintroduce the fullscreen
    // IME extract editor that the primitive exists to prevent.
    const m3 = component.slice(component.indexOf('export const M3Field'));
    expect(m3).toMatch(/<TextField\b/);
    /*
     * The JSX element, not the type. `forwardRef<TextInput, M3FieldProps>` puts
     * the characters `<TextInput` in this slice legitimately, so a bare
     * /<TextInput\b/ fails on correct code — the same distinction
     * `platform.test.ts` draws, and the reason its pattern requires a tag
     * terminator after the name.
     */
    expect(m3).not.toMatch(/(?<![A-Za-z0-9_])<TextInput[\s/>]/);
  });

  it('takes its height, padding and gaps from tokens rather than literals', () => {
    expect(component).toContain('TOKENS.layout.field');
    expect(component).toContain('TOKENS.space.md');
    // The one number in the box geometry is the 1/2dp stroke pair, which is
    // M3's OutlineWidth / FocusOutlineWidth and has no token.
    expect(component).toMatch(/borderWidth/);
  });

  it('widens the stroke on focus to M3 FocusOutlineWidth', () => {
    const m3 = component.slice(component.indexOf('export const M3Field'));
    // 1dp at rest, 2dp focused.
    expect(m3).toMatch(/focused\s*\?\s*2\s*:\s*1/);
  });

  it.each(FIELD_SCREENS)(
    '%s renders no hand-rolled field container',
    screen => {
      const body = stripComments(read(screen));
      /*
       * The tell of a re-rolled field: a style block that styles INPUT TEXT
       * (`typography.bodyLarge`) and also paints its own border and radius. All
       * four removed field styles had exactly that combination, and nothing else
       * does — a chip carries a label role, an avatar cell carries no typography
       * at all. Requiring the type role is what keeps this from flagging every
       * rounded bordered box on the screen, which an earlier version of this gate
       * did (32 false positives on ProfileSetupScreen alone).
       *
       * Run on the comment-stripped source, so the notes recording what was
       * removed — which quote the old `borderColor: t.color.border.strong` lines
       * verbatim — cannot trip it.
       */
      const styleBlocks = body.match(/\w+:\s*\{[^{}]*\}/g) ?? [];
      const offenders = styleBlocks.filter(
        b =>
          /typography\.bodyLarge/.test(b) &&
          /border(Width|Color)\s*:/.test(b) &&
          /borderRadius\s*:/.test(b),
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(FIELD_SCREENS)('%s gets its fields from M3Field', screen => {
    const body = stripComments(read(screen));
    expect(body).toMatch(
      /import \{[^}]*\bM3Field\b[^}]*\} from '\.\.\/components\/TextField'/,
    );
    // And no longer reaches for the unstyled primitive directly.
    expect(body).not.toMatch(/<TextField\b/);
  });
});

describe('nothing formatted can reach the auth call', () => {
  it('every network phone call normalises to bare digits first', () => {
    const auth = stripComments(read('src/api/auth.ts'));
    /*
     * `normalisePhone` strips `[^\d]` as its first act, so a separator could not
     * survive even if one leaked. This asserts the stronger property: the
     * provider calls are made with the NORMALISED value, never with the argument
     * as received.
     */
    for (const call of ['firebaseSendOtp', 'signInWithOtp', 'verifyOtp']) {
      const at = auth.indexOf(call);
      expect(at).toBeGreaterThan(-1);
    }
    // Both providers are handed `+${normalised}` and nothing else.
    expect(auth).toContain('firebaseSendOtp(`+${normalised}`)');
    expect(auth).toMatch(/phone:\s*`\+\$\{normalised\}`/);
    // And there is no path that passes the raw parameter through.
    expect(auth).not.toMatch(/signInWithOtp\(\{\s*phone:\s*phone\b/);
  });
});
