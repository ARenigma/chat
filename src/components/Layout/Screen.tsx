/**
 * The outermost component of every navigator screen.
 *
 * Three jobs:
 * - `minimalShell` hides the bottom bar while this screen is FOCUSED (chat,
 *   call, wallet, ring; nav-migration §2). Focus-scoped, not mount-scoped,
 *   because native-stack keeps a covered screen mounted.
 * - Children render inside `<LayoutAnimationConfig skipEntering skipExiting>`,
 *   so entering animations do not replay when the screen first mounts (a lazy
 *   tab, a push) and exiting ones do not run when it unmounts (a pop): the
 *   native stack is already animating the screen as a whole
 *   (https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/layout-animation-config).
 *   Children mounting LATER, in a screen that is already up, still animate.
 * - `sheet` is the body of a native form sheet (ProviderDetail, Wallet;
 *   owner 2026-09-26, ADR-0032). The native sheet rounds its own background
 *   with `sheetCornerRadius`, but a child painting a full-bleed surface (the
 *   profile hero) would square those corners off again, so the body clips to
 *   the same `radius.sheet`. It also draws the M3 drag handle, because the
 *   Android form sheet draws none (`sheetGrabberVisible` is iOS-only).
 *
 * Unlike Bluesky's Screen it does not pad the top inset: that belongs to
 * `Layout.Header` in this app (nav-migration §8, step 10), and a screen that
 * padded it too would inset twice.
 *
 * adapted from bluesky-social/social-app src/components/Layout/index.tsx (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import React, { memo } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../../theme/tokens';
import { useStyles } from '../../theme/ThemeProvider';
import { useEnableMinimalShellModeForScreen } from '../../shell/minimalMode';
import { SheetGrabber } from '../Sheet';

export type ScreenProps = ViewProps & {
  /** Hide the bottom bar while this screen is focused. */
  minimalShell?: boolean;
  /** The screen is a native form sheet's body: rounded clip and drag handle. */
  sheet?: boolean;
};

export const Screen = memo(function LayoutScreen({
  style,
  minimalShell = false,
  sheet = false,
  children,
  ...props
}: ScreenProps) {
  const styles = useStyles(makeStyles);
  useEnableMinimalShellModeForScreen({ enabled: minimalShell });
  return (
    <View style={[styles.screen, sheet && styles.sheet, style]} {...props}>
      <LayoutAnimationConfig skipEntering skipExiting>
        {sheet ? <SheetGrabber /> : null}
        {children}
      </LayoutAnimationConfig>
    </View>
  );
});

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    sheet: {
      borderTopLeftRadius: TOKENS.radius.sheet,
      borderTopRightRadius: TOKENS.radius.sheet,
      overflow: 'hidden',
    },
  });
