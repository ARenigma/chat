/**
 * Pre-commit tasks. A JS config rather than JSON because the TypeScript task
 * needs to filter its own input: lint-staged passes staged paths explicitly, and
 * ESLint emits "File ignored because of a matching ignore pattern" as a warning —
 * which `--max-warnings=0` then turns into a commit-blocking failure. The Deno
 * function is intentionally outside the RN ESLint config, so it has to be
 * filtered here rather than suppressed there.
 */
const ESLINT_IGNORED = ['supabase/functions/stream-chat/'];

module.exports = {
  '*.{ts,tsx}': files => {
    const lintable = files.filter(
      f => !ESLINT_IGNORED.some(p => f.includes(p)),
    );
    if (lintable.length === 0) {
      return [];
    }
    return [
      `eslint --max-warnings=0 --fix ${lintable
        .map(f => JSON.stringify(f))
        .join(' ')}`,
    ];
  },
  '*.{js,mjs,md,yml,yaml}': ['prettier --write'],
  // Lockfiles and generated exports are excluded via .prettierignore.
  '*.json': ['prettier --write'],
};
