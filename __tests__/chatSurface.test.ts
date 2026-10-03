import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';
import { sourceFiles } from './helpers/sourceFiles';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * Source with comments removed — block, whole-line AND trailing.
 *
 * Why any of this exists: half of this file is
 * `not.toMatch(/save|download|share/)`, and the comment explaining WHY a save
 * affordance is forbidden necessarily contains the word `save`. A gate that
 * matched its own prose would be no gate at all, and this repo has shipped that
 * mistake three times.
 *
 * Why it is a scanner and not the two regexes it used to be. The old version was
 * `.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')`, which strips
 * a `//` comment only when it OWNS the line — so `const x = 1; // sharing` kept
 * the word `sharing` in the text every ban below reads. That is the exact hole
 * this helper exists to close, left open in the helper itself.
 *
 * And why the naive fix is worse than the bug. Deleting from the first `//` to
 * end of line mangles string literals: `src/api/attachments.ts` and
 * `src/api/voice.ts` both carry `uri.startsWith('file://')` on a CODE line, so a
 * blind strip truncates the statement — and truncation HIDES whatever followed,
 * which weakens the ban silently instead of loudly. So the scan tracks quoting:
 * `'`, `"` and `` ` `` with backslash escapes, comments recognised only outside
 * a string.
 *
 * The one thing it does not model is a regex literal, which could contain an
 * unpaired quote and put the scan into string mode for the rest of the file. No
 * audited source contains one today (checked), and the throw below is the
 * backstop: a scan that does not finish in code state fails the suite rather
 * than returning a shorter string that quietly satisfies every `not.toMatch`.
 */
function withoutComments(source: string): string {
  let out = '';
  let quote: '"' | "'" | '`' | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (quote !== null) {
      if (c === '\\') {
        // Escapes are copied as a pair so `'\''` cannot close the literal.
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      // Up to but NOT including the newline, so line structure survives for the
      // regexes below that use `^`/`$` or bounded `[\s\S]{0,n}` windows.
      const newline = source.indexOf('\n', i);
      i = newline === -1 ? source.length : newline;
      continue;
    }
    out += c;
    i += 1;
  }
  if (quote !== null) {
    throw new Error(
      `withoutComments: scan ended inside a ${quote} literal, so the stripped ` +
        'text is not trustworthy and every ban that reads it would pass vacuously.',
    );
  }
  return out;
}

/**
 * One style block from a `makeStyles` factory, comment-stripped and bounded.
 *
 * Bounded because a whole-file `toContain` proves only that the string exists
 * somewhere, which is exactly how the composer's radius assertion could have
 * been satisfied by the paragraph explaining the radius.
 */
function styleBlock(source: string, name: string): string {
  const code = withoutComments(source);
  const styles = code.slice(code.indexOf('const makeStyles'));
  const found = new RegExp(`\\b${name}:\\s*\\{([^}]*)\\}`).exec(styles);
  expect(found).not.toBeNull();
  return found?.[1] ?? '';
}

