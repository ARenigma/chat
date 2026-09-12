import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';

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
  'src/components/Turn.tsx',
  'src/components/MediaViewer.tsx',
  'src/components/ReactionStrip.tsx',
  'src/components/ConversationMenu.tsx',
  'src/components/AttachPanel.tsx',
  'src/components/VoiceNote.tsx',
  'src/components/Composer.tsx',
  'src/screens/ChatScreen.tsx',
  'src/api/attachments.ts',
  'src/api/voice.ts',
] as const;

/**
 * Anything NEW that touches a chat attachment, found by its two doors:
 * `useAttachmentUrl` (the only place a stored photo becomes a URL) and
 * `ImageBody` (the photo payload every media surface is handed). A second
 * viewer, a gallery, a forward sheet — anything added later is covered by this
 * gate without anyone remembering to list it.
 */
function discoveredMediaSurfaces(): readonly string[] {
  const found: string[] = [];
  for (const dir of ['src/components', 'src/screens']) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!/\.tsx?$/.test(name)) {
        continue;
      }
      const relative = `${dir}/${name}`;
      if (/useAttachmentUrl|\bImageBody\b/.test(read(relative))) {
        found.push(relative);
      }
    }
  }
  return found;
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
    expect(discovered).toContain('src/components/Turn.tsx');
    expect(discovered).toContain('src/components/MediaViewer.tsx');
    expect(discovered).toContain('src/screens/ChatScreen.tsx');
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

  it('the attach panel offers exactly camera and gallery, both inbound', () => {
    const panel = withoutComments(read('src/components/AttachPanel.tsx'));
    expect(panel.match(/testID="attach-[a-z]+"/g)).toEqual([
      'testID="attach-panel"',
      'testID="attach-camera"',
      'testID="attach-gallery"',
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
  const turn = read('src/components/Turn.tsx');
  const chat = read('src/screens/ChatScreen.tsx');
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
    const bubble = functionBody(turn, 'function InteractiveBubble', 'function QuoteBlock');
    expect(bubble).toContain('useTapGesture({');
    expect(bubble).toContain('useExclusiveGestures(longPress, tap)');
    expect(bubble).toContain('useSimultaneousGestures(pan, discrete)');
    expect(bubble).toContain('maxDistance: REPLY_ACTIVATE');
    // One number, two consumers, so the tap ceiling and the pan's activation
    // offset cannot drift into a band where both gestures are true.
    expect(bubble).toContain('activeOffsetX: [-REPLY_ACTIVATE, REPLY_ACTIVATE]');
    expect(withoutComments(turn)).toContain('const REPLY_ACTIVATE = 16;');
  });

  it('switches the discretes with `enabled` rather than by reshaping the tree', () => {
    /*
     * The one structural change the hook migration forced, pinned so it cannot
     * silently regress into a conditional composition.
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
    const bubble = functionBody(turn, 'function InteractiveBubble', 'function QuoteBlock');
    expect(bubble).toContain('enabled: target !== null');
    expect(bubble).toContain('enabled: openViewer !== undefined');
    // And no ternary chain building the composition back up. Bounded to the two
    // statements themselves — a whole-body `not.toMatch` for `?` would be
    // satisfied by any optional call anywhere below.
    for (const name of ['discrete', 'composed']) {
      const statement = new RegExp(`const ${name}\\s*=([^;]*);`).exec(bubble)?.[1];
      expect(statement).toBeDefined();
      expect(statement).not.toContain('?');
    }
  });

  it('offers the same thing to a screen reader, which cannot see a gesture', () => {
    // https://reactnative.dev/docs/accessibility - `activate` is "engaged when a
    // screen reader user double taps the component".
    const code = withoutComments(turn);
    expect(code).toContain("const ACTIVATE_ACTION = [{ name: 'activate' as const }];");
    expect(code).toContain('accessibilityActions={ACTIVATE_ACTION}');
    expect(code).toContain('onAccessibilityAction={onTap}');
    /*
     * ...and NOT by labelling the gesture wrapper, which REPLACES the
     * concatenated child text and made the whole transcript unreadable once
     * already.
     *
     * This assertion used to be `not.toMatch(/accessibilityLabel=\{onLongPress/)`,
     * which forbade a string that has never appeared in this file — a pattern
     * nobody would write, so nothing was being prevented. Bound to the actual
     * element instead: the props of the one `Animated.View` that carries the
     * ref and the gesture. A label added THERE is the regression, whatever
     * expression it is given, and `accessibilityLabel="Dismiss reactions"` on
     * the strip's modal backdrop a few lines up is why the slice has to be the
     * element and not the function.
     */
    const wrapper = /<Animated\.View\s+ref=\{bubbleRef\}([\s\S]*?)>/.exec(
      functionBody(turn, 'function InteractiveBubble', 'function QuoteBlock'),
    )?.[1];
    expect(wrapper).toBeDefined();
    expect(wrapper).toContain('accessibilityHint=');
    expect(wrapper).not.toContain('accessibilityLabel');
  });

  it('hosts the viewer on the screen, not inside a recyclable list cell', () => {
    const code = withoutComments(chat);
    expect(code).toContain('<MediaViewer');
    expect(code).toContain('onOpenImage={openImage}');
    // A Modal declared inside Turn.tsx would unmount with its FlashList cell.
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
    for (const file of ['src/components/MediaViewer.tsx', 'src/components/Turn.tsx']) {
      expect(read(file)).not.toContain('docs/legacy-gestures/');
      expect(read(file)).not.toContain('docs/fundamentals/gesture-composition');
    }

    const raw = read('src/components/MediaViewer.tsx');
    expect(raw).toContain('docs/gestures/use-pinch-gesture');
    expect(raw).toContain('docs/gestures/use-pan-gesture');
    expect(raw).toContain('docs/composition/use-simultaneous-gestures');
    expect(raw).toContain('docs/composition/use-competing-gestures');

    /*
     * And the migration guide, which is the page the callback renames come from.
     * Cited in every one of the four files that moved, because the rename that
     * matters most — `onEnd(e, success)` to `onDeactivate(e)` with the sense of
     * the flag inverted — is the one a reader is most likely to check.
     */
    for (const file of [
      'src/components/MediaViewer.tsx',
      'src/components/Turn.tsx',
      'src/components/Sheet.tsx',
      'src/components/SpotlightCard.tsx',
    ]) {
      expect(read(file)).toContain('docs/guides/upgrading-to-3/');
    }
  });
});

