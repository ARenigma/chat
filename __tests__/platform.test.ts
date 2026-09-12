import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/*
 * A file with its comments stripped, for assertions that BAN a token.
 *
 * Several files here explain why a discouraged API is not used, so matching
 * prose would fail a file whose code is correct and whose documentation is the
 * whole point - the same trap theme.test's duration gate documents.
 */
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * The Android platform requirements, asserted.
 *
 * RULE 1 in CLAUDE.md says platform docs come first, at every scale. A rule that
 * lives only in prose is a rule that gets skipped under deadline, so the ones
 * that can be checked mechanically live here instead — every requirement carries
 * the page it comes from, so a reader can verify the claim rather than trust it.
 *
 * Each of these is here because it was missing. This file is the record of what
 * was not read the first time.
 */

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const DEBUG_MANIFEST = 'android/app/src/debug/AndroidManifest.xml';
const MAIN_ACTIVITY = 'android/app/src/main/java/com/companionchat/MainActivity.kt';

describe('native Material wait indicators', () => {
  /**
   * M3's expressive LoadingIndicator is for processes under five seconds.
   * Longer unknown waits use CircularProgressIndicator in indeterminate mode.
   * https://m3.material.io/components/loading-indicator/overview
   * https://developer.android.com/develop/ui/compose/components/progress
   */
  it('ships the current MDC Views widgets and registers both with React Native', () => {
    const gradle = read('android/app/build.gradle');
    const packageSource = read(
      'android/app/src/main/java/com/companionchat/MaterialIndicatorPackage.kt',
    );
    const application = read(
      'android/app/src/main/java/com/companionchat/MainApplication.kt',
    );
    const component = read('src/components/LoadingIndicator.tsx');

    expect(gradle).toContain(
      'implementation("com.google.android.material:material:1.14.0")',
    );
    expect(packageSource).toContain(
      'com.google.android.material.loadingindicator.LoadingIndicator',
    );
    expect(packageSource).toContain(
      'com.google.android.material.progressindicator.CircularProgressIndicator',
    );
    expect(packageSource).toContain('isIndeterminate = true');
    expect(application).toContain('add(MaterialIndicatorPackage())');
    expect(component).toContain('export const LONG_WAIT_MS = 5000');
  });
});

describe('debug-only Maestro authentication', () => {
  /** https://developer.android.com/training/app-links/create-deeplinks */
  it('declares a distinct VIEW filter only in the debug source set', () => {
    const debugManifest = read(DEBUG_MANIFEST);
    expect(debugManifest).toContain('android.intent.action.VIEW');
    expect(debugManifest).toContain('android.intent.category.DEFAULT');
    expect(debugManifest).toContain('android.intent.category.BROWSABLE');
    expect(debugManifest).toContain('android:host="e2e-auth"');
    expect(read(MANIFEST)).not.toContain('android:host="e2e-auth"');
  });

  it('rejects the session injector in every non-debug JavaScript bundle', () => {
    const auth = read('src/api/auth.ts');
    expect(auth).toContain("const e2eUrl = 'companionchat://e2e-auth'");
    expect(auth).toMatch(/if \(!__DEV__\)[\s\S]*status: 'ignored'[\s\S]*setSession/);
  });
});

describe('Gradle configuration cache', () => {
  /** https://docs.gradle.org/current/userguide/configuration_cache_enabling.html */
  it('reuses the configured task graph without masking compatibility problems', () => {
    const properties = read('android/gradle.properties');
    expect(properties).toContain('org.gradle.configuration-cache=true');
    expect(properties).not.toContain('org.gradle.configuration-cache.problems=warn');
  });
});

describe('system bars and edge-to-edge', () => {
  /** https://developer.android.com/develop/ui/views/layout/edge-to-edge */
  it('declares edge-to-edge rather than inheriting it from the framework', () => {
    /*
     * Android 15+ enforces edge-to-edge for apps targeting SDK 35 or above, so on
     * a current Pixel this is a no-op. minSdk here is 24. On Android 7 through 14
     * nothing is enforced, the system insets the window, and every screen in this
     * app also pads itself from `useSafeAreaInsets` — so the inset lands twice
     * and leaves a gap under the status bar. The doc's backward-compatible path
     * is to call it yourself, which is what this asserts.
     *
     * It was previously working only because React Native calls
     * `updateEdgeToEdgeFeatureFlag` internally. That is a framework detail, not a
     * contract, and it is not a thing to build a layout system on.
     */
    const body = read(MAIN_ACTIVITY);
    expect(body).toContain('WindowCompat.enableEdgeToEdge(window)');
  });

  /** https://developer.android.com/design/ui/mobile/guides/foundations/system-bars */
  it('turns off the three-button navigation scrim', () => {
    /*
     * `isNavigationBarContrastEnforced = false`, and the doc is specific that it
     * must be set BEFORE `enableEdgeToEdge`. It only affects three-button mode;
     * a gesture navigation bar is transparent either way and the guidance says
     * not to give it a background.
     *
     * We want it off because the bloom field runs to the bottom edge and a grey
     * system scrim over it reads as a rendering fault, not an affordance.
     */
    /*
     * Both needles include their receiver or argument so they match the CALL and
     * not the surrounding prose. The first version of this assertion searched for
     * `WindowCompat.enableEdgeToEdge` bare, found the sentence in the comment
     * above the code explaining what it does, and reported the ordering backwards.
     * A test that reads comments is a test that grades documentation.
     */
    const body = read(MAIN_ACTIVITY);
    const contrastAt = body.indexOf('window.isNavigationBarContrastEnforced = false');
    const enableAt = body.indexOf('WindowCompat.enableEdgeToEdge(window)');
    expect(contrastAt).toBeGreaterThan(0);
    expect(enableAt).toBeGreaterThan(0);
    expect(contrastAt).toBeLessThan(enableAt);
  });

  it('guards the API-29 call, because minSdk is 24', () => {
    // `isNavigationBarContrastEnforced` arrived in API 29. Unguarded, it is a
    // NoSuchMethodError on every Android 7-9 device, at launch.
    const body = read(MAIN_ACTIVITY);
    expect(body).toMatch(/Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.Q/);
  });

  it('keeps the JS status bar in charge of icon appearance', () => {
    /*
     * `enableEdgeToEdge` picks light or dark system icons from the theme at
     * launch. The theme mode here can change at runtime, and the layer that
     * knows about that is JS, so `<StatusBar>` stays and is not superseded.
     */
    const app = read('App.tsx');
    expect(app).toMatch(/<StatusBar[\s\S]{0,120}barStyle=/);
    expect(app).toMatch(/<StatusBar[\s\S]{0,120}translucent/);
  });
});

describe('the manifest states its platform intent', () => {
  /** https://developer.android.com/develop/ui/views/notifications/notification-permission */
  it('declares the notification runtime permission', () => {
    // Required from Android 13. Without it, a messaging app posts nothing and
    // there is no error to notice.
    expect(read(MANIFEST)).toContain('android.permission.POST_NOTIFICATIONS');
  });

  // ADR-0022: Play Billing — BILLING permission is auto-embedded by billing-ktx
  // (developer.android.com/google/play/billing/integrate#setup). We do NOT add
  // it explicitly to the manifest; the library's aar merges it automatically.
  // This test verifies we are NOT accidentally declaring it (which would be
  // harmless but noisy and indicates someone read the wrong guide).
  test('manifest does not manually declare BILLING permission', () => {
    expect(read(MANIFEST)).not.toContain(
      'com.android.vending.BILLING'
    );
  });

  test('manifest gate names the capabilities contributed by call, billing, and auth libraries', () => {
    const verifier = read('scripts/verify-manifest.mjs');
    expect(verifier).toContain('com.android.vending.BILLING');
    expect(verifier).toContain('android.permission.BLUETOOTH_CONNECT');
    expect(verifier).toContain('android.permission.MODIFY_AUDIO_SETTINGS');
    expect(verifier).toContain(
      'com.google.android.providers.gsf.permission.READ_GSERVICES'
    );
  });

  test('Agora optional processing extensions stay out of every Android artifact', () => {
    const build = read('android/app/build.gradle');
    expect(build).toContain("exclude '**/libagora_*_extension.so'");
    expect(build).toContain(
      'exclude group: "io.agora.rtc", module: "full-screen-sharing"'
    );
    expect(build).toContain(
      'docs.agora.io/en/realtime-media/video/build/optimize-and-operate/app-size-optimization/react-native'
    );
  });
});

describe('the input method is not allowed to take the window', () => {
  /** https://reactnative.dev/docs/textinput#disablefullscreenui-android */
  it('routes every text input through TextField', () => {
    /*
     * React Native's `disableFullscreenUI` defaults to FALSE, and with it off the
     * IME may take the entire window whenever it decides space is short — which
     * on a phone means any landscape orientation. The result is the fullscreen
     * extract editor: a bare white field, a grey ALL-CAPS action button and a
     * coloured underline, with the app gone rather than shrunk or dimmed.
     * Reproduced on API 34 with Gboard 12.4.05 on 2026-08-26.
     *
     * A per-field opt-out is the trap: somebody has to remember it for every
     * field added afterwards. One wrapper plus this test is a rule that holds
     * without anybody remembering it.
     */
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(rel);
        } else if (
          rel.endsWith('.tsx') &&
          !rel.endsWith('components/TextField.tsx') &&
          // SearchBar is the M3 search-input primitive; it wraps TextInput the same
          // way TextField does, and callers use SearchBar — not TextInput — directly.
          !rel.endsWith('components/SearchBar.tsx')
        ) {
          const body = read(rel);
          // A VALUE import of TextInput. `import { type TextInput }` is fine:
          // CodeField needs it to type an imperative focus ref.
          if (/import \{[^}]*(?<!type )\bTextInput\b[^}]*\} from 'react-native'/s.test(body)) {
            offenders.push(rel);
          }
          /*
           * The lookbehind is load-bearing: without it this matches the TYPE
           * position in `useRef<TextInput>(null)`, which CodeField legitimately
           * needs to type its imperative focus ref. A JSX element is always
           * preceded by whitespace or a bracket, never by an identifier
           * character. The first version of this test reported CodeField as an
           * offender for a line that renders nothing.
           */
          if (/(?<![A-Za-z0-9_])<TextInput[\s/>]/.test(body)) {
            offenders.push(`${rel} (renders <TextInput>)`);
          }
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });

  it('records that the flag is a hint, not a platform guarantee', () => {
    /*
     * The honest limit of the fix, kept next to the fix.
     *
     * `IME_FLAG_NO_FULLSCREEN` is advisory — AOSP's javadoc says "the flag is not
     * a guarantee, and some IMEs may ignore it" — where the portrait lock it
     * replaced was enforced by WindowManager. Verified working on Gboard 12.4.05;
     * unverified on Samsung Keyboard, SwiftKey and the Indic keyboards a large
     * share of Indian users run. This asserts the caveat survives, so nobody
     * later reads the prop as binding.
     */
    const body = read('src/components/TextField.tsx');
    expect(body).toContain('not a guarantee');
    expect(body).toContain('Gboard 12.4.05');
  });

  it('forces the prop on rather than defaulting it', () => {
    /*
     * The prop is applied AFTER the spread and removed from the public prop type.
     * Before the spread it is silently overridable; merely omitted-and-after is
     * worse still, because TypeScript would accept the prop at a call site and
     * then ignore it, so the caller reads their own code as having worked.
     */
    const body = read('src/components/TextField.tsx');
    expect(body).toContain("Omit<TextInputProps, 'disableFullscreenUI'>");
    expect(body).toMatch(/\{\.\.\.props\}\s+disableFullscreenUI/);
  });
});

describe('large screens and orientation', () => {
  /** https://developer.android.com/guide/topics/large-screens */
  it('imposes no orientation restriction', () => {
    /*
     * Inverted on 2026-08-26. This used to assert the app WAS locked to portrait
     * and carried the evidence for why. The reason — the IME's fullscreen extract
     * editor taking the whole window in landscape — is now fixed at source by
     * `src/components/TextField.tsx`, so the restriction is gone and the guidance
     * is satisfied.
     */
    expect(read(MANIFEST)).not.toMatch(/android:screenOrientation=/);
  });

  it('keeps configChanges, which matters more now than it did under the lock', () => {
    /*
     * Rotation, split screen, freeform and a folding hinge all resize the window.
     * Without these entries a configuration change becomes an activity restart,
     * and a restart rebuilds the surface — `Composer` holds its draft in local
     * state by decision, so that costs somebody's half-typed message.
     */
    const manifest = read(MANIFEST);
    for (const required of ['orientation', 'screenSize', 'keyboardHidden', 'smallestScreenSize']) {
      expect(manifest).toMatch(new RegExp(`configChanges="[^"]*${required}`));
    }
  });
});

