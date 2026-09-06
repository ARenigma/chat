import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
} from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Sheet } from './Sheet';
import { Pressable } from './Pressable';

interface Country {
  readonly flag: string;
  readonly name: string;
  readonly dialCode: string;
}

/**
 * Curated list of common countries for the Indian-first audience.
 * A full ISO set is unnecessary and would overwhelm the picker.
 */
const COUNTRIES: readonly Country[] = [
  { flag: '🇮🇳', name: 'India', dialCode: '+91' },
  { flag: '🇺🇸', name: 'United States', dialCode: '+1' },
  { flag: '🇬🇧', name: 'United Kingdom', dialCode: '+44' },
  { flag: '🇦🇪', name: 'UAE', dialCode: '+971' },
  { flag: '🇸🇬', name: 'Singapore', dialCode: '+65' },
  { flag: '🇦🇺', name: 'Australia', dialCode: '+61' },
];

/** Default dial code: India, the primary target market. */
export const DEFAULT_DIAL_CODE = '+91';

interface Props {
  value: string;
  onChange: (dialCode: string) => void;
  testID?: string;
}

/**
 * Compact country-code selector that opens the shared Sheet.
 *
 * Renders as a pressable pill showing the selected flag and dial code; tapping
 * opens a bottom sheet with the curated country list. Deliberately small: six
 * countries, no search, no flags of nations nobody will choose. India is the
 * first entry and the default.
 */
export function CountryPicker({ value, onChange, testID }: Props) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);

  const selected = COUNTRIES.find(c => c.dialCode === value) ?? COUNTRIES[0]!;

  return (
    <>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Country code ${selected.dialCode}, tap to change`}
        press="chip"
        style={styles.trigger}>
        <Text style={styles.flag}>{selected.flag}</Text>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.code}>{selected.dialCode}</Text>
      </Pressable>

      <Sheet
        visible={open}
        title="Country code"
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        {COUNTRIES.map(country => (
          <Pressable
            key={country.dialCode}
            onPress={() => {
              onChange(country.dialCode);
              setOpen(false);
            }}
            accessibilityLabel={`${country.name} ${country.dialCode}`}
            press="row"
            highlight="dim"
            style={[styles.row, country.dialCode === value ? styles.rowActive : null]}>
            <Text style={styles.rowFlag}>{country.flag}</Text>
            <Text allowFontScaling style={styles.rowName}>{country.name}</Text>
            <Text allowFontScaling style={styles.rowCode}>{country.dialCode}</Text>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingRight: TOKENS.space.xs,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: t.color.border.hairline,
    },
    flag: {
      // Emoji at display size, not a typography token.
      fontSize: 20,
      lineHeight: 24,
    },
    code: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
    },
    rowActive: {
      backgroundColor: t.color.bg.sunken,
    },
    rowFlag: {
      fontSize: 20,
      lineHeight: 24,
    },
    rowName: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      flex: 1,
    },
    rowCode: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
  });
