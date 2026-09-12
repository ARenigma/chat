import React, { memo, useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { CAMERA_PREVIEW_AVAILABLE, CameraPreview } from './CameraPreview';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

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
 *    the textbook rejection for that declaration. So cell 0 is the live camera,
 *    exactly as Telegram has it, and the rest of the row is a single Photos tile
 *    that opens Android's system photo picker, which needs no permission at all.
 *    Confirmed with the owner rather than assumed (2026-09-04).
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

  const live = visible && slotSettled && foreground && cameraGranted && CAMERA_PREVIEW_AVAILABLE;

  const camera = useCallback(() => onCamera(), [onCamera]);
  const gallery = useCallback(() => onGallery(), [onGallery]);

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
            * one-line change on the native side — see CameraTilePackage.kt,
            * which also records why the explicit StreamState signal was not
            * used for a proper cross-fade.
            */}
          {/* Icon and label together, centred — the same composition as the
              Photos tile beside it, so the two read as a matched pair of large
              actions rather than one labelled box and one unlabelled one. The
              live preview covers this entirely once frames arrive, which is
              when the bottom-pinned label below takes over. */}
          <View style={styles.placeholder} pointerEvents="none">
            <Icon name="camera" size={TOKENS.icon.xl} color={theme.color.text.secondary} />
            <Text allowFontScaling={false} style={styles.galleryLabel}>
              Camera
            </Text>
          </View>
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
              facing="back"
              style={styles.preview}
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
        </Pressable>

        {/* The Photos tile takes the rest of the row. It is one tile rather than
            a grid of thumbnails because reading the user's gallery needs a
            Play-restricted permission — see this component's own note. */}
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
        </Pressable>
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
    placeholder: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space['2xs'],
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
