import React, { useCallback, useMemo, useState } from 'react';
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
import { useEarnings, useSetAvailability, useSetChannels } from '../api/provider';
import { Avatar } from '../components/Avatar';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { ROW_AVATAR, ROW_SEPARATOR_INSET } from '../components/ProviderRow';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Toggle } from '../components/Toggle';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenSettings: () => void;
  onOpenPayout: () => void;
}

type Tab = 'chats' | 'you';

/** The three channel switches, in the order the member's own buttons sit. */
type ChannelKey = 'chat_enabled' | 'audio_enabled' | 'video_enabled';

const CHANNEL_ROWS: readonly { key: ChannelKey; title: string; glyph: IconName }[] = [
  { key: 'chat_enabled', title: 'Chat', glyph: 'chat' },
  { key: 'audio_enabled', title: 'Voice calls', glyph: 'call' },
  { key: 'video_enabled', title: 'Video calls', glyph: 'video' },
];

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
 * The provider's working surface, in two tabs (Amit, 2026-09-03):
 *
 *   Chats — the conversations that ARE the work. A brand-new provider with none
 *           gets a calm watermark rather than a bleak blank, because the first
 *           thing supply sees cannot read as "nothing happens here".
 *   You   — everything about them and their money: availability, what they have
 *           earned (60% share, ADR-0021; 1 token = ₹1), payout setup, and stats.
 *
 * Earnings show with a payout-pending note because the transfer is manual for now
 * (docs/provider-payouts.md); the figure is a correct accrual, not yet paid.
 */
