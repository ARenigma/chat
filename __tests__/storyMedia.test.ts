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
    // The CLAIMED list, never the plain one: a name the plain list returns can
    // gain a live story before remove() reaches it (Greptile P1 on bb32af4).
    expect(fn).toContain("await db.rpc('claim_story_objects_to_purge', { p_limit: PAGE })");
    expect(fn).not.toContain("rpc('story_objects_to_purge'");
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

describe('moderate.mjs reads a comment report as a comment after its story is gone', () => {
  it('labels from the durable evidence_surface, not the ids the purge nulls', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../scripts/moderate.mjs'),
      'utf8',
    ) as string;
    expect(src).toContain('const surface = r.evidence_surface ?? null;');
    expect(src).toContain("const aboutComment = surface === 'story_comment' || commentId !== null;");
    expect(src).toMatch(/const evidenceLabel =\s*aboutComment\s*\? 'reported comment'/);
    expect(src).toContain("clip(r.evidence_context ?? '(no caption)', 500)");
  });
});

/**
 * The operator's story commands, run. moderate.mjs runs its CLI on import, so
 * each function is lifted out of the source and evaluated alone, with `rest`
 * (the one door to PostgREST) replaced by a recorder: the test runs the code
 * that ships, and sees every request it would make.
 */
describe('moderate.mjs acts on stories as the owner rules say', () => {
  const source = read('scripts/moderate.mjs');

  /** A top-level declaration's text, from its first line to its closing brace. */
  function lift(start: string): string {
    const from = source.indexOf(start);
    expect({ start, found: from }).not.toEqual({ start, found: -1 });
    const to = source.indexOf('\n}\n', from);
    return source.slice(from, to + 3);
  }
  const constant = (name: string): string => {
    const from = source.indexOf(`const ${name} =`);
    return source.slice(from, source.indexOf(';\n', from) + 2);
  };

  interface Call {
    path: string;
    options?: { method?: string; body?: unknown };
  }
  function run<T>(names: string[], entry: string, answers: unknown[] = []) {
    const calls: Call[] = [];
    const rest = async (path: string, options?: Call['options']) => {
      calls.push({ path, options });
      return answers.shift() ?? [];
    };
    const code = [
      constant('EVIDENCE_LINK_SECONDS'),
      ...names.map(lift),
      `${entry};`,
    ].join('\n');
    const fn = runInNewContext(code, { rest, Date, encodeURIComponent }) as T;
    return { fn, calls };
  }

  const NOW = Date.parse('2026-09-25T10:00:00.000Z');
  const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString();

  describe('a comment report links its story only while the story is live', () => {
    type Live = (storyId: string | null, now: number) => Promise<{ path: string; seconds: number } | null>;
    const load = (answer: unknown) =>
      run<Live>(['function storyLinkSeconds(', 'async function liveStoryMedia('], 'liveStoryMedia', [answer]);

    it('asks only for an unexpired row', async () => {
      const { fn, calls } = load([{ media_path: 'p/s.jpg', expires_at: inSeconds(3600) }]);
      await fn('s-1', NOW);
      expect(calls).toHaveLength(1);
      expect(decodeURIComponent(calls[0]!.path)).toBe(
        'stories?id=eq.s-1&expires_at=gt.2026-09-25T10:00:00.000Z&select=media_path,expires_at',
      );
    });

    it('signs for ten minutes, cut to what is left of the 24 hours', async () => {
      expect(await load([{ media_path: 'p/s.jpg', expires_at: inSeconds(3600) }]).fn('s-1', NOW)).toEqual({
        path: 'p/s.jpg',
        seconds: 600,
      });
      expect(await load([{ media_path: 'p/s.mp4', expires_at: inSeconds(90) }]).fn('s-1', NOW)).toEqual({
        path: 'p/s.mp4',
        seconds: 90,
      });
    });

    it('gives nothing for a story that is gone, expired or under a second from it', async () => {
      expect(await load([]).fn('s-1', NOW)).toBeNull();
      // A row the sweep has not reached, should one slip past the filter.
      expect(await load([{ media_path: 'p/s.jpg', expires_at: inSeconds(-60) }]).fn('s-1', NOW)).toBeNull();
      expect(await load([{ media_path: 'p/s.jpg', expires_at: inSeconds(0.5) }]).fn('s-1', NOW)).toBeNull();
      const none = load([]);
      expect(await none.fn(null, NOW)).toBeNull();
      expect(none.calls).toHaveLength(0);
    });

    it('is what show signs with, at the lifetime it computed', () => {
      const show = lift('async function show(');
      expect(show).toContain(': await liveStoryMedia(storyId);');
      expect(show).toContain("const signed = await sign('stories', media.path, media.seconds);");
      expect(show).not.toMatch(/sign\('stories', [^)]*, 600\)/);
    });
  });

  describe('show reads a report whose subject deleted their account', () => {
    type Priors = (subject: string | null) => Promise<number | null>;

    it('asks for no priors and does not send eq.null', async () => {
      const { fn, calls } = run<Priors>(['async function priorsAgainst('], 'priorsAgainst');
      expect(await fn(null)).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it('counts them for a subject who is still there', async () => {
      const { fn, calls } = run<Priors>(['async function priorsAgainst('], 'priorsAgainst', [[{ id: 'a' }, { id: 'b' }]]);
      expect(await fn('u-1')).toBe(2);
      expect(calls[0]!.path).toBe('reports?subject_user_id=eq.u-1&select=id&limit=100');
    });

    it('prints n/a for the deleted account, and the provider the story belonged to', () => {
      const show = lift('async function show(');
      expect(show).toContain('const priors = await priorsAgainst(r.subject_user_id);');
      expect(show).not.toContain('subject_user_id=eq.${');
      expect(show).toContain("'n/a (deleted account)'");
      expect(show).toContain('const provider = r.evidence_story_provider_id ?? null;');
    });
  });

  /**
   * `act` itself, run: its collaborators are lifted beside it, `rest`
   * records, and the CLI's own globals (the positional id, the flags, the
   * confirmation, the console) are stand-ins.
   */
  function runAct(report: Record<string, unknown>, action: string, flags: Record<string, string> = {}) {
    const calls: Call[] = [];
    const logs: string[] = [];
    const rest = async (path: string, options?: Call['options']) => {
      calls.push({ path, options });
      return path.startsWith('reports?id=eq.') && options === undefined ? [report] : null;
    };
    const clipStart = source.indexOf('const clip = (s, n) => {');
    const code = [
      source.slice(clipStart, source.indexOf('\n};\n', clipStart) + 3),
      constant('short'),
      constant('ACTIONS'),
      lift('function evidenceText('),
      lift('async function takeDownReportedComment('),
      lift('async function takeDownReportedStory('),
      lift('async function act('),
      'act;',
    ].join('\n');
    const all: Record<string, string> = { action, ...flags };
    const act = runInNewContext(code, {
      rest,
      Date,
      Set,
      String,
      Number,
      positional: [String(report.id)],
      flag: (name: string) => all[name],
      fail: (message: string) => {
        throw new Error(message);
      },
      confirm: async () => true,
      console: { log: (...parts: unknown[]) => logs.push(parts.join(' ')) },
      process: { env: { USER: 'test' } },
    }) as () => Promise<void>;
    return { act, calls, logs };
  }

  const STORY_REPORT = {
    id: 'r-1',
    reason: 'harassment',
    subject_user_id: 'u-provider',
    story_id: 's-1',
    story_comment_id: null,
    evidence_surface: 'story',
    evidence_body: null,
    detail: 'he wrote that he will hurt me',
  };

  describe('acting on a story report takes the story down', () => {
    it.each([
      ['warned', {}],
      ['suspended', { days: '7' }],
      ['banned', {}],
      ['conversation_closed', {}],
    ] as const)('deletes it for %s, after the audit row and before the report is closed', async (action, flags) => {
      const { act, calls } = runAct(STORY_REPORT, action, flags);
      await act();
      const paths = calls.map(call => `${call.options?.method ?? 'GET'} ${call.path}`);
      const audit = paths.indexOf('POST moderation_actions');
      const takeDown = paths.indexOf('DELETE stories?id=eq.s-1');
      const close = paths.indexOf('PATCH reports?id=eq.r-1');
      expect(audit).toBeGreaterThan(-1);
      expect(takeDown).toBeGreaterThan(audit);
      expect(close).toBeGreaterThan(takeDown);
      expect(paths.filter(path => path.startsWith('DELETE'))).toHaveLength(1);
    });

    it('leaves it up for none, and never deletes a story over a comment report or a chat report', async () => {
      for (const [report, action] of [
        [STORY_REPORT, 'none'],
        [{ ...STORY_REPORT, evidence_surface: 'story_comment', story_comment_id: 'c-1', evidence_body: 'vile' }, 'banned'],
        [{ ...STORY_REPORT, evidence_surface: null, story_id: null, conversation_id: 'x' }, 'banned'],
        [{ ...STORY_REPORT, story_id: null }, 'banned'],
      ] as const) {
        const { act, calls } = runAct(report, action);
        await act();
        expect(calls.filter(call => call.path.startsWith('stories?'))).toEqual([]);
      }
    });
  });

  describe('the reporter\'s own words are never shown as evidence', () => {
    type Evidence = (r: Record<string, unknown>, n: number) => string;
    const clipStart = source.indexOf('const clip = (s, n) => {');
    const evidenceText = runInNewContext(
      [
        source.slice(clipStart, source.indexOf('\n};\n', clipStart) + 3),
        lift('function evidenceText('),
        'evidenceText;',
      ].join('\n'),
    ) as Evidence;

    it('names what was reported when there is no snapshot, and quotes the snapshot when there is', () => {
      const detail = 'he wrote that he will hurt me';
      expect(evidenceText({ evidence_body: null, evidence_surface: 'story', detail }, 46)).toBe('[story media]');
      expect(evidenceText({ evidence_body: null, evidence_surface: 'story_comment', detail }, 46)).toBe('[story comment]');
      expect(evidenceText({ evidence_body: null, detail }, 46)).toBe('[no snapshot]');
    });

    it('says the thing reported is media even when it has a caption, and a comment when it is one', () => {
      // A captioned photo used to read as its bare caption, a line that looks
      // like a chat message, in the queue and before the ban's y/N.
      expect(evidenceText({ evidence_body: 'good morning', evidence_surface: 'story' }, 46)).toBe(
        '[story media] caption: good morning',
      );
      expect(evidenceText({ evidence_body: 'vile', evidence_surface: 'story_comment' }, 46)).toBe('[comment] vile');
      // A chat message's words are quoted as they always were.
      expect(evidenceText({ evidence_body: 'something vile' }, 46)).toBe('something vile');
    });

    it('names a voice note as a voice note, not as a missing snapshot', () => {
      expect(
        evidenceText({ evidence_body: null, evidence_voice_path: 'c/v.m4a', detail: 'he threatened me' }, 46),
      ).toBe('[voice note]');
    });

    it('confirms a ban on a voice note or a captioned story with what they are', async () => {
      const voice = runAct(
        { ...STORY_REPORT, evidence_surface: null, story_id: null, conversation_id: 'x', evidence_voice_path: 'c/v.m4a' },
        'banned',
      );
      await voice.act();
      expect(voice.logs).toContain('evidence [voice note]');
      const captioned = runAct({ ...STORY_REPORT, evidence_body: 'good morning' }, 'banned');
      await captioned.act();
      expect(captioned.logs).toContain('evidence [story media] caption: good morning');
    });

    it('confirms a ban with the evidence and the reporter\'s words on lines of their own', async () => {
      const { act, logs } = runAct(STORY_REPORT, 'banned');
      await act();
      expect(logs).toContain('evidence [story media]');
      expect(logs).toContain('reporter said he wrote that he will hurt me');
      for (const line of logs.filter(l => l.startsWith('evidence '))) {
        expect(line).not.toContain(STORY_REPORT.detail);
      }
    });

    it('lists the queue with the same evidence, never the detail', () => {
      const list = lift('async function list(');
      expect(list).toContain('`${evidenceText(r, 46)}`');
      expect(source).not.toMatch(/evidence_body \?\? r\.detail/);
    });
  });

  describe('acting on a comment report takes the comment down', () => {
    type TakeDown = (report: Record<string, unknown>, action: string, now: number) => Promise<boolean>;
    const load = () => run<TakeDown>(['async function takeDownReportedComment('], 'takeDownReportedComment');

    it.each(['warned', 'suspended', 'banned', 'conversation_closed'])('tombstones it for %s', async action => {
      const { fn, calls } = load();
      expect(await fn({ story_comment_id: 'c-1', evidence_surface: 'story_comment' }, action, NOW)).toBe(true);
      expect(calls).toEqual([
        {
          path: 'story_comments?id=eq.c-1&deleted_at=is.null',
          options: {
            method: 'PATCH',
            body: { body: null, deleted_at: '2026-09-25T10:00:00.000Z' },
            prefer: 'return=minimal',
          },
        },
      ]);
    });

    it('touches nothing for none, for a chat report, or for a comment already purged', async () => {
      for (const [report, action] of [
        [{ story_comment_id: 'c-1' }, 'none'],
        [{ conversation_id: 'x' }, 'banned'],
        [{ story_comment_id: null, evidence_surface: 'story_comment' }, 'banned'],
      ] as const) {
        const { fn, calls } = load();
        expect(await fn(report, action, NOW)).toBe(false);
        expect(calls).toHaveLength(0);
      }
    });

    it('runs in act after the audit row and before the report is closed', () => {
      const act = lift('async function act(');
      const audit = act.indexOf("await rest('moderation_actions', {");
      const takeDown = act.indexOf('const tookDown = await takeDownReportedComment(r, action);');
      const close = act.indexOf("await rest(`reports?id=eq.${r.id}`, {");
      expect(audit).toBeGreaterThan(-1);
      expect(takeDown).toBeGreaterThan(audit);
      expect(close).toBeGreaterThan(takeDown);
    });
  });
});

describe('what a signed story link can and cannot promise', () => {
  it('says the CDN keeps a fetched link past its token until the object goes, in both places', () => {
    // The Smart CDN serves a cached response "for the same signed URL ...
    // even if the token in that URL has already expired". The 60 seconds bound
    // minting, not use; both files used to claim the second.
    for (const file of ['supabase/functions/story-media-url/index.ts', 'supabase/migrations/144_stories_bucket.sql']) {
      const text = read(file);
      expect({ file, cites: text.includes('https://supabase.com/docs/guides/storage/cdn/smart-cdn') }).toEqual({
        file,
        cites: true,
      });
      expect({ file, overclaims: /same bound voice\s+notes (accept|have)/.test(text) }).toEqual({
        file,
        overclaims: false,
      });
    }
  });

  it('so an expired story\'s object is not shielded by its row until the hourly sweep', () => {
    const purge = sqlCode('supabase/migrations/151_story_expiry_purge.sql');
    const list = purge.slice(
      purge.indexOf('create or replace function public.story_objects_to_purge('),
      purge.indexOf('comment on function public.story_objects_to_purge('),
    );
    expect(list).toMatch(/where s\.media_path = o\.name and s\.expires_at > now\(\)/);
  });
});

describe('what an evidence link can and cannot promise', () => {
  const moderate = read('scripts/moderate.mjs');
  const code = moderate
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');

  it('never promises a link expires: the CDN serves an opened one until the evidence is purged', () => {
    // Reported evidence is exactly what the purges keep (151, 094), and the
    // Smart CDN serves a fetched signed URL until its object goes.
    expect(code).not.toContain('link expires in');
    expect(moderate).toContain('https://supabase.com/docs/guides/storage/cdn/smart-cdn');
    expect(code).toContain(
      "'Once opened, the CDN keeps serving this URL until the evidence is purged: never paste it anywhere.'",
    );
    // Beside both evidence links: the voice note's and the story media's.
    expect(code.split('${EVIDENCE_LINK_CAVEAT}').length - 1).toBe(2);
  });

  it('shows the name a reported story or comment was posted under', () => {
    const start = code.indexOf('async function show(');
    const show = code.slice(start, code.indexOf('\n}\n', start));
    expect(show).toContain("console.log(`posted as     ${r.evidence_author_name ?? '(not recorded)'}`);");
  });
});

describe('child safety is routed first under both of its names', () => {
  const moderate = read('scripts/moderate.mjs');

  it('marks and orders the same set in the CLI and the queue', () => {
    // The app files 'child_safety' (026's taxonomy); 'minor_safety' alone
    // left it unmarked and behind older spam.
    expect(moderate).toContain("const ROUTED_FIRST = ['minor_safety', 'child_safety', 'self_harm'];");
    expect(moderate).toContain("const marker = ROUTED_FIRST.includes(r.reason) ? '!' : ' ';");
    expect(moderate).toContain('! = routed first (${ROUTED_FIRST.join');
    const queue = sqlCode('supabase/migrations/150_story_reports.sql');
    const view = queue.slice(queue.indexOf('create or replace view public.moderation_queue'));
    expect(view.slice(0, view.indexOf(';'))).toMatch(
      /order by\s*\(r\.reason in \('minor_safety', 'child_safety'\)\) desc,\s*\(r\.reason = 'self_harm'\) desc,\s*r\.created_at asc/,
    );
  });
});

describe('a report purge runs on its own, since it now bounds story media', () => {
  it('is scheduled nightly in 151, beside the story purges', () => {
    const code = sqlCode('supabase/migrations/151_story_expiry_purge.sql');
    expect(code).toMatch(
      /perform cron\.schedule\(\s*'purge-expired-reports',\s*'41 3 \* \* \*',\s*\$cron\$select public\.purge_expired_reports\(\)\$cron\$\s*\);/,
    );
    expect(code).toMatch(/if exists \(select 1 from cron\.job where jobname = 'purge-expired-reports'\) then\s*perform cron\.unschedule\('purge-expired-reports'\);/);
  });

  it('is run by the operator maintenance command too', () => {
    const moderate = read('scripts/moderate.mjs');
    const fn = moderate.slice(moderate.indexOf('async function maintenance()'), moderate.indexOf('const COMMANDS'));
    expect(fn).toContain("const reports = await rpc('purge_expired_reports');");
  });

  it('is watched by prod-check: media the purge should have removed a day ago', () => {
    // dispatch_story_media_purge never reads its HTTP answer, and cron records
    // the dispatch as succeeded whatever the function answered.
    const check = read('scripts/prod-check.mjs');
    expect(check).toContain("name: 'story media kept past its day with nothing to keep it',");
    expect(check).toMatch(
      /from public\.story_objects_to_purge\(1000\) p\s*join storage\.objects o on o\.bucket_id = 'stories' and o\.name = p\.object_name\s*where o\.created_at < now\(\) - interval '25 hours'/,
    );
  });
});

describe('moderate show tells a failed link from evidence that is gone', () => {
  const source = read('scripts/moderate.mjs');
  function lift(start: string): string {
    const from = source.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    return source.slice(from, source.indexOf('\n}\n', from) + 3);
  }
  type Signed = { url?: string; gone?: boolean; error?: number };
  function load(answer: { status: number; body: unknown }) {
    const fetch = jest.fn(async () => ({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    }));
    const code = [lift('async function sign('), lift('function signedText('), '({ sign, signedText });'].join('\n');
    return runInNewContext(code, { fetch, URL_BASE: 'https://x.supabase.co', KEY: 'k', JSON, String }) as {
      sign: (bucket: string, path: string, seconds: number) => Promise<Signed>;
      signedText: (signed: Signed, what: string) => string;
    };
  }

  it('says the evidence is gone only when Storage says there is no such object', async () => {
    for (const answer of [
      { status: 404, body: null },
      { status: 400, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } },
    ]) {
      const m = load(answer);
      const signed = await m.sign('stories', 'p/s.jpg', 600);
      expect(signed).toEqual({ gone: true });
      expect(m.signedText(signed, 'the media')).toBe('(the media is gone; the report outlived it)');
    }
  });

  it('says a link could not be signed, and to try again, for anything else', async () => {
    for (const status of [503, 429, 500, 401]) {
      const m = load({ status, body: { error: 'x' } });
      const signed = await m.sign('stories', 'p/s.jpg', 600);
      expect(signed).toEqual({ error: status });
      const text = m.signedText(signed, 'the media');
      expect(text).toContain(`Storage answered ${status}`);
      expect(text).not.toContain('is gone');
    }
  });

  it('prints the signed URL when it signs', async () => {
    const m = load({ status: 200, body: { signedURL: '/object/sign/stories/p/s.jpg?token=t' } });
    const signed = await m.sign('stories', 'p/s.jpg', 600);
    expect(m.signedText(signed, 'the media')).toBe('https://x.supabase.co/storage/v1/object/sign/stories/p/s.jpg?token=t');
  });
});
