import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { DURATION, fadeTo } from '../theme/motion';
import {
  CAMERA_PREVIEW_AVAILABLE,
  CameraPreview,
  type CameraStreamState,
} from './CameraPreview';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import {
  mediaAccess,
  recentPhotos,
  requestMediaAccess,
  type MediaAccess,
  type RecentPhoto,
} from '../lib/recentMedia';

/**
 * The grid's outer padding and the gap between cells, in dp.
 *
 * `PADDING = 2` and `GAP = 2` are Telegram's own attach-grid constants
 * (`ChatAttachAlertPhotoLayout.java:3976-3977`, read from the clone at
 * ~/references/telegram; measured facts only, no code copied — ADR-0025).
 * They are deliberately tiny: the tiles are meant to read as one sheet of
 * media with hairline seams, not as spaced cards.
 */
const PADDING = 2;
const GAP = 2;

/**
 * Cells per row: three in portrait, four when the display is wider than it is
 * tall (Telegram uses four for tablets and landscape,
 * `ChatAttachAlertPhotoLayout.java:3983-3990`).
 */
const COLS_PORTRAIT = 3;
const COLS_WIDE = 4;

/**
 * How many recent photos the strip asks for.
 *
 * Under partial access this is a ceiling that is rarely reached — the user has
 * selected a handful, not a library — so it is sized for the full-access case
 * that this app deliberately never requests, purely so the number is not the
 * thing that truncates. Two screens' worth of a horizontal strip is plenty, and
 * the cursor stops as soon as it has this many rather than reading to the end.
 */
const RECENT_LIMIT = 60;

interface Props {
  visible: boolean;
  /** The keyboard's height, so this panel and the emoji panel are interchangeable. */
  height: number;
  /** Open the camera for a capture. Owns its own permission flow. */
  onCamera: () => void;
  /** Open the system photo picker. Needs no permission. */
  onGallery: () => void;
  /** Whether the CAMERA permission is currently granted, so the tile knows. */
  cameraGranted: boolean;
  /**
   * Whether the dock's slide animation has finished and the tile surface is in
   * its final position.
   *
   * CameraX configures a capture session the moment `CameraPreview` mounts.
   * If the TextureView is still mid-travel its size is zero or clipped, and the
   * native layer logs "Unable to configure camera … not done within 5000ms"
   * while rendering a black tile. Verified on the API-36 emulator 2026-09-04.
   * Driven from the `shown`-tracking effect in Composer so the gate lifts as
   * soon as DOCK_DELAY_MS + medium1 have elapsed, not before.
   */
  slotSettled: boolean;
}

/**
 * The attach surface, docked in the same slot as the emoji panel.
 *
 * **Two deliberate departures from Telegram, both recorded.**
 *
 * 1. Telegram's attach surface is a TALL bottom sheet that dismisses the IME and
 *    opens at two fifths of the screen on a spring (stiffness 350, damping 0.75 —
 *    `ChatAttachAlert.java:5338-5346`). Ours is docked at keyboard height in the
 *    emoji panel's slot, so the viewport never moves and the keyboard is one tap
 *    away. That is the owner's decision (Amit, 2026-09-04) and the same model
 *    WhatsApp uses.
 *
 * 2. Telegram fills its grid with the user's actual photos, read straight from
 *    `MediaStore`. That needs `READ_MEDIA_IMAGES`, which Google Play treats as a
 *    restricted permission requiring a declaration — and a paid 1:1 chat app is
 *    the textbook rejection for that declaration, because the app ships the
 *    system picker and the policy allows the permission only where the system
 *    picker is insufficient. Confirmed with the owner rather than assumed
 *    (2026-09-04). That has NOT changed and READ_MEDIA_IMAGES is still removed
 *    in the manifest.
 *
 *    What changed on 2026-09-12 is that this note used to stop there, and the
 *    conclusion it drew — no real thumbnails, ever — was wider than its own
 *    premise. `READ_MEDIA_VISUAL_USER_SELECTED` (API 34+) is NOT on Play's
 *    restricted list, precisely because it grants only a subset the user picked
 *    by hand. So the panel now shows a strip of real recent photos where the
 *    user has shared some, with no declaration form and no restricted
 *    permission.
 *
 *    The accepted cost, stated plainly: requesting that permission WITHOUT
 *    READ_MEDIA_IMAGES means the system dialog offers no "Allow all", so the
 *    strip is always a user-chosen subset and never the whole library. The
 *    Photos tile is unchanged and remains the route to everything. On API 33 and
 *    below the permission does not exist and the panel is exactly what it was.
 *    See `RecentMediaPackage.kt` and the manifest comment.
 *
 * What IS taken from Telegram, unchanged: the grid arithmetic, the 2dp padding
 * and gap, three columns in portrait and four when wide, and the live camera
 * viewfinder occupying the first cell rather than a static icon.
 * https://developer.android.com/training/data-storage/shared/photopicker
 */
