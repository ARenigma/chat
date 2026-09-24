import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/**
 * Story media and story evidence: the parts pgTAP cannot run.
 *
 * The database half is in supabase/tests/560-564. What lives here is what
 * runs outside Postgres: the two Edge Functions that sign and remove story
 * media, the SQL that must NOT do either itself, and the operator's terminal,
 * which prints what strangers wrote. Each was a confirmed defect before it was
 * a test:
 *
 *   - a client could sign story media with any lifetime, and the URL served
 *     after expiry, deletion and a block, because the Storage API checks RLS
 *     when it signs and never when it serves (144);
 *   - the hourly purge deleted storage rows in SQL, which orphans the bytes
 *     for good (151);
 *   - a comment carrying ESC could rewrite the moderation terminal
 *     (scripts/moderate.mjs).
 */

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** SQL with `--` comments removed, so a sentence ABOUT a statement is not one. */
const sqlCode = (path: string): string =>
  read(path)
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');

/** TypeScript with line and block comments removed; enough for these files. */
const tsCode = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('moderate.mjs never lets a user-written field drive the terminal', () => {
  // The script runs its CLI on import, so the one function is lifted out of
  // the source and evaluated alone: the test runs the code that ships.
  const source = read('scripts/moderate.mjs');
  const start = source.indexOf('const clip = (s, n) => {');
  const end = source.indexOf('\n};\n', start);
  const clip = runInNewContext(`${source.slice(start, end + 3)}\nclip;`) as (
    s: unknown,
    n: number,
  ) => string;

  it('is found where the script defines it', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('turns every C0 and C1 control into a visible mark, ESC included', () => {
    const attack = 'you are vile\x1b[2K\x1b[1A\x1b[2K  thanks for the lovely photo';
    const shown = clip(attack, 2000);
    // Looking for control characters is the assertion.
    // eslint-disable-next-line no-control-regex
    expect(shown).not.toMatch(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/);
    expect(shown).toContain('�[2K');
    expect(clip('\x7f', 10)).toBe('�');
    expect(clip('\u009b31m', 10)).toBe('�31m');
  });

  it('still reads line breaks and tabs as spaces, and leaves real text alone', () => {
    expect(clip('first\r\nsecond\tthird', 100)).toBe('first second third');
    expect(clip('नमस्ते ❤️ 🏳️', 100)).toBe('नमस्ते ❤️ 🏳️');
    expect(clip(null, 10)).toBe(',');
    expect(clip('abcdef', 4)).toBe('abc…');
  });
});

describe('story media is signed in one place, for one minute', () => {
  const fn = tsCode('supabase/functions/story-media-url/index.ts');

  it('authorises on the caller\'s own RLS read of the story row', () => {
    // The user's client, built from the anon key and the caller's header, is
    // the one that reads `stories`, so story_is_visible decides (143).
    expect(fn).toContain("createClient(url, anonKey, {");
    expect(fn).toContain("headers: { Authorization: request.headers.get('Authorization') ?? '' }");
    expect(fn).toContain('await userClient.auth.getUser()');
    expect(fn).toMatch(/await userClient\s*\.from\('stories'\)\s*\.select\('media_path,media_type,expires_at'\)\s*\.eq\('id', storyId\)/);
    expect(fn).not.toMatch(/admin\s*\.from\('stories'\)/);
  });

  it('signs the row\'s own path, for at most 60 seconds and never past expiry', () => {
    expect(fn).toContain('const TTL_SECONDS = 60;');
    expect(fn).toContain('const ttl = Math.min(TTL_SECONDS, left);');
    expect(fn).toMatch(/admin\.storage\s*\.from\(BUCKET\)\s*\.createSignedUrl\(story\.media_path, ttl\)/);
    expect(fn).toContain("const BUCKET = 'stories';");
  });

  it('takes nothing from the client but the story id', () => {
    // A lifetime or a path in the body would hand back exactly what the
    // bucket's missing read policy took away.
    expect(fn).toContain('const body = (await request.json()) as { story_id?: unknown };');
    expect(fn.match(/body\.\w+/g)).toEqual(['body.story_id', 'body.story_id']);
  });

  it('is the only signer: no client read policy on the bucket, and no client signs', () => {
    const bucket = sqlCode('supabase/migrations/144_stories_bucket.sql');
    expect(bucket).not.toMatch(/for select/i);
    expect(bucket).toContain('drop policy if exists "Viewers read visible stories" on storage.objects');
    const app = walk(join(ROOT, 'src')).filter(f => /\.(ts|tsx)$/.test(f));
    for (const file of app) {
      expect({ file, signs: /storage\s*\.from\(\s*['"]stories['"]\s*\)/.test(readFileSync(file, 'utf8')) }).toEqual({
        file,
        signs: false,
      });
    }
  });
});

describe('story media is removed through the Storage API, never in SQL', () => {
  const purge = sqlCode('supabase/migrations/151_story_expiry_purge.sql');
  const fn = tsCode('supabase/functions/purge-story-media/index.ts');

  it('deletes no storage row and lifts no guard in the migration', () => {
    // "Deleting objects via a SQL query will not remove the object from the
    // bucket and will result in the object being orphaned."
    expect(purge).not.toMatch(/delete\s+from\s+storage\.objects/i);
    expect(purge).not.toContain('allow_delete_query');
    // It only reads storage.objects, to name what should go.
    expect(purge).toContain('create or replace function public.story_objects_to_purge(p_limit integer default 1000)');
  });

  it('schedules the Edge Function, and keeps the row purge hourly', () => {
    expect(purge).toContain("'purge-story-media',\n    '*/10 * * * *',\n    $cron$select public.dispatch_story_media_purge()$cron$");
    expect(purge).toContain("'purge-expired-stories',\n    '17 * * * *',\n    $cron$select public.purge_expired_stories()$cron$");
    expect(purge).toContain("where name = 'story_media_purge_url'");
  });

  it('pages through the database\'s list and removes each page with the Storage API', () => {
    expect(fn).toContain("const BUCKET = 'stories';");
    expect(fn).toContain('const PAGE = 1000;');
    expect(fn).toContain("await db.rpc('story_objects_to_purge', { p_limit: PAGE })");
    expect(fn).toContain('await db.storage.from(BUCKET).remove(names)');
    // Bounded, so a remove() that keeps failing cannot spin forever.
    expect(fn).toMatch(/const MAX_PAGES = \d+;/);
    expect(fn).toContain('while (pages < MAX_PAGES)');
  });

  it('answers only a service-role caller', () => {
    expect(fn).toContain("if (role !== 'service_role') {");
    expect(fn).toContain("return new Response('forbidden', { status: 403 });");
  });

  it('exists as a deployable function', () => {
    expect(existsSync(join(ROOT, 'supabase/functions/purge-story-media/index.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'supabase/functions/story-media-url/index.ts'))).toBe(true);
  });
});
