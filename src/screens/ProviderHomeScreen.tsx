import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Image,
  Linking,
  PixelRatio,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary, ProviderPhoto } from '../lib/database.types';
import { MAX_PROVIDER_PHOTOS } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { sizedStorageImageUri } from '../lib/storageImage';
import { listStamp } from '../lib/datetime';
import { track } from '../lib/telemetry';
import { useConversations, useProfile } from '../api/chat';
import {
  useAddProviderPhotos,
  useEarnings,
  useProviderPhotos,
  useRemoveProviderPhoto,
  useSetAvailability,
  useSetChannels,
  useSetPrimaryPhoto,
} from '../api/provider';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadingIndicator } from '../components/LoadingIndicator';
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
const THREAD_AVATAR = 40;
const THREAD_SEPARATOR_INSET = THREAD_AVATAR + TOKENS.space.sm;
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Toggle } from '../components/Toggle';
import { notificationsGranted } from '../lib/push';

/**
 * The gallery tile, in dp. A measured size gets a name rather than sitting as a
 * bare number in three style blocks: three across the 360dp column with the
 * card's own 16dp margins and a 12dp gutter.
 */
const PHOTO_TILE = 88;

/**
 * The remove badge's drawn size, in dp. Named because the touch target is
 * DERIVED from it rather than declared: `Pressable`'s `size` prop turns this
 * into `hitSlop = ceil((interaction.minTarget - 24) / 2) = 12` on every side,
 * so a 24dp disc is pressable across 48dp — "we recommend that each interactive
 * UI element have a focusable area, or touch target size, of at least 48dp ×
 * 48dp".
 * https://developer.android.com/guide/topics/ui/accessibility/apps
 */
