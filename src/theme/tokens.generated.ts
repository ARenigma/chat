/**
 * GENERATED FILE, DO NOT EDIT.
 *
 * Source: design/tokens.json (authored directly, the Figma library is stale; see
 * the provenance note in that file).
 * Regenerate with `npm run tokens`. `npm run tokens:check` fails on drift.
 *
 * System: Signal on Neutral, iOS system greys carry the chrome, and hue is reserved for meaning: coral is the one call to act, sage is presence, citrus is the token balance. Nothing else gets a hue. Renamed from "Warm Signal", which described a warm paper base that no longer exists, a system whose name asserts a fact about its own palette has to be renamed when that fact changes.
 *
 * Accent budget: the coral is for ACTIONS AND STATES ONLY, send, own bubble,
 * unread count, avatar wash, low-balance count, typing dots. Never a page
 * background, never a header, never a divider, never a provider's avatar. That
 * single rule is the difference between friendly and flirty, and a test in
 * __tests__/theme.test.ts enforces it rather than trusting this comment.
 *
 * Contrast: Every pair is measured, not copied: `npm run contrast:check` recomputes WCAG 2.1 relative luminance for all 19 foreground/background pairs in both modes and fails the build below target. That gate was written for the neutral-ramp swap, because a palette change is the one edit that can break legibility everywhere at once while every ratio in this file's notes still describes the old background. It immediately found two pre-existing failures: light text/tertiary measured 2.99:1 against white, and the dark hairline 1.08:1 against a dark card, a divider that was not there. Both fixed. 2026-09-01: dark mode base ramp replaced with WhatsApp charcoal family (#0B141A / #111B21 / #202C33); all 19 pairs re-verified, all pass. New lowest margin: dark hairline #2A3942 on #0B141A = 1.56:1 (requirement: >1.5:1).
 */

/** Widened deliberately, see the fontVariant note in scripts/gen-tokens.mjs. */
type FontVariantList = 'tabular-nums'[];