/**
 * Two notification types (Amit, 2026-08-27):
 *   - a MessagingStyle conversation notification for a real message, promoted to
 *     the conversation section by a long-lived shortcut + a Person-bearing
 *     MessagingStyle + a matching shortcutId (miss one and it silently demotes);
 *   - a BigPictureStyle engagement nudge (an SP photo, full on expand) for when
 *     there is no message. Android allows one style per notification, so they are
 *     separate builders on separate channels.
 */
describe('message + engagement notifications', () => {
  const CONVERSATIONS = 'android/app/src/main/java/com/companionchat/Conversations.kt';

  it('builds the message notification as a conversation MessagingStyle', () => {
    const body = read(CONVERSATIONS);
    expect(body).toContain('MessagingStyle');
    expect(body).toContain('Person.Builder()');
    expect(body).toContain('ShortcutManagerCompat.pushDynamicShortcut');
    expect(body).toContain('.setShortcutId(conversationId)');
    expect(body).toContain('.setLongLived(true)');
    // Keyed on an id, not a display name: names here are user-chosen and not
    // unique, so name-matching would merge two providers into one thread.
    expect(body).toContain('.setKey(peerId)');
  });

  it('builds the engagement nudge as a BigPictureStyle on its own channel', () => {
    const body = read(CONVERSATIONS);
    expect(body).toContain('fun notifyEngagement(');
    expect(body).toContain('BigPictureStyle()');
    expect(body).toContain('.bigPicture(avatar)');
    // Hiding the large icon on expand is what makes the photo take the full width.
    expect(body).toContain('.bigLargeIcon(null');
    // A separate channel so a nudge can be silenced without silencing messages.
    expect(body).toContain('CHANNEL_ENGAGEMENT');
  });

  it('builds an incoming call as a CallStyle heads-up, not a full-screen takeover', () => {
    const body = read(CONVERSATIONS);
    expect(body).toContain('fun notifyCall(');
    expect(body).toContain('CallStyle.forIncomingCall(');
    // A heads-up popup, never full-screen: the call must not take over a running
    // foreground app (Amit, 2026-08-27). So no full-screen intent.
    expect(body).not.toContain('setFullScreenIntent');
    expect(body).toContain('CATEGORY_CALL');
    // Its own high-importance channel, separate from messages.
    expect(body).toContain('CALL_CHANNEL_ID');
    // All three types are brand-coloured (#3, "with our brand token").
    expect(body).toContain('BRAND_COLOR');
  });

  it('never stops posting when a photo cannot be fetched', () => {
    /*
     * The avatar download runs on the FCM background thread and can fail
     * (offline, timeout, 404). A missing photo must degrade to a plain
     * notification, never throw — so the loader swallows its errors to null.
     */
    const body = read(CONVERSATIONS);
    expect(body).toMatch(/loadAvatarBitmap[\s\S]*catch[\s\S]*null/);
  });

  it('declares a notification channel of its own', () => {
    /*
     * Android 8+ requires one. The app declared NONE, so Firebase's SDK fell
     * back to a generic channel named after the library — and nobody could
     * silence messages without silencing the whole app.
     */
    const body = read(CONVERSATIONS);
    expect(body).toContain('NotificationChannelCompat');
    expect(body).toContain('IMPORTANCE_HIGH');
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('channel_conversations');
  });

  it('registers the FCM background handler outside the React tree', () => {
    /*
     * A data-only message arriving with the app killed starts a headless JS
     * context that runs index.js and nothing else. A handler registered inside a
     * component or a `useEffect` is never reached and the message is dropped
     * with no error.
     */
    const entry = read('index.js');
    expect(entry).toContain('setBackgroundMessageHandler');
    expect(entry.indexOf('setBackgroundMessageHandler')).toBeLessThan(
      entry.indexOf('AppRegistry.registerComponent'),
    );
  });

  it('never puts message text in the payload or the notification', () => {
    /*
     * The body shown on a lock screen is a constant in index.js, not something
     * the server sends. Given who these conversations are with, message content
     * on a lock screen is a disclosure this product cannot make.
     */
    const fn = read('supabase/functions/send-push/index.ts');
    expect(fn).not.toMatch(/data:\s*\{[^}]*\bbody\b/s);
  });
});

/**
 * Baseline and startup profiles.
 * https://developer.android.com/topic/performance/baselineprofiles/overview
 * https://developer.android.com/topic/performance/baselineprofiles/dex-layout-optimizations
 *
 * Every part of this fails silently. A missing `profileinstaller` means the
 * profile only applies to Play installs and does nothing for a sideloaded
 * tester build. A missing `includeInStartupProfile` means no DEX layout
 * optimisation, which Google measures as the larger half of the win. A profile
 * recorded against the wrong variant matches no class names at all. None of
 * those produce an error — the app just starts as slowly as it did before.
 */
