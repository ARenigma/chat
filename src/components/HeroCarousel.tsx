/**
 * A centred hero carousel: one focused card, a peek of the previous AND the
 * next, and no end in either direction.
 *
 * Amit, 2026-09-06: "hero in middle and both sides peek and endless rotation".
 *
 * Departure from M3, deliberate and stated. Android's hero variant is "one
 * large image to focus on and provides a peek of what's next" — a single
 * trailing peek, aligned to the start. This centres the card and peeks both
 * ways, which reads as a rotating strip rather than a list you are at the front
 * of. It keeps the rest of the hero contract: one large item, snapping, and
 * item widths derived from the column rather than fixed dp.
 *
 * Endless is a swipe that never stops, not a timer. The strip holds three
 * copies of the list and jumps back a whole copy once a swipe settles — the
 * focused card is identical either side of that jump, so nothing moves on
 * screen. There is deliberately NO auto-advance: the component this project
 * banned (WordCarousel) advanced itself, and a strip that moves under a
 * stationary finger is how it ended up running backwards through three green
 * builds.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { TOKENS } from '../theme/tokens';
import { SCROLL_PHYSICS } from '../lib/scroll';
import {
  heroCanLoop,
  heroInitialOffset,
  heroInset,
  heroItemWidth,
  heroPitch,
  heroRecentre,
  heroSlots,
} from '../lib/carousel';

/** What each neighbour shows, in dp. Enough to read as a card, not as a stripe. */
export const HERO_PEEK = 32;

interface Props<T> {
  items: readonly T[];
  /** The column the strip sits in; the card width is derived from it. */
  columnWidth: number;
  keyOf: (item: T) => string;
  render: (item: T, width: number) => React.ReactNode;
  testID?: string;
}

export function HeroCarousel<T>({ items, columnWidth, keyOf, render, testID }: Props<T>) {
  const scrollRef = useRef<ScrollView>(null);
  const gap = TOKENS.space.xs;
  const itemWidth = heroItemWidth(columnWidth, HERO_PEEK, gap);
  const pitch = heroPitch(itemWidth, gap);
  const inset = heroInset(columnWidth, itemWidth);
  const looping = heroCanLoop(items.length);

  // Three copies when it can loop, one when it cannot: a single card wrapping
  // to itself is a still image with extra work.
  const slots = useMemo(
    () => (looping ? heroSlots(items.length) : items.map((_, i) => ({ key: `0-${i}`, index: i }))),
    [looping, items],
  );

  const start = looping ? heroInitialOffset(items.length, pitch) : 0;

  // Park in the middle copy before the first frame the member sees, so the
  // strip never appears to start at its beginning and then jump.
  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      if (looping) {
        scrollRef.current?.scrollTo({ x: start, animated: false });
      }
    },
    [looping, start],
  );

  const onSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!looping) {
        return;
      }
      const next = heroRecentre(e.nativeEvent.contentOffset.x, pitch, items.length);
      if (next !== null) {
        scrollRef.current?.scrollTo({ x: next, animated: false });
      }
    },
    [looping, pitch, items.length],
  );

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={pitch}
      snapToAlignment="start"
      disableIntervalMomentum
      onLayout={onLayout}
      onMomentumScrollEnd={onSettled}
      // A slow drag that never gains momentum ends here instead, so a gentle
      // swipe into the outer copy still gets recentred.
      onScrollEndDrag={onSettled}
      {...SCROLL_PHYSICS}
      contentContainerStyle={{ paddingHorizontal: inset, gap }}
      testID={testID}>
      {slots.map(slot => {
        const item = items[slot.index];
        return item === undefined ? null : (
          <View key={`${slot.key}-${keyOf(item)}`} style={{ width: itemWidth }}>
            {render(item, itemWidth)}
          </View>
        );
      })}
    </ScrollView>
  );
}
