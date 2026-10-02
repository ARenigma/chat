/**
 * The two ways into stories.
 *
 *   StoryRail     the member's Home rail: listed providers with a live story,
 *                 unseen first (orderRail, tested), each a face in a ring.
 *   YourStoryRow  the provider's own entry on their Chats tab: view what is
 *                 live, or add one.
 *
 * The ring is the state: an accent ring for anything unseen, a hairline ring
 * once all are seen. Colour AND weight change (2dp accent against 1dp
 * hairline), so the state is not carried by hue alone (WCAG 1.4.1), and the
 * accessibility label says "new" as words.
 *
 * Motion: none beyond the shared press feedback. A rail face is pressed tens of
 * times a session and a ring's change of state happens while the viewer is on
 * top, unseen, so an animated ring would play to nobody (animate-expo step 1).
 *
 * The member rail renders NOTHING when there are no stories, so Home's page
 * layout is unchanged for a member with nothing to watch; it never leaves an
 * empty strip or a skeleton.
 */
import React, { memo, useCallback, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useProfile, useProviders } from '../../api/chat';
import { useKillSwitches } from '../../api/appConfig';
import { useLiveStories, useSeenStoryIds } from '../../api/stories';
import { useNavigationDeduped } from '../../hooks/useNavigationDeduped';
import { SCROLL_PHYSICS } from '../../lib/scroll';
import { groupHasUnseen, groupStories, orderRail } from '../../lib/stories';
import { TOKENS, type Theme } from '../../theme/tokens';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { Pressable, PressLayer } from '../Pressable';

const FACE = 56;
const RING_GAP = 2;

const StoryRing = memo(function StoryRingView({
  name,
  avatar,
  unseen,
}: {
  name: string;
  avatar: string | null;
  unseen: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.ring, unseen ? styles.ringUnseen : styles.ringSeen]}>
      <Avatar initial={(name || '·').slice(0, 1).toUpperCase()} uri={avatar} size={FACE} />
      {/*
       * Circular press overlay: clips PressLayer to the ring's inscribed
       * circle. Rendered after Avatar so it is on top; `overflow: 'hidden'`
       * + pill radius creates the circular clip. The ring itself has no
       * `overflow: 'hidden'`, so the Avatar's presence dot can overflow the
       * ring's rounded corner where the circular overlay has no coverage.
       */}
      <View style={styles.ringPressOverlay} pointerEvents="none">
        <PressLayer />
      </View>
    </View>
  );
});

interface RailProps {
  /** The providers this page shows; stories from anyone else stay off it. */
  providerIds: ReadonlySet<string>;
}

