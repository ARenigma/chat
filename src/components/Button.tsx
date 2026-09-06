import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { fadeSwapFast } from '../theme/motion';
import { Pressable } from './Pressable';
import { LoadingIndicator } from './LoadingIndicator';

interface Props {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  /** A request started by this button is in flight. Not `disabled`. */
  busy?: boolean;
  /**
   * What the button says while `busy`. The present participle of the label:
   * "Submit Application" becomes "Submitting Application".
   */
  busyLabel?: string;
  testID?: string;
}

/**
 * Full-width action.
 *
 * Primary is **ink, not coral**, and that is the load-bearing decision in the
 * whole palette. The coral is the app's one signal; spending it on every
 * confirm button would leave nothing to mark the send, the unread count or the
 * message you just wrote. It also could not carry a label safely, coral.9
 * measures 3.4:1 against white, which is why the token that *can* is a separate,
 * deeper step used only for the bubble.
 *
 * Danger is an outline in garnet rather than a filled red: destructive actions
 * should look deliberate, not inviting.
 *
 * **The radius morph is gone.** A corner that tightens under the finger is
 * Material 3 Expressive's shape-morphing and iOS has no analogue for it, a UIKit
 * button dims its content and does not move or change shape. That is what
 * `highlight="dim"` now does here, and the constant it replaced is the reason
 * `radius.pressButton` still exists in the tokens with no consumer.
 *
 * The label is `headline` (17 SemiBold), not `labelMedium` (15): an iOS filled
 * button's title is 17, and there was no 17-semibold style in the ladder at all
 * until the iOS pass added one.
 *
 * **The button narrates itself AND shows a spinner.** Rule 5 of the Fuse motion
 * system gives the label: "Create Device Key" becomes "Creating Device Key" on
 * tap. This used to argue that the participle made a spinner redundant, because a
 * spinner says "something" and a participle says which thing. Both are wanted,
 * and the reason is that they answer different questions: the label says what is
 * happening, the spinner says it is still happening. A narrated label alone is
 * indistinguishable from a button that has silently died.
 *
 * The wait glyph is the real MDC Android LoadingIndicator. It starts with the
 * expressive shape sequence and changes to native circular progress at the M3
 * five-second boundary; no React Native geometry approximates either widget.
 *
 * **Its slot is always there.** The spinner sits in a fixed-width box that is
 * present whether busy or not, holding `Spinner`'s size plus one gap, and merely
 * empty when idle. Mounting it only while busy is the obvious version and it
 * shifts the label sideways on the frame the request starts, which is exactly the
 * jump this button is supposed to be free of. Reserving the space costs 24 points
 * of a full-width button and buys a label that never moves.
 *
 * Two properties make that work, and every call site in the app was getting both
 * wrong before this. First, `busy` is a distinct state from `disabled`: they were
 * conflated, so a label whose whole job is to be read was rendered at 45%
 * opacity. Second, the swap is animated rather than cut: an opacity fade at
 * `fast` rather than `base`, because a button label has to feel attached to the
 * tap that changed it.
 */
/**
 * 20 dp container; the arc inside scales proportionally (≈ 15.8 dp).
 *
 * Small enough to sit beside a label without dominating it, large enough to
 * read clearly on both densities. The container is transparent so only the arc
 * is visible — the 48 dp pill form is for standalone use (ScreenLoader, etc.).
 */
const SPINNER_SIZE = 20;

function ButtonView({
  label,
  onPress,
  kind = 'primary',
  disabled = false,
  busy = false,
  busyLabel,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const shown = busy ? busyLabel ?? label : label;
  /*
   * The spinner takes the label's colour, not the accent. It is part of the
   * label's sentence rather than a separate signal, and a coral spinner on an ink
   * button would be the palette's one signal spent on a progress mark.
   */
  const labelColour = styles[`${kind}Label`].color;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      busy={busy}
      testID={testID}
      // The narrated label, so a screen reader hears the state change too rather
      // than only seeing it.
      accessibilityLabel={shown}
      press="none"
      highlight="dim"
      style={[styles.base, styles[kind]]}>
      {/* The reserved slot. Always rendered, occupied only while busy. */}
      <View style={styles.spinnerSlot}>
        {busy ? (
          <LoadingIndicator
            size={SPINNER_SIZE}
            color={labelColour}
            containerColor="transparent"
          />
        ) : null}
      </View>
      {/* Keyed on its own content, which is what makes the entrance run: React
          remounts the node on a swap and Reanimated fades the new one in. Opacity
          only. Nothing scales and nothing translates. */}
      <Animated.Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
        key={shown}
        entering={fadeSwapFast}
        allowFontScaling
        style={[styles.label, styles[`${kind}Label`]]}>
        {shown}
      </Animated.Text>
      {/* The mirror of the slot, so the label stays optically centred rather
          than being pushed right by the spinner's reserved width. */}
      <View style={styles.spinnerSlot} />
    </Pressable>
  );
}

export const Button = memo(ButtonView);

const makeStyles = (t: Theme) => StyleSheet.create({
  // Fixed width so the label's position does not depend on the busy state. The
  // width is the spinner plus one small gap; it is mirrored on the trailing side.
  spinnerSlot: {
    width: SPINNER_SIZE + TOKENS.space['2xs'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  base: {
    // 52 is close enough to iOS's 50pt filled button to leave alone, and it is
    // already comfortably past the 48dp target.
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: TOKENS.space.lg,
    // 10, not 24. A near-capsule is a Material filled button; iOS's is a 10pt
    // rounded rect, and the capsule shape is not a brand decision anybody made,
    // it was the resting end of the morph that has just been deleted.
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
  },
  primary: {
    backgroundColor: t.color.bg.inverse,
  },
  secondary: {
    backgroundColor: t.color.bg.raised,
    borderWidth: 1,
    borderColor: t.color.border.strong,
  },
  danger: {
    backgroundColor: t.color.bg.raised,
    borderWidth: 1,
    borderColor: t.color.state.danger,
  },
  label: {
    ...TOKENS.typography.titleMediumEmphasized,
  },
  primaryLabel: {
    color: t.color.text.onInverse,
  },
  secondaryLabel: {
    color: t.color.text.primary,
  },
  dangerLabel: {
    color: t.color.state.danger,
  },
});
