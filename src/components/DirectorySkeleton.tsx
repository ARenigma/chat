import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Skeleton } from './Skeleton';
import {
  PROVIDER_CARD_HEIGHT,
  ROW_AVATAR_RING,
  ROW_CARD_GAP,
  ROW_CTA_VISUAL_HEIGHT,
} from './ProviderRow';
import { STARS_WIDTH } from './RatingStars';
import { HERO_CARD_GAP, HERO_CARD_HEIGHT, HERO_CARD_WIDTH } from '../lib/carousel';

/**
 * How many pick placeholders to draw. The real strip holds three and shows
 * about 2.3; three here means the partial card at the edge is there too, so the
 * skeleton says "this scrolls" the way the strip will.
 */
const HERO_PLACEHOLDERS = 3;

/**
 * The CTA placeholder's width. The real button has no fixed width any more (it
 * hugs its glyph and verb since 2026-09-26), so there is no constant to import;
 * this is the drawn width of its commonest state, "Call": 1 + 11 of stroke and
 * padding each side, a 17dp glyph, an 8dp gap and the word at textSmSemiBold,
 * about 27dp. An estimate of one state, and it only has to be close: the card
 * around it is PROVIDER_CARD_HEIGHT whatever the button measures, so nothing
 * shifts vertically when the data lands.
 */
const CTA_PLACEHOLDER_WIDTH = 76;

/**
 * The Explore screen's first paint, held as a skeleton of what is arriving.
 *
 * IT TRACKS THE REAL CARD BY IMPORT, not by eye. Every box below is sized from
 * a constant `ProviderRow` exports, so the two cannot drift — and they had
 * already drifted once: this drew a 40dp circle and two text lines while the
 * card grew to a ringed 84dp avatar, a star row, five text lines and a 48dp
 * button. A skeleton whose shape is a lie is worse than a spinner, because the
 * content visibly jumps when it lands.
 */
export function DirectorySkeleton({ rows = 5 }: { rows?: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root} accessible={false} pointerEvents="none">
      {/* The picks strip: the same 150x200 portrait cards, inset and gapped
          like the real one (lib/carousel.ts), so the rows below start where
          they will once the data lands. Was one column-wide 190dp block for a
          178dp band. */}
      <View style={styles.hero}>
        {Array.from({ length: HERO_PLACEHOLDERS }).map((_, i) => (
          <Skeleton
            key={i}
            width={HERO_CARD_WIDTH}
            height={HERO_CARD_HEIGHT}
            radius={TOKENS.radius.lg}
          />
        ))}
      </View>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          {/* Left column: the ringed avatar, the star row, the review count. */}
          <View style={styles.leftColumn}>
            <Skeleton
              width={ROW_AVATAR_RING}
              height={ROW_AVATAR_RING}
              radius={ROW_AVATAR_RING / 2}
            />
            <Skeleton width={STARS_WIDTH} height={12} radius={TOKENS.radius.xs} />
            <Skeleton width={52} height={11} radius={TOKENS.radius.xs} />
          </View>
          {/* Right column: name, expertise, languages, then the tail: experience
              and the category on the left, the CTA centred across them on the
              right, which is where the real card puts it since 2026-09-27. */}
          <View style={styles.lines}>
            {/* The name, and the rate at the far end of the same line. */}
            <View style={styles.nameLine}>
              <Skeleton width="52%" height={16} radius={TOKENS.radius.xs} />
              <View style={styles.spacer} />
              <Skeleton width={44} height={12} radius={TOKENS.radius.xs} />
            </View>
            {/* The specialities: a 12dp bar like the two lines under it,
                since the real line is plain text in a 16dp line box now, not
                the 24dp chip slot this bar was 20dp tall to fill. */}
            <Skeleton width="76%" height={12} radius={TOKENS.radius.xs} />
            <Skeleton width="46%" height={12} radius={TOKENS.radius.xs} />
            <View style={styles.tail}>
              <View style={styles.tailLines}>
                <Skeleton width="44%" height={12} radius={TOKENS.radius.xs} />
                <Skeleton width={62} height={16} radius={TOKENS.radius.xs} />
              </View>
              <Skeleton
                width={CTA_PLACEHOLDER_WIDTH}
                height={ROW_CTA_VISUAL_HEIGHT}
                radius={TOKENS.radius.xs}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      paddingTop: TOKENS.space.sm,
    },
    // A row that clips rather than wraps, like the ScrollView it stands in for.
    // `2xl` under it is the real screen's spacer between the strip and the
    // first row.
    hero: {
      flexDirection: 'row',
      gap: HERO_CARD_GAP,
      paddingHorizontal: TOKENS.space.md,
      marginBottom: TOKENS.space['2xl'],
      overflow: 'hidden',
    },
    // The card's own box, so the skeleton occupies exactly the height the list
    // will need and nothing shifts when the data lands.
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.sm,
      height: PROVIDER_CARD_HEIGHT,
      padding: TOKENS.space.sm,
      marginHorizontal: TOKENS.space.sm,
      marginBottom: ROW_CARD_GAP,
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
    },
    leftColumn: {
      width: ROW_AVATAR_RING,
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
    },
    lines: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    nameLine: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    tail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    tailLines: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    spacer: {
      flex: 1,
    },
  });
