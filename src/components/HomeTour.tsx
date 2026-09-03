import React, { useMemo } from 'react';
import { Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { TOUR_STEPS, useHomeTour } from '../store/useHomeTour';
import { Pressable } from './Pressable';

const PAD = 8;

/**
 * First-Home tutorial A: dim the screen, cut a hole around the live control,
 * and park a Paper tooltip beside it.
 *
 * Instagram Stories / Maps / Gmail "Got it" coaches, WhatsApp's pay-tooltip,
 * and Material's TooltipBox all use a spotlight + one sentence. Not a pager
 * of full screens — Home is already the destination.
 */
export function HomeTour() {
  const styles = useStyles(makeStyles);
  const { width: winW, height: winH } = useWindowDimensions();
  const active = useHomeTour(s => s.active);
  const step = useHomeTour(s => s.step);
  const targets = useHomeTour(s => s.targets);
  const next = useHomeTour(s => s.next);
  const skip = useHomeTour(s => s.skip);

  const copy = TOUR_STEPS[step];
  const hole = copy ? targets[copy.id] : undefined;

  const bands = useMemo(() => {
    if (!hole) {
      return { top: winH, left: 0, midH: 0, holeX: 0, holeW: 0, holeH: 0 };
    }
    const x = Math.max(0, hole.x - PAD);
    const y = Math.max(0, hole.y - PAD);
    const w = Math.min(winW - x, hole.width + PAD * 2);
    const h = Math.min(winH - y, hole.height + PAD * 2);
    return { top: y, left: winW - (x + w), midH: h, holeX: x, holeW: w, holeH: h };
  }, [hole, winW, winH]);

  const tooltipTop = useMemo(() => {
    if (!hole) {
      return winH * 0.4;
    }
    const below = hole.y + hole.height + PAD + TOKENS.space.md;
    if (below + 160 < winH) {
      return below;
    }
    return Math.max(TOKENS.space.xl, hole.y - 160);
  }, [hole, winH]);

  if (!active || copy === undefined) {
    return null;
  }

  const last = step === TOUR_STEPS.length - 1;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      hardwareAccelerated
      statusBarTranslucent
      onRequestClose={skip}>
      <View style={styles.host} pointerEvents="box-none">
        <View style={[styles.dim, { height: bands.top }]} />
        <View style={[styles.row, { height: bands.midH }]}>
          <View style={[styles.dim, { width: bands.holeX }]} />
          <View style={{ width: bands.holeW, height: bands.holeH }} />
          <View style={[styles.dim, styles.fill]} />
        </View>
        <View style={[styles.dim, styles.fill]} />

        <View style={[styles.tooltip, { top: tooltipTop }]} accessibilityRole="text">
          <Text allowFontScaling style={styles.title}>
            {copy.title}
          </Text>
          <Text allowFontScaling style={styles.body}>
            {copy.body}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={skip}
              accessibilityLabel="Skip tutorial"
              press="none"
              highlight="ios"
              testID="home-tour-skip"
              style={styles.action}>
              <Text allowFontScaling style={styles.skipLabel}>
                Skip
              </Text>
            </Pressable>
            <Pressable
              onPress={next}
              accessibilityLabel={last ? 'Done' : 'Next'}
              press="none"
              highlight="ios"
              testID="home-tour-next"
              style={styles.action}>
              <Text allowFontScaling style={styles.nextLabel}>
                {last ? 'Done' : 'Next'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    host: {
      flex: 1,
    },
    dim: {
      backgroundColor: t.color.bg.scrim,
      opacity: 0.54,
    },
    // The scrim is built from bands; these two carry the static half of each
    // band so the dynamic half stays a one-key inline object.
    row: {
      flexDirection: 'row',
    },
    fill: {
      flex: 1,
    },
    tooltip: {
      position: 'absolute',
      left: TOKENS.space.lg,
      right: TOKENS.space.lg,
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space.md,
      gap: TOKENS.space.xs,
    },
    title: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    body: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: TOKENS.space.sm,
      marginTop: TOKENS.space.xs,
    },
    action: {
      minHeight: 40,
      paddingHorizontal: TOKENS.space.md,
      justifyContent: 'center',
    },
    skipLabel: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.secondary,
    },
    nextLabel: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.accent,
    },
  });
