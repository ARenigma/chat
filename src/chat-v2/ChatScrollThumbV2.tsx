import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { EASE_OUT } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import {
  SCROLL_BAR_DEFAULT_DELAY_MS,
  SCROLL_BAR_FADE_DURATION_MS,
  chatV2ThumbGeometry,
} from './chatState';

/**
 * The transcript's scroll indicator, drawn by hand on the RIGHT edge.
 *
 * Why not the native one: FlashList inverts on Android with a 180° rotation
 * rather than `scaleY: -1` (PlatformHelper.android, for performance), and the
 * rotation carries the system scrollbar to the LEFT edge, upside down (S22,
 * 2026-10-03). So the native bar is turned off on the list and this one paints
 * where Android, Bluesky and WhatsApp all put it.
 *
 * It behaves like the platform's: it appears the instant the list moves and
 * fades out after the scroll stops, with ViewConfiguration's own numbers, a
 * 300ms delay and a 250ms fade (`getScrollDefaultDelay`,
 * `getScrollBarFadeDuration`;
 * https://developer.android.com/reference/android/view/ViewConfiguration).
 * Scrolling is a 100+ times a day surface, so per animate-expo it gets the
 * platform default and nothing more: no spring, no grow-on-touch.
 *
 * Geometry is the platform's too: thumb length = track × viewport ÷ content,
 * floored so a long transcript still has something to see. The list is
 * inverted, so offset 0 (the newest message) puts the thumb at the BOTTOM.
 * The track stops above the dock, which floats over the list's lower edge.
 *
 * Only `translateY` and `opacity` run per frame. The length is React state,
 * changing when the transcript grows rather than while it scrolls: an animated
 * `height` re-runs layout every frame, which animate-expo rules out.
 */
const THUMB_WIDTH = 4;

interface Props {
  offset: SharedValue<number>;
  content: SharedValue<number>;
  viewport: SharedValue<number>;
  /** 0 hidden, 1 shown; the caller animates it. */
  visible: SharedValue<number>;
  /** The dock's height, which covers the bottom of the list. */
  bottomInset: SharedValue<number>;
  /** `chatV2ThumbGeometry(...).length`, rounded, or 0 when nothing scrolls. */
  length: number;
}

function ChatScrollThumbV2View({
  offset,
  content,
  viewport,
  visible,
  bottomInset,
  length,
}: Props) {
  const styles = useStyles(makeStyles);
  const top = useDerivedValue(
    () =>
      chatV2ThumbGeometry({
        offset: offset.get(),
        content: content.get(),
        viewport: viewport.get(),
        track: viewport.get() - bottomInset.get(),
      })?.top ?? 0,
  );
  const thumb = useAnimatedStyle(() => ({
    opacity: visible.get(),
    transform: [{ translateY: top.get() }],
  }));
  if (length <= 0) {
    return null;
  }
  return (
    <View pointerEvents="none" style={styles.track}>
      <Animated.View style={[styles.thumb, { height: length }, thumb]} />
    </View>
  );
}

export const ChatScrollThumbV2 = memo(ChatScrollThumbV2View);

/**
 * The thumb's state and its scroll handler, for the list to call from its own
 * onScroll. Shown the moment the list moves; faded after the platform delay.
 */
export function useScrollThumb(bottomInset: SharedValue<number>) {
  const reduceMotion = useReducedMotion();
  const offset = useSharedValue(0);
  const content = useSharedValue(0);
  const viewport = useSharedValue(0);
  const visible = useSharedValue(0);
  const [length, setLength] = useState(0);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (fadeTimer.current !== null) {
        clearTimeout(fadeTimer.current);
      }
    },
    [],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      offset.set(contentOffset.y);
      content.set(contentSize.height);
      viewport.set(layoutMeasurement.height);
      const geometry = chatV2ThumbGeometry({
        offset: contentOffset.y,
        content: contentSize.height,
        viewport: layoutMeasurement.height,
        track: layoutMeasurement.height - bottomInset.get(),
      });
      setLength(geometry === null ? 0 : Math.round(geometry.length));
      visible.set(1);
      if (fadeTimer.current !== null) {
        clearTimeout(fadeTimer.current);
      }
      fadeTimer.current = setTimeout(() => {
        visible.set(
          reduceMotion
            ? 0
            : withTiming(0, {
                duration: SCROLL_BAR_FADE_DURATION_MS,
                easing: EASE_OUT,
              }),
        );
      }, SCROLL_BAR_DEFAULT_DELAY_MS);
    },
    [bottomInset, content, offset, reduceMotion, viewport, visible],
  );
  const props = useMemo(
    () => ({ offset, content, viewport, visible, bottomInset, length }),
    [offset, content, viewport, visible, bottomInset, length],
  );
  return { onScroll, props };
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    track: {
      position: 'absolute',
      top: 0,
      right: TOKENS.space.hair,
      width: THUMB_WIDTH,
      bottom: 0,
    },
    thumb: {
      width: THUMB_WIDTH,
      borderRadius: THUMB_WIDTH / 2,
      // The platform thumb's weight: a quiet grey that reads on the wallpaper
      // in both modes without competing with the bubbles.
      backgroundColor: t.color.text.tertiary,
    },
  });
