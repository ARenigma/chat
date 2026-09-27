const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const { withSentryConfig } = require('@sentry/react-native/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {};

// This app ships native bundles only (Android, plus the iOS scaffold), never
// React Native for Web, so the web-only Sentry packages are dead weight:
// @sentry/browser's index re-exports Session Replay and User Feedback, and
// Metro has no tree shaking, so both land in the bundle whole (~199 KiB)
// although nothing calls them. Sentry's documented opt-out ("Reduce Bundle
// Size", https://docs.sentry.io/platforms/react-native/manual-setup/metro/#reduce-bundle-size)
// stubs them at resolve time. It only affects bundling: the native
// integrations are untouched, and initSentry() uses neither.
module.exports = withSentryConfig(
  mergeConfig(getDefaultConfig(__dirname), config),
  {
    includeWebReplay: false,
    includeWebFeedback: false,
  },
);
