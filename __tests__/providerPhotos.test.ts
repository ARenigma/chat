import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/*
 * Source with its comments removed, for every assertion that BANS a token.
 *
 * Not optional here, and not defensive style. These five bans name a token that
 * the file they read ALSO names in prose, because each of those comments exists
 * to say why that API is not the answer, so a raw `not.toContain` would fail on
 * the documentation and pass on nothing:
 *
 *   `snapToInterval`, `directionalLockEnabled`, `nestedScrollEnabled`
 *                                     — ProviderDetailScreen.tsx, the hero pager
 *   `announceForAccessibility`        — ProviderDetailScreen.tsx, the live region
 *   `READ_MEDIA_IMAGES`               — ProviderPhotosScreen.tsx, the photo picker
 *
 * That list is the whole justification and it is checked, not remembered. It
 * used to name `PappalGlyphs` and `setFakeBoldText` as well, and by 2026-09-07
 * neither was a reason for anything: `PappalGlyphs` appears nowhere in `src/` in
 * any form (the filled-heart face is gone, so the ban on it is a pure standing
 * ban and needs no stripping at all), and the prose about
 * `Paint.setFakeBoldText` in Icon.tsx was only ever load-bearing for the
 * `not.toContain('fontWeight')` assertion that was deleted from this file the
 * same day. A justification that outlives the thing it justifies is how a
 * helper keeps getting applied for a reason nobody can check.
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
 * A slice bounded by two markers that must both EXIST.
 *
 * This is the rule stated at the top of this file, applied to itself. Every
 * bounded slice here was written as `source.slice(source.indexOf(marker))`, and
 * `indexOf` returns -1 when the marker is gone — at which point `slice(-1)` is
 * not the empty string, it is the LAST CHARACTER of the file. A one-character
 * string satisfies every `not.toContain` under it. So the `avatar_url` ban below
 * did not fail when `useProviderPhotos` was renamed; it passed on the letter
 * `}`. Exactly the vacuous pass the header above exists to forbid.
 *
 * An unfound END marker is the quieter half of the same bug. `slice(i, -1)` is
 * the rest of the file bar one character, so a ban scoped to one JSX block
 * silently widens to the whole module and a positive `toContain` starts being
 * satisfiable by code somewhere else entirely — no failure, just a gate that has
 * stopped meaning what its name says.
 *
 * Both bounds are therefore asserted here rather than at each call site, and the
 * end marker is searched FROM the start marker: searching from 0 also let a
 * marker that appears before `from` produce a backwards, empty slice.
 * Omitting `to` means "to end of file" as a stated intent, not as an accident.
 */
function between(source: string, from: string, to?: string): string {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  if (to === undefined) {
    return source.slice(start);
  }
  const end = source.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

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
    const gallery = between(api, 'export function useProviderPhotos');
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
    // The batch upload is the one path (useUploadAvatar went unused, 09-27).
    expect(api.match(/storage\/v1\/object\/avatars/g)).toHaveLength(1);
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
    const add = between(
      api,
      'export function useAddProviderPhotos',
      'export function useSetPrimaryPhoto',
    );

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
    const discard = between(
      api,
      'async function discardUploads',
      'export function useAddProviderPhotos',
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
    // Resolution is centralised in avatarImageSource now, because per-screen
    // clay checks are exactly how CallScreen shipped without one.
    expect(detail).toContain('avatarImageSource(uri');
  });

  it('offers the provider a single-select, not a row of switches', () => {
    const home = code('src/screens/ProviderPhotosScreen.tsx');
    expect(home).toContain('accessibilityRole="radiogroup"');
    expect(home).toContain('accessibilityRole="radio"');
    expect(home).toContain('useSetPrimaryPhoto');
    const block = between(home, 'testID="provider-photos"', 'testID="photo-remove-confirm"');
    expect(block).not.toContain('<Toggle');
  });

  it('picks photos through the system picker, which needs no permission', () => {
    const home = code('src/screens/ProviderPhotosScreen.tsx');
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
    const home = code('src/screens/ProviderPhotosScreen.tsx');
    const block = between(home, 'testID="provider-photos"', 'testID="photo-remove-confirm"');

    // A plain View carries the position and wraps the control.
    expect(block).toMatch(/<View style=\{styles\.photoRemoveSlot\}>\s*<Pressable/);

    // The slot positions; the control does not.
    const styleBlock = (name: string): string => between(home, `${name}: {`, '},');
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
     * What actually gates that, and what only looked like it did.
     *
     * The old version claimed to compute "with Pressable's own arithmetic ...
     * so a change to either the badge size or the primitive's slop formula is
     * caught here", and it did neither. It RESTATED the formula
     * (`max(8, ceil((48 - badge) / 2))`) as a literal, so Pressable.tsx was the
     * one file it could not see; and the inequality it ended on is a tautology
     * in `badge`. For any badge < 48, `2 * ceil((48 - badge) / 2) >= 48 - badge`,
     * so `badge + 2 * slop >= 48` identically; for any badge >= 48 it holds
     * trivially. REMOVE_BADGE could have been set to 6 and this test would have
     * stayed green while shipping a 6dp dot.
     *
     * So the arithmetic below is kept as the STATEMENT of the requirement, and
     * the two assertions that can actually go red are named:
     *
     *  - `size={REMOVE_BADGE}` is passed. This is the real failure mode and the
     *    only reachable route to a sub-48 target: without `size` the primitive
     *    takes its other branch, `ceil(48 / 6)` = 8, and today's 24dp badge
     *    would ship a 40dp target.
     *  - Pressable.tsx still computes slop with these two expressions, read out
     *    of the primitive instead of copied from it. That is the coverage the
     *    old comment promised, and it is what makes a change to the primitive's
     *    formula fail HERE rather than on a device.
     *
     * Deliberately NOT asserted: that the no-size branch would miss 48. It is
     * true at 24 and stops being true at 32, so it would fail on a badge
     * change that breaks nothing — a gate whose first failure is a false alarm
     * is a gate that gets relaxed.
     */
    const badge = Number(/const REMOVE_BADGE = (\d+);/.exec(home)?.[1]);
    expect(badge).toBeGreaterThan(0);
    expect(block).toContain('size={REMOVE_BADGE}');

    const pressable = code('src/components/Pressable.tsx');
    expect(pressable).toContain(
      'Math.max(8, Math.ceil((INTERACTION.minTarget - size) / 2))',
    );
    expect(pressable).toContain('Math.ceil(INTERACTION.minTarget / 6)');

    const sized = Math.max(8, Math.ceil((TOKENS.interaction.minTarget - badge) / 2));
    expect(badge + sized * 2).toBeGreaterThanOrEqual(TOKENS.interaction.minTarget);
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
    const pager = between(detail, 'horizontal', 'testID="hero-pager"');
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
    const dots = between(
      detail,
      'style={styles.pagerDots}',
      'accessibilityLiveRegion="polite"',
    );
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
      /accessibilityLabel=\{`\$\{providerFirstName\(provider\.display_name\)\}, photo \$\{i \+ 1\} of \$\{gallery\.length\}`\}/,
    );
  });
});

