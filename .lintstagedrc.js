/**
 * Pre-commit tasks.
 *
 * A JS config rather than JSON because the TypeScript task must filter its own
 * input. lint-staged passes staged paths to ESLint explicitly, and ESLint emits
 * "File ignored because of a matching ignore pattern" as a *warning* — which
 * `--max-warnings=0` then turns into a commit-blocking failure. So anything
 * ESLint is configured to ignore has to be filtered out before it is passed.
 *
 * The ignore list is read from the ESLint config rather than restated, so adding
 * a path there cannot silently break commits here.
 */
const { ignorePatterns } = require('./.eslintrc.js');

const isEslintIgnored = file =>
  ignorePatterns.some(pattern => file.includes(pattern.replace(/\/$/, '')));

module.exports = {
  '*.{ts,tsx}': files => {
    const lintable = files.filter(f => !isEslintIgnored(f));
    if (lintable.length === 0) {
      return [];
    }
    return [
      `eslint --max-warnings=0 --fix ${lintable
        .map(f => JSON.stringify(f))
        .join(' ')}`,
    ];
  },
  '*.{js,mjs,md,yml,yaml,json}': ['prettier --write'],
};
