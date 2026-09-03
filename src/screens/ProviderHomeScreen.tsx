import React, { useCallback, useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { listStamp } from '../lib/datetime';
import { track } from '../lib/telemetry';
import { useConversations, useProfile } from '../api/chat';
import { useEarnings, useSetAvailability } from '../api/provider';
import { Avatar } from '../components/Avatar';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ROW_AVATAR, ROW_SEPARATOR_INSET } from '../components/ProviderRow';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Toggle } from '../components/Toggle';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenSettings: () => void;
}

function threadLabel(thread: ConversationSummary): string {
  if (thread.last_session_status === 'active') return 'Active session';
  if (thread.last_session_status === 'pending_leases') return 'Connecting session';
  if (thread.last_preview_kind === 'voice') return 'Voice note';
  if (thread.last_preview_kind === 'image') return 'Photo';
  if (thread.last_session_channel === 'audio') return 'Voice call';
  if (thread.last_session_channel === 'video') return 'Video call';
  if (thread.last_session_at) return 'Chat session';
  return 'No sessions yet';
}

/**
 * The provider's working surface.
 *
 * Two things are here because Clarity's *positive* reviews are almost entirely
 * listeners talking about money, "this app helped me improve my finances". A
 * provider with no visibility into what they have earned has no reason to stay,
 * and supply is the harder side of this marketplace to build.
 *
 * Earnings are in provider_tokens (60% share, ADR-0021). 1 token = ₹1, so ₹N
 * earned is accurate as accrual. We show it with a payout-pending note because
 * Cashfree Payouts is not yet wired; the figure is correct, the transfer is not
 * yet made.
 */
