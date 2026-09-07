import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/*
 * Source with its comments removed, for every assertion that BANS a token.
 *
 * Not optional here, and not defensive style: the files under test deliberately
 * name `snapToInterval`, `directionalLockEnabled`, `nestedScrollEnabled`,
 * `PappalGlyphs` and `setFakeBoldText` IN PROSE, because each comment exists to
 * say why that API is not the answer. A raw `not.toContain` would fail on the
 * documentation and pass on nothing — which is the false gate this repo has now
 * shipped three times.
 *
 * Stripping is only half of it. A ban is green on code that never had the
 * feature, so every ban below is either bounded to a slice that must EXIST
 * (which is what makes it go red on a revert) or labelled a STANDING BAN with
 * the reason it is kept despite that.
 */
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * The same idea for SQL, whose comments are `--` and whose prose in this
 * migration necessarily names the very columns the assertions ban.
 *
 * Line comments only: no string literal in 070 contains `--`, and the file has
 * no block comments.
 */
const sqlCode = (p: string): string => read(p).replace(/--.*$/gm, '');

/**
 * Migration 070 — a provider publishes several photos, one of them is the face.
 *
 * The invariants are asserted against the SQL because that is where they live:
 * a rule the client is the only thing enforcing is a rule that breaks the first
 * time somebody writes a second client (the admin console already exists). The
 * behavioural half of this — that the triggers actually do it — is pgTAP, in
 * supabase/tests/320_provider_photos.sql, and it was run against a real
 * Postgres 16 at authoring time.
 */
