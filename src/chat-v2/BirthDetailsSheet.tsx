import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { M3Field } from '../components/TextField';
import { Toggle } from '../components/Toggle';
import {
  BIRTH_PLACE_MAX,
  birthPlaceProblem,
  formatBirthDate,
  formatBirthDetails,
  formatBirthTime,
  type BirthDate,
  type BirthTime,
} from '../lib/birthDetails';
import { pickBirthDate, pickBirthTime } from '../lib/birthPicker';
import { tick } from '../lib/haptics';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Sends the formatted line through the chat's own send path (the contact
   * guard's precheck included). False keeps the sheet open with what was
   * entered.
   */
  onSend: (body: string) => boolean;
}

/**
 * Date, time and place of birth for an astrologer, sent as one message
 * (src/lib/birthDetails.ts says why it is a card and how the contact guard
 * treats it).
 *
 * The date and the time come from the platform pickers (BirthPickerModule.kt),
 * never typed: that is what keeps their digits in the card's one safe shape.
 * The time can be "not known", a real answer an astrologer works with rather
 * than a blank. The place is typed, a city, and has no digits.
 *
 * Motion: none added. The sheet brings its own (Sheet.tsx), the pickers are the
 * platform's, and the rows are form fields that change value, not state.
 */
export function BirthDetailsSheet({ visible, onClose, onSend }: Props) {
  const styles = useStyles(makeStyles);
  const [date, setDate] = useState<BirthDate | null>(null);
  const [time, setTime] = useState<BirthTime | null>(null);
  const [timeUnknown, setTimeUnknown] = useState(false);
  const [place, setPlace] = useState('');
  const [placeTouched, setPlaceTouched] = useState(false);

  // Each opening starts clean: a second card is a second person's chart as
  // often as a correction of the first.
  useEffect(() => {
    if (visible) {
      setDate(null);
      setTime(null);
      setTimeUnknown(false);
      setPlace('');
      setPlaceTouched(false);
    }
  }, [visible]);

  const chooseDate = useCallback(async () => {
    const picked = await pickBirthDate(date);
    if (picked !== null) {
      setDate(picked);
    }
  }, [date]);

  const chooseTime = useCallback(async () => {
    const picked = await pickBirthTime(time);
    if (picked !== null) {
      setTime(picked);
      setTimeUnknown(false);
    }
  }, [time]);

  const setUnknown = useCallback((next: boolean) => {
    tick();
    setTimeUnknown(next);
  }, []);

  const placeError = birthPlaceProblem(place);
  // No body while the place is invalid: its "no numbers" rule is also what
  // keeps a phone number out of this card, so Send must honour it.
  const body = useMemo(
    () =>
      date === null || (!timeUnknown && time === null) || placeError !== null
        ? null
        : formatBirthDetails({ date, time: timeUnknown ? null : time, place }),
    [date, place, placeError, time, timeUnknown],
  );

  const send = useCallback(() => {
    if (body === null) {
      setPlaceTouched(true);
      return;
    }
    if (onSend(body)) {
      onClose();
    }
  }, [body, onClose, onSend]);

  return (
    <Sheet
      visible={visible}
      testID="birth-details"
      title="Birth details"
      body="Sent to your astrologer as one message."
      onClose={onClose}
      onCancel={onClose}
      footer={
        <Button
          label="Send birth details"
          disabled={body === null}
          onPress={send}
          testID="birth-details-send"
        />
      }
    >
      <View style={styles.stack}>
        <PickerField
          testID="birth-details-date"
          label="Date of birth"
          value={date === null ? null : formatBirthDate(date)}
          placeholder="Choose date"
          onPress={() => {
            void chooseDate();
          }}
        />
        <PickerField
          testID="birth-details-time"
          label="Time of birth"
          value={
            timeUnknown
              ? 'Not known'
              : time === null
              ? null
              : formatBirthTime(time)
          }
          placeholder="Choose time"
          onPress={() => {
            void chooseTime();
          }}
        />
        {/* The app's own switch (Toggle.tsx), so the on state is a thumb
            that moves and a filled track, not a tint alone. */}
        <View style={styles.checkRow}>
          <Text allowFontScaling style={styles.checkLabel}>
            I don't know the time
          </Text>
          <Toggle
            testID="birth-details-time-unknown"
            value={timeUnknown}
            onValueChange={setUnknown}
            accessibilityLabel="I don't know the time"
          />
        </View>
        <M3Field
          testID="birth-details-place"
          label="Place of birth"
          accessibilityLabel="Place of birth"
          placeholder="City"
          value={place}
          onChangeText={setPlace}
          onBlur={() => setPlaceTouched(true)}
          maxLength={BIRTH_PLACE_MAX}
          autoCapitalize="words"
          autoCorrect={false}
          supportingText="City or town. Letters only."
          error={placeTouched || place !== '' ? placeError : null}
        />
      </View>
    </Sheet>
  );
}

/**
 * A read-only outlined field that opens a picker: the same label above, the
 * same 56dp container and stroke as M3Field, so the three rows read as one form.
 */
function PickerField({
  label,
  value,
  placeholder,
  onPress,
  testID,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View>
      <Text allowFontScaling style={styles.fieldLabel}>
        {label}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? 'not chosen'}`}
        accessibilityHint="Opens a picker"
        onPress={onPress}
        style={styles.fieldBox}
      >
        <Text
          allowFontScaling
          numberOfLines={1}
          style={[
            styles.fieldValue,
            value === null ? styles.fieldPlaceholder : null,
          ]}
        >
          {value ?? placeholder}
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    stack: {
      gap: TOKENS.space.md,
      paddingBottom: TOKENS.space.md,
    },
    // M3Field's own label geometry (TextField.tsx): labelMedium, indented 16.
    fieldLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space['2xs'],
    },
    fieldBox: {
      height: TOKENS.layout.field,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.md,
      borderWidth: 1,
      borderColor: t.color.border.strong,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.base,
    },
    fieldValue: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    fieldPlaceholder: {
      color: t.color.text.muted,
    },
    checkRow: {
      minHeight: TOKENS.interaction.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
    },
    checkLabel: {
      ...TOKENS.typography.textMd,
      color: t.color.text.primary,
    },
  });