/**
 * The favourite heart FILLS when active — a real fill glyph, not a hack.
 *
 * The 2026-09-07 "keep the outline, heavier" decision was reversed (approved)
 * once the icon set had a real fill: the favourite heart renders Phosphor's
 * regular `heart` by default and `heart-fill` when `active`, both in the one
 * Phosphor face. The old four-way over-draw that faked a heavier outline (the
 * set then had no solid twin) is gone, along with its heart-specific branch
 * and box. Icon.tsx has ONE generic render path for every glyph.
 *
 * Still gated, not trusted: the bespoke filled-heart FACE (PappalGlyphs) must
 * not come back — the fill comes from the generic active→ICON_GLYPH_ACTIVE
 * swap, not from a second font file.
 */
describe('the favourite heart fills when active (Phosphor fill)', () => {
  const icon = code('src/components/Icon.tsx');

  it('renders no bespoke filled-heart face', () => {
    expect(icon).not.toContain('PappalGlyphs');
    expect(icon).not.toContain('♥');
  });

  it('carries the fill through the generic active→fill-glyph swap', () => {
    // No heart special-case: the fill is the same mechanism every icon uses —
    // the ICON_GLYPH_ACTIVE codepoint when active, ICON_GLYPH otherwise, in the
    // one face.
    expect(icon).toMatch(
      /\(active \? ICON_GLYPH_ACTIVE\[name\] : undefined\) \?\? ICON_GLYPH\[name\]/,
    );
    expect(icon).toContain('fontFamily: ICON_FAMILY');
    // And the heart actually has a fill to swap to.
    expect(read('design/icons.json')).toContain('"heart": "heart-fill"');
  });

  it('drops the over-draw hack entirely', () => {
    // The faked-heavier-outline machinery is gone: no dilation constant, no
    // offset table, no heart-only box, no absolute over-draw copies.
    expect(icon).not.toContain('HEAVY_DILATION');
    expect(icon).not.toContain('HEAVY_OFFSETS');
    expect(icon).not.toContain('heartBox');
    expect(icon).not.toContain('heartOverdraw');
  });

  it('puts testID on exactly one copy of the glyph', () => {
    // One render path, one Text node — so exactly one testID, and RNTL's
    // getByTestId never sees the multiple matches the stacked over-draw risked.
    expect(icon.match(/testID=\{testID\}/g)).toHaveLength(1);
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
    const remove = between(api, 'export function useRemoveProviderPhoto');
    const rowDelete = remove.indexOf(".from('provider_photos').delete()");
    const objectDelete = remove.indexOf('avatarObjectKey(photo.url)');
    expect(rowDelete).toBeGreaterThan(-1);
    expect(objectDelete).toBeGreaterThan(rowDelete);
  });
});
