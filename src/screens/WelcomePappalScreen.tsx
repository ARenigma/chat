import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { DURATION, STAGGER, fadeTo, springTo } from '../theme/motion';

interface Props {
  onDone: () => void;
}

const TITLE = 'Welcome to Pappal';
const TOTAL_MS = 3000;

function WelcomeLetter({
  letter,
  index,
  start,
  style,
}: {
  letter: string;
  index: number;
  start: boolean;
  style: { letter: object; spacer: object };
}) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!start) {
      return;
    }
    scale.value = withDelay(index * STAGGER.row, springTo(1, 'gentle'));
    opacity.value = withDelay(TOTAL_MS - DURATION.base, fadeTo(0, DURATION.base));
  }, [start, index, scale, opacity]);

  const animated = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (letter === ' ') {
    return <Text style={style.spacer}> </Text>;
  }

  return (
    <Animated.Text allowFontScaling={false} style={[style.letter, animated]}>
      {letter}
    </Animated.Text>
  );
}

export function WelcomePappalScreen({ onDone }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [started, setStarted] = React.useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true));
    const done = setTimeout(() => onDone(), TOTAL_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.row}>
        {TITLE.split('').map((ch, i) => (
          <WelcomeLetter
            key={`${ch}-${i}`}
            letter={ch}
            index={i}
            start={started}
            style={styles}
          />
        ))}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.lg,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    letter: {
      fontSize: 28,
      lineHeight: 34,
      fontFamily: 'Geist-Regular',
      color: t.color.text.primary,
    },
    spacer: {
      width: 8,
    },
  });
