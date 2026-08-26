import { readFileSync } from 'fs';
import { join } from 'path';
import { BLOOM_PALETTES } from '../src/lib/bloom';
import {
  COMPLETION_DELAY_MS,
  STEP_ADVANCE_MS,
  STEPS,
  canSubmit,
  coresCollapsed,
  fieldAtRest,
  paletteFor,
  visibleSteps,
  type Phase,
} from '../src/lib/onboarding';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * The property that makes the reference feel like one place rather than four
 * screens, asserted so a future navigator refactor has to argue with a test.
 */
describe('the onboarding flow is one screen', () => {
  it('never mounts a second screen or a navigator', () => {
    const body = read('src/screens/OnboardingScreen.tsx');
    /*
     * `OnboardingFlow.swift` has no `NavigationStack`, no `sheet`, no `push`.
     * It is an integer `phase` and a `currentStep` index over one array, with
     * one field rendered behind all of it. Reaching for a navigator here is the
     * single change that would destroy the effect while looking like a tidy-up,
     * so it is spelled out rather than left to taste.
     */
    expect(body).not.toMatch(/NavigationContainer|createNativeStackNavigator|navigation\.navigate/);
    // The field is rendered exactly once, outside every phase branch.
    expect(body.match(/<BloomField/g) ?? []).toHaveLength(1);
  });

  it('keeps the field mounted through every phase', () => {
    const body = read('src/screens/OnboardingScreen.tsx');
    // The field must not sit inside a conditional, or it would remount and the
    // colour it was carrying would snap rather than cross-fade.
    const fieldLine = body.indexOf('<BloomField');
    const welcomeGate = body.indexOf('showWelcome ?');
    expect(fieldLine).toBeGreaterThan(0);
    expect(fieldLine).toBeLessThan(welcomeGate);
  });
});

describe('the step list', () => {
  it('shows one row until the phone route is taken', () => {
    /*
     * The one structural departure from the source, and it is forced: Fuse's
     * three steps are sequential, ours are alternatives. A permanently-visible
     * "Your code" row would be a promise the Google route never keeps.
     */
    expect(visibleSteps('undecided')).toHaveLength(1);
    expect(visibleSteps('google')).toHaveLength(1);
    expect(visibleSteps('phone')).toHaveLength(2);
  });

  it('always leads with identify, whichever route is taken', () => {
    for (const route of ['undecided', 'google', 'phone'] as const) {
      expect(visibleSteps(route)[0]?.key).toBe('identify');
    }
  });

  it('gives every step a glyph the icon set actually draws', () => {
    // Glyphs now live in the generated Material Symbols map, keyed by semantic
    // name. A name not in the map is a compile error via IconName, but the step
    // data is data, so this still guards a typo in the config.
    const map = read('src/theme/icons.generated.ts');
    for (const spec of Object.values(STEPS)) {
      expect(map).toContain(`${spec.glyph}: "`);
    }
  });
});