const REMOVE_BADGE = 24;

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
  const { data: photos } = useProviderPhotos(profile?.id ?? null);
  const addPhotos = useAddProviderPhotos();
  const setPrimary = useSetPrimaryPhoto();
  const removePhoto = useRemoveProviderPhoto();

  const [tab, setTab] = useState<Tab>('chats');
  const [pendingDelete, setPendingDelete] = useState<ProviderPhoto | null>(null);
  const [pushOk, setPushOk] = useState(true);
  const gallery = photos ?? [];
  const remaining = MAX_PROVIDER_PHOTOS - gallery.length;
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

  /**
   * Add photos.
   *
   * `selectionLimit` greater than 1 routes through `PickMultipleVisualMedia` —
   * the system photo picker, which requires NO runtime permission and is not the
   * MediaStore / READ_MEDIA_IMAGES path AttachPanel refuses on Play-policy
   * grounds. That is already proven in Composer on the installed
   * react-native-image-picker 7.2.3, so this adds no dependency and no native
   * change (RULE 5).
   *
   * Clamped to the free slots so the picker never hands back more than the 070
   * trigger will accept; a clamp of 1 is plain single-select, which is the right
   * behaviour for the last slot.
   *
   * https://developer.android.com/training/data-storage/shared/photopicker
   */
  const pickPhotos = useCallback(async () => {
    if (remaining <= 0) {
      return;
    }
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: Math.max(1, remaining),
      quality: 0.9,
    }).catch(() => null);
    if (result === null || result.didCancel === true) {
      return;
    }
    const drafts = (result.assets ?? [])
      .filter(a => a.uri !== undefined)
      .slice(0, remaining)
      .map(a => ({ uri: a.uri as string, mime: a.type }));
    if (drafts.length > 0) {
      addPhotos.mutate(drafts);
    }
  }, [remaining, addPhotos]);

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
          highlight="dim"
          style={styles.row}>
          <Avatar
            initial={initialOf(label)}
            size={THREAD_AVATAR}
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

  useEffect(() => {
    const refresh = () => {
      void notificationsGranted().then(setPushOk);
    };
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {!pushOk ? (
        <View style={styles.pushGate} testID="provider-push-gate">
          <Text allowFontScaling style={styles.emptyTitle}>
            Turn on notifications
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Chats and calls cannot reach you while notifications are off.
          </Text>
          <Pressable
            onPress={() => {
              Linking.openSettings().catch(() => undefined);
            }}
            accessibilityLabel="Open settings"
            press="button"
            style={styles.pushGateButton}>
            <Text allowFontScaling style={styles.pushGateButtonLabel}>
              Open settings
            </Text>
          </Pressable>
        </View>
      ) : null}
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
                  highlight="dim"
                  size={40}
                  // `iconButton` sets no radius, so the `dim` fill painted a solid
                  // 40dp square behind a 20pt gear. Square box, so the pill
                  // resolves to a true 40dp circle — the M3 icon-button state
                  // layer size exactly.
                  // https://developer.android.com/training/material/animations
                  shape="circle"
                  style={styles.iconButton}>
                  <Icon name="settings" size={TOKENS.icon.md} color={theme.color.text.secondary} />
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
                        size={TOKENS.icon.sm}
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

              {/* The gallery (migration 070). It lives HERE and not in the
                  one-time application flow, because this is the surface a
                  provider comes back to when they want to change what members
                  see — next to what they are open to and what they offer. */}
              <View style={styles.photos} testID="provider-photos">
                <Text allowFontScaling style={styles.channelsLabel}>
                  Your photos
                </Text>
                <Text allowFontScaling style={styles.channelHint}>
                  Members swipe these on your profile. Tap one to make it your main photo.
                </Text>
                {/* One-of-N, so radios and not switches. Toggle.tsx is an M3
                    SWITCH (accessibilityRole="switch"), and a row of switches
                    would say each photo can be the main one independently —
                    which the database (provider_photos_one_primary) makes
                    untrue. Same control the age brackets and the rating stars
                    already use.
                    https://m3.material.io/components/radio-button/guidelines */}
                <View style={styles.photoStrip} accessibilityRole="radiogroup">
                  {gallery.map((p, i) => (
                    <View key={p.id}>
                      <Pressable
                        onPress={() => {
                          if (!p.is_primary) {
                            setPrimary.mutate(p.id);
                          }
                        }}
                        disabled={setPrimary.isPending}
                        testID={`photo-primary-${i}`}
                        accessibilityRole="radio"
                        checked={p.is_primary}
                        accessibilityLabel={`Photo ${i + 1} of ${gallery.length}`}
                        accessibilityHint="Makes this your main photo"
                        press="card"
                        highlight="material"
                        style={[styles.photoTile, p.is_primary && styles.photoTilePrimary]}>
                        <Image
                          source={{
                            uri: sizedStorageImageUri(
                              p.url,
                              PHOTO_TILE,
                              PHOTO_TILE,
                              PixelRatio.get(),
                            ),
                          }}
                          style={styles.photoImg}
                        />
                        {p.is_primary ? (
                          <View style={styles.photoBadge}>
                            <Icon name="check" size={TOKENS.icon.xs} color={theme.color.text.onAccent} />
                          </View>
                        ) : null}
                      </Pressable>
                      {/* Removal is its own small target rather than a second
                          full-width button per photo, and it opens a
                          confirmation rather than acting — the two controls
                          overlap at the corner, so a mis-tap has to be
                          recoverable.

                          THE ABSOLUTE POSITION LIVES ON THIS WRAPPER VIEW, NOT
                          ON THE PRESSABLE — the same gotcha as the favourite
                          heart in ProviderDetailScreen.tsx, and the same fix.
                          `Pressable` splits the caller's style: only the
                          box-sizing keys (BOX_KEYS in Pressable.tsx) reach the
                          touchable root, and `position`/`top`/`right` stay on
                          the inner Animated.View. Set on the Pressable they
                          therefore anchored the badge to the Pressable's own
                          24dp box, and the control laid out in normal flow
                          BELOW the tile instead of on its corner.

                          The 48dp target survives the move: `size` is what makes
                          the hitSlop arithmetic explicit (24 + 2×12), and the
                          slop reaching 8dp past the tile's top and right edges
                          is genuinely pressable, not merely declared. Three
                          things in RN 0.86 have to hold for that and all three
                          were read rather than assumed:
                            * `ReactViewGroup.initView` sets
                              `clipChildren = false` (ReactViewGroup.kt:172), so
                              a child outside the parent's box still draws and
                              still hit-tests;
                            * `TouchTargetHelper.findTouchTargetView` only
                              refuses an out-of-bounds descendant when the
                              ancestor's overflow is hidden/scroll or it clips
                              (TouchTargetHelper.kt:188-208) — every ancestor
                              here is an overflow-visible View, and the tile's
                              own `overflow: 'hidden'` is on a SIBLING;
                            * a child's hitSlop is unioned into the parent's
                              overflow inset by Fabric itself —
                              `contentBounds.unionInPlace(outsetBy(frame,
                              hitSlop))`, YogaLayoutableShadowNode.cpp:777 — so
                              the inset the check above consults already
                              includes this slop.
                          https://reactnative.dev/docs/pressable#hitslop */}
                      <View style={styles.photoRemoveSlot}>
                        <Pressable
                          onPress={() => setPendingDelete(p)}
                          testID={`photo-remove-${i}`}
                          accessibilityLabel={`Remove photo ${i + 1}`}
                          press="none"
                          highlight="dim"
                          size={REMOVE_BADGE}
                          style={styles.photoRemove}>
                          <Icon name="close" size={TOKENS.icon.xs} color={theme.color.text.onInverse} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                  {remaining > 0 ? (
                    <Pressable
                      onPress={() => {
                        void pickPhotos();
                      }}
                      /* `disabled` while the upload is in flight, not `busy`.
                         `busy` is the held-compression state that pairs with
                         `busyLabel` — the participle a Button swaps into its
                         label — and this tile has no label to swap; Pressable
                         accordingly has no `busyLabel`. contract.test's
                         "narrates every mutation a button starts" counts the two
                         props together for exactly that reason, so an icon-only
                         control says "not now" instead of pretending to narrate.
                         The outcome arrives as a notice. */
                      disabled={addPhotos.isPending}
                      testID="photo-add"
                      accessibilityLabel={`Add photos, ${remaining} of ${MAX_PROVIDER_PHOTOS} slots free`}
                      press="card"
                      highlight="material"
                      style={[styles.photoTile, styles.photoAdd]}>
                      <Icon name="plus" size={TOKENS.icon.lg} color={theme.color.text.secondary} />
                    </Pressable>
                  ) : null}
                </View>
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
                  highlight="dim"
                  style={styles.payoutRow}>
                  {/* Both glyphs take the row's own ink, not the card's: the row
                      is `bg/base` now, so `text/onAccent` here would be white on
                      white in light mode. See the note on `payoutRow`. */}
                  <Icon name="wallet" size={TOKENS.icon.md} color={theme.color.text.accent} />
                  <Text allowFontScaling style={styles.payoutLabel}>
                    Get paid
                  </Text>
                  <Icon name="chevronRight" size={TOKENS.icon.sm} color={theme.color.text.accent} />
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

      {/* Removing a photo is not undoable — the object goes with the row — so it
          takes M3's basic confirmation dialog, with the consequence named rather
          than a vague "are you sure". */}
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Remove this photo?"
        body={
          pendingDelete?.is_primary === true
            ? 'It is your main photo. The next one becomes your main photo.'
            : 'Members will no longer see it on your profile.'
        }
        cancelLabel="Keep"
        confirmLabel="Remove"
        destructive
        busy={removePhoto.isPending}
        busyLabel="Removing"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete !== null) {
            removePhoto.mutate(pendingDelete);
          }
          setPendingDelete(null);
        }}
        testID="photo-remove-confirm"
      />

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
      highlight="dim"
      style={styles.tab}>
      <View>
        <Icon name={icon} size={TOKENS.icon.lg} color={color} />
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
    pushGate: {
      ...StyleSheet.absoluteFill,
      zIndex: 20,
      elevation: 20,
      backgroundColor: t.color.bg.base,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
      gap: TOKENS.space.md,
    },
    pushGateButton: {
      marginTop: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space.sm,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accent,
    },
    pushGateButtonLabel: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.onAccent,
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
    /*
     * The gallery block. Hairline-topped like `channels`, but with the same
     * horizontal margin as `availability` and `earnCard` so its label and tiles
     * line up with the rest of the tab rather than running to the screen edge.
     */
    photos: {
      gap: TOKENS.space.sm,
      marginHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    photoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: TOKENS.space.sm },
    photoTile: {
      width: PHOTO_TILE,
      height: PHOTO_TILE,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.sunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The main photo is marked twice — a border AND the check badge — because a
    // ring alone is a colour-only signal (WCAG 2.2 SC 1.4.1).
    photoTilePrimary: { borderWidth: 2, borderColor: t.color.border.accent },
    photoImg: { width: '100%', height: '100%' },
    /*
     * accentStrong on the weaker non-text floor, exactly as `checkboxOn` in
     * ProfileSetupScreen took it: the mark inside is a 14dp `check` Icon rather
     * than a label, so it answers to 3:1 and not 4.5:1 —
     * developer.android.com/guide/topics/ui/accessibility/apps, "For all other
     * text, set the color contrast ratio to at least 3:1". `bg/accent` clears
     * that in light (3.44:1) and misses it in dark (2.59:1), where the accent is
     * a light blue and the tick is `text/onAccent`. 5.19:1 / 6.13:1 here.
     *
     * Included with the earnings card above rather than left for a later pass
     * because it is the same token pair on the same screen, and the header of
     * `__tests__/walletTone.test.ts` exists because splitting this defect by
     * surface is what kept four of the first five wrong.
     */
    photoBadge: {
      position: 'absolute',
      left: TOKENS.space['2xs'],
      bottom: TOKENS.space['2xs'],
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentStrong,
    },
    photoAdd: {
      borderWidth: 1,
      borderColor: t.color.border.strong,
      backgroundColor: 'transparent',
    },
    /*
     * The corner the remove control hangs on. POSITION ONLY, and that split is
     * the point: `position`/`top`/`right` are the properties `Pressable` keeps
     * on its inner view, so they have to be applied by a plain View that wraps
     * it. The control's own box stays below, where Pressable forwards it to the
     * touchable root.
     */
    photoRemoveSlot: {
      position: 'absolute',
      top: -TOKENS.space['2xs'],
      right: -TOKENS.space['2xs'],
    },
    photoRemove: {
      width: REMOVE_BADGE,
      height: REMOVE_BADGE,
      borderRadius: REMOVE_BADGE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
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
    /*
     * accentStrong, not accent — and the card is only half of the fix, because
     * the OPACITY on two of its three labels was the other half.
     *
     * Three labels sit on this fill, all `text/onAccent`, and Android's rule
     * sorts them into two groups —
     * developer.android.com/guide/topics/ui/accessibility/apps ("Increase text
     * visibility"): "If the text is smaller than 18sp, or if the text is bold
     * and smaller than 14sp, use foreground and background colors that result
     * in a color contrast ratio of at least 4.5:1. For all other text, set the
     * color contrast ratio to at least 3:1."
     *
     *   - `earnValue` is 28dp Bold, so it is neither under 18sp nor bold-under-
     *     14sp: it lands in "all other text" at 3:1. On `bg/accent` it passed in
     *     light (3.44:1) and FAILED in dark (2.59:1), because the dark-mode
     *     accent is a light blue. It is 5.19:1 / 6.13:1 here and comfortable.
     *   - `earnLabel` (12dp) and `earnSub` (12dp) are under 18sp, so both take
     *     4.5:1, and both were at 3.44:1 / 2.59:1.
     *
     * THE OPACITY IS PART OF THE MEASUREMENT, which is the thing that makes
     * this card different from the six surfaces fixed in aba2c13. `opacity` on
     * a `Text` composites the whole view, so the rendered ink was not
     * `text/onAccent` at all — it was white at 80% / 85% over the fill, and WCAG
     * measures the pixel that lands. Moving the fill alone would have left them
     * at 3.87:1 and 4.16:1 in light: better, still short, and silently so.
     * At full strength both are 5.19:1 / 6.13:1.
     *
     * Dropping the alpha does not break the rule that the FILL moves and the
     * label never does — `text/onAccent` is still the token on all three. The
     * hierarchy the alpha was buying is already carried by the type scale, 12dp
     * Medium against 28dp Bold, which is a far louder difference than 15% of
     * white; and there is no fill in the palette that carries 80% white at
     * 4.5:1 while still being the accent, so the alpha was the only lever left.
     */
    earnCard: {
      marginHorizontal: TOKENS.space.md,
      padding: TOKENS.space.lg,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
      gap: TOKENS.space['2xs'],
    },
    earnLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.onAccent },
    earnValue: { ...TOKENS.typography.headlineMediumEmphasized, color: t.color.text.onAccent },
    earnSub: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.onAccent,
      marginBottom: TOKENS.space.xs,
    },
    /*
     * The page colour and accent ink, because the card above it is now the fill
     * this row used to be.
     *
     * This row was `bg/accentStrong` on an `bg/accent` card — a deeper step
     * inset into a brighter one, which is what made it read as a control. Once
     * the card takes `accentStrong` for its labels' sake, an unchanged row is
     * the SAME colour as its container: 1.00:1, a "Get paid" button that is not
     * on screen at all. That is a worse outcome than the contrast bug being
     * fixed, so the two moves are one move.
     *
     * It takes the same answer the rest of the app already gives, stated as a
     * rule on `minutesTagOn` in RechargeScreen.tsx: anything inset into a
     * selected/filled accent card takes the page colour and accent ink. See
     * also `ribbonOn` and the compact chip's `popularOn` there. Two accent steps
     * exist; there is no third, so an inset element cannot be a deeper one.
     *
     * The numbers improve on both counts. `text/accent` on `bg/base` is 8.17:1
     * light / 7.54:1 dark, against the 5.19:1 / 6.13:1 the white-on-accentStrong
     * pairing gave, so the 16dp label and the two glyphs are better off. The
     * row's BOUNDARY against the card is 5.19:1 light and 2.63:1 dark — the dark
     * figure is under the 3:1 that WCAG 1.4.11 asks of a component boundary, and
     * it is named here rather than glossed: it is the same figure every other
     * inset pill in the app already carries, the row is identified by a wallet
     * glyph, a bold label and a chevron rather than by its edge alone, and it is
     * a large improvement on the 2.37:1 the old accentStrong-on-accent nesting
     * measured. Closing it properly needs a third accent step, which is a
     * palette decision and not this change's to make.
     */
    payoutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      height: TOKENS.layout.rowOneLine,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.base,
    },
    payoutLabel: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.accent,
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
