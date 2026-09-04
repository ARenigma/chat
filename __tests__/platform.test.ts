import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

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
    expect(app).toMatch(/isUuid\(peer\)/);
  });
});

describe('the chat transcript is readable by a screen reader', () => {
  /** https://reactnative.dev/docs/accessibility */
  it('does not override message text with the long-press label', () => {
    /*
     * accessibilityLabel REPLACES concatenated child text for TalkBack. Setting
     * it to the long-press hint on every bubble made the entire transcript
     * unreadable — TalkBack announced only "Long press for message actions". A
     * hint appends on Android instead, leaving the message body to be read.
     */
    const turn = read('src/components/Turn.tsx');
    expect(turn).not.toMatch(/accessibilityLabel=\{onLongPress/);
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

    // The approved follow-up uses WhatsApp's profile-shortcut variant: a compact
    // transparent M3 bar over the cover, with a real 48dp Back action even though
    // the member route also keeps the bottom navigation.
    expect(settings).toContain('<TopAppBar');
    expect(settings).toContain('title=""');
    expect(settings).toContain('transparent');
    expect(settings).toContain('testID="settings-back"');
    expect(settings).toContain('size={48}');
    expect(settings).toContain('<ChatWallpaper />');
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
