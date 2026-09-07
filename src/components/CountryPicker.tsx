import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
} from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import {
  INDIA,
  PHONE_COUNTRIES,
  type CountryIso,
  type PhoneCountry,
} from '../lib/phone';
import { Sheet } from './Sheet';
import { Pressable } from './Pressable';

/**
 * The part of a country that is presentation rather than numbering.
 *
 * **Typed as a total `Record<CountryIso, …>` on purpose.** The dial codes used
 * to live here, in a list of their own, while `src/lib/phone.ts` had no idea
 * this picker existed — so a seventh country added to the picker would have
 * been formatted and capped with India's rules, silently. Keying this off
 * `CountryIso` makes that a compile error instead: `PHONE_COUNTRIES` is the one
 * list, and a territory added there does not build until it has a flag and a
 * name here.
 */
const PRESENTATION: Record<CountryIso, { readonly flag: string; readonly name: string }> = {
  IN: { flag: '🇮🇳', name: 'India' },
  US: { flag: '🇺🇸', name: 'United States' },
  GB: { flag: '🇬🇧', name: 'United Kingdom' },
  AE: { flag: '🇦🇪', name: 'UAE' },
  SG: { flag: '🇸🇬', name: 'Singapore' },
  AU: { flag: '🇦🇺', name: 'Australia' },
};

interface Country {
  readonly flag: string;
  readonly name: string;
  readonly dialCode: string;
}

/**
 * Curated list of common countries for the Indian-first audience.
 * A full ISO set is unnecessary and would overwhelm the picker.
 *
 * Order and dial codes come from `PHONE_COUNTRIES`, which is also what decides
 * how many digits each one takes and where its separators go. India is first
 * there, so India is first here.
 */
const COUNTRIES: readonly Country[] = PHONE_COUNTRIES.map(
  (c: PhoneCountry): Country => ({
    flag: PRESENTATION[c.iso].flag,
    name: PRESENTATION[c.iso].name,
    dialCode: c.dialCode,
  }),
);

/** Default dial code: India, the primary target market. */
export const DEFAULT_DIAL_CODE = INDIA.dialCode;

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
