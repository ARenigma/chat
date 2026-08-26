import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { propsAreSafe } from '../src/lib/telemetryGuard';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The client-side check is a convenience, `guard_event_shape` is the real
 * enforcement. These tests cover the convenience *and* assert the two stay in
 * step, because a client check that is laxer than the server produces confusing
 * silent rejections, and one that is stricter silently drops valid metrics.
 */
describe('propsAreSafe', () => {
  it('accepts dimensions that describe behaviour rather than content', () => {
    expect(propsAreSafe({ surface: 'chat' })).toBe(true);
    expect(propsAreSafe({ reason: 'BLOCKED' })).toBe(true);
    expect(propsAreSafe({ count: 3, first: true })).toBe(true);
    expect(propsAreSafe({})).toBe(true);
  });

  it.each([
    'body',
    'message',
    'messageBody',
    'content',
    'text',
    'detail',
    'email',
    'phone',
    'display_name',
    'access_token',
  ])('refuses a prop named %s', key => {
    expect(propsAreSafe({ [key]: 'x' })).toBe(false);
  });

  it('is case-insensitive, so Body is no different from body', () => {
    expect(propsAreSafe({ Body: 'x' })).toBe(false);
    expect(propsAreSafe({ MESSAGE: 'x' })).toBe(false);
  });

  it('refuses the object if any one key is unsafe', () => {
    expect(propsAreSafe({ surface: 'chat', body: 'oops' })).toBe(false);
  });
});

describe('telemetry contract with the database', () => {
  /**
   * The allowlist lives in `guard_event_shape`, which a later migration may
   * redefine, 006 does. So the authority is the *last* definition across all
   * migrations in order, not whichever file introduced it. Reading only 005
   * would have compared against a superseded list and passed while the running
   * database disagreed.
   */
  const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => read(`supabase/migrations/${f}`));
  const migration = migrations.join('\n');
  const latestGuard = (() => {
    const blocks = migration.split('create or replace function public.guard_event_shape');
    return blocks[blocks.length - 1] ?? '';
  })();
  const types = read('src/lib/database.types.ts');

  it('keeps the TelemetryEvent union in step with the SQL allowlist', () => {
    // The SQL list is the authority; the union is what makes a typo a compile
    // error instead of a runtime rejection nobody sees.
    const sqlList = /if new\.name not in \(([\s\S]*?)\) then/.exec(latestGuard)?.[1] ?? '';
    const sqlNames = [...sqlList.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();

    const unionBlock =
      /export type TelemetryEvent =([\s\S]*?);/.exec(types)?.[1] ?? '';
    const tsNames = [...unionBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();

    expect(sqlNames.length).toBeGreaterThan(0);
    expect(tsNames).toEqual(sqlNames);
  });

  it('forbids the same prop keys on both sides', () => {
    const sqlPattern = /v_key ~\* '\(([^)]+)\)'/.exec(latestGuard)?.[1] ?? '';
    const clientPattern =
      /FORBIDDEN_PROP_KEY =\s*\/\(([^)]+)\)\/i/.exec(read('src/lib/telemetryGuard.ts'))?.[1] ??
      '';
    expect(sqlPattern).not.toBe('');
    expect(clientPattern).toBe(sqlPattern);
  });

  it('never grants the client a way to read events back', () => {
    expect(migration).toMatch(/revoke all on public\.events from anon, authenticated/);
    expect(migration).toMatch(/grant insert on public\.events to authenticated/);
    // A SELECT policy would make the revoke the only thing standing between a
    // client and everyone else's behavioural data.
    expect(migration).not.toMatch(/create policy[^;]*on public\.events for select/i);
  });
});
