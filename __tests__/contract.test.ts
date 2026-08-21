import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isUuid } from '../src/lib/ids';
import { normalisePhone } from '../src/lib/phone';
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
    'src/api/stream.ts',
    'src/lib/personas.ts',
    'src/components/StreamingTurn.tsx',
    'scripts/openai-stub.mjs',
  ])('has removed %s', path => {
    expect(existsSync(join(ROOT, path))).toBe(false);
  });

  /**
   * This used to assert `supabase/functions` did not exist at all, which was a
   * proxy for "no Edge Function holds a model provider key". The push sender is
   * an Edge Function and a legitimate one, so the proxy had to be replaced with
   * the thing it stood for: whatever lives there, none of it may be an AI path.
   */
  it('allows Edge Functions, but only ones that are not a model path', () => {
    const dir = join(ROOT, 'supabase/functions');
    if (!existsSync(dir)) {
      return;
    }
    const allowed = ['send-push', 'send-sms', 'verify-phone'];
    const present = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    // An allow-list rather than a pattern: a new Edge Function is a decision
    // worth making explicitly, because this is the one place in the stack that
    // holds a credential and can reach the open internet.
    expect(present.sort()).toEqual(allowed);
  });

  it('leaves no reference to a model, a prompt or an SSE stream in the app', () => {
    const sources = ['src', '__tests__', 'supabase/functions']
      .filter(dir => existsSync(join(ROOT, dir)))
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

  it('requests exactly INTERNET, VIBRATE and POST_NOTIFICATIONS', () => {
    // The list is asserted exactly rather than as a subset, because the cost of
    // a permission is paid on the Play listing and in the install dialog — a
    // library quietly merging one in is the failure this catches. POST_NOTIFICATIONS
    // was added deliberately for push and grants no access to data.
    expect(declared.sort()).toEqual([
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
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

    /**
     * Ids under `assertNotVisible` are excluded, and the exclusion is the
     * interesting part: those name things that must *not* exist. `signin-facebook`
     * is asserted absent because the Facebook button shipped with no credentials
     * behind it, so every tap failed — and a flow that simply stopped mentioning
     * it would pass again the moment someone re-added it.
     */
    const flows = readdirSync(join(ROOT, '.maestro')).filter(f => /^\d/.test(f));
    const selectors = new Set<string>();
    for (const file of flows) {
      const body = read(`.maestro/${file}`);
      for (const block of body.split(/\n(?=- )/)) {
        if (/assertNotVisible/.test(block)) {
          continue;
        }
        for (const m of block.matchAll(/id:\s*'([^']+)'/g)) {
          selectors.add(m[1] ?? '');
        }
      }
    }
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

/**
 * Gestures work inside modals.
 *
 * On Android a React Native `Modal` is a separate native window with its own
 * root view, so the `GestureHandlerRootView` at the top of `App.tsx` does not
 * enclose anything rendered inside one. A pan declared in a modal is
 * constructed, attached, and then recognised by nobody — silently. Found by
 * holding a finger on the sheet and dragging: nothing moved, nothing warned.
 *
 * Asserted structurally because the failure mode is a feature that quietly does
 * not exist, which no runtime check will catch.
 */
describe('gesture handling reaches every root', () => {
  it('wraps the app root', () => {
    expect(read('App.tsx')).toContain('<GestureHandlerRootView');
  });

  it('wraps each modal that declares a gesture', () => {
    const withModals = ['src/components', 'src/screens']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.tsx'))
          .map(f => ({ file: `${dir}/${f}`, body: read(`${dir}/${f}`) })),
      )
      .filter(s => s.body.includes('<Modal') && /Gesture\.\w+\(/.test(s.body));

    expect(withModals.length).toBeGreaterThan(0);
    for (const s of withModals) {
      expect(s.body).toContain('<GestureHandlerRootView');
    }
  });

  it('keeps the sheet the only gesture surface for now', () => {
    // Not a rule, a tripwire: the next component to declare a pan needs the
    // wrapper decision made deliberately rather than copied.
    const users = ['src/components', 'src/screens']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.tsx'))
          .map(f => ({ file: f, body: read(`${dir}/${f}`) })),
      )
      .filter(s => /Gesture\.\w+\(/.test(s.body))
      .map(s => s.file);
    expect(users).toEqual(['Sheet.tsx']);
  });
});

/**
 * The launcher icon, which is the one asset with no runtime and therefore no
 * chance of failing loudly.
 *
 * Every density is a resized copy of a committed master, so the interesting
 * failures are structural: a density bucket that was never generated, an
 * adaptive layer referenced by XML but absent from mipmap, and the ink value
 * hardcoded in colors.xml drifting from the token it was copied from. None of
 * those show up in a build; all of them show up on someone's home screen.
 */
describe('launcher icon', () => {
  const RES = 'android/app/src/main/res';
  const BUCKETS = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const LAYERS = [
    'ic_launcher.png',
    'ic_launcher_round.png',
    'ic_launcher_foreground.png',
    'ic_launcher_monochrome.png',
  ];

  it('ships every layer at every density', () => {
    const missing: string[] = [];
    for (const bucket of BUCKETS) {
      for (const layer of LAYERS) {
        if (!existsSync(join(ROOT, RES, `mipmap-${bucket}`, layer))) {
          missing.push(`mipmap-${bucket}/${layer}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the pre-26 bitmaps, because minSdk is 24', () => {
    // Adaptive icons start at API 26. Deleting these because the XML exists
    // would leave two Android versions with no icon at all.
    const minSdk = read('android/build.gradle').match(/minSdkVersion\s*=\s*(\d+)/);
    expect(minSdk).not.toBeNull();
    expect(Number(minSdk?.[1])).toBeLessThan(26);
    expect(existsSync(join(ROOT, RES, 'mipmap-mdpi/ic_launcher.png'))).toBe(true);
  });

  it('declares a monochrome layer for themed icons', () => {
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = read(`${RES}/mipmap-anydpi-v26/${name}`);
      expect(xml).toContain('<monochrome');
      expect(xml).toContain('@mipmap/ic_launcher_monochrome');
    }
  });

  it('backs the adaptive icon with a drawable, not a bare colour', () => {
    // `<background android:drawable="@color/...">` compiles and ships the right
    // value, and then renders as nothing on API 34 — the mark composited over
    // whatever was behind it and the paper bubble vanished. Verified on device;
    // this is the assertion that stops it coming back.
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = read(`${RES}/mipmap-anydpi-v26/${name}`);
      const background = xml.match(/<background[^>]*android:drawable="([^"]+)"/)?.[1];
      expect(background).toBe('@drawable/ic_launcher_bg');
    }
    expect(read(`${RES}/drawable/ic_launcher_bg.xml`)).toContain(
      '@color/ic_launcher_background',
    );
  });

  it('resolves every resource the adaptive XML references', () => {
    const xml = read(`${RES}/mipmap-anydpi-v26/ic_launcher.xml`);
    for (const [, ref] of xml.matchAll(/@mipmap\/(\w+)/g)) {
      expect(existsSync(join(ROOT, RES, 'mipmap-xxxhdpi', `${ref}.png`))).toBe(true);
    }
    for (const [, ref] of xml.matchAll(/@drawable\/(\w+)/g)) {
      expect(existsSync(join(ROOT, RES, 'drawable', `${ref}.xml`))).toBe(true);
    }
    for (const [, ref] of read(`${RES}/drawable/ic_launcher_bg.xml`).matchAll(
      /@color\/(\w+)/g,
    )) {
      expect(read(`${RES}/values/colors.xml`)).toContain(`name="${ref}"`);
    }
  });

  it('keeps the native icon background equal to the token it was copied from', () => {
    // colors.xml cannot be generated: the platform reads it before any JS runs.
    // So this is the only thing standing between a palette change and an icon
    // that no longer matches the app it opens.
    const tokens = JSON.parse(read('design/tokens.json'));
    const ink = tokens.color.tokens['bg/inverse'].Light.toUpperCase();
    const declared = read(`${RES}/values/colors.xml`)
      .match(/name="ic_launcher_background">(#[0-9A-Fa-f]{6})</)?.[1]
      ?.toUpperCase();
    expect(declared).toBe(ink);
  });

  it('has a Play listing icon and feature graphic', () => {
    expect(existsSync(join(ROOT, 'docs/play/assets/play-icon-512.png'))).toBe(true);
    expect(
      existsSync(join(ROOT, 'docs/play/assets/feature-graphic-1024x500.png')),
    ).toBe(true);
  });
});

/**
 * Copy that describes how you sign in, versus how you actually sign in.
 *
 * The settings sheet told every user "Signed in with your phone number" for as
 * long as phone auth had been off — a claim about identity, on the privacy
 * screen, that was simply false. It survived a full verify because nothing ties
 * prose to `SocialProvider`. This does.
 */
describe('sign-in copy matches the sign-in that exists', () => {
  const providers = (() => {
    const union = read('src/api/auth.ts').match(
      /export type SocialProvider =([^;]+);/,
    )?.[1];
    expect(union).toBeDefined();
    return [...(union ?? '').matchAll(/'([a-z]+)'/g)].map(m => m[1] ?? '');
  })();

  it('offers only providers the app implements', () => {
    expect(providers).toEqual(['google']);
  });

  it('never claims an identity the app cannot issue', () => {
    // Every user-facing string in the app, checked against the providers that
    // are not in the union. "phone" is the one that actually happened; the rest
    // are here so the next removal is caught by the same test.
    const absent = ['phone number', 'facebook', 'apple id'].filter(
      name => !providers.some(p => name.startsWith(p)),
    );
    const screens = readdirSync(join(ROOT, 'src/screens'))
      .filter(f => f.endsWith('.tsx'))
      .map(f => ({ file: f, body: withoutComments(read(`src/screens/${f}`)) }));

    for (const screen of screens) {
      for (const name of absent) {
        // "your phone" is the device, not the identity — that is the whole
        // distinction this test has to be careful about, so match the claim
        // ("signed in with ... phone number") rather than the noun.
        const claim = new RegExp(`[Ss]igned in with[^'"]{0,40}${name}`, 'i');
        expect(screen.body).not.toMatch(claim);
      }
    }
  });
});

/**
 * Nothing that signs or authenticates may be git-trackable.
 *
 * There is now a copy of the upload keystore and its two passwords at the repo
 * root, which is convenient and also the single worst place for them: the root
 * is the directory that gets committed, archived and shared. `.gitignore` covers
 * the paths that exist today, and that is exactly the protection that fails —
 * the realistic accident is not someone reading the repo, it is someone adding
 * `upload.keystore.bak` or `keys/` and pushing a signing key to two remotes,
 * where it cannot be un-pushed.
 *
 * So this asserts the property rather than the paths: for every file on disk
 * that looks like a credential, git must refuse to track it. A new name is
 * caught the first time anyone runs the suite.
 */
describe('secrets are untrackable', () => {
  const SUSPICIOUS = /(\.keystore|\.jks|\.p12|\.pem|keystore\.properties|-key\.json|service.?account.*\.json|\.env$)/i;

  /** Files git would actually track, i.e. not ignored. `-c` keeps it quiet. */
  function trackable(paths: string[]): string[] {
    if (paths.length === 0) {
      return [];
    }
    const result = spawnSync(
      'git',
      ['check-ignore', '--no-index', '--stdin'],
      { cwd: ROOT, input: paths.join('\n'), encoding: 'utf8' },
    );
    const ignored = new Set(
      (result.stdout ?? '').split('\n').map(l => l.trim()).filter(Boolean),
    );
    return paths.filter(p => !ignored.has(p));
  }

  it('ignores every credential-shaped file present on disk', () => {
    const listed = spawnSync(
      'git',
      ['ls-files', '--others', '--cached', '--exclude-standard', '-z'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    // `--others --exclude-standard` lists untracked-but-not-ignored files, and
    // `--cached` lists tracked ones. Anything credential-shaped in either set is
    // a file git is willing to commit.
    const candidates = (listed.stdout ?? '')
      .split('\0')
      .filter(Boolean)
      .filter(p => SUSPICIOUS.test(p))
      // Three files legitimately live in git, and each is committed on purpose:
      //   - debug.keystore is Android's public, universally-known debug key,
      //     needed for a debug build to work on a fresh clone.
      //   - keystore.properties.example is a template with no values in it.
      //   - ios/.xcode.env is Xcode build config, matched only because the
      //     pattern ends with `.env`. It holds a node path, not a secret.
      .filter(
        p =>
          ![
            'android/app/debug.keystore',
            'android/keystore.properties.example',
            'ios/.xcode.env',
          ].includes(p),
      );

    expect(candidates).toEqual([]);
  });

  it('would refuse the names someone is most likely to invent', () => {
    const likely = [
      'upload.keystore',
      'upload.keystore.bak',
      'keys-backup/upload.keystore',
      'keys/upload.jks',
      'android/keystore.properties',
      'backup/keystore.properties',
      '.env',
      '.secrets/fcm-sender.json',
      'fcm-service-account.json',
    ];
    expect(trackable(likely)).toEqual([]);
  });
});

/**
 * Phone sign-in is written and switched off, and this is what keeps the second
 * half of that sentence true.
 *
 * The Facebook button shipped: an option that took a tap and produced a failure,
 * because the provider had no credentials. Phone is the same shape of risk for a
 * different reason — Indian transactional SMS cannot be delivered at all until
 * DLT registration completes, so `signInWithOtp` would accept a number, look
 * like it worked, and deliver nothing for one to three weeks.
 */
describe('phone sign-in stays off until it can deliver', () => {
  const auth = read('src/api/auth.ts');
  const enabled = /export const PHONE_AUTH_ENABLED = (true|false);/.exec(auth)?.[1];

  it('declares the flag explicitly', () => {
    expect(enabled).toBeDefined();
  });

  /**
   * Rewritten when the screen was built.
   *
   * This used to assert the sign-in screen never mentioned phone at all, which
   * was the right intent expressed the wrong way — it forbade the code rather
   * than the reachability. The screen now implements phone sign-in and gates the
   * entry point, so the assertion that matters is that the gate is actually
   * there: every element that starts the flow must be inside a
   * PHONE_AUTH_ENABLED condition.
   */
  it('gates every phone entry point on the flag', () => {
    const screen = withoutComments(read('src/screens/AuthScreen.tsx'));

    // The button that begins the flow, and the copy that promises it.
    for (const marker of ['signin-phone"', 'Continue with phone']) {
      const at = screen.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      // Walk back to the enclosing JSX conditional and require the flag in it.
      const preceding = screen.slice(Math.max(0, at - 400), at);
      expect(preceding).toMatch(/PHONE_AUTH_ENABLED/);
    }
  });

  it('still offers Google as a primary button when phone is off', () => {
    // With the flag false there is exactly one way in, and it must not render as
    // a secondary action with nothing above it.
    const screen = withoutComments(read('src/screens/AuthScreen.tsx'));
    expect(screen).toMatch(/kind=\{PHONE_AUTH_ENABLED \? 'secondary' : 'primary'\}/);
  });

  it('refuses to call Supabase while the flag is false', () => {
    // Both entry points return early, so even a caller that ignores the flag
    // cannot spend an SMS or start a flow that cannot finish.
    for (const fn of ['sendPhoneOtp', 'verifyPhoneOtp']) {
      const start = auth.indexOf(`export async function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      const body = auth.slice(start, start + 400);
      expect(body).toMatch(/if \(!PHONE_AUTH_ENABLED\)/);
    }
  });

  it('keeps the hook disabled in config while the flag is false', () => {
    if (enabled !== 'false') {
      return;
    }
    const config = read('supabase/config.toml');
    // Every line of the hook block must still be commented out. An enabled hook
    // with no MSG91 credentials makes Supabase fail the send rather than skip it.
    const live = config
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(live).not.toContain('[auth.hook.send_sms]');
  });
});

describe('normalisePhone', () => {
  it('assumes +91 for a bare ten-digit number', () => {
    expect(normalisePhone('9876543210')).toBe('919876543210');
    expect(normalisePhone('98765 43210')).toBe('919876543210');
  });

  it('leaves an existing country code alone', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalisePhone('+1 415 555 0123')).toBe('14155550123');
  });

  it('rejects anything too short or too long to be dialable', () => {
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('9876543210987654321')).toBeNull();
    expect(normalisePhone('not a phone')).toBeNull();
  });
});

/**
 * `supabase config push` sends config.toml verbatim, so this file is
 * authoritative or it is a landmine.
 *
 * On 2026-08-21 a push made to change the SMS OTP expiry also took Google
 * sign-in down, because config.toml said `enabled = false` while the credentials
 * had been set in the dashboard. Nothing in the file or the tests objected. The
 * secret survived and only the flag flipped, so it was a few minutes of outage
 * rather than an unrecoverable one — but the next version of that mistake could
 * wipe a credential nobody has a copy of.
 */
describe('config.toml cannot silently disable a live provider', () => {
  const config = read('supabase/config.toml');

  /** Uncommented lines only: the file explains a lot of things it does not do. */
  const live = config
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n');

  function providerBlock(name: string): string {
    const at = live.indexOf(`[auth.external.${name}]`);
    expect(at).toBeGreaterThan(-1);
    const rest = live.slice(at + 1);
    const next = rest.indexOf('\n[');
    return rest.slice(0, next === -1 ? undefined : next);
  }

  it('enables every provider the sign-in screen offers', () => {
    const providers = [
      ...(/export type SocialProvider =([^;]+);/
        .exec(read('src/api/auth.ts'))?.[1] ?? '')
        .matchAll(/'([a-z]+)'/g),
    ].map(m => m[1] ?? '');
    expect(providers.length).toBeGreaterThan(0);

    for (const provider of providers) {
      expect(providerBlock(provider)).toMatch(/enabled = true/);
    }
  });

  it('keeps the client id literal and only the secret in the environment', () => {
    // A client id is not a secret — it ships inside google-services.json. Having
    // it as env() is how the value ends up empty on a push from a machine that
    // happens not to have the variable set.
    const block = providerBlock('google');
    expect(block).toMatch(/client_id = "\d+-[a-z0-9]+\.apps\.googleusercontent\.com"/);
    expect(block).toMatch(/secret = "env\(/);
  });

  it('agrees with the app about the code expiry', () => {
    // The screen tells the user how long they have. If the two disagree, one of
    // them is lying to somebody.
    const seconds = Number(/^otp_expiry = (\d+)$/m.exec(live)?.[1]);
    expect(Number.isFinite(seconds)).toBe(true);
    const minutes = seconds / 60;
    expect(read('src/screens/AuthScreen.tsx')).toContain(
      `expires in ${minutes} minute`,
    );
  });

  it('does not let the resend button outpace the server', () => {
    // The screen enables "Resend code" after RESEND_SECONDS. If Supabase's
    // max_frequency is longer, the button is live while the server still refuses
    // — the user gets a security error for pressing what the app offered.
    const maxFrequency = /^max_frequency = "(\d+)s"$/m.exec(live)?.[1];
    const uiCooldown = /const RESEND_SECONDS = (\d+);/.exec(
      read('src/screens/AuthScreen.tsx'),
    )?.[1];
    expect(maxFrequency).toBeDefined();
    expect(uiCooldown).toBeDefined();
    expect(Number(uiCooldown)).toBeGreaterThanOrEqual(Number(maxFrequency));
  });
});

/**
 * In-app updates have to be present in the FIRST release or they are useless for
 * the first update.
 *
 * The prompt runs inside the version the user already has. A 1.0.0 that ships
 * without this can never offer 1.0.1 in-app — Play's silent background
 * auto-update still happens, but nothing can ask. There is no way to add it
 * retroactively to a version already installed, which makes this the one feature
 * whose absence cannot be fixed in the next release.
 */
describe('in-app updates are wired end to end', () => {
  it('depends on the Play app-update library', () => {
    expect(read('android/app/build.gradle')).toMatch(
      /implementation\("com\.google\.android\.play:app-update:[\d.]+"\)/,
    );
  });

  it('registers the native package, which autolinking cannot do for us', () => {
    // It is this app's own module rather than a node_modules package, so it must
    // be added by hand — and a missing registration fails silently: the JS side
    // simply sees an unsupported platform and never prompts.
    expect(read('android/app/src/main/java/com/companionchat/MainApplication.kt')).toContain(
      'add(InAppUpdatePackage())',
    );
  });

  it('keeps the decision out of the native module', () => {
    // The bridge cannot be tested without Play, so it must hold no judgement.
    // Anything resembling a threshold in Kotlin is a rule nothing can verify.
    const kotlin = read('android/app/src/main/java/com/companionchat/InAppUpdateModule.kt');
    expect(kotlin).not.toMatch(/updatePriority\(\)\s*>=/);
    expect(kotlin).not.toMatch(/clientVersionStalenessDays\(\)\s*>=/);
  });

  it('mounts the restart prompt outside the routed tree', () => {
    // A downloaded update must survive navigation and both the signed-in and
    // signed-out trees. Mounting it inside a screen loses it on the next route.
    const app = read('App.tsx');
    expect(app).toContain('<UpdateBanner />');
    // After <Root /> rather than adjacent to it: stripping the JSX comment that
    // explains why leaves braces behind, so an adjacency regex is checking the
    // comment's formatting rather than the mount point.
    expect(app.indexOf('<UpdateBanner />')).toBeGreaterThan(app.indexOf('<Root />'));
    // And a sibling of <Root /> inside Shell, not nested in a screen. Scoped to
    // the Shell function body, because a whole-file regex with [\s\S]* only
    // proves one string appears before another — which was the first version of
    // this assertion and it proved nothing.
    const shell = app.slice(app.indexOf('function Shell()'));
    expect(shell).toContain('<UpdateBanner />');
  });

  it('never blocks a release build on an accidental versionCode', () => {
    // Play rejects a duplicate versionCode. The old default of 1 meant the first
    // upload worked and every later local build collided.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('wantsRelease && explicitVersionCode == null');
    expect(gradle).toMatch(/throw new GradleException/);
  });
});
