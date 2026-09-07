import React, { forwardRef, useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

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
 *
 * **That last paragraph still holds, and `M3Field` below is not a violation of
 * it.** The styling lives in a second, separately named component that composes
 * this one. This primitive stays appearance-free so the surfaces that are
 * deliberately NOT an M3 text field — the chat composer, the emoji search, the
 * segmented OTP field — can keep the IME guarantee without inheriting text-field
 * chrome they should not have.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextFieldView(
  props,
  ref,
) {
  // After the spread, and the prop is not in `TextFieldProps`, so this cannot be
  // turned off from a call site.
  return <TextInput ref={ref} {...props} disableFullscreenUI />;
});

export interface M3FieldProps extends TextFieldProps {
  /**
   * Rendered above and outside the container, which is M3's `Above` label
   * position rather than the notched `Cutout` one. See the geometry note.
   */
  label?: string;
  /** Supporting text under the container. Suppressed while `error` is showing. */
  supportingText?: string;
  /**
   * The error message. Its presence *is* the error state — there is no separate
   * boolean to get out of sync with it. Replaces `supportingText` when set, per
   * M3: the supporting-text slot is one slot.
   */
  error?: string | null;
  /** Style for the outer wrapper (label + container + supporting text). */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * The app's Material 3 outlined text field. Every labelled text and numeric
 * input goes through this.
 *
 * **Why it exists.** Four screens had each written their own field style, and
 * they had drifted: heights of 48, 52 and 52 (`minHeight`), border widths of
 * `hairlineWidth` and `1`, and two separate copies of a local `Field` label
 * wrapper. None of the three heights was M3's. Amit, 2026-09-07: "use m3 native
 * input components please for these numerical and text inputs everywhere".
 *
 * **Which variant.** Outlined, not filled — a stroke on `bg.base` rather than a
 * filled `surface-variant` container. That is what all four screens already
 * drew, so it is the app's existing choice being made explicit rather than a new
 * one being imposed.
 *
 * **The numbers, and where each one is actually from.** `m3.material.io` is a
 * client-rendered app and returns nothing but a title to a fetch, so none of
 * this is from there. It is from the token source androidx generates the spec
 * into, read on 2026-09-07:
 *
 * `compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/OutlinedTextFieldTokens.kt`
 *   - `ContainerHeight get() = 56.0.dp`                       → `TOKENS.layout.field`
 *   - `OutlineWidth get() = 1.0.dp`                           → resting border
 *   - `FocusOutlineWidth get() = 2.0.dp`                      → focused border
 *   - `DisabledOutlineOpacity = 0.12f`, `DisabledInputOpacity = 0.38f`
 *   - `InputFont → BodyLarge`, `SupportingFont → BodySmall`
 *   - `InputColor → OnSurface`, `OutlineColor → Outline`,
 *     `ErrorOutlineColor → Error`, `InputPlaceholderColor → OnSurfaceVariant`,
 *     `SupportingColor → OnSurfaceVariant`
 *
 * `.../material3/internal/TextFieldImpl.kt`
 *   - `TextFieldPadding get() = 16.dp`                        → `TOKENS.space.md`
 *   - `SupportingTopPadding get() = 4.dp`                     → `TOKENS.space['2xs']`
 *   - `AboveLabelBottomPadding get() = 4.dp`                  → label→container gap
 *
 * `.../material3/TextFieldDefaults.kt`
 *   - `MinHeight: Dp = 56.dp` (corroborates ContainerHeight)
 *   - `class Above` (line 2367): "The label is positioned above and outside the
 *     text field container." A first-class M3 label position, and the one every
 *     screen here already used, so `Above` is what this implements — not the
 *     notched `Cutout` default.
 *
 * Colour roles map onto this app's tokens as OnSurface→`text.primary`,
 * Outline→`border.strong`, OnSurfaceVariant→`text.tertiary` for placeholder and
 * `text.secondary` for supporting text, Error→`state.danger`.
 *
 * **Three deliberate departures, per RULE 1 §6.**
 *
 *  1. *Corner radius 10, not M3's `CornerExtraSmall` = 4dp*
 *     (`ShapeTokens.kt:38`). `TOKENS.radius.field` is 10 and its note in
 *     `design/tokens.json` records why: it is the radius shared by the search
 *     field, the OTP segment and the standard filled button across this product.
 *     Moving fields to 4 would make them the only 4dp corner in the app and
 *     break that family. The product token wins over the spec default here.
 *  2. *Focus outline is ink (`text.primary`), not M3's `FocusOutlineColor →
 *     Primary*. This app runs an explicit accent budget: coral means "act" — the
 *     send button, your own bubble, an unread count. `CodeField` already made
 *     exactly this call for its active segment border, with the reason that a
 *     caret is not an action and spending the accent there puts coral on a screen
 *     that already has a primary button. A focused field is the same case, and
 *     the two must agree or the OTP step and the number step look unrelated.
 *  3. *Label is `labelMedium` (12/16 SemiBold), not M3's `LabelFont → BodyLarge`
 *     (16/24)*. Both existing `Field` wrappers used `labelMedium`, and at 16sp a
 *     label sitting above a 16sp input reads as a second input rather than as a
 *     label for the one below it. M3 keeps `BodyLarge` for `Above` because it
 *     shares the token with the `Cutout` position, where the label starts inside
 *     the field and must match the input it overlays; that reason does not apply
 *     once the label is outside the container.
 *
 * Everything else is the spec.
 */
export const M3Field = forwardRef<TextInput, M3FieldProps>(function M3FieldView(
  { label, supportingText, error, containerStyle, style, onFocus, onBlur, ...rest },
  ref,
) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  // The caller's handlers still run. Swallowing them is the bug this shape
  // exists to avoid — several fields drive their own "touched" state off onBlur.
  // The event types are read off `TextInputProps` rather than imported by name:
  // React Native renamed these to `FocusEvent`/`BlurEvent`, and deriving them
  // means this does not need editing the next time that happens.
  const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    e => {
      setFocused(true);
      onFocus?.(e);
    },
    [onFocus],
  );
  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    e => {
      setFocused(false);
      onBlur?.(e);
    },
    [onBlur],
  );

  const disabled = rest.editable === false;
  const hasError = error != null && error !== '';

  /*
   * The focused state widens the stroke from 1 to 2, and React Native's box model
   * is border-box, so that would push the text 1dp inward and make every
   * focus/blur nudge the glyphs sideways. The horizontal padding drops by the
   * same 1dp to hold the text still, which is what M3 shows — the stroke thickens
   * outward-looking, the content does not move. Height is unaffected: `height`
   * already includes the border, and the text is centred in what is left.
   */
  const box = useMemo(() => {
    const width = focused ? 2 : 1;
    return {
      borderWidth: width,
      paddingHorizontal: TOKENS.space.md - width + 1,
      borderColor: hasError
        ? theme.color.state.danger
        : focused
          ? theme.color.text.primary
          : theme.color.border.strong,
      // M3 DisabledOutlineOpacity 0.12 / DisabledInputOpacity 0.38. Applied to
      // the container rather than per-element so the stroke and the glyphs fade
      // together; 0.38 is the input's figure and the stroke reads correctly
      // under it at this size.
      opacity: disabled ? 0.38 : 1,
    };
  }, [focused, hasError, disabled, theme]);

  const message = hasError ? error : supportingText;

  return (
    <View style={containerStyle}>
      {label != null ? (
        <Text
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.titleSmall}
          style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextField
        ref={ref}
        // Placeholder colour is a prop, not a style, so it cannot come from the
        // stylesheet — and every screen was passing it by hand. Defaulted here
        // and still overridable.
        placeholderTextColor={theme.color.text.tertiary}
        allowFontScaling
        // M3 draws the container; Android's own default underline would sit
        // inside it. Every screen was already turning this off by hand or had
        // forgotten to.
        underlineColorAndroid="transparent"
        /* The `Above` label is a sibling Text, so TalkBack has nothing tying it
           to this input — it would announce an unlabelled edit field. Before the
           spread, so a caller with a fuller label ("PAN number" for a field
           labelled "PAN") still wins. */
        accessibilityLabel={label}
        {...rest}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={[
          styles.input,
          rest.multiline === true ? styles.inputMultiline : styles.inputSingle,
          box,
          style,
        ]}
      />
      {message != null && message !== '' ? (
        <Text
          allowFontScaling
          // An error is the one thing here a screen reader has to be told about
          // without being asked. Supporting text that is merely descriptive is
          // not announced, because it does not change.
          accessibilityLiveRegion={hasError ? 'polite' : 'none'}
          style={[styles.supporting, hasError && styles.supportingError]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // AboveLabelBottomPadding = 4.dp (TextFieldImpl.kt). Indented by the
    // container's own 16dp so the label sits over the input text, not over the
    // stroke.
    label: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space['2xs'],
    },
    input: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      backgroundColor: t.color.bg.base,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
    },
    // ContainerHeight = 56.0.dp. A fixed height, not a minimum: a single-line
    // field that grows is a field that shifts the button under it.
    inputSingle: {
      height: TOKENS.layout.field,
    },
    // Multiline takes the same 56 as its floor and grows from there. The
    // vertical padding has to be explicit because there is no fixed height left
    // to centre against, and `textAlignVertical` keeps the first line at the top
    // instead of floating in the middle of an expanded box.
    inputMultiline: {
      minHeight: TOKENS.layout.field,
      paddingTop: TOKENS.space.sm,
      paddingBottom: TOKENS.space.sm,
      textAlignVertical: 'top',
    },
    // SupportingTopPadding = 4.dp, SupportingFont → BodySmall (bodySmall is
    // 12/16, which is M3's own bodySmall).
    supporting: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space['2xs'],
    },
    supportingError: {
      color: t.color.state.danger,
    },
  });
