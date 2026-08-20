/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: design/tokens.json, exported from Figma file dThaRIYIQZX0wamQXa9b2g.
 * Regenerate with `npm run tokens`. `npm run tokens:check` fails on drift.
 *
 * Accent budget: color.bg.accent and color.text.accent appear in exactly five
 * places — send button fill, companion mark wash, low-balance count, typing dots
 * and the presence dot. See the Accent budget page in Figma before adding a
 * sixth. Backgrounds, bubbles, headers, dividers and list rows stay monochrome.
 */

export const LIGHT = {
  color: {
    bg: {
      base: '#F4F4F4',
      raised: '#FFFFFF',
      sunken: '#EBEBEB',
      inverse: '#0A0A0A',
      accent: '#B0325C',
      accentTint: '#FCF1F4',
    },
    text: {
      primary: '#0A0A0A',
      secondary: '#4E4F54',
      accent: '#95264A',
      onAccent: '#FFFFFF',
      onInverse: '#FFFFFF',
    },
    border: {
      hairline: '#E5E5E5',
      accent: '#F0D5DE',
    },
    state: {
      available: '#10B981',
      danger: '#E5484D',
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
    tail: 6,
    sm: 8,
    md: 16,
    lg: 20,
    xl: 26,
    pill: 999,
    screen: 44,
  },
  motion: {
    duration: {
      fast: 140,
      base: 220,
      slow: 420,
      breath: 4000,
    },
    spring: {
      damping: 18,
      stiffness: 140,
      mass: 0.8,
    },
  },
  typography: {
    displayLarge: {
      fontSize: 30,
      fontWeight: '600',
      lineHeight: 35,
      letterSpacing: -0.75,
    },
    titleMedium: {
      fontSize: 20,
      fontWeight: '600',
      lineHeight: 26,
      letterSpacing: -0.3,
    },
    bodyLarge: {
      fontSize: 17,
      fontWeight: '400',
      lineHeight: 25,
      letterSpacing: -0.09,
    },
    bodyMedium: {
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 23,
      letterSpacing: -0.08,
    },
    labelMedium: {
      fontSize: 15,
      fontWeight: '500',
      lineHeight: 21,
      letterSpacing: -0.07,
    },
    captionRegular: {
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 20,
      letterSpacing: -0.07,
    },
    captionSmall: {
      fontSize: 12,
      fontWeight: '400',
      lineHeight: 17,
      letterSpacing: 0,
    },
  },
  elevation: {
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
      base: '#0C0C0D',
      raised: '#17181A',
      sunken: '#1E1F22',
      inverse: '#26272B',
      accent: '#E0648B',
      accentTint: '#241118',
    },
    text: {
      primary: '#F7F7F8',
      secondary: '#9C9CA1',
      accent: '#F2A0B8',
      onAccent: '#0C0C0D',
      onInverse: '#F7F7F8',
    },
    border: {
      hairline: '#232427',
      accent: '#241118',
    },
    state: {
      available: '#10B981',
      danger: '#E5484D',
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
    tail: 6,
    sm: 8,
    md: 16,
    lg: 20,
    xl: 26,
    pill: 999,
    screen: 44,
  },
  motion: {
    duration: {
      fast: 140,
      base: 220,
      slow: 420,
      breath: 4000,
    },
    spring: {
      damping: 18,
      stiffness: 140,
      mass: 0.8,
    },
  },
  typography: {
    displayLarge: {
      fontSize: 30,
      fontWeight: '600',
      lineHeight: 35,
      letterSpacing: -0.75,
    },
    titleMedium: {
      fontSize: 20,
      fontWeight: '600',
      lineHeight: 26,
      letterSpacing: -0.3,
    },
    bodyLarge: {
      fontSize: 17,
      fontWeight: '400',
      lineHeight: 25,
      letterSpacing: -0.09,
    },
    bodyMedium: {
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 23,
      letterSpacing: -0.08,
    },
    labelMedium: {
      fontSize: 15,
      fontWeight: '500',
      lineHeight: 21,
      letterSpacing: -0.07,
    },
    captionRegular: {
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 20,
      letterSpacing: -0.07,
    },
    captionSmall: {
      fontSize: 12,
      fontWeight: '400',
      lineHeight: 17,
      letterSpacing: 0,
    },
  },
  elevation: {
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
