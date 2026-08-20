module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/**/*.test.tsx',
  ],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/store/**/*.ts',
    'supabase/functions/_shared/**/*.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-reanimated|react-native-worklets|react-native-sse|@sentry|react-native-safe-area-context)/)',
  ],
};
