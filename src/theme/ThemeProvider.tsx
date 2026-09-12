import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { storage } from '../lib/storage';
import { THEME_DEFAULT_MODE } from '../config';
import { DARK, LIGHT, type Theme } from './tokens';
import { DURATION } from './motion';

/**
 * Light and dark, and the transition between them.
 *
 * Only **colour** is reactive. `space`, `radius`, `typography` and `motion` are
 * byte-identical across the two modes, a test asserts it, so making them
 * reactive would re-render the app to hand every component the same numbers back.
 * That single observation is what keeps this a context read rather than a
 * styling engine.
 *
 * Styles are built by `useStyles(makeStyles)`, memoised on theme identity. The
 * alternative that looks simpler, leaving `StyleSheet.create` at module scope,
 * cannot work: module scope evaluates once per bundle load, so the first theme
 * the app ever saw would be frozen into every stylesheet.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_KEY = 'companion.themeMode';

interface ThemeState {
  theme: Theme;
  /** What the user chose, which is not the same as what is on screen. */
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeState>({
  theme: LIGHT,
  mode: 'light',
  isDark: false,
  setMode: () => undefined,
});

/**
 * Fresh-install default comes from `THEME_DEFAULT_MODE` in src/config.ts, and
 * as of 2026-09-08 it is 'dark' (Amit).
 *
 * It was hardcoded 'light' here with a long argument for why: dark being a
 * deliberate personalisation rather than a base expectation. That argument has
 * been overtaken by a product decision, and the value moved to config so the
 * next such decision is a one-line flip rather than an edit to this function.
 *
 * Either way it remains a DEPARTURE from Android's dark-theme guidance, which
 * recommends defaulting to System so the app follows the device immediately —
 * 'dark' departs from it just as 'light' did, in the other direction. Recorded
 * in docs/android-audit.md and asserted in __tests__/theme.test.ts.
 * https://developer.android.com/develop/ui/views/theming/darktheme
 *
 * A stored choice always wins over the default. That ordering is the whole
 * reason this reads storage first: flipping the config must not override
 * somebody who has already chosen, or their setting would undo itself on the
 * next upgrade.
 */
function readStoredMode(): ThemeMode {
  const stored = storage.get(MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : THEME_DEFAULT_MODE;
}

/**
 * The wash that makes the change feel like one event.
 *
 * Switching theme re-renders every surface at once, and without help that is a
 * single-frame cut: correct, and jarring enough that people tap it twice to see
 * what happened. Animating the surfaces themselves would mean every one of the
 * app's colours becoming an animated style, which is a large amount of machinery
 * for one moment.
 *
 * So the content switches instantly underneath, and a full-screen pane of the
 * *outgoing* background colour is laid over the top and faded out. The eye reads
 * the old scene dissolving into the new one, which is what actually happened,
 * it just did not happen gradually. `pointerEvents="none"` because a transition
 * that eats a tap is worse than a hard cut.
 */
function Dissolve({ from, nonce }: { from: string; nonce: number }) {
  const cover = useSharedValue(0);

  useEffect(() => {
    if (nonce === 0) {
      return;
    }
    cover.value = 1;
    cover.value = withTiming(0, { duration: DURATION.slow });
  }, [nonce, cover]);

  const style = useAnimatedStyle(() => ({
    opacity: cover.value,
    // Interpolating the pane's own colour as it fades stops the overlay reading
    // as a grey flash on the way out: it is always somewhere between the two
    // backgrounds, never a third colour.
    backgroundColor: interpolateColor(cover.value, [0, 1], [from, from]),
  }));

  return <Animated.View pointerEvents="none" style={[styles.cover, style]} />;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState(
    () => Appearance.getColorScheme() === 'dark',
  );
  // Bumped on every change so the dissolve re-runs; the outgoing colour is
  // captured at the same time, because by the time the effect runs the theme has
  // already changed and the old value is gone.
  const [transition, setTransition] = useState<{ nonce: number; from: string }>({
    nonce: 0,
    from: LIGHT.color.bg.base,
  });

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemDark(colorScheme === 'dark');
    });
    return () => sub.remove();
  }, []);

  const isDark = mode === 'system' ? systemDark : mode === 'dark';
  const theme = isDark ? DARK : LIGHT;

  const setMode = useCallback(
    (next: ThemeMode) => {
      const nextDark = next === 'system' ? systemDark : next === 'dark';
      if (nextDark !== isDark) {
        setTransition(t => ({ nonce: t.nonce + 1, from: theme.color.bg.base }));
      }
      storage.set(MODE_KEY, next);
      setModeState(next);
    },
    [isDark, systemDark, theme],
  );

  // The system flipping under a `system` preference deserves the same dissolve
  // as a deliberate tap, it is the same visual event.
  useEffect(() => {
    if (mode !== 'system') {
      return;
    }
    setTransition(t => (t.nonce === 0 ? t : { ...t, nonce: t.nonce + 1 }));
  }, [systemDark, mode]);

  const value = useMemo<ThemeState>(
    () => ({ theme, mode, isDark, setMode }),
    [theme, mode, isDark, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <Dissolve from={transition.from} nonce={transition.nonce} />
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

/**
 * Pin a subtree to light, regardless of the app-wide mode.
 *
 * Onboarding is the one screen that must never read as the member's chosen
 * dark mode (Amit, 2026-09-12: "keep it always light mode even if user
 * selects dark mode inside app") — the bloom is tuned against a light ground
 * and chasing a dark-mode variant of it (NightSky, a forced-white Google
 * button, all built and then reverted the same night) was the wrong fight.
 * `setMode` is a no-op here on purpose: nothing under this provider should be
 * able to change the app's real preference, which lives one provider up.
 */
const LIGHT_THEME_STATE: ThemeState = {
  theme: LIGHT,
  mode: 'light',
  isDark: false,
  setMode: () => undefined,
};

export function ForceLightTheme({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={LIGHT_THEME_STATE}>{children}</ThemeContext.Provider>
  );
}

export function useThemeMode(): Omit<ThemeState, 'theme'> {
  const { mode, isDark, setMode } = useContext(ThemeContext);
  return { mode, isDark, setMode };
}

/**
 * Build a stylesheet from the active theme, memoised on theme identity.
 *
 * `makeStyles` must be declared at module scope so the reference is stable,
 * an inline arrow would be a new function every render and defeat the memo. A
 * test enforces it.
 */
export function useStyles<T>(makeStyles: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => makeStyles(theme), [makeStyles, theme]);
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