export const LIGHT = {
  color: {
    bg: {
      base: '#FFFFFF',
      raised: '#FFFFFF',
      sunken: '#E5E5EA',
      hover: '#DEDEE3',
      grouped: '#F2F2F7',
      chrome: 'rgba(255,255,255,0.80)',
      pressed: '#D1D1D6',
      selected: '#D1D1D6',
      inverse: '#1C1C1E',
      scrim: '#000000',
      accent: '#F2543D',
      accentStrong: '#C2401F',
      accentTint: '#FBE4DE',
      positive: '#DCE8E3',
      token: '#F2EFC0',
      tokenHealthy: '#0B5F36',
      tokenCritical: '#B3261E',
    },
    text: {
      primary: '#1C1C1E',
      secondary: '#55555A',
      tertiary: '#78787D',
      accent: '#8F2E17',
      onAccent: '#FFFFFF',
      onInverse: '#FFFFFF',
      positive: '#1F4A3F',
      token: '#4A4708',
      onTokenStrong: '#FFFFFF',
    },
    border: {
      hairline: '#C6C6C8',
      strong: '#C7C7CC',
      accent: '#F2543D',
    },
    state: {
      available: '#4E8B7C',
      danger: '#733635',
    },
    mark: {
      talk: '#E0245E',
      listen: '#1D6FE0',
      vent: '#C25E00',
      share: '#7A3DE0',
      unwind: '#0F7F62',
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
    field: 10,
    alert: 14,
    bubble: 22,
    thread: 24,
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
      row: 0.99,
      button: 0.96,
      chip: 0.94,
      send: 0.86,
      sendSquashY: 0.78,
      busy: 0.98,
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
      spinnerCycle: 800,
      accentShift: 220,
      stepPromote: 150,
      carouselDwell: 1100,
    },
    opacity: {
      neighbour: 0.1,
      inactive: 0.25,
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
    wordmark: {
      fontFamily: 'TitanOne',
      fontSize: 34,
      lineHeight: 41,
      letterSpacing: 0,
    },
    displayLarge: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 30,
      lineHeight: 37,
      letterSpacing: 0.33,
    },
    displaySmall: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: 0.34,
    },
    titleMedium: {
      fontFamily: 'Geist-Bold',
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: 0.35,
    },
    headline: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.42,
    },
    bodyLarge: {
      fontFamily: 'Geist-Regular',
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.42,
    },
    bodyMedium: {
      fontFamily: 'Geist-Regular',
      fontSize: 16,
      lineHeight: 21,
      letterSpacing: -0.3,
    },
    subhead: {
      fontFamily: 'Geist-Regular',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.23,
    },
    labelMedium: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.23,
    },
    labelSmall: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 13,
      lineHeight: 18,
      letterSpacing: -0.08,
    },
    captionRegular: {
      fontFamily: 'Geist-Regular',
      fontSize: 13,
      lineHeight: 18,
      letterSpacing: -0.08,
    },
    captionSmall: {
      fontFamily: 'Geist-Regular',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 0,
    },
    numeralMedium: {
      fontFamily: 'Geist-Bold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.07,
      fontVariant: ['tabular-nums'] as FontVariantList,
    },
    numeralSmall: {
      fontFamily: 'Geist-Bold',
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
      base: '#0B141A',
      raised: '#111B21',
      sunken: '#202C33',
      hover: '#1A2D38',
      grouped: '#0B141A',
      chrome: 'rgba(11,20,26,0.85)',
      pressed: '#2A3942',
      selected: '#182734',
      inverse: '#E9EDEF',
      scrim: '#000000',
      accent: '#F2543D',
      accentStrong: '#F2836B',
      accentTint: '#3A1A12',
      positive: '#16302A',
      token: '#3A3705',
      tokenHealthy: '#0E7A45',
      tokenCritical: '#8C1D18',
    },
    text: {
      primary: '#E9EDEF',
      secondary: '#8696A0',
      tertiary: '#667D8A',
      accent: '#FFB4A0',
      onAccent: '#1C1C1E',
      onInverse: '#1C1C1E',
      positive: '#A8D8C8',
      token: '#E4E26A',
      onTokenStrong: '#FFFFFF',
    },
    border: {
      hairline: '#2A3942',
      strong: '#374D5A',
      accent: '#F2543D',
    },
    state: {
      available: '#6BA697',
      danger: '#E39B92',
    },
    mark: {
      talk: '#E0245E',
      listen: '#1D6FE0',
      vent: '#C25E00',
      share: '#7A3DE0',
      unwind: '#0F7F62',
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
    field: 10,
    alert: 14,
    bubble: 22,
    thread: 24,
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
      row: 0.99,
      button: 0.96,
      chip: 0.94,
      send: 0.86,
      sendSquashY: 0.78,
      busy: 0.98,
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
      spinnerCycle: 800,
      accentShift: 220,
      stepPromote: 150,
      carouselDwell: 1100,
    },
    opacity: {
      neighbour: 0.1,
      inactive: 0.25,
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
    wordmark: {
      fontFamily: 'TitanOne',
      fontSize: 34,
      lineHeight: 41,
      letterSpacing: 0,
    },
    displayLarge: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 30,
      lineHeight: 37,
      letterSpacing: 0.33,
    },
    displaySmall: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: 0.34,
    },
    titleMedium: {
      fontFamily: 'Geist-Bold',
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: 0.35,
    },
    headline: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.42,
    },
    bodyLarge: {
      fontFamily: 'Geist-Regular',
      fontSize: 17,
      lineHeight: 22,
      letterSpacing: -0.42,
    },
    bodyMedium: {
      fontFamily: 'Geist-Regular',
      fontSize: 16,
      lineHeight: 21,
      letterSpacing: -0.3,
    },
    subhead: {
      fontFamily: 'Geist-Regular',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.23,
    },
    labelMedium: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.23,
    },
    labelSmall: {
      fontFamily: 'Geist-SemiBold',
      fontSize: 13,
      lineHeight: 18,
      letterSpacing: -0.08,
    },
    captionRegular: {
      fontFamily: 'Geist-Regular',
      fontSize: 13,
      lineHeight: 18,
      letterSpacing: -0.08,
    },
    captionSmall: {
      fontFamily: 'Geist-Regular',
      fontSize: 12,
      lineHeight: 17,
      letterSpacing: 0,
    },
    numeralMedium: {
      fontFamily: 'Geist-Bold',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: -0.07,
      fontVariant: ['tabular-nums'] as FontVariantList,
    },
    numeralSmall: {
      fontFamily: 'Geist-Bold',
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

/**
 * Either mode, and deliberately a union rather than `typeof LIGHT`.
 *
 * Both objects are `as const`, which makes every hex a literal type, so
 * `typeof LIGHT` cannot hold DARK, and a theme-aware stylesheet would only
 * ever typecheck against light mode. The union works because the two shapes are
 * identical: property access resolves, and each colour reads as the union of its
 * two values, which is still a string everywhere it is used.
 */
export type Theme = typeof LIGHT | typeof DARK;

/** The app is light-first; DARK exists for the mode switch, not as a default. */
export const TOKENS: Theme = LIGHT;
