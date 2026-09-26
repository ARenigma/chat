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
  /**
   * Exclude generated and CHECKED-OUT-ELSEWHERE directories from haste-map and
   * module resolution.
   *
   * `.claude/worktrees/` is the second entry and it is not cosmetic. Agent
   * worktrees are real checkouts nested INSIDE the repo root, so every one of
   * them carries its own `__mocks__/env.js` and
   * `__mocks__/react-native-get-random-values.js`. haste-map sees N copies of
   * the same manual mock and prints a `duplicate manual mock found` warning per
   * pair — twelve lines of it with three worktrees present, which is enough to
   * bury the one line of real output a developer is looking for. Worse, "which
   * copy wins" is resolution order rather than a decision, so a stale worktree
   * could in principle answer for the live mock.
   *
   * Ignoring the path fixes both: the warnings go, and only the root's mocks
   * are ever resolvable. Nothing under `.claude/` was ever meant to be on the
   * module graph.
   * https://jestjs.io/docs/configuration#modulepathignorepatterns-arraystring
   */
  modulePathIgnorePatterns: [
    '<rootDir>/admin/.next/',
    '<rootDir>/.claude/worktrees/',
  ],
  testPathIgnorePatterns: ['<rootDir>/admin/'],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/store/**/*.ts',
    // Generated data, not logic. Its correctness is the generator's `--check`.
    '!src/lib/emoji.generated.ts',
  ],
  /**
   * Lock the measured baseline instead of publishing a vanity percentage.
   * 2026-09-20 baseline: statements 61.51, branches 58.56, functions 55.96,
   * lines 61.63. Thresholds leave a small rounding margin while making a real
   * regression fail both local `--coverage` runs and CI.
   */
  coverageThreshold: {
    global: {
      statements: 61,
      branches: 58,
      functions: 55,
      lines: 61,
    },
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|react-native-reanimated|react-native-worklets|@sentry|react-native-safe-area-context|@react-navigation|react-native-screens)/)',
  ],
};
