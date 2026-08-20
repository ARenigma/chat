import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS } from '../theme/tokens';

export type Glyph = 'chevron-left' | 'chevron-right' | 'arrow-up' | 'dots' | 'plus' | 'shield';

interface Props {
  glyph: Glyph;
  size?: number;
  color?: string;
  testID?: string;
}

/**
 * Six glyphs drawn with borders and Views — no SVG, no icon font, no dependency.
 *
 * This started as react-native-svg and had to be rewritten: an SVG dispatches a
 * layout event from inside its draw pass (`VirtualView.setClientRect`), and
 * Reanimated responds with a synchronous prop update, which throws
 * `synchronouslyUpdateUIProps failed` and kills touch handling on the whole
 * subtree. Every icon here sits inside an animated pressable, so that collision
 * was unavoidable. Borders have none of that machinery.
 *
 * A chevron is a square with two adjacent borders rotated 45 degrees. An arrow is
 * that same head over a bar. A plus is two crossed bars. A shield is a rounded
 * square with its lower corners heavily rounded — enough to read as "safety"
 * next to a name without needing an icon set.
 */
function IconView({ glyph, size = 16, color, testID }: Props) {
  const stroke = color ?? TOKENS.color.text.primary;
  const weight = Math.max(1.5, size / 9);

  if (glyph === 'dots') {
    const dot = Math.max(3, size / 4.5);
    return (
      <View testID={testID} style={[styles.row, { gap: dot * 0.8 }]}>
        {[0, 1, 2].map(i => (
          <View
            key={i}
            style={{
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: stroke,
            }}
          />
        ))}
      </View>
    );
  }

  if (glyph === 'plus') {
    return (
      <View testID={testID} style={[styles.center, { width: size, height: size }]}>
        <View
          style={[
            styles.absolute,
            { width: size * 0.78, height: weight, borderRadius: weight / 2, backgroundColor: stroke },
          ]}
        />
        <View
          style={[
            styles.absolute,
            { width: weight, height: size * 0.78, borderRadius: weight / 2, backgroundColor: stroke },
          ]}
        />
      </View>
    );
  }

  if (glyph === 'shield') {
    return (
      <View testID={testID} style={[styles.center, { width: size, height: size }]}>
        <View
          style={{
            width: size * 0.72,
            height: size * 0.82,
            borderWidth: weight,
            borderColor: stroke,
            borderTopLeftRadius: weight,
            borderTopRightRadius: weight,
            borderBottomLeftRadius: size * 0.36,
            borderBottomRightRadius: size * 0.36,
          }}
        />
      </View>
    );
  }

  const head = size * 0.62;
  const headStyle = {
    width: head,
    height: head,
    borderColor: stroke,
    borderTopWidth: weight,
    borderRightWidth: weight,
  };

  if (glyph === 'arrow-up') {
    return (
      <View testID={testID} style={[styles.center, { width: size, height: size }]}>
        <View
          style={[
            styles.absolute,
            {
              width: weight,
              height: size * 0.86,
              borderRadius: weight / 2,
              backgroundColor: stroke,
            },
          ]}
        />
        <View
          style={[
            headStyle,
            styles.absolute,
            { top: weight, transform: [{ rotate: '-45deg' }] },
          ]}
        />
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.center, { width: size * 0.7, height: size }]}>
      <View
        style={[
          headStyle,
          { transform: [{ rotate: glyph === 'chevron-right' ? '45deg' : '-135deg' }] },
        ]}
      />
    </View>
  );
}

export const Icon = memo(IconView);

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  absolute: {
    position: 'absolute',
  },
});
