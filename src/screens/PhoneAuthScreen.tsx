import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import { looksLikePhone, normalisePhone, requestOtp, verifyOtp } from '../api/auth';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';

interface Props {
  onSignedIn: () => void;
}

const CODE_LENGTH = 6;

/**
 * The only way in.
 *
 * Two steps and nothing else — no name, no email, no password, no terms
 * checkbox. That is the last piece of the old anonymous-first promise still
 * standing: signing in and signing up are the same act, so a returning user and
 * a brand new one do exactly the same thing.
 *
 * The number is shown back on the code step, because "did I typo the number I
 * just typed" is the single most common reason an OTP never arrives, and the
 * answer should not require going back.
 */
export function PhoneAuthScreen({ onSignedIn }: Props) {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async () => {
    setError(null);
    if (!looksLikePhone(phone)) {
      setError('That does not look like a phone number.');
      return;
    }
    setBusy(true);
    try {
      await requestOtp(phone);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }, [phone]);

  const confirm = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(phone, code);
      onSignedIn();
    } catch {
      // The server's wording for a bad OTP is not worth showing verbatim.
      setError('That code did not work. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }, [phone, code, onSignedIn]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + TOKENS.space['2xl'] }]}>
      <View style={styles.head}>
        <Text allowFontScaling style={styles.title}>
          {step === 'phone' ? 'Someone’s here\nto listen.' : 'Check your messages'}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          {step === 'phone'
            ? 'Real people, ready to talk. Not therapy — just company.'
            : `We sent a ${CODE_LENGTH}-digit code to ${normalisePhone(phone)}.`}
        </Text>
      </View>

      {step === 'phone' ? (
        <>
          <TextInput
            testID="phone-input"
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={TOKENS.color.text.secondary}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            allowFontScaling
            autoFocus
            underlineColorAndroid="transparent"
          />
          <Button
            label={busy ? 'Sending…' : 'Send me a code'}
            onPress={() => {
              void send();
            }}
            disabled={busy}
            testID="phone-submit"
          />
        </>
      ) : (
        <>
          <TextInput
            testID="otp-input"
            style={[styles.input, styles.code]}
            value={code}
            onChangeText={setCode}
            placeholder="······"
            placeholderTextColor={TOKENS.color.text.secondary}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            allowFontScaling
            autoFocus
            underlineColorAndroid="transparent"
          />
          <Button
            label={busy ? 'Checking…' : 'Continue'}
            onPress={() => {
              void confirm();
            }}
            disabled={busy || code.trim().length < 4}
            testID="otp-submit"
          />
          <Pressable
            onPress={() => {
              setStep('phone');
              setCode('');
              setError(null);
            }}
            testID="otp-change-number"
            accessibilityLabel="Change the phone number"
            style={styles.link}>
            <Text allowFontScaling style={styles.linkText}>
              Wrong number? Change it
            </Text>
          </Pressable>
        </>
      )}

      {error !== null ? (
        <Text testID="auth-error" allowFontScaling style={styles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.spacer} />
      <Text allowFontScaling style={styles.legal}>
        Your number is used to sign you in and to keep the app safe. It is never
        shown to anyone you talk to.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: TOKENS.space.lg,
    backgroundColor: TOKENS.color.bg.base,
  },
  head: {
    paddingBottom: TOKENS.space['2xl'],
    gap: TOKENS.space['2xs'] + 2,
  },
  title: {
    ...TOKENS.typography.displayLarge,
    color: TOKENS.color.text.primary,
  },
  subtitle: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: TOKENS.space.lg,
    marginBottom: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.raised,
    ...TOKENS.typography.bodyLarge,
    color: TOKENS.color.text.primary,
  },
  code: {
    letterSpacing: 8,
    textAlign: 'center',
  },
  link: {
    paddingVertical: TOKENS.space.md,
    alignItems: 'center',
  },
  linkText: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
  error: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.primary,
    paddingTop: TOKENS.space.sm,
  },
  spacer: {
    flex: 1,
  },
  legal: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
    paddingBottom: TOKENS.space['2xl'],
  },
});
