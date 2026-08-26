import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { usePhoneVerification } from '../api/phone';
import { keys } from '../api/chat';
import { normalisePhone } from '../lib/phone';
import { Button } from '../components/Button';
import { CodeField } from '../components/CodeField';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';

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
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { step, busy, error, identifier, send, confirm, resend, reset } =
    usePhoneVerification();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  /* One submit per distinct complete code. Without this, CodeField's onComplete
     re-fires on every re-render while the request is in flight. */
  const submitted = useRef<string | null>(null);

  // Shake the field rather than only printing the reason, and clear the code so
  // the next attempt starts from an empty field instead of a wrong one.
  useEffect(() => {
    if (error !== null && step === 'code') {
      setErrorNonce(n => n + 1);
      setCode('');
      submitted.current = null;
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
        <TextField
          testID="phone-verify-input"
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number"
          placeholderTextColor={theme.color.text.tertiary}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          returnKeyType="send"
          allowFontScaling
          editable={busy === null}
          onSubmitEditing={() => {
            if (canSend) {
              void onSend();
            }
          }}
          underlineColorAndroid="transparent"
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
        <Text testID="phone-verify-error" allowFontScaling style={styles.error}>
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
    input: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      // A filled field, not a Material outlined one. `bg/sunken` with no stroke
      // and a 10pt corner is iOS's text field; `bg/raised` plus a 1px
      // `border/strong` at radius 16 was the outlined-text-field idiom, and in
      // light mode the fill was the same white as the sheet behind it, so the
      // border was the only thing there.
      backgroundColor: t.color.bg.sunken,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      paddingHorizontal: TOKENS.space.md,
      height: 48,
      marginBottom: TOKENS.space['2xs'],
    },
    // Primary, not a red. Matching the sign-in screen: an OTP that did not work
    // is the expected case, and colouring it as an alarm makes a typo feel like a
    // security event.
    error: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.primary,
      paddingBottom: TOKENS.space['2xs'],
    },
  });
