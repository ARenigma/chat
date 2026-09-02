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

const NativeLoadingIndicator =
  requireNativeComponent<NativeIndicatorProps>('PappalMaterialLoadingIndicator');
const NativeCircularProgress =
  requireNativeComponent<NativeIndicatorProps>('PappalMaterialCircularProgress');

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

  return (
    <NativeLoadingIndicator
      {...common}
      containerColor={containerColorProp ?? theme.color.bg.sunken}
    />
  );
}

export const LoadingIndicator = memo(LoadingIndicatorView);

const styles = StyleSheet.create({
  native: {
    alignSelf: 'center',
  },
});