function AttachPanelView({
  visible,
  height,
  onCamera,
  onGallery,
  cameraGranted,
  slotSettled,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { width, height: winH } = useWindowDimensions();
  const cols = width > winH ? COLS_WIDE : COLS_PORTRAIT;

  /**
   * Telegram's own expression, unchanged:
   * `itemSize = (availableWidth - dp(PADDING * 2) - dp(GAP * 2)) / itemsPerRow`
   * (`ChatAttachAlertPhotoLayout.java:4000`).
   *
   * Note it subtracts exactly two gaps regardless of the column count, which is
   * why a four-column row is very slightly wider than three equal cells plus
   * three gaps would be. That is what the reference does, so it is what this
   * does; a "corrected" version would not match on a landscape device.
   */
  const cellSize = Math.floor((width - PADDING * 2 - GAP * 2) / cols);

  /**
   * The camera cell's height in REAL PIXELS, because the TextureView must be
   * given one.
   *
   * The tile stretches to the panel's full height now, and the obvious way to
   * express that — `StyleSheet.absoluteFill` on the preview — is the one thing
   * the note on `CameraPreview` below forbids, for a reason that is easy to
   * rediscover the hard way: a percentage resolves against a box that is itself
   * a percentage, the native view lands 0x0, a zero-size TextureView never gets
   * a surface, and CameraX opens the camera and then times out configuring the
   * capture session five seconds later with `TimeoutException: Future[...] is
   * not done within 5000 ms`. Which is precisely what this shipped as, briefly,
   * on 2026-09-12.
   *
   * So the height is computed the same way the width is: from the panel's own
   * measurements, in dp, handed to the native view as a number.
   */
  const cellHeight = Math.max(0, height - PADDING * 2);

  /*
   * Two rows of thumbnails would need a wrapping grid and a scroll container
   * that fights the panel's fixed height; one row of tall thumbnails fills the
   * same space with no wrapping and reads as a filmstrip, which is what it is.
   * Square-ish at 3:4, the aspect most phone photos already are.
   */
  const thumbW = Math.round(cellHeight * 0.75);

  /**
   * The camera is bound only while the panel is actually up AND the app is in
   * the foreground.
   *
   * A bound camera lights the OS camera-in-use indicator and drains battery, so
   * "mounted but hidden" is not good enough — the panel stays mounted for the
   * same reason the emoji panel does (so the swap costs a visibility flip, not a
   * rebuild), which means visibility alone cannot gate the hardware.
   * https://developer.android.com/media/camera/camerax/preview
   */
  const [foreground, setForeground] = useState(
    () => AppState.currentState === 'active',
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', s =>
      setForeground(s === 'active'),
    );
    return () => sub.remove();
  }, []);

  /**
   * Which camera the tile is showing. The native view has supported this since
   * it was written — `facing` unbinds the running session and opens the other
   * camera — but nothing ever changed it, so the capability sat unused behind a
   * hardcoded "back". It only became worth surfacing once the preview actually
   * streamed (see CameraTilePackage.kt, 2026-09-12).
   */
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const flip = useCallback(
    () => setFacing(f => (f === 'back' ? 'front' : 'back')),
    [],
  );

  const live = visible && slotSettled && foreground && cameraGranted && CAMERA_PREVIEW_AVAILABLE;

  /*
   * The placeholder's opacity, and the cross-fade that hides it.
   *
   * MOTION, per DESIGN.md's art direction:
   *
   *   Frequency. Opening the attach panel is an occasional action, not a
   *   hundred-times-a-day one, and this fade runs once per open. That is the
   *   tier with the largest budget, so `DURATION.base` rather than `fast` — a
   *   170ms fade on a picture appearing reads as a flicker, because the thing
   *   underneath and the thing on top are both substantial.
   *
   *   Ease-out, never ease-in, via `fadeTo`, which carries M3's
   *   emphasized-decelerate curve. The picture is ARRIVING; it should be at its
   *   most committed the instant it starts.
   *
   *   Opacity only. The obvious flourish — scaling the glyph down as it goes —
   *   is the `scale(0)` case the rules ban outright, and here it would also
   *   fight the live image, which does not scale.
   *
   * REVERSIBLE, and that is the reason this is a shared value driven by an
   * event rather than a one-shot `exiting` animation. Flipping the camera
   * unbinds and rebinds, so `streaming` goes false and true again; the
   * placeholder has to come back for the gap and leave again afterwards. An
   * exiting animation only knows how to leave once.
   *
   * NOT started on a timer. A capture session that fails to negotiate never
   * fires the event, and the correct behaviour then is for the glyph to stay
   * up forever. Hiding it optimistically after N milliseconds would put the
   * black tile back, which is the whole bug this tile has already had once.
   */
  const placeholderOpacity = useSharedValue(1);
  const onStreamStateChange = useCallback(
    (e: NativeSyntheticEvent<CameraStreamState>) => {
      placeholderOpacity.value = fadeTo(
        e.nativeEvent.streaming ? 0 : 1,
        DURATION.base,
      );
    },
    [placeholderOpacity],
  );
  const placeholderStyle = useAnimatedStyle(() => ({
    opacity: placeholderOpacity.value,
  }));

  /*
   * Back to the glyph whenever the preview is unmounted.
   *
   * `live` goes false when the panel closes or the app backgrounds, which
   * unmounts CameraPreview — and an unmounted view emits no IDLE on its way
   * out. Without this the opacity would still be 0 from the last session and
   * the next open would show an empty tile until frames arrived, which is the
   * original bug wearing a different hat.
   */
  useEffect(() => {
    if (!live) {
      placeholderOpacity.value = 1;
    }
  }, [live, placeholderOpacity]);

  const camera = useCallback(() => onCamera(), [onCamera]);
  const gallery = useCallback(() => onGallery(), [onGallery]);

  /*
   * Real recent thumbnails, under Android 14 PARTIAL access only.
   *
   * This is the answer to departure 2 in the header above, which said the
   * gallery could not be read at all. That was right about READ_MEDIA_IMAGES and
   * wrong to stop there: `READ_MEDIA_VISUAL_USER_SELECTED` (API 34+) is NOT on
   * Play's restricted list, because it only ever grants a subset the user picked
   * by hand. So the panel can show real photos without the declaration form the
   * note was avoiding.
   *
   * The trade is stated in `RecentMediaPackage.kt` and accepted: with
   * READ_MEDIA_IMAGES left out of the request, the system dialog has no "Allow
   * all", so this strip shows a user-chosen subset and never the whole library.
   * The Photos tile below is unchanged and remains the route to everything.
   *
   * State is re-read on every open, never cached, because the platform docs
   * forbid persisting it and a partial grant can lapse by itself.
   */
  const [access, setAccess] = useState<MediaAccess>('unsupported');
  const [photos, setPhotos] = useState<readonly RecentPhoto[]>([]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let active = true;
    void (async () => {
      const a = await mediaAccess();
      if (!active) {
        return;
      }
      setAccess(a);
      setPhotos(a === 'granted' ? await recentPhotos(RECENT_LIMIT) : []);
    })();
    return () => {
      active = false;
    };
  }, [visible]);

  /*
   * Both "grant" and "add more" — one control, because to Android they are the
   * same call. The docs require it to sit behind a deliberate press: "Create a
   * UI element in your app that the user must press before you re-request...
   * The user shouldn't be surprised to see the system dialog again."
   */
  const choosePhotos = useCallback(() => {
    void (async () => {
      const a = await requestMediaAccess();
      setAccess(a);
      setPhotos(a === 'granted' ? await recentPhotos(RECENT_LIMIT) : []);
    })();
  }, []);

  const strip = access === 'granted' && photos.length > 0;

  return (
    <View
      style={[styles.panel, { height }, visible ? null : styles.hidden]}
      pointerEvents={visible ? 'auto' : 'none'}
      testID="attach-panel">
      <View style={styles.grid}>
        {/* Cell 0 is the camera, as it is in Telegram's grid — a live
            viewfinder, not an icon standing in for one. It is a plain 1x1 cell
            there too (`checkCameraViewPosition` overlays the preview on the cell
            at position 0, `ChatAttachAlertPhotoLayout.java:3051`), so it is a
            square here. */}
        <Pressable
          onPress={camera}
          testID="attach-camera"
          accessibilityLabel="Take a photo"
          press="card"
          highlight="material"
          style={[styles.cell, styles.cameraCell, { width: cellSize }]}>
          {/*
            * The placeholder is ALWAYS mounted, and the preview is layered over
            * it — not an either/or.
            *
            * It used to be a ternary: live preview, or the glyph. That looked
            * correct and was not, because there is a third state the ternary
            * cannot express — mounted but not yet streaming. CameraX takes
            * 300ms–2s to negotiate a capture session, and when negotiation
            * fails it never streams at all (seen on an S22, 2026-09-12). In
            * both cases `live` is true, so the glyph branch is skipped and the
            * member is looking at an empty tile with a "Camera" label on it.
            *
            * Keeping the glyph underneath means the tile always has something
            * in it, and the camera simply covers it when frames start. That
            * needs PreviewView's own background to be transparent, which is a
            * one-line change on the native side — see CameraTilePackage.kt.
            *
            * It now CROSS-FADES rather than being covered. The native view
            * observes PreviewView.StreamState and emits `onStreamStateChange`,
            * so the exact frame the picture becomes visible is known instead of
            * guessed. That signal is only trustworthy because the native view
            * is in COMPATIBLE mode — see the note on `CameraStreamState`.
            *
            * The placeholder is still ALWAYS MOUNTED and still underneath. The
            * event is an improvement on the reveal, not a replacement for the
            * fallback: a session that fails to negotiate never fires the event,
            * and in that case the fade never starts and the glyph stays put,
            * which is exactly right.
            */}
          {/* Icon and label together, centred — the same composition as the
              Photos tile beside it, so the two read as a matched pair of large
              actions rather than one labelled box and one unlabelled one. The
              live preview covers this entirely once frames arrive, which is
              when the bottom-pinned label below takes over. */}
          <Animated.View
            style={[styles.placeholder, placeholderStyle]}
            pointerEvents="none">
            <Icon name="camera" size={TOKENS.icon.xl} color={theme.color.text.secondary} />
            <Text allowFontScaling={false} style={styles.galleryLabel}>
              Camera
            </Text>
          </Animated.View>
          {live ? (
            /*
             * Sized in absolute px, never a percentage or `absoluteFill`.
             *
             * `Pressable` hoists box properties onto its root AND leaves them on
             * its inner view, so a `100%` here resolves against a box that is
             * itself `100%` and the native view lands 0x0. A zero-size
             * TextureView never gets a surface, so CameraX opens the device and
             * then times out configuring the capture session — `onOpened()`
             * followed by "Unable to configure camera ... not done within 5000
             * ms", and a black tile with no error on screen. Measured on the API
             * 36 emulator, 2026-09-04. Same trap as the emoji grid's cells.
             */
            <CameraPreview
              facing={facing}
              onStreamStateChange={onStreamStateChange}
              style={[styles.preview, { width: cellSize, height: cellHeight }]}
            />
          ) : null}
          {/*
            * THE BOTTOM-PINNED LABEL IS GONE, and it is worth saying why rather
            * than leaving a reader to wonder.
            *
            * It existed so a viewfinder in a chat composer reads as a button
            * rather than as "you are being recorded" — a good reason. But it was
            * pinned to the cell, not to the preview, so it rendered in the one
            * state neither layer can see: `live` true and frames not arriving.
            * On the S22 that state is permanent (the capture session fails to
            * negotiate), and the tile showed "Camera" centred on the placeholder
            * AND "Camera" again at the bottom edge — one control, two labels,
            * and TalkBack reading both.
            *
            * The label now lives in the placeholder, so it is present exactly
            * when there is no picture and is covered by the picture when there
            * is one. That matches Telegram, whose viewfinder cell carries a
            * shutter affordance rather than standing text, and the control keeps
            * its `accessibilityLabel="Take a photo"` either way.
            *
            * Restoring a label OVER the live preview needs the thing this file
            * does not have: `PreviewView.StreamState` (IDLE/STREAMING) observed
            * natively and emitted to JS, which would also allow the cross-fade
            * from placeholder to first frame instead of the current cut. That is
            * the right follow-up, and it is a deliberate piece of work rather
            * than something to bolt onto a layout fix.
            * https://developer.android.com/reference/androidx/camera/view/PreviewView.StreamState
            */}
          {/*
            * The flip, only while there is a picture to flip.
            *
            * Offered as its own control rather than a long-press or a gesture:
            * this tile is already a button (it opens the full camera), so a
            * second hidden affordance on the same surface would be guesswork.
            * It sits top-right, away from the centred glyph and clear of the
            * thumb arc that reaches the Photos tile.
            *
            * Nested pressables: the outer cell opens the camera, this one does
            * not bubble up to it — `Pressable` stops the press at the inner
            * control, which is why the flip does not also fire a capture.
            */}
          {live ? (
            <Pressable
              onPress={flip}
              testID="attach-camera-flip"
              accessibilityLabel={
                facing === 'back'
                  ? 'Switch to the front camera'
                  : 'Switch to the back camera'
              }
              press="chip"
              highlight="dim"
              size={TOKENS.interaction.minTarget}
              style={styles.flip}>
              <Icon
                name="cameraFlip"
                size={TOKENS.icon.md}
                color={LIGHT.color.bg.base}
              />
            </Pressable>
          ) : null}
        </Pressable>

        {/*
          The rest of the row: real thumbnails when the user has shared some,
          and the single Photos tile otherwise — which is exactly what this was
          before, so the no-access path is unchanged.
        */}
        {strip ? (
          <View style={[styles.cell, styles.galleryCell, styles.stripCell]}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.strip}>
              {photos.map(p => (
                <Pressable
                  key={p.uri}
                  onPress={gallery}
                  accessibilityLabel="Choose this photo"
                  press="card"
                  highlight="material"
                  style={[styles.thumb, { width: thumbW, height: thumbW }]}>
                  <Image
                    source={{ uri: p.uri }}
                    style={styles.thumbImage}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                </Pressable>
              ))}
              {/*
                Trailing, not leading: the newest photo is the one the user
                almost always wants, so it gets the position nearest the thumb.
                These two are the escape hatches, in reach after a short scroll.
              */}
              <Pressable
                onPress={choosePhotos}
                testID="attach-more"
                accessibilityLabel="Select more photos to show here"
                press="card"
                highlight="material"
                style={[styles.thumb, styles.thumbAction, { width: thumbW, height: thumbW }]}>
                <Icon name="plus" size={TOKENS.icon.lg} color={theme.color.text.secondary} />
              </Pressable>
              <Pressable
                onPress={gallery}
                testID="attach-gallery"
                accessibilityLabel="Choose a photo"
                press="card"
                highlight="material"
                style={[styles.thumb, styles.thumbAction, { width: thumbW, height: thumbW }]}>
                <Icon name="image" size={TOKENS.icon.lg} color={theme.color.text.secondary} />
              </Pressable>
            </ScrollView>
          </View>
        ) : (
          <Pressable
            onPress={gallery}
            testID="attach-gallery"
            accessibilityLabel="Choose a photo"
            press="card"
            highlight="material"
            style={[styles.cell, styles.galleryCell]}>
            <Icon name="image" size={TOKENS.icon.xl} color={theme.color.text.secondary} />
            <Text allowFontScaling={false} style={styles.galleryLabel}>
              Photos
            </Text>
            {/*
              Offered only where partial access exists at all. On API 33 and
              below `access` is 'unsupported' and there is nothing to ask for,
              so the tile stays exactly as it was rather than advertising a
              capability the device does not have.
            */}
            {access === 'denied' ? (
              <Pressable
                onPress={choosePhotos}
                testID="attach-grant"
                accessibilityLabel="Show recent photos here"
                press="chip"
                highlight="dim"
                style={styles.grant}>
                <Text allowFontScaling={false} style={styles.grantLabel}>
                  Show recent
                </Text>
              </Pressable>
            ) : null}
          </Pressable>
        )}
      </View>
    </View>
  );
}

