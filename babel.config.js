/**
 * `react-native-dotenv` inlines `@env` from `.env` at transform time, which is
 * right for the app and wrong for tests.
 *
 * Under `--coverage` the plugin strips the `import ... from '@env'` declaration
 * but does not substitute the references, so `src/lib/env.ts` reached the
 * runtime with a bare `SUPABASE_URL` identifier and threw ReferenceError. The
 * failure only appeared with coverage on — which is why every local
 * `npm run verify` (no `--coverage`) passed while CI did not.
 *
 * So the plugin is skipped under test and jest's `moduleNameMapper` resolves
 * `@env` to `__mocks__/env.js` instead. Tests then have no dependency on a
 * `.env` file existing, which they should never have had.
 */
const isTest =
  process.env.NODE_ENV === 'test' || process.env.BABEL_ENV === 'test';

const dotenv = [
  'module:react-native-dotenv',
  {
    envName: 'APP_ENV',
    moduleName: '@env',
    path: '.env',
    safe: false,
    allowUndefined: true,
  },
];

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    ...(isTest ? [] : [dotenv]),
    // Must stay last: it rewrites worklet functions for Reanimated 4.
    'react-native-worklets/plugin',
  ],
};
