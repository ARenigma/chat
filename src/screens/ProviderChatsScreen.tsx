import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { listStamp } from '../lib/datetime';
import { AVAILABILITY, useAvailabilityToggle } from '../lib/providerAvailability';
import { useConversations, useProfile } from '../api/chat';
import { useConversationLabels } from '../api/conversationLabels';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { Pressable } from '../components/Pressable';
import { Toggle } from '../components/Toggle';

/*
 * OWN CONSTANTS since 2026-09-08, where this used to import ROW_AVATAR and
 * ROW_SEPARATOR_INSET from ProviderRow.
 *
 * That import was fine while both lists were 40dp inbox-shaped rows, and it
 * silently became wrong when the directory row was rebuilt as an Astrotalk card
 * with a 76dp ringed avatar: this screen would have inherited a 76dp face on
 * every thread and a separator inset 36dp further in, without a line of it
 * being edited.
 *
 * The two lists are answering different questions — this is the provider's own
 * inbox, which should look like an inbox — so the seam belongs here rather than
 * in a shared constant that happens to suit both.
 */
export const THREAD_AVATAR = 40;
const THREAD_SEPARATOR_INSET = THREAD_AVATAR + TOKENS.space.sm;

interface Props {
  onOpenConversation: (peerId: string) => void;
}

/**
 * One row of the provider's inbox: a conversation, or a section header.
 *
 * A bare `string` IS the header, rather than a tagged object, because there is
 * exactly one header and `typeof row === 'string'` is a narrowing every reader
 * already knows. A `{ kind: 'header' }` wrapper would buy nothing here and cost
 * a discriminant on every conversation row.
 */
type ProviderRow = ConversationSummary | string;

/** The only section header the inbox has. */
const SECTION_MINE = 'Your own conversations';

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
 * The provider's Chats tab: the conversations that ARE the work (Amit,
 * 2026-09-03). A brand-new provider with none gets a calm watermark rather than
 * a bleak blank, because the first thing supply sees cannot read as "nothing
 * happens here".
 *
 * Split out of ProviderHomeScreen in navigation step 6 so it can become the
 * ChatsTab root. It owns its own top inset (the head), and reads everything it
 * shows from shared queries, so mounting it next to Saved and You costs no
 * second request. The push gate is not drawn here: ProviderPushGateProvider
 * owns it, and the host decides where the overlay sits.
 */