describe('the field follows the flow', () => {
  it('holds a solid core only on the welcome screen', () => {
    // `startRadius: phase > 0 ? 0 : 300`. The core is what makes the field read
    // as a saturated pool instead of a wash, and the source only wants it at rest.
    expect(coresCollapsed('welcome')).toBe(false);
    for (const phase of ['leaving', 'form', 'done'] as Phase[]) {
      expect(coresCollapsed(phase)).toBe(true);
    }
  });

  it('sits at the bottom only on the welcome screen', () => {
    expect(fieldAtRest('welcome')).toBe(true);
    for (const phase of ['leaving', 'form', 'done'] as Phase[]) {
      expect(fieldAtRest(phase)).toBe(false);
    }
  });

  it('changes colour on every interaction, not just every step', () => {
    /*
     * `gradient = steps[currentStep].gradient` inside the same `withAnimation`
     * that advances the step — so the field turns over on EVERY submit.
     *
     * The bug this pins: keying the palette on the step KEY gave two colours
     * across three interactions, so choosing the phone route and then typing a
     * number changed nothing, and the field shifted exactly once in the whole
     * flow. Amit spotted it immediately against the reference: "the gradient
     * keeps shifting on every click but ours only once".
     */
    const names = (['choose', 'number', 'code'] as const).map(
      st => paletteFor('form', st).name,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('drains to transparent at the end rather than unmounting', () => {
    /*
     * The source's `gradient = (.clear, .clear, .clear)` on the last submit. It
     * is NOT an unmount and not a fade of the container: the layers stay
     * positioned and only their colour goes, which is why the completion list
     * lands on a clean page with nothing having moved underneath it.
     */
    const done = paletteFor('done', 'choose');
    expect(done.wash).toBe('transparent');
    expect(done.glow).toBe('transparent');
    expect(done.core).toBe('transparent');
    expect(done).toBe(BLOOM_PALETTES.done);
  });

  it('wears the welcome palette for the whole exit, not just the start', () => {
    // The colour swap and the positional exit are separate events. Changing
    // palette during `leaving` would collide two staggered animations on the
    // same layers and neither would land.
    expect(paletteFor('leaving', 'choose')).toBe(BLOOM_PALETTES.welcome);
  });
});

describe('submission guards', () => {
  it('refuses a second submit while one is in flight or done', () => {
    expect(canSubmit('idle')).toBe(true);
    // A failed step must be retryable, or a wrong code is a dead end.
    expect(canSubmit('error')).toBe(true);
    expect(canSubmit('loading')).toBe(false);
    expect(canSubmit('success')).toBe(false);
  });

  it('never treats an opened browser as a completed sign-in', () => {
    /*
     * The bug this guards has already shipped here once: the OAuth call resolves
     * when the browser is UP, not when the user has consented, so treating it as
     * success advances to a signed-in tree with no session and every query there
     * hangs behind a permanent spinner.
     */
    const body = read('src/screens/OnboardingScreen.tsx');
    expect(body).toContain("result === 'redirected'");
    const auth = read('src/api/auth.ts');
    expect(auth).toMatch(/GoogleResult\s*=\s*'session'\s*\|\s*'redirected'/);
  });
});

describe('timing comes from the source', () => {
  it('advances a step faster than it leaves the welcome screen', () => {
    // `.smooth(duration: 0.5)` on an advance against 0.7 on the welcome exit. A
    // step change moves less, and matching them makes the middle of the flow
    // feel slower than its beginning.
    const welcomeExit = 700;
    expect(STEP_ADVANCE_MS).toBeLessThan(welcomeExit);
  });

  it('delays the completion row behind the step that produced it', () => {
    // The source's `.animation(.default.delay(0.4), value: hasFinishedForm)`.
    // Zero here and the result appears while the last step is still collapsing.
    expect(COMPLETION_DELAY_MS).toBeGreaterThan(0);
    expect(COMPLETION_DELAY_MS).toBeLessThan(STEP_ADVANCE_MS);
  });
});

/**
 * The Credential Manager path. None of it can run under jest — it needs Play
 * services on a real device — so what is asserted here is the wiring and the
 * decisions, which are exactly the parts that fail silently.
 */
describe('the welcome layout survives a short window', () => {
  it('lays the two blocks out with flex, not fixed offsets', () => {
    /*
     * The reference pins the carousel to top+120 and the CTA block to bottom on a
     * 914dp iPhone, where they cannot meet. On the minSdk floor they do: API 24
     * emulators are 411x731dp, 183dp shorter, and the carousel landed on the
     * wordmark. Verified 2026-08-26. 16:9 is most of the older Xiaomi/Oppo/Vivo
     * base in India, so the fix — a flex column that divides available height —
     * is not optional polish.
     */
    const body = read('src/screens/OnboardingScreen.tsx');
    // The welcome region must be a flex container that shares height.
    expect(body).toMatch(/welcome:\s*\{[^}]*flex:\s*1[^}]*justifyContent:\s*'space-between'/s);
    // The two blocks must NOT be position:absolute any more.
    expect(body).not.toMatch(/block:\s*\{[^}]*position:\s*'absolute'/s);
    expect(body).not.toMatch(/column:\s*\{[^}]*position:\s*'absolute'/s);
  });
});

describe('the control does not animate on a step change', () => {
  it('honours the source\'s .animation(.none, value: currentStep)', () => {
    /*
     * `MultiStepForm` puts `.animation(.none, value: currentStep)` on its
     * `ContinueButton`, so the control does NOT morph while the rows above it
     * collapse. React Native has no implicit layout animation, so the default
     * already matches — which is exactly why this needs pinning: the day someone
     * adds a layout transition to make the form "feel smoother", they will
     * reintroduce the thing the reference deliberately switched off, and nothing
     * else will complain.
     */
    const body = read('src/screens/OnboardingScreen.tsx');
    const controls = body.slice(body.indexOf("identify === 'choose' ?"));
    expect(controls).not.toMatch(/layout=\{/);
    expect(controls).not.toMatch(/LinearTransition/);
  });
});

describe('sign in with Google happens in an app-owned sheet', () => {
  it('registers the native module, or the bridge is undefined at runtime', () => {
    /*
     * A module that compiles but is never added to a ReactPackage is invisible
     * to JS: `NativeModules.GoogleCredential` is simply `undefined`, nothing
     * throws at startup, and the first symptom is the browser fallback running
     * forever with no explanation.
     */
    const pkg = read('android/app/src/main/java/com/companionchat/InAppUpdatePackage.kt');
    expect(pkg).toContain('GoogleCredentialModule(reactContext)');
  });

  it('implements the BUTTON flow, not only the bottom sheet', () => {
    /*
     * https://developer.android.com/identity/sign-in/credential-manager-siwg
     *
     * Google specifies two UIs and says to implement both: the bottom sheet
     * (`GetGoogleIdOption`) for automatic and returning sign-in, and
     * `GetSignInWithGoogleOption` for an explicit "Sign in with Google" button —
     * which is exactly what this app shows.
     *
     * The button tier is the only one that works with NO Google account on the
     * device, that can add one, and that can offer an account needing
     * re-authentication. `GetGoogleIdOption` can do none of those, so an
     * implementation with only the sheet fails for a genuinely new user.
     *
     * This shipped with only the sheet, and the gap was invisible: driving the
     * real flow on API 34 showed both sheet passes returning `CANCELED` from the
     * provider while the browser fallback quietly completed the sign-in. A
     * working fallback looks exactly like a working primary path.
     */
    const kt = read('android/app/src/main/java/com/companionchat/GoogleCredentialModule.kt');
    expect(kt).toContain('GetSignInWithGoogleOption.Builder(webClientId)');
    expect(kt).toContain('GetGoogleIdOption.Builder()');
    // The button tier must come AFTER the sheet tiers, or a returning user gets
    // a full picker when they could have had one tap.
    expect(kt.indexOf('GetSignInWithGoogleOption.Builder')).toBeGreaterThan(
      kt.lastIndexOf('GetGoogleIdOption.Builder'),
    );
  });

  it('escalates past a provider failure but never past a dismissal', () => {
    /*
     * A `GetCredentialException` from the provider means that tier could not
     * run, so the next tier is worth trying. A `GetCredentialCancellationException`
     * means the person closed the sheet, and escalating past that would reopen a
     * different sheet under someone who just dismissed one.
     */
    const kt = read('android/app/src/main/java/com/companionchat/GoogleCredentialModule.kt');
    const cancels = kt.match(/GetCredentialCancellationException[\s\S]{0,160}?E_CANCELLED/g) ?? [];
    // Every tier must terminate on a dismissal, not fall through.
    expect(cancels.length).toBeGreaterThanOrEqual(3);
  });

  it('ships the Play services provider, not just the AndroidX API', () => {
    /*
     * `androidx.credentials` alone compiles and then fails every request with
     * NoCredentialException on a device that plainly has Google accounts,
     * because the artifact that actually renders the sheet is the separate
     * play-services-auth provider. This is the single easiest dependency to
     * omit and the hardest failure to read.
     */
    const gradle = read('android/app/build.gradle');
    expect(gradle).toContain('androidx.credentials:credentials:');
    expect(gradle).toContain('androidx.credentials:credentials-play-services-auth:');
    expect(gradle).toContain('com.google.android.libraries.identity.googleid:googleid:');
  });

  it('never hardcodes the OAuth client id', () => {
    // The Google Services plugin compiles it in from google-services.json as
    // `default_web_client_id`. A literal here would silently rot the moment the
    // Firebase project changed, and would disagree with supabase/config.toml.
    const kt = read('android/app/src/main/java/com/companionchat/GoogleCredentialModule.kt');
    expect(kt).toContain('R.string.default_web_client_id');
    expect(kt).not.toMatch(/\d{10,}-[a-z0-9]+\.apps\.googleusercontent\.com/);
  });

  it('sends Google the hashed nonce and Supabase the raw one', () => {
    /*
     * `skip_nonce_check = false` in supabase/config.toml, so this is verified
     * rather than ignored. Google embeds the SHA-256 in the token; Supabase
     * needs the original to compare. Sending the hash to both fails with an
     * error that does not say which value was wrong.
     */
    const kt = read('android/app/src/main/java/com/companionchat/GoogleCredentialModule.kt');
    expect(kt).toContain('setNonce(hashedNonce)');
    expect(kt).toContain('putString("rawNonce", rawNonce)');
    const config = read('supabase/config.toml');
    expect(config).toContain('skip_nonce_check = false');
    const auth = read('src/api/auth.ts');
    expect(auth).toContain('nonce: rawNonce');
  });

  it('treats a dismissed sheet as a decision, not a failure', () => {
    /*
     * Two halves, and both matter. `auth.ts` must rethrow a cancellation rather
     * than falling back — reopening the browser under someone who just dismissed
     * the sheet overrides their choice. The screen must then show nothing.
     */
    const auth = read('src/api/auth.ts');
    expect(auth).toMatch(/reason === 'cancelled'[\s\S]{0,80}throw error/);
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toMatch(/reason === 'cancelled'[\s\S]{0,400}setState\('idle'\)/);
  });

  it('falls back to the browser when the device cannot show a sheet', () => {
    // No Play services, stale Play services, or an unregistered signing
    // certificate all mean "this device cannot show a sheet", not "sign-in is
    // impossible". Without the fallback those users have a dead button.
    const auth = read('src/api/auth.ts');
    expect(auth).toContain('credentialSheetAvailable()');
    expect(auth).toMatch(/await signInWith\('google'\);\s*\n\s*return 'redirected';/);
  });
});

/**
 * Android layout basics. The keyboard is part of the layout, not something to
 * draw behind.
 */
describe('the IME is treated as part of the layout', () => {
  it('lifts the form rather than letting the keyboard cover the input', () => {
    /*
     * The manifest already asks for `adjustResize`, and that alone was not
     * enough: React Native 0.86 runs edge-to-edge, where the window no longer
     * shrinks, and the form is absolutely positioned over the field. The phone
     * number input sat underneath the keyboard.
     */
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('KeyboardAvoidingView');
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:windowSoftInputMode="adjustResize"');
  });

  it('listens for the Android keyboard events, not the iOS-only ones', () => {
    // `keyboardWillShow` never fires on Android, so a `Will`-only listener is a
    // silent no-op there.
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain("'keyboardDidShow'");
    expect(screen).toContain("'keyboardDidHide'");
  });

  it('takes the field off screen while the keyboard is up', () => {
    // The source's `showGradient = !keyboardShown`. A raised keyboard leaves
    // about a third of the display, and a saturated field in the remainder makes
    // a text input something to squint at.
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('hidden={keyboardUp}');
  });
});
