import React, { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

type Tone = 'surface' | 'emphasis' | 'onMedia' | 'listener' | 'astrologer';
type Size = 'md' | 'sm';

interface Props {
  label: string;
  /**
   * surface = M3 AssistChip; emphasis = rating lead; onMedia = photo overlay;
   * listener / astrologer = the FILLED provider-type tag (Amit, 2026-09-08:
   * "SP type tag should be filled to be highlighted and type should have
   * unique colors").
   *
   * The two type tones live here rather than as a colour prop on the caller,
   * because a `fill`/`ink` prop would put a pair of raw colours outside the
   * styled component — where neither the accent budget nor the contrast gate
   * can see them. A named tone keeps both checkable.
   */
  tone?: Tone;
  /** md = M3's 32dp AssistChip. sm = the 24dp tag pill; see META_CHIP_HEIGHT_SM. */
  size?: Size;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Material 3 AssistChip geometry for fact tags (rating, years, languages).
 *
 * Specs from AssistChipDefaults (developer.android.com):
 *   - Height 32dp
 *   - Small corner shape (8dp here = radius.xs)
 *   - 1dp outline
 *   - Horizontal label padding ~12dp
 *   - Flat (no elevation)
 *
 * Display-only — not an AssistChip action target. The row/card owns the press.
 * https://m3.material.io/components/chips/specs
 * https://developer.android.com/reference/kotlin/androidx/compose/material3/AssistChipDefaults
 *
 * NO `flexShrink: 0` AND NO `minWidth`, reviewed 2026-09-07 rather than left
 * unexamined, because the obvious guard against "a chip squeezed to an ellipsis
 * mid-strip" would break the other call site.
 *
 * There is no squeeze to guard against in ProviderRow any more: its strip is a
 * horizontal ScrollView, whose main axis is unbounded, so a chip in it is laid
 * out at its natural width and there is no shrink pressure to ellipsize under.
 * ProviderCard's strip is the opposite case — a bounded, WRAPPING row — and
 * there `flexShrink: 1` (the default) is the correct behaviour for the one chip
 * that is longer than the card is wide: it shrinks and its label truncates,
 * where `flexShrink: 0` would push it out past the card's edge. A `minWidth`
 * would do the same thing more quietly. So the fix for the row belongs in the
 * row's layout, which is where it now is, and this component keeps flexing.
 */

/**
 * AssistChip height, exported so a container can size itself to the chip.
 *
 * ProviderRow's scroller needs a FIXED height — a ScrollView measures its
 * cross axis from its content, and that list's rows must all be the same height
 * — and it takes this constant rather than repeating 32, so the scroller and the
 * chip inside it cannot drift apart.
 */
const META_CHIP_HEIGHT = 32;

/**
 * The 24dp tag pill, and a STATED DEPARTURE from the 32dp spec above.
 *
 * M3 gives assist chips one height, 32dp, and this is 24. The reason the spec
 * says 32 is the touch target — "chips are compact elements that represent an
 * input, attribute, or action" and the same page's accessibility section sizes
 * them to be tapped. Nothing here is tappable: every chip this component
 * renders is `accessible={false}` and sits inside a Pressable that owns the
 * gesture, so there is no target to undersize. The constraint that produces 32
 * does not apply to a label.
 *
 * What DOES apply is the row's budget. The explore row (083) carries three
 * expertise tags on their own line above two more text lines and a 48dp CTA;
 * at 32dp the tag line alone is a third of the row, and the row passes 150dp.
 * The reference this row is built from puts its equivalent line — Astrotalk's
 * `skillET`, measured on the Redmi at 17.1dp — in plain text with no pill at
 * all. 24dp is the compromise: Clarity's pill shape, close to Astrotalk's line
 * height.
 * https://m3.material.io/components/chips/specs
 */
const META_CHIP_HEIGHT_SM = 24;

function MetaChipView({ label, tone = 'surface', size = 'md', testID, style }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View
      testID={testID}
      accessible={false}
      style={[
        styles.chip,
        size === 'sm' && styles.chipSm,
        tone === 'emphasis' && styles.emphasis,
        tone === 'onMedia' && styles.onMedia,
        tone === 'listener' && styles.listener,
        tone === 'astrologer' && styles.astrologer,
        style,
      ]}>
      <Text
        allowFontScaling
        numberOfLines={1}
        style={[
          styles.label,
          size === 'sm' && styles.labelSm,
          tone === 'emphasis' && styles.labelEmphasis,
          tone === 'onMedia' && styles.labelOnMedia,
          tone === 'listener' && styles.labelListener,
          tone === 'astrologer' && styles.labelAstrologer,
        ]}>
        {label}
      </Text>
    </View>
  );
}

export const MetaChip = memo(MetaChipView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    chip: {
      height: META_CHIP_HEIGHT,
      minHeight: META_CHIP_HEIGHT,
      paddingHorizontal: TOKENS.space.sm,
      justifyContent: 'center',
      borderRadius: TOKENS.radius.xs,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.base,
    },
    // 8dp of side padding rather than 12: the pill is 8dp shorter, and keeping
    // the horizontal inset would leave it visibly wider than tall for a
    // one-word tag.
    chipSm: {
      height: META_CHIP_HEIGHT_SM,
      minHeight: META_CHIP_HEIGHT_SM,
      paddingHorizontal: TOKENS.space.xs,
      borderRadius: TOKENS.radius.xs,
    },
    labelSm: {
      ...TOKENS.typography.labelSmall,
    },
    emphasis: {
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.raised,
    },
    /*
     * FILLED, and the border goes transparent rather than being removed: the
     * chip keeps its 1dp box so a filled tag and an outlined one are the same
     * size to the pixel, and a row of mixed tones does not jitter.
     *
     * Two hues, because the two types have to be told apart at a glance down a
     * scrolling column and hue is the only channel that does that without
     * making one look more important than the other — size or weight would.
     */
    listener: {
      backgroundColor: t.color.bg.listener,
      borderColor: 'transparent',
    },
    astrologer: {
      backgroundColor: t.color.bg.astrologer,
      borderColor: 'transparent',
    },
    labelListener: {
      color: t.color.text.onListener,
    },
    labelAstrologer: {
      color: t.color.text.onAstrologer,
    },
    // Over a photo: white outline + translucent fill so the chip still reads as
    // the same 32×8 geometry without fighting the scrim.
    onMedia: {
      borderColor: 'rgba(255,255,255,0.55)',
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    label: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.secondary,
    },
    labelEmphasis: {
      ...TOKENS.typography.labelMediumEmphasized,
      fontFamily: 'Geist-SemiBold',
      color: t.color.text.primary,
    },
    labelOnMedia: {
      color: '#FFFFFF',
    },
  });
