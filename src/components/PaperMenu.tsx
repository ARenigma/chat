import React, { useMemo } from 'react';
import {
  Modal,
  Pressable as RNPressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { EASE_OUT, INTERACTION, M3, menuIn, menuOut } from '../theme/motion';
import { useActiveElement } from '../lib/activeElements';

/**
 * The scrim's own entrance and exit, hoisted so the builder allocates once.
 *
 * `animationType="none"` on the Modal means the card's `entering={menuIn}`
 * owns the entering animation. Without an explicit entering on the scrim,
 * it would hard-cut in while the card animates. These match the card's opacity
 * timing (M3.duration.short2) so scrim and card arrive and leave together.
 * `ReduceMotion.Never`: the scrim is what communicates "a layer is open" —
 * it must always appear, even under the OS reduce-motion setting.
 */
const scrimIn = FadeIn.duration(M3.duration.short2)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.Never);
const scrimOut = FadeOut.duration(M3.duration.short2)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.Never);
import { Pressable } from './Pressable';

export interface PaperMenuItem {
  key: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** Leave the menu mounted (e.g. a confirm that replaces it). */
  keepOpen?: boolean;
  /**
   * A hairline rule above this item, grouping what is below it away from what
   * is above. M3's own divider inside a menu, used here for one purpose:
   * putting an irreversible action in its own group so it is a deliberate
   * reach rather than the next row down.
   * https://m3.material.io/components/menus/guidelines
   */
  divider?: boolean;
}

export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  items: readonly PaperMenuItem[];
  onClose: () => void;
  /** Window-space rect of the long-pressed row/face. Menu and hole use it. */
  anchor: MenuAnchor | null;
  testID?: string;
}

const MENU_MIN_W = 220;
const ROW_H = 48;
const GAP = 8;
const EDGE = 16;
const HOLE_PAD = 6;

/**
 * Material 3 vertical menu, anchored to the long-press target.
 *
 * Dims the rest of the screen; the pressed card (hole) and the menu stay clear.
 * Scrim tap dismisses — M3 menus dismiss on outside press.
 * https://m3.material.io/components/menus/guidelines
 * https://developer.android.com/reference/kotlin/androidx/compose/material3/DropdownMenu.composable
 */
export function PaperMenu({ visible, items, onClose, anchor, testID }: Props) {
  const styles = useStyles(makeStyles);
  const { width: winW, height: winH } = useWindowDimensions();
  // Register with the active-element registry. nav-migration §3.
  useActiveElement(visible, onClose);

  const layout = useMemo(() => {
    const menuH = items.length * ROW_H;
    const menuW = MENU_MIN_W;
    if (anchor === null) {
      return {
        hole: null as MenuAnchor | null,
        menu: { left: (winW - menuW) / 2, top: (winH - menuH) / 2, width: menuW, height: menuH },
      };
    }
    const hole = {
      x: Math.max(0, anchor.x - HOLE_PAD),
      y: Math.max(0, anchor.y - HOLE_PAD),
      width: Math.min(winW, anchor.width + HOLE_PAD * 2),
      height: Math.min(winH, anchor.height + HOLE_PAD * 2),
    };
    let top = hole.y + hole.height + GAP;
    let above = false;
    if (top + menuH > winH - EDGE) {
      top = Math.max(EDGE, hole.y - menuH - GAP);
      above = true;
    }
    let left = hole.x;
    if (left + menuW > winW - EDGE) {
      left = winW - menuW - EDGE;
    }
    if (left < EDGE) {
      left = EDGE;
    }
    return { hole, menu: { left, top, width: menuW, height: menuH }, above };
  }, [anchor, items.length, winW, winH]);

  // The M3 menu expands along Y away from its anchoring edge: from the top when
  // it opens below the trigger, from the bottom when it flipped above it.
  const originEdge = (layout as { above?: boolean }).above === true ? 'bottom' : 'top';

  const hole = layout.hole;

  return (
    <Modal
      visible={visible}
      transparent
      // `animationType="none"`: the entering animation is owned by the card's
      // `entering={menuIn}` and the scrim's `scrimIn`. A Modal fade here would
      // compound with menuIn's own opacity ramp — two curves multiplying into
      // one nobody specified. The scrim has its own explicit FadeIn (scrimIn)
      // so it does not hard-cut in when the Modal's own fade is removed.
      animationType="none"
      hardwareAccelerated
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.host} pointerEvents="box-none">
        {/* Scrim wrapped in its own Animated.View so it fades with the card
            rather than hard-cutting when animationType="none". */}
        <Animated.View
          entering={scrimIn}
          exiting={scrimOut}
          style={styles.scrimWrapper}
          pointerEvents="box-none">
        {hole === null ? (
          <RNPressable
            style={styles.scrimFull}
            onPress={onClose}
            accessibilityLabel="Dismiss menu"
            testID={testID}
          />
        ) : (
          <>
            <RNPressable
              style={[styles.dim, { height: hole.y }]}
              onPress={onClose}
              accessibilityLabel="Dismiss menu"
              testID={testID}
            />
            <View style={[styles.bandRow, { height: hole.height }]}>
              <RNPressable style={[styles.dim, { width: hole.x }]} onPress={onClose} />
              <View style={{ width: hole.width, height: hole.height }} />
              <RNPressable style={[styles.dim, styles.fill]} onPress={onClose} />
            </View>
            <RNPressable style={[styles.dim, styles.fill]} onPress={onClose} />
          </>
        )}
        </Animated.View>

        <Animated.View
          entering={menuIn}
          exiting={menuOut}
          style={[
            styles.card,
            {
              left: layout.menu.left,
              top: layout.menu.top,
              width: layout.menu.width,
              transformOrigin: originEdge,
            },
          ]}
          accessibilityRole="menu">
          {items.map(item => (
            <React.Fragment key={item.key}>
              {item.divider === true ? <View style={styles.divider} /> : null}
            <Pressable
              onPress={() => {
                item.onPress();
                if (!item.keepOpen) {
                  onClose();
                }
              }}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              press="none"
              highlight="dim"
              testID={`paper-menu-${item.key}`}
              style={styles.row}>
              <Text
                allowFontScaling
                style={[styles.label, item.danger && styles.labelDanger]}>
                {item.label}
              </Text>
            </Pressable>
            </React.Fragment>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    host: {
      flex: 1,
    },
    scrimWrapper: {
      ...StyleSheet.absoluteFill,
    },
    scrimFull: {
      ...StyleSheet.absoluteFill,
      backgroundColor: t.color.bg.scrim,
      opacity: INTERACTION.scrim,
    },
    dim: {
      backgroundColor: t.color.bg.scrim,
      opacity: INTERACTION.scrim,
    },
    // Static half of the cut-out bands; the measured half stays inline.
    // `bandRow`, not `row`, because `row` below is a menu item.
    bandRow: {
      flexDirection: 'row',
    },
    fill: {
      flex: 1,
    },
    card: {
      position: 'absolute',
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      overflow: 'hidden',
      zIndex: 2,
    },
    row: {
      minHeight: ROW_H,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space.sm,
    },
    // The rule between groups. A hairline, so it separates without becoming a
    // second piece of chrome inside a menu that is already a raised card.
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
    },
    label: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    labelDanger: {
      color: t.color.state.danger,
    },
  });
