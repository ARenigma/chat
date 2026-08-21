/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: design/tokens.json (authored directly — the Figma library is stale; see
 * the provenance note in that file).
 * Regenerate with `npm run tokens`. `npm run tokens:check` fails on drift.
 *
 * System: Warm Signal — warm paper base, one coral signal, deep warm ink. Sage carries presence, citrus carries the token balance, and nothing else is allowed a hue.
 *
 * Accent budget: the coral is for ACTIONS AND STATES ONLY — send, own bubble,
 * unread count, avatar wash, low-balance count, typing dots. Never a page
 * background, never a header, never a divider, never a provider's avatar. That
 * single rule is the difference between friendly and flirty, and a test in
 * __tests__/theme.test.ts enforces it rather than trusting this comment.
 *
 * Contrast: Every pair in this file was measured with WCAG 2.1 relative luminance rather than copied from a reference. The palettes this was drawn from publish ratios that do not reproduce — one swatch labelled 6.98:1 measures 3.01:1 against white — so no published number was trusted.
 */

/** Widened deliberately — see the fontVariant note in scripts/gen-tokens.mjs. */
type FontVariantList = 'tabular-nums'[];

export const LIGHT = {
  color: {
    bg: {
      base: '#FBF8F5',
      raised: '#FFFFFF',
      sunken: '#EFE8DF',
      hover: '#E7DED2',
      pressed: '#DCD2C4',
      inverse: '#2A1F1A',
      accent: '#F2543D',
      accentStrong: '#C2401F',
      accentTint: '#FBE4DE',
      positive: '#DCE8E3',
      token: '#F2EFC0',
    },
    text: {
      primary: '#2A1F1A',
      secondary: '#6B5A4C',
      tertiary: '#A2937F',
      accent: '#8F2E17',
      onAccent: '#FFFFFF',
      onInverse: '#FBF8F5',
      positive: '#1F4A3F',
      token: '#4A4708',
    },
    border: {
      hairline: '#EFE8DF',
      strong: '#CFC3B2',
      accent: '#F2543D',
    },
    state: {
      available: '#4E8B7C',
      danger: '#733635',
    },
  },
  space: {
    '2xs': 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
  },
  radius: {
    tail: 5,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    pill: 999,
    screen: 44,
    pressButton: 14,
    pressCard: 12,
    pressSend: 9,
    sheet: 28,
  },
  motion: {
    spring: {
      snap: {
        damping: 37,
        stiffness: 400,
        mass: 1,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
      smooth: {
        damping: 27,
        stiffness: 180,
        mass: 1,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
      bounce: {
        damping: 18,
        stiffness: 260,
        mass: 0.9,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
      gentle: {
        damping: 24,
        stiffness: 200,
        mass: 1,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
    },
    springMeta: {
      snap: {
        ratio: 0.925,
        settleMs: 216,
        overshoots: true,
      },
      smooth: {
        ratio: 1.006,
        settleMs: 296,
        overshoots: false,
      },
      bounce: {
        ratio: 0.588,
        settleMs: 400,
        overshoots: true,
      },
      gentle: {
        ratio: 0.849,
        settleMs: 333,
        overshoots: true,
      },
    },
    decay: {
      deceleration: 0.994,
      velocityFactor: 1,
    },
    gesture: {
      dismissDistance: 0.28,
      dismissVelocity: 800,
    },
    press: {
      card: 0.975,
      button: 0.96,
      chip: 0.94,
      send: 0.86,
      sendSquashY: 0.78,
    },
    stagger: {
      row: 42,
      rail: 55,
    },
    duration: {
      instant: 110,
      fast: 170,
      base: 240,
      slow: 420,
      breath: 4200,
    },
  },
  interaction: {
    minTarget: 48,
    focusRingWidth: 3,
    focusRingOffset: 2,
    stateHover: 0.08,
    stateFocus: 0.1,
    statePressed: 0.1,
    stateDragged: 0.16,
  },
  toggle: {
    trackWidth: 52,
    trackHeight: 32,
    thumbOff: 16,
    thumbOn: 24,
    thumbPressed: 28,
  },
  typography: {
    displayLarge: {
      fontFamily: 'Urbanist-ExtraBold',
      fontSize: 30,
      lineHeight: 31,
      letterSpacing: -0.75,
    },
    displaySmall: {
      fontFamily: 'Urbanist-ExtraBold',
      fontSize: 25,
      lineHeight: 27,
      letterSpacing: -0.63,
    },
    titleMedium: {
      fontFamily: 'Urbanist-Bold',
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.33,
    },
    bodyLarge: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 17,
      lineHeight: 24,
      letterSpacing: -0.09,
    },
    bodyMedium: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 16,
      lineHeight: 23,
      letterSpacing: -0.08,
    },
    labelMedium: {
      fontFamily: 'Urbanist-SemiBold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.07,
    },
    labelSmall: {
      fontFamily: 'Urbanist-SemiBold',
      fontSize: 13,
      lineHeight: 17,
      letterSpacing: -0.07,
    },
    captionRegular: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: -0.07,
    },
    captionSmall: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 0,
    },
    numeralMedium: {
      fontFamily: 'Urbanist-Bold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.07,
      fontVariant: ['tabular-nums'] as FontVariantList,
    },
    numeralSmall: {
      fontFamily: 'Urbanist-Bold',
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0,
      fontVariant: ['tabular-nums'] as FontVariantList,
    },
  },
  elevation: {
    card: {
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 1,
      },
      shadowOpacity: 0.04,
      shadowRadius: 3,
      elevation: 2,
    },
    composer: {
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.06,
      shadowRadius: 5,
      elevation: 3,
    },
    sheet: {
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: -4,
      },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 6,
    },
  },
} as const;

