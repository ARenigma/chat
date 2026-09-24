import React, { memo, useCallback, useEffect, useRef } from 'react';
import {
  Image,
  Modal,
  PixelRatio,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  clamp,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { GESTURE, sheetIn, sheetOut } from '../theme/motion';
import { secureModal } from '../lib/windowChrome';
import { useAttachmentUrl } from '../api/attachments';
import { sizedStorageImageUri } from '../lib/storageImage';
import { Icon } from './Icon';
import { coverViewing } from '../lib/viewingConversation';
import { LoadingIndicator } from './LoadingIndicator';
import { Pressable } from './Pressable';
/*
 * The photo payload, from the transcript's own row model rather than from a
 * component. `rows.ts` is pure data — it imports no view — so the type can
 * travel here without the viewer and the cell forming a cycle, and there is
 * one definition of a photo instead of a second one kept in step by hand.
 */
import type { ChatV2ImageBody as ImageBody } from '../chat-v2/rows';

/**
 * The white the viewer's chrome is drawn in, in BOTH themes.
 *
 * Everything else in the app takes its ink from the theme, and this deliberately
 * does not: the backdrop is `bg/scrim`, which is `#000000` in light and dark
 * alike (asserted in theme.test.ts), so the surface under the close button is
 * black whatever the user's mode is. `text/onAccent` would have been the
 * theme-correct-looking choice and is DARK in dark mode, which would have put a
 * near-black glyph on a black disc.
 */
const CHROME_INK = '#FFFFFF';

/**
 * The wash behind the close glyph.
 *
 * `contain` letterboxes, so the button sits over the black backdrop on one photo
 * and over the photo itself on another. A dark disc is the only fill that works
 * for a white glyph in both cases, and it is the same value the transcript's
 * media body already puts behind the in-photo timestamp
 * (`ChatMessageCellV2`'s `mediaMeta`) so the two pieces of on-photo chrome
 * read as one family.
 */
const CHROME_WASH = 'rgba(0,0,0,0.35)';

/** The close glyph's drawn size inside the 48dp target `Pressable` guarantees. */
const CLOSE_GLYPH = 40;

/**
 * Resting zoom, and the ceiling a pinch can reach.
 *
 * The floor is 1 because 1 IS the fitted photo: `resizeMode="contain"` already
 * scales it so "both dimensions of the image will be equal to or less than the
 * corresponding dimension of the view"
 * (https://reactnative.dev/docs/image), so there is no smaller state worth
 * having and pinching below it would only put black bars around black.
 *
 * The ceiling is 3, and it is bounded by real pixels rather than by taste. The
 * viewer asks the CDN for the fitted box at `PixelRatio.get()` and never for
 * more pixels than the source object actually holds (see `fittedBox`), and
 * `sizedStorageImageUri` caps any single dimension at `MAX_TRANSFORM_PX`
 * (2500). Past roughly 3x the bitmap has no detail left to reveal and the user
 * is magnifying interpolation.
 *
 * CREATIVE, flagged per RULE 1: the docs sanction any ceiling — RNGH defines
 * `scale` as "The scale factor relative to the points of the two touches in
 * screen coordinates" and leaves the range to the app.
 * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pinch-gesture
 * 3 is the recommendation; the pixel argument above is why it is not 6.
 */
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/**
 * How far a tap may wander and still be a tap.
 *
 * It has to be set. RNGH's Android tap has NO distance limit by default
 * (`maxDist = MAX_VALUE_IGNORE`, TapGestureHandler.kt) and no pointer CEILING
 * either — the handler configures `minNumberOfPointers` and nothing above it —
 * so an unbounded tap composed alongside a pinch activates on the release of a
 * quick two-finger zoom (`currentMaxNumberOfPointers >= minNumberOfPointers`
 * is satisfied by two fingers) and closes the viewer mid-look.
 *
 * 8dp because that is the number the pan next to it activates on: RNGH's pan
 * sets `defaultMinDist = ViewConfiguration.get(context).scaledTouchSlop`
 * (PanGestureHandler.kt), and `ViewConfiguration`'s base touch slop — "distance
 * a touch can wander before we think the user is scrolling" — is 8dp.
 * https://developer.android.com/reference/android/view/ViewConfiguration#getScaledTouchSlop()
 * One number for both edges of the same decision, the way `REPLY_ACTIVATE`
 * serves the transcript's tap ceiling and pan activation together
 * (`src/chat-v2/ChatMessageCellV2.tsx`).
 */
const TAP_SLOP = 8;

/**
 * How much of the black backdrop survives at the point a release would dismiss.
 *
 * The scrim's opacity is the progress read-out for the drag: it runs from 1 down
 * to this value across exactly `GESTURE.dismissDistance` of the window height,
 * so the transcript beginning to show through IS the signal that letting go will
 * close the photo, and a drag that stops short of committing never reaches a
 * state the snap-back has to unwind.
 *
 * Sheet.tsx and SpotlightCard.tsx hold their scrims FLAT until 90% and then drop
 * them, for the opposite reason recorded there: a sheet's scrim reaching zero
 * mid-drag and then snapping back reads as the world flickering. A photo viewer
 * wants the page underneath to peek — that is what makes the picture feel lifted
 * off the thread rather than deleted from it.
 *
 * CREATIVE, flagged: the floor value is a choice. The coupling to
 * `GESTURE.dismissDistance` is not — two thresholds for one gesture is how a
 * progress cue ends up lying about what a release will do.
 */
const DRAG_SCRIM_FLOOR = 0.5;

/**
 * The dp box a photo occupies once it is fitted inside the window.
 *
 * Two callers with two different ceilings, which is why `maxScale` is a
 * parameter rather than baked in:
 *
 * 1. The CDN request, at `maxScale = 1 / density`. This asks for the pixels the
 *    screen can actually show. Android is explicit that a bitmap larger than its
 *    target buys nothing and costs memory: "an image with a higher resolution
 *    does not provide any visible benefit, but still takes up precious memory".
 *    The photos already in history were uploaded at full resolution (the
 *    retired composer set no maxWidth/maxHeight and the bucket allows 10MB),
 *    so a 4000x3000 photo would otherwise decode to roughly 48MB of
 *    ARGB_8888 for a 1080x2400 window. Sending is deferred, so the ceiling
 *    matters for RENDERING history rather than for anything new arriving.
 *    https://developer.android.com/topic/performance/graphics/load-bitmap
 *
 *    `1 / density` is the half that was missing, and it made this function do
 *    the opposite of the page it cites. `sizedStorageImageUri` multiplies the dp
 *    box by `PixelRatio.get()` to get the pixels it asks for, so an unclamped
 *    fit asked for `sourcePx * fit * density` — for a 400x300 photo on a 360dp
 *    density-3 window that is 1080x810, a 2.7x UPSCALE, more bytes over the
 *    network than the original file for no added detail. With the clamp the
 *    request tops out at `sourcePx * (1/density) * density = sourcePx` exactly.
 *
 * 2. The pan bounds, unclamped. `resizeMode="contain"` maps to Android's
 *    FIT_CENTER, which scales a small photo UP to fit, so the box the user can
 *    actually drag around is the pure fit — the same arithmetic without the
 *    pixel ceiling.
 *
 * The box keeps the source's aspect ratio in both cases. `sizedStorageImageUri`
 * asks Supabase for `resize=cover`, and a cover fit into a box of the SAME
 * aspect is a contain fit: there is nothing to crop. Integer rounding can leave
 * a sub-pixel difference, which the transform absorbs as at most one row or
 * column, never a visible crop.
 * https://supabase.com/docs/guides/storage/serving/image-transformations
 */
function fittedBox(
  image: ImageBody,
  winW: number,
  winH: number,
  maxScale = Number.POSITIVE_INFINITY,
): { width: number; height: number } {
  if (image.width <= 0 || image.height <= 0) {
    return { width: winW, height: winH };
  }
  const scale = Math.min(winW / image.width, winH / image.height, maxScale);
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
}

/**
 * One photo, full screen, over everything.
 *
 * Hosted by `ChatScreenV2` rather than by the bubble that opens it. A Modal
 * declared inside a FlashList cell dies with the cell when the list recycles
 * it, and the transcript recycles while a paid session is delivering
 * messages, so the viewer would vanish mid-look through no action of the
 * user's.
 *
 * ------------------------------------------------------------------------
 * There is no save, download, share or forward control here, and there must
 * never be one.
 * ------------------------------------------------------------------------
 * A photo lives in the thread it was sent to. That is a trust position on a paid
 * 1:1 product, and the platform makes it the cheap one: a save-to-gallery is a
 * MediaStore write, which below API 29 needs WRITE_EXTERNAL_STORAGE (minSdk here
 * is 24) and AndroidManifest.xml declares no storage permission at all
 * (https://developer.android.com/training/data-storage/shared/media), while
 * sending the image itself needs ACTION_SEND with EXTRA_STREAM over a
 * FileProvider (https://developer.android.com/training/sharing/send), which this
 * app does not have. Every route reachable from JavaScript alone is therefore a
 * credential leak rather than a save. Enforced by __tests__/chatSurface.test.ts.
 *
 * ------------------------------------------------------------------------
 * The gestures, and why they are composed the way they are
 * ------------------------------------------------------------------------
 * Three recognisers, in the shape RNGH's own gallery example uses: the
 * `useSimultaneousGestures` page composes `usePanGesture`, `usePinchGesture` and
 * `useRotationGesture` for exactly this — a gallery where one photo can be
 * zoomed, rotated and dragged at once.
 * https://docs.swmansion.com/react-native-gesture-handler/docs/composition/use-simultaneous-gestures
 *
 *   useCompetingGestures( useSimultaneousGestures(pinch, pan), tap )
 *
 * Simultaneous because a pinch and a pan must run together — that is what lets a
 * finger keep dragging a photo while the other two are still spreading it: "All
 * of the provided gestures can activate at the same time. Activation of one will
 * not cancel the other."
 *
 * Competing for the tap, because the tap is the only one of the three whose
 * intent is mutually exclusive with the others: "Only one of the provided
 * gestures can become active at the same time. The first gesture to become
 * active will cancel the rest of the gestures." A tap cannot activate before a
 * drag or a zoom (RNGH's tap resolves on the last finger UP), so competing means
 * the moment either continuous gesture activates the tap is cancelled and cannot
 * also close the viewer on release.
 * https://docs.swmansion.com/react-native-gesture-handler/docs/composition/use-competing-gestures
 *
 * The composition is nested rather than flat, and that is load-bearing: the
 * relation is all-to-all WITHIN a Simultaneous node, so a flat
 * `useSimultaneousGestures(pinch, pan, tap)` would make the tap simultaneous
 * with the pinch — see TAP_SLOP for what that costs. Nesting it under a
 * competing node keeps the pinch/pan pair simultaneous with each other and
 * leaves the tap simultaneous with nothing. `traverseAndConfigureRelations`
 * reaches those three relation sets by adding a Simultaneous child's tags to the
 * live set on the way in and deleting them on the way out, and by removing a
 * leaf's own tag before descending so nothing is simultaneous with itself
 * (v3/detectors/utils.ts).
 *
 * ------------------------------------------------------------------------
 * The hooks, not the `Gesture.*` builder
 * ------------------------------------------------------------------------
 * RNGH 3 deprecates the whole builder: the installed 3.2.1 marks `Gesture`
 * itself "@deprecated `Gesture` builder API is deprecated and will be removed in
 * a future version of Gesture Handler. Please migrate to the new, hook-based
 * API." (handlers/gestures/gestureObjects.d.ts:14) and names a hook for every
 * member. The migration is mechanical and the guide states each rule:
 * modifiers become config keys (`.minDistance(25)` -> `minDistance: 25`), and
 * "Three callbacks have been renamed: `onStart` -> `onActivate`, `onEnd` ->
 * `onDeactivate`, and `onTouchesCancelled` -> `onTouchesCancel`."
 * https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/
 *
 * The one place a rename is not enough is the end callbacks, so it is written
 * out at each `onDeactivate` below: "In RNGH2, `onEnd` and `onFinalize` received
 * a second `success` boolean parameter. In RNGH3, this has been replaced with a
 * `canceled` property on the event object itself. Note that the logic is
 * inverted — `canceled: true` corresponds to the old `success: false`." Firing
 * conditions are unchanged: v3's `onDeactivate` runs only when `oldState ===
 * State.ACTIVE`, exactly the guard legacy `onEnd` had
 * (v3/hooks/callbacks/eventHandler.ts vs handlers/gestures/eventReceiver.ts).
 *
 * Tap-to-dismiss is an RNGH `useTapGesture` and no longer an RN `Pressable`, for
 * two reasons. It has to be inside the composition to compete properly, and the
 * `Pressable` it replaces was the second node claiming the "Close photo" label:
 * our `Pressable` always sets `accessibilityRole` (defaulting to `button`), and
 * `ReactAccessibilityDelegate.setDelegate` installs its delegate for any view
 * carrying an `accessibility_role` tag, so `hasContentToAnnounce` was true and
 * `info.contentDescription = getTalkbackDescription(...)` ran on a view whose
 * label duplicated the real button's. The stage carries a `testID` and nothing
 * else now: `react_test_id` does install the delegate, but it only sets
 * `info.viewIdResourceName` and does not make the view speak, so the close
 * button below is the single node with that label.
 */
function MediaViewerView({
  image,
  onClose,
}: {
  image: ImageBody | null;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  // The viewer is a separate Dialog window, so the activity's FLAG_SECURE does
  // not reach it — a photo opened full-screen would be screenshot-capturable.
  // Secure the dialog window on show (see src/lib/windowChrome.ts). No-op except
  // on a screenshot-blocking build.
  const modalRef = useRef<Modal>(null);
  const density = PixelRatio.get();

  /*
   * The same react-query key the bubble used (`['attachment-url', path]`, stale
   * for just under the signed URL's TTL), so opening the viewer reads the
   * credential the bubble already minted instead of signing a second one. Null
   * while there is no photo, and null for a local pick that has not uploaded
   * yet: that file is already on the device.
   */
  const { data: signedUrl } = useAttachmentUrl(
    image === null || image.localUri !== undefined ? null : image.path,
  );
  const source = image?.localUri ?? signedUrl;
  const box = image === null ? null : fittedBox(image, winW, winH, 1 / density);
  const uri =
    source === undefined || box === null
      ? undefined
      : image?.localUri !== undefined
        ? // A local pick came out of the picker at device resolution already and
          // is not on the CDN at all, so there is no transform to ask for.
          source
        : // Message media is never a `clay:` sentinel, so this never narrows to
          // null in practice; undefined keeps <Image> happy either way.
          (sizedStorageImageUri(source, box.width, box.height, density, 90) ??
          undefined);

  /*
   * Half-extents of the photo as `contain` actually PAINTS it (no pixel
   * ceiling — see fittedBox case 2), which is what bounds a pan while zoomed.
   * Plain numbers rather than shared values because the gesture configs below
   * are fresh object literals on every render — `useClonedAndRemappedConfig`
   * memoises on the config identity, so a new literal re-runs it and the
   * worklets close over the current pair (v3/hooks/utils/configUtils.ts). The
   * STAGE size still goes through shared values, because that one is measured
   * (see `measure`).
   */
  const drawn = image === null ? null : fittedBox(image, winW, winH);
  const halfW = (drawn?.width ?? winW) / 2;
  const halfH = (drawn?.height ?? winH) / 2;

  // Zoom, content offset while zoomed, and the dismiss drag. Three separate
  // values on purpose: the dismiss drag has to fade the scrim while the content
  // offset must not.
  const scale = useSharedValue(MIN_ZOOM);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const dragY = useSharedValue(0);
  // Content offset at the moment a pan begins, so a zoomed pan accumulates from
  // where the last one left off rather than jumping to the origin.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  /*
   * Stage size, read inside worklets.
   *
   * Through shared values and via onLayout for the reason SpotlightCard.tsx
   * records: gesture worklets must read layout through a shared value, and React
   * state captured when the gesture is built can stay stale on Android. It
   * matters more here than there — `focalX`/`focalY` are reported in the
   * coordinate space of the view the handler is attached to, so the anchor
   * arithmetic below needs THAT view's centre, not the window's. Seeded from the
   * window so the first frame is never a divide by a zero-sized stage.
   *
   * Under the hooks the handler is attached to the detector wrapper rather than
   * to this view, and the stage is still the right frame to measure: the
   * wrapper carries no user transform, so `GestureHandler.coordinateView`
   * descends into it when it has exactly one child and reports coordinates
   * against the visible child — "the same coordinate space V2 and the V3
   * VirtualGestureDetector report in" (android/.../core/GestureHandler.kt). The
   * detector view is also `display: 'contents'` and so takes no part in layout
   * (v3/detectors/common.ts), which is why `onLayout` here still measures the
   * full window.
   */
  const stageW = useSharedValue(winW);
  const stageH = useSharedValue(winH);

  const measure = useCallback(
    (e: LayoutChangeEvent) => {
      stageW.value = e.nativeEvent.layout.width;
      stageH.value = e.nativeEvent.layout.height;
    },
    [stageW, stageH],
  );

  // Full screen: a chat under the viewer is not being looked at, so its
  // messages must reach the person as a banner, not be dropped as on screen.
  const open = image !== null;
  useEffect(() => (open ? coverViewing() : undefined), [open]);

  // The viewer is memoised and stays MOUNTED with `image === null` between
  // looks, so a photo closed at 3x would reopen at 3x. Reset on every change of
  // subject, the same way SpotlightCard resets its sheet position on `visible`.
  useEffect(() => {
    scale.value = MIN_ZOOM;
    tx.value = 0;
    ty.value = 0;
    dragY.value = 0;
    startX.value = 0;
    startY.value = 0;
  }, [image, scale, tx, ty, dragY, startX, startY]);

  /*
   * Zoom about the point between the fingers.
   *
   * `onUpdate` carries `scaleChange`, "The incremental change in scale since the
   * last event frame. This value represents the ratio of the current scale to
   * the previous scale, rather than the total accumulated scale of the gesture",
   * and that ratio is what makes the anchor arithmetic incremental: no saved
   * origin scale, no drift when the clamp bites mid-gesture. There is no
   * `onChange` to reach for any more — "`onChange` callback has been removed,
   * and its functionality has been integrated into `onUpdate`. You can now
   * access `change*` properties in `onUpdate` callback"
   * (docs/guides/upgrading-to-3/), which holds here because
   * `transformPinchProps` installs the `changeEventCalculator` unconditionally
   * (v3/hooks/gestures/pinch/usePinchGesture.ts).
   *
   * The anchor. A content point p is drawn at `q = centre + t + s*p`, so holding
   * the point under the focal fixed across a scale change of k = s1/s0 gives
   *
   *     t1 = t0*k + u*(1 - k),   u = focal - stage centre
   *
   * `focalX`/`focalY` are documented as "Position expressed in points along X
   * axis of center anchor point of gesture" and `scale` as "The scale factor
   * relative to the points of the two touches in screen coordinates". The same
   * page is explicit that the focal point must only be read after activation:
   * "When implementing pinch based on focal point, make sure to use it after the
   * gesture had activated, i.e. in `onActivate` or `onUpdate` callbacks" — which
   * is where this reads it, never in `onBegin`.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pinch-gesture
   */
  const pinch = usePinchGesture({
    onActivate: () => {
      // A pinch started mid-dismissal cancels the dismissal rather than zooming
      // a photo that is halfway off the screen.
      dragY.value = sheetIn();
    },
    onUpdate: e => {
      const next = clamp(scale.value * e.scaleChange, MIN_ZOOM, MAX_ZOOM);
      const k = next / scale.value;
      const ux = e.focalX - stageW.value / 2;
      const uy = e.focalY - stageH.value / 2;
      tx.value = tx.value * k + ux * (1 - k);
      ty.value = ty.value * k + uy * (1 - k);
      scale.value = next;
    },
    onDeactivate: () => {
      // Zooming back out can leave the picture parked outside its own new
      // bounds; at MIN_ZOOM the bounds are zero, so this is also what returns a
      // fully-unzoomed photo to dead centre.
      const maxX = Math.max(0, halfW * scale.value - stageW.value / 2);
      const maxY = Math.max(0, halfH * scale.value - stageH.value / 2);
      tx.value = sheetOut(clamp(tx.value, -maxX, maxX));
      ty.value = sheetOut(clamp(ty.value, -maxY, maxY));
    },
  });

  /*
   * One drag doing two jobs, decided by whether the photo is zoomed.
   *
   * `maxPointers: 1` is what keeps it out of the pinch's way, and on Android it
   * is stronger than the JS docs promise: PanGestureHandler.kt handles
   * ACTION_POINTER_DOWN with `pointerCount > maxPointers` by CANCELLING an
   * already-active pan, not merely failing one that has not activated. So the
   * instant a second finger lands the drag stops and the zoom takes over, and
   * the two cannot both move the photo. `averageTouches` is therefore moot —
   * that flag exists to change Android's default of calculating "translation
   * values based on the position of the leading pointer" to "the averaged
   * position of all active pointers", and this pan is single-pointer by
   * construction.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pan-gesture
   */
  const pan = usePanGesture({
    maxPointers: 1,
    onActivate: () => {
      startX.value = tx.value;
      startY.value = ty.value;
    },
    onUpdate: e => {
      if (scale.value > MIN_ZOOM) {
        const maxX = Math.max(0, halfW * scale.value - stageW.value / 2);
        const maxY = Math.max(0, halfH * scale.value - stageH.value / 2);
        tx.value = clamp(startX.value + e.translationX, -maxX, maxX);
        ty.value = clamp(startY.value + e.translationY, -maxY, maxY);
        return;
      }
      // At rest: downward is free and dismisses, upward is resisted. The same
      // asymmetry SpotlightCard's sheet uses, for the same reason — a photo
      // cannot be dragged up to anywhere, so the third makes the ceiling felt
      // rather than hit.
      dragY.value = e.translationY > 0 ? e.translationY : e.translationY / 3;
    },
    onDeactivate: e => {
      // `e.canceled` is true when the gesture was CANCELLED or FAILED
      // (v3/hooks/callbacks/eventHandler.ts sets it from
      // `state === FAILED || state === CANCELLED`), which is exactly the
      // second-finger case above: the drag is abandoned, so settle it instead of
      // reading a dismissal out of wherever the finger happened to be. This is
      // the old `onEnd(e, success)` with the sense flipped — "the logic is
      // inverted — `canceled: true` corresponds to the old `success: false`"
      // (docs/guides/upgrading-to-3/).
      if (e.canceled || scale.value > MIN_ZOOM) {
        dragY.value = sheetIn();
        return;
      }
      // Distance OR velocity, both from the gesture tokens: distance alone
      // punishes a fast flick and velocity alone punishes a slow deliberate
      // drag (design/tokens.json, motion.gesture.note).
      const far = dragY.value > stageH.value * GESTURE.dismissDistance;
      const fast = e.velocityY > GESTURE.dismissVelocity;
      if (far || fast) {
        dragY.value = sheetOut(stageH.value, e.velocityY);
        runOnJS(onClose)();
        return;
      }
      dragY.value = sheetIn(e.velocityY);
    },
  });

  /*
   * Tap anywhere to close, which is what the reference app's viewer does. Bounded by
   * TAP_SLOP, and competing with the other two — see the composition note on the
   * component.
   *
   * `onDeactivate` and not `onActivate`, so a tap that activated and was then
   * cancelled by the pinch/pan pair cannot close the viewer: the end event
   * carries `canceled`, and only an uncancelled one is a real tap.
   */
  const tap = useTapGesture({
    maxDistance: TAP_SLOP,
    onDeactivate: e => {
      if (!e.canceled) {
        runOnJS(onClose)();
      }
    },
  });

  const composed = useCompetingGestures(
    useSimultaneousGestures(pinch, pan),
    tap,
  );

  const photoStyle = useAnimatedStyle(() => ({
    // Listed translate-then-scale, which is the order the maths above assumes:
    // RN composes the array left to right, so the point p lands at t + s*p.
    transform: [
      { translateX: tx.value },
      { translateY: ty.value + dragY.value },
      { scale: scale.value },
    ],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      dragY.value,
      [0, stageH.value * GESTURE.dismissDistance],
      [1, DRAG_SCRIM_FLOOR],
      'clamp',
    ),
  }));

  return (
    <Modal
      ref={modalRef}
      onShow={() => secureModal(modalRef)}
      visible={image !== null}
      transparent
      animationType="fade"
      hardwareAccelerated
      /*
       * BOTH translucency props, not one. React Native documents
       * `navigationBarTranslucent` as needing `statusBarTranslucent` set too:
       * "the navigationBarTranslucent prop determines whether your modal should
       * go under the system navigation bar. However, statusBarTranslucent also
       * needs to be set to true". Without the pair the dialog's content view is
       * laid out inside the system bars and the photo stops short of them, which
       * is wrong in an app that is edge-to-edge everywhere else.
       * https://reactnative.dev/docs/modal
       */
      statusBarTranslucent
      navigationBarTranslucent
      /*
       * `onRequestClose` is marked Required on Android and "is called when the
       * user taps the hardware back button on Android". It is also the ONLY back
       * path here, and deliberately so: the same page says "because of this
       * required prop, be aware that BackHandler events will not be emitted as
       * long as the modal is open", which is exactly the behaviour the viewer
       * needs. App.tsx owns the single BackHandler subscription that feeds
       * src/lib/backGuard.ts, so while this window is up the chat's session
       * guard cannot fire and back dismisses the photo instead of raising
       * "End session and leave?". A useBackGuard() here would be dead code that
       * looked like a safety net.
       * https://reactnative.dev/docs/modal
       */
      onRequestClose={onClose}>
      {/*
        * A second GestureHandlerRootView, inside the Modal. Required on Android:
        * each RN Modal is its own native window, so the root view installed at
        * App.tsx is not an ancestor of anything in here and a gesture built
        * without this is recognised by nobody. Sheet.tsx and SpotlightCard.tsx
        * carry the same wrapper for the same reason, and contract.test.ts pins
        * the rule.
        */}
      <GestureHandlerRootView style={styles.host}>
        {/* The backdrop, separated from `host` so the drag can fade it. See
            DRAG_SCRIM_FLOOR. `bg/scrim` is #000000 in both themes, so this is
            opaque black either way; not multiplied by INTERACTION.scrim,
            because a photo viewer is not a sheet dim and letting the transcript
            show through at rest would compete with the picture. */}
        <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
        <GestureDetector gesture={composed}>
          <View testID="viewer-stage" style={styles.stage} onLayout={measure}>
            {uri !== undefined ? (
              <Animated.View style={[styles.frame, photoStyle]}>
                {/*
                  * `contain` and not the bubble's `cover`: "scale the image
                  * uniformly (maintain the image's aspect ratio) so that both
                  * dimensions (width and height) of the image will be equal to
                  * or less than the corresponding dimension of the view". The
                  * whole photo is the point of opening it.
                  * https://reactnative.dev/docs/image
                  */}
                <Image
                  testID="viewer-image"
                  source={{ uri }}
                  style={styles.photo}
                  resizeMode="contain"
                  accessible
                  accessibilityLabel="Photo"
                />
              </Animated.View>
            ) : (
              <LoadingIndicator color={CHROME_INK} />
            )}
          </View>
        </GestureDetector>
        {/*
          * Padded out of the status bar by the system-bar inset, because the
          * window is edge-to-edge: system bar insets "are best used to move or
          * pad views in your app that are tappable and that must not be visually
          * obscured by the system bars", and this is the only tappable control
          * on the screen.
          * https://developer.android.com/develop/ui/views/layout/edge-to-edge
          */}
        <View
          style={[styles.closeSlot, { top: insets.top + TOKENS.space.xs }]}
          pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            testID="viewer-close"
            accessibilityLabel="Close photo"
            press="none"
            onColor={CHROME_INK}
            size={CLOSE_GLYPH}
            style={styles.close}>
            <Icon name="close" size={TOKENS.icon.md} color={CHROME_INK} />
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export const MediaViewer = memo(MediaViewerView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // No fill of its own: the backdrop is the animated `scrim` below it, so a
    // drag can fade it without fading the photo with it.
    host: {
      flex: 1,
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: t.color.bg.scrim,
    },
    stage: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The transformed box. Separate from `stage` so the gesture target stays
    // window-sized while the picture inside it moves and scales — `focalX` and
    // `focalY` are reported against the handler's view, and a view that moved
    // under the fingers would report a focal point in a shifting frame.
    frame: {
      width: '100%',
      height: '100%',
    },
    photo: {
      width: '100%',
      height: '100%',
    },
    // `top` is supplied at runtime from the safe-area inset; only the leading
    // edge is fixed here.
    closeSlot: {
      position: 'absolute',
      left: TOKENS.space.xs,
    },
    close: {
      width: CLOSE_GLYPH,
      height: CLOSE_GLYPH,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: CHROME_WASH,
    },
  });
