import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { isUuid, newUuid } from '../src/lib/ids';
import { normalisePhone } from '../src/lib/phone';
import {
  DAILY_REFILL_TOKENS,
  MAX_MESSAGE_CHARS,
  STARTING_BALANCE,
} from '../src/lib/tokenLedger';
import { MAX_VOICE_MS, MIN_VOICE_MS, isVoicePath } from '../src/lib/voice';
import { TOKENS } from '../src/theme/tokens';

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
 * which is fine, no assertion here looks for `//` inside a string.
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

  it('mints keys its own validator accepts', () => {
    // `newUuid` names the storage object a voice note is uploaded under, and both
    // `isUuid` here and `voice_path_is_scoped` in migration 011 have to accept
    // it. Getting the version nibble or the variant bits wrong produces a string
    // that looks right, uploads fine, and is refused by the CHECK constraint
    // after the bytes are already in the bucket.
    for (let i = 0; i < 50; i += 1) {
      const id = newUuid();
      expect(isUuid(id)).toBe(true);
      expect(isVoicePath(`${newUuid()}/${id}.m4a`)).toBe(true);
    }
    expect(newUuid()).not.toBe(newUuid());
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
    // exchange-firebase-token: verifies a Firebase phone ID token (JWKS) and
    // mints a Supabase session — an auth bridge, not a model path. Added with
    // AUTH_PHONE_PROVIDER='firebase'.
    const allowed = [
      // cashfree-onboarding-complete: exchanges the 1-Click auth_code for the
      // verified PAN/DOB/bank and persists it (service-role writer); no model path.
      'cashfree-onboarding-complete',
      // cashfree-onboarding-start: mints a Cashfree 1-Click Onboarding session
      // (Data Availability + Initiate OAuth) so the native SDK sheet can open;
      // provider-JWT-gated, no model path. Verified PAN/identity flow.
      'cashfree-onboarding-start',
      // cashfree-payout: manual, founder-gated provider disbursement via Cashfree
      // Payouts Standard Transfer V2. Money-critical claim/settle is atomic SQL
      // (migration 050). Triggered from the admin payouts page.
      'cashfree-payout',
      // cashfree-webhook: Cashfree payment gateway signature-verified callback;
      // credits purchased tokens after server-side HMAC-SHA256 verification.
      // ADR-0022.
      'cashfree-webhook',
      // create-order: creates a Cashfree order server-side (secret key required);
      // returns paymentSessionId to the client. ADR-0022.
      'create-order',
      'exchange-firebase-token',
      'generate-invoice',
      'send-call',
      'send-engagement',
      'send-push',
      'send-sms',
      // verify-order: client-initiated server-to-server payment confirmation after
      // SDK onVerify callback — never trusts client callback alone. ADR-0022.
      'verify-order',
      // verify-pan: Cashfree Verification Suite PAN check (tax only, not KYC) so
      // TDS-194O is 0.1% not 5%. Writes provider_tax_profile. Migration 048.
      'verify-pan',
      // verify-payout-account: creates a Cashfree Payouts beneficiary from a
      // provider's saved bank/UPI and writes the verification result. Service-role
      // writer of the payout-account verification columns (migration 048).
      'verify-payout-account',
      'verify-phone',
    ];
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

/**
 * Cashfree billing invariants (ADR-0022).
 *
 * These assert three things that are easy to regress silently:
 *   1. create-order packs match RECHARGE_PACKS in rates.ts exactly.
 *   2. billing.ts does not contain the Cashfree client secret or any cfsk_ prefix —
 *      the secret key must never leave the Edge Functions.
 *   3. PaymentSheet imports CASHFREE_SANDBOX_CHECKOUT (and therefore routes through
 *      the sandbox path when the flag is true).
 */
describe('Cashfree billing invariants', () => {
  it('create-order packs align with RECHARGE_PACKS (100 300 500 1000 2500 5000)', () => {
    const fn = read('supabase/functions/create-order/index.ts');
    // Every pack from rates.ts must appear as a key in the server function.
    for (const amount of [100, 300, 500, 1000, 2500, 5000]) {
      expect(fn).toContain(`pappal_pack_${amount}`);
    }
    // Old mismatched packs must be gone.
    expect(fn).not.toMatch(/['"]pappal_pack_50['"]/);
    expect(fn).not.toMatch(/['"]pappal_pack_200['"]/);
    // Price must be 1 token = ₹1.
    expect(fn).toContain('amountInr: 100');
    expect(fn).toContain('amountInr: 5000');
  });

  it('billing.ts carries no client secret or cfsk_ key material', () => {
    const billing = withoutComments(read('src/api/billing.ts'));
    expect(billing).not.toMatch(/cfsk_/);
    expect(billing).not.toMatch(/client_secret/i);
    expect(billing).not.toMatch(/CASHFREE_CLIENT_SECRET/);
  });

  it('PaymentSheet imports CASHFREE_SANDBOX_CHECKOUT', () => {
    const sheet = read('src/screens/PaymentSheet.tsx');
    expect(sheet).toContain('CASHFREE_SANDBOX_CHECKOUT');
  });

  it('ConfirmDialog is hosted on Sheet', () => {
    const dialog = read('src/components/ConfirmDialog.tsx');
    expect(dialog).toContain("from './Sheet'");
    expect(dialog).toContain('<Sheet');
  });

  it('destructive confirms highlight Stay, not Leave', () => {
    const dialog = read('src/components/ConfirmDialog.tsx');
    expect(dialog).toContain('testID="confirm-dialog-cancel"');
    expect(dialog).toMatch(/destructive \? \([\s\S]*label=\{cancelLabel\}/);
  });

  it('wallet pill opens the full page, not the refill sheet', () => {
    expect(read('src/screens/HomeScreen.tsx')).toContain('onPress={openWallet}');
    expect(read('src/screens/ChatScreen.tsx')).toContain('onPress={openWallet}');
    expect(read('src/screens/ProviderDetailScreen.tsx')).toContain('onPress={openWallet}');
  });

  it('verify-order function exists and asserts server-to-server verification', () => {
    const fn = read('supabase/functions/verify-order/index.ts');
    expect(fn).toContain('fetchCashfreeOrder');
    expect(fn).toContain('credit_purchased_recharge');
    // Must assert it never trusts the client alone.
    expect(fn).toMatch(/never trust the client/i);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Reference harvesting stays clean-room (ADR-0025).
 *
 * We MEASURE reference apps and re-express their behaviour in our own code:
 * Telegram (GPL-2.0) and Fuse (a demo) are read for timings, thresholds and
 * interaction anatomy, recorded in design/references/*.md, and reimplemented.
 * We never copy their source, assets, strings, icons or Lottie files — doing so
 * with Telegram would force Pappal under the GPL. A copied Telegram file carries
 * one of these identifiers, so their absence anywhere in the shipping tree is
 * the mechanical proof the boundary held. (design/references is exempt: it is
 * where the measurements legitimately live.)
 */
describe('reference harvesting stays clean-room', () => {
  const FORBIDDEN = /org\.telegram|TMessagesProj|DrKLO/;
  const TEXT = /\.(ts|tsx|js|jsx|kt|java|xml|gradle|pro|json|md|txt|h|m|swift)$/;
  const ROOTS = ['src', 'assets', join('android', 'app', 'src')];

  it('carries no Telegram source, package or asset identifier', () => {
    const offenders: string[] = [];
    for (const r of ROOTS) {
      const base = join(ROOT, r);
      if (!existsSync(base)) {
        continue;
      }
      for (const abs of walk(base)) {
        const rel = abs.slice(ROOT.length + 1);
        if (FORBIDDEN.test(rel)) {
          offenders.push(`${rel} (filename)`);
        } else if (TEXT.test(abs) && FORBIDDEN.test(read(rel))) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

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

  it('requests exactly INTERNET, VIBRATE, POST_NOTIFICATIONS, RECORD_AUDIO, CAMERA, and call FGS permissions', () => {
    // The list is asserted exactly rather than as a subset, because the cost of
    // a permission is paid on the Play listing and in the install dialog, a
    // library quietly merging one in is the failure this catches. POST_NOTIFICATIONS
    // was added deliberately for push and grants no access to data.
    //
    // RECORD_AUDIO reaches a sensor (voice notes); CAMERA is a second sensor for
    // capturing a photo to send (#8). Both are declared by us rather than tolerated
    // from a dependency's manifest, because verify-manifest.mjs treats its allowlist
    // as the required set. USE_FULL_SCREEN_INTENT was here for a ringing call that
    // took over the screen; the call is a heads-up popup now, so the permission is
    // gone.
    //
    // Call foreground service permissions (android-audit.md 2026-08-29):
    //   MANAGE_OWN_CALLS — prerequisite for FOREGROUND_SERVICE_TYPE_PHONE_CALL
    //   FOREGROUND_SERVICE — required to start any foreground service
    //   FOREGROUND_SERVICE_PHONE_CALL/MICROPHONE/CAMERA — type permissions for API 34+
    //   (developer.android.com/about/versions/14/changes/fgs-types-required)
    //
    // ACCESS_NETWORK_STATE — added with Cashfree recharge (ADR-0022). The PG SDK's
    // analytics reads ConnectivityManager.getActiveNetworkInfo() WITHOUT a
    // permission check, so its absence is a SecurityException that crashes checkout
    // the instant Pay is tapped (not a graceful degrade). Normal, non-dangerous:
    // no runtime prompt, no Play Data Safety row. See AndroidManifest.xml comment
    // and verify-manifest.mjs allowlist.
    expect(declared.sort()).toEqual([
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.CAMERA',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CAMERA',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
      'android.permission.INTERNET',
      'android.permission.MANAGE_OWN_CALLS',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECORD_AUDIO',
      'android.permission.VIBRATE',
    ]);
  });

  it('declares none of the tracking or storage permissions', () => {
    // RECORD_AUDIO and CAMERA left this list on purpose when voice notes and
    // photo capture shipped — both are sensor permissions the product now uses on
    // purpose. The rest stay forbidden: the app reads no media library
    // (Android 13+ system photo picker needs no permission), no location, no
    // contacts, and never an advertising id.
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

  it('keeps the profiles column default in step with STARTING_BALANCE', () => {
    const migration = read('supabase/migrations/001_initial_schema.sql');
    expect(migration).toContain(`token_balance integer default ${STARTING_BALANCE}`);
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

  it('keeps the voice-note bounds in step with the CHECK constraint', () => {
    // The expensive version of this failure: the recorder caps at one number, the
    // constraint at another, and the mismatch is discovered *after* the audio is
    // already uploaded, because the RPC rejects the row and the bytes stay in the
    // bucket until the purge job runs.
    expect(read('supabase/migrations/011_reactions_replies_voice_calls.sql')).toContain(
      `voice_duration_ms between ${MIN_VOICE_MS} and ${MAX_VOICE_MS}`,
    );
  });
});

/**
 * Guards on the pipeline itself. A job that calls a script that no longer
 * exists, or a pgTAP file whose plan drifted from its assertion count, fails
 * silently in the worst way: the suite reports success having run nothing.
 *
 * Reads `.gitlab-ci.yml`, per ADR-0003 the GitHub workflows are gone, and
 * asserting against YAML that can never run is worse than not asserting.
 */
describe('pipeline wiring', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
  const pipeline = read('.gitlab-ci.yml');

  it('declares every npm script the pipeline invokes', () => {
    // Exclude script names that appear only in admin/ CI jobs: admin/ has its
    // own package.json and its scripts are verified by admin-static, not here.
    const adminJobScripts = new Set(['build']);
    const invoked = [...pipeline.matchAll(/npm run ([a-z:]+)/g)]
      .map(m => m[1] ?? '')
      .filter(name => !adminJobScripts.has(name));
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
    // 011's two suites. Included because a plan that drifts from the assertion
    // count is only caught by `npm run test:db`, which needs Docker and does not
    // run on this machine, so without these the numbers would go unchecked until
    // CI. The 040 to 080 suites are absent for a duller reason: they predate the
    // habit and several put a helper somewhere the counting regex cannot see.
    'supabase/tests/090_reactions_replies_voice_presence.sql',
    'supabase/tests/100_calls_and_metering.sql',
    // 020's suite. has_table + ok (×2) + function_privs_are + is = 5 counted by
    // the regex; plan(5) must stay in sync with that count.
    'supabase/tests/130_mock_recharge.sql',
    'supabase/tests/140_chat_minute.sql',
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
     * behind it, so every tap failed, and a flow that simply stopped mentioning
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
      if (haystack.includes(needle)) {
        continue;
      }
      if (id.startsWith('action-')) {
        const channel = id.slice('action-'.length);
        expect(haystack).toContain('testID={`action-${channel}`}');
        expect(haystack).toContain(`channel="${channel}"`);
        continue;
      }
      if (id.startsWith('nav-')) {
        const tab = id.slice('nav-'.length);
        expect(haystack).toContain('testID={`nav-${tab.key}`}');
        expect(haystack).toContain(`key: '${tab}'`);
        continue;
      }
      expect(haystack).toContain(needle);
    }
  });
});

/**
 * No screen is written and then never mounted.
 *
 * This test exists because `ReviewSheet` shipped complete, sheet, mutation,
 * `submit_review`, a `reviewed` column in `conversation_summaries` published
 * specifically to drive it, and was rendered by nothing at all. Everything
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
    // Counting occurrences would not work either, the defining file holds the
    // name as a function declaration, never as an element.
    expect(mounters).toMatch(new RegExp(`<${name}[\\s/>]`));
  });
});

describe('review collection remains deferred', () => {
  const chat = read('src/screens/ChatScreen.tsx');

  it('does not couple the ephemeral inbox to review state', () => {
    expect(withoutComments(chat)).not.toContain('reviewed');
    expect(chat).not.toContain('<ReviewSheet');
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
 * constructed, attached, and then recognised by nobody, silently. Found by
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

  it('limits gesture declarations to the sheet, the spotlight card, and the chat bubble', () => {
    // Tripwire: a new Gesture.Pan/LongPress needs a wrapper decision, not a copy.
    // Turn.tsx is the WhatsApp swipe-to-reply / long-press strip.
    // SpotlightCard.tsx is the M3 bottom sheet with drag-to-dismiss (2026-09).
    const users = ['src/components', 'src/screens']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.tsx'))
          .map(f => ({ file: f, body: read(`${dir}/${f}`) })),
      )
      .filter(s => /Gesture\.\w+\(/.test(s.body))
      .map(s => s.file)
      .sort();
    expect(users).toEqual(['Sheet.tsx', 'SpotlightCard.tsx', 'Turn.tsx']);
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
    // value, and then renders as nothing on API 34, the mark composited over
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
 * long as phone auth had been off, a claim about identity, on the privacy
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
        // "your phone" is the device, not the identity, that is the whole
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
 * the paths that exist today, and that is exactly the protection that fails,
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
 * different reason, Indian transactional SMS cannot be delivered at all until
 * DLT registration completes, so `signInWithOtp` would accept a number, look
 * like it worked, and deliver nothing for one to three weeks.
 */
describe('phone sign-in stays off until it can deliver', () => {
  const auth = read('src/api/auth.ts');
  // PHONE_AUTH_ENABLED is now defined in src/config.ts; auth.ts re-exports it.
  const featureFlags = read('src/config.ts');
  const enabled = /export const PHONE_AUTH_ENABLED = (true|false);/.exec(featureFlags)?.[1];

  it('declares the flag explicitly', () => {
    expect(enabled).toBeDefined();
  });

  /**
   * Rewritten when the screen was built.
   *
   * This used to assert the sign-in screen never mentioned phone at all, which
   * was the right intent expressed the wrong way, it forbade the code rather
   * than the reachability. The screen now implements phone sign-in and gates the
   * entry point, so the assertion that matters is that the gate is actually
   * there: every element that starts the flow must be inside a
   * PHONE_AUTH_ENABLED condition.
   */
  it('gates every phone entry point on the flag', () => {
    // OnboardingScreen is the sole sign-in surface now (Amit, 2026-09-03:
    // "remove this from app and wire welcome screen" retired the separate
    // returning-user AuthScreen), so the gate lives here.
    const screen = withoutComments(read('src/screens/OnboardingScreen.tsx'));

    // The button that begins the flow, and the copy that promises it.
    for (const marker of ['onboard-use-phone"', 'Use my number instead']) {
      const at = screen.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      // Walk back to the enclosing JSX conditional and require the flag in it.
      const preceding = screen.slice(Math.max(0, at - 600), at);
      expect(preceding).toMatch(/PHONE_AUTH_ENABLED|phoneVisible/);
    }
  });

  it('still offers Google as a primary button when phone is off', () => {
    // The Google button is always rendered, regardless of whether phone auth
    // is enabled. `testID="onboard-google"` is the stable identifier.
    const screen = withoutComments(read('src/screens/OnboardingScreen.tsx'));
    expect(screen).toContain('testID="onboard-google"');
    // Rendered only in the 'choose' step, where it is the sole or co-primary action.
    expect(screen).toContain("identify === 'choose'");
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
 * rather than an unrecoverable one, but the next version of that mistake could
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
    // A client id is not a secret, it ships inside google-services.json. Having
    // it as env() is how the value ends up empty on a push from a machine that
    // happens not to have the variable set.
    const block = providerBlock('google');
    expect(block).toMatch(/client_id = "\d+-[a-z0-9]+\.apps\.googleusercontent\.com"/);
    expect(block).toMatch(/secret = "env\(/);
  });

  it('does not let the resend button outpace the server', () => {
    // OnboardingScreen enables "Resend code" after RESEND_SECONDS. If
    // Supabase's max_frequency is longer, the button is live while the server
    // still refuses, and the user gets a security error for pressing what the
    // app offered. Ported from the retired AuthScreen (Amit, 2026-09-03) —
    // OnboardingScreen is the sole sign-in surface now, so this is the one
    // place the check still needs to hold.
    const maxFrequency = /^max_frequency = "(\d+)s"$/m.exec(live)?.[1];
    const uiCooldown = /const RESEND_SECONDS = (\d+);/.exec(
      read('src/screens/OnboardingScreen.tsx'),
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
 * without this can never offer 1.0.1 in-app, Play's silent background
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
    // be added by hand, and a missing registration fails silently: the JS side
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
    // proves one string appears before another, which was the first version of
    // this assertion and it proved nothing.
    const shell = app.slice(app.indexOf('function Shell()'));
    expect(shell).toContain('<UpdateBanner />');
  });

  it('keeps the App Distribution SDK out of the Play artefact', () => {
    // Measured, not assumed: the full SDK pulls in REQUEST_INSTALL_PACKAGES and
    // WRITE_EXTERNAL_STORAGE. REQUEST_INSTALL_PACKAGES is a restricted
    // permission needing a Play declaration, and an app about paid conversation
    // with strangers asking to install packages is a review problem. The
    // `internal` variant carries it; `release` must not.
    //
    // The whole risk is one word: changing `internalImplementation` to
    // `implementation` would ship it to Play with nothing else looking wrong.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain(
      'internalImplementation("com.google.firebase:firebase-appdistribution:',
    );
    expect(gradle).not.toMatch(
      /^\s*implementation\("com\.google\.firebase:firebase-appdistribution:/m,
    );
    // The -api artefact IS in every variant, deliberately. It is the no-op that
    // lets MainActivity call updateIfNewReleaseAvailable() without a
    // variant-specific source set.
    expect(gradle).toContain(
      'implementation("com.google.firebase:firebase-appdistribution-api:',
    );
  });

  it('derives the internal versionCode so a bump is enough to prompt testers', () => {
    // App Distribution prompts on versionCode. A fixed one means no tester is
    // ever offered anything, however many builds get pushed.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('parts[0] * 10000 + parts[1] * 100 + parts[2]');
    expect(gradle).toContain('versionName versionNameProperty');
    // No hardcoded version left behind for the two to drift apart.
    expect(gradle).not.toMatch(/versionName\s+"\d+\.\d+\.\d+"/);
  });

  it('limits cleartext to the debug emulator-host exception', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const main = read('android/app/src/main/res/xml/network_security_config.xml');
    const debug = read('android/app/src/debug/res/xml/network_security_config.xml');

    expect(manifest).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"',
    );
    expect(manifest).not.toContain('usesCleartextTraffic');
    expect(main).toContain('<base-config cleartextTrafficPermitted="false"');
    expect(debug).toContain('<domain includeSubdomains="false">10.0.2.2</domain>');
    expect(debug).not.toContain('<base-config cleartextTrafficPermitted="true"');
  });

  it('builds only the connected Android device ABI during local iteration', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.android).toBe(
      'react-native run-android --active-arch-only',
    );
  });

  it('sends testers the internal APK, never the release one', () => {
    // Distributing release would work and testers would never be prompted
    // again, because that artefact has only the no-op stub.
    const script = read('scripts/distribute.mjs');
    expect(script).toContain('apk/internal/app-internal.apk');
    expect(script).not.toContain('apk/release/app-release.apk');
  });

  it('never blocks a release build on an accidental versionCode', () => {
    // Play rejects a duplicate versionCode. The old default of 1 meant the first
    // upload worked and every later local build collided.
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('(wantsRelease || wantsClosedTest) && explicitVersionCode == null');
    expect(gradle).toMatch(/throw new GradleException/);
  });
});

/**
 * A block was enforced in `send_message` and invisible everywhere else, so after
 * blocking someone they stayed in the directory, stayed in the "here now" rail,
 * and the block only announced itself as an error after the member had typed a
 * message. These assertions pin the fix, and one of them pins the seam it is
 * deliberately *not* at.
 */
describe('a block is visible where it matters and reversible everywhere', () => {
  it('keeps blocked people out of both discovery surfaces', () => {
    // v13 HomeScreen merges both discovery surfaces: the Explore directory and the
    // CHATS rail. Both are filtered by the same block set.
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toContain('useBlockedPeerIds');
    // Provider directory surface (was ProvidersScreen.tsx):
    expect(home).toContain('(providers ?? []).filter(p => !blocked.has(p.id))');
    // CHATS rail surface (was InboxScreen.tsx; the typed-search strangers filter
    // has no v13 equivalent since HomeScreen has no search — retired with InboxScreen):
    expect(home).toContain('!blocked.has(c.peer_id) && visibleOnRail(railPrefs, c.peer_id)');
  });

  // Retired with InboxScreen.tsx: v13 HomeScreen hides blocked conversations from the
  // CHATS rail entirely (filter on mount) rather than keeping them visible with a
  // "blocked – open to unblock" indicator. The unblock path moves to ProviderDetailScreen.

  it('leaves the filtering out of provider_directory, which the inbox joins', () => {
    // The trap: a `where` clause here would null `peer_display_name` on the
    // blocked person's existing thread, because conversation_summaries LEFT
    // JOINs this view to resolve it.
    const migration = read('supabase/migrations/006_phone_auth_and_provider_onboarding.sql');
    const view = migration.slice(
      migration.indexOf('create view public.provider_directory'),
      migration.indexOf('comment on view public.provider_directory'),
    );
    expect(view.length).toBeGreaterThan(0);
    expect(view).not.toContain('blocks');
  });

  it('exposes the block set as a set, not as rows', () => {
    const safety = read('src/api/safety.ts');
    expect(safety).toContain('export function useBlockedPeerIds(): ReadonlySet<string>');
    // `useBlocks` is the private implementation. Exporting `Block[]` invites a
    // caller to read `blocker_id` and assume the list is symmetric; RLS returns
    // only rows where the caller is the blocker, so it never has been.
    expect(safety).not.toContain('export function useBlocks');
  });
});

describe('the redesign holds its own invariants', () => {
  it('keeps closed-test builds capturable while production remains secure', () => {
    // FLAG_SECURE covers screenshots, screen recording and the app-switcher
    // thumbnail together. Blocking only screenshots bans nothing.
    const activity = read('android/app/src/main/java/com/companionchat/MainActivity.kt');
    expect(activity).toContain('WindowManager.LayoutParams.FLAG_SECURE');
    expect(activity).toContain('if (BuildConfig.BLOCK_SCREENSHOTS)');
    // Not gated on DEBUG: the build type expresses the distribution contract.
    expect(activity).not.toContain('if (!BuildConfig.DEBUG)');

    const gradle = read('android/app/build.gradle');
    const release = gradle.slice(gradle.indexOf('release {'), gradle.indexOf('closedTest {'));
    expect(release).toContain('buildConfigField "boolean", "BLOCK_SCREENSHOTS", "true"');
    const closed = gradle.slice(gradle.indexOf('closedTest {'), gradle.indexOf('internal {'));
    expect(closed).toContain('buildConfigField "boolean", "BLOCK_SCREENSHOTS", "false"');
    const internal = gradle.slice(gradle.indexOf('internal {'));
    expect(internal).toContain('buildConfigField "boolean", "BLOCK_SCREENSHOTS", "false"');
  });

  it('renders the peer profile image before the first bubble in a group', () => {
    const turn = read('src/components/Turn.tsx');
    const chat = read('src/screens/ChatScreen.tsx');
    expect(turn).toContain('avatarUri?: string | null');
    expect(turn).toContain('<Avatar initial={initial} uri={avatarUri} size={26}');
    expect(chat).toContain('avatarUri={avatarUrl}');
  });

  it('routes the back gesture through the parent map rather than branching inline', () => {
    const app = read('App.tsx');
    expect(app).toContain("BackHandler.addEventListener('hardwareBackPress'");
    expect(app).toContain('memberParent(route)');
    expect(app).toContain('providerParent(providerRoute)');
    // The Recharge overlay closes before a screen pops: it sits above everything
    // (zIndex 20) and is what the user most recently opened. Settings used to be a
    // sheet that closed here too; it is a mounted route now and pops through the
    // parent map like every other screen.
    const handler = app.slice(app.indexOf('const onBack ='), app.indexOf('BackHandler.addEventListener'));
    expect(handler.indexOf('closeWallet()')).toBeLessThan(handler.indexOf('closeRefill()'));
    expect(handler.indexOf('closeRefill()')).toBeLessThan(handler.indexOf('memberParent'));
    expect(app).toContain("openChat(id, 'chatsList')");
    expect(app).toContain('from === \'chatsList\'');
  });

  it('opens a Paper menu from a long-press on a conversation', () => {
    expect(read('src/screens/HomeScreen.tsx')).toContain('measureInWindow');
    expect(read('src/components/PaperMenu.tsx')).toContain('anchor');
    expect(read('src/screens/ChatsListScreen.tsx')).toContain('surface="list"');
    expect(read('src/components/ConversationMenu.tsx')).toContain('Remove from Home');
    expect(read('src/components/PaperMenu.tsx')).toContain('m3.material.io/components/menus');
  });

  // Retired with InboxScreen.tsx: v13 HomeScreen has no typed search field and
  // therefore no debounced query to assert on.

  // Retired with InboxScreen.tsx: v13 HomeScreen uses a ScrollView (not a FlatList
  // with a header-mounted search field), so the empty-state/search-header interaction
  // has no v13 equivalent.

  it('stops recording when the app reaches the background', () => {
    // Android may transiently report inactive while a system permission surface
    // owns focus. Only background means the app actually left the foreground.
    const composer = read('src/components/Composer.tsx');
    expect(composer).toContain("AppState.addEventListener('change'");
    expect(composer).toContain("next === 'background'");
  });

  // Retired with InboxScreen.tsx: v13 HomeScreen has no typed search; the provider
  // directory is browsed via the Explore section rather than a search field.

  it('puts Explore rows on the page with an inset hairline, not in cards', () => {
    // Narrowed to ProviderRow. It used to cover the inbox too, and the inbox is
    // now deliberately the other idiom: see the bubble assertions below. The rule
    // still holds everywhere it used to except that one screen.
    const source = read('src/components/ProviderRow.tsx');
    expect(source).toContain('ROW_SEPARATOR_INSET');
    expect(source).toContain('StyleSheet.hairlineWidth');
    // The three properties that made a row a card.
    expect(source).not.toContain('TOKENS.elevation.card');
    expect(source).not.toContain('bg.raised');
  });

  it('draws Chats as bubbles with no separators at all', () => {
    // The other half of the split, asserted so the two idioms stay deliberate
    // rather than drifting back together. A bubble list separates by gap; adding
    // a hairline as well is what made an earlier version read as rows wearing
    // rounded corners.
    const bubble = read('src/components/ThreadBubble.tsx');
    expect(bubble).toContain('TOKENS.radius.thread');
    expect(bubble).toContain('borderCurve');
    expect(bubble).not.toContain('hairlineWidth');
    expect(bubble).not.toContain('ROW_SEPARATOR_INSET');
    // Retired with InboxScreen.tsx: v13 HomeScreen renders the CHATS section as a
    // horizontal avatar rail (RailItem), not a ThreadBubble list.
  });

  it('never fills a bubble with bg/raised, which is invisible in light mode', () => {
    /*
     * The single most repeated bug in this codebase's history, asserted rather
     * than remembered. `bg/raised` is #FFFFFF in light mode and so is `bg/base`,
     * so a bubble filled with it vanishes into the page and is held together by
     * nothing. It has already shipped once, on the incoming message bubble.
     */
    for (const file of ['src/components/ThreadBubble.tsx', 'src/components/Turn.tsx']) {
      expect(read(file)).not.toContain('bg.raised');
    }
    expect(read('src/components/ThreadBubble.tsx')).toContain('bg.sunken');
  });

  it('keeps the message bubble radius in the tokens and concentric with its media', () => {
    /*
     * The reason 18 became 22, asserted so the two numbers cannot drift apart.
     *
     * A picture inside a bubble reads as pasted on rather than contained unless
     * its corner is concentric with the bubble's, which means
     * `inner = outer - inset`. At a 3dp inset that is a 19dp image corner, and
     * 19 inside 18 bulges past the curve it is meant to sit within.
     *
     * The media bubble consumes this since 014: `messages.attachment_path` points
     * into the private `attachments` bucket and `MediaBubble` in Turn.tsx renders
     * the photo at `mediaInnerRadius()`. The manifest still removes
     * READ_MEDIA_IMAGES on purpose, because the system Photo Picker needs no
     * permission. The geometry that justified the radius change is the geometry
     * the photo now uses.
     */
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain('TOKENS.radius.bubble');
    expect(turn).not.toMatch(/BUBBLE_RADIUS = \d/);
    expect(TOKENS.radius.bubble).toBe(22);
    expect(TOKENS.radius.bubble - 3).toBe(19);
    // The consumer exists now: the media bubble reads the attachment at the
    // concentric inner radius.
    expect(turn).toContain('mediaInnerRadius');
  });

  it('never puts a neutral avatar on a surface its own fill matches', () => {
    /*
     * The same bug one layer in, and it shipped: an Avatar's neutral wash is
     * `bg/sunken`, the thread bubble is also `bg/sunken`, so the disc vanished and
     * left a bare initial floating in the row. Seen on the emulator; every gate
     * was green.
     *
     * Asserted as a seam rather than as a colour: the bubble must tell the avatar
     * what it is sitting on, and the avatar must branch on it. Either half missing
     * brings the bug back.
     */
    expect(read('src/components/ThreadBubble.tsx')).toContain('surface="sunken"');
    const avatar = read('src/components/Avatar.tsx');
    expect(avatar).toContain("surface === 'sunken'");
    expect(avatar).toContain('bg.base');
  });
});

/**
 * Phone verification, which is not phone sign-in. The session already exists;
 * this only attaches a number to it. That is why it can ship while phone login
 * still waits on a DLT template.
 */
describe('the busy button does not move', () => {
  it('reserves the spinner slot whether busy or not', () => {
    // The jump this exists to prevent: mounting the spinner only while busy
    // shifts the label sideways on the frame the request starts.
    const button = read('src/components/Button.tsx');
    expect(button).toContain('styles.spinnerSlot');
    // Two uses, leading and trailing, so the label stays optically centred.
    expect(button.match(/styles\.spinnerSlot/g)).toHaveLength(2);
    // Slot width is SPINNER_SIZE + a small gap, mirrored on the trailing side.
    expect(button).toContain("width: SPINNER_SIZE + TOKENS.space['2xs']");
  });

  it('uses the shared native M3 LoadingIndicator', () => {
    const button = read('src/components/Button.tsx');
    expect(button).toContain("import { LoadingIndicator } from './LoadingIndicator'");
    // RN's ActivityIndicator is not MDC's Material 3 Views implementation.
    expect(button).not.toMatch(/<ActivityIndicator|ActivityIndicator[,}]|ActivityIndicator\s*from/);
  });

  it('renders MDC native Views instead of hand-drawn React Native geometry', () => {
    const indicator = read('src/components/LoadingIndicator.tsx');
    const android = read(
      'android/app/src/main/java/com/companionchat/MaterialIndicatorPackage.kt',
    );
    expect(indicator).toContain("requireNativeComponent<NativeIndicatorProps>('PappalMaterialLoadingIndicator')");
    expect(indicator).toContain("requireNativeComponent<NativeIndicatorProps>('PappalMaterialCircularProgress')");
    expect(android).toContain('com.google.android.material.loadingindicator.LoadingIndicator');
    expect(android).toContain('com.google.android.material.progressindicator.CircularProgressIndicator');
    expect(android).toContain('isIndeterminate = true');
    // No border/SVG imitation remains in JavaScript.
    expect(indicator).not.toContain('borderTopColor');
    expect(indicator).not.toContain('withRepeat');
    expect(indicator).not.toContain('react-native-svg');
  });

  it('switches every unknown wait to circular progress at the M3 boundary', () => {
    const indicator = read('src/components/LoadingIndicator.tsx');
    expect(indicator).toContain('export const LONG_WAIT_MS = 5000');
    expect(indicator).toContain("variant = 'auto'");
    expect(indicator).toContain('setTimeout(() => setLongWait(true), LONG_WAIT_MS)');
    expect(indicator).toContain("variant === 'auto' && longWait");
  });

  it('moves the calling dots as a clipped conveyor, not a pulse in place', () => {
    // Measured off the reference capture at 60fps (2026-08-31), not eyeballed.
    // The first version of this component read the reference as "dots fill in
    // sequence" and implemented three fixed dots on a staggered opacity wave.
    // Frame-stepping the file disproved that: each run MOVES right ~1.4px per
    // frame — f105 (23,24)(38,48) → f115 (30,39)(56,61) → f120 resets — so the
    // dots translate and are clipped, and a stationary opacity pulse is the
    // wrong animation however similar it looks in a still.
    const dots = read('src/components/CallingDots.tsx');
    // Position, not opacity: the whole row rides one translateX.
    expect(dots).toContain('translateX: x.value');
    expect(dots).not.toMatch(/opacity:\s*o\.value/);
    // Clipped window is what turns travel into "enters and exits".
    expect(dots).toContain("overflow: 'hidden'");
    // Constant velocity: an ease would pump once per cycle.
    expect(dots).toContain('Easing.linear');
    // One pitch of travel on a periodic row is what makes the wrap invisible.
    expect(dots).toContain('withTiming(PITCH');
    expect(dots).toMatch(/marginLeft:\s*-PITCH/);
    // Cadence stays a token (250ms measured, base is 240ms).
    expect(dots).toContain('DURATION.base');
    expect(dots).not.toMatch(/duration:\s*\d/);
    // Looping movement must be stoppable by the OS setting.
    expect(dots).toContain('useReducedMotion()');
    expect(dots).toMatch(/if \(reduce\) \{/);
  });
});

describe('the rename to Pappal', () => {
  it('renames the launcher label and nothing structural', () => {
    // The distinction ADR-0015 exists to protect. A user reads the label; a user
    // never reads an applicationId, and that id is what Play, Firebase, the
    // upload keystore and the OAuth redirect are all keyed to.
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(
      '<string name="app_name">Pappal</string>',
    );
    expect(read('android/app/build.gradle')).toContain('com.companionchat');
  });

  it('keeps the RN registration key matching on both sides', () => {
    // `name` is an internal registration key, not a name. If it drifts from
    // AppRegistry or getMainComponentName the app boots to a red screen saying
    // the component is not registered, which reads like a bundling failure.
    const app = JSON.parse(read('app.json')) as { name: string; displayName: string };
    expect(app.displayName).toBe('Pappal');
    expect(app.name).toBe('CompanionChat');
    expect(read('android/app/src/main/java/com/companionchat/MainActivity.kt')).toContain(
      `getMainComponentName(): String = "${app.name}"`,
    );
  });

  it('leaves the old name in the decision log', () => {
    // A decision log edited to look tidy afterwards is not a record. ADR-0008 and
    // ADR-0009 describe decisions taken when the product had the old name.
    expect(read('docs/adr/0008-versioning-and-why-not-ota-yet.md')).toContain('CompanionChat');
  });

  it('renames the public website', () => {
    for (const page of ['index', 'about', 'terms', 'privacy', 'delete']) {
      expect(read(`web/${page}.html`)).not.toContain('CompanionChat');
    }
  });
});

describe('phone verification', () => {
  it('never lets the client name the number it is verifying', () => {
    // The whole security argument of verify-phone: it asks MSG91 which number
    // the token belongs to. If the client sent the number, anyone could verify
    // one they hold and submit somebody else's, and the unique index in
    // migration 010 would let them squat on it.
    const api = read('src/api/phone.ts');
    const invoke = api.slice(api.indexOf("invoke('verify-phone'"));
    // From `body:` onward, deliberately: the function is *named* verify-phone,
    // so slicing from the call would match "phone" on the name itself.
    const start = invoke.indexOf('body:');
    const body = invoke.slice(start, invoke.indexOf('}', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('accessToken');
    expect(body).not.toContain('phone');
    expect(body).not.toContain('identifier');
    expect(body).not.toContain('e164');
  });

  it('does not disable the code field while it is checking', () => {
    // Disabling a focused TextInput blurs it, which moves focus to the next
    // control and closes the keyboard. That shipped on the sign-in screen once.
    const sheet = read('src/screens/PhoneVerifySheet.tsx');
    const start = sheet.indexOf('<CodeField');
    const field = sheet.slice(start, sheet.indexOf('/>', start));
    expect(field.length).toBeGreaterThan(0);
    expect(field).not.toContain('editable');
  });

  it('keeps a rejected OTP visible for one-digit correction', () => {
    const sheet = read('src/screens/PhoneVerifySheet.tsx');
    const errorEffect = sheet.slice(
      sheet.indexOf("if (error !== null && step === 'code')"),
      sheet.indexOf('}, [error, step])'),
    );
    expect(errorEffect).toContain('setErrorNonce');
    expect(errorEffect).not.toContain("setCode('')");
  });

  it('offers verification only in a build that can deliver it', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain('PHONE_VERIFY_ENABLED');
    expect(settings).toContain('widgetConfigured()');
    expect(settings).toContain('phone_verified_at === null');
  });

  it('keeps the entry point off while the server hop is unproven', () => {
    // The mirror of the PHONE_AUTH_ENABLED guard. verifyAccessToken has never
    // returned success, so a user could enter a correct code and have nothing
    // recorded. Flip the flag in the commit that fixes that, not before.
    const api = read('src/api/phone.ts');
    const flag = /export const PHONE_VERIFY_ENABLED = (true|false);/.exec(api)?.[1];
    expect(flag).toBe('false');
  });

  it('posts the authkey where the widget docs say it goes', () => {
    // MSG91's general API docs say header; the widget's own Server Side
    // Integration page says body, on control.msg91.com. The widget page wins for
    // this endpoint.
    const fn = read('supabase/functions/verify-phone/index.ts');
    expect(fn).toContain("'https://control.msg91.com/api/v5/widget/verifyAccessToken'");
    expect(fn).toContain("JSON.stringify({ authkey, 'access-token': accessToken })");
  });

  it('does not depend on the MSG91 React Native package', () => {
    // Its OTP path is the same three fetches this repo makes directly; what it
    // adds is an autolinked BiometricAuth module whose build.gradle pins
    // compileSdk 34 and asks for an unversioned com.facebook.react:react-native.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain(
      '@msg91comm/sendotp-react-native',
    );
  });
});

/**
 * The chat restyle and the iOS language pass, as source-level claims.
 *
 * Everything here is a wiring failure that typechecks: a divider on the wrong end
 * of an inverted list, a control that opens nothing, a reaction row with no RPC
 * behind it. None of it is visible to tsc, eslint or the contrast script, and the
 * repo's own record is that three UI bugs passed every gate and were only found on
 * a device, so the ones that CAN be asserted structurally are asserted here.
 */
describe('the composer cross-fades its trailing control', () => {
  const composer = read('src/components/Composer.tsx');
  it('swaps send and mic through useCrossfade, not a hard conditional mount', () => {
    // Both controls are mounted and stacked; the cross-fade decides which is
    // substantial, and pointerEvents give touches to the live one. A hard
    // `ready ? <SendButton/> : <mic/>` popped one in and out with no motion.
    expect(composer).toContain('const trailing = useCrossfade(ready);');
    expect(composer).toContain('trailing.shownStyle');
    expect(composer).toContain('trailing.hiddenStyle');
    expect(composer).toMatch(/pointerEvents=\{ready \? 'auto' : 'none'\}/);
    expect(composer).toMatch(/pointerEvents=\{ready \? 'none' : 'auto'\}/);
    expect(composer).not.toMatch(/\{ready \? \(\s*<SendButton/);
  });
});

describe('the chat restyle is wired, not just drawn', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  const chatCode = withoutComments(chat);

  it('renders a day divider per day instead of one hardcoded footer', () => {
    // The bug: `ListFooterComponent={<DayDivider label="Today" />}` on an
    // `inverted` list renders at the visual TOP of the transcript, so a single
    // divider reading 'Today' sat above the OLDEST message the client held,
    // whatever date that message was on.
    //
    // A ListFooterComponent exists again, but ONLY as the frosted-bar spacer that
    // reserves the overlay header's height at the list's visual top. Guard the
    // actual anti-pattern — a DayDivider living in the footer — not the API.
    expect(chatCode).not.toMatch(/ListFooterComponent=\{\s*\(\)\s*=>\s*<DayDivider/);
    expect(chatCode).not.toMatch(/DayDivider label=/);
    expect(chatCode).toContain('<DayDivider iso={message.created_at} />');
    // opensDay is now computed in a single post-sort pass over the merged
    // message+call list (so call rows also get dividers). The pass uses the
    // opensDay helper from datetime.ts, applied to each row's sortAt field.
    expect(chatCode).toContain("row.opensDay = opensDay(");
    // The pass must run AFTER the sort so mixed message/call neighbours are
    // compared correctly (not just adjacent messages).
    expect(chatCode).toContain('sorted.length');
  });

  it('takes clock format from the device rather than hardcoding 24 hours', () => {
    // `String(d.getHours()).padStart(2, '0')` is wrong on any iPhone with
    // Settings > General > Date & Time > 24-Hour Time off, which is the default in
    // most regions.
    expect(chatCode).not.toContain('getHours()');
    expect(chatCode).toContain('timeOfDay(message.created_at)');
  });

  it('sources the header identity from the thread, not the directory', () => {
    // `useProviders()` reads `provider_directory`, which contains providers. This
    // screen also serves the provider tree, where `providerId` is a MEMBER's id,
    // so every directory lookup missed and the header read 'Conversation' with a
    // blank avatar.
    expect(chatCode).toContain('t.peer_id === providerId');
    expect(chatCode).toContain('peerThread?.peer_display_name');
  });

  it('drops the derived socket presence the settled decision rejects', () => {
    // Realtime presence answers "is their app in the foreground", which is a
    // question nobody agreed to have answered about them. Presence is
    // user-controlled: `peer_available` is the provider's own toggle and
    // `peer_last_active_at` is null unless they turned presence on.
    // Comments stripped: the note explaining what the header no longer claims
    // names the selector it stopped reading, so a negative assertion over the raw
    // source fails on its own documentation.
    expect(chatCode).not.toContain('selectPeerOnline');
    expect(chatCode).toContain('peer_last_active_at');
  });

  it('wires swipe-to-reply and on-bubble reactions on both sides', () => {
    expect(chatCode).toContain('onSwipeReply={swipeReply}');
    expect(chatCode).toContain('onReact={reactOnMessage}');
    expect(chatCode).toContain('onReportMessage={reportMessage}');
    expect(chatCode).toContain('timeOfDay(message.created_at)');
    expect(chatCode).not.toContain('last ? timeOfDay');
    expect(chatCode).toContain('mine,');
  });

  it('opens the safety sheet from the strip without stacking a second Modal', () => {
    const report = chatCode.slice(
      chatCode.indexOf('const reportMessage'),
      chatCode.indexOf('const renderItem'),
    );
    expect(report).toContain('setSafety({ open: true, messageId })');
    expect(chatCode).not.toContain('<MessageActionsSheet');
  });

  it('shows the typing indicator in the empty thread too', () => {
    // The empty branch REPLACES the FlatList, so PeerTyping was unmounted in
    // exactly the case it is most wanted: a new peer typing the first message.
    const empty = chatCode.slice(chatCode.indexOf('styles.starters'));
    expect(empty).toContain('<PeerTyping');
  });

  it('does not double the safe-area inset under a raised keyboard', () => {
    // RN's iOS KeyboardAvoidingView derives its padding from the keyboard frame,
    // which already reaches the bottom of the screen, so adding insets.bottom on
    // top floated the composer ~34pt above the keyboard on a notched iPhone.
    expect(chatCode).toContain('keyboardUp ? 0 : insets.bottom');
  });

  it('holds an explicit FlashList ref and scrolls to offset 0 on new messages', () => {
    // Without a ref, there is no way to scroll programmatically. Without the
    // useEffect watching rows.length, a new incoming message while the user is
    // scrolled up reading history goes unnoticed and they miss it.
    expect(chatCode).toContain('listRef');
    expect(chatCode).toContain('ref={listRef}');
    expect(chatCode).toContain('scrollToOffset({ offset: 0');
    // The effect must watch `rows` so it fires for both local and remote messages.
    expect(chatCode).toContain('prevRowsLen');
  });

  it('shows receipt inside every settled outgoing bubble, not only newest', () => {
    // The old code gated receipt on `showReceipt` (only the last own message).
    // Now every non-pending outgoing row carries a tick: single for sent, double
    // for read, matching WhatsApp semantics. Pending rows carry undefined.
    const turnSrc = read('src/components/Turn.tsx');
    // Receipt is rendered inside the bubble (MetaRow), not in a detached row.
    expect(turnSrc).toContain('metaRow');
    expect(turnSrc).not.toContain('receiptRow');
    // Pending rows suppress the tick; settled rows show it.
    expect(turnSrc).toContain("pending ? undefined : receipt");
    // ChatScreen no longer uses showReceipt to gate the prop.
    expect(chatCode).not.toContain('showReceipt');
  });

  it('carries receipt ticks into the photo overlay too', () => {
    // A photo bubble in an outgoing turn shows its timestamp + tick in the
    // mediaTime overlay, same semantics as a text bubble.
    const turnSrc = read('src/components/Turn.tsx');
    expect(turnSrc).toContain('mediaMetaRow');
  });
});

describe('reactions and replies reach a real server call', () => {
  it('toggles a reaction through the RPC, not a client insert', () => {
    // `message_reactions` has a SELECT policy and nothing else, deliberately: a
    // reaction is contact and has to be gated on blocking, and `is_blocked_pair`
    // is not callable by a client so an RLS policy cannot consult it.
    const api = read('src/api/reactions.ts');
    expect(api).toContain("supabase.rpc('toggle_reaction'");
    expect(withoutComments(api)).not.toMatch(/from\('message_reactions'\)\s*\.\s*insert/);
  });

  it('sends a reply through send_message rather than a second path', () => {
    const chatApi = read('src/api/chat.ts');
    expect(chatApi).toContain('p_reply_to_id: replyToId');
    // The optimistic row carries it too, or a reply appears as a plain bubble and
    // then grows a quote when the server confirms.
    expect(chatApi).toContain('reply_to_id: replyToId');
  });

  it('keeps the emoji set identical to the CHECK constraint', () => {
    // The one cross-language literal types cannot catch: a bare U+2764 instead of
    // U+2764 U+FE0F renders identically in most editors and comes back
    // BAD_REQUEST from every call.
    const sql = read('supabase/migrations/011_reactions_replies_voice_calls.sql');
    const types = read('src/lib/database.types.ts');
    const union = /export type ReactionEmoji =([^;]+);/.exec(types)?.[1] ?? '';
    const emoji = [...union.matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(emoji).toHaveLength(6);
    for (const e of emoji) {
      expect(sql).toContain(e);
      expect(read('src/lib/reactions.ts')).toContain(e);
    }
  });

  it('offers no reaction the sheet cannot send', () => {
    // The reference has a trailing `+` and there is no picker behind it. A `+`
    // that opens nothing is worse than no `+`, and a `+` that opened a keyboard
    // would be the thing the closed emoji set exists to prevent.
    const strip = withoutComments(read('src/components/ReactionStrip.tsx'));
    expect(strip).toContain('REACTION_CHOICES.map');
    expect(strip).not.toMatch(/glyph="plus"/);
  });

  it('keeps Copy, Forward and Delete out of the long-press strip', () => {
    // Copy and Forward defeat the FLAG_SECURE screenshot blocking; Delete
    // destroys abuse evidence, which `submit_report`'s snapshot exists to keep.
    const strip = withoutComments(read('src/components/ReactionStrip.tsx'));
    for (const banned of ['Copy', 'Forward', 'Delete']) {
      expect(strip).not.toContain(`>${banned}`);
    }
  });
});

/**
 * Voice notes, end to end.
 *
 * Most of what can go wrong here is invisible to types and to runtime: an upload
 * that throws before a byte leaves the device, a cap that disagrees with a CHECK
 * constraint, a recorder left running after the screen closed. Each assertion
 * below pins one of those.
 */
describe('voice notes are recorded, uploaded and sent through the one send path', () => {
  const recorder = read('src/lib/recorder.ts');
  const api = read('src/api/voice.ts');
  const composer = read('src/components/Composer.tsx');

  it('sends through send_message rather than inserting a row', () => {
    // The RPC debits the token and writes the row in one transaction. A client
    // insert would need an INSERT policy on `messages`, which deliberately does
    // not exist, and would put a second pricing path next to the first.
    expect(api).toContain("supabase.rpc('send_message'");
    expect(api).toContain('p_voice_path: path');
    expect(api).toContain('p_voice_duration_ms: draft.durationMs');
    expect(withoutComments(api)).not.toMatch(/from\('messages'\)\s*\.\s*insert/);
  });

  it('uploads before it inserts, so the row can never point at nothing', () => {
    // `voice_path` is not client-writable after the fact: 011 guards it in
    // `guard_message_reply_and_voice`. So the row is written once and has to
    // reference audio that already exists.
    const body = withoutComments(api);
    expect(body.indexOf('uploadRecording')).toBeLessThan(
      body.indexOf("supabase.rpc('send_message'"),
    );
  });

  it('does not reach for storage-js upload, which throws in React Native', () => {
    // storage-js's FormData branch calls `body.has('cacheControl')` and RN's
    // FormData implements only append, getAll and getParts. Asserted over the
    // source with comments stripped, so the comment explaining the trap cannot
    // be what satisfies the test.
    expect(withoutComments(api)).not.toMatch(/storage\s*\.\s*from\([^)]*\)\s*\.\s*upload\(/);
    expect(api).toContain('/storage/v1/object/');
  });

  it('never upserts, because the bucket has no UPDATE policy', () => {
    // A sender who could replace the audio under a note that has been read or
    // reported would make the recording worthless as evidence. A retry mints a
    // new key instead.
    expect(withoutComments(api)).not.toContain('x-upsert');
  });

  it('signs a playback URL per tap rather than per render', () => {
    // One signed credential per note on screen, whether or not anybody listens,
    // is a lifetime nobody asked for.
    expect(api).toContain('createSignedUrl(path');
    expect(api).toContain('SIGNED_URL_TTL_SECONDS');
  });

  it('confines the microphone to one module', () => {
    // The narrower protection that replaced RECORD_AUDIO being forbidden in
    // verify-manifest.mjs. If a second file starts recording, that gate no longer
    // has anything to say about it and this does.
    const users = ['src/lib', 'src/api', 'src/components', 'src/screens', 'src/store']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
          .map(f => ({ file: `${dir}/${f}`, body: read(`${dir}/${f}`) })),
      )
      .filter(s => s.body.includes("from 'react-native-nitro-sound'"))
      .map(s => s.file);
    expect(users).toEqual(['src/lib/recorder.ts']);
  });

  it('asks for the microphone with core RN, not a permissions dependency', () => {
    expect(recorder).toContain('PermissionsAndroid.PERMISSIONS.RECORD_AUDIO');
    expect(JSON.parse(read('package.json')).dependencies).not.toHaveProperty(
      'react-native-permissions',
    );
  });

  it('reuses one output path instead of accumulating recordings on disk', () => {
    // With no `uri` argument the recorder invents a new file per recording in the
    // app's private directory and nothing ever deletes it. The app has no
    // filesystem module, and adding one to call unlink would be a native
    // dependency bought for one line.
    expect(recorder).toContain("'voice.outPath'");
    expect(recorder).toContain('storage.get(OUT_PATH_KEY)');
    expect(recorder).toContain('storage.set(OUT_PATH_KEY, file)');
  });

  it('stops the recorder when the composer goes away', () => {
    // A recorder left running with nothing listening is both a privacy claim this
    // app should not have to make and the state that leaves the next
    // startRecorder fighting a live one.
    expect(composer).toContain('handle.current?.cancel()');
  });

  it('stops playback when the transcript unmounts', () => {
    // One native player: audio started in a thread you have left keeps playing
    // over the next screen, and the row that started it is gone.
    expect(api).toContain('stopPlayback()');
    expect(read('src/screens/ChatScreen.tsx')).toContain('useVoicePlayer()');
  });

  it('holds a finished recording instead of sending it at the cap', () => {
    // Auto-sending at three minutes sends a sentence that was cut off mid-word.
    expect(composer).toContain("setMode('review')");
    expect(composer).toContain('onLimit');
  });

  it('resolves the provider side of a thread without open_conversation', () => {
    // `open_conversation` takes a provider id and raises `not an admitted
    // provider` for anything else, and the provider tree renders this screen with
    // a *member's* id. So on that side the id never resolved, the transcript never
    // loaded and the composer stayed disabled: a recorder shipped to both roles
    // and reachable by one. The summary row already carries the id.
    // The id comes from the cached thread whenever it is known (either side), and
    // open_conversation is called ONLY to create a conversation that does not
    // exist yet. A provider always has a known thread, so it never calls the RPC;
    // and a member reopening a chat skips the extra round-trip too.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('const needsOpen = knownThread === undefined');
    expect(chat).toContain('useConversationId(needsOpen ? providerId : null)');
    expect(chat).toContain('knownThread?.conversation_id ?? openedId');
  });

  it('gives both roles the recorder', () => {
    // The provider tree renders this same screen (App.tsx mounts ChatScreen for
    // both), so one composer covers both sides. Voice notes being in scope for
    // providers is a settled decision, and a role check here would quietly
    // reverse it.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('onSendVoice={onSendVoice}');
    expect(chat).not.toMatch(/i_am_member[\s\S]{0,40}onSendVoice/);
  });

  it('previews a voice note in the inbox without inventing a body column', () => {
    // Ephemeral inbox rows expose a kind label without any message body.
    // InboxScreen.tsx dropped: v13 HomeScreen shows a horizontal avatar rail with no
    // thread-preview body, so last_kind is not read there.
    for (const screen of ['src/screens/ProviderHomeScreen.tsx']) {
      expect(read(screen)).toContain("last_preview_kind === 'voice'");
    }
  });

  it('keeps a voice note reportable', () => {
    // `submit_report` snapshots `voice_path` beside `evidence_body`, which is the
    // only reason "he sent me something vile" is actionable when it was spoken
    // rather than typed. The client half is that a voice bubble still long-presses.
    expect(read('supabase/migrations/011_reactions_replies_voice_calls.sql')).toContain(
      'evidence_voice_path',
    );
    expect(read('src/components/Turn.tsx')).toContain('Gesture.LongPress()');
    expect(read('src/components/Turn.tsx')).toContain('onReportMessage');
    expect(read('scripts/moderate.mjs')).toContain('evidence_voice_path');
  });

  it('tracks a send under a name the event guard allows', () => {
    // `guard_event_shape` rejects any prop key matching /message/, so the obvious
    // `{ message_id }` would be refused at insert with nobody watching.
    expect(api).toContain("track('voice_note_sent'");
    expect(api).toMatch(/track\('voice_note_sent', \{ secs:/);
    expect(api).not.toMatch(/track\([^)]*message_id/);
  });

  it('says in the privacy page and the listing what it now collects', () => {
    // The manifest line and these two documents have to move together: a build
    // declaring RECORD_AUDIO against a policy page that says no microphone is a
    // data-safety mismatch, not a cosmetic gap.
    const privacy = read('web/privacy.html');
    expect(privacy).not.toContain('No contacts, location, photos, microphone or camera.');
    expect(privacy).toMatch(/voice note/i);
    const listing = read('docs/play/listing.md');
    expect(listing).not.toContain('The app requests three Android permissions in total');
    expect(listing).toMatch(/\|\s*Audio \(voice notes\)\s*\|/);
    // And audio is no longer on the "not collected" line it used to sit on.
    expect(listing).not.toMatch(/photos or videos, audio, files/);
  });
});

describe('calling ships visible and on, wired to a real media layer', () => {
  it('is enabled now that the WebRTC client landed', () => {
    // Migration 011 shipped start_call, the per-minute meter and the blocking
    // gate; the client half (src/api/callSession.ts: RTCPeerConnection + Realtime
    // signalling) now exists too, so start_call no longer rings a phone that can
    // never connect. Flipped in the same commit that landed the media path, which
    // is the only thing the flag's contract says earns the flip.
    //
    // CALLS_ENABLED is now defined in src/config.ts (the single flag home);
    // src/api/calls.ts re-exports it so all existing import sites are unchanged.
    const appConfig = read('src/config.ts');
    const flag = /export const CALLS_ENABLED = (true|false);/.exec(appConfig)?.[1];
    expect(flag).toBe('true');
  });

  it('gates the two call buttons rather than hiding them, as real controls', () => {
    // The Android conformance audit (2026-08-26) flagged the previous approach:
    // a <View> with accessibilityRole="button" and no handler is a role that
    // never fires — TalkBack announces a button that does nothing, and stays a
    // no-op even when the flag flips. They are Pressables now: disabled while
    // CALLS_ENABLED is false (an honest gate), and wired to start a call when on.
    const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
    expect(chat).toContain('CALLS_ENABLED');
    expect(chat).toContain('testID="call-video"');
    expect(chat).toContain('testID="call-voice"');
    // Voice and video combine the compile-time master flag with independent
    // live controls. A live or pending paid session must end before changing
    // channels, because one conversation has one paid session at a time.
    expect(chat).toContain('voiceCallsEnabled');
    expect(chat).toContain('videoCallsEnabled');
    expect(chat).toMatch(
      /!videoCallsEnabled\s*\|\|\s*activeSession !== null\s*\|\|\s*pendingRequest !== null/,
    );
    expect(chat).toMatch(
      /!voiceCallsEnabled\s*\|\|\s*activeSession !== null\s*\|\|\s*pendingRequest !== null/,
    );
    // Real, and ready for the flag flip: the tap starts a call.
    expect(chat).toContain("onStartCall?.('video')");
    expect(chat).toContain("onStartCall?.('audio')");
  });

  it('keeps the token counter in the chat header', () => {
    // Not negotiable independently of the header layout:
    // .maestro/03-token-economy.yaml taps into this screen and asserts the
    // seeded balance remains 3 across a pending send. The contract test elsewhere only greps the testID
    // across all of src, so removing it from HERE would keep jest green and break
    // the only gate that would notice.
    expect(read('src/screens/ChatScreen.tsx')).toContain('<TokenCounter');
  });
});

describe('paid chat sessions expose their live lifecycle', () => {
  const chat = read('src/screens/ChatScreen.tsx');

  it('renders a clock from the authoritative server start time', () => {
    expect(chat).toContain("activeSession?.status === 'active'");
    expect(chat).toContain('activeSession.started_at');
    expect(chat).toContain('Date.parse(sessionStartedAt)');
    expect(chat).toContain('testID="chat-session-timer"');
  });

  it('confirms before back ends a live paid session', () => {
    expect(chat).toContain('title="End session and leave?"');
    expect(chat).toContain('testID="chat-leave-dialog"');
    expect(chat).toContain("reason: 'manual'");
    expect(chat).toContain(
      "BackHandler.addEventListener('hardwareBackPress'",
    );
    expect(chat).toContain('onPress={requestLeave}');
  });

  it('surfaces inactivity warning and grace states from the server', () => {
    expect(chat).toContain("activeSession?.status === 'warning'");
    expect(chat).toContain("activeSession?.status === 'grace'");
  });

  it('gates the visible timer on a live provider message, not an automated opener', () => {
    // Migration 045: an automated opener (origin 'automated_opener', session_id
    // null) must never start the clock. The timer shows only once the session's
    // provider has sent a LIVE message for THIS session, on top of the server's
    // authoritative started_at.
    const stripped = withoutComments(chat);
    expect(stripped).toContain('hasLiveProviderMessage');
    expect(stripped).toContain("m.origin === 'live'");
    expect(stripped).toContain('m.sender_id === activeSession.provider_id');
    expect(stripped).toContain('m.session_id === activeSession.id');
    // The gate is ANDed into the timer's start-time selection.
    expect(stripped).toMatch(/hasLiveProviderMessage\s*\n?\s*\?\s*activeSession\.started_at/);
  });
});

describe('the chat seeds openers one at a time, not all at once', () => {
  const chat = read('src/screens/ChatScreen.tsx');
  const stripped = withoutComments(chat);

  it('drives the sequential opener RPC, not the batch seed', () => {
    // Migration 045 replaced the all-at-once seed with a cancellable sequential
    // orchestrator: peer typing, a bounded length-aware beat, one opener, fetch,
    // pause, repeat. The batch RPC must be gone from this screen.
    expect(stripped).toContain("supabase.rpc('insert_next_opener'");
    expect(stripped).not.toContain("supabase.rpc('seed_conversation_openers'");
  });

  it('shows the peer typing and paces the openers', () => {
    expect(stripped).toContain('setPeerTyping(true)');
    expect(stripped).toContain('setPeerTyping(false)');
    // Bounded, length-aware pacing constants.
    expect(stripped).toContain('OPENER_TYPING_MIN_MS');
    expect(stripped).toContain('OPENER_TYPING_MAX_MS');
    expect(stripped).toContain('OPENER_MS_PER_CHAR');
    expect(stripped).toContain('OPENER_PAUSE_MS');
  });

  it('is cancellable and refetches after each step', () => {
    // A cancellation latch guards navigation/remount; each step invalidates the
    // transcript and the inbox so the inserted opener appears.
    expect(stripped).toContain('cancelled = true');
    expect(stripped).toMatch(/queryKey: \['messages'/);
    expect(stripped).toMatch(/queryKey: \['conversation-list'\]/);
  });
});

describe('migration 045 closes the retention gaps found in review', () => {
  const m045 = read(
    'supabase/migrations/045_message_origin_and_hidden_retention.sql',
  );

  describe('legacy openers are reclassified, not left to start the clock', () => {
    it('backfills the three exact migration 040 opener bodies', () => {
      // 040's seed wrote these verbatim before origin existed. Matching is by
      // exact copy because a pre-migration row's origin is otherwise
      // unrecoverable; the strings are a frozen historical constant.
      expect(m045).toContain("'Hey — glad you''re here.'");
      expect(m045).toContain("'How are you doing right now?'");
      expect(m045).toContain("'I''m here to listen. No rush.'");
    });

    it('touches only provider-sent, sessionless rows still marked live', () => {
      expect(m045).toMatch(/set\s+origin = 'automated_opener'/);
      expect(m045).toContain('m.sender_id = c.provider_id');
      expect(m045).toContain('m.session_id is null');
      // Re-run is a no-op: only rows still at the 'live' default are rewritten.
      expect(m045).toContain("m.origin = 'live'");
    });

    it('requires the whole known sequence before reclassifying a conversation', () => {
      // Someone who merely typed one of those sentences must not be
      // reclassified; only a conversation carrying all three exact bodies (as
      // the provider, sessionless) qualifies.
      expect(m045).toMatch(/having count\(distinct mm\.body\) = 3/);
    });
  });

  describe('the security-definer reaction path respects the hide', () => {
    it('re-creates toggle_reaction and reads a hidden message as NOT_FOUND', () => {
      // toggle_reaction is SECURITY DEFINER, so RLS does not hide the row from
      // it; the explicit hidden_at check is the only thing that closes the leak.
      const body = plpgsqlBody(m045, 'toggle_reaction');
      expect(body).toContain('m.hidden_at');
      expect(body).toMatch(/v_hidden is not null/);
      expect(body).toContain("'error', 'NOT_FOUND'");
    });

    it('preserves the original grant', () => {
      expect(m045).toContain(
        'grant execute on function public.toggle_reaction(uuid, text) to authenticated',
      );
    });
  });

  describe('media reads follow message visibility, not just the path', () => {
    it('rebinds both participant-read policies to a non-hidden message row', () => {
      // voice-notes (011) and attachments (014): a SELECT now needs an
      // associated messages row with hidden_at is null, not just the
      // conversation prefix a participant could have kept.
      expect(m045).toContain('"Participants read voice notes"');
      expect(m045).toContain('"Participants read attachments"');
      expect(m045).toContain('m.voice_path = storage.objects.name');
      expect(m045).toContain('m.attachment_path = storage.objects.name');
      expect(m045).toMatch(/m\.hidden_at is null/);
    });

    it('leaves the upload policies untouched', () => {
      // An upload precedes its message row; gating it on one would break the
      // composer. Only the read policies are replaced.
      expect(m045).not.toContain('"Participants upload voice notes"');
      expect(m045).not.toContain('"Participants upload attachments"');
    });
  });
});

describe('the app speaks one date language', () => {
  it('has no second ago() implementation left', () => {
    // There were two, divergent: the inbox returned now/12m/3h/2d/5w and the
    // provider list reimplemented the idea from minutes with no weeks bucket, so
    // a month-old thread read as '31d'.
    // InboxScreen.tsx dropped: v13 HomeScreen renders no timestamps (avatar rail only),
    // so it is out of scope for the listStamp / ago() consolidation check.
    for (const file of [
      'src/screens/ProviderHomeScreen.tsx',
    ]) {
      const source = withoutComments(read(file));
      expect(source).not.toMatch(/function ago\(/);
      expect(source).toContain('listStamp(');
    }
  });

  it('never formats a date with a bare toLocaleDateString', () => {
    // Hermes ships one locale, so `toLocaleDateString()` with no options gives
    // '8/22/2026' whatever the device's region.
    for (const dir of ['src/screens', 'src/components']) {
      for (const file of readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.tsx'))) {
        expect(withoutComments(read(`${dir}/${file}`))).not.toMatch(
          /toLocaleDateString\(\)/,
        );
      }
    }
  });
});

describe('iOS list separators are drawn the way iOS draws them', () => {
  it('never draws one after the last row', () => {
    // An iOS plain list divides cells and never terminates with a line; a
    // trailing hairline reads as a list that got cut off.
    expect(withoutComments(read('src/components/ProviderRow.tsx'))).toContain(
      'isLast ? null : <View style={styles.separator} />',
    );
    // HomeScreen (the v13 successor to InboxScreen) has no separators at all now.
    // Asserted as an absence so the rule cannot be half-reintroduced there.
    expect(withoutComments(read('src/screens/HomeScreen.tsx'))).not.toContain(
      'styles.separator',
    );
  });

  it('lets the separator reach the trailing edge', () => {
    // The list's contentContainerStyle used to carry the horizontal padding, so
    // the hairline stopped 20pt short at BOTH ends and read as an underline on the
    // row rather than as a divider between two.
    // ProviderRow only. The inbox drew the same hairline until Chats became
    // bubbles, and a bubble list has no separator to inset.
    const source = read('src/components/ProviderRow.tsx');
    expect(source).toContain('TOKENS.space.md + ROW_SEPARATOR_INSET');
    expect(source).toContain('paddingHorizontal: TOKENS.space.md');
    // ...and the directory list (now HomeScreen's Explore section) stops fighting
    // the row's own hairline with a gap.
    expect(withoutComments(read('src/screens/HomeScreen.tsx'))).not.toContain(
      'gap: TOKENS.space.sm',
    );
  });

  it('gives the pick-a-person list a disclosure indicator', () => {
    // Tapping a directory row pushes a conversation, which is exactly where iOS
    // puts UITableViewCellAccessoryDisclosureIndicator. There was not one
    // anywhere in the app, and `chevron-right` was dead code.
    expect(read('src/components/ProviderRow.tsx')).toContain('name="chevronRight"');
  });
});

describe('no user-facing em dash and no leftover persona pronoun', () => {
  it('keeps the em dash out of every rendered string', () => {
    // House rule. Asserted on string literals only: the character is fine in a
    // comment, and most of the ones in this repo are.
    const files = ['src/screens', 'src/components'].flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `${dir}/${f}`, body: withoutComments(read(`${dir}/${f}`)) })),
    );
    for (const { file, body } of files) {
      const literals = [...body.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)].map(m => m[0]);
      for (const literal of literals) {
        // Escaped, not literal: a repo-wide punctuation sweep rewrote the
        // equivalent assertion in presence.test.ts into one that forbade commas.
        expect({ file, literal, dash: literal.includes('\u2014') }).toEqual({
          file,
          literal,
          dash: false,
        });
      }
    }
  });

  it('does not assume the provider is a woman', () => {
    // 'She’ll still be here when you top up.' was left over from the AI-persona
    // era that ADR-0001 pivoted away from. The product is human-to-human and a
    // provider is any gender. The interim RefillSheet became the v10 Recharge
    // screen (ADR-0019); the gender invariant follows the copy there.
    const refill = read('src/screens/RechargeScreen.tsx');
    expect(withoutComments(refill)).not.toMatch(/\bShe\b/);
  });
});

describe('provider identity comes from Cashfree, not a typed birth date', () => {
  const screen = withoutComments(read('src/screens/ProviderApplicationScreen.tsx'));

  it('no longer asks a provider to type a date of birth', () => {
    // DOB is fetched, verified, from the Cashfree 1-Click step (which writes it
    // via cashfree-onboarding-complete), so the applicant never types it. The old
    // DD/MM/YYYY field is gone.
    expect(screen).not.toContain('DD/MM/YYYY');
    expect(screen).not.toContain('formatDobInput');
  });

  it('verifies identity before collecting the profile', () => {
    expect(screen).toContain('useCashfreeVerification');
    expect(screen).toContain("phase === 'verify'");
  });

  it('keeps the 18+ age gate in SQL, off the verified DOB', () => {
    // The gate moved from a client arithmetic check to the auto-approve RPC, which
    // reads the Cashfree-written DOB. Wrong-by-a-day float math is gone entirely.
    const rpc = read('supabase/migrations/051_provider_auto_onboarding.sql');
    expect(rpc).toContain("interval '18 years'");
    expect(rpc).toContain('date_of_birth');
    expect(screen).not.toContain('365.25');
  });
});

describe('presence is declared, and PII is not client-writable', () => {
  const m012 = read('supabase/migrations/012_declared_presence_and_pii_guard.sql');

  it('adds a fourth guard rather than editing one of the three', () => {
    // 010 is the record of the alternative: extending
    // `guard_privileged_profile_columns` by reproducing the 003 body silently
    // deleted the five checks 005 and 006 had added, with no diff to show for it.
    // Postgres runs BEFORE UPDATE triggers in name order and each raises
    // independently, so additive guards compose and cannot regress.
    expect(m012).toContain('create or replace function public.guard_pii_columns()');
    expect(m012).toContain('create trigger guard_profile_pii_columns');
    for (const sibling of [
      'guard_privileged_profile_columns',
      'guard_phone_columns',
      'guard_presence_columns',
    ]) {
      expect(m012).not.toContain(`function public.${sibling}`);
    }
  });

  it('names every column it claims to guard', () => {
    // Asserted on the stripped body, so the comment explaining the guard is not
    // what satisfies the test.
    const body = plpgsqlBody(m012, 'guard_pii_columns');
    for (const column of ['date_of_birth', 'gender', 'headline']) {
      expect(body).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it('runs the guard as the caller, or its own condition can never be true', () => {
    // The subtle one, and 003 records it happening: under SECURITY DEFINER
    // `current_user` is the function owner, so `current_user in
    // ('authenticated','anon')` is false for every caller and the guard passes
    // everything while reading as a guard.
    const body = plpgsqlBody(m012, 'guard_pii_columns');
    expect(body).not.toMatch(/security definer/i);
    expect(body).toContain("current_user in ('authenticated', 'anon')");
  });

  it('leaves presence out of every guard, because it must change instantly', () => {
    // The one column added here that a client is meant to write. A guard on it
    // would put a support ticket between somebody and the ability to stop being
    // contacted, which is the opposite of what this product owes them.
    expect(plpgsqlBody(m012, 'guard_pii_columns')).not.toContain('new.presence');
  });

  it('replaces the directory rather than dropping it', () => {
    // `pending_pushes` (009) selects from `provider_directory`, so a drop either
    // fails on the dependency or, under CASCADE, silently takes the push sender
    // with it. `create or replace` can append a trailing column, which is the
    // whole reason `presence` goes last.
    expect(m012).toContain('create or replace view public.provider_directory');
    expect(m012).not.toContain('drop view if exists public.provider_directory');
    expect(m012).toContain('create or replace view public.conversation_peers');
    expect(m012).not.toContain('drop view if exists public.conversation_peers');
  });

  it('keeps the directory publishing an age and never a birth date', () => {
    // Reproducing a view body verbatim to append one column is exactly the edit
    // that loses a line without leaving a diff worth reading, and the column list
    // of this view IS the privacy boundary.
    const directory = m012.slice(
      m012.indexOf('create or replace view public.provider_directory'),
      m012.indexOf('comment on view public.provider_directory'),
    );
    expect(directory).toContain('extract(year from age(p.date_of_birth))::int as age');
    expect(directory).not.toContain('p.date_of_birth,');
    expect(directory).toContain('security_invoker = false');
  });

  it('re-states the grants it discarded by dropping the inbox view', () => {
    // A drop takes the grants with it, and `authenticated` losing SELECT here
    // empties every inbox in the product.
    expect(m012).toContain('drop view if exists public.conversation_summaries');
    expect(m012).toContain('grant select on public.conversation_summaries to authenticated');
    expect(m012).toContain('revoke all on public.conversation_summaries from anon');
  });

  it('keeps the enum in step with the TypeScript union', () => {
    // Hand-maintained mirror, and the failure is silent in one direction: a value
    // the column accepts and the union does not is a state a user can hold and
    // the app cannot render.
    const sql = /create type public\.presence_choice as enum \(([^)]+)\)/.exec(m012)?.[1] ?? '';
    const inSql = [...sql.matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort();
    const union = /export type PresenceChoice =([^;]+);/.exec(read('src/lib/database.types.ts'))?.[1] ?? '';
    const inTs = [...union.matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort();
    expect(inSql).toEqual(['away', 'here', 'hidden']);
    expect(inTs).toEqual(inSql);
  });

  it('backfills only the providers whose own switch is already on', () => {
    // Without it every provider currently showing a dot silently stops showing
    // one on deploy. It does assert a state on their behalf, which is why it is
    // narrow rather than a blanket default.
    expect(m012).toContain(
      "where role = 'provider' and is_available and presence = 'hidden'",
    );
  });
});

describe('no screen reads a listing switch as a presence dot', () => {
  // The bug 012 closes, and the only way to keep it closed is to have one
  // reading of presence rather than four. `is_available` means "listed for
  // discovery and open to new conversations"; rendering it as a dot said
  // somebody was there when it only meant they wanted work, and
  // `peer_available` is false for a member peer by construction, so the
  // provider's inbox hardcoded the dot off because no value could ever be true.
  const sites = [
    'src/components/ProviderRow.tsx',
    // ProviderCard renders the same dot for the Favourites tab; must stay on the
    // same readPresence reading as the directory row and the chat header.
    'src/components/ProviderCard.tsx',
    'src/screens/HomeScreen.tsx',
    'src/screens/ChatScreen.tsx',
    'src/screens/ProviderHomeScreen.tsx',
  ];

  it.each(sites)('derives the dot in %s from readPresence', file => {
    const source = withoutComments(read(file));
    expect(source).toContain('readPresence(');
    expect(source).not.toMatch(/online=\{[^}]*is_available/);
    expect(source).not.toMatch(/online=\{[^}]*peer_available/);
    // The provider's inbox is the specific case: `online={false}` was not
    // laziness, it was the only honest value available before `peer_presence`.
    expect(source).not.toContain('online={false}');
  });

  it('no longer reads the column 012 removed', () => {
    // Comments stripped: three of these files carry a note naming the column and
    // why it was wrong, which is precisely the documentation a negative assertion
    // over raw source would fail on.
    for (const file of sites) {
      expect(withoutComments(read(file))).not.toContain('peer_available');
    }
  });

  it('no longer derives presence from a socket at all', () => {
    // The channel outlived its last reader: no screen rendered `peerOnline` any
    // more, but `useLiveConversation` was still opening a `presence` channel and
    // still calling `track()`, so every device was publishing "my app is in the
    // foreground" for nobody. Removed rather than left dormant, because a
    // presence flag sitting in the store is an invitation for the next screen to
    // render it.
    const realtime = withoutComments(read('src/api/realtime.ts'));
    expect(realtime).not.toContain('presence:');
    expect(realtime).not.toContain('.track(');
    expect(realtime).not.toContain('presenceState');
    expect(withoutComments(read('src/store/useStore.ts'))).not.toContain('peerOnline');
    // Typing survives, and the distinction is the whole argument: it animates
    // because somebody is doing something on purpose, right now.
    expect(realtime).toContain("broadcast: { self: false }");
  });

  it('has no rail left in the inbox to confuse the two questions', () => {
    /*
     * This assertion used to say "keeps the rail filtered on openness, not on
     * presence", and it guarded a real distinction: `is_available` is a provider
     * saying she wants a new conversation, `presence` is whether she is here now,
     * and the rail once rendered the first while dotting the second.
     *
     * The rail is gone, so the way to keep that mistake from coming back is to
     * assert its absence rather than its filter. Explore is the discovery surface
     * now, and the assertion below is where the distinction is actually kept.
     */
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).not.toContain('rail-browse');
    expect(home).not.toContain('enterRail');
  });

  it('keeps availability and presence separate on the surface that has both', () => {
    // Explore reads `readPresence` for the dot and never dots a stored listing
    // switch, which is the substance of the old rail assertion.
    expect(read('src/screens/HomeScreen.tsx')).toContain('readPresence');
  });
});

describe('one presence control, writing both columns', () => {
  const provider = read('src/api/provider.ts');

  it('writes the stamp gate along with the declaration', () => {
    // 011 stores `presence_visible` as the gate on the last-seen stamp and 012
    // adds `presence` as the declared state. Independent in the schema on
    // purpose, but offering two switches for one thought is not a design.
    expect(provider).toContain(
      ".update({ presence, presence_visible: presence !== 'hidden' })",
    );
  });

  it('tracks the change under a name the database allows', () => {
    // `guard_event_shape` rejects an unknown name outright and rejects any prop
    // key matching /(body|message|content|text|detail|email|phone|name|token)/i,
    // so the prop is `choice` and never `name`.
    expect(provider).toContain("track('presence_changed', { choice: presence })");
    expect(read('supabase/migrations/011_reactions_replies_voice_calls.sql')).toContain(
      "'presence_changed'",
    );
  });

  it('offers the choice to both roles in the same place', () => {
    // App.tsx mounts SettingsSheet on the provider tree and the member tree, so
    // one control covers both. Presence is not a provider feature.
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain('PRESENCE_OPTIONS.map');
    expect(settings).toContain('useSetPresence()');
    // The testID is built from the option, so the rows cannot exist without one
    // and cannot drift from the enum. That PRESENCE_OPTIONS is exhaustive over
    // `PresenceChoice` is asserted in presence.test.ts, where it can be checked
    // against the type rather than against a string.
    expect(settings).toContain('testID={`presence-${option.value}`}');
  });

  it('stops the availability card claiming presence or the word hidden', () => {
    // Two controls saying 'hidden' and meaning different things is how somebody
    // ends up unreachable while believing they are only invisible.
    const home = withoutComments(read('src/screens/ProviderHomeScreen.tsx'));
    expect(home).not.toContain('You are hidden.');
    expect(home).not.toContain('Available Now');
    expect(home).toContain('Open to New Conversations');
  });

  it('SettingsSheet legal URLs come from legalUrl, not hard-coded strings', () => {
    // LEGAL_BASE_URL in src/lib/legal.ts is the single source of truth for the
    // public-site host. SettingsSheet must import it so the Play Console required
    // URLs (privacy policy, data deletion) cannot diverge from the canonical host.
    const settings = read('src/screens/SettingsSheet.tsx');
    expect(settings).toContain("from '../lib/legal'");
    expect(settings).toContain('legalUrl(');
    // Hard-coded host must not appear — the helper is the indirection point.
    expect(withoutComments(settings)).not.toContain("'https://bond-app.vercel.app/");
  });
});

/**
 * The Fuse motion adoption, wired rather than only drawn.
 *
 * Rules 1, 2, 4, 5 and 7 of `design/references/motion-system.md`. Rule 3, the
 * accent wash, was dropped. That decision and its reasoning are recorded in
 * that file, and the assertion that keeps it dropped is theme.test.ts's
 * `has no gradients or glow anywhere`, which is left exactly as it was.
 */
describe('the motion adoption is wired, not just drawn', () => {
  const screens = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: withoutComments(read(`src/screens/${f}`)) }));
  const components = readdirSync(join(ROOT, 'src/components'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: withoutComments(read(`src/components/${f}`)) }));

  it('separates busy from disabled in the primitive', () => {
    // The bug this whole rule exists to fix: every call site used to pass
    // `disabled` while a mutation was pending, which routed into Pressable's 45%
    // dim, so the label whose entire job is to be read was rendered at 45%
    // opacity. `busy` must therefore NOT feed the disabled opacity, and must not
    // be folded into the disabled prop on the way down.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toMatch(/busy\?: boolean/);
    expect(pressable).toMatch(/opacity: disabled \? 0\.45 : 1/);
    expect(withoutComments(pressable)).not.toMatch(/disabled \|\| busy/);
    expect(withoutComments(pressable)).not.toMatch(/busy \|\| disabled/);
    // Told to the accessibility tree as its own state, not as "disabled". The
    // trailing spreads carry optional `selected` (nav-bar a11y fix), `checked`
    // (radio/checkbox roles); busy and disabled stay separate fields.
    expect(pressable).toContain('disabled,');
    expect(pressable).toContain('busy,');
    expect(withoutComments(pressable)).toContain('accessibilityState');
  });

  it('holds a working button compressed rather than springing back', () => {
    // A press-out fires the instant the finger lifts, which is the instant the
    // request starts. So the held compression cannot share the press value, and
    // it has to come from the token table rather than from a number here.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toContain("springTo(busy ? PRESS.busy : 1, 'snap')");
  });

  it('leaves no hand-rolled ellipsis label anywhere', () => {
    // Ten call sites each spelled their own busy state into a label expression,
    // inconsistently: two of them said 'Sending…' for two different operations,
    // and one said 'Checking…' on the button that resends rather than the one
    // that checks. The participle now comes from `busyLabel` and nothing builds
    // it inline.
    for (const source of screens.concat(components)) {
      expect(source.body).not.toMatch(/label=\{[^}]*…/);
    }
  });

  it('narrates every mutation a button starts', () => {
    // Every Button that reports a pending mutation says which one. Counted
    // rather than named, so a new async button without a participle fails here
    // instead of shipping a pill that compresses and says nothing.
    for (const source of screens) {
      const busies = source.body.match(/\bbusy=\{/g)?.length ?? 0;
      const labels = source.body.match(/\bbusyLabel=/g)?.length ?? 0;
      expect(labels).toBe(busies);
    }
  });

  it('never reintroduces the carousel', () => {
    // Reverted after being watched on a device. text/secondary composites to
    // 1.16:1 at the carousel's 10% alpha and does not reach AA until 0.85,
    // where the fade is imperceptible, so the effect and legibility cannot
    // coexist at body size. The sign-in claims this used to sit behind
    // (AuthScreen) are gone with that screen (Amit, 2026-09-03), but the
    // component itself must still not come back anywhere.
    expect(existsSync(join(ROOT, 'src/components/WordCarousel.tsx'))).toBe(false);
  });

  it('is one continuous provider flow, not a second bloom welcome', () => {
    // The screen used to open on its OWN bloom welcome + "Continue" — a second
    // welcome beat after the auth one, which read as a disconnected restart. It
    // now runs straight into verify → profile → done, so BloomField, the
    // OnboardingStep checklist and the Stepper are all gone from it (Amit,
    // 2026-09-03).
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).not.toContain('<BloomField');
    expect(screen).not.toContain('<OnboardingStep');
    expect(existsSync(join(ROOT, 'src/components/Stepper.tsx'))).toBe(false);
    expect(screen).toContain("useState<Phase>('verify')");
    expect(screen).toContain("setPhase('profile')");
    expect(screen).toContain("setPhase('done')");
  });

  it('collects the mandatory profile fields, photo optional', () => {
    // The card fields a member chooses a provider by. Photo is the only optional
    // one; the auto-approve RPC enforces the rest server-side.
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).toContain('testID="provider-name"');
    expect(screen).toContain('testID="provider-headline"');
    expect(screen).toContain('testID="provider-about"');
    expect(screen).toContain('Photo (optional)');
    const rpc = read('supabase/migrations/051_provider_auto_onboarding.sql');
    expect(rpc).toContain('a display name is required');
    expect(rpc).toContain('a headline is required');
  });

  it('auto-approves on completion, with no review queue', () => {
    // No more submit → admin review → applicationStatus. Completing onboarding
    // calls complete_provider_onboarding, which flips role='provider' directly
    // (Cashfree KYC is the vetting; the admin console keeps an after-the-fact
    // Providers list). The resubmit-on-gap machinery is therefore gone.
    const screen = read('src/screens/ProviderApplicationScreen.tsx');
    expect(screen).toContain('useCompleteProviderOnboarding');
    expect(screen).not.toContain('firstFlaggedStep');
    const rpc = read('supabase/migrations/051_provider_auto_onboarding.sql');
    expect(rpc).toContain("role = 'provider'");
    expect(rpc).toContain('identity_verified_at');
  });

  it('never feeds an animation object to a colour interpolation', () => {
    // The one bug in this change that no gate here could have caught. Reanimated
    // lets you return an animation straight out of `useAnimatedStyle` and it is
    // applied as one, so `accentTo(phase)` LOOKS like a number. It is a
    // descriptor object, and handing it to `interpolateColor` produces a broken
    // colour on a device and nothing anywhere else: the animation helpers are
    // typed as returning the value they animate, so tsc is happy, and no test
    // renders. The correct shape is an animation driving a shared value and the
    // interpolation reading `.value`.
    for (const source of components.concat(screens)) {
      expect(source.body).not.toMatch(
        /interpolateColor\(\s*(accentTo|promoteTo|fadeTo|springTo)\(/,
      );
    }
  });

  it('names the send halo separately from the atmospheric field', () => {
    const sources = [
      read('src/screens/ChatScreen.tsx'),
      read('src/components/Composer.tsx'),
      read('src/components/SendButton.tsx'),
    ].join('\n');
    expect(sources).toContain('sendHaloKey');
    expect(sources).toContain('haloOpacity');
    expect(sources).not.toContain('bloomKey');
  });

  it('centralizes the measured carousel glyph departure', () => {
    expect(read('src/lib/onboarding.ts')).toContain('carouselGlyph: 32');
    expect(read('src/components/WordColumn.tsx')).toContain(
      'SOURCE_METRICS.carouselGlyph',
    );
  });

  it('contains BloomField to bounded identity and setup journeys', () => {
    const consumers = screens
      .filter(source => source.body.includes('<BloomField'))
      .map(source => source.file)
      .sort();
    // PaymentSheet removed 2026-09-01: the payment-success state is now a
    // contained M3 positive card. ProviderApplicationScreen removed 2026-09-03:
    // the provider onboarding is now one continuous verify → profile flow with no
    // second bloom welcome, so the atmospheric field lives only on the member
    // welcome/auth surface.
    expect(consumers).toEqual(['OnboardingScreen.tsx']);
  });

  /**
   * Visible buttons must go through the shared Pressable so every spring, state
   * layer and reduced-motion path stays in one place. Raw RNPressable is allowed
   * only on surfaces where press feedback is invisible or semantically wrong:
   * full-screen scrim/dim captures, the Toggle (which animates its own thumb
   * geometry), TactileCTA (deliberate bounce-spring + ripple signature), and
   * CodeField (OTP tap-to-focus zone, not a button).
   *
   * The test is an exact allowlist so a new file with a raw Pressable import
   * fails here before it ships.
   */
  it('sheet bar actions use the shared Pressable, not a raw RNPressable', () => {
    const sheet = read('src/components/Sheet.tsx');
    // Cancel and Done are visible tinted-text bar buttons; they must get spring
    // feedback and a state layer, which only the shared Pressable provides.
    expect(sheet).toContain("testID=\"sheet-cancel\"");
    expect(sheet).toContain("testID=\"sheet-done\"");
    // Both testIDs are on our Pressable, not on a raw RNPressable tag.
    expect(sheet).not.toMatch(/<RNPressable[^>]*testID="sheet-cancel"/);
    expect(sheet).not.toMatch(/<RNPressable[^>]*testID="sheet-done"/);
  });

  it('SpotlightCard "Not now" uses the shared Pressable', () => {
    const card = read('src/components/SpotlightCard.tsx');
    // "Not now" is a visible action; it must get the same spring feedback as any
    // other button. The scrim RNPressable (full-screen dismiss surface) stays raw.
    expect(card).not.toMatch(/<RNPressable[^>]*testID="spotlight-dismiss"/);
    expect(card).toContain('testID="spotlight-dismiss"');
  });

  it('CountryPicker trigger and rows use the shared Pressable', () => {
    const picker = read('src/components/CountryPicker.tsx');
    // The trigger pill and every country row are visible interactive controls.
    // After migration no raw Pressable import from react-native is needed.
    expect(picker).not.toMatch(/import \{[^}]*\bPressable\b[^}]*\} from 'react-native'/);
    expect(picker).toContain("from './Pressable'");
    expect(picker).toContain('press="chip"');
    expect(picker).toContain('press="row"');
  });

  it('confines every raw Pressable import from react-native to an exact allowlist', () => {
    /**
     * Allowlisted files and the reason each is exempt:
     *
     *   Pressable.tsx   — the primitive itself; must import the raw control.
     *   Toggle.tsx      — dedicated thumb-geometry animation (size, offset and
     *                     track colour all driven by one spring) that cannot be
     *                     expressed through the shared primitive without adding
     *                     new API surface.
     *   TactileCTA.tsx  — deliberate signature behaviour: bounce-spring release,
     *                     centred ripple bloom and emoji wiggle. Reserved for
     *                     invitational CTAs only; never the workhorse Button.
     *   CodeField.tsx   — OTP field tap-to-focus zone; not a button and has no
     *                     visible press surface to animate.
     *   Sheet.tsx       — retains one RNPressable for the full-screen scrim-fill
     *                     dismiss target (invisible gesture capture surface).
     *   SpotlightCard.tsx — same: one RNPressable for the scrim-fill dismiss.
     *   ChatStartHint.tsx — one RNPressable for the full-screen modal scrim that
     *                     dismisses the tooltip; animating it would tint the page.
     *   PaperMenu.tsx   — dim-band strips that implement the cut-out scrim; each
     *                     strip is an invisible colour layer, not a button.
     *   Turn.tsx        — one RNPressable for the transparent full-screen backdrop
     *                     that dismisses the Modal-hosted reaction strip on an
     *                     outside tap; an invisible capture surface, not a button.
     */
    const RAW_PRESSABLE_IMPORT = /import \{[^}]*\bPressable\b[^}]*\} from 'react-native'/;
    const allSources = [
      ...readdirSync(join(ROOT, 'src/components'))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `src/components/${f}`, body: withoutComments(read(`src/components/${f}`)) })),
      ...readdirSync(join(ROOT, 'src/screens'))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `src/screens/${f}`, body: withoutComments(read(`src/screens/${f}`)) })),
    ];
    const rawUsers = allSources
      .filter(s => RAW_PRESSABLE_IMPORT.test(s.body))
      .map(s => s.file)
      .sort();
    expect(rawUsers).toEqual([
      'src/components/ChatStartHint.tsx',
      'src/components/CodeField.tsx',
      'src/components/PaperMenu.tsx',
      'src/components/Pressable.tsx',
      'src/components/Sheet.tsx',
      'src/components/SpotlightCard.tsx',
      'src/components/TactileCTA.tsx',
      'src/components/Toggle.tsx',
      'src/components/Turn.tsx',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Admin control plane security contracts
// ---------------------------------------------------------------------------
// These assertions are the mechanical form of ADR-0023's security constraints:
//   • SUPABASE_SERVICE_ROLE_KEY must only live in server-side files.
//   • All DB writes go through API routes via createServiceClient.
//   • No page component imports the key directly.
//
// A failure here means a code path exists that could leak service credentials
// into the browser bundle, which bypasses RLS on every admin.* table.

describe('admin control plane key hygiene', () => {
  const ADMIN_ROOT = join(ROOT, 'admin');
  const adminExists = existsSync(ADMIN_ROOT);

  it('admin/middleware.ts exists and imports createServiceClient from lib', () => {
    if (!adminExists) return;
    const middleware = read('admin/middleware.ts');
    expect(existsSync(join(ROOT, 'admin/middleware.ts'))).toBe(true);
    // The allowlist check requires service_role; it must come from the server helper.
    expect(middleware).toContain('createServiceClient');
    expect(middleware).toContain("from '@/lib/supabase/service'");
  });

  it('service.ts references SUPABASE_SERVICE_ROLE_KEY and is never prefixed NEXT_PUBLIC_', () => {
    if (!adminExists) return;
    const service = read('admin/lib/supabase/service.ts');
    expect(service).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // The variable MUST NOT carry the NEXT_PUBLIC_ prefix — that would expose it
    // to the browser bundle.
    expect(service).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
  });

  it('all admin API routes use createServiceClient (not raw anon client for writes)', () => {
    if (!adminExists) return;
    const apiDir = join(ADMIN_ROOT, 'app/api');
    if (!existsSync(apiDir)) return;
    const routeFiles = walk(apiDir).filter((f) => f.endsWith('route.ts'));
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const file of routeFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('createServiceClient');
    }
  });

  it('no admin page component imports SUPABASE_SERVICE_ROLE_KEY directly', () => {
    if (!adminExists) return;
    const appDir = join(ADMIN_ROOT, 'app/(authenticated)');
    if (!existsSync(appDir)) return;
    const pageFiles = walk(appDir).filter(
      (f) => f.endsWith('page.tsx') || f.endsWith('layout.tsx'),
    );
    for (const file of pageFiles) {
      const content = withoutComments(readFileSync(file, 'utf8'));
      // Pages may import createServiceClient (which internally reads the key on
      // the server) but must NEVER reference the env var name directly.
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
  });

  it('browser.ts does not reference the service role key', () => {
    if (!adminExists) return;
    const browserHelper = join(ADMIN_ROOT, 'lib/supabase/browser.ts');
    if (!existsSync(browserHelper)) return;
    const content = readFileSync(browserHelper, 'utf8');
    expect(content).not.toContain('SERVICE_ROLE');
    expect(content).not.toContain('service_role');
  });

  it('commitlint scope list includes admin', () => {
    const config = read('commitlint.config.js');
    // The scope allows commits to be tagged with the admin layer.
    expect(config).toMatch(/'admin'/);
  });
});

// ---------------------------------------------------------------------------
// M3 determinate progress for media uploads
// ---------------------------------------------------------------------------
// Policy (docs/android-audit.md): Linear ProgressBar with progress 0–1 =
// determinate work where a fraction is known (upload/download). ActivityIndicator
// is banned — use LoadingIndicator (indeterminate) or ProgressBar (determinate).
// M3 spec: https://m3.material.io/components/progress-indicators/guidelines

describe('media upload uses M3 determinate progress, not ActivityIndicator', () => {
  const SRC_DIRS = ['src/lib', 'src/api', 'src/components', 'src/screens', 'src/store'];

  /** All .ts / .tsx files under the given directory (non-recursive, one level). */
  function srcFiles(dir: string): string[] {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { withFileTypes: false })
      .filter(f => typeof f === 'string' && (f.endsWith('.ts') || f.endsWith('.tsx')))
      .map(f => join(dir, f as string));
  }

  it('uses no ActivityIndicator in src/ (stripped of comments)', () => {
    // Policy: RN's ActivityIndicator draws Android's Material sweep, not M3.
    // Use LoadingIndicator for indeterminate, ProgressBar for determinate.
    const activityIndicatorPattern = /<ActivityIndicator|ActivityIndicator[,}]|ActivityIndicator\s*from/;
    for (const dir of SRC_DIRS) {
      for (const file of srcFiles(dir)) {
        const stripped = withoutComments(read(file));
        expect({ file, match: activityIndicatorPattern.test(stripped) }).toEqual({
          file,
          match: false,
        });
      }
    }
  });

  it('uploads photos with XMLHttpRequest, not fetch, to get progress events', () => {
    // fetch has no upload progress API; XHR.upload.onprogress does.
    const attachments = withoutComments(read('src/api/attachments.ts'));
    expect(attachments).toContain('new XMLHttpRequest()');
    expect(attachments).toContain('xhr.upload.onprogress');
    expect(attachments).toContain('e.lengthComputable');
    // The original fetch must be gone (outside comments).
    expect(attachments).not.toMatch(/await fetch\(/);
  });

  it('uploads voice notes with XMLHttpRequest, not fetch, to get progress events', () => {
    const voice = withoutComments(read('src/api/voice.ts'));
    expect(voice).toContain('new XMLHttpRequest()');
    expect(voice).toContain('xhr.upload.onprogress');
    expect(voice).toContain('e.lengthComputable');
    expect(voice).not.toMatch(/await fetch\(/);
  });

  it('stores upload progress in the store under the pending id', () => {
    const store = read('src/store/useStore.ts');
    expect(store).toContain('uploadProgress: Record<string, number>');
    expect(store).toContain('setUploadProgress');
    expect(store).toContain('clearUploadProgress');
    // Progress must be cleared when a conversation is left, so a next chat
    // does not inherit in-flight state from a previous one.
    expect(store).toContain('uploadProgress: {}');
  });

  it('Turn.tsx renders ProgressBar for the upload, not LoadingIndicator', () => {
    const turn = read('src/components/Turn.tsx');
    // Must import ProgressBar, not LoadingIndicator (no new import).
    expect(turn).toContain("import { ProgressBar } from './ProgressBar'");
    expect(turn).not.toContain("LoadingIndicator");
    // The bar receives a numeric progress value from the store.
    expect(turn).toContain('uploadProgress');
    expect(turn).toContain('progress={pending ? uploadFraction : undefined}');
  });

  it('VoiceNote.tsx renders ProgressBar while a voice note is uploading', () => {
    const vn = read('src/components/VoiceNote.tsx');
    expect(vn).toContain("import { ProgressBar } from './ProgressBar'");
    expect(vn).toContain('uploadFraction');
    expect(vn).toContain('progress={uploadFraction}');
  });

  it('anchors the determinate fill at the left instead of inheriting a stale transform', () => {
    // Found on device (2026-08-31): an upload starts indeterminate (no XHR event
    // yet) and then reports bytes, so one ProgressBar switches modes mid-flight.
    // The old animated style returned `transform` ONLY in the indeterminate
    // branch and `width` ONLY in the determinate one, and Reanimated does not
    // reset a property a later return value omits — so the determinate fill kept
    // the last indeterminate `translateX` and rendered as a short bar floating in
    // the middle of the track. Both branches must set BOTH properties.
    const bar = read('src/components/ProgressBar.tsx');
    const style = bar.slice(bar.indexOf('const fillStyle'), bar.indexOf('return (\n    <View'));
    // Determinate: explicit translateX 0 alongside the width.
    expect(style).toContain('transform: [{ translateX: 0 }]');
    // Indeterminate: a travelling segment, so it also sets width.
    expect(style).toMatch(/width: segment/);
    // Every `return` inside the worklet carries width and transform together.
    const returns = style.match(/return \{[\s\S]*?\};/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(2);
    for (const r of returns) {
      expect(r).toContain('width');
      expect(r).toContain('transform');
    }
    // Travel is measured from real layout, not a hardcoded ±100px.
    expect(bar).toContain('onLayout');
    expect(bar).toContain('trackWidth');
    expect(style).not.toMatch(/\*\s*100\b/);
  });

  it('accessibilityLabel announces upload progress to screen readers', () => {
    // The image accessibilityLabel must update to read "Sending photo, N percent"
    // while the upload fraction is known, so TalkBack users get progress too.
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain('Sending photo');
    expect(turn).toContain('percent');
    // Voice note equivalent.
    const vn = read('src/components/VoiceNote.tsx');
    expect(vn).toContain('Sending voice note');
    expect(vn).toContain('percent');
  });
});

describe('independent call controls', () => {
  it('exposes separate ON-by-default voice and video knobs in admin and mobile', () => {
    const registry = read('admin/lib/config-registry.ts');
    const config = read('src/api/appConfig.ts');
    for (const key of ['voice_calls_enabled', 'video_calls_enabled']) {
      expect(registry).toContain(`key: '${key}'`);
      expect(config).toContain(`${key}: boolean`);
      expect(config).toContain(`${key}: true`);
    }
    expect(registry).not.toContain("key: 'calls_enabled'");
  });

  it('gates each app action with its matching control', () => {
    const chat = read('src/screens/ChatScreen.tsx');
    const detail = read('src/screens/ProviderDetailScreen.tsx');
    expect(chat).toContain('!voiceCallsEnabled');
    expect(chat).toContain('!videoCallsEnabled');
    expect(detail).toContain('enabled={voiceCallsEnabled}');
    expect(detail).toContain('enabled={videoCallsEnabled}');
  });

  it('enforces both controls inside start_call, not only in the UI', () => {
    const migration = read(
      'supabase/migrations/044_independent_call_controls.sql',
    );
    expect(migration).toContain("environment = 'prod'");
    expect(migration).toContain("'VOICE_CALLS_DISABLED'");
    expect(migration).toContain("'VIDEO_CALLS_DISABLED'");
    expect(migration).toContain("'voice_calls_enabled', true");
    expect(migration).toContain("'video_calls_enabled', true");
  });
});

describe('post-release UI regressions', () => {
  it('defines first-run membership by an exactly empty wallet', () => {
    const app = read('App.tsx');
    const profile = read('src/api/profileSetup.ts');
    const onboarding = read('src/screens/OnboardingScreen.tsx');
    expect(profile).toContain("profile?.role === 'member' && profile.token_balance === 0");
    expect(app).toContain('firstUser && needsProfileSetup(p)');
    expect(app).toContain('firstUser && needsAgeBracket(p)');
    expect(onboarding).toContain('isFirstUser(profile ?? undefined)');
    expect(onboarding).toContain('needsAgeBracket(profile ?? undefined)');
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).toContain('const firstUser = balance === 0');
    expect(home).toContain('tourSeen || !firstUser');
    expect(home).toContain('tourSeen || !firstUser)');
  });

  it('constrains the message stack before measuring bubble text', () => {
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain("maxWidth: '80%'");
    expect(turn).toMatch(/bubble:\s*\{[\s\S]*?maxWidth:\s*'100%'/);
    expect(turn).toMatch(/myColumn:\s*\{[\s\S]*?width:\s*'100%'/);
  });

  it('keeps the interrupting recharge sheet compact and non-scrolling', () => {
    const recharge = read('src/screens/RechargeScreen.tsx');
    const sheetStart = recharge.indexOf('export function RechargeScreen');
    const walletStart = recharge.indexOf('export function RechargeWalletPage');
    const sheet = recharge.slice(sheetStart, walletStart);
    expect(sheet).toContain('<RechargeSheetForm');
    expect(sheet).not.toContain('<ScrollView');
    expect(recharge).toContain('Choose a pack');
    expect(recharge).toContain('1 token = ₹1');
    expect(recharge).toMatch(/cardSlot:\s*\{[\s\S]*?width:\s*'48%'/);
    expect(recharge).toMatch(/card:\s*\{[\s\S]*?width:\s*'100%'/);
  });

  it('keeps the navigation heart outlined when selected', () => {
    const toolbar = read('src/components/FloatingToolbar.tsx');
    expect(toolbar).toContain("active={on && tab.key !== 'favourites'}");
  });

  it('aligns the visible profile consent box without shrinking its target', () => {
    const setup = read('src/screens/ProfileSetupScreen.tsx');
    expect(setup).toContain('size={22}');
    expect(setup).toMatch(/termsRow:\s*\{[\s\S]*?alignItems:\s*'center'/);
    expect(setup).toMatch(/checkboxHit:\s*\{[\s\S]*?width:\s*22[\s\S]*?height:\s*22/);
  });
});

describe('first-send refill: all three send paths open recharge on first success', () => {
  const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
  const voice = withoutComments(read('src/api/voice.ts'));
  const image = withoutComments(read('src/api/attachments.ts'));

  it('useSendVoiceNote returns Promise<boolean>', () => {
    // The callback must signal success/failure so ChatScreen can trigger the
    // first-send refill for voice notes, exactly as it already does for text.
    // Failed, invalid, upload-failed, or server-rejected sends return false.
    expect(voice).toContain('Promise<boolean>');
    expect(voice).toContain('return true');
    expect(voice).toMatch(/return false/);
  });

  it('useSendImage returns Promise<boolean>', () => {
    // Same contract as voice: success → true, any failure path → false.
    expect(image).toContain('Promise<boolean>');
    expect(image).toContain('return true');
    expect(image).toMatch(/return false/);
  });

  it('ChatScreen awaits voice result and guards with wasFirstMemberSend', () => {
    // onSendVoice must await the hook, check wasFirstMemberSend, and call
    // openRefill() through the shared firstSendRefillShown guard — same logic
    // as onSend. A provider's sends (isMemberSide=false) never set wasFirstMemberSend.
    expect(chat).toMatch(/const ok = await sendVoice/);
    expect(chat).toMatch(/if \(ok && wasFirstMemberSend && !firstSendRefillShown\.current\)/);
  });

  it('ChatScreen awaits image result and guards with wasFirstMemberSend', () => {
    // onSendImage follows the same pattern.
    expect(chat).toMatch(/const ok = await sendImage/);
    // Both onSendVoice and onSendImage share the same guard, so one regex covers
    // both via the surrounding lines.
    expect(chat).toMatch(/firstSendRefillShown\.current = true[\s\S]{0,120}openRefill\(\)/);
  });

  it('firstSendRefillShown is idempotent across all three paths', () => {
    // Only one modal per conversation: the ref is checked before setting.
    // All three send paths must read the same ref.
    const guards = (chat.match(/firstSendRefillShown\.current/g) ?? []).length;
    // onSend + onSendVoice + onSendImage = at least 6 references
    // (3 reads + 3 writes, though the write is shared at the end of the check block)
    expect(guards).toBeGreaterThanOrEqual(6);
  });

  it('INSUFFICIENT_BALANCE still opens refill directly from the send hooks', () => {
    // Server-side balance failures open the refill sheet immediately without
    // going through the first-send path (which only fires on success).
    expect(voice).toContain("code === 'INSUFFICIENT_BALANCE'");
    expect(voice).toMatch(/code === 'INSUFFICIENT_BALANCE'[\s\S]{0,40}openRefill\(\)/);
    expect(image).toContain("code === 'INSUFFICIENT_BALANCE'");
    expect(image).toMatch(/code === 'INSUFFICIENT_BALANCE'[\s\S]{0,40}openRefill\(\)/);
  });
});

describe('opener orchestrator cleanup tracks and clears its timer', () => {
  const chat = withoutComments(read('src/screens/ChatScreen.tsx'));

  it('tracks the pending timer in a named variable', () => {
    // A bare `new Promise(resolve => setTimeout(resolve, ms))` gives up the
    // handle, so clearTimeout is impossible on unmount. The variable must be
    // declared in the effect closure so the cleanup function can reach it.
    expect(chat).toContain('pendingTimer');
    expect(chat).toMatch(/pendingTimer\s*=\s*setTimeout/);
  });

  it('clears the timer on unmount', () => {
    // Without clearTimeout the handle fires after unmount and calls setState on
    // a gone component. The cleanup must call clearTimeout before setting
    // cancelled = true so the wait Promise cannot resolve after teardown.
    expect(chat).toContain('clearTimeout(pendingTimer)');
  });

  it('preserves the cancellation latch', () => {
    // Clearing the timer does not remove the cancelled guard; both must coexist
    // so the loop exits cleanly even if the RPC is in flight when unmount runs.
    expect(chat).toContain('cancelled = true');
  });
});
