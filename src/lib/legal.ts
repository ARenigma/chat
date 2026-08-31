/**
 * Canonical public-site base URL.
 *
 * All in-app legal links and the Play Console required URLs (privacy policy,
 * data deletion) resolve against this base so they cannot diverge.
 * A contract test in __tests__/contract.test.ts asserts SettingsSheet imports
 * this module rather than hard-coding the host.
 */
export const LEGAL_BASE_URL = 'https://bond-app.vercel.app';

type LegalPage = 'privacy' | 'terms' | 'delete' | 'refund';

export function legalUrl(page: LegalPage): string {
  return `${LEGAL_BASE_URL}/${page}.html`;
}
