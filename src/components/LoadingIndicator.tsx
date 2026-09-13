/**
 * Native Material 3 wait indicators.
 *
 * `loading` is MDC's expressive shape-morph indicator for waits expected to
 * finish within five seconds. `circular` is MDC's indeterminate circular
 * progress indicator for a wait that has become long. Both are real Android
 * Views—not bordered React Native Views approximating Material geometry—and
 * therefore inherit Android's animator-duration scale and native shape motion.
 *
 * https://m3.material.io/components/loading-indicator/overview
 * https://developer.android.com/develop/ui/compose/components/progress
 * https://developer.android.com/reference/com/google/android/material/progressindicator/CircularProgressIndicator
 */
import React, { memo, useEffect, useState } from 'react';
import {
  requireNativeComponent,
  StyleSheet,
  View,
  type ColorValue,
  type ViewProps,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

/** Canonical M3 contained-loading-indicator diameter. */
export const LOADING_CONTAINER_SIZE = 48;

/** Canonical active shape diameter inside the 48dp container. */
export const LOADING_INDICATOR_SIZE = 38;

export type LoadingIndicatorVariant = 'auto' | 'loading' | 'circular';

/** M3 defines the expressive loader as a sub-five-second component. */
export const LONG_WAIT_MS = 5000;

interface NativeIndicatorProps extends ViewProps {
  indicatorColor: ColorValue;
  indicatorSize: number;
  containerColor?: ColorValue;
  trackColor?: ColorValue;
}

/*
 * Registered once per JS runtime, not once per module evaluation.
 *
 * `requireNativeComponent` registers a view config by name and throws in dev on
 * a second registration ("Tried to register two views with the same name").
 * Fast Refresh re-evaluates this module whenever it, or anything it imports,
 * changes — so a plain module-level call redboxes the running app on the first
 * hot reload that touches an indicator. The cache lives on `globalThis`, which
 * survives module re-evaluation but not a full reload, which is exactly the
 * lifetime a view registration has.
 */
type NativeIndicatorComponent = ReturnType<typeof requireNativeComponent<NativeIndicatorProps>>;
const nativeCache = globalThis as unknown as {
  __pappalNativeIndicators?: {
    loading: NativeIndicatorComponent;
    circular: NativeIndicatorComponent;
  };
};
nativeCache.__pappalNativeIndicators ??= {
  loading: requireNativeComponent<NativeIndicatorProps>('PappalMaterialLoadingIndicator'),
  circular: requireNativeComponent<NativeIndicatorProps>('PappalMaterialCircularProgress'),
};
const NativeLoadingIndicator = nativeCache.__pappalNativeIndicators.loading;
const NativeCircularProgress = nativeCache.__pappalNativeIndicators.circular;

interface Props {
  size?: number;
  color?: ColorValue;
  containerColor?: ColorValue;
  /**
   * `auto` changes from expressive loading to circular progress at five
   * seconds. Explicit variants are reserved for an owner that already knows
   * the operation's duration class.
   */
  variant?: LoadingIndicatorVariant;
  spinning?: boolean;
  testID?: string;
}

function LoadingIndicatorView({
  size = LOADING_CONTAINER_SIZE,
  color: colorProp,
  containerColor: containerColorProp,
  variant = 'auto',
  spinning = true,
  testID,
}: Props) {
  const theme = useTheme();
  // M3 draws the active indicator in the theme's PRIMARY colour, which for Fuse
  // is the brand accent (bg.accent, #F2543D) — the same token the wordmark and
  // every primary action use. A wait is a brand moment, not a grey one (Amit,
  // 2026-09-02). Callers over a coloured surface still pass an explicit `color`
  // (e.g. Button uses its label colour). https://m3.material.io/components/progress-indicators/specs
  const color = colorProp ?? theme.color.bg.accent;
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    if (!spinning || variant !== 'auto') {
      setLongWait(false);
      return;
    }
    const timer = setTimeout(() => setLongWait(true), LONG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [spinning, variant]);

  if (!spinning) {
    return <View testID={testID} style={{ width: size, height: size }} />;
  }

  const common = {
    testID,
    accessible: false,
    importantForAccessibility: 'no-hide-descendants' as const,
    indicatorColor: color,
    indicatorSize: size,
    style: [styles.native, { width: size, height: size }],
  };

  if (variant === 'circular' || (variant === 'auto' && longWait)) {
    return (
      <NativeCircularProgress
        {...common}
        trackColor={theme.color.border.hairline}
      />
    );
  }

  // The contained variant's disc is TONAL, not grey. M3 draws the contained
  // loading indicator on primaryContainer; the grey `bg.sunken` disc this used
  // to default to made every wait read as a grey spinner even with a coral
  // active indicator on top (Amit, 2026-09-02). Callers over a coloured surface
  // pass `transparent` or their own container.
  // https://m3.material.io/components/progress-indicators/specs
  return (
    <NativeLoadingIndicator
      {...common}
      containerColor={containerColorProp ?? 'transparent'}
    />
  );
}

export const LoadingIndicator = memo(LoadingIndicatorView);

const styles = StyleSheet.create({
  native: {
    alignSelf: 'center',
  },
});