export const AttachPanel = memo(AttachPanelView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    /*
     * Painted on the app's own opaque surface, like the emoji panel and for the
     * same reason: it is standing in for the IME, and anything translucent shows
     * the transcript sliding behind what should read as a keyboard.
     */
    panel: {
      backgroundColor: t.color.bg.raised,
    },
    // Out of layout entirely while hidden — a zero height still costs a measure.
    hidden: { display: 'none' },
    /*
     * The grid FILLS the panel, rather than sitting as one short row at the top
     * of it.
     *
     * The panel is keyboard-height by design — it stands in the emoji panel's
     * slot so swapping between the two never moves the viewport (see this
     * component's header). But the row inside it was `cellSize` tall, a third of
     * that, so roughly 600px of bare surface sat underneath two small tiles and
     * the sheet read as broken rather than as deliberate (Amit, 2026-09-12: "it
     * looks very bad").
     *
     * Telegram can afford a short first row because a scrolling photo grid fills
     * the rest; we have no grid to put there and cannot read the gallery (see
     * departure 2 above). With exactly two actions, the honest answer is to let
     * the two actions have the room: a tall portrait viewfinder — which is the
     * natural aspect for a phone camera anyway — beside a full-height Photos
     * target. Nothing is invented, nothing is left empty.
     */
    grid: {
      flex: 1,
      flexDirection: 'row',
      padding: PADDING,
      gap: GAP,
    },
    cell: {
      overflow: 'hidden',
      borderRadius: TOKENS.radius.xs,
      backgroundColor: t.color.bg.sunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Keeps the reference's column width (so the tile still reads as cell 0 of
    // Telegram's grid) while taking the panel's full height.
    cameraCell: {
      alignSelf: 'stretch',
    },
    // Fills whatever the camera cell leaves, in both axes, so the row has no
    // dead edge and the panel has no dead floor.
    galleryCell: {
      flex: 1,
      alignSelf: 'stretch',
      gap: TOKENS.space['2xs'],
    },
    /*
     * The strip variant of the same cell. `Pressable`'s centring is undone
     * because a ScrollView must own its own layout, and the cell keeps the
     * gallery cell's flex so the row's arithmetic is untouched.
     */
    stripCell: {
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      padding: 0,
      overflow: 'hidden',
    },
    strip: {
      flexDirection: 'row',
      gap: GAP,
      alignItems: 'center',
    },
    thumb: {
      overflow: 'hidden',
      borderRadius: TOKENS.radius.xs,
      backgroundColor: t.color.bg.sunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbImage: {
      width: '100%',
      height: '100%',
    },
    // The two trailing actions, told apart from a photo by being flat surface.
    thumbAction: {
      backgroundColor: t.color.bg.base,
    },
    grant: {
      marginTop: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.xs,
      paddingVertical: TOKENS.space.hair,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.base,
    },
    grantLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
    },
    placeholder: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space['2xs'],
    },
    /*
     * The flip control. A dark disc so the glyph survives whatever the camera
     * happens to be pointed at — a bare white glyph disappears against a bright
     * frame, and this tile's content is by definition unknown. Same reason the
     * old viewfinder label carried a shadow.
     */
    flip: {
      position: 'absolute',
      top: TOKENS.space['2xs'],
      right: TOKENS.space['2xs'],
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    // Layered over the placeholder rather than replacing it, so the glyph shows
    // through until the TextureView actually has frames to paint.
    preview: {
      ...StyleSheet.absoluteFill,
    },
    galleryLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
    },
  });
