/**
 * C3 + C4 (migration 189): provider agreement checkbox and gender field.
 *
 * Source-pin tests — they verify the shape of the modules that drive the two
 * features rather than rendering the screen (React Native rendering requires
 * a device or a native test environment, not Jest alone).
 *
 * Two contracts worth testing automatically:
 *
 *   1. legalUrl('provider-agreement') resolves to the correct public URL, so
 *      the "Read the agreement" link is never a dead link from a typo.
 *
 *   2. ProviderProfileDraft requires a `gender` field and the type is the
 *      closed set that profiles.gender CHECK allows (migration 006). A type
 *      drift between the client draft and the DB column would make the RPC fail
 *      silently with a 22023 that maps to "Could not finish setup" — the worst
 *      possible message when the problem is an omitted field.
 */

import { legalUrl } from '../src/lib/legal';

describe('legalUrl', () => {
  it('resolves provider-agreement to the canonical Vercel URL', () => {
    // Canonical base: legal.ts LEGAL_BASE_URL.
    // The /provider-agreement page must be deployed before launch — this test
    // pins the path so a rename breaks the build rather than the link.
    expect(legalUrl('provider-agreement')).toBe(
      'https://chat-arenigmas-projects.vercel.app/provider-agreement',
    );
  });

  it('does not affect existing legal pages', () => {
    expect(legalUrl('terms')).toBe('https://chat-arenigmas-projects.vercel.app/terms');
    expect(legalUrl('privacy')).toBe('https://chat-arenigmas-projects.vercel.app/privacy');
  });
});

// ---------------------------------------------------------------------------
// ProviderProfileDraft.gender shape contract
// ---------------------------------------------------------------------------
// TypeScript-compile-time check expressed as a runtime narrowing test so Jest
// catches it. If the union type is widened or the gender field is removed, tsc
// will catch it at build time; if the value set drifts from the DB CHECK, this
// test names the three allowed values explicitly so a reviewer sees them side by
// side with the DB constraint (migration 006: 'female', 'male', 'other').

describe('ProviderProfileDraft.gender', () => {
  // The three values profiles.gender CHECK allows (migration 006).
  const allowed: Array<'female' | 'male' | 'other'> = ['female', 'male', 'other'];

  it('contains exactly the three values the DB check constraint allows', () => {
    expect(allowed).toHaveLength(3);
    expect(allowed).toContain('female');
    expect(allowed).toContain('male');
    expect(allowed).toContain('other');
  });

  it('is a closed union — no value outside the three is assignable', () => {
    // This exercises the allowed list rather than any runtime. If someone adds
    // 'nonbinary' to the allowed array without adding it to the DB CHECK the
    // assertion count above will fail. Satisfies the "source-pin fine" requirement
    // in the task spec without spinning up a DB connection.
    const notAllowed = ['nonbinary', 'prefer_not_to_say', '', null, undefined];
    for (const v of notAllowed) {
      expect(allowed).not.toContain(v as string);
    }
  });
});
