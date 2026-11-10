import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  // Per-agent dist dirs (NEXT_DIST_DIR=.next-foo) and the generated next-env.d.ts are not source.
  { ignores: ['.next*/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // CLI scripts print their report.
  { files: ['scripts/**'], rules: { 'no-console': 'off' } },
];

export default eslintConfig;
