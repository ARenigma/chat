import React, { useCallback, useMemo } from 'react';
import { ActivityIndicator, SectionList, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import type { ConversationSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { track } from '../lib/telemetry';
import { useConversations, useProfile } from '../api/chat';
import { useEarnings, useSetAvailability } from '../api/provider';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenSettings: () => void;
}

function ago(iso: string): string {
  const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${Math.floor(minutes)}m`;
  }
  const hours = minutes / 60;
  return hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * The provider's working surface.
 *
 * Two things are here because Clarity's *positive* reviews are almost entirely
 * listeners talking about money — "this app helped me improve my finances". A
 * provider with no visibility into what they have earned has no reason to stay,
 * and supply is the harder side of this marketplace to build.
 *
 * Earnings are counted in tokens, not currency. One token spent by a member is
 * one unit earned; turning that into a payout is Stripe Connect's job and is not
 * built. Showing a rupee figure we cannot yet pay would be a lie, so it shows
 * what is true.
 */
export function ProviderHomeScreen({ onOpenConversation, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const { data: profile } = useProfile();
  const { data: allThreads, isPending } = useConversations();
  const { data: earnings } = useEarnings();
  const setAvailability = useSetAvailability();

  const available = profile?.is_available ?? false;

  /**
   * Two groups, because a provider can be on either side of a thread.
   *
   * `useConversations` returns every thread the caller participates in, and this
   * screen used all of them as work. A provider who was a member first therefore
   * saw the conversations *they* paid for counted under "Waiting" and listed
   * beside their earnings — observed on a device straight after an admission,
   * where the first row of the work list was the provider's own thread with the
   * provider they had been talking to.
   *
   * Filtering them out entirely would have been worse: role picks the whole
   * navigation tree (ADR-0002), so a thread missing from this list is a thread
   * the person can no longer open or rate. So they stay, in their own group,
   * counted as nobody's work.
   *
   * `i_am_member` is the per-conversation answer `profiles.role` cannot give,
   * since it flips on admission and takes the old threads with it (migration
   * 007).
   */
  const work = useMemo(
    () => (allThreads ?? []).filter(t => !t.i_am_member),
    [allThreads],
  );

  const sections = useMemo(
    () =>
      [
        { key: 'work', title: null, data: work },
        {
          key: 'mine',
          title: 'Your own conversations',
          data: (allThreads ?? []).filter(t => t.i_am_member),
        },
      ].filter(s => s.data.length > 0),
    [allThreads, work],
  );

  const toggle = useCallback(
    (next: boolean) => {
      track('availability_changed', { available: next });
      setAvailability.mutate(next);
    },
    [setAvailability],
  );

  // Only work counts as waiting. Their own thread is not a person waiting on them.
  const waiting = work.filter(t => Number(t.unread_count) > 0).length;

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const unread = Number(item.unread_count) > 0;
      // A provider sees members, who are not in the directory and therefore have
      // no published name. Numbered rather than labelled "Member" repeatedly.
      const label = item.peer_display_name ?? `Member ${item.peer_id.slice(0, 4)}`;
      return (
        <Pressable
          onPress={() => onOpenConversation(item.peer_id)}
          testID={`provider-thread-${item.peer_id}`}
          accessibilityLabel={`${label}${unread ? ', waiting for a reply' : ''}`}
          style={styles.row}>
          <Avatar initial={initialOf(label)} size={42} online={false} />
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text allowFontScaling numberOfLines={1} style={styles.rowName}>
                {label}
              </Text>
              <Text allowFontScaling style={styles.rowTime}>
                {ago(item.last_message_at)}
              </Text>
            </View>
            <View style={styles.rowTop}>
              <Text
                allowFontScaling
                numberOfLines={1}
                style={[styles.rowPreview, unread && styles.rowPreviewUnread]}>
                {item.last_body ?? 'No messages yet'}
              </Text>
              {unread ? <View testID="waiting-dot" style={styles.dot} /> : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [onOpenConversation],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.meta}>
        <Text allowFontScaling style={styles.role}>
          Provider
        </Text>
        <View style={styles.spacer} />
        <Pressable
          onPress={onOpenSettings}
          testID="open-settings"
          accessibilityLabel="Account and privacy"
          style={styles.iconButton}>
          <Icon glyph="dots" size={18} color={TOKENS.color.text.secondary} />
        </Pressable>
      </View>

      {/* Availability first, because it is the only control with an immediate
          effect on whether anyone can reach them. */}
      <View style={styles.availability}>
        <View style={styles.availabilityText}>
          <Text allowFontScaling style={styles.availabilityTitle}>
            {available ? 'Available now' : 'Not available'}
          </Text>
          <Text allowFontScaling style={styles.availabilitySub}>
            {available
              ? 'You appear in the directory and can be messaged.'
              : 'You are hidden. Existing conversations still work.'}
          </Text>
        </View>
        <Switch
          testID="availability-toggle"
          value={available}
          onValueChange={toggle}
          disabled={setAvailability.isPending}
          accessibilityLabel="Available to talk"
        />
      </View>

      <View style={styles.stats}>
        <Stat label="Waiting" value={String(waiting)} testID="stat-waiting" />
        <Stat
          label="Messages"
          value={String(earnings?.billable_messages ?? 0)}
          testID="stat-messages"
        />
        <Stat label="People" value={String(earnings?.members_served ?? 0)} testID="stat-people" />
        <Stat
          label="Rating"
          value={profile?.rating_avg != null ? profile.rating_avg.toFixed(1) : '—'}
          testID="stat-rating"
        />
      </View>

      {(earnings?.refunded_messages ?? 0) > 0 ? (
        <Text testID="refund-notice" allowFontScaling style={styles.refundNote}>
          {earnings?.refunded_messages} message
          {earnings?.refunded_messages === 1 ? '' : 's'} went unanswered and were
          refunded. Replying, even briefly, is what earns.
        </Text>
      ) : null}

      {isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={TOKENS.color.text.secondary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.state}>
          <Text allowFontScaling style={styles.stateText}>
            {available
              ? 'Nobody has reached out yet. You will see them here.'
              : 'Turn on availability so people can find you.'}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={t => t.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) =>
            section.title === null ? null : (
              <Text allowFontScaling style={styles.sectionTitle}>
                {section.title}
              </Text>
            )
          }
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + TOKENS.space['2xl'] },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function Stat({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID: string;
}) {
  return (
    <View style={styles.stat}>
      <Text testID={testID} allowFontScaling style={styles.statValue}>
        {value}
      </Text>
      <Text allowFontScaling style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space['2xs'],
    paddingBottom: TOKENS.space.md,
  },
  role: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  availability: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
    marginHorizontal: TOKENS.space.lg,
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.raised,
  },
  availabilityText: {
    flex: 1,
    gap: 2,
  },
  availabilityTitle: {
    ...TOKENS.typography.bodyMedium,
    fontWeight: '600',
    color: TOKENS.color.text.primary,
  },
  availabilitySub: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  stats: {
    flexDirection: 'row',
    paddingHorizontal: TOKENS.space.lg,
    paddingVertical: TOKENS.space.lg,
    gap: TOKENS.space.lg,
  },
  stat: {
    gap: 2,
  },
  statValue: {
    ...TOKENS.typography.titleMedium,
    color: TOKENS.color.text.primary,
  },
  statLabel: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  refundNote: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
    paddingHorizontal: TOKENS.space.lg,
    paddingBottom: TOKENS.space.md,
  },
  list: {
    paddingHorizontal: TOKENS.space.lg,
  },
  sectionTitle: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
    paddingTop: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
  },
  rowBody: {
    flex: 1,
    gap: 3,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  rowName: {
    ...TOKENS.typography.bodyLarge,
    fontWeight: '500',
    color: TOKENS.color.text.primary,
    flex: 1,
  },
  rowTime: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  rowPreview: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
    flex: 1,
  },
  rowPreviewUnread: {
    color: TOKENS.color.text.primary,
    fontWeight: '500',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TOKENS.color.bg.accent,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: TOKENS.space['2xl'],
  },
  stateText: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
    textAlign: 'center',
  },
});
