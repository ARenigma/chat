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
const MAIN_ACTIVITY = 'android/app/src/main/java/com/companionchat/MainActivity.kt';

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
        } else if (rel.endsWith('.tsx') && !rel.endsWith('components/TextField.tsx')) {
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
    expect(body).toContain('CHANNEL_CALLS');
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

  it('keeps the recording module out of the shipped app', () => {
    // `com.android.test` output is never part of the app APK; only the generated
    // text file is consumed at build time. A `com.android.library` here would
    // ship the benchmark harness to users.
    expect(read(BP)).toContain('apply plugin: "com.android.test"');
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
