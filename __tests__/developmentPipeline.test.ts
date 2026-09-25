import { accessSync, constants, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (path: string): string =>
  readFileSync(join(ROOT, path), 'utf8');

describe('verification-before-remote pipeline', () => {
  it('keeps commit and push gates at the right cost boundary', () => {
    const preCommit = read('.husky/pre-commit');
    expect(preCommit).toContain('set -eu');
    expect(preCommit).toContain('security:staged');
    expect(preCommit).toContain('lint-staged');
    expect(preCommit).toContain('tsc --noEmit');
    expect(preCommit).not.toContain('npm run verify');

    // Review moved to pre-push when the Greptile trial ran out (2026-09-25).
    const postCommit = read('.husky/post-commit');
    expect(postCommit).not.toContain('review:greptile');

    const prePush = read('.husky/pre-push');
    expect(prePush).toContain('set -eu');
    expect(prePush).toContain('npm run verify');
    expect(prePush).toContain('security:push');
    expect(prePush).toContain('while read -r local_ref local_sha');
    expect(prePush).toContain('git rev-parse "${local_sha}^{commit}"');
    expect(prePush).toContain('bash scripts/ai-review.sh "${remote}/main"');
    expect(prePush.indexOf('npm run verify')).toBeLessThan(
      prePush.indexOf('security:push'),
    );
    expect(prePush.indexOf('security:push')).toBeLessThan(
      prePush.indexOf('scripts/ai-review.sh'),
    );
  });

  it('routes Greptile to GitHub without changing the GitLab branch upstream', () => {
    const review = read('scripts/greptile-review.sh');
    expect(review).toContain('GIT_CONFIG_VALUE_0=origin');
    expect(review).toContain(
      'review status --commit "$commit_ref"',
    );

    const config = JSON.parse(read('.greptile/config.json')) as {
      triggerOnUpdates?: boolean;
      statusCheck?: boolean;
    };
    expect(config.triggerOnUpdates).toBe(true);
    expect(config.statusCheck).toBe(true);
  });

  it('ships an executable pstack-style control helper and mapped features', () => {
    expect(() =>
      accessSync(join(ROOT, 'scripts/control-pappal.mjs'), constants.X_OK),
    ).not.toThrow();
    const skill = read('.cursor/skills/verify-pappal/SKILL.md');
    for (const heading of [
      '## Launch',
      '## Doctor',
      '## Drive',
      '## Evidence',
      '## Cleanup',
      '## Helpers',
    ]) {
      expect(skill).toContain(heading);
    }

    const index = read('.cursor/skills/verify-pappal/features/README.md');
    for (const feature of [
      'auth-onboarding.md',
      'home-discovery.md',
      'chat.md',
      'calls.md',
      'payments-settings-account.md',
    ]) {
      expect(index).toContain(feature);
      const mapped = read(`.cursor/skills/verify-pappal/features/${feature}`);
      for (const heading of [
        '## Sub-features',
        '## How to get to it (user POV)',
        '## Driving it with control-pappal',
        '## Gotchas',
      ]) {
        expect(mapped).toContain(heading);
      }
    }
  });

  it('adds changed-code SAST and high-severity dependency gates to GitLab', () => {
    const ci = read('.gitlab-ci.yml');
    const security = read('scripts/security-check.sh');
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(ci).toContain('sast-changes:');
    expect(ci).toContain('semgrep/semgrep:1.176.0');
    expect(ci).toContain('dependency-audit:');
    expect(ci).toContain('security:dependencies');
    expect(ci).toContain('npm run verify:ci');
    expect(pkg.scripts.verify).toContain('verify:source');
    expect(pkg.scripts['verify:ci']).toContain('verify:source');
    expect(pkg.scripts.verify).toContain('verify:artifact');
    expect(pkg.scripts['verify:ci']).toContain('verify:artifact');
    expect(security).toContain('semgrep scan --validate --config .semgrep.yml');
    expect(security).toContain('semgrep scan --config .semgrep.yml');
    expect(security).toContain('npm audit --omit=dev --audit-level=high');
    expect(security).not.toContain('base="HEAD~1"');
    expect(security).toContain('full_scan=true');
  });

  it('quotes device-shell URIs and validates key events', () => {
    const control = read('scripts/control-pappal.mjs');
    expect(control).toContain('function deviceShellQuote');
    expect(control).toContain('deviceShellQuote(uri)');
    expect(control).toContain('text.split(/([ %])/).filter(Boolean)');
    expect(control).toContain(
      'press accepts an uppercase Android key name or numeric keycode.',
    );
  });
});

describe('the local AI review gate (Greptile stand-in, 2026-09-25)', () => {
  const review = require('fs').readFileSync(require('path').join(__dirname, '../scripts/ai-review.sh'), 'utf8') as string;
  it('reviews the pushed range with Sonnet and fails closed on P0-P2 or a failed chunk', () => {
    expect(review).toContain('model="${AI_REVIEW_MODEL:-sonnet}"');
    expect(review).toContain("grep -Eq '^P[012] ' \"$report\"");
    expect(review).toContain("grep -q '^REVIEW-FAILED' \"$report\"");
    expect(review).toContain('set -euo pipefail');
  });
});
