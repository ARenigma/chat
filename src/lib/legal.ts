/**
 * Canonical public-site base URL.
 *
 * All in-app legal links and the Play Console required URLs (privacy policy,
 * data deletion) resolve against this base so they cannot diverge.
 * A contract test in __tests__/contract.test.ts asserts SettingsSheet imports
 * this module rather than hard-coding the host.
 *
 * Android opens HTTPS pages through ACTION_VIEW; this must remain a public,
 * stable HTTPS origin:
 * https://developer.android.com/training/basics/intents/sending#ViewWebPage
 */
const LEGAL_BASE_URL = 'https://chat-arenigmas-projects.vercel.app';

// 'provider-agreement' added in 189: hosted at /provider-agreement on the same
// Vercel deployment; the page must be live before launch.
type LegalPage =
  | 'privacy'
  | 'terms'
  | 'delete'
  | 'refund'
  | 'provider-agreement'
  | 'guidelines';

export function legalUrl(page: LegalPage): string {
  return `${LEGAL_BASE_URL}/${page}`;
}