export function ProviderChatsScreen({ onOpenConversation }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: profile } = useProfile();
  const { data: allThreads, isPending } = useConversations();
  const { data: conversationLabels } = useConversationLabels();
  const { toggle, pending: availabilityPending } = useAvailabilityToggle();
  const available = profile?.is_available ?? false;
  const availabilityCopy = AVAILABILITY[available ? 'on' : 'off'];

  /**
   * Two groups, because a provider can be on either side of a thread (a provider
   * who was a member first keeps the threads they paid for). `i_am_member` is the
   * per-conversation answer `profiles.role` cannot give (migration 007).
   */
  const work = useMemo(() => (allThreads ?? []).filter(t => !t.i_am_member), [allThreads]);

  /*
   * ONE FLAT ARRAY, not sections — this was a `SectionList` until 2026-09-12.
   *
   * FlashList has no `sections` prop, by design: sections are expressed as a
   * flat list with header ROWS in it, plus `stickyHeaderIndices` for the ones
   * that should pin. That is the same shape a SectionList builds internally,
   * with the nesting made explicit.
   *
   * `getItemType` below is the part that is easy to miss and is the whole point
   * of doing it this way: FlashList RECYCLES row views, and a header and a
   * conversation row have nothing in common, so without a type hint it would
   * recycle one into the other and pay a full re-layout each time. Telling it
   * they are different types keeps two separate recycle pools.
   */
  const rows = useMemo<readonly ProviderRow[]>(() => {
    const mine = (allThreads ?? []).filter(t => t.i_am_member);
    const out: ProviderRow[] = [...work];
    if (mine.length > 0) {
      out.push(SECTION_MINE, ...mine);
    }
    return out;
  }, [allThreads, work]);

  /*
   * Which rows pin. Derived rather than hardcoded: the header only exists when
   * the member-side group is non-empty, so its index depends on how many work
   * threads are above it.
   */
  const stickyHeaderIndices = useMemo(
    () =>
      rows.reduce<number[]>((acc, row, i) => {
        if (typeof row === 'string') {
          acc.push(i);
        }
        return acc;
      }, []),
    [rows],
  );

  const getItemType = useCallback(
    (item: ProviderRow) => (typeof item === 'string' ? 'header' : 'thread'),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: ProviderRow }) => {
      if (typeof item === 'string') {
        return (
          <Text allowFontScaling style={styles.sectionTitle}>
            {item}
          </Text>
        );
      }
      const unreadCount = item.i_am_member
        ? Number(item.unread_count_member)
        : Number(item.unread_count_provider);
      const unread = unreadCount > 0;
      // A private custom label (migration 098) wins; else the member's published
      // name; else a number — members are not in the directory and share no name.
      const label =
        conversationLabels?.get(item.conversation_id) ??
        item.peer_display_name ??
        `Member ${item.peer_id.slice(0, 4)}`;
      return (
        <Pressable
          onPress={() => onOpenConversation(item.peer_id)}
          testID={`provider-thread-${item.peer_id}`}
          accessibilityLabel={`${label}${unread ? ', waiting for a reply' : ''}`}
          press="none"
          highlight="dim"
          style={styles.row}>
          <Avatar
            uri={item.peer_avatar_url ?? undefined}
            initial={initialOf(label)}
            size={THREAD_AVATAR}
            online={
              // The server's `peer_online` (migration 155). The peer here is a
              // member, whose presence is never published, so this is false by
              // construction and the dot stays unlit; a provider peer (a member
              // admitted as a provider keeps their threads) lights as everywhere.
              readPresence({
                online: item.peer_online,
                lastSeenAt: item.peer_last_seen_at,
                now: new Date(),
              }).here
            }
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
    [onOpenConversation, styles, conversationLabels],
  );

  const separator = useCallback(() => <View style={styles.separator} />, [styles]);

  return (
    <View style={styles.root}>
      <View style={[styles.head, { paddingTop: insets.top + TOKENS.space.xs }]}>
        <Text
          allowFontScaling={false}
          style={styles.headWordmark}>
          Pappal
        </Text>
        {/* THE SAME SWITCH AS THE ONE ON THE YOU TAB, not a second control.
            The member's bar carries the wallet in this slot because the
            number that decides whether they can act is their balance; the
            provider's equivalent is whether work can reach them at all, and
            burying it a tab away meant the empty state had to send them
            looking for it.

            It holds no state of its own: `available` is
            `profile.is_available` straight off the shared query and
            `toggle` is the one `setAvailability.mutate` call, so the two
            switches are two views of one value and cannot disagree — the
            card's switch moves the instant this one settles, and both
            narrate the same `availability_changed` event.

            Geometry is unchanged apart from `space-between`, which is what
            TabTopBar's `nav` already uses to push its trailing controls
            right. The head's paddings are untouched and the bar does not
            grow: the M3 track is 32dp against the wordmark's 34dp line box,
            so the wordmark still sets the height. The 48dp touch target is
            Toggle's own hitSlop, ceil((48 - 32) / 2) = 8 a side —
            https://developer.android.com/guide/topics/ui/accessibility/apps */}
        <View style={styles.headAvailability}>
          <Text allowFontScaling numberOfLines={1} style={styles.headAvailabilityLabel}>
            {availabilityCopy.head}
          </Text>
          <Toggle
            testID="availability-toggle-head"
            value={available}
            onValueChange={toggle}
            disabled={availabilityPending}
            accessibilityLabel="Open to new conversations"
            tone="presence"
          />
        </View>
      </View>
      {isPending ? (
        <View style={styles.centre}>
          <LoadingIndicator size={48} />
        </View>
      ) : rows.length === 0 ? (
        // The watermark a brand-new provider sees. Clean and calm, not "0".
        <View style={styles.empty}>
          <View style={styles.emptyMark}>
            <Icon name="chat" size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
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
              : // The switch is in the bar directly above this now, so
                // sending them to the You tab would point past the control.
                'Turn on availability above so members can reach you.'}
          </Text>
        </View>
      ) : (
        <FlashList
          {...SCROLL_PHYSICS}
          data={rows as ProviderRow[]}
          keyExtractor={r => (typeof r === 'string' ? r : r.conversation_id)}
          renderItem={renderItem}
          getItemType={getItemType}
          stickyHeaderIndices={stickyHeaderIndices}
          ItemSeparatorComponent={separator}
          contentContainerStyle={[styles.list, { paddingBottom: TOKENS.space['2xl'] }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      // The wordmark leads, the availability switch trails — the same split
      // TabTopBar's `nav` uses for the member's bar, so the two bars put their
      // trailing control in the same place. Paddings are the ones this head
      // already had; nothing about its box moved.
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.md,
    },
    headAvailability: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    // The state in a word, beside the switch that sets it. The switch already
    // carries the state twice over — sage track, and M3's check inside the on
    // thumb, so it is not colour alone (WCAG 2.2 SC 1.4.1) — but a switch alone
    // in a bar has no subject: it says something is on without saying what. The
    // word is what a provider glancing at the bar actually reads, and it is the
    // card's own Open/Closed vocabulary rather than a second one.
    headAvailabilityLabel: {
      ...TOKENS.typography.textSmSemiBold,
      color: t.color.text.secondary,
    },
    headWordmark: {
      fontFamily: TOKENS.face.wordmark,
      fontSize: 28,
      lineHeight: 34,
      color: t.color.bg.accent,
    },
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
    list: {},
    // Bluesky section header (ModuleHeader TitleText text_lg font_semi_bold,
    // Container pt_2xl 24 / pb_md 12) in primary ink, like Home's Chats and
    // Explore (ADR-0033).
    sectionTitle: {
      ...TOKENS.typography.textLgSemiBold,
      color: t.color.text.primary,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xl,
      paddingBottom: TOKENS.space.sm,
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
      marginLeft: TOKENS.space.md + THREAD_SEPARATOR_INSET,
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
  });
