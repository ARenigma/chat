import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isUuid } from '../src/lib/ids';
import { DAILY_REFILL_TOKENS, MAX_MESSAGE_CHARS } from '../src/lib/tokenLedger';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The body of one `create or replace function`, so per-function claims can be
 * made. Comments are stripped: both guards carry a comment explaining *why* they
 * are not SECURITY DEFINER, and the assertion below is about the clause, not the
 * prose that warns against it.
 */
function plpgsqlBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * TypeScript with comments removed, for negative assertions.
 *
 * A `not.toContain` over source is otherwise unusable: the comment explaining
 * why a construct is wrong necessarily quotes it, so the test fails on its own
 * documentation. Handles block and line comments; not string-literal aware,
 * which is fine — no assertion here looks for `//` inside a string.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('isUuid', () => {
  it('accepts a v4 uuid', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c330')).toBe(false);
    expect(isUuid("'; drop table messages; --")).toBe(false);
    expect(isUuid('mia')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

/**
 * ADR-0001 in executable form.
 *
 * The pivot to human-to-human chat is only real if the model path is actually
 * gone rather than merely unreferenced. A dormant Edge Function that still holds
 * a provider key, or a stray import that pulls prompt text back into the bundle,
 * would put the Play listing's AI-disclosure question back on the table.
 */
describe('the AI path is gone, not dormant', () => {
  it.each([
    'supabase/functions',
    'src/api/stream.ts',
    'src/lib/personas.ts',
    'src/components/StreamingTurn.tsx',
    'scripts/openai-stub.mjs',
  ])('has removed %s', path => {
    expect(existsSync(join(ROOT, path))).toBe(false);
  });

  it('leaves no reference to a model, a prompt or an SSE stream in the app', () => {
    const sources = ['src', '__tests__']
      .flatMap(dir => walk(join(ROOT, dir)))
      .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
      // This test necessarily names the things it forbids.
      .filter(f => !f.endsWith('contract.test.ts'));

    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/openai|systemPrompt|getSystemPrompt|stream-chat/i);
      expect(text).not.toMatch(/react-native-sse/);
    }
  });

  it('carries no OpenAI dependency and no Deno tooling scripts', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).not.toContain('react-native-sse');
    expect(Object.keys(pkg.scripts)).not.toContain('check:edge');
    expect(Object.keys(pkg.scripts)).not.toContain('stub:openai');
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * The send path is now a single SQL function, so the invariants that used to be
 * spread across an Edge Function and a client are all assertable in one place.
 */
describe('conversation schema invariants', () => {
  const m003 = read('supabase/migrations/003_human_conversations.sql');
  const m004 = read('supabase/migrations/004_message_guard_and_directory.sql');

  it('keeps sending behind the RPC rather than a client insert', () => {
    expect(m003).toMatch(/revoke all on function public\.send_message/);
    expect(m003).toMatch(/grant execute on function public\.send_message\(uuid, text\) to authenticated/);
    // An INSERT policy on messages would let a client write a message without
    // paying for it, which is the whole reason send_message exists.
    expect(m003).not.toMatch(/create policy[^;]*on public\.messages for insert/i);
  });

  it('admits providers only through the service role', () => {
    expect(m003).toMatch(/revoke all on function public\.approve_provider_application/);
    expect(m003).toMatch(/grant execute on function public\.approve_provider_application[^;]*to service_role/);
    expect(m003).not.toMatch(
      /grant execute on function public\.approve_provider_application[^;]*to authenticated/,
    );
  });

  /**
   * Both guards were briefly SECURITY DEFINER, which silently disabled them:
   * `current_user` becomes the function owner, so the client-role branch is
   * never taken and every forbidden write is permitted. The bug is invisible at
   * the call site, so it is pinned here.
   */
  it('leaves both column guards as SECURITY INVOKER', () => {
    expect(plpgsqlBody(m003, 'guard_privileged_profile_columns')).not.toMatch(
      /security definer/i,
    );
    expect(plpgsqlBody(m004, 'guard_message_columns')).not.toMatch(/security definer/i);
  });

  it('narrows the discovery surface to the directory view', () => {
    expect(m004).toMatch(/drop policy if exists "Providers are discoverable" on public\.profiles/);
    expect(m004).toMatch(/security_invoker = false/);
    expect(m004).toMatch(/grant select on public\.provider_directory to authenticated/);
  });

  it('publishes what the Realtime client subscribes to', () => {
    // Without `replica identity full` an UPDATE payload carries only the primary
    // key, so read receipts would arrive with no read_at to apply.
    expect(m003).toMatch(/alter publication supabase_realtime add table public\.messages/);
    expect(m003).toMatch(/alter table public\.messages replica identity full/);
  });
});

/**
 * The Play Store compliance claims are asserted here as well as in
 * `scripts/verify-manifest.mjs`, so a regression fails `npm test` too.
 */
describe('Android manifest', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  const declared = [...manifest.matchAll(/<uses-permission\s+([^>]*)>/g)]
    .map(m => m[1] ?? '')
    .filter(attrs => !attrs.includes('tools:node="remove"'))
    .map(attrs => attrs.match(/android:name="([^"]+)"/)?.[1] ?? '');

  it('requests exactly INTERNET and VIBRATE', () => {
    expect(declared.sort()).toEqual([
      'android.permission.INTERNET',
      'android.permission.VIBRATE',
    ]);
  });

  it('declares none of the tracking or media permissions', () => {
    for (const forbidden of [
      'com.google.android.gms.permission.AD_ID',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.READ_CONTACTS',
    ]) {
      expect(declared).not.toContain(forbidden);
    }
  });

  it('disables backup so cached messages and tokens cannot be extracted', () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });
});

describe('cross-runtime constants', () => {
  it('keeps the SQL refill grant in step with DAILY_REFILL_TOKENS', () => {
    const migration = read('supabase/migrations/002_bootstrap_and_grants.sql');
    expect(migration).toContain(`token_balance + ${DAILY_REFILL_TOKENS}`);
  });

  it('revokes the wallet primitives from client roles', () => {
    const migration = read('supabase/migrations/002_bootstrap_and_grants.sql');
    expect(migration).toMatch(/revoke all on function public\.deduct_user_token/);
    expect(migration).toMatch(/revoke all on function public\.credit_user_token/);
  });

  it('enforces the message ceiling in the composer and the column', () => {
    expect(read('src/components/Composer.tsx')).toContain('maxLength={MAX_MESSAGE_CHARS}');
    expect(read('supabase/migrations/003_human_conversations.sql')).toContain(
      `length(body) <= ${MAX_MESSAGE_CHARS}`,
    );
    expect(MAX_MESSAGE_CHARS).toBeGreaterThan(0);
  });
});

/**
 * Guards on the pipeline itself. A job that calls a script that no longer
 * exists, or a pgTAP file whose plan drifted from its assertion count, fails
 * silently in the worst way: the suite reports success having run nothing.
 *
 * Reads `.gitlab-ci.yml` — per ADR-0003 the GitHub workflows are gone, and
 * asserting against YAML that can never run is worse than not asserting.
 */
describe('pipeline wiring', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
  const pipeline = read('.gitlab-ci.yml');

  it('declares every npm script the pipeline invokes', () => {
    const invoked = [...pipeline.matchAll(/npm run ([a-z:]+)/g)].map(m => m[1] ?? '');
    expect(invoked.length).toBeGreaterThan(0);
    for (const name of invoked) {
      expect(Object.keys(scripts)).toContain(name);
    }
  });

  it('points every `node scripts/...` call at a file that exists', () => {
    const referenced = [...pipeline.matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map(m => m[1] ?? '');
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(() => read(file)).not.toThrow();
    }
  });

  it('runs every pgTAP suite that exists', () => {
    const declared = readdirSync(join(ROOT, 'supabase/tests'))
      .filter(f => /^\d{3}_.*\.sql$/.test(f) && !f.includes('generated'));
    const runner = read('scripts/db-test.mjs');
    for (const file of declared) {
      expect(runner).toContain(file);
    }
  });

  it('applies every migration in the test harness', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter(f =>
      f.endsWith('.sql'),
    );
    const runner = read('scripts/db-test.mjs');
    for (const file of migrations) {
      expect(runner).toContain(file);
    }
  });

  it.each([
    'supabase/tests/010_wallet_and_grants.sql',
    'supabase/tests/020_conversations_and_roles.sql',
    'supabase/tests/030_message_guard_and_directory.sql',
  ])('keeps the pgTAP plan in step with the assertions in %s', file => {
    const sql = read(file);
    const planned = Number(/select plan\((\d+)\)/.exec(sql)?.[1]);
    const asserted = (
      sql.match(
        /^select (has_table|hasnt_table|has_column|hasnt_column|has_index|has_trigger|col_is_pk|col_not_null|col_has_default|col_default_is|policies_are|function_privs_are|isnt_empty|throws_ok|lives_ok|ok|is|isnt)\(/gm,
      ) ?? []
    ).length;
    expect(planned).toBe(asserted);
  });

  it('never lets the maestro flows drift from the app id', () => {
    for (const flow of readdirSync(join(ROOT, '.maestro')).filter(f => /^\d/.test(f))) {
      expect(read(`.maestro/${flow}`)).toContain('appId: com.companionchat');
    }
  });

  it('asserts the test IDs the flows select on still exist in the components', () => {
    const sources = ['src/components', 'src/screens'];
    const haystack = sources
      .flatMap(dir => readdirSync(join(ROOT, dir)).map(f => read(`${dir}/${f}`)))
      .join('\n');

    const selectors = new Set(
      readdirSync(join(ROOT, '.maestro'))
        .filter(f => /^\d/.test(f))
        .flatMap(f => [...read(`.maestro/${f}`).matchAll(/id:\s*'([^']+)'/g)])
        .map(m => m[1] ?? ''),
    );
    expect(selectors.size).toBeGreaterThan(0);

    for (const id of selectors) {
      // Flows select on a prefix for generated ids (`provider-<uuid>`).
      const needle = id.replace(/\.\*$/, '');
      expect(haystack).toContain(needle);
    }
  });
});

/**
 * No screen is written and then never mounted.
 *
 * This test exists because `ReviewSheet` shipped complete — sheet, mutation,
 * `submit_review`, a `reviewed` column in `conversation_summaries` published
 * specifically to drive it — and was rendered by nothing at all. Everything
 * typechecked, everything linted, no test failed, and the feature did not
 * exist. Dead UI is the one class of bug the other gates here cannot see,
 * because a component that is never referenced is indistinguishable from one
 * that is correct.
 */
describe('every screen is reachable', () => {
  const mounters = ['App.tsx', ...walk(join(ROOT, 'src'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => f.slice(ROOT.length + 1))]
    .map(read)
    .join('\n');

  const screens = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => f.replace(/\.tsx$/, ''));

  it('finds screens to check', () => {
    expect(screens.length).toBeGreaterThan(8);
  });

  it.each(screens)('mounts %s somewhere', name => {
    // The trailing character class is not decoration: a bare
    // `toContain('<Name')` is satisfied by `<NameSomethingElse`, which made an
    // earlier version of this test pass against a deliberately broken mount.
    // Counting occurrences would not work either — the defining file holds the
    // name as a function declaration, never as an element.
    expect(mounters).toMatch(new RegExp(`<${name}[\\s/>]`));
  });
});

/**
 * The rating prompt's guards, as source-level claims.
 *
 * All four matter and three of them are invisible from the outside: this screen
 * serves the provider tree as well, `submit_review` refuses anyone who is not
 * the member, and the server refuses a thread with fewer than two messages. A
 * prompt that ignored any of them would offer an action that can only fail.
 */
describe('the review prompt is offered only when it can succeed', () => {
  const chat = read('src/screens/ChatScreen.tsx');

  it('asks the conversation who the member is, not the profile', () => {
    // `profiles.role` flips when a member is admitted as a provider and takes
    // their old member-side threads with it, so it is the wrong question.
    //
    // Asserted against the code with comments stripped, because the comment
    // explaining why the old form was wrong *contains* the old form — which is
    // a negative assertion failing on the prose that documents it.
    expect(chat).toContain('thread.i_am_member');
    expect(withoutComments(chat)).not.toContain("role === 'member'");
  });

  it('requires both sides to have said something', () => {
    expect(chat).toContain('m.sender_id === selfId');
    expect(chat).toContain('m.sender_id !== selfId');
  });

  it('says nothing until the conversation row has actually loaded', () => {
    // `thread !== undefined` first: the alternative is a prompt that appears
    // and disappears on its own as the query settles.
    expect(chat).toContain('thread !== undefined');
    expect(chat).toContain('!thread.reviewed');
  });

  it('keeps the provider work list to actual work', () => {
    const home = read('src/screens/ProviderHomeScreen.tsx');
    expect(home).toContain('!t.i_am_member');
    // ...while still letting them open the threads they are the member of,
    // because role picks the whole navigation tree and nothing else would.
    expect(home).toContain('t.i_am_member');
    expect(home).toContain('Your own conversations');
  });

  it('never blocks the transcript with it', () => {
    // A rating request in a modal over an open conversation would interrupt the
    // single thing this screen is for.
    expect(chat).not.toMatch(/Alert\.alert/);
  });
});
