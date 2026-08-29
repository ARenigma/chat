/**
 * Conventional commits. The scope names a layer, so a message says which part of
 * the system moved without reading the diff. Scopes are an allowlist on purpose:
 * an unfamiliar scope usually means the change is touching something it should
 * not, or that a new layer has appeared and deserves a deliberate name.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'app', // shell, navigation, boot
        'ui', // components and screens
        'api', // client data layer
        'auth', // identity: providers, sessions, the sign-in surface
        'store', // ephemeral state
        'theme', // design tokens and the generator
        'db', // migrations, RLS, RPCs
        'realtime', // presence, typing, message transport
        'provider', // the provider-side console
        'safety', // moderation, reporting, classification
        'payments', // wallet, payouts, billing
        'android', // native project, manifest, Gradle
        'admin', // admin control plane (admin/)
        'ci', // pipeline and gates
        'test', // suites and harnesses
        'adr', // architecture decision records
        'deps',
        'docs',
      ],
    ],
    // Left at config-conventional's default (rejects Title Case and ALL CAPS,
    // allows lowercase) to match the `type: description` convention already in use.
    'body-max-line-length': [1, 'always', 100],
  },
};