export function ProviderHomeScreen({ onOpenConversation, onOpenSettings }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
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
   * beside their earnings, observed on a device straight after an admission,
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
  const waiting = work.filter(t => Number(t.unread_count_provider) > 0).length;

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const unreadCount = item.i_am_member
        ? Number(item.unread_count_member)
        : Number(item.unread_count_provider);
      const unread = unreadCount > 0;
      // A provider sees members, who are not in the directory and therefore have
      // no published name. Numbered rather than labelled "Member" repeatedly.
      const label = item.peer_display_name ?? `Member ${item.peer_id.slice(0, 4)}`;
      return (
        <Pressable
          onPress={() => onOpenConversation(item.peer_id)}
          testID={`provider-thread-${item.peer_id}`}
          accessibilityLabel={`${label}${unread ? ', waiting for a reply' : ''}`}
          press="none"
          highlight="ios"
          style={styles.row}>
          {/* Hardcoded off until 012, and not out of laziness: `peer_available`
              resolved the provider's listing switch through a join that is false
              for every member, so there was no value here that could ever be
              true. `peer_presence` is published for either role, so the person
              waiting for a reply can finally be seen waiting. */}
          <Avatar
            initial={initialOf(label)}
            size={ROW_AVATAR}
            online={readPresence(item.peer_presence, item.peer_last_active_at).here}
          />
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.rowName}>
                {label}
              </Text>
              <Text allowFontScaling style={styles.rowTime}>
                {item.last_session_at ? listStamp(item.last_session_at) : ''}
              </Text>
            </View>
            <View style={styles.rowTop}>
              <Text
                allowFontScaling
                numberOfLines={1}
                style={[styles.rowPreview, unread && styles.rowPreviewUnread]}>
                {threadLabel(item)}
              </Text>
              {unread ? (
                <View testID="waiting-dot" style={styles.unread}>
                  <Text allowFontScaling style={styles.unreadCount}>
                    {unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [onOpenConversation, styles],
  );

  /**
   * The third separator idiom in the app becomes the first one.
   *
   * The member's inbox and the directory both draw an inset hairline between
   * rows; this list drew nothing at all, so a provider moving between the two
   * trees met two different list languages. Rendered as `ItemSeparatorComponent`
   * rather than as a sibling inside the row, which also fixes the thing the other
   * two lists had to work around by hand: a separator that is not part of the row
   * cannot be drawn after the last one.
   */
  const separator = useCallback(() => <View style={styles.separator} />, [styles]);

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
          accessibilityLabel="Account and Privacy"
          press="none"
          highlight="ios"
          size={40}
          style={styles.iconButton}>
          <Icon name="more" size={22} color={theme.color.text.secondary} />
        </Pressable>
      </View>

      {/* The listing switch first, because it is the only control here with an
          immediate effect on whether anyone new can reach them.

          The copy used to read 'Available Now' / 'You are hidden', which claimed
          presence twice over: this switch is a directory listing, and 'hidden' is
          now the name of a presence value set in Settings. Two controls saying
          'hidden' and meaning different things is how somebody ends up
          unreachable while believing they are only invisible. */}
      <View style={styles.availability}>
        <View style={styles.availabilityText}>
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.availabilityTitle}>
            {available ? 'Open to New Conversations' : 'Not Taking New Conversations'}
          </Text>
          <Text allowFontScaling style={styles.availabilitySub}>
            {available
              ? 'You are listed in the directory and can be messaged.'
              : 'You are not listed. Existing conversations still work.'}
          </Text>
        </View>
        {/* Our own M3 switch, not the platform one. RN's Switch rendered
            Android's stock teal here, the single most out-of-place colour in the
            app, and even once told the palette it cannot do the M3 anatomy. Sage
            for on because it belongs to the reachability family, which is what
            sage means in this palette. Not because this switch is presence: it is
            not, and that conflation is what 012 unpicked. */}
        <Toggle
          testID="availability-toggle"
          value={available}
          onValueChange={toggle}
          disabled={setAvailability.isPending}
          accessibilityLabel="Open to new conversations"
          tone="presence"
        />
      </View>

      <View style={styles.stats}>
        <Stat label="Waiting" value={String(waiting)} testID="stat-waiting" />
        <Stat
          label="Minutes"
          value={String(earnings?.minutes_billed ?? 0)}
          testID="stat-minutes"
        />
        <Stat label="People" value={String(earnings?.members_served ?? 0)} testID="stat-people" />
        <Stat
          label="Rating"
          value={profile?.rating_avg != null ? profile.rating_avg.toFixed(1) : 'None'}
          testID="stat-rating"
        />
      </View>

      {/* 1 token = ₹1 (ADR-0021). Accrual is real; payout transfer is not yet wired. */}
      {(earnings?.provider_tokens ?? 0) > 0 ? (
        <Text testID="earned-notice" allowFontScaling style={styles.refundNote}>
          ₹{earnings?.provider_tokens} earned · Held for payout · not yet paid
        </Text>
      ) : null}

      {isPending ? (
        <View style={styles.state}>
          <LoadingIndicator size={48} />
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
          {...SCROLL_PHYSICS}
          sections={sections}
          keyExtractor={t => t.conversation_id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) =>
            section.title === null ? null : (
              <Text allowFontScaling style={styles.sectionTitle}>
                {section.title}
              </Text>
            )
          }
          ItemSeparatorComponent={separator}
          // Sticky plain-list section headers ARE the iOS behaviour; false was
          // Material's, where a header scrolls away with its content.
          stickySectionHeadersEnabled
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
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} testID={testID} allowFontScaling style={styles.statValue}>
        {value}
      </Text>
      <Text allowFontScaling style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.color.bg.base,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space['2xs'],
    paddingBottom: TOKENS.space.md,
  },
  role: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `bg/raised` is #FFFFFF in light mode and so is `bg/base`, so this card had no
  // fill at all and the switch floated on the page. `bg/sunken` is a real fill,
  // and radius.field is the iOS grouped-row corner.
  availability: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
    marginHorizontal: TOKENS.space.md,
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  availabilityText: {
    flex: 1,
    gap: TOKENS.space.hair,
  },
  availabilityTitle: {
    ...TOKENS.typography.titleMediumEmphasized,
    color: t.color.text.primary,
  },
  availabilitySub: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  stats: {
    flexDirection: 'row',
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.lg,
    gap: TOKENS.space.lg,
  },
  stat: {
    gap: TOKENS.space.hair,
  },
  statValue: {
    ...TOKENS.typography.titleLargeEmphasized,
    color: t.color.text.primary,
  },
  statLabel: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  refundNote: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
    paddingHorizontal: TOKENS.space.md,
    paddingBottom: TOKENS.space.md,
  },
  list: {},
  // 13 SemiBold, which is iOS's plain-list header. It was captionSmall, 12
  // Regular, which is a caption and not a header.
  sectionTitle: {
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.secondary,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xs,
    backgroundColor: t.color.bg.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingVertical: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    backgroundColor: t.color.bg.base,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: TOKENS.space.md + ROW_SEPARATOR_INSET,
    backgroundColor: t.color.border.hairline,
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
    ...TOKENS.typography.titleMediumEmphasized,
    color: t.color.text.primary,
    flex: 1,
  },
  rowTime: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.tertiary,
  },
  rowPreview: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
    flex: 1,
  },
  rowPreviewUnread: {
    ...TOKENS.typography.labelLargeEmphasized,
    color: t.color.text.primary,
  },
  // A count, not a dot, the same badge the member's inbox uses. "Someone is
  // waiting on you" is the one thing on this screen worth interrupting for, and
  // the number is the difference between checking and deciding.
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.accentStrong,
  },
  unreadCount: {
    ...TOKENS.typography.numeralSmall,
    color: t.color.text.onAccent,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: TOKENS.space['2xl'],
  },
  stateText: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.secondary,
    textAlign: 'center',
  },
});
