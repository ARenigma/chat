module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: [
    'node_modules/',
    'android/',
    'ios/',
    'vendor/',
    // Generated from design/tokens.json; lint the generator, not its output.
    'src/theme/tokens.generated.ts',
  ],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    // `void somePromise()` is how this codebase marks a deliberately unawaited
    // promise. Forbidding it would push the code towards silently floating
    // promises instead, which is the thing actually worth catching.
    'no-void': ['error', { allowAsStatement: true }],
  },
  overrides: [
    {
      files: ['__tests__/**/*.ts', '__tests__/**/*.tsx'],
      env: { jest: true },
    },
    {
      files: ['scripts/**/*.mjs'],
      env: { node: true, es2022: true },
      parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
      // These are CLI verification tools; their console output is the product.
      rules: { 'no-console': 'off' },
    },
  ],
};
