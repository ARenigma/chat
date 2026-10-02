/**
 * Segmented control: a row of options on a grey track, the chosen one on a
 * raised pill that glides to it.
 *
 * Ported from Bluesky's SegmentedControl (social-app
 * src/components/forms/SegmentedControl.tsx, MIT; see THIRD_PARTY_LICENSES.md)
 * to our Pressable and tokens:
 * - track: contrast_50 fill, radius 14, 4dp inner pad;
 * - slider: page background, radius 10, inset 4 top and bottom, moved by a
 *   layout transition on an exponential ease-out (EASE_OUT_EXPO), the same
 *   curve; under reduced motion it jumps;
 * - item: 40dp tall (large), text_md medium, primary ink when chosen and
 *   secondary otherwise;
 * - a light haptic on select, as theirs plays.
 * Radio semantics: the group is a radiogroup, each item a radio.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { tick } from '../lib/haptics';
import { DURATION, EASE_OUT_EXPO } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Pressable } from './Pressable';

interface Position {
  x: number;
  width: number;
}

const Ctx = createContext<{
  value: string;
  select: (value: string) => void;
  report: (value: string, position: Position) => void;
} | null>(null);

export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  testID,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  testID?: string;
}) {
  const styles = useStyles(makeStyles);
  const reduced = useReducedMotion();
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const ctx = useMemo(
    () => ({
      value,
      select: (v: string) => {
        tick();
        onChange(v as T);
      },
      report: (v: string, p: Position) =>
        setPositions(prev =>
          prev[v]?.x === p.x && prev[v]?.width === p.width ? prev : { ...prev, [v]: p },
        ),
    }),
    [value, onChange],
  );
  const at = positions[value];
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={styles.track}>
      {at === undefined ? null : (
        <Animated.View
          layout={
            reduced ? undefined : LinearTransition.duration(DURATION.base).easing(EASE_OUT_EXPO)
          }
          style={[styles.slider, { left: at.x, width: at.width }]}
        />
      )}
      <Ctx.Provider value={ctx}>
        {options.map(o => (
          <Item key={o.value} value={o.value} label={o.label} testID={testID ? `${testID}-${o.value}` : undefined} />
        ))}
      </Ctx.Provider>
    </View>
  );
}

function Item({ value, label, testID }: { value: string; label: string; testID?: string }) {
  const styles = useStyles(makeStyles);
  const ctx = useContext(Ctx);
  if (ctx === null) {
    throw new Error('SegmentedControl Item outside its control');
  }
  const active = ctx.value === value;
  return (
    <View
      style={styles.itemBox}
      onLayout={e =>
        ctx.report(value, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width })
      }>
      <Pressable
        onPress={() => ctx.select(value)}
        testID={testID}
        accessibilityRole="radio"
        accessibilityLabel={label}
        checked={active}
        press="none"
        highlight="none"
        style={styles.item}>
        <Text
          allowFontScaling
          numberOfLines={1}
          style={[styles.itemText, active ? styles.itemTextActive : null]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      padding: TOKENS.space['2xs'],
      borderRadius: 14,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
    slider: {
      position: 'absolute',
      top: TOKENS.space['2xs'],
      bottom: TOKENS.space['2xs'],
      borderRadius: 10,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.base,
      elevation: 1,
    },
    itemBox: {
      flex: 1,
    },
    item: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.sm,
      borderRadius: 10,
    },
    // Bluesky's text_md font_medium; Geist ships no Medium here, so the
    // SemiBold step of the same size is the nearest weight.
    itemText: {
      ...TOKENS.typography.textMdSemiBold,
      textAlign: 'center',
      color: t.color.text.secondary,
    },
    itemTextActive: {
      color: t.color.text.primary,
    },
  });