export function ProviderHomeScreen({ onOpenConversation, onOpenSettings, onOpenPayout }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: profile } = useProfile();
  const { data: allThreads, isPending } = useConversations();
  const { data: earnings } = useEarnings();
  const setAvailability = useSetAvailability();
  const setChannels = useSetChannels();

  const [tab, setTab] = useState<Tab>('chats');
  const available = profile?.is_available ?? false;
  // What they are willing to do, which is a different question from whether
  // they are taking anyone new (migration 064). Default on, so a provider whose
  // profile has not loaded yet is never shown as offering nothing.
  const channels = useMemo(
    () => ({
      chat_enabled: profile?.chat_enabled ?? true,
      audio_enabled: profile?.audio_enabled ?? true,
      video_enabled: profile?.video_enabled ?? true,
    }),
    [profile?.chat_enabled, profile?.audio_enabled, profile?.video_enabled],
  );
  const enabledCount = CHANNEL_ROWS.filter(r => channels[r.key]).length;

  /**
   * Two groups, because a provider can be on either side of a thread (a provider
   * who was a member first keeps the threads they paid for). `i_am_member` is the
   * per-conversation answer `profiles.role` cannot give (migration 007).
   */
  const work = useMemo(() => (allThreads ?? []).filter(t => !t.i_am_member), [allThreads]);

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

  const toggleChannel = useCallback(
    (key: ChannelKey, next: boolean) => {
      setChannels.mutate({ [key]: next });
    },
    [setChannels],
  );

  // Only work counts as waiting. Their own thread is not a person waiting on them.
  const waiting = work.filter(t => Number(t.unread_count_provider) > 0).length;

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const unreadCount = item.i_am_member
        ? Number(item.unread_count_member)
        : Number(item.unread_count_provider);
      const unread = unreadCount > 0;
      // Members are not in the directory and have no published name — numbered,
      // not "Member" over and over.
      const label = item.peer_display_name ?? `Member ${item.peer_id.slice(0, 4)}`;
      return (
        <Pressable
          onPress={() => onOpenConversation(item.peer_id)}
          testID={`provider-thread-${item.peer_id}`}
          accessibilityLabel={`${label}${unread ? ', waiting for a reply' : ''}`}
          press="none"
          highlight="ios"
          style={styles.row}>
          <Avatar
            initial={initialOf(label)}
            size={ROW_AVATAR}
            online={readPresence(item.peer_presence, item.peer_last_active_at).here}
          />
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text
                maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
                allowFontScaling
                numberOfLines={1}
                style={styles.rowName}>
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

  const separator = useCallback(() => <View style={styles.separator} />, [styles]);

  const earned = earnings?.provider_tokens ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {tab === 'chats' ? (
        <>
          <View style={styles.head}>
            <Text
              maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
              allowFontScaling
              style={styles.headTitle}>
              Chats
            </Text>
          </View>
          {isPending ? (
            <View style={styles.centre}>
              <LoadingIndicator size={48} />
            </View>
          ) : sections.length === 0 ? (
            // The watermark a brand-new provider sees. Clean and calm, not "0".
            <View style={styles.empty}>
              <View style={styles.emptyMark}>
                <Icon name="chat" size={40} color={theme.color.text.tertiary} />
              </View>
              <Text
                maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
                allowFontScaling
                style={styles.emptyTitle}>
                Your chats will show here
              </Text>
              <Text allowFontScaling style={styles.emptyBody}>
                {available
                  ? 'When a member starts a conversation with you, it appears here.'
                  : 'Turn on availability in the You tab so members can reach you.'}
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
              stickySectionHeadersEnabled
              contentContainerStyle={[styles.list, { paddingBottom: TOKENS.space['2xl'] }]}
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      ) : (
        <SectionList
          {...SCROLL_PHYSICS}
          sections={[{ key: 'you', data: [0] }]}
          keyExtractor={i => String(i)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.youScroll, { paddingBottom: TOKENS.space['2xl'] }]}
          renderItem={() => (
            <View style={styles.you}>
              <View style={styles.head}>
                <Text
                  maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
                  allowFontScaling
                  style={styles.headTitle}>
                  You
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
                  <Icon name="settings" size={20} color={theme.color.text.secondary} />
                </Pressable>
              </View>

              {/* Availability — the one control with an immediate effect on whether
                  anyone new can reach them. */}
              <View style={styles.availability}>
                <View style={styles.availabilityText}>
                  <Text
                    maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
                    allowFontScaling
                    style={styles.availabilityTitle}>
                    {available ? 'Open to New Conversations' : 'Not Taking New Conversations'}
                  </Text>
                  <Text allowFontScaling style={styles.availabilitySub}>
                    {available
                      ? 'You are listed and can be messaged.'
                      : 'You are not listed. Existing chats still work.'}
                  </Text>
                </View>
                <Toggle
                  testID="availability-toggle"
                  value={available}
                  onValueChange={toggle}
                  disabled={setAvailability.isPending}
                  accessibilityLabel="Open to new conversations"
                  tone="presence"
                />
              </View>

              {/* What they offer, directly under what they are open to: the
                  same card, because a provider reasoning about "can anyone
                  reach me" is reasoning about both at once (goal item 7). The
                  last one on is held rather than hidden — a disabled switch
                  says the rule, a missing one would just look broken. The
                  database refuses it too (profiles_at_least_one_channel). */}
              <View style={styles.channels} testID="provider-channels">
                <Text allowFontScaling style={styles.channelsLabel}>
                  What you offer
                </Text>
                {CHANNEL_ROWS.map(row => {
                  const on = channels[row.key];
                  const last = on && enabledCount === 1;
                  return (
                    <View key={row.key} style={styles.channelRow}>
                      <Icon
                        name={row.glyph}
                        size={18}
                        color={on ? theme.color.text.primary : theme.color.text.tertiary}
                      />
                      <View style={styles.channelText}>
                        <Text allowFontScaling style={styles.channelTitle}>
                          {row.title}
                        </Text>
                        {last ? (
                          <Text allowFontScaling style={styles.channelHint}>
                            Keep at least one on so members can reach you.
                          </Text>
                        ) : null}
                      </View>
                      <Toggle
                        testID={`channel-toggle-${row.key}`}
                        value={on}
                        onValueChange={next => toggleChannel(row.key, next)}
                        disabled={setChannels.isPending || last}
                        accessibilityLabel={`Offer ${row.title}`}
                        tone="presence"
                      />
                    </View>
                  );
                })}
              </View>

              {/* Earnings — motivating, never a bleak "0". 1 token = ₹1 (ADR-0021). */}
              <View style={styles.earnCard}>
                <Text allowFontScaling style={styles.earnLabel}>
                  Earned so far
                </Text>
                <Text
                  testID="earned-notice"
                  maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized}
                  allowFontScaling
                  style={styles.earnValue}>
                  ₹{earned}
                </Text>
                <Text allowFontScaling style={styles.earnSub}>
                  {earned > 0
                    ? 'Held for payout. Transfers land in your account.'
                    : 'You keep 60% of every paid minute. It shows up here.'}
                </Text>
                <Pressable
                  onPress={onOpenPayout}
                  testID="open-payout"
                  accessibilityLabel="Set up how you get paid"
                  press="none"
                  highlight="ios"
                  style={styles.payoutRow}>
                  <Icon name="wallet" size={20} color={theme.color.text.onAccent} />
                  <Text allowFontScaling style={styles.payoutLabel}>
                    Get paid
                  </Text>
                  <Icon name="chevronRight" size={18} color={theme.color.text.onAccent} />
                </Pressable>
              </View>

              <View style={styles.stats}>
                <Stat label="Minutes" value={String(earnings?.minutes_billed ?? 0)} testID="stat-minutes" />
                <Stat label="People" value={String(earnings?.members_served ?? 0)} testID="stat-people" />
                <Stat
                  label="Rating"
                  value={profile?.rating_avg != null ? profile.rating_avg.toFixed(1) : 'New'}
                  testID="stat-rating"
                />
              </View>
            </View>
          )}
        />
      )}

      {/* Two-tab bottom nav. Named `tabs`/`tab` so the component-height gate does
          not read it as an M3 row/bar. */}
      <View style={[styles.tabs, { paddingBottom: insets.bottom + TOKENS.space.xs }]}>
        <TabButton
          icon="chat"
          label="Chats"
          active={tab === 'chats'}
          badge={waiting}
          onPress={() => setTab('chats')}
        />
        <TabButton
          icon="person"
          label="You"
          active={tab === 'you'}
          badge={0}
          onPress={() => setTab('you')}
        />
      </View>
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  badge,
  onPress,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  badge: number;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const color = active ? theme.color.text.primary : theme.color.text.tertiary;
  return (
    <Pressable
      onPress={onPress}
      testID={`provider-tab-${label.toLowerCase()}`}
      accessibilityRole="tab"
      checked={active}
      accessibilityLabel={label}
      press="none"
      highlight="ios"
      style={styles.tab}>
      <View>
        <Icon name={icon} size={24} color={color} />
        {badge > 0 ? (
          <View style={styles.tabBadge}>
            <Text allowFontScaling style={styles.tabBadgeText}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text allowFontScaling style={[styles.tabLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text
        maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized}
        testID={testID}
        allowFontScaling
        style={styles.statValue}>
        {value}
      </Text>
      <Text allowFontScaling style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.md,
    },
    headTitle: { ...TOKENS.typography.headlineSmallEmphasized, color: t.color.text.primary },
    spacer: { flex: 1 },
    iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
      gap: TOKENS.space.sm,
    },
    emptyMark: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: t.color.bg.sunken,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: TOKENS.space.xs,
    },
    emptyTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
    },
    emptyBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    youScroll: { flexGrow: 1 },
    you: { gap: TOKENS.space.md, paddingBottom: TOKENS.space.md },
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
    // Channels sit inside the availability card, separated by a hairline rather
    // than a gap: one card, two related questions.
    channels: {
      gap: TOKENS.space.sm,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    channelsLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.secondary },
    channelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      // A switch is a touch target before it is a row, so the M3 minimum is the
      // right floor here rather than a list-row height.
      minHeight: TOKENS.interaction.minTarget,
    },
    channelText: { flex: 1, gap: TOKENS.space.hair },
    channelTitle: { ...TOKENS.typography.bodyLarge, color: t.color.text.primary },
    channelHint: { ...TOKENS.typography.bodySmall, color: t.color.text.tertiary },
    availabilityText: { flex: 1, gap: TOKENS.space.hair },
    availabilityTitle: { ...TOKENS.typography.titleMediumEmphasized, color: t.color.text.primary },
    availabilitySub: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
    earnCard: {
      marginHorizontal: TOKENS.space.md,
      padding: TOKENS.space.lg,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accent,
      gap: TOKENS.space['2xs'],
    },
    earnLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.onAccent, opacity: 0.8 },
    earnValue: { ...TOKENS.typography.headlineMediumEmphasized, color: t.color.text.onAccent },
    earnSub: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.onAccent,
      opacity: 0.85,
      marginBottom: TOKENS.space.xs,
    },
    payoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      height: TOKENS.layout.rowOneLine,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
    },
    payoutLabel: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.onAccent,
      flex: 1,
    },
    stats: {
      flexDirection: 'row',
      paddingHorizontal: TOKENS.space.md,
      gap: TOKENS.space.xl,
    },
    stat: { gap: TOKENS.space.hair },
    statValue: { ...TOKENS.typography.titleLargeEmphasized, color: t.color.text.primary },
    statLabel: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
    list: {},
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
    rowBody: { flex: 1, gap: 3 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: TOKENS.space.xs },
    rowName: { ...TOKENS.typography.titleMediumEmphasized, color: t.color.text.primary, flex: 1 },
    rowTime: { ...TOKENS.typography.bodyMedium, color: t.color.text.tertiary },
    rowPreview: { ...TOKENS.typography.bodyMedium, color: t.color.text.secondary, flex: 1 },
    rowPreviewUnread: { ...TOKENS.typography.labelLargeEmphasized, color: t.color.text.primary },
    unread: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 5,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentStrong,
    },
    unreadCount: { ...TOKENS.typography.numeralSmall, color: t.color.text.onAccent },
    tabs: {
      flexDirection: 'row',
      paddingTop: TOKENS.space.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
      backgroundColor: t.color.bg.base,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.hair,
      paddingVertical: TOKENS.space['2xs'],
    },
    tabLabel: { ...TOKENS.typography.labelSmall },
    tabBadge: {
      position: 'absolute',
      top: -4,
      right: -10,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 5,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentStrong,
    },
    tabBadgeText: { ...TOKENS.typography.numeralSmall, color: t.color.text.onAccent },
  });
