import { readFileSync } from 'fs';
import { join } from 'path';
import { BLOOM_PALETTES } from '../src/lib/bloom';
import {
  COMPLETION_DELAY_MS,
  SOURCE_METRICS,
  STEP_ADVANCE_MS,
  STEPS,
  canSubmit,
  coresCollapsed,
  fieldAtRest,
  paletteFor,
  visibleSteps,
  type Phase,
} from '../src/lib/onboarding';
import { TOKENS } from '../src/theme/tokens';
import { providerPaletteFor } from '../src/lib/providerOnboarding';

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
  it('shows one row until the phone route is taken (no age)', () => {
    /*
     * The one structural departure from the source, and it is forced: Fuse's
     * three steps are sequential, ours are alternatives. A permanently-visible
     * "Your code" row would be a promise the Google route never keeps.
     */
    expect(visibleSteps('undecided')).toHaveLength(1);
    expect(visibleSteps('google')).toHaveLength(1);
    // Phone now shows real steps — Choose a way in, Your number, Your code —
    // rather than one "Say hello" catch-all plus the code row.
    expect(visibleSteps('phone')).toHaveLength(3);
  });

  it('appends the age row when includeAge is true', () => {
    /*
     * Age is not shown during the auth phase — it would be a promise the
     * flow has not earned yet. It is added after auth succeeds, so the row
     * grows in via the same offset-plus-opacity transition as verify.
     */
    expect(visibleSteps('undecided', { includeAge: true })).toHaveLength(2);
    expect(visibleSteps('google', { includeAge: true })).toHaveLength(2);
    expect(visibleSteps('phone', { includeAge: true })).toHaveLength(4);
  });

  it('age row is always last', () => {
    const google = visibleSteps('google', { includeAge: true });
    expect(google[google.length - 1]?.key).toBe('age');
    const phone = visibleSteps('phone', { includeAge: true });
    expect(phone[phone.length - 1]?.key).toBe('age');
  });

  it('appends the language row after age, and only after it', () => {
    /*
     * Order is fixed rather than alphabetical luck: age is the gate the app
     * cannot start without (`needsAgeBracket`, and App.tsx blocks entry on it),
     * so it is asked first, and the optional preference is the last thing
     * between the member and the product.
     */
    const both = visibleSteps('google', {
      includeAge: true,
      includeLanguages: true,
    });
    expect(both.map(s => s.key)).toEqual(['choose', 'age', 'languages']);
    const phone = visibleSteps('phone', {
      includeAge: true,
      includeLanguages: true,
    });
    expect(phone.map(s => s.key)).toEqual([
      'choose',
      'number',
      'code',
      'age',
      'languages',
    ]);
  });

  it('can ask for languages without age', () => {
    /*
     * The two are gated independently and either can appear alone. A member who
     * already has a bracket — anyone who signed up before migration 072, or who
     * came in through the browser-redirect path where ProfileSetupScreen
     * collects it — must still be asked the language question. Chaining them
     * would mean the only people ever asked were the ones who needed both.
     */
    expect(
      visibleSteps('google', { includeLanguages: true }).map(s => s.key),
    ).toEqual(['choose', 'languages']);
    // ...and neither flag still means the auth checklist only.
    expect(visibleSteps('google')).toHaveLength(1);
  });

  it('always leads with the choose step, whichever route is taken', () => {
    for (const route of ['undecided', 'google', 'phone'] as const) {
      expect(visibleSteps(route)[0]?.key).toBe('choose');
      expect(visibleSteps(route, { includeAge: true })[0]?.key).toBe('choose');
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

  it('age bracket constants match the migration check constraint', () => {
    /*
     * The check constraint in migration 043 gates the four values at the DB
     * layer. If the source-of-truth list in profileSetup.ts drifts, the RPC
     * rejects a value at runtime without a TypeScript error.
     *
     * Both sides are read as text so no native imports are executed. The
     * AGE_BRACKETS export is a `const` array literal; extract it by pattern
     * rather than by require.
     */
    const migration = read('supabase/migrations/043_member_age_bracket.sql');
    const setup = read('src/api/profileSetup.ts');
    // Extract the array literal from `export const AGE_BRACKETS = [...] as const;`
    const match = setup.match(/AGE_BRACKETS\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const brackets = (match?.[1] ?? '')
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    expect(brackets.length).toBeGreaterThan(0);
    for (const bracket of brackets) {
      expect(migration).toContain(`'${bracket}'`);
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

  it('turns to the form palette the moment Continue is pressed, with the exit', () => {
    /*
     * `OnboardingFlow.swift:69-74`: `gradient = form.first.gradient` is assigned
     * inside the same `withAnimation(.smooth(duration: 0.7))` as `phase = 1`, so
     * colour and position leave together from t=0. The per-gradient
     * `.animation(.smooth.delay(x), value: phase > 0)` (lines 40, 48, 56) delays
     * only the centre/radius. The previous assertion here pinned the opposite —
     * welcome palette through `leaving` — which produced a second cross-fade at
     * the 1.2s handoff and the jerk it was meant to prevent.
     */
    expect(paletteFor('leaving', 'choose')).toBe(paletteFor('form', 'choose'));
    expect(paletteFor('leaving', 'choose')).not.toBe(BLOOM_PALETTES.welcome);
  });

  it('mounts the form at the press and shows it at the handoff', () => {
    /*
     * A scheduling decision, not a change to the 1.2s hold: the form subtree is
     * the heaviest commit of the flow and used to land 50ms after the last
     * layer stopped. Mounting it hidden at the press puts that commit in the
     * first 400ms, where no layer moves; `formReady` still flips at
     * BLOOM_HOLD_MS and until then the subtree is untouchable and unread.
     */
    // ProviderApplicationScreen was removed here 2026-09-03: its provider
    // onboarding is now a plain verify → profile → done flow with no bloom
    // welcome, so it has no form-at-the-press handoff. The member welcome keeps it.
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain("const showForm = phase !== 'welcome';");
    expect(screen).toContain("pointerEvents={formReady ? 'auto' : 'none'}");
    expect(screen).toContain('formIn.value = withTiming(1, {');
    // Arrival is the source's `.smooth` (0.5s), not the 0.7s content exit.
    expect(screen).toMatch(/formIn\.value = withTiming\(1, \{\s*duration: STEP_ADVANCE_MS/);
    expect(screen).not.toContain('entering={FadeInDown.duration(BLOOM_CONTENT_MS)}');
  });

  it('never animates a layout property on the step title', () => {
    // Animated fontSize/lineHeight force a text re-measure and a layout pass on
    // every frame, on top of the field's gradient cross-fade. The title is two
    // fixed sizes cross-faded on opacity (motion-system.md rule 7).
    const step = read('src/components/OnboardingStep.tsx');
    expect(step).not.toMatch(/fontSize:\s*interpolate/);
    expect(step).not.toMatch(/lineHeight:\s*interpolate/);
    expect(step).toContain('titleOpenFade');
    expect(step).toContain('titleShutFade');
  });

  it('holds the word column still while the welcome content leaves', () => {
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain("paused={phase !== 'welcome'}");
    const column = read('src/components/WordColumn.tsx');
    expect(column).toMatch(/if \(paused\) \{\s*return;/);
  });

  it('changes the field exactly once per Continue', () => {
    // If `leaving` and `form` ever disagree on palette or cores, the handoff at
    // BLOOM_HOLD_MS starts a second swap on layers that just came to rest.
    for (const stage of ['choose', 'number', 'code'] as const) {
      expect(paletteFor('leaving', stage)).toBe(paletteFor('form', stage));
    }
    expect(coresCollapsed('leaving')).toBe(coresCollapsed('form'));
    expect(providerPaletteFor('leaving', 0)).toBe(providerPaletteFor('form', 0));
    expect(providerPaletteFor('leaving', 0)).not.toBe(BLOOM_PALETTES.welcome);
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

  it('sends directly and keeps a rejected code editable', () => {
    const model = read('src/lib/onboarding.ts');
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(model).not.toContain("'confirm'");
    expect(screen).not.toContain('Is this the correct number?');
    expect(screen).not.toContain("fail(result.message);\n        setCode('');");
    expect(screen).toContain('testID="onboard-change-number"');
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

  it('meets the Android minimum touch target on the submit disc', () => {
    // The source lands near 40dp; Android's floor is 48. The app standardises on
    // that floor, so submitTarget must equal it rather than the old iOS 44.
    expect(SOURCE_METRICS.submitTarget).toBe(TOKENS.interaction.minTarget);
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

  it('shows the account bottom sheet first, then the button as a fallback', () => {
    /*
     * https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
     *
     * The guide says to ship BOTH surfaces. `GetGoogleIdOption` renders the
     * slide-up account sheet — authorised accounts first, then all accounts —
     * and `GetSignInWithGoogleOption` is the explicit button/dialog, the last
     * resort that can also ADD an account when the device has none. The button
     * on its own only ever shows the centred dialog, never the sheet.
     *
     * An earlier build was button-only because the Google Cloud project had no
     * Android OAuth client, so the sheet dead-ended on GMS status 16 (surfaced
     * as cancellation). Both signing certs are registered now, so the sheet is
     * back, ordered ahead of the button.
     */
    const kt = read('android/app/src/main/java/com/companionchat/GoogleCredentialModule.kt');
    expect(kt).toContain('GetGoogleIdOption.Builder()');
    expect(kt).toContain('setFilterByAuthorizedAccounts(true)');
    expect(kt).toContain('setFilterByAuthorizedAccounts(false)');
    expect(kt).toContain('GetSignInWithGoogleOption.Builder(webClientId)');
    // No account for a step throws NoCredentialException and falls through to the
    // next surface; a genuine dismissal is a cancellation and stops the chain.
    expect(kt).toContain('NoCredentialException');
  });

  it('distinguishes a button dismissal from a provider failure', () => {
    const kt = read('android/app/src/main/java/com/companionchat/GoogleCredentialModule.kt');
    const cancels = kt.match(/GetCredentialCancellationException[\s\S]{0,160}?E_CANCELLED/g) ?? [];
    expect(cancels).toHaveLength(1);
    expect(kt).toContain('E_FAILED');
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

  it('goes through the sheet too, not the browser', () => {
    // OnboardingScreen owns sign-in end to end and calls `signInWithGoogle`
    // (Credential Manager, browser fallback). There used to be a second,
    // returning-user screen (AuthScreen) that shipped calling
    // `signInWith('google')` — the browser-only path — so the app-owned sheet
    // never appeared from there even though every precondition was in place.
    // That screen is gone (Amit, 2026-09-03: "remove this from app and wire
    // welcome screen"), so this now pins the one sign-in surface that remains.
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('signInWithGoogle()');
    expect(screen).not.toMatch(/signInWith\(\s*['"]google['"]\s*\)/);
    expect(screen).not.toMatch(/signInWith\(provider\)/);
    expect(screen).toMatch(/reason === 'cancelled'/);
  });

  it('announces a synchronous session so the screen unmounts', () => {
    // App has no auth-state subscription — its boot effect re-reads the session
    // only when `attempt` changes. A Credential Manager token and a verified
    // phone code both mint a session in-process with no deep link, so
    // OnboardingScreen must call back on success or the session is set beneath
    // a screen that never leaves.
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('onDone');
    const app = read('App.tsx');
    // The signedOut phase's only render site wires onDone to a handler that
    // shows the splash and bumps attempt (setBoot loading + setAttempt), so
    // the boot effect re-reads the session without flashing the sign-in
    // screen. There is exactly one such site now — the old two-screen
    // (welcome vs. returning-user AuthScreen) split is gone.
    const wirings =
      app.match(/<OnboardingScreen[\s\S]*?onDone=\{\(\) => \{[\s\S]*?setAttempt\(a => a \+ 1\)/g) ?? [];
    expect(wirings.length).toBe(1);
  });
});

describe('post-auth age choices remain readable in both themes', () => {
  it('uses themed ink at rest and fixed dark ink on the white selected pill', () => {
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('color: t.color.text.primary');
    expect(screen).toContain('color: LIGHT.color.text.primary');
    expect(screen).not.toMatch(/ageChipLabel:\s*{[^}]*color:\s*t\.color\.text\.onAccent/s);
    expect(screen).not.toMatch(/ageChipLabelSelected:\s*{[^}]*color:\s*t\.color\.text\.primary/s);
  });
});

describe('phone verification hands off without visual input artifacts', () => {
  it('keeps the native OTP input focused while verification is pending', () => {
    const screen = read('src/screens/OnboardingScreen.tsx');
    const start = screen.indexOf('<CodeField');
    const field = screen.slice(start, screen.indexOf('/>', start));
    expect(field).not.toContain('editable=');
    expect(field).toContain('verifying={state ===');
  });

  it('dismisses the IME before revealing the post-auth age step', () => {
    const screen = read('src/screens/OnboardingScreen.tsx');
    const verify = screen.slice(screen.indexOf('const onVerify'), screen.indexOf('const onSubmitAge'));
    expect(verify.indexOf('Keyboard.dismiss()')).toBeGreaterThan(-1);
    expect(verify.indexOf('Keyboard.dismiss()')).toBeLessThan(
      verify.indexOf('completeAuthentication()'),
    );
  });

  it('makes the real input transparent as a whole, not only its unreliable glyph color', () => {
    const field = read('src/components/CodeField.tsx');
    expect(field).toMatch(/input:\s*{[\s\S]*opacity:\s*0\.01/);
  });

  it('gives the code field a working, verifying and success state', () => {
    // A wrong code shakes AND taps a haptic (Telegram KEYBOARD_TAP), then the
    // red clears itself; a code in flight shows an accent spinner rather than a
    // frozen field; a correct code fills the boxes in the sage success colour
    // and pops once before the screen advances.
    const field = read('src/components/CodeField.tsx');
    expect(field).toContain('errorTick()');
    expect(field).toContain('code-verifying');
    expect(field).toContain('text.positive');
    expect(field).toMatch(/succeeded\?:\s*boolean/);
    // The onboarding code field is wired to all three states.
    const screen = read('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain("succeeded={state === 'success'}");
    expect(screen).toContain("verifying={state === 'loading'}");
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

/**
 * Comments removed, string and template literals preserved.
 *
 * Duplicated from `textFields.test.ts` rather than imported, which is this
 * repo's convention: importing another `*.test.ts` would re-register that
 * file's `describe` blocks inside this suite, because jest's `testMatch` makes
 * every file in `__tests__` a suite.
 *
 * It has to be quote-aware. A naive `//` rule eats the `//` in every
 * `https://`, and the block below asserts against a file carrying a dozen RULE
 * 1 doc citations — a naive stripper would delete exactly those and then grade
 * the wreckage. It also means the prose in a citation cannot satisfy a gate:
 * the comment beside the field quotes `maxLength`, and that mention must not be
 * what makes the assertion pass.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c + (d ?? '');
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * The field a new member actually types their number into.
 *
 * `PhoneVerifySheet` got the grouped, capped, caret-managed field first, and
 * this one did not — which meant the screen everybody signs in through was the
 * screen without it. The behaviour itself is proved as pure functions in
 * `__tests__/phone.test.ts`; these gates only assert that this field is wired
 * to those functions, and country-aware rather than hard-coded to India.
 */
describe('the sign-in number field is country-aware', () => {
  const screen = stripComments(read('src/screens/OnboardingScreen.tsx'));
  /* Bounded from the picker to the end of the input element. Anchoring from
     the `testID` and searching backwards would be fragile; anchoring forwards
     from `<CountryPicker` and stopping at the `testID` line's element close
     keeps the slice over exactly the two controls under test. */
  const at = screen.indexOf('<CountryPicker');
  const field = screen.slice(at, screen.indexOf('onboard-send-code', at));

  it('has a slice to assert against', () => {
    // The trap this closes has caught a block in textFields.test.ts already: an
    // empty slice makes every `toContain` below pass vacuously.
    expect(at).toBeGreaterThan(0);
    expect(field).toContain('onboard-phone');
    expect(field.length).toBeGreaterThan(200);
  });

  it('renders the grouped string and stores only bare digits', () => {
    // `value` is computed on the line it is used. Nothing holds the formatted
    // number, so no later edit can hand it to sendPhoneOtp.
    expect(field).toContain('value={formatNationalDigits(phone, country)}');
    expect(field).toContain('onChangeText={onChangePhone}');
    // The old wiring put raw user text straight into state, unformatted and
    // uncapped.
    expect(field).not.toContain('onChangeText={setPhone}');
    expect(field).not.toContain('value={phone}');
  });

  it('caps the display through maxLength, and derives the cap from the country', () => {
    /*
     * React Native names `maxLength` as the fix for the flicker a JS-only cap
     * causes, and says "set/UPDATE maxLength" — so with a picker on screen the
     * prop has to move when the selection does. A literal here would be 11 for
     * every country: two digits too many for Singapore, one too few for the US.
     * https://reactnative.dev/docs/textinput#maxlength
     */
    expect(field).toContain('maxLength={nationalDisplayLength(country)}');
    expect(field).not.toContain('maxLength={IN_MOBILE_DISPLAY_LENGTH}');
    expect(field).not.toMatch(/maxLength=\{\d+\}/);
  });

  it('controls the caret and feeds the member’s own taps back into it', () => {
    // A `selection` that only moves on text change is a caret the user cannot
    // reposition; without one at all it lands wrong every time a separator is
    // inserted. https://reactnative.dev/docs/textinput#selection
    expect(field).toContain('selection={{ start: caret, end: caret }}');
    expect(field).toContain('setCaret(e.nativeEvent.selection.start)');
  });

  it('reformats and re-caps when the country changes', () => {
    // Straight to `setDialCode` left the old country's digits and grouping
    // under the new dial code.
    expect(field).toContain('onChange={onChangeCountry}');
    expect(field).not.toContain('onChange={setDialCode}');
    expect(screen).toContain('retargetPhone(phone, countryForDialCode(next))');
    // Not a useEffect on dialCode: that renders one frame of the old digits
    // under the new dial code.
    expect(screen).not.toMatch(/useEffect\([^)]*\)[\s\S]{0,400}retargetPhone/);
  });

  it('gates the submit on the selected country’s length, not a fixed ten', () => {
    expect(screen).toContain('isCompleteNationalNumber(phone, country)');
    // The old guard: any six characters lit the button, in every country.
    expect(screen).not.toContain('phone.trim().length >= 6');
    expect(screen).not.toMatch(/phone\.length\s*===\s*10/);
  });

  it('hands auth the dial code and the bare digits, and nothing else', () => {
    /*
     * The whole point of keeping `phone` bare. `normalisePhone` inside
     * `sendPhoneOtp` strips non-digits anyway, but a formatted value reaching
     * it is how a country-code guess gets a chance to fire on the wrong length.
     */
    expect(screen).toContain('const fullPhone = `${dialCode} ${phone}`;');
    expect(screen).not.toContain('formatNationalDigits(phone, country)}`');
    // Exactly one place builds it, and all three auth calls read that one.
    expect(screen.match(/const fullPhone =/g) ?? []).toHaveLength(1);
    expect(screen).toContain('sendPhoneOtp(fullPhone)');
    expect(screen).toContain('verifyPhoneOtp(fullPhone, entered)');
  });
});

describe('the sign-in number asks Android for the right thing', () => {
  /* Reuses the file's own `read`. Comments stripped, and line-anchored only: a
     naive `//` rule eats the `https://` in the citations this repo requires
     next to every value. */
  const code = (r: string): string =>
    read(r).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('uses tel-national, because the country code has its own view', () => {
    /*
     * The autofill page splits these by exactly that: `tel` is
     * AUTOFILL_HINT_PHONE_NUMBER, "requesting a full phone number in a single
     * view", while `tel-national` is AUTOFILL_HINT_PHONE_NATIONAL for the
     * national part when the code is collected apart from it. This screen has
     * a CountryPicker sibling, so the field only ever holds national digits —
     * which is also what `nationalDisplayLength` caps it to. Asking for a full
     * number invites a +91-prefixed string into a field capped at 10 or 11.
     */
    const screen = code('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('autoComplete="tel-national"');
    expect(screen).not.toContain('autoComplete="tel"');
    // And the picker really is a separate view, which is the premise.
    expect(screen).toContain('<CountryPicker');
  });

  it('sets inputMode, which takes precedence over keyboardType', () => {
    // "inputMode ... takes precedence over" textContentType and keyboardType,
    // per reactnative.dev/docs/textinput#inputmode. keyboardType stays for the
    // versions that only read it.
    const screen = code('src/screens/OnboardingScreen.tsx');
    expect(screen).toContain('inputMode="tel"');
    expect(screen).toContain('keyboardType="phone-pad"');
  });

  it('keeps the compound container instead of nesting a second M3Field', () => {
    /*
     * Deliberate, not an oversight. `styles.field` already IS the M3 outlined
     * container (56dp / 1dp / 16dp), holding the picker and the number as one
     * compound input. `M3Field` draws its own container, so using it here would
     * nest 56dp of chrome inside 56dp of chrome.
     */
    const screen = code('src/screens/OnboardingScreen.tsx');
    expect(screen).not.toContain('<M3Field');
    const field = screen.slice(screen.indexOf('    field: {'));
    expect(field.slice(0, 400)).toContain('height: 56');
    expect(field.slice(0, 400)).toContain('borderWidth: 1');
    expect(field.slice(0, 400)).toContain('paddingLeft: TOKENS.space.md');
  });
});