/** The body of one function, from its declaration to the next one named. */
function functionBody(source: string, from: string, to: string): string {
  const code = withoutComments(source);
  const start = code.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = code.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

// ---------------------------------------------------------------------------
// Chat media offers no way to save it
// ---------------------------------------------------------------------------

/**
 * Every file that renders, resolves or composes a chat attachment.
 *
 * `src/screens/TransactionHistoryScreen.tsx` is deliberately NOT here and must
 * never be added: its invoice action is a GST document the member is legally
 * entitled to, has nothing to do with chat media, and has to keep working.
 */
const CHAT_MEDIA_FILES = [
  'src/chat-v2/ChatMessageCellV2.tsx',
  'src/components/MediaViewer.tsx',
  'src/components/ReactionStrip.tsx',
  'src/components/ConversationMenu.tsx',
  'src/components/VoiceNote.tsx',
  'src/chat-v2/ChatComposerV2.tsx',
  'src/chat-v2/ChatScreenV2.tsx',
  'src/api/attachments.ts',
  'src/api/voice.ts',
] as const;

/**
 * Anything NEW that touches a chat attachment, found by its two doors:
 * `useAttachmentUrl` (the only place a stored photo becomes a URL) and
 * `ImageBody` (the photo payload every media surface is handed — spelled
 * `ChatV2ImageBody` at its definition, which the unanchored suffix catches).
 * A second viewer, a gallery, a forward sheet — anything added later is
 * covered by this gate without anyone remembering to list it.
 */
function discoveredMediaSurfaces(): readonly string[] {
  return sourceFiles()
    .filter(f => /\.tsx?$/.test(f))
    .filter(f => /useAttachmentUrl|ImageBody\b/.test(read(f)));
}

const AUDITED: readonly string[] = Array.from(
  new Set([...CHAT_MEDIA_FILES, ...discoveredMediaSurfaces()]),
).sort();

/**
 * Comment-free source with the ES `export` keyword dropped too, so the word bans
 * below can be plain whole-word matches. `export const` is a module keyword;
 * `exportImage` would be an affordance.
 */
function auditable(relative: string): string {
  return withoutComments(read(relative)).replace(/^\s*export\s+(default\s+)?/gm, '');
}

/**
 * Each vector, with what makes it one.
 *
 * Not one of these needs native code or a new dependency, which is exactly why
 * the ban has to live in the test runner rather than in the manifest.
 */
const BANNED: readonly (readonly [string, RegExp])[] = [
  [
    'a save / download / export / share / forward affordance',
    /\b(save|saved|saves|saving|download|downloaded|downloads|export|exports|exporting|share|shares|sharing|forward|forwards|forwarding)\b/i,
  ],
  ['a gallery / media-store API', /\b(CameraRoll|MediaStore|PhotoLibrary)\b/],
  [
    'a filesystem, gallery or share dependency',
    /camera-roll|react-native-fs|rn-fetch-blob|react-native-blob-util|expo-media-library|react-native-share|react-native-view-shot|@react-native-clipboard/,
  ],
  [
    'a storage permission',
    /WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|READ_MEDIA_IMAGES/,
  ],
  ['handing a media URL to another app', /Linking\s*\.\s*openURL\s*\(/],
];

/**
 * A photo or a voice note lives in the thread it was sent to, and nowhere else.
 *
 * This is a trust decision on a paid 1:1 product, and it is also the only
 * position the platform supports cheaply. Writing an image into the shared
 * gallery is a MediaStore insert, and below API 29 that needs
 * WRITE_EXTERNAL_STORAGE (https://developer.android.com/training/data-storage/shared/media)
 * — minSdk here is 24, and AndroidManifest.xml declares no storage permission at
 * all. Sending the IMAGE needs ACTION_SEND with EXTRA_STREAM over a FileProvider
 * (https://developer.android.com/training/sharing/send), which this app does not
 * have either. So every route reachable from a JavaScript-only change is a LEAK
 * rather than a save: React Native's Share drops `url` on Android and posts
 * `{title, message}` as text/plain, `Linking.openURL` hands the ten-minute signed
 * URL to the browser, and supabase-js will set `Content-Disposition: attachment`
 * if `createSignedUrl` is given `{ download: true }`.
 *
 * The affordance does not exist today. This exists so that stays true: the
 * full-screen viewer is the single most conventional place in a messaging app to
 * put one, so the default a future implementer reaches for is the wrong one.
 *
 * ------------------------------------------------------------------------
 * HONEST LABEL: this block is a BAN, not coverage of any change.
 * ------------------------------------------------------------------------
 * Eight of the nine tests below grade state that was already true before the
 * photo viewer was written, and they still pass with every line of that work
 * reverted. That is not a defect in them — it is what a ban IS. Nothing here
 * should be contorted into "proving" a feature; the describe name says `offers
 * no way`, and the value is entirely in the day someone adds one. The forward
 * gates that DO bind to the viewer live in the two describes below.
 */
describe('chat media offers no way to save it (a standing ban, not change coverage)', () => {
  it('audits every attachment surface, including any added later', () => {
    const discovered = discoveredMediaSurfaces();
    // The discovery markers are load-bearing. If a refactor renames
    // `useAttachmentUrl` or `ImageBody` this goes red rather than silently
    // auditing nothing.
    expect(discovered).toContain('src/chat-v2/ChatMessageCellV2.tsx');
    expect(discovered).toContain('src/components/MediaViewer.tsx');
    expect(discovered).toContain('src/chat-v2/ChatScreenV2.tsx');
    expect(AUDITED.length).toBeGreaterThanOrEqual(CHAT_MEDIA_FILES.length);
    // And the invoice screen is out of scope, permanently.
    expect(AUDITED).not.toContain('src/screens/TransactionHistoryScreen.tsx');
  });

  it.each(AUDITED)('%s carries no save affordance', relative => {
    const code = auditable(relative);
    for (const [why, pattern] of BANNED) {
      const hit = pattern.exec(code);
      expect(hit === null ? null : `${relative}: ${why} "${hit[0]}"`).toBeNull();
    }
  });

  it('the long-press strip offers exactly reply and report', () => {
    // A closed set, so a save action cannot arrive under a name the word ban
    // does not know ("Keep", "Store", "Get").
    const strip = withoutComments(read('src/components/ReactionStrip.tsx'));
    expect(strip.match(/testID="strip-[a-z]+"/g)).toEqual([
      'testID="strip-reply"',
      'testID="strip-report"',
    ]);
  });

  it('the conversation menu offers exactly pin, remove and delete', () => {
    const menu = withoutComments(read('src/components/ConversationMenu.tsx'));
    expect(menu.match(/key: '[a-z]+'/g)).toEqual([
      "key: 'pin'",
      "key: 'remove'",
      "key: 'delete'",
    ]);
  });

  it('the composer offers no way to put media IN either, for now', () => {
    /*
     * V1's attach panel — camera, gallery, recents, all of them INBOUND — was
     * deleted with the rest of that screen on 2026-09-19 (Amit, 2026-09-19:
     * no emoji, sticker, camera, gallery or attachment send UI in the
     * composer). The closed set it was asserted against is therefore replaced
     * by the absence, asserted at the composer's own controls: a photo can
     * still be RENDERED from history, and there is no door to send a new one.
     *
     * Kept in this describe because the export ban above is only meaningful
     * next to the inbound story — a reader looking for "where does media
     * enter" must find the answer here rather than conclude the gate rotted.
     */
    const composer = withoutComments(read('src/chat-v2/ChatComposerV2.tsx'));
    expect(composer.match(/testID="chat-v2-[a-z-]+"/g)).toEqual([
      // The recording capsule, which replaces the field while a voice note is
      // being taken. All three are about the recording in hand, not a picker.
      'testID="chat-v2-record-discard"',
      'testID="chat-v2-record-elapsed"',
      'testID="chat-v2-record-wave"',
      // The birth-details card's entry, astrologer chats only (Amit,
      // 2026-09-25). Text, not media: it opens a form and sends one line.
      'testID="chat-v2-birth-details"',
      // The field, and the one trailing control that swaps between them.
      'testID="chat-v2-input"',
      'testID="chat-v2-send"',
      'testID="chat-v2-mic"',
    ]);
  });

  it('the voice note offers exactly play, wave, speed and upload progress', () => {
    const note = withoutComments(read('src/components/VoiceNote.tsx'));
    expect(note.match(/testID=\{?[`"]voice-[a-z]+/g)).toEqual([
      'testID={`voice-play',
      'testID={`voice-wave',
      'testID="voice-speed',
      'testID={`voice-upload',
    ]);
  });

  it('the photo viewer offers exactly a close control', () => {
    const viewer = withoutComments(read('src/components/MediaViewer.tsx'));
    expect(viewer.match(/testID="viewer-[a-z]+"/g)).toEqual([
      'testID="viewer-stage"',
      'testID="viewer-image"',
      'testID="viewer-close"',
    ]);
  });

  it('never mints a download-forcing signed URL', () => {
    /*
     * `createSignedUrl(path, expiresIn, { download: true })` makes the object
     * come back as `Content-Disposition: attachment`, which turns the display
     * credential into a save link with no UI change at all. Two arguments only:
     * the path and the TTL. A third is the options bag.
     */
    for (const relative of ['src/api/attachments.ts', 'src/api/voice.ts']) {
      const call = /createSignedUrl\(([^;]*)\)/.exec(auditable(relative))?.[1] ?? '';
      expect(call).not.toBe('');
      expect(call.split(',')).toHaveLength(2);
      expect(call).not.toContain('download');
    }
  });

  it('carries no dependency that can write a file to the device', () => {
    // A dependency gate rather than a manifest gate, because these arrive over
    // npm and never appear in the merged manifest until it is too late.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    for (const banned of [
      '@react-native-camera-roll/camera-roll',
      'react-native-fs',
      'rn-fetch-blob',
      'react-native-blob-util',
      'react-native-share',
      'react-native-view-shot',
      'expo-media-library',
    ]) {
      expect(Object.keys(pkg.dependencies)).not.toContain(banned);
    }
  });
});

// ---------------------------------------------------------------------------
// Tapping a photo opens it
// ---------------------------------------------------------------------------

/**
 * "Clicking sent media does not open it": the bubble had a Pan and a LongPress
 * and no Tap at all, so a photo was inert and there was nowhere to show one.
 *
 * The two bounds on the tap are asserted because either one missing brings a
 * DIFFERENT bug back, and neither is visible in a screenshot.
 */
describe('a photo bubble opens full screen on tap', () => {
  const turn = read('src/chat-v2/ChatMessageCellV2.tsx');
  const chat = read('src/chat-v2/ChatScreenV2.tsx');
  const viewer = withoutComments(read('src/components/MediaViewer.tsx'));

  it('composes the tap so it steals neither the long press nor the swipe', () => {
    /*
     * A tap composed Simultaneous with the long press fires on the release of
     * every 500ms hold, because RNGH's Android tap default maxDuration is
     * exactly 500 (TapGestureHandler.kt) - the viewer would open behind the
     * reaction strip. A tap with no distance bound fires at the end of every
     * swipe-reply, because that default is MAX_VALUE_IGNORE and `pan` runs
     * simultaneously rather than competing.
     * https://docs.swmansion.com/react-native-gesture-handler/docs/composition/use-exclusive-gestures
     */
    const code = withoutComments(turn);
    expect(code).toContain('useTapGesture({');
    expect(code).toContain('useExclusiveGestures(hold, tap)');
    expect(code).toContain('useSimultaneousGestures(pan, discrete)');
    expect(code).toContain('maxDistance: REPLY_ACTIVATE');
    // One number, two consumers, so the tap ceiling and the pan's activation
    // offset cannot drift into a band where both gestures are true.
    expect(code).toContain('activeOffsetX: [-REPLY_ACTIVATE, REPLY_ACTIVATE]');
    expect(code).toContain('const REPLY_ACTIVATE = 16;');
  });

  it('switches the discretes with `enabled` rather than by reshaping the tree', () => {
    /*
     * Pinned so it cannot silently regress into a conditional composition.
     *
     * `useLongPressGesture` and `useTapGesture` are hooks: they run on every
     * render whatever the props are, and `useGesture` creates the native handler
     * in an effect keyed only on the handler tag, so a ternary that picked a
     * subtree would save nothing and would make the composed tree's shape depend
     * on props. `enabled` is the config key for the same decision, and on
     * Android it is equivalent to absence: `recordViewHandlersForPointer` skips
     * a handler when `!handler.isEnabled` before it reaches the orchestrator's
     * list, and `hasOtherHandlerToWaitFor` only consults that list — so the
     * disabled long press of an uploading photo cannot strand the tap that waits
     * for it.
     */
    const code = withoutComments(turn);
    expect(code).toContain('enabled: actionable');
    expect(code).toContain('enabled: onTap !== undefined');
    // And no ternary chain building the composition back up. Bounded to the two
    // statements themselves — a whole-body `not.toMatch` for `?` would be
    // satisfied by any optional call anywhere below.
    for (const name of ['discrete', 'composed']) {
      const statement = new RegExp(`const ${name}\\s*=([^;]*);`).exec(code)?.[1];
      expect(statement).toBeDefined();
      expect(statement).not.toContain('?');
    }
  });

  it('offers the same thing to a screen reader, which cannot see a gesture', () => {
    /*
     * https://reactnative.dev/docs/accessibility — `activate` is "engaged when
     * a screen reader user double taps the component", and `longpress` is the
     * same for the hold. The actions live on the PHOTO rather than on the
     * bubble wrapper, because a photo is its own `imagebutton` node and
     * folding it into the parent would take its `activate` with it.
     *
     * The bubble wrapper carries no `accessibilityLabel`, and that is the half
     * with history: a label REPLACES the concatenated child text, which made
     * the whole transcript announce one hint sentence and nothing else. Bound
     * to the element rather than to the file, because
     * `accessibilityLabel="Retry sending photo"` a few lines away is correct.
     */
    const code = withoutComments(turn);
    expect(code).toContain('chatV2CellA11yActions({');
    expect(code).toContain('onAccessibilityAction={onA11yAction}');
    expect(code).toContain("activateLabel: image === undefined ? undefined : 'View photo'");

    const wrapper = /<Animated\.View\s+ref=\{bubbleRef\}([\s\S]*?)\n\s*>/.exec(
      code,
    )?.[1];
    expect(wrapper).toBeDefined();
    expect(wrapper).toContain('accessibilityActions');
    expect(wrapper).not.toContain('accessibilityLabel');
  });

  it('hosts the viewer on the screen, not inside a recyclable list cell', () => {
    const code = withoutComments(chat);
    expect(code).toContain('<MediaViewer');
    expect(code).toContain('onOpenImage={onOpenImage}');
    // A Modal declared inside the cell would unmount with its FlashList cell.
    expect(withoutComments(turn)).not.toContain('<MediaViewer');
  });

  it('closes on hardware back through the Modal own callback', () => {
    /*
     * `onRequestClose` is Required on Android and fires on the hardware back
     * button, and the same page states that "BackHandler events will not be
     * emitted as long as the modal is open" - so App.tsx's single subscription,
     * and src/lib/backGuard.ts behind it, are not consulted while the viewer is
     * up. Back therefore dismisses the photo and cannot reach the chat's session
     * guard, which is the required behaviour. A back guard here would be dead
     * code that looked like a safety net.
     * https://reactnative.dev/docs/modal
     */
    expect(viewer).toContain('onRequestClose={onClose}');
    expect(viewer).not.toContain('useBackGuard');
    expect(viewer).not.toContain('BackHandler');
  });

  it('goes under BOTH system bars and pads the close button back out', () => {
    // navigationBarTranslucent alone is ignored: RN documents that
    // statusBarTranslucent has to be set too. And system-bar insets pad the one
    // tappable control, because the window is edge-to-edge.
    // https://reactnative.dev/docs/modal
    // https://developer.android.com/develop/ui/views/layout/edge-to-edge
    expect(viewer).toContain('statusBarTranslucent');
    expect(viewer).toContain('navigationBarTranslucent');
    expect(viewer).toContain('useSafeAreaInsets()');
    expect(viewer).toMatch(/top:\s*insets\.top/);
  });

  it('shows the whole photo, decoded at window size rather than at the original', () => {
    // `contain` scales so both dimensions are equal to or less than the view's;
    // the bubble's `cover` would crop. And a 4000x3000 original decoded for a
    // 1080x2400 window is ~48MB of bitmap for no visible detail.
    // https://reactnative.dev/docs/image
    // https://developer.android.com/topic/performance/graphics/load-bitmap
    expect(viewer).toContain('resizeMode="contain"');
    expect(viewer).toContain('sizedStorageImageUri(');
    expect(viewer).toContain('PixelRatio.get()');
  });

  it('never asks the CDN to UPSCALE a photo smaller than the window', () => {
    /*
     * The other direction of the same Android page, and the half that was
     * missing. `sizedStorageImageUri` multiplies the dp box by `PixelRatio.get()`
     * to decide how many pixels to request, so an unclamped contain-fit asked
     * for `sourcePx * fit * density`: a 400x300 photo on a 360dp density-3
     * window became a 1080x810 request, a 2.7x upscale that costs MORE bytes
     * than the original file and adds no detail — the opposite of the doc it
     * cites. `1 / density` is the ceiling that makes the worst case exactly the
     * source's own pixel count.
     * https://developer.android.com/topic/performance/graphics/load-bitmap
     */
    const fit = functionBody(
      read('src/components/MediaViewer.tsx'),
      'function fittedBox',
      'function MediaViewerView',
    );
    expect(fit).toContain('maxScale');
    expect(fit).toMatch(/Math\.min\(\s*winW \/ image\.width,\s*winH \/ image\.height,\s*maxScale\s*\)/);
    // ...and the CDN caller is the one that passes the ceiling.
    expect(viewer).toContain('fittedBox(image, winW, winH, 1 / density)');
    // The pan-bounds caller deliberately does NOT: `contain` maps to
    // FIT_CENTER, which scales a small photo UP, so the draggable box is the
    // pure fit. Two callers, one function, different ceilings.
    expect(viewer).toContain('fittedBox(image, winW, winH)');
  });
});

// ---------------------------------------------------------------------------
// The viewer's own gestures
// ---------------------------------------------------------------------------

/**
 * Swipe-down-to-dismiss and pinch-to-zoom, and the composition that keeps them
 * from fighting.
 *
 * None of this is visible in a still frame and none of it is visible in a
 * render test either — RNGH relations are resolved by the native orchestrator.
 * What CAN be pinned is that the four decisions with a wrong default are made:
 * the tap is bounded (RNGH's tap has no distance limit and no pointer ceiling,
 * so an unbounded one fires on the release of a quick two-finger pinch), the pan
 * is single-pointer (or the pinch drags the stage toward dismissal), the pinch
 * reads its anchor incrementally, and the tap COMPETES rather than running
 * simultaneously with the continuous pair.
 * https://docs.swmansion.com/react-native-gesture-handler/docs/composition/use-simultaneous-gestures
 */
describe('the photo viewer dismisses on a swipe and zooms on a pinch', () => {
  const viewer = withoutComments(read('src/components/MediaViewer.tsx'));

  it('competes the tap against the simultaneous pinch-and-pan pair', () => {
    /*
     * Nested, not flat. The relation is all-to-all within a Simultaneous node,
     * so `useSimultaneousGestures(pinch, pan, tap)` would make the tap
     * simultaneous with the pinch and a two-finger release could close the
     * viewer. `traverseAndConfigureRelations` keeps the nesting honest: a
     * Simultaneous child's tags join the live set on the way in and leave it on
     * the way out, so the tap ends up simultaneous with nothing
     * (v3/detectors/utils.ts).
     */
    expect(viewer).toContain('useCompetingGestures(');
    expect(viewer).toContain('useSimultaneousGestures(pinch, pan)');
    expect(viewer).toContain('usePinchGesture({');
    expect(viewer).toContain('usePanGesture({');
    expect(viewer).toContain('useTapGesture({');
  });

  it('bounds the tap and keeps the pan to one finger', () => {
    // TapGestureHandler.kt: `maxDist = MAX_VALUE_IGNORE` by default and the only
    // pointer config is `minNumberOfPointers` — there is no ceiling.
    // PanGestureHandler.kt: ACTION_POINTER_DOWN past `maxPointers` CANCELS an
    // active pan, which is what hands the photo over to the pinch cleanly.
    expect(viewer).toContain('maxDistance: TAP_SLOP');
    expect(viewer).toContain('const TAP_SLOP = 8;');
    expect(viewer).toContain('maxPointers: 1');
  });

  it('zooms about the focal point, incrementally', () => {
    // `focalX`/`focalY` are the "center anchor point of gesture" and must be
    // read after activation — "make sure to use it after the gesture had
    // activated, i.e. in `onActivate` or `onUpdate` callbacks", never in
    // `onBegin`; `onUpdate` is what supplies `scaleChange`, "The incremental
    // change in scale since the last event frame", so the anchor arithmetic
    // needs no saved origin scale.
    // https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pinch-gesture
    expect(viewer).toMatch(/usePinchGesture\(\{[\s\S]{0,400}onUpdate:/);
    expect(viewer).not.toMatch(/usePinchGesture\(\{[\s\S]{0,400}onBegin:/);
    expect(viewer).toContain('e.scaleChange');
    expect(viewer).toContain('e.focalX');
    expect(viewer).toContain('e.focalY');
    expect(viewer).toContain('const MIN_ZOOM = 1;');
    expect(viewer).toContain('const MAX_ZOOM = 3;');
    expect(viewer).toContain('clamp(scale.value * e.scaleChange, MIN_ZOOM, MAX_ZOOM)');
  });

  it('sends a downward drag to dismissal and a zoomed drag to the picture', () => {
    // One pan, two jobs, chosen by whether the photo is zoomed — that is the
    // "must not fight" requirement, and it is a branch rather than two handlers
    // because two handlers would both be true at scale 1.
    expect(viewer).toContain('if (scale.value > MIN_ZOOM)');
    expect(viewer).toMatch(/dragY\.value = e\.translationY > 0 \? e\.translationY : e\.translationY \/ 3/);
    // Distance OR velocity, both from the shared gesture tokens rather than
    // numbers picked here.
    expect(viewer).toContain('GESTURE.dismissDistance');
    expect(viewer).toContain('GESTURE.dismissVelocity');
    expect(TOKENS.motion.gesture.dismissDistance).toBe(0.28);
    /*
     * A cancelled pan (the second-finger case) settles instead of dismissing.
     *
     * Reading `e.canceled` and not a `success` argument, and the SENSE is the
     * assertion: RNGH 3 replaced `onEnd(e, success)` with `onDeactivate(e)` and
     * "the logic is inverted — `canceled: true` corresponds to the old
     * `success: false`", so a mechanical rename that kept `if (!success ...)`
     * reading a now-truthy `canceled` would invert the branch and dismiss the
     * viewer on exactly the drags that were abandoned.
     * https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/
     */
    expect(viewer).toMatch(/onDeactivate: e =>/);
    expect(viewer).toContain('if (e.canceled || scale.value > MIN_ZOOM)');
    expect(viewer).not.toContain('success');
  });

  it('fades the scrim on the same threshold the release commits on', () => {
    /*
     * The backdrop had to come off `host` and onto its own animated absoluteFill
     * for this to be possible at all; a fill on the host cannot animate
     * independently of the photo inside it. The interpolation ends at
     * `dismissDistance`, so the amount of transcript showing through is an
     * honest read-out of what letting go will do. Two independent thresholds is
     * how a progress cue starts lying.
     */
    expect(styleBlock(read('src/components/MediaViewer.tsx'), 'host')).not.toContain(
      'backgroundColor',
    );
    expect(styleBlock(read('src/components/MediaViewer.tsx'), 'scrim')).toContain(
      'backgroundColor: t.color.bg.scrim',
    );
    expect(viewer).toMatch(
      /interpolate\(\s*dragY\.value,\s*\[0, stageH\.value \* GESTURE\.dismissDistance\],\s*\[1, DRAG_SCRIM_FLOOR\]/,
    );
  });

  it('keeps tap-to-dismiss and hardware back, and gives the label to one node', () => {
    /*
     * The stage stopped being an RN `Pressable` — it has to be inside the RNGH
     * composition to race — and that also closed the duplicate-label defect.
     * Our `Pressable` always sets `accessibilityRole` (default `button`), and
     * `ReactAccessibilityDelegate.setDelegate` installs its delegate for any
     * view with an `accessibility_role` tag, after which `hasContentToAnnounce`
     * is true and `info.contentDescription = getTalkbackDescription(...)` runs —
     * so "Close photo" was claimed by the full-screen surface AND by the button.
     * A `testID` alone installs the delegate but only sets
     * `info.viewIdResourceName`, so the stage no longer speaks.
     */
    expect(viewer.match(/accessibilityLabel="Close photo"/g)).toHaveLength(1);
    expect(viewer).toMatch(/testID="viewer-stage"[\s\S]{0,120}onLayout=\{measure\}/);
    expect(viewer).not.toMatch(/testID="viewer-stage"[\s\S]{0,200}accessibilityLabel/);
    // Tap still closes, and back still closes.
    expect(viewer).toMatch(/useTapGesture\(\{[\s\S]{0,300}runOnJS\(onClose\)\(\)/);
    expect(viewer).toContain('onRequestClose={onClose}');
    // Gestures inside a Modal need their own root on Android.
    expect(viewer).toContain('<GestureHandlerRootView');
  });

  it('cites the doc tree for the API it calls, not the legacy one', () => {
    /*
     * RULE 1's "find the page" half, mechanised — because getting this wrong is
     * silent. RNGH 3.2.1 publishes TWO doc trees for two APIs:
     * `docs/legacy-gestures/*` documents the pre-3.0 handler COMPONENTS, and
     * `docs/gestures/use-*-gesture` documents the hooks this file now calls.
     * Four of the viewer's five citations pointed into `legacy-gestures/`, and
     * the cost was not cosmetic: the Remarks quoted next to the focal-point
     * arithmetic named `onStart`, `onUpdate` and `onBegan`, none of which is the
     * wording on the page that governs today, so a reader checking the claim
     * would have been sent to a page describing different callbacks from the
     * ones in the code.
     *
     * `docs/fundamentals/gesture-composition/` is banned for a blunter reason:
     * it is a 404. Turn.tsx cited it for the Exclusive wording until this
     * migration, so a citation that had gone dead survived every green build.
     *
     * RAW source on purpose. A citation only ever lives in a comment, so this
     * is the one assertion in this file that must NOT be comment-stripped —
     * `withoutComments` would delete the very text under test.
     */
    for (const file of [
      'src/components/MediaViewer.tsx',
      'src/chat-v2/ChatMessageCellV2.tsx',
    ]) {
      expect(read(file)).not.toContain('docs/legacy-gestures/');
      expect(read(file)).not.toContain('docs/fundamentals/gesture-composition');
    }

    const raw = read('src/components/MediaViewer.tsx');
    expect(raw).toContain('docs/gestures/use-pinch-gesture');
    expect(raw).toContain('docs/gestures/use-pan-gesture');
    expect(raw).toContain('docs/composition/use-simultaneous-gestures');
    expect(raw).toContain('docs/composition/use-competing-gestures');

    /*
     * And the migration guide, which is the page the callback renames come
     * from. Cited in every file that MOVED, because the rename that matters
     * most — `onEnd(e, success)` to `onDeactivate(e)` with the sense of the
     * flag inverted — is the one a reader is most likely to check.
     *
     * `ChatMessageCellV2` is deliberately not on this list: it was written on
     * the hook API and never carried the old one, so a migration note there
     * would describe a history the file does not have. What it owes instead
     * is the hooks tree, asserted below.
     */
    for (const file of [
      'src/components/MediaViewer.tsx',
      'src/components/Sheet.tsx',
      'src/components/SpotlightCard.tsx',
    ]) {
      expect(read(file)).toContain('docs/guides/upgrading-to-3/');
    }
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');
    expect(cell).toContain('docs/gestures/use-pan-gesture');
    expect(cell).toContain('docs/composition/use-exclusive-gestures');
  });
});

// ---------------------------------------------------------------------------
// One horizontal grid, one corner
// ---------------------------------------------------------------------------

/**
 * The composer capsule and the message bubbles are one grid.
 *
 * Rebuilt for the V2 shell on 2026-09-19. V1 ran two grids — a 16dp transcript
 * against a 7dp composer island read off the reference app — and the pairing
 * that had to be held was "the reply strip matches the capsule, not the
 * transcript". The Kirill-based shell collapses that: the transcript content,
 * the reply strip and the capsule all sit on `space.sm`, so there is ONE
 * number and the thing worth asserting is that it stays one.
 */
describe('the composer and the bubbles share one grid and one corner', () => {
  const composer = read('src/chat-v2/ChatComposerV2.tsx');
  const chat = read('src/chat-v2/ChatScreenV2.tsx');
  const list = read('src/chat-v2/ChatListV2.tsx');
  const cell = read('src/chat-v2/ChatMessageCellV2.tsx');

  it('gives the reply strip the same gutter as the transcript and the capsule', () => {
    /*
     * ONE GRID. The history this protects is a reply strip that drifted off
     * the capsule under it and showed two gutters at once in the same dock —
     * the identical defect whatever the shared number happens to be.
     */
    expect(TOKENS.space.sm).toBe(12);
    expect(styleBlock(chat, 'replyBar')).toContain(
      'paddingHorizontal: TOKENS.space.sm',
    );
    expect(styleBlock(composer, 'root')).toContain(
      'paddingHorizontal: TOKENS.space.sm',
    );
    // ...and the transcript's own content column is the same edge, so a bubble
    // and the field under it start in the same place.
    // 20 since 2026-10-04: the 12dp edge plus the 8dp tail, so the TAIL tip
    // lands on the capsule's edge and the body clears it.
    expect(styleBlock(list, 'content')).toContain(
      'paddingHorizontal: TOKENS.space.lg',
    );
  });

  it('lands an INCOMING bubble on the content edge, with no avatar column', () => {
    /*
     * The arithmetic, on a 360dp window:
     *
     *   content column     content.paddingHorizontal = space.lg = 20 -> [20, 340]
     *   incoming left edge 20 + row(0) + stack(0)                     =  20
     *   outgoing right edge 340 - row(0) - stack(0)                   =  340
     *   tails (8dp) reach    12 / 348, the capsule's edges            -> 12 / 348
     *
     * Both bubble edges and both capsule edges are the same two columns. The
     * mechanism is that the peer row is the MIRROR of my row — a full-width
     * column aligned to its own side — rather than a row with an avatar spacer
     * in front of it, which also makes the two `maxWidth: '80%'` bounds equal.
     */
    const code = withoutComments(cell);
    expect(code).not.toContain('AVATAR_SLOT');
    expect(code).not.toMatch(/<Avatar\b/);
    expect(code).not.toContain('avatarUri');

    expect(styleBlock(cell, 'row')).toContain("width: '100%'");
    expect(styleBlock(cell, 'rowPeer')).toContain("alignItems: 'flex-start'");
    expect(styleBlock(cell, 'rowMine')).toContain("alignItems: 'flex-end'");
    // A row direction or a row gap is the avatar column coming back.
    expect(styleBlock(cell, 'row')).not.toContain('flexDirection');
    // One bound, shared, so the peer's 80% is 80% of the same box as mine.
    expect(styleBlock(cell, 'stack')).toContain("maxWidth: '80%'");
  });

  it('holds the capsule tall enough to actually PAINT its corner', () => {
    /*
     * CSS Backgrounds 3 corner overlap, implemented by RN Android in
     * `BorderRadiusStyle.ensureNoOverlap()`: a box shorter than the sum of its
     * two vertical radii has EVERY radius multiplied by height/(r+r). A pill
     * corner on a box under 2r is silently not a pill.
     * https://www.w3.org/TR/css-backgrounds-3/#corner-overlap
     */
    expect(TOKENS.interaction.minTarget).toBe(48);
    const field = styleBlock(composer, 'field');
    expect(field).toContain('minHeight: TOKENS.interaction.minTarget');
    expect(field).toContain('borderRadius: TOKENS.radius.pill');
    /*
     * `radius.pill` is a sentinel (999), so the overlap clamp is not a hazard
     * here — it is the MECHANISM: every radius is scaled by height/(r+r),
     * which resolves 999 to exactly half the box and gives a true stadium at
     * whatever height the capsule ends up. What must hold is that the
     * sentinel really is past the half-height, or the corner would be a fixed
     * radius pretending to be a pill.
     */
    expect(TOKENS.radius.pill).toBeGreaterThan(
      TOKENS.interaction.minTarget / 2,
    );
    // The recording capsule shares the slot, so it shares the corner and the
    // height: the swap must change what is inside the bar, not the bar.
    const record = styleBlock(composer, 'recordBar');
    expect(record).toContain('minHeight: TOKENS.interaction.minTarget');
    expect(record).toContain('borderRadius: TOKENS.radius.pill');
    // ...and the bubble keeps its own, measured corner — deliberately NOT the
    // capsule's. WhatsApp's bubble is 9dp against a much rounder composer.
    expect(styleBlock(cell, 'bubble')).toContain(
      'borderRadius: TOKENS.radius.bubble',
    );
    expect(TOKENS.radius.bubble).toBeLessThan(TOKENS.radius.pill);
  });

  it('keeps the capsule shape Amit approved on the S22, and no other', () => {
    /*
     * THIS IS A USER DECISION, NOT A DERIVED ONE, and it is pinned here so a
     * later "correction" has to argue with it.
     *
     * Amit asked for the restyle and approved it on the live S22 over Metro
     * on 2026-09-19, immediately before asking for V1 to be deleted. Three
     * things changed together and all three are his:
     *
     *   borderRadius  radius.composer (22, measured) -> radius.pill
     *   alignItems    'flex-end' -> 'center'
     *   paddingVertical  space.sm -> space.xs on the input
     *
     * `radius.composer` was RETIRED from design/tokens.json the same day
     * rather than left as an unread number; its note carries the measurement
     * it came from and the reason it stopped being used. So the ban below is
     * the meaningful half: the old token cannot come back by name, because it
     * no longer exists to be imported.
     */
    const field = styleBlock(composer, 'field');
    expect(field).toContain("alignItems: 'center'");
    expect(field).toContain('borderRadius: TOKENS.radius.pill');
    // A stadium needs no `borderCurve`: continuous smoothing is a correction
    // for a FIXED corner, and there is no fixed corner left to smooth.
    expect(field).not.toContain('borderCurve');
    expect(TOKENS.radius).not.toHaveProperty('composer');

    /*
     * The send disc centres inside the capsule, and the arithmetic is why
     * `center` is not interchangeable with `flex-end`:
     *
     *   input lineHeight  bodyMedium = 20
     *   input padding     space.xs * 2 = 16
     *   input content     20 + 16 = 36, floored by minHeight 40
     *   capsule           40 content + space['2xs'] * 2 = 48 = minTarget
     *
     * so a single-line field is exactly one touch target tall and the 40dp
     * control sits symmetrically in it.
     */
    expect(TOKENS.typography.bodyMedium.lineHeight).toBe(20);
    const input = styleBlock(composer, 'input');
    expect(input).toContain('paddingVertical: TOKENS.space.xs');
    expect(input).toContain('minHeight: 40');
    expect(TOKENS.space.xs * 2 + TOKENS.typography.bodyMedium.lineHeight).toBeLessThan(40);
    expect(40 + TOKENS.space['2xs'] * 2).toBe(TOKENS.interaction.minTarget);

    /*
     * DEFERRED, AND NOT CLAIMED EITHER WAY: what a MULTI-LINE field looks
     * like. `flex-end` pinned the trailing control to the bottom of a grown
     * capsule; `center` floats it to the middle. Nobody has frame-checked a
     * two- or three-line draft on a device, so this file asserts the
     * single-line geometry it can prove and says so rather than implying the
     * tall case was reviewed. `maxHeight: 120` is the ceiling that bounds how
     * far it can be wrong. If it reads badly when someone writes a paragraph,
     * that is the iteration — not a revert of the approved resting shape.
     */
    expect(input).toContain('maxHeight: 120');
  });
});

// ---------------------------------------------------------------------------
// The chat header's identity block
// ---------------------------------------------------------------------------

/**
 * The name and the presence line are centred on the avatar's axis, and the bar
 * cannot change height.
 *
 * androidx.compose.material3 AppBar.kt: `TopAppBarLayout` composes the title as
 * a two-child Column only when a subtitle exists (a single Box otherwise),
 * `placeTopAppBar` puts BOTH the navigation icon and the title block at
 * `(contentHeight - h) / 2`, and the height floor is the container
 * (`AppBarSmallTokens.ContainerHeight = 64.dp`) — never a blank subtitle line.
 * An always-rendered empty presence row is what held the name 8dp above the
 * 30dp avatar's centre in the default (`hidden`) presence state.
 *
 * No per-line optical nudge: every M3 role carries
 * `LineHeightStyle(alignment = Center, trim = None)` (TypographyTokens.kt),
 * which RN 0.86's CustomLineHeightSpan already matches, so block centring IS the
 * spec and a hand-tuned margin would be a departure from it.
 */
describe('the chat header identity block is block-centred and fixed-height', () => {
  const chat = read('src/chat-v2/ChatHeaderV2.tsx');
  const subtitle = read('src/components/HeaderSubtitle.tsx');

  it('reserves the two-line height on the column, from tokens, scaled by fontScale', () => {
    const code = withoutComments(chat);
    expect(code).toMatch(
      /IDENTITY_LINES =[\s\S]{0,200}titleMediumEmphasized\.lineHeight[\s\S]{0,200}labelMedium\.lineHeight/,
    );
    expect(code).toMatch(/minHeight: IDENTITY_LINES \* fontScale/);
    expect(
      TOKENS.typography.titleMediumEmphasized.lineHeight +
        TOKENS.typography.labelMedium.lineHeight,
    ).toBe(40);
  });

  it('centres whatever the column actually holds, on the header avatar axis', () => {
    // COUPLED: `identityText`'s `justifyContent` is what this change added — it
    // is what centres a one-line block inside the two-line reservation above,
    // and without it the name sits at the top of that box exactly as it did when
    // a blank presence row was holding it there.
    expect(styleBlock(chat, 'identityText')).toMatch(/justifyContent: 'center'/);
    // GUARD, pre-existing: the row's cross-axis centring on the 30dp header
    // avatar. Kept because it is the axis the assertion above is centring
    // against, so losing it would make that one pass and still look wrong.
    expect(styleBlock(chat, 'identity')).toMatch(/alignItems: 'center'/);
  });

  it('drops the presence line rather than rendering a blank one', () => {
    const code = withoutComments(subtitle);
    expect(code).toMatch(/label === ''/);
    expect(code).toMatch(/return null/);
  });

  it('corrects nothing by hand — a standing ban on optical nudges, not coverage', () => {
    /*
     * HONEST LABEL: this passes with the change reverted, and it is meant to.
     *
     * It is a ban, like the save-affordance block at the top of this file: every
     * M3 role carries `LineHeightStyle(alignment = Center, trim = None)`
     * (TypographyTokens.kt) and RN 0.86's CustomLineHeightSpan already matches
     * it, so block centring IS the spec and a hand-tuned `marginTop` would be a
     * departure from it. The reason it earns its place is that a nudge is the
     * FIRST thing anyone reaches for when a header looks a pixel off, and it
     * would silently undo the `justifyContent`/`minHeight` pair above rather
     * than fail anything.
     *
     * `identityText` is the one block here the change introduced; the other
     * three are the neighbours a nudge would land on instead if this only
     * watched the new one.
     */
    for (const name of ['identity', 'identityText', 'title']) {
      expect(styleBlock(chat, name)).not.toMatch(/marginTop|marginBottom|translateY|top:/);
    }
    expect(styleBlock(subtitle, 'base')).not.toMatch(
      /marginTop|marginBottom|translateY|top:/,
    );
  });

  it('floors the bar at the M3 small app bar height', () => {
    expect(styleBlock(chat, 'header')).toMatch(/minHeight: TOKENS\.layout\.appBarSmall/);
    expect(TOKENS.layout.appBarSmall).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// Editing and deleting a message (migration 103)
// ---------------------------------------------------------------------------

/** One SQL function's body, with `--` comments stripped so prose is not matched. */
function sqlFunctionBody(source: string, name: string): string {
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('$$;', start);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start, end)
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('a message can be edited and deleted, and both facts are visible', () => {
  const migration = read('supabase/migrations/103_edit_and_delete_messages.sql');
  const api = withoutComments(read('src/api/chat.ts'));
  const turn = withoutComments(read('src/chat-v2/ChatMessageCellV2.tsx'));
  const cells = withoutComments(read('src/chat-v2/cells.ts'));

  it('offers exactly edit and delete on your own message', () => {
    /*
     * A closed set, for the reason the reaction strip's twin above states: a
     * new action must be a decision somebody made here, not something that
     * arrives under a name no ban knows. `ReactionStrip`'s own set is asserted
     * separately and is deliberately untouched — the owner menu is the peer
     * surface's twin.
     */
    // Trailing comma so the union in the type declaration above the builder
    // is not read as a third and fourth item.
    expect(cells.match(/key: '(edit|delete|react|reply|report)',/g)).toEqual([
      "key: 'edit',",
      "key: 'delete',",
    ]);
    expect(cells).toContain("label: 'Edit'");
    expect(cells).toContain("label: 'Delete'");
  });

  it('gives the client the SAME edit window the server enforces', () => {
    /*
     * The one assertion here that could not be made by reading either side
     * alone, and the reason `message_edit_window()` is a function rather than a
     * literal in the RPC. The client hides the Edit action past the window; the
     * server refuses past the window. If the two numbers drift, the symptom is
     * an Edit button that comes back EDIT_WINDOW_CLOSED — the app offering
     * something it cannot do, which is the failure mode this pins.
     */
    expect(migration).toMatch(
      /create or replace function public\.message_edit_window\(\)[\s\S]*?select interval '15 minutes'/,
    );
    expect(api).toMatch(/EDIT_WINDOW_MS = 15 \* 60_000/);
  });

  it('deletes by tombstone, never by reusing the session purge', () => {
    /*
     * `hidden_at` is the SESSION purge (045): both participants lose the row at
     * once, nobody chose it, and it is destroyed 30 days later. A delete is one
     * participant's choice about one row, and the other person must still see
     * that it happened. Collapsing the two is the regression this file is
     * mostly here for, and it is also the cheapest mistake to make.
     */
    const body = sqlFunctionBody(migration, 'delete_message');
    expect(body).toMatch(/set\s+deleted_at\s+= now\(\)/);
    expect(body).not.toMatch(/hidden_at\s*=/);
    // Every payload column goes with it, or the "tombstone" still carries text.
    for (const column of [
      'body',
      'voice_path',
      'voice_duration_ms',
      'voice_peaks',
      'attachment_path',
      'attachment_type',
      'attachment_width',
      'attachment_height',
    ]) {
      expect(body).toMatch(new RegExp(`${column}\\s+= null`));
    }
    // And the row itself stays, so the other device has something to render.
    expect(body).not.toMatch(/delete from public\.messages/);
  });

  it('decides ownership on the server, on both paths', () => {
    // The RPCs scope to the sender; a client-side check is decoration.
    for (const fn of ['edit_message', 'delete_message']) {
      expect(sqlFunctionBody(migration, fn)).toMatch(/sender_id = v_uid/);
    }
    // And the two new columns stay as unwritable from a device as origin and
    // hidden_at already are.
    expect(migration).toMatch(
      /create or replace function public\.guard_message_edit_columns\(\)[\s\S]*?current_user in \('authenticated', 'anon'\)/,
    );
  });

  it('renders a deleted row rather than letting it fall through to a payload', () => {
    /*
     * A deleted voice note has no `voice_path` — 103 nulls every payload column
     * together — so a tombstone checked AFTER the media branches renders the
     * "Voice note" fallback for a recording that is gone. Both the row's label
     * and the bubble's body check it first.
     */
    const rows = withoutComments(read('src/chat-v2/rows.ts'));
    expect(rows).toMatch(
      /if \(row\.deleted\) \{\s*return chatV2TombstoneText\(row\.mine\);[\s\S]{0,300}'Voice note'/,
    );
    expect(rows).toMatch(
      /mine \? 'You deleted this message' : 'This message was deleted'/,
    );
    // The bubble's tombstone branch precedes the voice branch, not the reverse.
    const tombstone = turn.indexOf(') : deleted ? (');
    const voiceBranch = turn.indexOf(') : voice !== undefined ? (');
    expect(tombstone).toBeGreaterThan(-1);
    expect(voiceBranch).toBeGreaterThan(tombstone);
  });

  it('offers nothing on a tombstone — not reply, react, report, edit or delete', () => {
    // One switch for all five: every action comes from `chatV2MessageActions`,
    // so a deleted row returning the empty set is what turns the menu, the
    // reaction strip and the swipe off at once.
    expect(cells).toMatch(
      /if \(input\.deleted \|\| input\.pending \|\| input\.failed\) \{\s*return NO_ACTIONS;/,
    );
    expect(cells).toMatch(
      /const NO_ACTIONS[\s\S]{0,200}react: false,\s*reply: false,\s*report: false,\s*edit: false,\s*remove: false,/,
    );
  });

  it('says an edit happened, on both devices', () => {
    // `edited_at` is stamped by the server and is not client-writable, so the
    // marker cannot be suppressed by the device that made the edit.
    expect(sqlFunctionBody(migration, 'edit_message')).toMatch(/edited_at = now\(\)/);
    expect(cells).toContain('`Edited · ${facts.stamp}`');
  });
});

describe('the provider sees who they are talking to, and nothing more', () => {
  const migration = read('supabase/migrations/103_edit_and_delete_messages.sql');
  const view = migration.slice(
    migration.indexOf('create or replace view public.conversation_peers'),
  );
  const columns = view.slice(0, view.indexOf('from public.conversations'));

  it('publishes the two fields a member chose as their identity', () => {
    /*
     * 012 resolved a member peer to `member_handle()` because a member then had
     * no name of their own — anything in `display_name` had come from a provider
     * application. 040's first-run setup changed that fact: the member picks a
     * username and one of twelve clay avatars, on a screen whose own copy is
     * "Shown to people you chat with".
     */
    expect(columns).toMatch(
      /coalesce\(peer\.display_name, public\.member_handle\(peer\.id\)\)/,
    );
    expect(columns).toMatch(/peer\.avatar_url as peer_avatar_url/);
    // Not re-gated on role, which is the whole change on the avatar side.
    expect(columns).not.toMatch(/case when peer\.role = 'provider' then peer\.avatar_url/);
  });

  it('leaves every field the member did not offer off the column list', () => {
    /*
     * 004's rule, and the reason this is a definer view with an explicit select:
     * "the column list here IS the privacy boundary". Exactly two fields moved.
     */
    for (const column of [
      'date_of_birth',
      'phone_e164',
      'gender',
      'headline',
      'age_bracket',
      'token_balance',
      'suspended_until',
    ]) {
      expect(columns).not.toMatch(new RegExp(`peer\\.${column}`));
    }
  });

  it('keeps the auth.uid() predicate that IS the access control', () => {
    // SECURITY DEFINER, so the WHERE is not a convenience — dropping it would
    // publish every member's name to every authenticated caller.
    expect(view).toMatch(/with \(security_invoker = false\)/);
    expect(view).toMatch(
      /where c\.member_id = auth\.uid\(\) or c\.provider_id = auth\.uid\(\)/,
    );
  });
});