// ---------------------------------------------------------------------------
// One horizontal grid, one corner
// ---------------------------------------------------------------------------

/**
 * The composer capsule and the message bubbles are one grid.
 *
 * Three things, and each was broken separately.
 *
 * The GUTTER already matched (16 both sides) but nothing checked the
 * transcript's half of it: the existing assertion in contract.test.ts reads
 * Composer.tsx and Turn.tsx and never opens ChatScreen.tsx, so
 * `list.paddingHorizontal` could have changed to `space.sm` and the suite would
 * have stayed green. The reply strip HAD already drifted, to `space.xs`.
 *
 * The CORNER was declared equal and painted unequal. See CAPSULE_MIN_H in
 * Composer.tsx: a 40dp box cannot draw a 22dp corner, so the capsule rendered 20
 * against the bubble's 22.
 *
 * The INCOMING EDGE was the half this file could not assert at all, because it
 * was wrong: a 26dp avatar slot plus an 8dp row gap put an incoming bubble's
 * left edge at 50dp against the capsule's 16dp. The avatar is gone (Amit:
 * "Remove it, align the grid"), so both edges can finally be pinned.
 */
describe('the composer and the bubbles share one grid and one corner', () => {
  const composer = read('src/components/Composer.tsx');
  const chat = read('src/screens/ChatScreen.tsx');
  const turn = read('src/components/Turn.tsx');

  it('gives the reply strip the same gutter as the transcript and the capsule', () => {
    /*
     * TWO GRIDS NOW, deliberately, and the pairing is what this protects.
     *
     * It used to be one: transcript, reply strip and capsule all on `space.md`
     * (16). The capsule moved to Telegram's own island inset on 2026-09-12 —
     * `createFrame(..., 7, 0, 7, 0)`, ChatActivity.java:8078 — because the owner
     * asked for the input box's width to match Telegram exactly, and Telegram's
     * input island is deliberately wider than its bubbles.
     *
     * So the assertion is no longer "everything shares one number". It is:
     *   - the floating island (reply strip + capsule) shares ONE inset, and
     *   - the transcript keeps its own content grid.
     *
     * The first half is the one with history. `replyBar` was once `space.xs`
     * while the capsule under it was 16, and the dock showed TWO gutters at
     * once. Holding `replyBar` at 16 now that the capsule is 7 would be the
     * identical defect with the numbers swapped, which is exactly the mistake
     * this test exists to catch.
     */
    expect(TOKENS.space.md).toBe(16);
    expect(styleBlock(chat, 'replyBar')).toContain(
      'marginHorizontal: TELEGRAM_ISLAND_INSET',
    );
    expect(styleBlock(composer, 'row')).toContain(
      'paddingHorizontal: TELEGRAM_ISLAND_INSET',
    );
    // The transcript is unchanged and keeps the bubbles' own grid.
    expect(styleBlock(chat, 'list')).toContain('paddingHorizontal: TOKENS.space.md');
    // One source for the island number, so the strip and the capsule cannot drift.
    expect(composer).toContain('export const TELEGRAM_ISLAND_INSET = 7');
    expect(chat).toContain('TELEGRAM_ISLAND_INSET');
  });

  it('lands an INCOMING bubble on the content edge, with no avatar column', () => {
    /*
     * The arithmetic, on a 360dp window:
     *
     *   content column      list.paddingHorizontal = space.md = 16  ->  [16, 344]
     *   incoming left edge  16 + peerRow(0) + bubbleStack(0)        =   16
     *                       (was 16 + AVATAR_SLOT 26 + gap 8        =   50)
     *   outgoing right edge 344 - myColumn(0) - bubbleStackEnd(0)   =   344
     *   capsule left/right  row.paddingHorizontal = 16              ->  16 / 344
     *
     * Both bubble edges and both capsule edges are the same two columns. The
     * mechanism is that `peerRow` is now the mirror of `myColumn` — a full-width
     * column aligned to its own side — instead of a row with a spacer in front
     * of it, which also makes the two `maxWidth: '80%'` declarations equal for
     * the first time (the peer's 80% used to be taken of a 34dp-narrower box).
     */
    const code = withoutComments(turn);
    expect(code).not.toContain('AVATAR_SLOT');
    expect(code).not.toMatch(/<Avatar\b/);
    expect(code).not.toContain('avatarUri');
    expect(code).not.toMatch(/\bslot:\s*\{/);

    const peer = styleBlock(turn, 'peerRow');
    expect(peer).toContain("width: '100%'");
    expect(peer).toContain("alignItems: 'flex-start'");
    // A row direction or a row gap is the defect coming back.
    expect(peer).not.toContain('flexDirection');
    expect(peer).not.toContain('gap: TOKENS.space.xs');

    const mine = styleBlock(turn, 'myColumn');
    expect(mine).toContain("width: '100%'");
    expect(mine).toContain("alignItems: 'flex-end'");
    expect(styleBlock(turn, 'bubbleStack')).toContain("maxWidth: '80%'");

    // Nothing upstream still feeds a transcript avatar either. `avatarUrl` and
    // `initial` stay in ChatScreen for the header and PeerTyping; what must be
    // gone is the plumbing into a ROW.
    expect(withoutComments(chat)).not.toContain('avatarUri={avatarUrl}');
  });

  it('holds the capsule tall enough to actually PAINT the bubble corner', () => {
    /*
     * CSS Backgrounds 3 corner overlap, implemented by RN Android in
     * `BorderRadiusStyle.ensureNoOverlap()`: a box shorter than the sum of its
     * two vertical radii has EVERY radius multiplied by height/(r+r).
     * https://www.w3.org/TR/css-backgrounds-3/#corner-overlap
     */
    expect(withoutComments(composer)).toContain(
      'export const CAPSULE_MIN_H = TOKENS.interaction.minTarget;',
    );
    /*
     * No longer derived from the bubble. `radius * 2` is the height at which a
     * pill's two arcs meet, which was the right rule while the bubble radius
     * was a pill radius (22 -> 44). WhatsApp's bubble is 9dp and that rule
     * would give an 18dp text input, so the capsule now takes the 48dp touch
     * target floor — 1.8dp taller than WhatsApp's own 46.2dp capsule, which
     * sits below the Android minimum.
     */
    expect(TOKENS.interaction.minTarget).toBe(48);
    const bar = styleBlock(composer, 'inputBar');
          /*
       * The composer no longer shares the bubble's radius token, and that is a
       * measurement rather than a drift. WhatsApp on the Redmi: bubble corner
       * 9dp, composer capsule corner 10.5dp. They are the same FAMILY — close
       * enough to read as one system — but not one value, and asserting
       * identity would be asserting something WhatsApp does not do.
       */
      expect(bar).toContain('borderRadius: TOKENS.radius.composer');
      // Same family: within 2dp of each other in either direction.
      /*
       * CORRECTED 2026-09-08. This asserted the two radii were within 2dp of
       * each other, on a measurement of WhatsApp's composer that was wrong:
       * I had read "the row where the corner ramp reaches the edge" as the
       * radius and got 10.5dp. Refitting the whole ramp gives 17.93dp, i.e.
       * 18dp — the composer is TWICE as round as the 9dp bubble, not a
       * near-match to it.
       *
       * So the invariant is the shape of the relationship, not a tolerance:
       * the composer is clearly rounder, and it is still not a pill.
       */
      expect(TOKENS.radius.composer).toBeGreaterThan(TOKENS.radius.bubble);
      // Not a pill: WhatsApp's capsule is 46.2dp tall against an 18dp corner.
      expect(TOKENS.radius.composer).toBeLessThan(TOKENS.interaction.minTarget / 2);
    expect(bar).toContain('minHeight: CAPSULE_MIN_H');
    // The recording/review capsule shares the slot, so it shares the corner:
    // `radius.pill` was clamped to 25 there and read as a stadium.
    expect(styleBlock(composer, 'panel')).toContain('borderRadius: TOKENS.radius.composer');
    // ...and the bubble's own corner is the same token, not a second number.
    expect(withoutComments(turn)).toContain('const BUBBLE_RADIUS = TOKENS.radius.bubble;');
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
  const chat = read('src/screens/ChatScreen.tsx');
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
