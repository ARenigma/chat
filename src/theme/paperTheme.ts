/**
 * Material 3 components, our design system.
 *
 * Amit's call (wave-3 #1): the app uses real Material 3 components
 * (react-native-paper) instead of hand-rolled iOS-imitation surfaces, but they
 * wear OUR tokens rather than Paper's stock Material palette. This file is the
 * one adapter that maps `LIGHT`/`DARK` onto Paper's MD3 colour roles and Inter
 * onto its type variants, so a Paper `List.Item`, `Appbar`, `Switch` or `Dialog`
 * comes out coral-on-neutral in Inter and never looks like a different app.
 *
 * Only the role → token mapping lives here. The tokens themselves are still
 * generated from `design/tokens.json`; this never invents a colour.
 */
import { MD3LightTheme, MD3DarkTheme, type MD3Theme } from 'react-native-paper';
import { DARK, LIGHT, TOKENS, type Theme } from './tokens';

type Palette = Theme;

/**
 * The MD3 colour roles, from our tokens.
 *
 * `primary` is the coral, and its `onPrimary` is the text-safe white/ink we
 * already measured. `secondaryContainer` is the M3 selected-row / active-chip
 * fill, mapped to the accent tint so a chosen Paper control reads as ours.
 * `surface` is a raised card, `surfaceVariant` the sunken fill a List sits in,
 * `background` the page. `outline` is the hairline. Nothing here is a new hue.
 */
function colors(p: Palette) {
  return {
    primary: p.color.bg.accent,
    onPrimary: p.color.text.onAccent,
    primaryContainer: p.color.bg.accentTint,
    onPrimaryContainer: p.color.text.accent,
    secondary: p.color.state.available,
    onSecondary: p.color.text.onAccent,
    secondaryContainer: p.color.bg.accentTint,
    onSecondaryContainer: p.color.text.accent,
    tertiary: p.color.state.available,
    onTertiary: p.color.text.onAccent,
    tertiaryContainer: p.color.bg.positive,
    onTertiaryContainer: p.color.text.positive,
    background: p.color.bg.base,
    onBackground: p.color.text.primary,
    surface: p.color.bg.raised,
    onSurface: p.color.text.primary,
    surfaceVariant: p.color.bg.sunken,
    onSurfaceVariant: p.color.text.secondary,
    surfaceDisabled: p.color.bg.sunken,
    onSurfaceDisabled: p.color.text.tertiary,
    outline: p.color.border.hairline,
    outlineVariant: p.color.border.hairline,
    error: p.color.state.danger,
    onError: p.color.text.onAccent,
    errorContainer: p.color.bg.accentTint,
    onErrorContainer: p.color.state.danger,
    inverseSurface: p.color.bg.inverse,
    inverseOnSurface: p.color.text.onInverse,
    inversePrimary: p.color.bg.accent,
    shadow: '#000000',
    scrim: '#000000',
    backdrop: 'rgba(0,0,0,0.4)',
    // M3 tonal elevation surfaces. We are a flat, iOS-adjacent surface language,
    // so every level resolves to the same raised colour rather than tinting with
    // the primary the way stock M3 does; that tint is the loudest "this is
    // Material" tell and the one thing the design system does not want back.
    elevation: {
      level0: 'transparent',
      level1: p.color.bg.raised,
      level2: p.color.bg.raised,
      level3: p.color.bg.raised,
      level4: p.color.bg.raised,
      level5: p.color.bg.raised,
    },
  };
}

/**
 * Inter onto MD3's type variants. Paper needs a `fonts` map keyed by variant;
 * each one names a concrete Inter face rather than a weight, the same rule the
 * rest of the app follows so Android never synthesises a weight the family ships.
 */
const FAMILY = {
  regular: TOKENS.typography.bodyMedium.fontFamily,
  medium: TOKENS.typography.headline.fontFamily,
  bold: TOKENS.typography.titleMedium.fontFamily,
} as const;

function fontConfig(): MD3Theme['fonts'] {
  const base = MD3LightTheme.fonts;
  // Keep Paper's own fontWeight per variant: a concrete bundled family maps
  // straight to its file on Android, so the weight beside it is not the synthesis
  // trap a system family would be. Only the family is ours.
  const entries = (Object.keys(base) as Array<keyof typeof base>).map(variant => {
    const v = base[variant];
    // Display/headline/title variants take the bold face; body/label the regular.
    const face = /^(display|headline|title)/.test(variant)
      ? FAMILY.bold
      : String(variant).includes('Medium') || String(variant).includes('label')
        ? FAMILY.medium
        : FAMILY.regular;
    return [variant, { ...v, fontFamily: face }] as const;
  });
  return Object.fromEntries(entries) as MD3Theme['fonts'];
}

export const PAPER_LIGHT: MD3Theme = {
  ...MD3LightTheme,
  roundness: TOKENS.radius.field / 4, // Paper multiplies roundness by 4.
  colors: { ...MD3LightTheme.colors, ...colors(LIGHT) },
  fonts: fontConfig(),
};

export const PAPER_DARK: MD3Theme = {
  ...MD3DarkTheme,
  roundness: TOKENS.radius.field / 4,
  colors: { ...MD3DarkTheme.colors, ...colors(DARK) },
  fonts: fontConfig(),
};