function StoryRailView({ providerIds }: RailProps) {
  const styles = useStyles(makeStyles);
  const nav = useNavigationDeduped();
  const live = useLiveStories();
  const seen = useSeenStoryIds();
  const providers = useProviders();

  // `Date.now()` inside a memo is enough: the server drops an expired story
  // from the live query, which refetches every 60 s, so an expiry arrives as
  // new `live.data` and recomputes this within a minute.
  const groups = useMemo(() => {
    const all = groupStories(live.data ?? [], Date.now()).filter(g => providerIds.has(g.providerId));
    return orderRail(all, seen.data ?? new Set());
  }, [live.data, seen.data, providerIds]);

  const open = useCallback(
    (startProviderId: string) => {
      nav.push('StoryViewer', { providerIds: groups.map(g => g.providerId), startProviderId });
    },
    [nav, groups],
  );

  if (groups.length === 0) {
    return null;
  }
  const byId = new Map((providers.data ?? []).map(p => [p.id, p]));

  return (
    <View style={styles.rail} testID="story-rail">
      <Text
        allowFontScaling
        maxFontSizeMultiplier={TOKENS.fontScaleCap.titleSmall}
        accessibilityRole="header"
        style={styles.label}>
        Stories
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={styles.scroll}>
        {groups.map(g => {
          const p = byId.get(g.providerId);
          const name = p?.display_name ?? '';
          const unseen = groupHasUnseen(g, seen.data ?? new Set());
          return (
            <Pressable
              key={g.providerId}
              onPress={() => open(g.providerId)}
              accessibilityLabel={unseen ? `${name}, new story` : `${name}, story`}
              press="card"
              layer="child"
              style={styles.item}
              testID={`story-rail-${g.providerId}`}>
              <StoryRing name={name} avatar={p?.avatar_url ?? null} unseen={unseen} />
              {/* User text in its own node (bidi isolation). */}
              <Text allowFontScaling numberOfLines={1} style={styles.name}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export const StoryRail = memo(StoryRailView);

interface YourStoryProps {
  selfId: string | undefined;
}

/** The provider's "Your story" row, under the Chats tab's bar. */
function YourStoryRowView({ selfId }: YourStoryProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const nav = useNavigationDeduped();
  const live = useLiveStories(selfId !== undefined);
  const profile = useProfile();
  const { data: kill } = useKillSwitches();
  const canAdd = kill?.stories_enabled !== false;

  const mine = useMemo(
    () => groupStories(live.data ?? [], Date.now()).find(g => g.providerId === selfId),
    [live.data, selfId],
  );
  const count = mine?.stories.length ?? 0;
  const name = profile.data?.display_name ?? '';

  const view = () => {
    if (selfId !== undefined && count > 0) {
      nav.push('StoryViewer', { providerIds: [selfId], startProviderId: selfId });
    }
  };
  const add = () => nav.push('StoryCreate');

  return (
    <View style={styles.yourRow} testID="your-story">
      <Pressable
        onPress={count > 0 ? view : add}
        accessibilityLabel={count > 0 ? 'View your story' : 'Add to your story'}
        disabled={count === 0 && !canAdd}
        press="row"
        style={styles.yourMain}
        testID="your-story-open">
        <View>
          <StoryRing name={name} avatar={profile.data?.avatar_url ?? null} unseen={count > 0} />
          {count === 0 && canAdd ? (
            <View style={styles.plusBadge}>
              <Icon name="plus" size={TOKENS.icon.xs} color={theme.color.text.onAccent} />
            </View>
          ) : null}
        </View>
        <View style={styles.yourText}>
          <Text allowFontScaling maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMedium} style={styles.yourTitle}>
            Your story
          </Text>
          <Text allowFontScaling style={styles.yourSub}>
            {count > 0
              ? `${count} live · tap to see views and comments`
              : canAdd
                ? 'Share a photo or a video for 24 hours'
                : 'Stories are paused right now'}
          </Text>
        </View>
      </Pressable>
      {count > 0 && canAdd ? (
        <Pressable
          onPress={add}
          accessibilityLabel="Add to your story"
          press="chip"
          shape="circle"
          size={48}
          style={styles.addButton}
          testID="your-story-add">
          <Icon name="plus" size={TOKENS.icon.lg} color={theme.color.text.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const YourStoryRow = memo(YourStoryRowView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    rail: {
      paddingTop: TOKENS.space.xs,
    },
    label: {
      ...TOKENS.typography.titleSmall,
      color: t.color.text.section,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.md,
      gap: TOKENS.space.sm,
    },
    item: {
      width: FACE + RING_GAP * 2 + 8,
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
    },
    ring: {
      padding: RING_GAP,
      borderRadius: TOKENS.radius.pill,
    },
    ringUnseen: {
      borderWidth: 2,
      borderColor: t.color.border.accent,
    },
    // One dp thinner, one dp more padding: the face does not move between states.
    ringSeen: {
      borderWidth: 1,
      borderColor: t.color.border.hairline,
      padding: RING_GAP + 1,
    },
    /*
     * Circular clip for the press layer. Positioned absolutely over the ring's
     * full area; `overflow: 'hidden'` + pill radius clips PressLayer to the
     * inscribed circle. The ring view has no overflow:hidden of its own, so
     * the Avatar's presence dot (which overflows the Avatar's host at the
     * bottom-right corner) remains visible outside the clip's circle area.
     */
    ringPressOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: TOKENS.radius.pill,
      overflow: 'hidden',
    },
    name: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
      maxWidth: FACE + RING_GAP * 2 + 8,
    },
    yourRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
      gap: TOKENS.space.sm,
    },
    yourMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.md,
      minHeight: TOKENS.layout.rowTwoLine,
    },
    yourText: {
      flex: 1,
      minWidth: 0,
    },
    yourTitle: {
      ...TOKENS.typography.titleMedium,
      color: t.color.text.primary,
    },
    yourSub: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    plusBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accent,
      borderWidth: 2,
      borderColor: t.color.bg.base,
    },
    addButton: {
      backgroundColor: t.color.bg.sunken,
      borderRadius: TOKENS.radius.pill,
    },
  });
