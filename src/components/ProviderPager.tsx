import React, { memo, useCallback, useEffect, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import PagerView, { type PagerViewProps } from 'react-native-pager-view';
import Animated, {
  useEvent,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * The horizontal pager under the Listener / Astrologer tabs (owner decision,
 * Amit 2026-09-26/27: "follow Bluesky's mechanics exactly").
 *
 * Adapted from Bluesky's `src/view/com/pager/Pager.tsx`, which is
 * `react-native-pager-view` — androidx.viewpager2 on Android — with its page
 * events handled by a Reanimated worklet. Same three pieces here:
 *
 *   1. `AnimatedPagerView = Animated.createAnimatedComponent(PagerView)`, so a
 *      `useEvent` worklet can be attached to the native view and receive
 *      `onPageScroll` on the UI thread.
 *   2. `onPageScroll` writes `position + offset` into a shared value. That is
 *      ViewPager2's `OnPageChangeCallback.onPageScrolled(position,
 *      positionOffset, …)`: "position: Position index of the first page
 *      currently being displayed. Page position+1 will be visible if
 *      positionOffset is nonzero. positionOffset: Value from [0, 1) indicating
 *      the offset from the page at position" (androidx viewpager2
 *      `ViewPager2.java`, `OnPageChangeCallback`). Their sum is a continuous
 *      page coordinate — 0.5 is halfway between the tabs — and it is the ONLY
 *      thing the tab indicator and labels read. No React render happens per
 *      frame: the value never leaves the UI thread while a finger is down.
 *   3. `onPageSelected` crosses to the JS thread ONCE per page change, via
 *      `scheduleOnRN`, so the screen can re-derive what depends on the settled
 *      category (the spotlight pick, `checked` on the tab). ViewPager2 fires it
 *      when the target is known, "Animation is not necessarily complete"
 *      (same file) — i.e. at release, not at settle, which is when the rest of
 *      the screen should start agreeing with the page.
 *
 * DEPARTURES from the reference, each for a reason that does not apply here:
 *
 *   - No `DrawerGestureRequireFail` / `useSetDrawerSwipeDisabled`. Bluesky has a
 *     swipe-open drawer that competes with the pager's first page; this app has
 *     no drawer.
 *   - No `dragState` shared value. Bluesky needs it to keep a horizontally
 *     SCROLLING tab bar in sync with the pager; these two tabs are fixed halves
 *     that never scroll, so nothing reads it.
 *   - The `didInit` guard is kept (see the worklet), though its stated cause is
 *     an iOS event, because it is also correct on Android and costs nothing.
 *
 * TAPS. `setPage(index)` is `ViewPager2.setCurrentItem(item, true)`: "will
 * perform a smooth animation from the current item to the new item". That
 * scroll emits the same `onPageScrolled` stream a drag does, so a tapped tab
 * moves the indicator with the page rather than on a timer of its own — the
 * indicator can never disagree with the content under it.
 *
 * Its timing is the platform's, and it is inside the UI budget: ViewPager2's
 * smooth scroll is RecyclerView's `LinearSmoothScroller`, 25ms per inch
 * (`MILLISECONDS_PER_INCH`) stretched by `1 / 0.3356` for its
 * `DecelerateInterpolator` (`calculateTimeForDeceleration`). One page of a
 * 1080px-wide window is ~192ms at 420dpi (the S22) and ~183ms at 440dpi (the
 * Redmi), on an ease-out curve. There is nothing here to tune and nothing to
 * gain by replacing it.
 *
 * REDUCED MOTION. Under the system "Remove animations" setting the tap uses
 * `setPageWithoutAnimation` — `setCurrentItem(item, false)`, "false to
 * transition immediately" — so the page and the indicator both jump in one
 * frame. RecyclerView's smooth scroll runs on its own `OverScroller`, not on a
 * `ValueAnimator`, so it would NOT honour the animator duration scale by
 * itself; asking for the instant path is the only way the setting reaches it.
 * A DRAG is not reduced: the content under a finger follows the finger, which
 * is direct manipulation rather than an animation, and the settle after
 * release is the platform's own fling.
 *
 * NESTED HORIZONTAL SCROLLERS. The Chats rail and the week's picks scroll
 * horizontally inside a page. "ViewPager2 does not natively support nested
 * scroll views in cases where the scroll view has the same orientation" —
 * https://developer.android.com/training/animation/vp2-migration#nested-scrollables
 * — and the page says the child must call `requestDisallowInterceptTouchEvent()`.
 * Android's `HorizontalScrollView` does exactly that when it starts dragging,
 * and it gets there first: ViewPager2 sets its RecyclerView to
 * `TOUCH_SLOP_PAGING` (`ViewPager2.java`, `setScrollingTouchSlop`), which is
 * the paging slop, twice the ordinary one the child uses. So a drag that starts
 * on the rail scrolls the rail; a drag anywhere else pages. A rail too short to
 * scroll does not claim the drag (`HorizontalScrollView` only intercepts when it
 * can scroll), so it pages as well. No wrapper is needed and none is added.
 *
 * `offscreenPageLimit={1}` keeps the neighbouring page attached and laid out.
 * ViewPager2's own docs: "If you have a small number of pages (3-4) that you can
 * keep active all at once, less time will be spent in layout for newly created
 * view subtrees as the user pages back and forth." Two pages, each a FlashList
 * with a header, is that case: without it the first swipe would lay out a whole
 * list in the middle of the drag.
 */

export interface ProviderPagerRef {
  /** Scroll to a page; instant under reduced motion. A member's tap. */
  setPage: (index: number) => void;
  /**
   * Go to a page with no scroll at all. For a page the SCREEN picks rather than
   * the member (Favourites opening on the tab that has someone in it): a
   * choice nobody made should not play as motion.
   */
  jumpTo: (index: number) => void;
}

interface Props {
  ref?: Ref<ProviderPagerRef>;
  initialPage: number;
  /** Written on the UI thread with `position + offset` for every scroll frame. */
  dragProgress: SharedValue<number>;
  /** JS thread, once per page change. */
  onPageSelected: (index: number) => void;
  testID?: string;
  children: ReactNode;
}

const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);
const MemoizedAnimatedPagerView = memo(AnimatedPagerView);

type PagerEvent = {
  position?: number;
  offset?: number;
  pageScrollState?: 'idle' | 'dragging' | 'settling';
};

export function ProviderPager({
  ref,
  initialPage,
  dragProgress,
  onPageSelected,
  testID,
  children,
}: Props) {
  const pagerView = useRef<PagerView>(null);
  const reducedMotion = useReducedMotion();
  /*
   * Bluesky's `didInit`: scroll events are ignored until the pager has
   * confirmed a selection, so a scroll report from before the initial page is
   * applied cannot drag the indicator to page 0 and back. A shared value rather
   * than a ref because it is written and read on the UI thread, inside the
   * worklet. On Android the first `onPageSelected` is guaranteed: ViewPager2
   * dispatches one when the RecyclerView is first populated ("Contract requires
   * us to fire onPageSelected as well", ScrollEventAdapter.java `onScrolled`).
   */
  const didInit = useSharedValue(false);

  useImperativeHandle(
    ref,
    () => ({
      setPage: (index: number) => {
        // A tap is the member's own move, like a drag: open the gate so the
        // FIRST tap of a session animates the indicator with the page
        // instead of jump-cutting (onPageScroll frames are dropped until then).
        didInit.set(true);
        if (reducedMotion) {
          pagerView.current?.setPageWithoutAnimation(index);
        } else {
          pagerView.current?.setPage(index);
        }
      },
      jumpTo: (index: number) => {
        // The screen's own move (Favourites opening on the tab that has
        // someone in it): its one scroll frame must reach the indicator.
        didInit.set(true);
        pagerView.current?.setPageWithoutAnimation(index);
      },
    }),
    [reducedMotion, didInit],
  );

  /*
   * The worklet below is built ONCE (`useEvent` without `rebuild`), so the JS
   * callback it schedules has to be a stable identity that always reaches the
   * latest `onPageSelected`. A ref behind a `useCallback([])` is that.
   */
  const onPageSelectedRef = useRef(onPageSelected);
  useEffect(() => {
    onPageSelectedRef.current = onPageSelected;
  }, [onPageSelected]);
  const notifySelected = useCallback((index: number) => {
    onPageSelectedRef.current(index);
  }, []);

  /*
   * Snap back onto a page when a drag ends parked between two.
   *
   * ViewPager2 settles through its PagerSnapHelper after a normal release, but
   * a CANCELLED touch (on the S22, 2026-09-27, an S Pen hover dispatched
   * ACTION_CANCEL mid-swipe) left it idle at offset 0.086 with no snap, so the
   * screen showed a sliver of the other page indefinitely. Reported IDLE with a
   * fractional position is that state by definition: nothing else leaves the
   * pager at rest off a page. Animated unless reduced motion asks otherwise,
   * matching a tap.
   */
  const snapToPage = useCallback(
    (index: number) => {
      if (reducedMotion) {
        pagerView.current?.setPageWithoutAnimation(index);
      } else {
        pagerView.current?.setPage(index);
      }
    },
    [reducedMotion],
  );
  const handler = useEvent<PagerEvent>(
    event => {
      'worklet';
      if (event.eventName.endsWith('onPageScroll')) {
        if (!didInit.get()) {
          return;
        }
        dragProgress.set((event.offset ?? 0) + (event.position ?? 0));
      } else if (event.eventName.endsWith('onPageSelected')) {
        didInit.set(true);
        scheduleOnRN(notifySelected, event.position ?? 0);
      } else if (event.eventName.endsWith('onPageScrollStateChanged')) {
        // A drag the user starts can never be the spurious pre-selection
        // report the gate exists for, so it opens the gate too. Measured on
        // the S22 (2026-09-27): this build never dispatches the initial
        // onPageSelected, so without this line the FIRST swipe after launch
        // moved the page while the tab indicator stayed put.
        if (event.pageScrollState === 'dragging') {
          didInit.set(true);
        } else if (event.pageScrollState === 'idle') {
          const at = dragProgress.get();
          const nearest = Math.round(at);
          if (Math.abs(at - nearest) > 0.001) {
            scheduleOnRN(snapToPage, nearest);
          }
        }
      }
    },
    ['onPageScroll', 'onPageSelected', 'onPageScrollStateChanged'],
  );

  return (
    <MemoizedAnimatedPagerView
      ref={pagerView}
      testID={testID}
      style={styles.pager}
      initialPage={initialPage}
      offscreenPageLimit={1}
      /*
       * The one cast in this file. `useEvent` returns a worklet handler that
       * Reanimated's own source "disguise[s] … as a simple function" and
       * unwraps inside `createAnimatedComponent` (hook/useEvent.ts), so its
       * declared type is the worklet's payload, not the `NativeSyntheticEvent`
       * the prop is typed for. Bluesky passes it the same way (`as any` in its
       * `usePagerHandlers`). It is registered for BOTH event names above; the
       * prop it rides on only tells Reanimated which view to attach to.
       */
      onPageScroll={handler as unknown as PagerViewProps['onPageScroll']}>
      {children}
    </MemoizedAnimatedPagerView>
  );
}

const styles = StyleSheet.create({
  pager: {
    flex: 1,
  },
});
