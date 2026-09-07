import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { usePhoneVerification } from '../api/phone';
import { keys } from '../api/chat';
import {
  IN_MOBILE_DISPLAY_LENGTH,
  formatNationalDigits,
  formatPhoneEdit,
  normalisePhone,
} from '../lib/phone';
import { Button } from '../components/Button';
import { CodeField } from '../components/CodeField';
import { Sheet } from '../components/Sheet';
import { M3Field } from '../components/TextField';

/** Matched to the resend button, not to MSG91: see the note on the countdown. */
const RESEND_SECONDS = 30;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Verifying a phone number on an account that is already signed in.
 *
 * Two steps in one sheet, deliberately. Verification is optional and the number
 * step is one field, so a second sheet would be a transition for its own sake.
 * The sign-in screen splits them because it is the first thing anyone sees; this
 * is reached from Settings, by someone who came here on purpose.
 *
 * The state machine lives in `usePhoneVerification`. This file renders it and
 * decides nothing: no retry rules, no error copy, no request ids. If a change
 * needs a condition in here, it probably belongs in the hook.
 */
export function PhoneVerifySheet({ visible, onClose }: Props) {
  const styles = useStyles(makeStyles);
  const queryClient = useQueryClient();
  const { step, busy, error, identifier, send, confirm, resend, reset } =
    usePhoneVerification();

  /**
   * **Bare national digits. Never the formatted string.**
   *
   * This is the whole safety property of the separator formatting: the `98765
   * 43210` with the space in it is computed for the `value` prop on the line it
   * is used and is never stored, so there is no variable holding a formatted
   * number that could be passed to `send` by a later edit. `send` receives
   * `phone`, which is at most ten digits by construction (`toNationalDigits`
   * truncates) and contains nothing else.
   */
  const [phone, setPhone] = useState('');
  /**
   * The caret, owned here because the field's text is rewritten under it.
   *
   * React Native's `TextInput` is controlled — "the native value will be forced
   * to match this value prop if provided"
   * (https://reactnative.dev/docs/textinput#value) — and inserting a separator
   * makes the forced value a different length from what the native view had, so
   * every index after the insertion shifts. `selection` is the prop that puts the
   * caret back: "Set start and end to the same value to position the cursor"
   * (https://reactnative.dev/docs/textinput#selection).
   *
   * It is also updated from `onSelectionChange`, and that is not optional. A
   * `selection` prop that only ever moves on text change is a caret the user
   * cannot reposition — tapping mid-number would snap back to where the last
   * edit left it. Feeding the user's own taps and drags back into the same state
   * is what keeps the field editable rather than append-only.
   */
  const [caret, setCaret] = useState(0);
  const [code, setCode] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  /* One submit per distinct complete code. Without this, CodeField's onComplete
     re-fires on every re-render while the request is in flight. */
  const submitted = useRef<string | null>(null);

  // Shake without clearing. Keeping the rejected digits visible lets someone
  // correct one character instead of retyping six, and the submitted-value guard
  // prevents the unchanged code from firing again on this render.
  useEffect(() => {
    if (error !== null && step === 'code') {
      setErrorNonce(n => n + 1);
    }
  }, [error, step]);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /* The profile carries phone_verified_at, and Settings reads it to decide
     whether to offer this at all. Invalidating on success is what makes the
     button disappear without a restart. */
  useEffect(() => {
    if (step === 'verified') {
      void queryClient.invalidateQueries({ queryKey: keys.profile });
    }
  }, [step, queryClient]);

  const onSend = useCallback(async () => {
    await send(phone);
    setCooldown(RESEND_SECONDS);
  }, [phone, send]);

  const onComplete = useCallback(
    (entered: string) => {
      if (submitted.current === entered || busy !== null) {
        return;
      }
      submitted.current = entered;
      void confirm(entered);
    },
    [busy, confirm],
  );

  /**
   * One keystroke, paste or deletion, resolved by the pure formatter.
   *
   * The formatter is handed the text the native view now holds and the string
   * that was on screen before it; it works the edit out by diffing those two
   * rather than by reading the native caret, so it does not depend on the order
   * `onChangeText` and `onSelectionChange` fire in. Everything it decides —
   * digits, display, caret — is unit-tested in `__tests__/phone.test.ts`.
   */
  const onChangePhone = useCallback(
    (next: string) => {
      const edit = formatPhoneEdit(next, formatNationalDigits(phone));
      setPhone(edit.digits);
      setCaret(edit.caret);
    },
    [phone],
  );

  const display = formatNationalDigits(phone);
  const canSend = normalisePhone(phone) !== null && busy === null;

  if (step === 'verified') {
    return (
      <Sheet
        visible={visible}
        testID="phone-verified-sheet"
        title="Number Verified"
        body={
          'Your number is confirmed. It is never shown to anyone you talk to, and ' +
          'it is not used to message you.'
        }
        onClose={onClose}>
        <Button label="Done" onPress={onClose} testID="phone-verified-done" />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      testID="phone-verify-sheet"
      onCancel={onClose}
      cancelLabel="Not Now"
      title={step === 'number' ? 'Verify Your Number' : 'Enter the Code'}
      body={
        step === 'number'
          ? 'This confirms you are a real person and makes a banned account harder to replace. Your number is never shown to anyone you talk to.'
          : `Sent to +${identifier ?? ''}. It expires in a couple of minutes.`
      }
      onClose={onClose}>
      {step === 'number' ? (
        <M3Field
          testID="phone-verify-input"
          containerStyle={styles.field}
          value={display}
          onChangeText={onChangePhone}
          selection={{ start: caret, end: caret }}
          onSelectionChange={e => setCaret(e.nativeEvent.selection.start)}
          /* Eleven characters: ten digits and the one separator. This is not
             belt-and-braces on top of the JS cap — the RN docs name it as the
             fix for exactly the flicker a JS-only cap causes, because a
             controlled `value` that refuses a keystroke is the
             "keeping value the same" case they warn about. With this, the
             native view never accepts the twelfth character at all.
             https://reactnative.dev/docs/textinput#maxlength */
          maxLength={IN_MOBILE_DISPLAY_LENGTH}
          /* The placeholder is a correctly-grouped example rather than the words
             "Phone number": it says both what the format is and that ten digits
             is the whole number, which is what the +91 country code being absent
             from the field would otherwise leave ambiguous. */
          placeholder="98765 43210"
          /* `inputMode` "determines which keyboard to open and has precedence
             over keyboardType" (https://reactnative.dev/docs/textinput#inputmode),
             so `tel` is the one actually in force; `keyboardType` stays as the
             long-supported prop underneath it. Both resolve to Android's
             TYPE_CLASS_PHONE. */
          inputMode="tel"
          keyboardType="phone-pad"
          /* `autoComplete` is what Android autofill reads. `tel` is
             AUTOFILL_HINT_PHONE_NUMBER, which the platform doc specifies for
             "requesting a full phone number in a single view" — which this is.
             The `tel-national` hint exists but the same doc scopes it to apps
             with "separate views for different parts", and there is no
             country-code field here. A service that fills the full +91 number is
             handled: toNationalDigits strips a twelve-digit leading 91.
             https://developer.android.com/guide/topics/text/autofill-optimize */
          autoComplete="tel"
          /* The same page says to check this is "set to a value other than `no`".
             The default is `auto`; naming it makes the field's participation in
             autofill explicit rather than inherited. */
          importantForAutofill="yes"
          /* iOS-only per https://reactnative.dev/docs/textinput#textcontenttype
             — inert on this Android-only app, kept so the field is correct if it
             ever ships elsewhere. It does NOT do the Android autofill work;
             `autoComplete` above does. */
          textContentType="telephoneNumber"
          returnKeyType="send"
          editable={busy === null}
          onSubmitEditing={() => {
            if (canSend) {
              void onSend();
            }
          }}
        />
      ) : (
        /* Never disabled while confirming. Disabling a focused TextInput blurs
           it, which moves focus to the next control and closes the keyboard.
           That exact bug shipped on the sign-in screen once. */
        <CodeField
          value={code}
          onChange={setCode}
          onComplete={onComplete}
          errorNonce={errorNonce}
          testID="phone-verify-code"
        />
      )}

      {error !== null ? (
        <Text
          testID="phone-verify-error"
          allowFontScaling
          accessibilityLiveRegion="polite"
          style={styles.error}>
          {error}
        </Text>
      ) : null}

      {step === 'number' ? (
        <Button
          label="Send Code"
          busy={busy === 'sending'}
          busyLabel="Sending code"
          disabled={!canSend}
          onPress={() => {
            void onSend();
          }}
          testID="phone-verify-send"
        />
      ) : (
        <>
          <Button
            // The two buttons here both said 'Sending…' for two different
            // operations. They now say which one they are doing.
            label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
            busy={busy === 'resending'}
            busyLabel="Resending code"
            kind="secondary"
            disabled={cooldown > 0 || busy !== null}
            onPress={() => {
              void resend().then(() => setCooldown(RESEND_SECONDS));
            }}
            testID="phone-verify-resend"
          />
          <Button
            label="Change Number"
            kind="secondary"
            disabled={busy !== null}
            onPress={() => {
              setCode('');
              submitted.current = null;
              reset();
            }}
            testID="phone-verify-change"
          />
        </>
      )}
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    /* The field's own geometry — height, stroke, radius, padding — is M3Field's
       now. All that is left here is the gap to the button under it. */
    field: {
      marginBottom: TOKENS.space['2xs'],
    },
    // Primary, not a red. Matching the sign-in screen: an OTP that did not work
    // is the expected case, and colouring it as an alarm makes a typo feel like a
    // security event.
    error: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.primary,
      paddingBottom: TOKENS.space['2xs'],
    },
  });
