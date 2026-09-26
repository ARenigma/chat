/**
 * Minimal shell: a pushed screen that wants the whole window hides the bottom
 * bar by mounting `<Layout.Screen minimalShell>`.
 *
 * Ref-counted, as in Bluesky: the bar hides when the count leaves 0 and comes
 * back when it returns to 0, so two stacked minimal screens (a chat, then a
 * call over it) do not fight over one boolean.
 *
 * Two outputs, because two different consumers need them:
 * - `footerMode`, a 0..1 shared value that drives the bar's opacity and
 *   translate on the UI thread (useMinimalShellTransform.ts);
 * - `hidden`, a React-state MIRROR of `count > 0`, for the props a worklet
 *   cannot set: `importantForAccessibility="no-hide-descendants"`,
 *   `accessibilityElementsHidden` and `pointerEvents`. Without it a hidden bar
 *   is transparent but still in the accessibility tree, so TalkBack walks onto
 *   `nav-*` buttons over a chat (nav-migration B32).
 *
 * The spring is `motion.spring.shell` (critically damped, clamped, ~120ms);
 * the departure from Bluesky's ~240ms is stated on the token. It runs with
 * `ReduceMotion.Never` because the value also carries the OPACITY, and reduced
 * motion keeps opacity changes that explain a state change; the translate is
 * dropped in the transform hook instead (animate-expo step 9).
 *
 * adapted from bluesky-social/social-app src/state/shell/minimal-mode.tsx (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ReduceMotion, type SharedValue, useSharedValue } from 'react-native-reanimated';
import { useFocusEffect } from '@react-navigation/native';
import { springTo } from '../theme/motion';

interface MinimalModeState {
  /** 0 = bar shown, 1 = bar hidden. Read only inside worklets. */
  footerMode: SharedValue<number>;
}

interface MinimalModeSetters {
  add: () => void;
  subtract: () => void;
}

const StateContext = createContext<MinimalModeState | null>(null);
StateContext.displayName = 'MinimalModeStateContext';
const HiddenContext = createContext<boolean | null>(null);
HiddenContext.displayName = 'MinimalModeHiddenContext';
const SetContext = createContext<MinimalModeSetters | null>(null);
SetContext.displayName = 'MinimalModeSetContext';

export function MinimalModeProvider({ children }: { children: ReactNode }) {
  const footerMode = useSharedValue(0);
  const [hidden, setHidden] = useState(false);

  const setMode = useCallback(
    (hide: boolean) => {
      footerMode.set(springTo(hide ? 1 : 0, 'shell', undefined, ReduceMotion.Never));
      setHidden(hide);
    },
    [footerMode],
  );

  // Defaults to shown; any count above 0 hides.
  const countRef = useRef(0);
  const add = useCallback(() => {
    if (countRef.current === 0) {
      setMode(true);
    }
    countRef.current += 1;
  }, [setMode]);
  const subtract = useCallback(() => {
    if (countRef.current === 1) {
      setMode(false);
    }
    // The count never goes below 0.
    if (countRef.current > 0) {
      countRef.current -= 1;
    }
  }, [setMode]);

  const setters = useMemo(() => ({ add, subtract }), [add, subtract]);
  const state = useMemo(() => ({ footerMode }), [footerMode]);

  return (
    <StateContext.Provider value={state}>
      <HiddenContext.Provider value={hidden}>
        <SetContext.Provider value={setters}>{children}</SetContext.Provider>
      </HiddenContext.Provider>
    </StateContext.Provider>
  );
}

function required<T>(value: T | null, name: string): T {
  if (value === null) {
    throw new Error(`${name} must be used within ShellStateProvider`);
  }
  return value;
}

export function useMinimalShellMode(): MinimalModeState {
  return required(useContext(StateContext), 'useMinimalShellMode');
}

/** The React-state mirror: true while any minimal screen is mounted and focused. */
export function useMinimalShellHidden(): boolean {
  return required(useContext(HiddenContext), 'useMinimalShellHidden');
}

export function useMinimalShellModeSetters(): MinimalModeSetters {
  return required(useContext(SetContext), 'useMinimalShellModeSetters');
}

/** Hides the bar while the calling component is mounted. */
export function useEnableMinimalShellMode({ enabled }: { enabled: boolean }): void {
  const setters = useMinimalShellModeSetters();
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    setters.add();
    return () => setters.subtract();
  }, [enabled, setters]);
}

/**
 * Hides the bar while the calling SCREEN is focused. Focus-scoped rather than
 * mount-scoped because native-stack keeps a covered screen mounted: a chat
 * under a pushed profile is still mounted, and a mount-scoped hide would keep
 * the bar hidden after popping back to a tab root (Bluesky minimal-mode.tsx).
 */
export function useEnableMinimalShellModeForScreen({ enabled }: { enabled: boolean }): void {
  const setters = useMinimalShellModeSetters();
  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        return undefined;
      }
      setters.add();
      return () => setters.subtract();
    }, [enabled, setters]),
  );
}
