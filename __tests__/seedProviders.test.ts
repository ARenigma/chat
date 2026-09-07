import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * The seeded cast's NAMES, as the UI has to render them.
 *
 * Not a list of the names — the spelling is Amit's call and a test that pins it
 * turns a creative decision into a build gate. What is asserted here is the
 * budget the names have to live inside, which is a fact about the layout and
 * not about the choice:
 *
 *   - `railName` in HomeScreen.tsx is `width: 64` at `typography.bodySmall`
 *     with `numberOfLines={1}`, so anything much past ten characters comes out
 *     of the CHATS rail ellipsised. That is how "RaviListe…" shipped.
 *   - `check_display_name` (migration 040) is the app's own rule for a name:
 *     3–24 characters of `[A-Za-z0-9_]`. A seeded name outside it is a name the
 *     product would have refused, so the demo would be showing something no
 *     real provider could have.
 *   - `scripts/unseed-dev.sql` deletes the fixture with
 *     `email like 'seed.%@example.test'`. A seed address outside that namespace
 *     is a row that survives cleanup on the dev project forever.
 */
describe('dev seed provider names', () => {
  const seed = read('scripts/seed-dev.sql');

  /** The `(uuid, 'Name', age, …)` rows of the profile VALUES list. */
  const rows = [
    ...seed.matchAll(/\('([0-9a-f-]{36})'::uuid, '([^']+)', (\d+),/g),
  ].map(m => ({ id: String(m[1]), name: String(m[2]), age: Number(m[3]) }));

  it('seeds four providers, each with a name', () => {
    // Four is what the inbox search gate needs (it appears at four
    // conversations), so the count is load-bearing, not decoration.
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.name.trim()).not.toBe('');
      expect(row.age).toBeGreaterThanOrEqual(18);
    }
  });

  it('keeps every name inside the CHATS rail, which truncates at ten', () => {
    const home = read('src/screens/HomeScreen.tsx');
    // The budget is read off the layout rather than remembered: if the rail
    // tile gets wider, this assertion is the thing that says so.
    expect(home).toContain('railName');
    expect(home).toMatch(/railName: \{[^}]*width: 64/);
    for (const row of rows) {
      expect(row.name.length).toBeLessThanOrEqual(10);
    }
  });

  it('uses names the product itself would accept (migration 040)', () => {
    // 3–24 of [A-Za-z0-9_], and unique case-insensitively, which is exactly
    // what check_display_name enforces on a real one.
    const seen = new Set<string>();
    for (const row of rows) {
      expect(row.name).toMatch(/^[A-Za-z0-9_]{3,24}$/);
      expect(seen.has(row.name.toLowerCase())).toBe(false);
      seen.add(row.name.toLowerCase());
    }
  });

  it('keeps every seeded account in the namespace unseed deletes by', () => {
    const emails = [...seed.matchAll(/'(seed\.[^']*@[^']*)'/g)].map(m => String(m[1]));
    // Providers plus the three reviewers.
    expect(emails.length).toBeGreaterThanOrEqual(rows.length);
    for (const email of emails) {
      expect(email).toMatch(/^seed\.[a-z0-9]+@example\.test$/);
    }
    expect(read('scripts/unseed-dev.sql')).toContain(
      "email like 'seed.%@example.test'",
    );
  });
});