describe('a provider publishes several photos, and one of them is the face', () => {
  const migration = read('supabase/migrations/070_provider_photos.sql');

  it('keeps the primary and profiles.avatar_url in step in SQL, not in the client', () => {
    expect(migration).toContain('after insert or update or delete on public.provider_photos');
    expect(migration).toContain('execute function public.provider_photos_sync_avatar()');
    expect(migration).toMatch(/update public\.profiles\s+set\s+avatar_url = v_url/);

    // And the client must not be a second writer of the same fact: nothing in
    // the gallery hooks touches avatar_url.
    const api = code('src/api/provider.ts');
    const gallery = api.slice(api.indexOf('export function useProviderPhotos'));
    expect(gallery).not.toContain('avatar_url');
  });

  it('makes two primaries unrepresentable, not merely unlikely', () => {
    expect(migration).toContain('create unique index if not exists provider_photos_one_primary');
    expect(migration).toContain('where is_primary');
    // The index is the floor; the BEFORE trigger is what lets a client set a new
    // primary in ONE statement without ever colliding with it.
    expect(migration).toContain('before insert or update on public.provider_photos');
    expect(migration).toContain('execute function public.provider_photos_single_primary()');
  });

  it('lets a member read a LISTED provider only, through the 004 boundary', () => {
    expect(migration).toContain('public.provider_is_listed(provider_id)');
    expect(migration).toMatch(/select exists \(\s*select 1 from public\.provider_directory/);
    // Reusing provider_directory rather than restating its where-clause is the
    // whole point, so a second copy of the visibility rule fails this.
    expect(sqlCode('supabase/migrations/070_provider_photos.sql')).not.toContain(
      'identity_verified_at',
    );
  });

  it('leaves only is_primary client-writable, and only upwards', () => {
    /*
     * Bound to the STRUCTURE that enforces the rule, not to the two
     * `raise exception` sentences. This assertion used to read
     *   toContain('only provider_photos.is_primary is client-writable')
     *   toContain('make another photo primary instead of clearing this one')
     * against unstripped SQL, which graded the operator's WORDING: rephrasing a
     * message — or translating it — broke the build while deleting the guard's
     * WHERE-clause did not. The SQLSTATE stays, because 42501 is Postgres's
     * machine-readable contract rather than prose.
     */
    const sql = sqlCode('supabase/migrations/070_provider_photos.sql');

    // The guard is wired as a BEFORE UPDATE row trigger on the table...
    expect(sql).toMatch(
      /create trigger guard_provider_photo_columns\s+before update on public\.provider_photos\s+for each row execute function public\.guard_provider_photo_columns\(\)/,
    );
    // ...applies to the client roles and not to the definer functions...
    expect(sql).toMatch(/current_user in \('authenticated', 'anon'\)/);
    // ...freezes every column except is_primary...
    for (const column of ['id', 'provider_id', 'url', 'created_at']) {
      expect(sql).toMatch(
        new RegExp(`new\\.${column} is distinct from old\\.${column}`),
      );
    }
    // ...and refuses true -> false, which is what would leave a non-empty
    // gallery with no face.
    expect(sql).toMatch(/old\.is_primary and not new\.is_primary/);
    expect(sql).toContain("errcode = '42501'");

    // And the client's type only offers the one writable column.
    expect(read('src/lib/database.types.ts')).toMatch(
      /provider_photos: \{[\s\S]*?Update: \{ is_primary: boolean \};/,
    );
  });

  it('caps the gallery in the database, where the count is true', () => {
    expect(migration).toContain("errcode = 'P0010'");
    // The number is CAPTURED, not merely contained: `toContain('> 6')` is
    // satisfied by `> 60`, which is how this gate first failed to go red when
    // it was broken on purpose.
    const ceiling = /where provider_id = v_provider\) > (\d+) then/.exec(migration);
    expect(ceiling?.[1]).toBe('6');
    // The cap is checked AFTER the statement, not per row on the way in: the
    // client adds a batch as one multi-row INSERT.
    expect(migration).toMatch(/if tg_op = 'INSERT' then[\s\S]{0,200}count\(\*\)/);
    // And the client's own copy of the number agrees with the database's.
    const constant = /export const MAX_PROVIDER_PHOTOS = (\d+);/.exec(
      read('src/lib/database.types.ts'),
    );
    expect(constant?.[1]).toBe(ceiling?.[1]);
  });

  it('reuses the 038 bucket and the 013 path shape, not a second upload path', () => {
    const api = code('src/api/provider.ts');
    expect(api).toContain('/storage/v1/object/avatars/');
    // useUploadAvatar plus the new batch upload, and no third.
    expect(api.match(/storage\/v1\/object\/avatars/g)).toHaveLength(2);
    // STANDING BAN, not a red-on-revert gate: this one also passes on the
    // pre-070 file, and it is kept because the react-query KEY is
    // `['provider-photos', id]` while the TABLE is `provider_photos`. Typing
    // the key's hyphen into a `.from()` is a plausible slip that would fail at
    // runtime only, against a relation that does not exist.
    expect(api).not.toContain("from('provider-photos')");
  });

  it('cleans up the objects a refused batch already uploaded', () => {
    /*
     * The upload has to precede the insert — the row's `url` is not known until
     * the object exists — so a refused batch (P0010, or the missing-relation
     * error before 070 is applied) leaves objects nothing points at.
     * https://supabase.com/docs/guides/storage/management/delete-objects
     */
    const api = code('src/api/provider.ts');
    const add = api.slice(
      api.indexOf('export function useAddProviderPhotos'),
      api.indexOf('export function useSetPrimaryPhoto'),
    );
    expect(add.length).toBeGreaterThan(0);

    // The keys deleted are the ones THIS call built, collected beside the urls
    // as the loop uploads them — never a listing of the folder, which would
    // sweep a photo the provider published last week.
    expect(add).toContain('uploaded.push(path)');
    expect(add).not.toContain('.list(');

    // Cleanup happens on the insert failure, BEFORE the throw, so the error the
    // provider is shown is still the insert's.
    const failure = add.indexOf('if (error) {');
    const cleanup = add.indexOf('await discardUploads(uploaded)');
    expect(failure).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(failure);
    // Searched FROM the cleanup: the two earlier throws in this hook ('No
    // session', 'UPLOAD') precede it and would satisfy a bare indexOf.
    expect(add.indexOf('throw new Error(', cleanup)).toBeGreaterThan(cleanup);

    // And the cleanup cannot itself become the failure: it reports through
    // `{ error }`, so the returned error is read rather than thrown, and an
    // unexpected throw is caught.
    const discard = api.slice(
      api.indexOf('async function discardUploads'),
      api.indexOf('export function useAddProviderPhotos'),
    );
    expect(discard).toContain("supabase.storage.from('avatars').remove(paths)");
    expect(discard).toMatch(/const \{ error \} = await supabase\.storage/);
    expect(discard).toMatch(/\} catch \(err\) \{/);
  });

  it('shows the gallery on the detail hero and falls back to the one avatar', () => {
    const detail = code('src/screens/ProviderDetailScreen.tsx');
    expect(detail).toContain('useProviderPhotos(providerId)');
    expect(detail).toMatch(/photos\.length > 0\s*\?\s*photos\.map\(p => p\.url\)/);
    expect(detail).toContain('provider.avatar_url !== null');
    // The clay sentinel is a bundled PNG, not a URL: feeding it to <Image
    // source={{uri}}> renders nothing, which is what the single-image hero did.
    expect(detail).toContain('isClayUri(uri)');
  });

  it('offers the provider a single-select, not a row of switches', () => {
    const home = code('src/screens/ProviderHomeScreen.tsx');
    expect(home).toContain('accessibilityRole="radiogroup"');
    expect(home).toContain('accessibilityRole="radio"');
    expect(home).toContain('useSetPrimaryPhoto');
    const block = home.slice(
      home.indexOf('testID="provider-photos"'),
      home.indexOf('testID="earned-notice"'),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toContain('<Toggle');
  });

  it('picks photos through the system picker, which needs no permission', () => {
    const home = code('src/screens/ProviderHomeScreen.tsx');
    // selectionLimit > 1 routes through PickMultipleVisualMedia, the permissionless
    // system photo picker — NOT the MediaStore / READ_MEDIA_IMAGES path AttachPanel
    // refuses on Play-policy grounds.
    // https://developer.android.com/training/data-storage/shared/photopicker
    expect(home).toContain('launchImageLibrary');
    expect(home).toContain('selectionLimit: Math.max(1, remaining)');
    // STANDING BAN, not a red-on-revert gate: it passes on the pre-070 file
    // too. Kept because the failure it guards is a Play-policy rejection rather
    // than a crash — the one class of defect nobody discovers on a device.
    expect(home).not.toContain('READ_MEDIA_IMAGES');
  });

  it('hangs the remove control off a positioned View, not off the Pressable', () => {
    /*
     * `Pressable` applies the caller's `style` to an inner Animated.View and
     * forwards only the box-sizing keys to the touchable root (BOX_KEYS,
     * Pressable.tsx), so `position: 'absolute'` on a Pressable positions
     * nothing: the control lays out in normal flow — here, BELOW its tile — and
     * the absolute offsets resolve against its own box. The fix is a plain View
     * that carries the position, which is the same pattern the favourite heart
     * and the three action buttons in ProviderDetailScreen.tsx already use.
     *
     * Bounded to the gallery block, because `position: 'absolute'` on a
     * Pressable-free View is correct all over this file (the primary badge, the
     * tab badge).
     */
    const home = code('src/screens/ProviderHomeScreen.tsx');
    const block = home.slice(
      home.indexOf('testID="provider-photos"'),
      home.indexOf('testID="earned-notice"'),
    );
    expect(block.length).toBeGreaterThan(0);

    // A plain View carries the position and wraps the control.
    expect(block).toMatch(/<View style=\{styles\.photoRemoveSlot\}>\s*<Pressable/);

    // The slot positions; the control does not.
    const styleBlock = (name: string): string => {
      const at = home.indexOf(`${name}: {`);
      expect(at).toBeGreaterThan(-1);
      return home.slice(at, home.indexOf('},', at));
    };
    const slot = styleBlock('photoRemoveSlot');
    expect(slot).toContain("position: 'absolute'");
    expect(slot).toMatch(/top:/);
    expect(slot).toMatch(/right:/);
    for (const positional of ['position', 'top:', 'right:', 'bottom:', 'left:']) {
      expect(styleBlock('photoRemove')).not.toContain(positional);
    }

    /*
     * And it is still a 48dp target: "we recommend that each interactive UI
     * element have a focusable area, or touch target size, of at least 48dp ×
     * 48dp".
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     *
     * Computed with Pressable's own arithmetic rather than restating 12, so a
     * change to either the badge size or the primitive's slop formula is caught
     * here instead of shipping a 24dp target.
     */
    const badge = Number(/const REMOVE_BADGE = (\d+);/.exec(home)?.[1]);
    expect(badge).toBeGreaterThan(0);
    expect(block).toContain('size={REMOVE_BADGE}');
    const slop = Math.max(8, Math.ceil((TOKENS.interaction.minTarget - badge) / 2));
    expect(badge + slop * 2).toBeGreaterThanOrEqual(TOKENS.interaction.minTarget);
  });
});

/**
 * The hero pager's platform requirements.
 *
 * Every one of these is a doc page's answer, so a change that quietly departs
 * from it should fail the build rather than wait to be noticed on a device.
 */
describe('the provider hero pages between photos', () => {
  const detail = code('src/screens/ProviderDetailScreen.tsx');

  it("pages by the pager's own width, and does not reach for the props that are not the fix", () => {
    /*
     * pagingEnabled: "the scroll view stops on multiples of the scroll view's
     * size". snapToInterval: "Overrides less configurable `pagingEnabled` prop".
     * Setting both is a silent conflict in which the interval wins.
     * https://reactnative.dev/docs/scrollview#pagingenabled
     * https://reactnative.dev/docs/scrollview#snaptointerval
     *
     * Bounded to the pager's own prop list, and PINNED FIRST, because the three
     * bans below are all satisfied by a file with no pager in it — which is what
     * the pre-070 file was. `it('does not reach for the two props that are not
     * the fix')` used to hold this on its own and was green on fully reverted
     * code: a gate that cannot go red is documentation with a test runner
     * attached. Slicing to the props that must exist is what gives it teeth.
     */
    const opens = detail.indexOf('horizontal');
    const closes = detail.indexOf('testID="hero-pager"');
    const pager = opens > -1 && closes > opens ? detail.slice(opens, closes) : '';
    expect(pager.length).toBeGreaterThan(0);
    expect(pager).toContain('pagingEnabled');
    expect(pager).not.toContain('snapToInterval');

    /*
     * `directionalLockEnabled` is iOS-only, so it cannot resolve anything in an
     * Android-only app; `nestedScrollEnabled` is the SAME-axis nesting case.
     * A horizontal pager inside a vertical scroll is decided by Android in
     * ViewGroup.onInterceptTouchEvent, against scaledTouchSlop.
     * https://developer.android.com/develop/ui/views/touch-and-input/gestures/viewgroup
     */
    expect(pager).not.toContain('directionalLockEnabled');
    expect(pager).not.toContain('nestedScrollEnabled');
  });

  it('keeps the dot row out of the heart, by prop and not by line number', () => {
    /*
     * The indicator row is full-width and sits in the same 16dp band as the
     * favourite heart, so it overlaps a real control. "'none': The View is never
     * the target of touch events" is the deterministic answer; sibling order
     * also decides hit-testing, so declaring the dots first happens to work and
     * silently stops working when someone reorders the JSX.
     * https://reactnative.dev/docs/view#pointerevents
     */
    const dots = detail.slice(
      detail.indexOf('style={styles.pagerDots}'),
      detail.indexOf('accessibilityLiveRegion="polite"'),
    );
    expect(dots.length).toBeGreaterThan(0);
    expect(dots).toContain('pointerEvents="none"');
  });

  it('settles on the momentum end AND on a slow drag', () => {
    expect(detail).toContain('onMomentumScrollEnd={onSettled}');
    expect(detail).toContain('onScrollEndDrag={onSettled}');
  });

  it('announces the page with a live region, not a deprecated announcement', () => {
    /*
     * "Android 16 deprecates accessibility announcements, characterized by the
     * use of announceForAccessibility… To inform the user of changes to critical
     * UI, use setAccessibilityLiveRegion(int)." targetSdk is 36.
     * https://developer.android.com/about/versions/16/behavior-changes-all
     */
    expect(detail).toContain('accessibilityLiveRegion="polite"');
    expect(detail).toMatch(/Photo \$\{page \+ 1\} of \$\{gallery\.length\}/);
    expect(detail).not.toContain('announceForAccessibility');
  });

  it('labels every photo by purpose, with its position', () => {
    // A label explains meaning and purpose, not element type — hence the name
    // and the position rather than "image".
    // https://developer.android.com/guide/topics/ui/accessibility/principles
    expect(detail).toMatch(
      /accessibilityLabel=\{`\$\{provider\.display_name\}, photo \$\{i \+ 1\} of \$\{gallery\.length\}`\}/,
    );
  });
});

/**
 * The favourite heart is an outline in both states; `active` changes its WEIGHT.
 *
 * Amit, 2026-09-07: "Remove the heart fill; keep the outline, heavier." Gated
 * rather than trusted because the fill it replaces was a whole second font file
 * that is still in the tree — reintroducing it is one import away, and the
 * orphan-face test in theme.test.ts allowlists PappalGlyphs BY NAME, so that
 * gate cannot notice.
 */
describe('the favourite heart is an outline in both states', () => {
  const icon = code('src/components/Icon.tsx');

  it('renders no filled heart face anywhere', () => {
    expect(icon).not.toContain('PappalGlyphs');
    expect(icon).not.toContain('♥');
  });

  /*
   * There was an `it('never asks for a weight the Lucide asset cannot supply')`
   * here asserting `not.toContain('fontWeight')`. Removed 2026-09-07 for two
   * reasons, not one: it was green on fully reverted code, and it duplicated
   * `theme.test.ts` › "never sets a fontWeight anywhere in the app", which
   * already walks every file in `src/components` and `src/screens` — Icon.tsx
   * included — and which strips comments, so it does not fail on the long
   * explanation in Icon.tsx of why `fontWeight` is not the answer. Two copies of
   * one rule is one copy to forget when the rule changes.
   */

  it('synthesises the heavy outline by four-way overdraw at half a Lucide unit', () => {
    /*
     * Lucide draws on a 24-unit grid at stroke-width 2, and the font maps that
     * grid onto the em — measured on assets/fonts/Lucide.ttf: unitsPerEm 1000,
     * uniE0F2 bbox 916 wide == 22/24 em. So half a grid unit is fontSize/48, and
     * dilating by it on every side takes the stroke from Lucide's 2 to 3.
     * https://lucide.dev/contribute/icon-design-guide
     */
    expect(icon).toContain('HEAVY_DILATION = 1 / 48');
    expect(icon).toMatch(
      /HEAVY_OFFSETS[\s\S]{0,240}\[1, 0\][\s\S]{0,80}\[-1, 0\][\s\S]{0,80}\[0, 1\][\s\S]{0,80}\[0, -1\]/,
    );
    expect(icon).toMatch(/\{active[\s\S]{0,20}\?[\s\S]{0,20}HEAVY_OFFSETS\.map/);
  });

  it('puts testID on exactly one copy of the glyph', () => {
    // RNTL's getByTestId throws on multiple matches; five stacked copies sharing
    // a testID would break every heart assertion in the suite. Two occurrences
    // in the file: the heart's base copy, and the generic branch.
    expect(icon.match(/testID=\{testID\}/g)).toHaveLength(2);
  });

  it('keeps the no-shift box the two branches shared', () => {
    // The fixed px-by-px box is why toggling the favourite never nudges the
    // glyph, and it is now also the positioning context for the overdraw.
    expect(icon).toContain('styles.heartBox');
    expect(icon).toMatch(/heartOverdraw:\s*\{\s*position: 'absolute',/);
  });
});

/**
 * The storage object goes with the row.
 *
 * A removed photo that stays reachable at a public URL is not removed, so
 * `avatarObjectKey` parses the bucket key back out of the stored URL and the
 * delete hook uses it — row first, object second, best-effort.
 *
 * Asserted by reading source rather than by calling it, and that is a
 * limitation worth naming: importing `src/api/provider.ts` into Jest pulls in
 * `src/lib/supabase` -> `src/lib/storage` -> `react-native-mmkv`, which is not
 * in jest.config.js's `transformIgnorePatterns` allowlist and therefore fails to
 * parse. Making this a real unit test means either that config change or moving
 * the helper into `src/lib`.
 */
describe('removing a photo removes the object too', () => {
  const api = code('src/api/provider.ts');

  it('parses the object key back out of the public url', () => {
    expect(api).toContain("const marker = '/storage/v1/object/public/avatars/'");
    // A transform query (`?width=…`) is not part of the key.
    expect(api).toContain("split('?')[0]");
    // Null, not a throw, for a clay sentinel or a foreign url: removing the ROW
    // is the operation that matters.
    expect(api).toMatch(/if \(at < 0\) \{\s*return null;/);
  });

  it('deletes the row first and the object second', () => {
    // An orphaned object is the sweep's problem; a row pointing at a deleted
    // object is a broken hero a member sees. So the order is load-bearing.
    const remove = api.slice(api.indexOf('export function useRemoveProviderPhoto'));
    const rowDelete = remove.indexOf(".from('provider_photos').delete()");
    const objectDelete = remove.indexOf('avatarObjectKey(photo.url)');
    expect(rowDelete).toBeGreaterThan(-1);
    expect(objectDelete).toBeGreaterThan(rowDelete);
  });
});