export const DARK = {
  color: {
    bg: {
      base: '#14110F',
      raised: '#1E1A17',
      sunken: '#262119',
      hover: '#2E2820',
      pressed: '#372F26',
      inverse: '#F6F1EB',
      accent: '#F2543D',
      accentStrong: '#F2836B',
      accentTint: '#3A1A12',
      positive: '#16302A',
      token: '#3A3705',
    },
    text: {
      primary: '#F7F3EE',
      secondary: '#B3A596',
      tertiary: '#8A7C6D',
      accent: '#FFB4A0',
      onAccent: '#2A1F1A',
      onInverse: '#2A1F1A',
      positive: '#A8D8C8',
      token: '#E4E26A',
    },
    border: {
      hairline: '#262119',
      strong: '#3A332B',
      accent: '#F2543D',
    },
    state: {
      available: '#6BA697',
      danger: '#E39B92',
    },
  },
  space: {
    '2xs': 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
  },
  radius: {
    tail: 5,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    pill: 999,
    screen: 44,
    pressButton: 14,
    pressCard: 12,
    pressSend: 9,
    sheet: 28,
  },
  motion: {
    spring: {
      snap: {
        damping: 37,
        stiffness: 400,
        mass: 1,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
      smooth: {
        damping: 27,
        stiffness: 180,
        mass: 1,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
      bounce: {
        damping: 18,
        stiffness: 260,
        mass: 0.9,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
      gentle: {
        damping: 24,
        stiffness: 200,
        mass: 1,
        restDisplacementThreshold: 0.01,
        restSpeedThreshold: 2,
      },
    },
    springMeta: {
      snap: {
        ratio: 0.925,
        settleMs: 216,
        overshoots: true,
      },
      smooth: {
        ratio: 1.006,
        settleMs: 296,
        overshoots: false,
      },
      bounce: {
        ratio: 0.588,
        settleMs: 400,
        overshoots: true,
      },
      gentle: {
        ratio: 0.849,
        settleMs: 333,
        overshoots: true,
      },
    },
    decay: {
      deceleration: 0.994,
      velocityFactor: 1,
    },
    gesture: {
      dismissDistance: 0.28,
      dismissVelocity: 800,
    },
    press: {
      card: 0.975,
      button: 0.96,
      chip: 0.94,
      send: 0.86,
      sendSquashY: 0.78,
    },
    stagger: {
      row: 42,
      rail: 55,
    },
    duration: {
      instant: 110,
      fast: 170,
      base: 240,
      slow: 420,
      breath: 4200,
    },
  },
  interaction: {
    minTarget: 48,
    focusRingWidth: 3,
    focusRingOffset: 2,
    stateHover: 0.08,
    stateFocus: 0.1,
    statePressed: 0.1,
    stateDragged: 0.16,
  },
  toggle: {
    trackWidth: 52,
    trackHeight: 32,
    thumbOff: 16,
    thumbOn: 24,
    thumbPressed: 28,
  },
  typography: {
    displayLarge: {
      fontFamily: 'Urbanist-ExtraBold',
      fontSize: 30,
      lineHeight: 31,
      letterSpacing: -0.75,
    },
    displaySmall: {
      fontFamily: 'Urbanist-ExtraBold',
      fontSize: 25,
      lineHeight: 27,
      letterSpacing: -0.63,
    },
    titleMedium: {
      fontFamily: 'Urbanist-Bold',
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.33,
    },
    bodyLarge: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 17,
      lineHeight: 24,
      letterSpacing: -0.09,
    },
    bodyMedium: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 16,
      lineHeight: 23,
      letterSpacing: -0.08,
    },
    labelMedium: {
      fontFamily: 'Urbanist-SemiBold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.07,
    },
    labelSmall: {
      fontFamily: 'Urbanist-SemiBold',
      fontSize: 13,
      lineHeight: 17,
      letterSpacing: -0.07,
    },
    captionRegular: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: -0.07,
    },
    captionSmall: {
      fontFamily: 'Urbanist-Regular',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 0,
    },
    numeralMedium: {
      fontFamily: 'Urbanist-Bold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.07,
      fontVariant: ['tabular-nums'] as FontVariantList,
    },
    numeralSmall: {
      fontFamily: 'Urbanist-Bold',
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0,
      fontVariant: ['tabular-nums'] as FontVariantList,
    },
  },
  elevation: {
    card: {
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 1,
      },
      shadowOpacity: 0.12,
      shadowRadius: 3,
      elevation: 2,
    },
    composer: {
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.18,
      shadowRadius: 5,
      elevation: 3,
    },
    sheet: {
      shadowColor: '#000000',
      shadowOffset: {
        width: 0,
        height: -4,
      },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 6,
    },
  },
} as const;

export type Theme = typeof LIGHT;

/** The app is light-first; DARK exists for the mode switch, not as a default. */
export const TOKENS: Theme = LIGHT;
