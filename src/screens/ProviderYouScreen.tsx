import React, { useCallback, useMemo } from 'react';
import { Image, PixelRatio, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { sectionIn, sectionOut } from '../theme/motion';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { MAX_PROVIDER_PHOTOS } from '../lib/database.types';
import { sizedStorageImageUri } from '../lib/storageImage';
import { AVAILABILITY, useAvailabilityToggle } from '../lib/providerAvailability';
import { getPaidStatus } from '../lib/payoutStatus';
import { useProfile } from '../api/chat';
import {
  useEarnings,
  usePayoutAccount,
  usePayoutReadiness,
  useProviderPhotos,
  useSetChannels,
} from '../api/provider';
import { Icon, type IconName } from '../components/Icon';
import { RupeeAmount } from '../components/RupeeAmount';
import { Toggle } from '../components/Toggle';
import { SettingsSheet } from './SettingsSheet';

/** The "Your photos" row's thumbnails: how many, and how big, in dp. */
const THUMB_COUNT = 3;
const THUMB = 28;

interface Props {
  onOpenPayout: () => void;
  /** The "Your photos" sub-page (owner, 2026-09-25, Option A). */
  onOpenPhotos: () => void;
  /** The Edit profile page: headline, about, languages, expertise. */
  onOpenEditProfile: () => void;
  /** Per-session earnings ledger, opened from the settings list. */
  onOpenUsage: () => void;
  /** The provider's blocked-members list, opened from the settings list. */
  onOpenBlocked: () => void;
  /** Sign-out and account deletion, forwarded into SettingsSheet. */
  onSignedOut: () => void;
  onDeleted: () => void;
  /**
   * What the settings scroll clears at its foot. Unset, SettingsSheet clears
   * the bottom bar (`useBottomBarOffset`), which overlays the tab since
   * navigation step 7.
   */
  bottomOffset?: number;
}

/** The three channel switches, in the order the member's own buttons sit. */
type ChannelKey = 'chat_enabled' | 'audio_enabled' | 'video_enabled';

const CHANNEL_ROWS: readonly { key: ChannelKey; title: string; glyph: IconName }[] = [
  { key: 'chat_enabled', title: 'Chat', glyph: 'chat' },
  { key: 'audio_enabled', title: 'Voice calls', glyph: 'call' },
  { key: 'video_enabled', title: 'Video calls', glyph: 'video' },
];

/**
 * The provider's You tab, re-laid like Bluesky and the industry apps (owner,
 * 2026-09-25, "Option A approved"): the EARNINGS card first with its KPI
 * stats inside, then AVAILABILITY (the master switch and the channels under
 * it), then the grouped settings list — Your profile (Edit profile, Your
 * photos), Money (Get paid with its verification status, Earnings by
 * session), App, Legal.
 *
 * The "You" tab IS the settings surface, exactly like the member tree — one
 * screen, not a dashboard with a second Settings behind a gear. The two cards
 * ride in as SettingsSheet's `topSection`; the provider rows as `extraRows`,
 * so the sheet's search filters them with the rest.
 *
 * The gallery moved to its own page (ProviderPhotosScreen), and the
 * photo-remove confirmation with it. Nothing here animates beyond the
 * channels' existing collapse: settings rows are a tens-a-day surface, and
 * the frequency gate leaves them the press state layer alone.
 */
export function ProviderYouScreen({
  onOpenPayout,
  onOpenPhotos,
  onOpenEditProfile,
  onOpenUsage,
  onOpenBlocked,
  onSignedOut,
  onDeleted,
  bottomOffset,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { data: profile } = useProfile();
  const { data: earnings } = useEarnings();
  const { toggle, pending: availabilityPending } = useAvailabilityToggle();
  const setChannels = useSetChannels();
  const { data: photos } = useProviderPhotos(profile?.id ?? null);
  const { data: readiness } = usePayoutReadiness();
  const { data: payoutAccount } = usePayoutAccount();
  const gallery = photos ?? [];
  const available = profile?.is_available ?? false;
  const availabilityCopy = AVAILABILITY[available ? 'on' : 'off'];
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
   * A channel switch, and the one case where it is not a channel write at all.
   *
   * Turning off the LAST channel that is on writes `is_available = false`
   * instead. Three things make that the right write rather than a clever one:
   *
   *   - The database refuses the alternative outright.
   *     `profiles_at_least_one_channel` (064) is
   *     `check (chat_enabled or audio_enabled or video_enabled)`, so the patch
   *     this branch skips is a patch that comes back as a constraint error and
   *     a notice. Amit's "max 2 can be turned off" and that CHECK are the same
   *     rule said twice; nothing in the schema had to move for this.
   *   - It is what the provider meant. "I do not want chat, and chat is all I
   *     was offering" is not an invalid state, it is being closed — which is
   *     precisely the state the master switch holds.
   *   - THE THREE COLUMNS ARE LEFT ALONE, which is what makes re-opening
   *     restore the provider's own last choice instead of resetting them to
   *     all-on. The section collapses, so the switch they just tapped leaves
   *     the screen rather than visibly springing back at them.
   *
   * `toggle` and not a bare `setAvailability.mutate`, so this closure narrates
   * the same `availability_changed` event the two switches do; the reason the
   * provider closed is not a distinction the event carries, and inventing a
   * second name for it would need a migration to `guard_event_shape`.
   */
  const toggleChannel = useCallback(
    (key: ChannelKey, next: boolean) => {
      if (!next && enabledCount === 1) {
        toggle(false);
        return;
      }
      setChannels.mutate({ [key]: next });
    },
    [enabledCount, setChannels, toggle],
  );

  const earned = earnings?.provider_tokens ?? 0;
  const status = getPaidStatus(readiness, payoutAccount);
  const thumbs = gallery.slice(0, THUMB_COUNT);

  return (
    <SettingsSheet
      bottomOffset={bottomOffset}
      onSignedOut={onSignedOut}
      onDeleted={onDeleted}
      onUsage={onOpenUsage}
      onBlocked={onOpenBlocked}
      extraRows={{
        'edit-profile': {
          icon: 'person',
          title: 'Edit profile',
          detail: 'Headline, about, languages and what you help with',
          onPress: onOpenEditProfile,
          testID: 'you-edit-profile',
          accessibilityLabel: 'Edit profile',
        },
        photos: {
          icon: 'image',
          title: 'Your photos',
          detail:
            gallery.length === 0
              ? 'Add photos members see on your profile'
              : `${gallery.length} of ${MAX_PROVIDER_PHOTOS}`,
          trailing:
            thumbs.length > 0 ? (
              <View style={styles.thumbs} importantForAccessibility="no-hide-descendants">
                {thumbs.map(p => (
                  <Image
                    key={p.id}
                    source={{
                      uri: sizedStorageImageUri(p.url, THUMB, THUMB, PixelRatio.get()) ?? undefined,
                    }}
                    style={styles.thumb}
                  />
                ))}
              </View>
            ) : undefined,
          onPress: onOpenPhotos,
          testID: 'you-photos',
          accessibilityLabel: `Your photos, ${gallery.length} of ${MAX_PROVIDER_PHOTOS}`,
        },
        'get-paid': {
          icon: 'wallet',
          title: 'Get paid',
          detail: status.label,
          detailTone: status.tone === 'action' ? 'attention' : 'default',
          trailing:
            status.tone === 'verified' ? (
              <Icon name="badgeCheck" size={TOKENS.icon.sm} color={theme.color.text.accent} />
            ) : undefined,
          onPress: onOpenPayout,
          testID: 'you-get-paid',
          accessibilityLabel: `Get paid, ${status.label}`,
        },
      }}
      topSection={
        <View style={styles.controls}>
          {/* EARNINGS FIRST (owner, 2026-09-25, Option A): what they have made
              is the first question a provider opens this tab with, and the
              KPI stats sit inside the same card rather than floating below
              it, so the money reads as one block. The data is what
              `provider_earnings` (038) offers: the accrued share, minutes
              billed, members served, and the rating from the profile. It has
              no today/this-week split, so none is invented here.

              Earnings — motivating, never a bleak "0". 1 token = ₹1 (ADR-0021).
              The figure is a correct accrual held for a manual payout
              (docs/provider-payouts.md), so its note says held, not paid. */}
          <View style={styles.earnCard} testID="provider-earnings">
            <Text allowFontScaling style={styles.earnLabel}>
              Earned so far
            </Text>
            {/* `RupeeAmount` routes through `formatRupees`, so an earnings
                figure past 999 prints "₹12,500" and not "₹12500". */}
            <RupeeAmount
              value={earned}
              testID="earned-notice"
              maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized}
              allowFontScaling
              style={styles.earnValue}
            />
            <Text allowFontScaling style={styles.earnSub}>
              {earned > 0
                ? 'Held for payout. Transfers land in your account.'
                : 'You keep 60% of every paid minute. It shows up here.'}
            </Text>
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

          {/* Availability and what they offer are ONE inset card, and as of
              2026-09-17 they are ONE QUESTION rather than two related ones:
              a master switch with the three channels collapsed under it.
              Amit: "open to conversation is redundant when we are also
              taking toggle for chat, audio call and video call".

              He was right, and the fix is a hierarchy rather than a
              deletion. As four peers, `is_available` overlapped the three —
              "open" and "offering chat" are the same claim said twice, and
              the four could disagree. As a master it does not overlap
              anything: it is the gate, and the three say what comes through
              it. Closed is one state to read instead of four.

              Kept as a single card (not two edge-bleeding siblings) so its
              controls line up with the earnings card above rather than
              running to the screen edge. */}
          <View style={styles.availabilityCard}>
            {/* Availability — the one control with an immediate effect on
                whether anyone new can reach them. The Chats header carries
                the same switch on the same value; this is the copy that
                explains what it does, which is why both survive rather than
                one moving.

                THE HEADER SWITCH IS UNCHANGED BY THE RESTRUCTURE and that
                is the point of it: it writes the same column through the
                same mutation, so closing from the header closes here too
                and the children are already collapsed by the time the
                provider opens this tab. It grows no children of its own — a
                three-row disclosure hanging off a top app bar would be a
                second, differently-shaped control for one value, which is
                the drift the vocabulary block above exists to prevent. */}
            <View style={styles.availabilityRow}>
              <View style={styles.availabilityText}>
                <Text
                  maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
                  allowFontScaling
                  style={styles.availabilityTitle}>
                  {availabilityCopy.title}
                </Text>
                <Text allowFontScaling style={styles.availabilitySub}>
                  {availabilityCopy.sub}
                </Text>
              </View>
              <Toggle
                testID="availability-toggle"
                value={available}
                onValueChange={toggle}
                disabled={availabilityPending}
                accessibilityLabel="Open to new conversations"
                tone="presence"
              />
            </View>

            {/* What they offer, directly under what they are open to,
                separated by a hairline rather than a gap — and MOUNTED ONLY
                WHILE THE MASTER IS ON.

                Collapsing rather than disabling, because a row of dimmed
                switches under a switch that is off is three controls
                explaining that they do not apply. The values behind them
                are never written by the collapse, so re-opening restores
                the provider's own last choice rather than resetting them to
                all-on: what is hidden is the question, not the answer.

                The last one on is no longer HELD. It used to be disabled,
                and a disabled switch was the honest thing to do while these
                were peers — the database refuses the all-off update
                (profiles_at_least_one_channel, 064) so the UI said the rule
                rather than letting a provider discover it as an error. Now
                that there is a master, the same tap has a meaning the
                schema agrees with: it closes them. `toggleChannel` carries
                that, and the hint below says so BEFORE the tap, because a
                control that quietly does something larger than it looks is
                worse than one that refuses. */}
            {available ? (
              <Animated.View
                entering={sectionIn}
                exiting={sectionOut}
                style={styles.channels}
                testID="provider-channels">
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
                            Turning off your last one closes you to new
                            conversations.
                          </Text>
                        ) : null}
                      </View>
                      <Toggle
                        testID={`channel-toggle-${row.key}`}
                        value={on}
                        onValueChange={next => toggleChannel(row.key, next)}
                        disabled={setChannels.isPending || availabilityPending}
                        /* The consequence is in the row's own hint text,
                           which TalkBack reaches before this switch, so the
                           label only has to say WHICH switch is the one the
                           hint is about. */
                        accessibilityLabel={
                          last ? `Offer ${row.title}, your last one` : `Offer ${row.title}`
                        }
                        tone="presence"
                      />
                    </View>
                  );
                })}
              </Animated.View>
            ) : null}
          </View>
        </View>
      }
    />
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
    // The provider-only block SettingsSheet renders as its `topSection`, between
    // the profile hero and the settings list. No horizontal inset of its own —
    // the sheet's scroll already pads the content — so the cards line up with the
    // settings rows below rather than sitting further in.
    controls: { gap: TOKENS.space.md, paddingTop: TOKENS.space.md, paddingBottom: TOKENS.space.md },
    // The card itself: the inset frame the availability row and the channel
    // switches share, so both read as one card, two related questions.
    availabilityCard: {
      padding: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
    availabilityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.md,
    },
    // Channels sit inside the availability card, separated from the row above by
    // a hairline rather than a gap: one card, two related questions.
    channels: {
      gap: TOKENS.space.sm,
      marginTop: TOKENS.space.sm,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    channelsLabel: { ...TOKENS.typography.textSmSemiBold, color: t.color.text.secondary },
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
     * accentStrong, not accent, and every label on it at full strength.
     *
     * Five labels sit on this fill, all `text/onAccent`, and Android's rule
     * sorts them into two groups —
     * developer.android.com/guide/topics/ui/accessibility/apps ("Increase text
     * visibility"): "If the text is smaller than 18sp, or if the text is bold
     * and smaller than 14sp, use foreground and background colors that result
     * in a color contrast ratio of at least 4.5:1. For all other text, set the
     * color contrast ratio to at least 3:1."
     *
     *   - `earnValue` (28dp Bold) and `statValue` (22dp Bold) are "all other
     *     text" at 3:1; on `bg/accent` the value FAILED in dark (2.59:1).
     *   - `earnLabel`, `earnSub` and `statLabel` (12dp) take 4.5:1.
     * On accentStrong every one is 5.19:1 light / 6.13:1 dark.
     *
     * THE OPACITY IS PART OF THE MEASUREMENT: `opacity` on a `Text`
     * composites the whole view, so white at 80% is not `text/onAccent` and
     * WCAG measures the pixel that lands. No label here carries an alpha; the
     * hierarchy is the type scale's job. `__tests__/walletTone.test.ts` pins
     * both halves.
     *
     * The stats moved INTO this card in the provider IA (Option A), so they
     * take the card's ink rather than the page's.
     */
    earnCard: {
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
    stats: {
      flexDirection: 'row',
      gap: TOKENS.space.xl,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.text.onAccent,
    },
    stat: { gap: TOKENS.space.hair },
    statValue: { ...TOKENS.typography.titleLargeEmphasized, color: t.color.text.onAccent },
    statLabel: { ...TOKENS.typography.bodySmall, color: t.color.text.onAccent },
    // The photos row's strip: a few thumbnails before the chevron, the row's
    // preview of what the sub-page holds. Decorative, hidden from TalkBack;
    // the row's label carries the count.
    thumbs: { flexDirection: 'row', gap: TOKENS.space['2xs'], marginRight: TOKENS.space.xs },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
  });
