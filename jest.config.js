module.exports = {
  preset: '@react-native/jest-preset',
  /**
   * `@env` is a virtual module that react-native-dotenv inlines from `.env`.
   * babel.config.js disables that plugin under test so this mapping resolves it
   * instead — see the comment there for why coverage made the inlining fail.
   */
  moduleNameMapper: {
    '^@env$': '<rootDir>/__mocks__/env.js',
  },
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/**/*.test.tsx',
  ],
  /** Exclude generated directories from haste-map and module resolution. */
  modulePathIgnorePatterns: ['<rootDir>/admin/.next/'],
  testPathIgnorePatterns: ['<rootDir>/admin/'],
  collectCoverageFrom: ['src/lib/**/*.ts', 'src/store/**/*.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-reanimated|react-native-worklets|@sentry|react-native-safe-area-context)/)',
  ],
};
