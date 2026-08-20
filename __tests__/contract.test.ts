import { readFileSync } from 'fs';
import { join } from 'path';
import { PERSONAS, getPersona, isPersonaId } from '../src/lib/personas';
import { getSystemPrompt } from '../supabase/functions/_shared/prompts';
import { SSE_EVENTS, isUuid } from '../supabase/functions/_shared/protocol';
import { DAILY_REFILL_TOKENS, MAX_MESSAGE_CHARS } from '../src/lib/tokenLedger';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('persona registry', () => {
  it('has unique ids', () => {
    const ids = PERSONAS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves known ids and rejects everything else', () => {
    expect(getPersona('mia')?.name).toBe('Mia');
    expect(getPersona('not-a-persona')).toBeUndefined();
    expect(isPersonaId('aria')).toBe(true);
    expect(isPersonaId('aria ')).toBe(false);
    expect(isPersonaId(undefined)).toBe(false);
    expect(isPersonaId(42)).toBe(false);
  });

  it('gives every companion the non-negotiable safety clauses', () => {
    for (const persona of PERSONAS) {
      const prompt = getSystemPrompt(persona.id);
      // AI disclosure — required for the Play listing.
      expect(prompt).toMatch(/never claim to be human/i);
      // Upstream provider policy: flirtation yes, explicit content no.
      expect(prompt).toMatch(/suggestive rather than explicit/i);
      // Users bring real distress to a companion app.
      expect(prompt).toMatch(/emergency services/i);
      expect(prompt).toMatch(/self-harm/i);
      expect(persona.tagline.length).toBeGreaterThan(0);
      expect(persona.initial).toHaveLength(1);
    }
  });

  it('keeps prompt text out of anything the client imports', () => {
    // The shipped bundle should carry names and taglines, never wording the
    // server owns. Asserted at the source level so a stray re-export fails CI.
    for (const file of ['supabase/functions/_shared/personas.ts', 'src/lib/personas.ts']) {
      expect(read(file)).not.toContain('Never claim to be human');
      expect(read(file)).not.toMatch(/systemPrompt|getSystemPrompt/);
    }
  });
});

describe('isUuid', () => {
  it('accepts a v4 uuid', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isUuid('3f2504e0-4f89-41d3-9a0c-0305e82c330')).toBe(false);
    expect(isUuid("'; drop table messages; --")).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
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

  it('names the same terminal SSE events the client listens for', () => {
    const client = read('src/api/stream.ts');
    for (const event of SSE_EVENTS) {
      expect(client).toContain(`'${event}'`);
    }
  });

  it('enforces the message ceiling in the composer and the function', () => {
    expect(read('src/components/Composer.tsx')).toContain('maxLength={MAX_MESSAGE_CHARS}');
    expect(read('supabase/functions/stream-chat/index.ts')).toContain('MAX_MESSAGE_CHARS');
    expect(MAX_MESSAGE_CHARS).toBeGreaterThan(0);
  });
});

/**
 * Guards on the pipeline itself. A workflow that calls a script that no longer
 * exists, or a pgTAP file whose plan drifted from its assertion count, fails
 * silently in the worst way: the suite reports success having run nothing.
 */
describe('pipeline wiring', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;

  it('declares every npm script the workflows invoke', () => {
    const workflows = ['ci', 'e2e', 'release'].map(n => read(`.github/workflows/${n}.yml`)).join('\n');
    const invoked = [...workflows.matchAll(/npm run ([a-z:]+)/g)].map(m => m[1] ?? '');
    expect(invoked.length).toBeGreaterThan(0);
    for (const name of invoked) {
      expect(Object.keys(scripts)).toContain(name);
    }
  });

  it('points every workflow `node scripts/...` call at a file that exists', () => {
    const workflows = ['ci', 'e2e', 'release'].map(n => read(`.github/workflows/${n}.yml`)).join('\n');
    const referenced = [...workflows.matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map(m => m[1] ?? '');
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(() => read(file)).not.toThrow();
    }
  });

  it('keeps the pgTAP plan in step with the number of assertions', () => {
    const sql = read('supabase/tests/010_schema_and_rls.sql');
    const planned = Number(/select plan\((\d+)\)/.exec(sql)?.[1]);
    const asserted = (
      sql.match(
        /^select (has_table|has_index|has_trigger|col_is_pk|col_not_null|col_has_default|policies_are|function_privs_are|isnt_empty|throws_ok|lives_ok|ok|is|isnt)\(/gm,
      ) ?? []
    ).length;
    expect(planned).toBe(asserted);
  });

  it('never lets the maestro flows drift from the app id', () => {
    for (const flow of ['01-instant-launch', '02-chat-stream', '06-account-deletion']) {
      expect(read(`.maestro/${flow}.yaml`)).toContain('appId: com.companionchat');
    }
  });

  it('asserts the test IDs the flows select on still exist in the components', () => {
    const sources = ['src/components', 'src/screens'];
    const ids = ['token-badge', 'token-count', 'composer-input', 'composer-send',
      'streaming-bubble', 'bubble-assistant', 'bubble-user', 'notice-bar',
      'refill-claim', 'sheet-title', 'persona-', 'open-settings', 'chat-back',
      'chat-title', 'delete-account', 'delete-confirm', 'typing-indicator'];
    const haystack = sources
      .flatMap(dir => require('fs').readdirSync(join(ROOT, dir)).map((f: string) => read(`${dir}/${f}`)))
      .join('\n');
    for (const id of ids) {
      expect(haystack).toContain(id);
    }
  });
});
