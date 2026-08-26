import React, { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

/**
 * Everything React Native's `TextInput` accepts, except the one prop this
 * component exists to guarantee.
 *
 * Omitting it from the type rather than merely defaulting it is deliberate. A
 * default placed before the spread is silently overridable, and a default placed
 * after the spread accepts the prop in TypeScript and then ignores it, which is
 * worse — the caller reads their own code as having taken effect. Removing it
 * from the surface makes the guarantee checkable at compile time.
 */
export type TextFieldProps = Omit<TextInputProps, 'disableFullscreenUI'>;

/**
 * Every text input in the app. Nothing imports React Native's `TextInput`
 * directly except this file, and a test enforces that.
 *
 * **It exists for one prop.** `disableFullscreenUI` defaults to `false` in React
 * Native, and with it off the input method is free to take the entire window
 * whenever it decides there is not much room — which on a phone means any
 * landscape orientation. What appears is the IME's fullscreen "extract" editor:
 * a bare white field, a grey ALL-CAPS action button and a coloured underline,
 * with the app not shrunk beside it or dimmed behind it but simply gone. Not one
 * token of the design system survives. Reproduced on API 34 with Gboard
 * 12.4.05 on 2026-08-26, screenshotted.
 *
 * **This app was locked to portrait to avoid exactly that**, which put it in
 * breach of Android's large-screen guidance — orientation and resizability
 * restrictions are the specific thing that guidance asks apps not to impose.
 * Setting one prop removes the reason, and removing the reason is what lets the
 * restriction go.
 *
 * **Why a wrapper rather than the prop on each field.** The manifest comment
 * that justified the portrait lock named this exact trap: a per-field opt-out is
 * a thing somebody has to remember for every field added afterwards, and there
 * are thirteen across nine files today. A default that lives in one component,
 * plus a test that fails when `react-native`'s `TextInput` is imported anywhere
 * else, is a rule that holds without anybody remembering it.
 *
 * **The guarantee is the input method's, not the platform's, and that is a real
 * downgrade from what it replaced.** AOSP's own javadoc for
 * `IME_FLAG_NO_FULLSCREEN` says so outright: "Applications need to be aware that
 * the flag is not a guarantee, and some IMEs may ignore it."
 * `InputMethodService.onEvaluateFullscreenMode()` is a public overridable method,
 * so a keyboard is free to return true without ever reading `imeOptions`. The
 * portrait lock this replaced was enforced by WindowManager and could not be
 * ignored by anyone.
 *
 * What is actually verified: Gboard 12.4.05 on API 34, landscape, flag on, our
 * own field rendering — checked twice, once here and once independently.
 * What is NOT verified: Samsung Keyboard, SwiftKey, and the Indic keyboards a
 * large share of Indian users run. Those are precisely the cases the lock used to
 * cover for free, and if one of them ignores the flag the symptom is the
 * fullscreen extract editor returning on that keyboard only. Test there before
 * assuming otherwise.
 *
 * `IME_FLAG_NO_EXTRACT_UI` is NOT the answer to that gap and should not be
 * reached for. AOSP calls using it "discouraged" and says it "may become
 * deprecated"; it only hides the extracted-text area *inside* fullscreen mode, so
 * the IME still owns the window and the sliver of app showing through is not
 * touch-responsive. React Native 0.86 exposes no way to set it either.
 *
 * `forwardRef` because `CodeField` focuses its input imperatively, and a wrapper
 * that swallowed the ref would silently break that.
 *
 * Everything else passes straight through. This is not a styled component and
 * should not become one — screens own their own appearance, and the moment this
 * starts making visual decisions it stops being safe to route every field
 * through it.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextFieldView(
  props,
  ref,
) {
  // After the spread, and the prop is not in `TextFieldProps`, so this cannot be
  // turned off from a call site.
  return <TextInput ref={ref} {...props} disableFullscreenUI />;
});
