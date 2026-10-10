/**
 * The bottom bar's geometry, in one place so the bar and `useBottomBarOffset`
 * cannot disagree about how tall it is.
 *
 * Slot = `space.sm` 12 above + the 32dp pill + `space['2xs']` 4 + the 16dp
 * label line + `space.md` 16 below = 80, the M3 labelled bar
 * (androidx NavigationBarTokens.TallContainerHeight = 80.dp,
 * ItemActiveIndicatorIconLabelSpace = 4.dp, LabelTextFont = LabelMedium), and
 * the 80dp WhatsApp's bar measures on the S22 (owner, 2026-10-10: labels like
 * WhatsApp). The whole column is the touch target, well over 48dp, because
 * `hitSlop` cannot extend past a parent on Android
 * (developer.android.com/guide/topics/ui/accessibility/apps, "touch target
 * size"). platform.test.ts asserts the sum.
 *
 * adapted from bluesky-social/social-app src/view/shell/bottom-bar/BottomBarStyles.tsx
 * (MIT), see THIRD_PARTY_LICENSES.md
 */

import { StyleSheet } from 'react-native';
import { TOKENS, type Theme } from '../../theme/tokens';
import { CONTENT_COLUMN_MAX } from '../../lib/windowSize';

/**
 * M3 NavigationBar active indicator, 64 x 32 with a full corner
 * (https://m3.material.io/components/navigation-bar/specs; the same numbers as
 * androidx NavigationBarTokens ActiveIndicatorWidth/Height). Kept by the owner
 * on the Bluesky bar, which has none of its own.
 */
export const INDICATOR_WIDTH = 64;
const INDICATOR_HEIGHT = 32;
/** labelMedium's line height: the label row under the pill. */
const LABEL_LINE = 16;
/** The labelled slot, 12 + 32 + 4 + 16 + 16 (see the header). */
export const SLOT_HEIGHT =
  TOKENS.space.sm + INDICATOR_HEIGHT + TOKENS.space['2xs'] + LABEL_LINE + TOKENS.space.md;

/**
 * The bar's bottom padding: the navigation inset clamped to
 * `layout.bottomBarInsetMin..Max` (15..60, Bluesky BottomBar.tsx). THE ONE
 * CLAMP: the bar and useBottomBarOffset both call this.
 */
export function clampBottomInset(bottom: number): number {
  return Math.min(
    Math.max(bottom, TOKENS.layout.bottomBarInsetMin),
    TOKENS.layout.bottomBarInsetMax,
  );
}

export const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // Opaque page colour and a hairline top border: Bluesky's bar, no Frost.
    // Absolute, so it never takes height from the screen above it; screens pad
    // by useBottomBarOffset instead.
    root: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      paddingHorizontal: TOKENS.space.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
      backgroundColor: t.color.bg.base,
    },
    // Full-width surface, slot row capped at the content column and centred
    // on a large screen (nav-migration D3 default).
    slots: {
      flexDirection: 'row',
      width: '100%',
      maxWidth: CONTENT_COLUMN_MAX,
    },
    // The spotlight-tour wrapper around a slot takes the slot's share of the
    // row and nothing else: the padding stays on the slot itself.
    anchor: {
      flex: 1,
    },
    slot: {
      flex: 1,
      height: SLOT_HEIGHT,
      alignItems: 'center',
      paddingTop: TOKENS.space.sm,
    },
    // Absolute and childless, so animating its width re-lays-out nothing else
    // (animate-expo step 4, the one sanctioned width animation). Centred by the
    // slot's alignItems while its width changes.
    indicator: {
      position: 'absolute',
      top: TOKENS.space.sm,
      height: INDICATOR_HEIGHT,
      borderRadius: TOKENS.radius.md,
      backgroundColor: t.color.bg.navIndicator,
    },
    // The icon's own box: vertically centred in the pill, and the anchor the
    // badge is placed against (M3 BadgedBox measures from the icon, not the slot).
    // Explicit width so the badge's `left: '50%'` resolves to the icon centre
    // rather than an undefined container width.
    // https://m3.material.io/components/badges/specs (BadgedBox offset)
    iconBox: {
      width: TOKENS.icon.md,
      height: INDICATOR_HEIGHT,
      justifyContent: 'center',
    },
    // M3 places the label 4dp under the indicator and never moves the icon
    // between states (androidx NavigationBar.kt placeLabelAndIcon). Every label
    // is full-strength ink, as WhatsApp's are; the selected one is the
    // emphasized weight (see BottomBar.tsx for that departure from M3).
    label: {
      ...TOKENS.typography.labelMedium,
      marginTop: TOKENS.space['2xs'],
      color: t.color.text.primary,
      textAlign: 'center',
    },
    labelSelected: {
      ...TOKENS.typography.labelMediumEmphasized,
    },
  });