describe('startup is profiled, not guessed', () => {
  const BP = 'android/baselineprofile/build.gradle';
  const GEN =
    'android/baselineprofile/src/main/java/com/companionchat/baselineprofile/StartupProfile.kt';
  const BENCHMARK =
    'android/baselineprofile/src/main/java/com/companionchat/baselineprofile/StartupBenchmark.kt';
  const JOURNEY_BENCHMARK =
    'android/baselineprofile/src/main/java/com/companionchat/baselineprofile/CriticalJourneyBenchmark.kt';

  it('generates a startup profile, not only a baseline profile', () => {
    /*
     * `baseline-prof.txt` tells ART what to AOT-compile. `startup-prof.txt`
     * tells R8 how to order the DEX so launch classes sit together in
     * classes.dex, which cuts page faults — worth a further 15-30% per Google,
     * and the thing that matters most on mid-range hardware.
     *
     * The first generation run here omitted the flag and produced only the
     * former, which is a real win reported as the whole win.
     */
    expect(read(GEN)).toContain('includeInStartupProfile = true');
  });

  it('installs the profile on builds Play did not install', () => {
    /*
     * A baked profile is applied automatically only by a Play install. Every
     * App Distribution sideload and every `adb install` needs
     * androidx.profileinstaller to write it into ART on first run. Without it
     * the profile exists in the APK and never takes effect where we test.
     */
    expect(read('android/app/build.gradle')).toContain(
      'androidx.profileinstaller:profileinstaller',
    );
    expect(read('android/app/build.gradle')).toContain(
      'baselineProfile(project(":baselineprofile"))',
    );
  });

  it('records against the variant testers actually install', () => {
    // `internal` is `initWith release`. Recording against `debug` would profile
    // an app with different code shape and different class names.
    const gradle = read(BP);
    expect(gradle).toMatch(/buildTypes\s*\{\s*internal\s*\{/);
    expect(gradle).toContain('matchingFallbacks = ["release"]');
    expect(gradle).toContain('targetProjectPath = ":app"');
  });

  it('merges generated profiles into main so release consumes them', () => {
    /*
     * Application modules default mergeIntoMain to false. Without this, the
     * internal recording stays under src/internal and the Play release never
     * packages it.
     * https://developer.android.com/topic/performance/baselineprofiles/configure-baselineprofiles
     */
    expect(read('android/app/build.gradle')).toMatch(
      /baselineProfile\s*\{\s*mergeIntoMain\s*=\s*true\s*\}/,
    );
  });

  it('reports fully drawn only after JavaScript boot becomes usable', () => {
    /*
     * TTID is automatic; TTFD exists only when the app calls
     * Activity.reportFullyDrawn after data-backed UI is usable.
     * https://developer.android.com/topic/performance/vitals/launch-time
     */
    const native = read(
      'android/app/src/main/java/com/companionchat/StartupTimingModule.kt',
    );
    expect(native).toContain('activity.reportFullyDrawn()');
    expect(native).toContain('AtomicBoolean');
    expect(read('android/app/src/main/java/com/companionchat/InAppUpdatePackage.kt')).toContain(
      'StartupTimingModule(reactContext)',
    );
    const app = read('App.tsx');
    expect(app).toContain("boot.phase === 'loading'");
    expect(app).toContain('StartupTiming?.reportFullyDrawn()');
  });

  it('measures cold startup with and without the required profile', () => {
    const benchmark = read(BENCHMARK);
    expect(benchmark).toContain('StartupTimingMetric()');
    expect(benchmark).toContain('StartupMode.COLD');
    expect(benchmark).toContain('CompilationMode.None()');
    expect(benchmark).toContain('BaselineProfileMode.Require');
  });

  it('measures authenticated Home and Chat frames outside fixture setup', () => {
    const benchmark = read(JOURNEY_BENCHMARK);
    expect(benchmark).toContain('FrameTimingMetric()');
    expect(benchmark).toContain('fun homeScrollFrames()');
    expect(benchmark).toContain('fun openChatFrames()');
    expect(benchmark).toContain('startupMode = null');
    expect(benchmark).toContain('setupBlock = {');
    expect(read('src/screens/HomeScreen.tsx')).toContain('testID="home-scroll"');
  });

  it('keeps the recording module out of the shipped app', () => {
    // `com.android.test` output is never part of the app APK; only the generated
    // text file is consumed at build time. A `com.android.library` here would
    // ship the benchmark harness to users.
    expect(read(BP)).toContain('apply plugin: "com.android.test"');
  });
});

describe('release shrinking keeps only indirect boundaries', () => {
  const rules = read('android/app/proguard-rules.pro');

  it('does not disable optimization for the app or Google dependency trees', () => {
    expect(rules).not.toContain('-keep class com.companionchat.**');
    expect(rules).not.toContain('-keep class com.google.firebase.**');
    expect(rules).not.toContain('-keep class com.google.android.gms.**');
    expect(rules).not.toContain('-keep class androidx.credentials.**');
  });

  it('retains native WebRTC and Nitro boundaries that lack consumer rules', () => {
    expect(rules).toContain('-keep class org.webrtc.**');
    expect(rules).toContain('-keep class com.oney.WebRTCModule.**');
    expect(rules).toContain(
      '-keep class * extends com.margelo.nitro.core.HybridObject',
    );
  });
});

/**
 * Findings from the 2026-08-26 full-surface audit that became runtime fixes.
 * The audit's own record lives in docs/android-audit.md; these are the ones that
 * were code bugs rather than launch-policy gaps.
 */
describe('conversation notifications actually open the conversation', () => {
  const CONV = 'android/app/src/main/java/com/companionchat/Conversations.kt';

  it('opens by explicit component, not an unmatched implicit VIEW', () => {
    /*
     * The manifest declares exactly one VIEW filter (host=auth-callback). Once
     * the push payload goes data-only, a tapped conversation notification fires
     * its own PendingIntent; an implicit companionchat://peer/<id> matched no
     * filter and opened the launcher. An explicit intent to MainActivity needs
     * no filter and adds no externally-launchable deep-link surface.
     */
    const kt = read(CONV);
    expect(kt).toContain('Intent(context, MainActivity::class.java)');
    // The peer scheme must NOT become a manifest intent-filter — that would be a
    // BROWSABLE surface any app could fire at us.
    const manifest = read(MANIFEST);
    expect(manifest).not.toMatch(/android:host="peer"/);
  });

  it('routes the peer deep link in JS, gated by isUuid', () => {
    // The explicit intent surfaces via Linking (getInitialURL / url event), the
    // same path OAuth uses. Remote input, so it is uuid-checked before routing.
    const app = read('App.tsx');
    expect(app).toMatch(/companionchat:\/\/peer/);
    /*
     * The value that gets ROUTED must be the one that is uuid-checked, and that
     * is no longer the raw capture: bdda9ce strips a query string first so a
     * harness-augmented peer URI still opens the chat. The old assertion named
     * `isUuid(peer)` and went stale the moment the variable did - it was failing
     * on main before this merge. Asserting the STRIPPED id is checked keeps the
     * guarantee (remote input is validated before it reaches a query) without
     * pinning a variable name.
     */
    expect(app).toMatch(/peer\.split\('\?'\)/);
    expect(app).toMatch(/isUuid\(peerId\)/);
  });
});

describe('the chat transcript is readable by a screen reader', () => {
  /** https://reactnative.dev/docs/accessibility */
  it('binds the long-press affordance to a HINT, not a label', () => {
    /*
     * accessibilityLabel REPLACES concatenated child text for TalkBack. Setting
     * it to the long-press hint on every bubble made the entire transcript
     * unreadable — TalkBack announced only "Long press for message actions". A
     * hint appends on Android instead, leaving the message body to be read.
     *
     * There was a second assertion here, `not.toMatch(/accessibilityLabel=\
     * {onLongPress/)`, and it was removed on 2026-09-07 for two reasons rather
     * than one — the same pair that retired the `fontWeight` ban in
     * providerPhotos.test.ts.
     *
     * It could not fail. `git log -S 'accessibilityLabel={onLongPress' --all`
     * over Turn.tsx returns nothing: that exact expression has never been in
     * the file, in any commit, so the pattern forbade a spelling nobody had
     * written. The defect it was named for was a LABEL on the gesture wrapper,
     * which the regression would reintroduce under whatever expression came to
     * hand — `accessibilityLabel={hint}`, or a string literal — and none of
     * those match.
     *
     * And it is already covered, properly. chatSurface.test.ts › "offers the
     * same thing to a screen reader" bounds the ban to the ELEMENT: it extracts
     * the prop list of the one `<Animated.View ref={bubbleRef}>` that carries
     * the gesture and asserts that list contains `accessibilityHint=` and no
     * `accessibilityLabel` at all. That version goes red for any spelling, and
     * it has to be element-bounded because `accessibilityLabel="Dismiss
     * reactions"` on the reaction strip's backdrop is legitimate and lives in
     * the same function. Two copies of one rule is one copy to forget when the
     * rule changes, so the file-wide one is gone and the bounded one is the
     * gate.
     *
     * What stays here is the half chatSurface does NOT assert: that the hint is
     * bound to `onLongPress` specifically, which is what makes the announcement
     * describe the gesture that actually exists.
     */
    const turn = read('src/components/Turn.tsx');
    expect(turn).toMatch(/accessibilityHint=\{\s*onLongPress/);
  });
});

/**
 * Call lifecycle — foreground service, audio focus, permissions, receiver.
 * Implementing the requirements from docs/android-audit.md (call lifecycle audit 2026-08-29).
 *
 * doc: developer.android.com/develop/connectivity/telecom/self-managed
 * doc: developer.android.com/develop/background-work/services/foreground-services
 * doc: developer.android.com/about/versions/14/changes/fgs-types-required
 * doc: developer.android.com/media/optimize/audio-focus
 */
describe('call lifecycle — foreground service and permissions', () => {
  const FGS = 'android/app/src/main/java/com/companionchat/CallForegroundService.kt';
  const AUDIO_FOCUS =
    'android/app/src/main/java/com/companionchat/CallAudioFocusManager.kt';
  const SEND_CALL = 'supabase/functions/send-call/index.ts';
  const CALL_DIAGNOSTICS =
    'android/app/src/main/java/com/companionchat/CallDiagnosticsModule.kt';

  it('declares MANAGE_OWN_CALLS, FOREGROUND_SERVICE, and all three FGS-type permissions', () => {
    /*
     * MANAGE_OWN_CALLS is the OS prerequisite that unlocks
     * FOREGROUND_SERVICE_TYPE_PHONE_CALL on API 34+. All four must be present.
     * (developer.android.com/develop/connectivity/telecom/self-managed)
     * (developer.android.com/about/versions/14/changes/fgs-types-required)
     */
    const manifest = read(MANIFEST);
    expect(manifest).toContain('android.permission.MANAGE_OWN_CALLS');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_PHONE_CALL');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MICROPHONE');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_CAMERA');
  });

  it('declares CallForegroundService with all three foregroundServiceType values', () => {
    /*
     * API 34+ enforces the type mask; the service element must declare the
     * maximum capability set so the OS permits each type at runtime.
     * (developer.android.com/develop/background-work/services/foreground-services)
     */
    const manifest = read(MANIFEST);
    expect(manifest).toContain('android:name=".CallForegroundService"');
    expect(manifest).toMatch(/foregroundServiceType="phoneCall\|microphone\|camera"/);
  });

  it('declares CallActionReceiver in the manifest', () => {
    // The receiver must be registered so the OS delivers PendingIntent broadcasts
    // from the CallStyle notification's answer/decline/hang-up buttons.
    const manifest = read(MANIFEST);
    expect(manifest).toContain('android:name=".CallActionReceiver"');
    expect(manifest).toContain('com.companionchat.ACTION_ANSWER_CALL');
    expect(manifest).toContain('com.companionchat.ACTION_DECLINE_CALL');
    expect(manifest).toContain('com.companionchat.ACTION_HANG_UP');
  });

  it('registers and unregisters Android NetworkCallback for call evidence', () => {
    const diagnostics = read(CALL_DIAGNOSTICS);
    expect(diagnostics).toContain('registerDefaultNetworkCallback');
    expect(diagnostics).toContain('onCapabilitiesChanged');
    expect(diagnostics).toContain('unregisterNetworkCallback');
    expect(diagnostics).not.toContain('linkProperties');
    expect(read('android/app/src/main/java/com/companionchat/InAppUpdatePackage.kt'))
      .toContain('CallDiagnosticsModule(reactContext)');
  });

  it('creates the calls channel before promoting the service', () => {
    /*
     * Regression, found on a device 2026-08-31: every OUTGOING call killed the
     * app with
     *   RemoteServiceException$CannotPostForegroundServiceNotificationException
     *   ("Bad notification for startForeground") → SIGKILL.
     *
     * The service posts on Conversations.CALL_CHANNEL_ID, but that channel was
     * only created inside Conversations.notifyCall() — the INCOMING path. On an
     * outgoing call the channel had never been created, and API 26+ drops a
     * notification aimed at a channel that does not exist.
     * (developer.android.com/develop/ui/views/notifications/channels)
     *
     * The guarantee belongs to whoever posts, so the check is "ensureCallChannel
     * is called, and before startForeground".
     */
    const fgs = read(FGS);
    expect(fgs).toContain('Conversations.ensureCallChannel(this)');
    expect(fgs).toContain('Conversations.ensureCallOngoingChannel(this)');
    // lastIndexOf, because the KDoc at the top of the file also names
    // ServiceCompat.startForeground(); we want the call, not the prose.
    expect(fgs.indexOf('Conversations.ensureCallChannel(this)')).toBeLessThan(
      fgs.lastIndexOf('ServiceCompat.startForeground('),
    );
  });

  it('posts an in-progress call on a low-importance channel', () => {
    /*
     * Importance is a channel property on API 26+, so an ongoing call posted on
     * the IMPORTANCE_HIGH ring channel heads-up — which threw a "Hang up" banner
     * over the app's own call screen the moment a call was placed. A ring should
     * interrupt; a call already in progress should not.
     * (developer.android.com/develop/ui/views/notifications/channels)
     */
    const conversations = read(
      'android/app/src/main/java/com/companionchat/Conversations.kt',
    );
    expect(conversations).toContain('const val CALL_ONGOING_CHANNEL_ID = "call_ongoing"');
    expect(conversations).toMatch(
      /Builder\(CALL_ONGOING_CHANNEL_ID, NotificationManagerCompat\.IMPORTANCE_LOW\)/,
    );
    // The ring itself stays HIGH.
    expect(conversations).toMatch(
      /Builder\(CALL_CHANNEL_ID, NotificationManagerCompat\.IMPORTANCE_HIGH\)/,
    );

    const fgs = read(FGS);
    expect(fgs).toContain('Conversations.CALL_ONGOING_CHANNEL_ID');
  });

  it('picks the CallStyle from the real call direction, never a hardcoded true', () => {
    /*
     * Regression, seen on a device 2026-08-31: the caller got an "Incoming call
     * — Decline / Answer" heads-up over their own outgoing call screen, because
     * the whole chain hardcoded is_incoming = true.
     *
     * forIncomingCall is for a ringing phone; forOngoingCall is for a call in
     * progress.
     * (developer.android.com/develop/ui/views/notifications/call-style)
     */
    const fgs = read(FGS);
    expect(fgs).toContain('putExtra(EXTRA_IS_INCOMING, isIncoming)');
    expect(fgs).not.toContain('putExtra(EXTRA_IS_INCOMING, true)');
    expect(fgs).toContain('CallStyle\n');

    // JS passes the direction rather than defaulting it.
    const screen = read('src/screens/CallScreen.tsx');
    expect(screen).toContain("startCallForegroundService(name, direction === 'in')");
  });

  it('CallForegroundService exists and uses ServiceCompat.startForeground', () => {
    /*
     * ServiceCompat.startForeground() is the back-compat path: on pre-API-29
     * it calls the two-arg form; on API 34+ it passes the type mask.
     * Requires androidx.core:core:1.12+.
     * (developer.android.com/develop/background-work/services/foreground-services)
     */
    const fgs = read(FGS);
    expect(fgs).toContain('ServiceCompat.startForeground(');
    // minSdk 24 cannot call Context.startForegroundService (API 26) directly.
    expect(fgs).toContain('ContextCompat.startForegroundService(context, intent)');
    expect(fgs).not.toContain('context.startForegroundService(intent)');
    // The FGS must never use fullScreenIntent — the platform test for
    // Conversations.kt already asserts its absence from the ring notification.
    expect(fgs).not.toContain('setFullScreenIntent');
  });

  it('CallAudioFocusManager guards AudioFocusRequest on API 26+', () => {
    /*
     * minSdk is 24; AudioFocusRequest is API 26+. An unguarded call is a
     * NoSuchMethodError on API 24-25 at runtime.
     * (developer.android.com/media/optimize/audio-focus)
     */
    const af = read(AUDIO_FOCUS);
    expect(af).toMatch(/Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.O/);
    expect(af).toContain('AUDIOFOCUS_GAIN_TRANSIENT');
    expect(af).toContain('USAGE_VOICE_COMMUNICATION');
    expect(af).toContain('MODE_IN_COMMUNICATION');
    // Audio focus is abandoned on call end (restore MODE_NORMAL).
    expect(af).toContain('abandonCallFocus');
    expect(af).toContain('MODE_NORMAL');
  });

  it('ring timeout is 30 s in the FCM send function', () => {
    /*
     * FCM TTL must be 30 s so a stale call push is dropped by FCM rather than
     * ringing the callee long after the caller gave up.
     * (android-audit.md 2026-08-29 — target is 30 s)
     */
    const sendCall = read(SEND_CALL);
    expect(sendCall).toContain("ttl: '30s'");
    expect(sendCall).not.toContain("ttl: '45s'");
  });

  it('notification-driven call answer parses medium from the deep-link URL', () => {
    /*
     * Before the fix, App.tsx hardcoded medium: 'voice' for notification-answer
     * deep links, dropping video for any call answered from the notification.
     * (android-audit.md 2026-08-29)
     */
    const app = read('App.tsx');
    // Must read medium from the query string, not use a literal 'voice'
    // in the callMatch branch. The regex checks for medium= extraction.
    expect(app).toMatch(/medium.*=.*qs\.match.*medium=.*\?.*'voice'/s);
  });

  it('dataExtractionRules is declared on the application element', () => {
    /*
     * allowBackup=false alone does not stop D2D transfer on Android 12+.
     * The dataExtractionRules file with an empty device-transfer block is
     * required. (developer.android.com/about/versions/12/behavior-changes-12#backup-restrictions)
     */
    const manifest = read(MANIFEST);
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });
});

/**
 * Play Billing Library 9.1 / User Choice Billing.
 *
 * ADR-0022: India User-Choice Billing — Play + Cashfree.
 * doc: developer.android.com/google/play/billing/integrate
 * doc: developer.android.com/google/play/billing/user-choice-billing
 */
describe('device coverage matrix', () => {
  /** https://developer.android.com/develop/ui/views/layout/use-window-size-classes */
  it('encodes the published window size class breakpoints', () => {
    const source = read('src/lib/windowSize.ts');
    expect(source).toContain('WIDTH_MEDIUM_MIN = 600');
    expect(source).toContain('WIDTH_EXPANDED_MIN = 840');
    expect(source).toContain('developer.android.com/develop/ui/views/layout/use-window-size-classes');
  });

  it('keeps the tab bar icon-only so 200% font scale cannot overflow it', () => {
    // The audit's 49dp-at-2x finding was a labelled tab row. The bar is now
    // glyphs only; text scale has nothing to grow.
    const bar = read('src/components/FloatingToolbar.tsx');
    expect(bar).not.toMatch(/<Text[\s\S]*tab\.label/);
    expect(bar).toContain('<Icon');
    expect(read('src/components/Icon.tsx')).toContain('allowFontScaling={false}');
  });

  it('implements the approved profile-first You settings destination', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    const bar = read('src/components/FloatingToolbar.tsx');

    // WhatsApp reference approved 2026-09-01: identity precedes utility rows,
    // and the bottom destination names the person rather than the mechanism.
    expect(bar).toContain("key: 'settings', glyph: 'person', label: 'You'");
    expect(settings).toContain('style={styles.profileHero}');
    expect(settings).toContain('style={styles.profileIdentity}');
    // The member account-type label under the avatar was removed (Amit,
    // 2026-09-02): it stated the obvious. Providers keep 'Provider account'; the
    // identity meta now renders only what's meaningful, via profileMetaText.
    expect(settings).not.toContain('Private member account');
    expect(settings).toContain('profileMetaText');

    // Coverless centred-avatar header (Amit, on device: the WhatsApp half-doodle
    // cover was dated). No ChatWallpaper band; the identity sits on the page. The
    // pushed case still gets a compact transparent M3 bar with a real 48dp Back.
    expect(settings).toContain('<TopAppBar');
    expect(settings).toContain('title=""');
    expect(settings).toContain('transparent');
    expect(settings).toContain('testID="settings-back"');
    expect(settings).toContain('size={48}');
    expect(settings).not.toContain('<ChatWallpaper />');
  });

  it('keeps each settings item a single 48dp+ icon/content/trailing target', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    // M3 list slots: leading stays narrower than dominant content; the outer
    // Pressable is the only action target. https://m3.material.io/components/lists/specs
    expect(settings).toContain('function SettingsRowContent');
    expect(settings).toMatch(/row:\s*{[\s\S]*?minHeight:\s*64/);
    expect(settings).toMatch(/rowCopy:\s*{[\s\S]*?flex:\s*1/);
    // The leading icon uses styles.iconBox (danger rows add a tinted disc via
    // an array style, so match the token rather than the exact expression).
    expect(settings).toContain('styles.iconBox');
    expect(settings).toContain("import { Divider } from '../components/Divider'");
    // Dividers separate rows, and align to where the title starts rather than
    // borrowing the avatar list's 72dp. https://m3.material.io/components/divider/specs
    expect(settings).toContain('<Divider variant="inset" insetStart={ROW_TEXT_INSET} />');
    expect(settings).toMatch(/const ROW_TEXT_INSET = 32 \+ TOKENS\.space\.sm/);
    expect(settings).not.toContain('<Divider variant="inset" />');
    expect(settings).toContain('icon="logout"');
    expect(settings).toContain('choiceSheet === \'presence\'');
    expect(settings).toContain('choiceSheet === \'theme\'');
  });

  /**
   * M3 NavigationBar clips the press state layer to the indicator shape, not
   * the full-width slot — a rectangular slot fill is what read as "square on
   * touch". https://m3.material.io/foundations/interaction/states/state-layers
   */
  it('clips tab press feedback to a pill indicator, not the full slot', () => {
    const bar = read('src/components/FloatingToolbar.tsx');
    expect(bar).toContain('borderRadius: 16');
    expect(bar).toContain('styles.indicator');
    expect(bar).toMatch(/style=\{styles\.slot\}/);
    expect(bar).toContain('size={48}');
  });

  it('hides the bottom bar on a push instead of rebuilding it', () => {
    // The bar is `position: 'absolute'`, so it never took layout from the
    // content area — the conditional render bought nothing and cost a native
    // RenderEffect blur surface plus eight animated children, destroyed and
    // rebuilt on every push and every pop, inside the transition frame.
    const bar = read('src/components/FloatingToolbar.tsx');
    expect(bar).toContain("hidden: { display: 'none' }");
    expect(bar).toMatch(/pointerEvents=\{visible \? 'auto' : 'none'\}/);
    expect(bar).toMatch(/visible \? null : styles\.hidden/);

    const app = read('App.tsx');
    // Rendered unconditionally now, with visibility derived from the exhaustive
    // route classifier rather than a hand-written list of names that a new
    // route can silently fall out of.
    expect(app).toMatch(/<FloatingToolbar\n\s+active=\{activeTab\}\n\s+visible=\{transitionFor\(route\) !== 'push'\}/);
    expect(app).not.toMatch(/route\.name === 'favourites' \? \(\s*<FloatingToolbar/);
    // The highlighted tab sticks while hidden, so a hidden bar never animates
    // its indicator.
    expect(app).toContain('const lastTabRef = useRef<ToolbarKey>');
    expect(app).toMatch(/if \(tabFor !== null\) \{\s*\n\s*lastTabRef\.current = tabFor;/);
  });

  it('ships the frame-timing tool MainActivity cites', () => {
    // MainActivity's refresh-rate note has pointed at this script since the vote
    // landed — "reports each window's block from dumpsys gfxinfo framestats
    // separately for exactly this reason" — while the file did not exist. A
    // comment naming a tool nobody can run is a claim a reader cannot check.
    const activity = read(
      'android/app/src/main/java/com/companionchat/MainActivity.kt',
    );
    expect(activity).toContain('scripts/framestats.mjs');
    expect(existsSync(join(ROOT, 'scripts/framestats.mjs'))).toBe(true);

    const script = read('scripts/framestats.mjs');
    // The claim MainActivity makes is specifically about PER-WINDOW blocks: an
    // RN <Modal> is its own window with its own refresh-rate vote.
    expect(script).toContain('---PROFILEDATA---');
    expect(script).toMatch(/Window:\\s\*\(\.\+\)/);
    // Columns BY NAME. The Redmi (API 29) emits 16 columns and no
    // GpuCompleted; a positional read would take the wrong column on one of the
    // two phones this project ships to.
    expect(script).toContain("column('FrameCompleted')");
    expect(script).toContain("column('IntendedVsync')");
    expect(script).not.toMatch(/cells\[13\]|cells\[1\]/);
    // And the budget is derived from the observed vsync period, not hardcoded
    // to 8.33ms — which would fail every frame on a 60Hz panel.
    expect(script).toContain("arg('budget', vsyncPeriod)");

    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['android:framestats']).toBe('node scripts/framestats.mjs');
  });

  it('has an OAuth client for EVERY certificate the app can ship with', () => {
    /*
     * Google Sign-In binds to the SIGNING CERTIFICATE, and this app ships under
     * three of them. Miss one and sign-in fails only on the builds signed with
     * it, which is how this has now broken twice:
     *
     *   5e8f1606…  debug key       — `assembleDebug`, Metro on a dev phone
     *   4910a1ff…  upload key      — internal/closedTest APKs, sideload downloads
     *   84b2e9bc…  PLAY APP SIGNING — every build Play delivers, because Play
     *                                 re-signs the AAB with its own key
     *
     * On 2026-09-07 `google-services.json` carried clients for the first two
     * only. Registering the third SHA in Firebase on 2026-09-01 had NOT caused
     * an OAuth client to be created, and the file was byte-for-byte in sync with
     * live Firebase — so nothing in the repo looked wrong. Closed testers simply
     * could not sign in, and the symptom (Credential Manager returning no
     * credentials) pointed at code that was correct.
     *
     * This is the gate that makes it loud. It fails the build, not a tester's
     * sign-in attempt, and it names which certificate lost its client.
     *
     * Re-download with:
     *   gcloud auth application-default login --scopes=…/androidpublisher,…/cloud-platform
     *   curl -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
     *        -H "x-goog-user-project: chat-d8c87" \
     *        "https://firebase.googleapis.com/v1beta1/projects/chat-d8c87/androidApps/<appId>/config"
     * and base64-decode `configFileContents`.
     */
    const REQUIRED: Record<string, string> = {
      '5e8f16062ea3cd2c4a0d547876baa6f38cabf625': 'debug key (assembleDebug)',
      '4910a1ff7ac9cb1ab11bb46386bf6a7ec4726553': 'upload key (internal, closedTest, sideload)',
      '84b2e9bc7b777b02b010b4d32f0e38ead3b3da2d': 'PLAY APP SIGNING (every Play-delivered build)',
    };
    const cfg = JSON.parse(read('android/app/google-services.json')) as {
      client: {
        client_info: { android_client_info: { package_name: string } };
        oauth_client: { client_type: number; android_info?: { certificate_hash: string } }[];
      }[];
    };
    const present = new Set<string>();
    for (const client of cfg.client) {
      expect(client.client_info.android_client_info.package_name).toBe('com.companionchat');
      for (const oauth of client.oauth_client) {
        if (oauth.client_type === 1 && oauth.android_info) {
          present.add(oauth.android_info.certificate_hash.toLowerCase());
        }
      }
    }
    for (const [sha, why] of Object.entries(REQUIRED)) {
      // If this fails, an OAuth client is missing for that certificate and every
      // build signed with it cannot do Google Sign-In.
      expect({ sha, why, present: present.has(sha) }).toEqual({ sha, why, present: true });
    }
  });

  /** https://developer.android.com/guide/components/activities/testing */
  it('ships a hermetic ActivityScenario launch smoke test', () => {
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"');
    expect(gradle).toContain('androidx.test:core');
    const smoke = read(
      'android/app/src/androidTest/java/com/companionchat/LaunchSmokeTest.kt',
    );
    expect(smoke).toContain('ActivityScenario.launch(MainActivity::class.java)');
    expect(smoke).toContain('Lifecycle.State.RESUMED');
    expect(smoke).not.toContain('welcome-continue');
  });

  it('embeds the JS bundle in debug so device QA does not depend on Metro', () => {
    // Empty debuggableVariants → debug runs createBundleDebugJsAndAssets.
    // Skipping that is what produced "Unable to load script" the moment
    // `adb reverse` dropped under Maestro clearState.
    const gradle = read('android/app/build.gradle');
    // The default (no property) is the empty list; `-PmetroHotReload` is the
    // only way to get a Metro-served debug build, and it must be asked for.
    expect(gradle).toMatch(
      /debuggableVariants\s*=\s*project\.hasProperty\("metroHotReload"\)\s*\?\s*\["debug"\]\s*:\s*\[\s*\]/,
    );
    expect(read('scripts/qa-device.sh')).toContain('installDebug');
  });

  it('covers font scale and expanded windows in Maestro', () => {
    expect(read('.maestro/07-font-scale.yaml')).toContain('nav-home');
    expect(read('.maestro/08-large-screen.yaml')).toContain('1280x800');
    const e2e = read('scripts/e2e.mjs');
    expect(e2e).toContain('07-font-scale.yaml');
    expect(e2e).toContain('08-large-screen.yaml');
    expect(e2e).toContain('API 24');
  });
});

describe('Play Billing / UCB', () => {
  test('billing-ktx 9.1.0 is declared in app/build.gradle', () => {
    expect(read('android/app/build.gradle')).toContain('billing-ktx:9.1.0');
  });

  test('Kotlin plugin is 2.2.10 or above (required by billing-ktx 9.1)', () => {
    const rootGradle = read('android/build.gradle');
    // Extract version string and verify major.minor.patch >= 2.2.10
    const match = rootGradle.match(/kotlinVersion\s*=\s*"(\d+)\.(\d+)\.(\d+)"/);
    expect(match).not.toBeNull();
    const major = parseInt(match![1]!, 10);
    const minor = parseInt(match![2]!, 10);
    const patch = parseInt(match![3]!, 10);
    const version = major * 10000 + minor * 100 + patch;
    // 2.2.10 = 20210
    expect(version).toBeGreaterThanOrEqual(2 * 10000 + 2 * 100 + 10);
  });
});

describe('Cashfree WebCheckout — Android package visibility', () => {
  /**
   * Android 11 (API 30) introduced package visibility restrictions. Without
   * <queries> declarations, intents to UPI apps resolve to nothing and the
   * Cashfree SDK cannot detect installed UPI apps.
   *
   * doc: https://www.cashfree.com/docs/payments/online/mobile/android
   * doc: https://developer.android.com/training/package-visibility
   */
  it('declares <queries> for UPI app package names (Android 11+ visibility)', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('<queries>');
    // Google Pay, PhonePe, Paytm, BHIM packages — required by Cashfree Android doc.
    expect(manifest).toContain('com.google.android.apps.nbu.paisa.user');
    expect(manifest).toContain('com.phonepe.app');
    expect(manifest).toContain('net.one97.paytm');
    // UPI intent scheme so any future UPI app is also resolvable.
    expect(manifest).toContain('android:scheme="upi"');
  });

  it('Cashfree SDK is in root package.json (RULE 5 — dep has a reason)', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toContain('react-native-cashfree-pg-sdk');
  });
});

describe('Cashfree 1-Click Onboarding — native verification bridge', () => {
  /**
   * Provider payout setup uses Cashfree's Verification Suite native SDK, not a
   * hand-rolled webview (RULE 1: prefer the platform's own solution). The exact
   * coordinate and API were read from the compiled 1.0.1 AAR, because the SDK's
   * README advertises a stale coordinate (com.cashfree.kyc:sdk) and a stale API.
   * https://www.cashfree.com/docs/api-reference/vrs/v2/1-click-onboarding/1-click-onboarding-sdk#android-native
   */
  it('adds the Cashfree Maven repo (the VRS SDK 404s on Maven Central)', () => {
    expect(read('android/build.gradle')).toContain('https://maven.cashfree.com/release');
  });

  it('depends on the VRS SDK by its real coordinate', () => {
    expect(read('android/app/build.gradle')).toContain(
      'com.cashfree.vrs:kyc-verification:1.0.1',
    );
  });

  it('registers the native module so the JS bridge resolves', () => {
    expect(
      read('android/app/src/main/java/com/companionchat/InAppUpdatePackage.kt'),
    ).toContain('CashfreeOnboardingModule(reactContext)');
  });

  it('calls the AAR-verified API, not the stale README API', () => {
    const module = read(
      'android/app/src/main/java/com/companionchat/CashfreeOnboardingModule.kt',
    );
    // The real 1.0.1 surface — Builder → set callback → open.
    expect(module).toContain('CFVerificationService.Builder()');
    expect(module).toContain('set1ClickOnboardingCallback');
    expect(module).toContain('open1ClickOnboarding(sessionId, env)');
    // The stale README API is not IMPORTED or CALLED (it may be named in a
    // comment that warns against it, which is why this checks imports, not text).
    expect(module).not.toContain('import com.cashfree.kyc_verification_core.services.CFKycVerificationService');
    expect(module).not.toContain('CFVerificationService.Builder().setContext(activity).build().doVerification');
  });
});

describe('sheet motion and display refresh', () => {
  it('asks the display for its highest refresh mode', () => {
    // https://developer.android.com/develop/ui/views/animations/frame-rate
    const body = read(MAIN_ACTIVITY);
    expect(body).toContain('preferredDisplayModeId');
    expect(body).toContain('supportedModes');
    expect(body).toContain('preferHighestRefreshRate()');
  });

  it('blurs the activity behind a sheet via RenderEffect, not a screenshot', () => {
    const chrome = read('android/app/src/main/java/com/companionchat/WindowChromeModule.kt');
    expect(chrome).toContain('RenderEffect.createBlurEffect');
    expect(chrome).toContain('Build.VERSION_CODES.S');
    expect(read('android/app/src/main/java/com/companionchat/InAppUpdatePackage.kt')).toContain(
      'WindowChromeModule',
    );
    expect(read('src/components/Sheet.tsx')).toContain('setSheetBackdropBlur');
  });
});

/**
 * Every gesture callback runs on the UI thread.
 *
 * A gesture callback that is NOT workletized still works — it is dispatched to
 * JS instead, one round trip per frame. Nothing throws, nothing warns, and the
 * only symptom is that a drag lags the finger, which is the class of failure
 * RULE 2 says a green build cannot see. So it is asserted here rather than
 * noticed on a device.
 *
 * The mechanism, and why it is worth pinning. RNGH 3's hook API takes callbacks
 * as properties of a config object, and it is `react-native-worklets`' babel
 * plugin that adds the `'worklet'` directive to them: `useTapGesture`,
 * `usePanGesture`, `usePinchGesture`, `useLongPressGesture` and the rest are
 * listed in `gestureHandlerObjectHooks`, argument 0 of each is registered as a
 * workletizable OBJECT, and `forEachWorkletizableObjectProperty` then
 * workletizes every function-valued property of it — no allow-list of callback
 * names, which is why `onActivate` / `onUpdate` / `onDeactivate` all get the
 * treatment without the plugin knowing those names
 * (node_modules/react-native-worklets/plugin/index.js).
 *
 * Two ways that can break silently, both covered by compiling the real files
 * through the real config rather than by reading the plugin's tables:
 *
 *  1. A worklets upgrade drops a hook name from `gestureHandlerObjectHooks`.
 *  2. Someone passes a config the plugin cannot see through — a spread, a
 *     variable built elsewhere, a `useMemo` — because only argument 0 as an
 *     object literal (or an identifier resolving to one) is traversed.
 *
 * https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/
 * https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/glossary#worklet
 */
describe('gesture callbacks are workletized by the worklets plugin', () => {
  const GESTURE_FILES = [
    'src/components/MediaViewer.tsx',
    'src/components/Turn.tsx',
    'src/components/Sheet.tsx',
    'src/components/SpotlightCard.tsx',
  ];

  /**
   * The callback properties, matched on the NAME alone.
   *
   * Not `name:\s*function`, which was the first version of this and was a
   * tautology: the plugin replaces a workletized property with a factory
   * `function`, so requiring `function` matched only the callbacks that had
   * already passed. An un-workletized arrow was simply not found, and the check
   * fell through to the count assertion below — the right verdict by the wrong
   * route, and only because that count guard existed.
   */
  const CALLBACK = /(onActivate|onUpdate|onDeactivate|onFinalize):/g;

  const compiled = (relative: string): string => {
    // Required lazily: pulling babel into every suite in this file would cost
    // more than the one assertion below is worth.
    const babel = require('@babel/core');
    const out = babel.transformSync(read(relative), {
      filename: join(ROOT, relative),
      cwd: ROOT,
      root: ROOT,
      configFile: join(ROOT, 'babel.config.js'),
    });
    expect(out?.code).toBeTruthy();
    return String(out.code);
  };

  it.each(GESTURE_FILES)('%s', file => {
    const out = compiled(file);
    const found = [...out.matchAll(CALLBACK)];
    // Guard the guard: a rename that made the pattern match nothing would let
    // this pass vacuously.
    expect(found.length).toBeGreaterThan(0);

    found.forEach((match, i) => {
      /*
       * `__workletHash` and `__closure` are the plugin's own markers on a
       * rewritten function, and they sit inside the factory the property was
       * replaced with. The slice runs to the NEXT callback property rather than
       * a fixed window, so a long body cannot push the markers out of view and a
       * neighbour's markers cannot be read as this one's.
       */
      const end = found[i + 1]?.index ?? out.length;
      const fn = out.slice(match.index, end);
      expect(fn).toContain('__workletHash');
      expect(fn).toContain('__closure');
    });
  });

  it('leaves nothing on the deprecated builder to be workletized instead', () => {
    /*
     * The plugin still carries `gestureHandlerBuilderMethods` (`onStart`,
     * `onChange`, `onEnd`, ...) for the `Gesture.*` API, so a file that slid
     * back to the builder would keep working and would keep passing the test
     * above. Named here so the two halves of the migration fail together.
     */
    for (const file of GESTURE_FILES) {
      expect(code(file)).not.toMatch(/\bGesture\.\w+\(/);
    }
  });
});

/**
 * A `src/lib` helper called from inside a UI-runtime worklet carries `'worklet'`.
 *
 * The failure this guards is a hard native crash that jest cannot see: a plain
 * function referenced inside `useAnimatedStyle` / `useDerivedValue` /
 * `useAnimatedReaction` is shipped to the UI runtime as a "remote function"
 * stub, and calling it throws `[Worklets] Tried to synchronously call a Remote
 * Function` on the first frame — the whole process dies. `bloom.ts`'s
 * `layerProgress` has warned about this in prose since 2026-08; the prose did
 * not stop `nightSky.ts`'s `cometFade` shipping without the directive on
 * 2026-09-12, which put "Pappal keeps stopping" on every onboarding launch of
 * the 10121/10122 builds. Hence a mechanical check.
 *
 * Method: for every component/screen, take each worklet-hook callback body
 * (balanced-brace scan from the hook call), collect the identifiers it CALLS
 * that were imported from `../lib/*`, and require the exporting function to
 * open with the directive. Regex on source, like the rest of this file — the
 * babel route above proves the plugin marks a function; this proves the author
 * asked it to.
 * https://docs.swmansion.com/react-native-worklets/docs/guides/troubleshooting#tried-to-synchronously-call-a-remote-function
 * https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/glossary#worklet
 */
describe('lib helpers called inside UI-thread worklets carry the directive', () => {
  const HOOKS = /\b(useAnimatedStyle|useDerivedValue|useAnimatedReaction|useAnimatedProps)\s*\(/g;
  const uiFiles = ['src/components', 'src/screens'].flatMap(dir =>
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.tsx'))
      .map(f => `${dir}/${f}`),
  );

  /** The text of the balanced `( ... )` starting at `open` (index of the paren). */
  const balanced = (src: string, open: number): string => {
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '(' || ch === '{' || ch === '[') {
        depth += 1;
      } else if (ch === ')' || ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          return src.slice(open, i + 1);
        }
      }
    }
    return src.slice(open);
  };

  /** `name -> lib module path` for every `import { ... } from '../lib/x'`. */
  const libImports = (src: string): Map<string, string> => {
    const map = new Map<string, string>();
    const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'(\.\.\/lib\/[^']+)'/g;
    for (const m of src.matchAll(IMPORT)) {
      const names = m[1] ?? '';
      const from = m[2] ?? '';
      for (const raw of names.split(',')) {
        const spec = raw.trim();
        if (spec === '' || spec.startsWith('type ')) {
          continue;
        }
        const local = (spec.split(/\s+as\s+/)[1] ?? spec).trim();
        map.set(local, from);
      }
    }
    return map;
  };

  /** Whether the exported function `name` in `libPath` opens with `'worklet'`. */
  const hasDirective = (libPath: string, name: string): boolean => {
    const lib = code(`src/lib/${libPath.replace('../lib/', '')}.ts`);
    const fn = new RegExp(
      `export\\s+function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{\\s*'worklet';`,
    );
    const arrow = new RegExp(
      `export\\s+const\\s+${name}\\s*=\\s*\\([^)]*\\)[^=]*=>\\s*\\{\\s*'worklet';`,
    );
    return fn.test(lib) || arrow.test(lib);
  };

  it('finds at least one worklet call site to check', () => {
    // Guard the guard: a hook rename that made the pattern match nothing
    // would let every case below pass vacuously.
    const total = uiFiles.reduce(
      (n, f) => n + [...code(f).matchAll(HOOKS)].length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it.each(uiFiles)('%s', file => {
    const src = code(file);
    const imports = libImports(src);
    const offenders: string[] = [];
    for (const m of src.matchAll(HOOKS)) {
      const body = balanced(src, (m.index ?? 0) + m[0].length - 1);
      for (const [name, from] of imports) {
        if (new RegExp(`\\b${name}\\s*\\(`).test(body) && !hasDirective(from, name)) {
          offenders.push(`${name} from ${from}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * CameraX live-preview native view — wiring and safety assertions.
 *
 * The requirements that follow are structural (RULE 1: take them from the
 * platform docs, do not ask). Each claim names the doc that governs it.
 *
 * COMPATIBLE (TextureView) mode is required for the rounded-tile design:
 * PERFORMANCE (SurfaceView) punches a hole through the view hierarchy and
 * cannot be clipped, rounded, or animated.
 * https://developer.android.com/reference/androidx/camera/view/PreviewView.ImplementationMode
 *
 * Camera lifecycle is tied to the Activity LifecycleOwner so CameraX stops
 * the camera when the activity pauses (app backgrounds) and restarts it on
 * resume — without any manual observer.
 * https://developer.android.com/training/camerax/lifecycle
 */
describe('CameraX live-preview tile', () => {
  const PACKAGE_KT =
    'android/app/src/main/java/com/companionchat/CameraTilePackage.kt';
  const APP_KT =
    'android/app/src/main/java/com/companionchat/MainApplication.kt';

  it('declares all four CameraX 1.4.0 artifacts in app/build.gradle', () => {
    /**
     * All four artifacts must be pinned at the same version so their
     * inter-artifact ABIs match. Mixing versions silently breaks surface
     * negotiation between camera-core and camera-camera2.
     * https://developer.android.com/training/camerax/preview
     */
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('androidx.camera:camera-core:1.4.0');
    expect(gradle).toContain('androidx.camera:camera-camera2:1.4.0');
    expect(gradle).toContain('androidx.camera:camera-lifecycle:1.4.0');
    expect(gradle).toContain('androidx.camera:camera-view:1.4.0');
  });

  it('registers CameraTilePackage in MainApplication', () => {
    // The package must be registered next to the other non-autolinkable
    // packages so the JS bridge can resolve PappalCameraPreview at runtime.
    expect(read(APP_KT)).toContain('add(CameraTilePackage())');
  });

  it('names the view manager PappalCameraPreview', () => {
    expect(read(PACKAGE_KT)).toContain('"PappalCameraPreview"');
  });

  it('uses COMPATIBLE implementation mode (TextureView, not SurfaceView)', () => {
    /**
     * COMPATIBLE mode is required for a rounded, animatable tile. SurfaceView
     * (PERFORMANCE) punches a transparent hole through the view hierarchy and
     * cannot be clipped, rounded, or composited.
     * https://developer.android.com/reference/androidx/camera/view/PreviewView.ImplementationMode
     */
    expect(read(PACKAGE_KT)).toContain('ImplementationMode.COMPATIBLE');
    expect(read(PACKAGE_KT)).not.toContain('ImplementationMode.PERFORMANCE');
  });

  it('binds only the Preview use case — no capture or analysis', () => {
    /**
     * This tile is a viewfinder only. Capture goes through the existing
     * react-native-image-picker launchCamera path. Adding ImageCapture,
     * ImageAnalysis, or VideoCapture would open a second competing camera
     * session and fail on most devices. The assertion checks imports rather
     * than raw string presence so comments that name excluded classes do not
     * trigger a false positive.
     */
    const pkg = read(PACKAGE_KT);
    expect(pkg).toContain('Preview.Builder()');
    // None of the non-preview use case symbols are imported.
    expect(pkg).not.toContain('import androidx.camera.core.ImageCapture');
    expect(pkg).not.toContain('import androidx.camera.core.ImageAnalysis');
    expect(pkg).not.toContain('import androidx.camera.video.VideoCapture');
  });

  it('unbinds the camera on view detach and in onDropViewInstance', () => {
    /**
     * A camera left bound after the view is gone shows the OS camera-in-use
     * indicator (green dot, API 29+) indefinitely and wastes battery.
     * Both teardown paths must call unbindAll.
     * https://developer.android.com/training/camerax/lifecycle
     */
    const pkg = read(PACKAGE_KT);
    expect(pkg).toContain('unbindAll()');
    expect(pkg).toContain('onDropViewInstance');
    expect(pkg).toContain('onViewDetachedFromWindow');
  });

  it('resolves the LifecycleOwner defensively and logs rather than crashes', () => {
    /**
     * ThemedReactContext.currentActivity is not guaranteed to implement
     * LifecycleOwner (a non-standard host might not). The cast must be
     * defensive so a missing LifecycleOwner leaves the preview blank, not
     * dead — crashing the host Activity over a viewfinder is not acceptable.
     * https://developer.android.com/training/camerax/lifecycle
     */
    const pkg = read(PACKAGE_KT);
    expect(pkg).toMatch(/as\? LifecycleOwner/);
    // When the cast fails we log and return, not throw.
    expect(pkg).toContain('Log.w(TAG');
  });

  it('does not request CAMERA permission from native code', () => {
    /**
     * Permission flow is owned by the JS layer via src/lib/permissions.ts.
     * Native code requesting permissions would bypass the JS rationale UI and
     * fight the JS permission state. The native view renders blank when the
     * permission is absent (SecurityException is caught, not rethrown).
     */
    const pkg = read(PACKAGE_KT);
    expect(pkg).not.toContain('PermissionsAndroid');
    expect(pkg).not.toContain('requestPermissions');
    // SecurityException from bindToLifecycle is swallowed, not rethrown.
    expect(pkg).toContain('SecurityException');
    expect(pkg).toContain('Log.w(TAG, "CAMERA permission denied');
  });

  it('JS wrapper exports CAMERA_PREVIEW_AVAILABLE from UIManager', () => {
    /**
     * The JS fallback path: if the native view manager is absent (old APK or
     * iOS), callers render a static tile rather than mounting an unregistered
     * component. UIManager.hasViewManagerConfig is the canonical check.
     */
    const component = read('src/components/CameraPreview.tsx');
    expect(component).toContain('CAMERA_PREVIEW_AVAILABLE');
    expect(component).toContain("UIManager.hasViewManagerConfig('PappalCameraPreview')");
    expect(component).toContain("requireNativeComponent<CameraPreviewProps>('PappalCameraPreview')");
  });

  it('JS wrapper has no implicit any — facing is typed as back | front', () => {
    const component = read('src/components/CameraPreview.tsx');
    expect(component).toContain("facing?: 'back' | 'front'");
    expect(component).not.toContain(': any');
  });
});

/**
 * PappalBlurRoot + PappalBlurSurface — hardware GPU backdrop blur.
 *
 * Replaces the @sbaiahmed1/react-native-blur software capture path (CPU
 * Bitmap.createBitmap + ViewTreeObserver.OnPreDrawListener on the decor view)
 * with a RenderNode+RenderEffect chain that runs entirely on the GPU render
 * thread. Architecture mirrors the container+surface pattern where the root
 * records its own non-surface children into a downscaled node and surfaces
 * draw it (SizeNotifierFrameLayout.java:965-1042).
 *
 * Wiring assertions — the structural facts that a future change must not break
 * silently (RULE 1: if it can be checked mechanically, it goes here).
 */
describe('UI haptics go through the platform feedback constants', () => {
  const HAPTICS_KT = 'android/app/src/main/java/com/companionchat/HapticsModule.kt';

  it('uses performHapticFeedback, not a raw Vibration duration', () => {
    /*
     * Android's haptics guidance: a predefined action goes through
     * View.performHapticFeedback with a HapticFeedbackConstants value, because
     * that runs the OEM's tuned waveform AND respects the user's touch-feedback
     * setting. `Vibration.vibrate(ms)` does neither - this app was buzzing users
     * who had switched haptics off.
     * https://developer.android.com/develop/ui/views/haptics/haptics-principles
     */
    const kt = code(HAPTICS_KT);
    expect(kt).toContain('performHapticFeedback');
    expect(kt).toContain('HapticFeedbackConstants.KEYBOARD_TAP');
    expect(kt).toContain('HapticFeedbackConstants.LONG_PRESS');
    expect(kt).not.toContain('Vibrator');
  });

  it('never overrides the user with FLAG_IGNORE_GLOBAL_SETTING', () => {
    /*
     * The plan said to set it "where Telegram sets it". It is not set, for two
     * independent reasons: the principles page strongly discourages it, and the
     * SDK's own api-versions.xml records it deprecated=33 while this app targets
     * 36. Matching the reference is this project's default, not an obligation -
     * a user who turned touch feedback off has said something.
     */
    expect(code(HAPTICS_KT)).not.toContain('FLAG_IGNORE_GLOBAL_SETTING');
  });

  it('guards the API 30 constants against minSdk 24', () => {
    /*
     * From platforms/android-36/data/api-versions.xml: CONFIRM and REJECT are
     * since=30, while KEYBOARD_TAP (8) and LONG_PRESS (3) are always available
     * at minSdk 24. The newer two fall back rather than being skipped, so an
     * older device still feels the beat.
     */
    const kt = code(HAPTICS_KT);
    for (const constant of ['CONFIRM', 'REJECT']) {
      const at = kt.indexOf(`HapticFeedbackConstants.${constant}`);
      expect(at).toBeGreaterThan(-1);
      // A version gate appears above each of them.
      expect(kt.slice(0, at)).toMatch(/Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.R/);
    }
  });

  it('registers the module so JS can reach it', () => {
    const pkg = read('android/app/src/main/java/com/companionchat/InAppUpdatePackage.kt');
    expect(pkg).toContain('HapticsModule(reactContext)');
    expect(read(HAPTICS_KT)).toContain('const val NAME = "PappalHaptics"');
    // And the JS side asks for that exact name.
    expect(read('src/lib/haptics.ts')).toContain('NativeModules.PappalHaptics');
  });

  it('keeps Vibration only as the missing-native fallback', () => {
    /*
     * Vibration does not respect the user's setting, so it must never be the
     * default path - only the OTA-skew window where the JS bundle is newer than
     * the APK. Every call sits behind the HAS_NATIVE_HAPTICS guard.
     */
    const ts = code('src/lib/haptics.ts');
    const calls = ts.match(/Vibration\.vibrate\(/g) ?? [];
    const guards = ts.match(/if \(HAS_NATIVE_HAPTICS\) \{/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(guards.length).toBe(calls.length);
  });
});

describe('hardware GPU backdrop blur (PappalBlurRoot + PappalBlurSurface)', () => {
  const BLUR_PACKAGE =
    'android/app/src/main/java/com/companionchat/BlurPackage.kt';
  const BLUR_SURFACE_TSX = 'src/components/BlurSurface.tsx';
  const APP_KT =
    'android/app/src/main/java/com/companionchat/MainApplication.kt';

  it('never mounts the native blur below API 31', () => {
    /*
     * RenderEffect.createBlurEffect is API 31, and PappalBlurSurface.onDraw
     * gates on `SDK_INT >= 31 && canvas.isHardwareAccelerated`, so on Android
     * 7-11 the native view can only ever reach drawSolidFallback. Mounting it
     * there costs a native view per bar plus a drawRect per bar per frame to
     * achieve what a plain View with a background does for free - on the devices
     * with the least to spare. The JS side must not create it at all.
     */
    const tsx = read(BLUR_SURFACE_TSX);
    expect(tsx).toContain('BLUR_MIN_API = 31');
    expect(tsx).toMatch(/Platform\.Version >= BLUR_MIN_API/);
    // And the native gate it mirrors is still there, so the two cannot drift.
    const kt = read(BLUR_PACKAGE);
    expect(kt).toMatch(/Build\.VERSION\.SDK_INT >= 31 && canvas\.isHardwareAccelerated/);
  });

  it('lets the palette decide how transparent glass is', () => {
    /*
     * `tintPaint.alpha = tintAlpha * 255` OVERWROTE the alpha carried by the
     * tint colour, so bg.glass - deliberately rgba(255,255,255,0.55) - rendered
     * at 0.70 and the token table documented a number the renderer ignored.
     *
     * The 0.70 came from Telegram's key_chat_BlurAlpha 0xB2000000 and was ported
     * without its context: that is 70% BLACK on a DARK theme over colourful
     * content. 70% WHITE over a light cream wallpaper washes out to flat cream -
     * the blur ran every frame and could not be seen.
     */
    const kt = code(BLUR_PACKAGE);
    expect(kt).toMatch(/Color\.alpha\(tintColor\) \* tintAlpha/);
    expect(kt).not.toMatch(/tintPaint\.alpha = \(tintAlpha \* 255f\)/);
    // The multiplier defaults to a no-op so the token governs unless a caller
    // deliberately dims further.
    expect(kt).toContain('var tintAlpha: Float = 1.0f');
  });

  it('degrades to invisible, never to a black slab', () => {
    /*
     * `tintColor` defaulted to Color.BLACK and the fallback forced alpha 255,
     * so every path where the tint did not arrive painted an opaque black rect:
     * an unset prop, a JS bundle predating the prop, a `tint="none"` caller.
     * On the S22 (API 36, 2026-09-05) the chat header and composer rendered as
     * black bars with light-theme content sitting on them.
     *
     * A decoration that cannot draw itself must disappear, which is what the
     * Frost docstring on the JS side already promises.
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toMatch(/var tintColor: Int = Color\.TRANSPARENT/);
    expect(kt).not.toMatch(/var tintColor: Int = Color\.BLACK/);
    // The fallback returns early on a fully transparent tint, BEFORE it forces
    // the paint opaque.
    const fallback = kt.slice(
      kt.indexOf('private fun drawSolidFallback'),
      kt.indexOf('private fun drawBlurred'),
    );
    expect(fallback).toContain('Color.alpha(tintColor) == 0');
    expect(fallback.indexOf('Color.alpha(tintColor) == 0')).toBeLessThan(
      fallback.indexOf('tintPaint.alpha = 255'),
    );
  });

  it('sends tintColor as a colour, never a hand-rolled signed int', () => {
    /*
     * normalizeColor(-1929379841) === null, so a signed ARGB int never reaches
     * the native setter at all. Frost must hand RN the token string and let the
     * framework do the conversion it already does for every other colour prop.
     */
    const frost = read('src/components/Frost.tsx');
    expect(frost).toMatch(/tintColor=\{tint === 'none' \? 'transparent' : theme\.color\.bg\.glass\}/);
    // The hand-rolled converter is gone and must not come back.
    expect(frost).not.toContain('function argb');
    expect(frost).not.toMatch(/0x100000000|0x80000000/);
    // And the native null-fallback agrees with the field default, so a dropped
    // prop can never paint an opaque colour.
    const kt = read(BLUR_PACKAGE);
    expect(kt).toMatch(/view\.tintColor = color \?: Color\.TRANSPARENT/);
    expect(kt).not.toMatch(/color \?: Color\.BLACK/);
  });

  it('BlurPackage registers both view managers with the correct names', () => {
    /**
     * React Native resolves native views by their getName() string. A rename
     * here without updating the JS wrapper silently renders nothing on Android.
     * https://reactnative.dev/docs/native-components-android
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain('PappalBlurRootManager');
    expect(kt).toContain('PappalBlurSurfaceManager');
    expect(kt).toContain('"PappalBlurRoot"');
    expect(kt).toContain('"PappalBlurSurface"');
  });

  it('registers BlurRoot as a container manager because React mounts children into it', () => {
    /**
     * Fabric's mounting layer requires a ViewGroupManager for native components
     * that accept React children. The Android view extending FrameLayout is not
     * enough: SimpleViewManager advertises a leaf and crashes on the first child.
     * https://reactnative.dev/docs/legacy/native-components-android#3-implement-the-view-manager
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain(
      'class PappalBlurRootManager : ViewGroupManager<PappalBlurRoot>()',
    );
    expect(kt).not.toContain(
      'class PappalBlurRootManager : SimpleViewManager<PappalBlurRoot>()',
    );
  });

  it('BlurPackage is registered in MainApplication', () => {
    // Not autolinkable — must be added manually next to the other in-app packages.
    expect(read(APP_KT)).toContain('add(BlurPackage())');
  });

  it('uses RenderEffect API 31 blur+saturation chain', () => {
    /**
     * The blur+saturation chain reproduces SizeNotifierFrameLayout.java:997-1002.
     * Both effects must be present: blur alone desaturates the image at high
     * radii; the ColorMatrixColorFilter(saturation=2f) compensates.
     *
     * https://developer.android.com/reference/android/graphics/RenderEffect#createChainEffect(android.graphics.RenderEffect,android.graphics.RenderEffect)
     * https://developer.android.com/reference/android/graphics/RenderEffect#createBlurEffect(float,float,android.graphics.Shader.TileMode)
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain('RenderEffect.createBlurEffect');
    expect(kt).toContain('RenderEffect.createChainEffect');
    expect(kt).toContain('setSaturation(2f)');
  });

  it('gates the RenderEffect path on API 31 and documents the minSdk fallback', () => {
    /**
     * RenderEffect is API 31 (Android 12). minSdk here is 24 (Android 7), so
     * the solid-colour fallback runs in production for Android 7–11 users.
     * An unguarded call is a NoSuchMethodError on those devices at runtime.
     *
     * https://developer.android.com/reference/android/graphics/RenderEffect
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain('Build.VERSION.SDK_INT >= 31');
    // The comment must survive so readers know this path runs in production.
    expect(kt).toContain('minSdk');
  });

  it('records the node at a downscaled resolution', () => {
    /**
     * The blur node is recorded at 1/DOWNSCALE resolution and drawn back at
     * DOWNSCALE× size. This is the whole reason for the RenderNode architecture:
     * blurring at full resolution would cost full-resolution GPU memory and
     * fill rate for every frame the backdrop changes.
     * Reference: SizeNotifierFrameLayout.java:939-940, 1006-1009.
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain('DOWNSCALE');
    expect(kt).toContain('1f / DOWNSCALE');
  });

  it('skips PappalBlurSurface during the recording pass', () => {
    /**
     * Recording a surface that reads the very node being recorded would
     * produce undefined output. The skip flag prevents the recursion.
     * Reference: SizeNotifierFrameLayout.java:1007-1016 (drawingBlur flag).
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain('skipSurfaces');
    expect(kt).toContain('is PappalBlurSurface');
  });

  it('falls back to a solid rect when blur is unavailable or disabled', () => {
    /**
     * Telegram draws canvas.drawRect(rectTmp, blurScrimPaint) when blur is
     * off (SizeNotifierFrameLayout.java:976-979). Our drawSolidFallback is
     * the same pattern. It must exist and be named consistently so searches
     * can trace the fallback path.
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).toContain('drawSolidFallback');
  });

  it('never sets LAYER_TYPE_HARDWARE permanently', () => {
    /**
     * Permanently-set hardware layers force the view onto a texture and add a
     * compositing pass every frame whether or not the content changes. The blur
     * is already drawn via RenderNode; no layer type change is needed.
     * https://developer.android.com/reference/android/view/View#setLayerType(int,%20android.graphics.Paint)
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).not.toContain('setLayerType(View.LAYER_TYPE_HARDWARE');
    expect(kt).not.toContain('LAYER_TYPE_HARDWARE,');
  });

  it('does not contain forbidden source-attribution strings (ADR-0025 clean-room)', () => {
    /**
     * ADR-0025: cite the reference implementation by File.java:line in comments,
     * but the shipping tree must contain no package-path strings that would
     * imply a code copy. A grep in CI fails the build on these strings.
     */
    const kt = read(BLUR_PACKAGE);
    expect(kt).not.toContain('org.telegram');
    expect(kt).not.toContain('TMessagesProj');
    expect(kt).not.toContain('DrKLO');
  });

  it('JS wrapper exports BLUR_SURFACE_AVAILABLE from UIManager', () => {
    /**
     * Callers must check BLUR_SURFACE_AVAILABLE before mounting BlurRoot or
     * BlurSurface — the module is Android-only and will be absent on iOS and
     * on Android builds that predate this change. UIManager.hasViewManagerConfig
     * is the canonical check (catches OTA-update mismatches that Platform.OS
     * would miss).
     */
    const tsx = read(BLUR_SURFACE_TSX);
    expect(tsx).toContain('BLUR_SURFACE_AVAILABLE');
    expect(tsx).toContain("UIManager.hasViewManagerConfig('PappalBlurSurface')");
    expect(tsx).toContain("UIManager.hasViewManagerConfig('PappalBlurRoot')");
  });

  it('JS wrapper exports typed requireNativeComponent wrappers for both views', () => {
    const tsx = read(BLUR_SURFACE_TSX);
    expect(tsx).toContain("requireNativeComponent<BlurSurfaceProps>('PappalBlurSurface')");
    expect(tsx).toContain("requireNativeComponent<BlurRootProps>('PappalBlurRoot')");
  });

  it('BlurSurface props are fully typed — no implicit any', () => {
    /**
     * Strict types on the JS bridge boundary prevent callers from silently
     * passing wrong types (e.g., a CSS colour string where the native side
     * expects an ARGB integer).
     */
    const tsx = read(BLUR_SURFACE_TSX);
    /*
     * A COLOUR, not a number. This assertion used to demand `tintColor?: number`
     * and so locked in the defect: `customType = "Color"` routes the value
     * through RN's normaliser, which rejects negative numbers, and a signed
     * 32-bit ARGB int is negative for any alpha above 0x7F. The value was
     * dropped and every frosted bar painted the native default instead.
     */
    expect(tsx).toContain('tintColor?: ColorValue');
    expect(tsx).toContain('tintAlpha?: number');
    expect(tsx).toContain('blurRadius?: number');
    expect(tsx).toContain('enabled?: boolean');
    expect(tsx).not.toContain(': any');
  });
});

describe('hardware back reaches the app', () => {
  it('does not opt the manifest into OnBackInvokedCallback while BackHandler carries every back decision', () => {
    // App.tsx's single BackHandler subscription (and the guard stack behind it,
    // src/lib/backGuard.ts) is how a live paid session or call gets its confirm
    // dialog. That path is fed by the Activity's legacy onBackPressed; opting
    // into the predictive-back callback is the W6 item and must be done with
    // its own reading of the docs, not slipped in with a manifest edit.
    // https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
    expect(read(MANIFEST)).not.toMatch(/enableOnBackInvokedCallback\s*=\s*"true"/);
  });
});

/**
 * W0 measurement scripts — Perfetto tracing and Macrobenchmark gate.
 *
 * Both files are here because the plan names them alongside framestats.mjs.
 * Each cites the doc that governed its design so a reader can verify the
 * claims rather than trust them (RULE 1).
 *
 * perfetto-feel.sh:
 *   https://perfetto.dev/docs/data-sources/frametimeline
 *   https://perfetto.dev/docs/quickstart/android-tracing
 *
 * benchmark-gate.mjs:
 *   https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 *   https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 */
/**
 * W5#5 — renderToHardwareTextureAndroid on PushedLayer and Sheet.
 *
 * The promotion was considered for both surfaces and deliberately not applied.
 * The decision is recorded in each file rather than silently omitted — this
 * assertion makes sure the reasoning survives future edits (RULE 1: assert
 * what can be checked mechanically so the requirement cannot be forgotten).
 *
 * Condition for revisiting: a `framestats.mjs` run on the S22 (not the
 * SwiftShader emulator — see BloomField.tsx:325) that shows push/pop or
 * sheet-open frames exceed the 8.33 ms budget. If they do, implement as a
 * Reanimated-driven toggle tied to the `transitioning` shared value in
 * motion.ts, never as a permanently-on prop.
 * https://reactnative.dev/docs/view-style-props#rendertohardwaretextureandroid
 */
describe('W5#5 — renderToHardwareTextureAndroid decision is recorded', () => {
  it('promotes a pushed screen to a texture only WHILE it moves', () => {
    // The precondition this was held back for is met: on the S22 at 60Hz a
    // push/pop landed 44.2% of frames inside budget with a 17.85ms p50, against
    // Telegram's 97.5% and 7.55ms, while plain scrolling matched them almost
    // exactly. So the texture is on for the animation and off the instant it
    // settles -- a permanent one is ~8MB of GPU memory held while nothing moves.
    const app = read('App.tsx');
    expect(app).toContain('renderToHardwareTextureAndroid: transitioning.value');
    expect(app).toContain('animatedProps={textureWhileMoving}');
    // Driven on the UI thread, not through a JS round-trip behind the animation.
    expect(app).toContain('useAnimatedProps(() => ({');
    // And the release is guaranteed by the lock's own completion callback.
    const motion = read('src/theme/motion.ts');
    expect(motion).toContain('runOnJS(setTransitioning)(false)');
  });

  it('waits for the screen to have DATA, not just geometry', () => {
    // Telegram does not start on layout, it starts when the first message batch
    // has rendered (ChatActivity.java:27014 -> :20613 ->
    // resumeDelayedFragmentAnimation), with a 200ms ceiling
    // (ActionBarLayout.java:2270-2282). Measured gap at 60Hz on the S22 before
    // this: 65% of push frames inside budget against their 97.5%.
    const motion = read('src/theme/motion.ts');
    expect(motion).toContain('export function holdScreenEnter()');
    expect(motion).toContain('const ENTER_HOLD_CEILING_MS = 200;');
    // The ceiling must exist, or a screen that never reports ready hangs the
    // animation forever.
    expect(motion).toContain('setTimeout(begin, ENTER_HOLD_CEILING_MS)');
    // One-shot: a release landing in the same tick as the ceiling must not
    // start two animations.
    expect(motion).toMatch(/const begin = \(\) => \{\s*\n\s*if \(begun\) \{/);
    // And a screen popped mid-wait tears the wait down rather than animating a
    // view on its way out.
    expect(motion).toContain('useEffect(() => () => cancelWait.current(), [])');

    // Not holding is the DEFAULT. A screen nobody thought about must animate
    // immediately rather than silently paying the ceiling on every push.
    expect(motion).toMatch(/if \(!isScreenEnterHeld\(\)\) \{\s*\n\s*begin\(\);/);
  });

  it('gives the mount its own frame, and guards against a second start', () => {
    const motion = read('src/theme/motion.ts');
    const hook = motion.slice(motion.indexOf('export function useScreenEnter'));
    // The ramp itself is still deferred one frame, so the animation's first
    // frame is never the same frame as the screen's first React commit.
    expect(hook).toContain('requestAnimationFrame(() => {');
    // The re-entry guard is set before any waiting begins, or a second
    // onLayout arriving during the wait would start a second animation.
    const guardAt = hook.indexOf('started.value = true;');
    const waitAt = hook.indexOf('let begun = false;');
    expect(guardAt).toBeGreaterThan(-1);
    expect(waitAt).toBeGreaterThan(guardAt);
  });

  it('defers a photo decode but never an identity', () => {
    // W5#6's last two named sites, and they get opposite answers on purpose.
    // Turn's photo has a DESIGNED grey placeholder (the state it already shows
    // while a signed URL resolves), so holding the decode back a few frames
    // reuses an existing appearance. Avatar's fallback is the person's
    // INITIALS, which mean "no photo" rather than "loading" -- swapping those
    // for a face mid-transition reads as the wrong person.
    const turn = read('src/components/Turn.tsx');
    expect(turn).toContain('useAfterTransition()');
    expect(turn).toContain('uri !== undefined && afterTransition ?');
    // The loading overlay has to cover the held-back window too, or the bubble
    // reads as grey nothing rather than as a photo arriving.
    expect(turn).toContain('pending || uri === undefined || !afterTransition ?');

    const avatar = read('src/components/Avatar.tsx');
    // Comments stripped: the file EXPLAINS why it does not use the hook, and a
    // gate that cannot tell prose from code fails on its own rationale.
    const avatarCode = avatar
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(avatarCode).not.toContain('useAfterTransition');
    // The reasoning is recorded next to the code, not left as an absence.
    expect(avatar).toContain('W5#6 named "avatar fetches" as a deferral site');

    // And the shared hook cannot strand anything: the idle fallback is
    // unconditional, so a lock that never lowers still releases the photo.
    const motion = read('src/theme/motion.ts');
    const hook = motion.slice(motion.indexOf('export function useAfterTransition'));
    expect(hook).toContain('requestIdleCallback(go)');
    expect(hook).toContain('cancelIdleCallback(idle)');
  });

  it('releases the hold on unmount as well as on data', () => {
    // A hold left standing by a screen the user backed out of would make the
    // NEXT push wait the full ceiling.
    const chat = read('src/screens/ChatScreen.tsx');
    expect(chat).toContain('useEffect(() => releaseEnter, [releaseEnter])');
    // Taken in RENDER, not an effect: a child renders before its parent's
    // onLayout fires, so an effect-taken hold would arrive too late to matter.
    expect(chat).toMatch(/useState\(\(\) =>\s*\n?\s*messages === undefined \? holdScreenEnter\(\) : NO_HOLD/);
    // And an empty conversation releases too -- no data is coming, so waiting
    // for it would burn the whole ceiling on every new chat.
    expect(chat).toContain('if (messages !== undefined || !messagesPending)');
  });

  it('Sheet.tsx documents the hardware-texture decision', () => {
    expect(read('src/components/Sheet.tsx')).toContain('renderToHardwareTextureAndroid');
  });
});

/**
 * W5#8 — device class module for blur quality tiers.
 *
 * The API-31 guard in BlurPackage covers Android 7–11 (no RenderEffect). This
 * module covers the remaining gap: API 31+ devices with isLowRamDevice()=true,
 * which the API-level guard cannot reach.
 *
 * https://developer.android.com/reference/android/app/ActivityManager#isLowRamDevice()
 */
describe('W5#8 — DeviceClassModule (low / average / high blur tiers)', () => {
  const MODULE_KT =
    'android/app/src/main/java/com/companionchat/DeviceClassModule.kt';

  it('DeviceClassPackage is registered in MainApplication', () => {
    // Not autolinkable — must be added manually, like BlurPackage and
    // CameraTilePackage. Registration in MainApplication is the house pattern
    // for non-autolinkable packages (see BlurPackage, InAppUpdatePackage).
    expect(read('android/app/src/main/java/com/companionchat/MainApplication.kt')).toContain(
      'add(DeviceClassPackage())',
    );
  });

  it('DeviceClassModule exports the canonical module name', () => {
    // NativeModules.DeviceClass is what the JS bridge resolves on. A rename
    // here without updating src/lib/deviceClass.ts silently breaks the call.
    expect(read(MODULE_KT)).toContain('const val NAME = "DeviceClass"');
    expect(read('src/lib/deviceClass.ts')).toContain('NativeModules.DeviceClass');
  });

  it('uses isLowRamDevice() as the low-class signal', () => {
    /**
     * isLowRamDevice() is the OS-sanctioned flag for devices with ≤ 1 GB RAM —
     * the same signal Android's own memory-trimming uses. Trusting it is
     * preferable to re-implementing the heuristic from total RAM alone.
     * https://developer.android.com/reference/android/app/ActivityManager#isLowRamDevice()
     */
    const kt = read(MODULE_KT);
    expect(kt).toContain('am.isLowRamDevice');
    expect(kt).toContain('CLASS_LOW');
    expect(kt).toContain('https://developer.android.com/reference/android/app/ActivityManager#isLowRamDevice()');
  });

  it('uses ActivityManager.MemoryInfo to split average from high', () => {
    /**
     * getMemoryInfo().totalMem is the total installed RAM in bytes. Used to
     * separate cheap-but-not-low-RAM devices (average) from capable ones (high).
     * https://developer.android.com/reference/android/app/ActivityManager#getMemoryInfo(android.app.ActivityManager.MemoryInfo)
     */
    const kt = read(MODULE_KT);
    expect(kt).toContain('ActivityManager.MemoryInfo()');
    expect(kt).toContain('am.getMemoryInfo(info)');
    expect(kt).toContain('info.totalMem');
  });

  it('is synchronous so the class is known before the first rendered frame', () => {
    // A Promise-based query would return after the first render — too late to
    // decide whether BlurSurface should be mounted at all.
    expect(read(MODULE_KT)).toContain('isBlockingSynchronousMethod = true');
  });

  it('JS side defaults to high when the module is absent (iOS or OTA skew)', () => {
    // `high` on absence means the user gets the designed experience rather than
    // a silently-degraded one. OTA skew (JS bundle newer than APK) is the
    // window where the module can be genuinely missing on Android.
    const ts = read('src/lib/deviceClass.ts');
    expect(ts).toContain("? _module.getDeviceClass()");
    expect(ts).toContain(": 'high'");
  });

  it('exports BLUR_DISABLED and BLUR_REDUCED from deviceClass.ts', () => {
    // Callers import the pre-computed booleans rather than string-comparing
    // DEVICE_CLASS themselves — a typo at the call site cannot silently be wrong.
    const ts = read('src/lib/deviceClass.ts');
    expect(ts).toContain("export const BLUR_DISABLED = DEVICE_CLASS === 'low'");
    expect(ts).toContain("export const BLUR_REDUCED = DEVICE_CLASS === 'average'");
  });

  it('records that the API-31 guard and device class cover distinct cases', () => {
    // BlurPackage.kt gates on API 31 (handles Android 7–11). DeviceClassModule
    // gates on isLowRamDevice() (handles low-RAM Android 12+). The overlap
    // region — isLowRamDevice() on API < 31 — is correctly handled by the API
    // guard (blur is off entirely), so no double-gating occurs.
    expect(read(MODULE_KT)).toContain('API-level guard');
  });
});

describe('W0 measurement scripts — Perfetto and Macrobenchmark gate', () => {
  it('ships perfetto-feel.sh, wires it into package.json, and cites its docs', () => {
    expect(existsSync(join(ROOT, 'scripts/perfetto-feel.sh'))).toBe(true);

    const script = read('scripts/perfetto-feel.sh');

    // The FrameTimeline data source name is the load-bearing string: it is
    // what the on-device perfetto binary uses to select which events to record.
    // https://perfetto.dev/docs/data-sources/frametimeline
    expect(script).toContain('android.surfaceflinger.frametimeline');

    // The VSYNC-app track comes from atrace gfx events. The gfx category is
    // what makes Choreographer fence events appear on that track.
    expect(script).toContain('atrace_categories: "gfx"');

    // adb resolution mirrors framestats.mjs: local.properties → known paths.
    // Both tools must find the same binary without a separate setup step.
    expect(script).toContain('local.properties');

    // The minSdk (24) is below the API 29 floor for the on-device perfetto
    // binary. The script documents this so nobody wastes time debugging on a
    // 60Hz Android 7 test device.
    expect(script).toContain('API 29');

    // The doc URLs must survive in the file — RULE 1 requires them.
    expect(script).toContain('https://perfetto.dev/docs/data-sources/frametimeline');
    expect(script).toContain('https://perfetto.dev/docs/quickstart/android-tracing');

    // How to open the trace — the reason the script exists is so someone can
    // actually measure; the open instruction completes that loop.
    expect(script).toContain('https://ui.perfetto.dev');

    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['android:perfetto']).toBe('bash scripts/perfetto-feel.sh');
  });

  it('ships benchmark-gate.mjs, wires it into package.json, and cites its docs', () => {
    expect(existsSync(join(ROOT, 'scripts/benchmark-gate.mjs'))).toBe(true);

    const script = read('scripts/benchmark-gate.mjs');

    // The script must be honest about what was verified: no benchmarkData.json
    // existed in the repo when it was written. A file that claims certainty it
    // does not have will mislead the next person who reads it.
    expect(script).toContain('never been run');

    // The gate thresholds from the W0 plan.
    // https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
    expect(script).toContain('frameDurationCpuMs');
    expect(script).toContain('frameOverrunMs');
    expect(script).toContain('8.3');
    expect(script).toContain('16.7');

    // When the JSON is absent the script must exit 1 with a command the user
    // can copy — not a stack trace or a silent wrong result.
    expect(script).toContain('npm run android:benchmark:startup');
    expect(script).toContain('process.exit(1)');

    // The schema assumption is documented next to the code that reads it, so a
    // schema change is caught at the point of confusion rather than downstream.
    expect(script).toContain('"benchmarks" array');

    // Doc URLs — RULE 1.
    expect(script).toContain('https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview');
    expect(script).toContain('https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics');

    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['android:benchmark:gate']).toBe('node scripts/benchmark-gate.mjs');
  });
});

/**
 * FLAG_SECURE demo-capture carve-out.
 *
 * FLAG_SECURE blocks screenshots, screen recording, and the recents thumbnail.
 * Production must never allow these to be lifted. The carve-out for product
 * demos is gated by TWO independent checks that must both pass:
 *
 *   1. Build variant: only the `internal` APK can unblock capture at all.
 *      The `release` APK cannot reach the clearFlags branch — it is dead code.
 *
 *   2. Account: even in `internal`, only emails ending with `@example.test`
 *      (the dev-seed domain from scripts/seed-dev.sql) unblock capture.
 *      A real member on an internal build stays protected.
 *
 * https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE
 */
describe('FLAG_SECURE demo-capture carve-out', () => {
  it('release variant keeps BLOCK_SCREENSHOTS = true (original protection unchanged)', () => {
    /*
     * The release block must still assert the flag explicitly rather than
     * relying on inheritance, so a reader auditing capture policy finds the
     * answer in the release block without tracing the inheritance chain.
     */
    const gradle = read('android/app/build.gradle');
    // Find release block and check BLOCK_SCREENSHOTS = true within it.
    // The release buildType has no nested braces at field level, so [^}]*
    // reads cleanly to the closing brace.
    expect(gradle).toMatch(
      /buildConfigField "boolean", "BLOCK_SCREENSHOTS", "true"\s+\/\/ Explicit false/,
    );
    // Simpler belt-and-suspenders: the string is in the file at all.
    expect(gradle).toContain('"BLOCK_SCREENSHOTS", "true"');
  });

  it('release variant cannot enable capture: ALLOW_DEV_CAPTURE is false', () => {
    /*
     * ALLOW_DEV_CAPTURE = false in `release` makes the native
     * setDemoCaptureEnabled an unconditional no-op. A release APK cannot
     * reach clearFlags even if the account check were somehow satisfied.
     *
     * The internal variant sets it to true, which is what enables the
     * runtime account gate.
     */
    const gradle = read('android/app/build.gradle');
    // release block has ALLOW_DEV_CAPTURE = false
    expect(gradle).toContain('"ALLOW_DEV_CAPTURE", "false"');
    // internal block has ALLOW_DEV_CAPTURE = true
    expect(gradle).toContain('"ALLOW_DEV_CAPTURE", "true"');
    // Sanity: true must appear inside the internal block, not before it.
    const trueAt = gradle.indexOf('"ALLOW_DEV_CAPTURE", "true"');
    const internalAt = gradle.indexOf('internal {');
    expect(internalAt).toBeGreaterThan(0);
    expect(trueAt).toBeGreaterThan(internalAt);
  });

  it('leaves the internal build capturable, because that is the point of it', () => {
    /*
     * Tried the other way first and it was verified WRONG on the S22: internal
     * was set to block by default with a runtime exemption for `@example.test`
     * accounts, and every screencap came back a solid black frame. That domain
     * matches only the seeded fake providers in scripts/seed-dev.sql, never the
     * real account a product demo is actually given from — so the carve-out
     * blocked precisely what it was built to allow.
     *
     * ALLOW_DEV_CAPTURE remains for an account-scoped policy later; today the
     * variant decides.
     */
    const gradle = read('android/app/build.gradle');
    const internalAt = gradle.indexOf('internal {');
    const internalSection = gradle.slice(internalAt, gradle.indexOf('\n        }', internalAt));
    expect(internalSection).toContain('"BLOCK_SCREENSHOTS", "false"');
    expect(internalSection).toContain('"ALLOW_DEV_CAPTURE", "true"');
  });

  it('native setDemoCaptureEnabled returns early when ALLOW_DEV_CAPTURE is false', () => {
    /*
     * The build-variant gate must appear BEFORE any window flag manipulation.
     * In a release APK, ALLOW_DEV_CAPTURE is false (a compile-time constant),
     * so the if-branch is resolved to "always return" by R8 — the clearFlags
     * and addFlags calls are unreachable dead code.
     */
    const chrome = read(
      'android/app/src/main/java/com/companionchat/WindowChromeModule.kt',
    );
    const earlyReturn = chrome.indexOf('if (!BuildConfig.ALLOW_DEV_CAPTURE) return');
    // Match the actual code call, not the comment (comments name clearFlags too).
    const clearFlags = chrome.indexOf('win.clearFlags(');
    expect(earlyReturn).toBeGreaterThan(0);
    expect(clearFlags).toBeGreaterThan(0);
    // The guard must appear BEFORE the flag manipulation.
    expect(earlyReturn).toBeLessThan(clearFlags);
  });

  it('JS layer gates capture on @example.test domain, not a bare flag', () => {
    /*
     * Gate 2 (runtime account check): even in an `internal` build, only
     * @example.test accounts can call setDemoCaptureEnabled(true). The
     * check uses endsWith so all seed accounts (seed.mira@, seed.sara@, ...)
     * qualify, not just a single hardcoded email.
     */
    const lib = read('src/lib/demoCapture.ts');
    // The constant names the exact domain, not a permissive wildcard.
    expect(lib).toContain("DEV_EMAIL_DOMAIN = '@example.test'");
    // The check is a suffix test (endsWith), not equality or includes.
    expect(lib).toContain('.endsWith(DEV_EMAIL_DOMAIN)');
  });

  it('null/undefined email maps to isDevAccount = false (sign-out restores protection)', () => {
    /*
     * A sign-out calls applyDemoCapturePolicy(null). The guard
     * `typeof email === 'string'` ensures null and undefined both produce
     * isDevAccount = false, which calls setDemoCaptureEnabled(false) and
     * restores FLAG_SECURE without an activity restart.
     */
    const lib = read('src/lib/demoCapture.ts');
    expect(lib).toContain("typeof email === 'string'");
    // The native call receives isDevAccount, not the raw argument.
    expect(lib).toContain('native.setDemoCaptureEnabled(isDevAccount)');
  });

  it('App.tsx subscribes to onAuthStateChange to drive the policy on every transition', () => {
    /*
     * Using supabase.auth.onAuthStateChange rather than one-shot calls at
     * sign-in and sign-out covers token refresh and session restore paths that
     * a one-shot call at boot would miss.
     */
    const app = read('App.tsx');
    expect(app).toContain('applyDemoCapturePolicy');
    expect(app).toContain('supabase.auth.onAuthStateChange');
    // The subscription must be cleaned up on unmount.
    expect(app).toContain('subscription.unsubscribe()');
  });
});
