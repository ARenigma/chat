/**
 * Conventional commits. The scope list mirrors the top-level directories, so a
 * commit message says which layer moved without reading the diff.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'app',
        'ui',
        'api',
        'store',
        'theme',
        'db',
        'edge',
        'android',
        'ci',
        'test',
        'deps',
        'docs',
      ],
    ],
    // Left at config-conventional's default (rejects Title Case and ALL CAPS,
    // allows lowercase) to match the `type: description` convention already in use.
    'body-max-line-length': [1, 'always', 100],
  },
};
