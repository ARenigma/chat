import React, { useCallback, useMemo, useState } from 'react';
import { Image, PixelRatio, StyleSheet, Text, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { sectionIn, sectionOut } from '../theme/motion';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderPhoto } from '../lib/database.types';
import { MAX_PROVIDER_PHOTOS } from '../lib/database.types';
import { sizedStorageImageUri } from '../lib/storageImage';
import { AVAILABILITY, useAvailabilityToggle } from '../lib/providerAvailability';
import { useProfile } from '../api/chat';
import {
  useAddProviderPhotos,
  useEarnings,
  useProviderPhotos,
  useRemoveProviderPhoto,
  useSetChannels,
  useSetPrimaryPhoto,
} from '../api/provider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { RupeeAmount } from '../components/RupeeAmount';
import { Toggle } from '../components/Toggle';
import { SettingsSheet } from './SettingsSheet';

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
  onOpenPayout: () => void;
  /** Per-session earnings ledger, opened from the settings list. */
  onOpenUsage: () => void;
  /** The provider's blocked-members list, opened from the settings list. */
  onOpenBlocked: () => void;
  /** Sign-out and account deletion, forwarded into SettingsSheet. */
  onSignedOut: () => void;
  onDeleted: () => void;
  /**
   * What the settings scroll clears at its foot. The host's bottom nav owns the
   * safe-area inset, so today this is plain breathing room; under the
   * navigator it becomes the bar offset (useBottomBarOffset).
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
 * The provider's You tab: everything about them and their money —
 * availability, what they offer, their photos, what they have earned (60%
 * share, ADR-0021; 1 token = ₹1), payout setup and stats — above the shared
 * settings list.
 *
 * The "You" tab IS the settings surface, exactly like the member tree — one
 * screen, not a dashboard with a second Settings behind a gear. The
 * provider-only controls ride in as SettingsSheet's `topSection`, above the
 * shared account/privacy list, and the header/search/profile hero come from the
 * sheet itself.
 *
 * Earnings show with a payout-pending note because the transfer is manual for
 * now (docs/provider-payouts.md); the figure is a correct accrual, not yet paid.
 *
 * Split out of ProviderHomeScreen in navigation step 6 so it can become the
 * provider YouTab root. It owns the photo-remove confirmation too, because the
 * only thing that opens it lives here.
 */
export function ProviderYouScreen({
  onOpenPayout,
  onOpenUsage,
  onOpenBlocked,
  onSignedOut,
  onDeleted,
  bottomOffset = TOKENS.space['3xl'],
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { data: profile } = useProfile();
  const { data: earnings } = useEarnings();
  const { toggle, pending: availabilityPending } = useAvailabilityToggle();
  const setChannels = useSetChannels();
  const { data: photos } = useProviderPhotos(profile?.id ?? null);
  const addPhotos = useAddProviderPhotos();
  const setPrimary = useSetPrimaryPhoto();
  const removePhoto = useRemoveProviderPhoto();

  const [pendingDelete, setPendingDelete] = useState<ProviderPhoto | null>(null);
  const gallery = photos ?? [];
  const remaining = MAX_PROVIDER_PHOTOS - gallery.length;
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

  /**
   * Add photos.
   *
   * `selectionLimit` greater than 1 routes through `PickMultipleVisualMedia` —
   * the system photo picker, which requires NO runtime permission and is not
   * the MediaStore / READ_MEDIA_IMAGES path the app refuses on Play-policy
   * grounds (the manifest removes that permission; see
   * `__tests__/contract.test.ts` › "never declares a restricted media-read
   * permission"). This is now the ONLY picker in the app — the chat's attach
   * panel was deleted on 2026-09-19 — and it adds no dependency and no native
   * change on the installed react-native-image-picker 7.2.3 (RULE 5).
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

  const earned = earnings?.provider_tokens ?? 0;

  return (
    <>
      <SettingsSheet
        bottomOffset={bottomOffset}
        onSignedOut={onSignedOut}
        onDeleted={onDeleted}
        onUsage={onOpenUsage}
        onBlocked={onOpenBlocked}
        topSection={
        <View style={styles.controls}>
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
              controls line up with the photos, earnings and stats blocks
              below rather than running to the screen edge. */}
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
                        uri:
                          sizedStorageImageUri(
                            p.url,
                            PHOTO_TILE,
                            PHOTO_TILE,
                            PixelRatio.get(),
                          ) ?? undefined,
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
            {/*
             * `₹{earned}` was a hand-built string with no thousands
             * grouping — an earnings figure past 999 would have printed
             * "₹12500" rather than "₹12,500". Found during the ₹ glyph
             * sweep alongside TokenCounter's doubled glyph; `RupeeAmount`
             * routes through `formatRupees`, so both defects are the same
             * fix.
             */}
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
        }
      />

      {/* Removing a photo is not undoable — the object goes with the row — so it
          takes M3's basic confirmation dialog, with the consequence named rather
          than a vague "are you sure".

          THREE BRANCHES, NOT TWO. "The next one becomes your main photo" is
          what 070's AFTER trigger does — it promotes the oldest survivor — but
          only while there IS a survivor. On the last photo the same trigger
          nulls the mirrored scalar instead (pgTAP 320, case 13: "emptying the
          gallery nulls avatar_url"), and ProviderDetailScreen's hero then draws
          the coral gradient with the provider's initial over it. The two-branch
          version promised a successor that does not exist, on the one removal
          that changes what members see most. */}
      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Remove this photo?"
        body={
          pendingDelete?.is_primary !== true
            ? 'Members will no longer see it on your profile.'
            : gallery.length > 1
              ? 'It is your main photo. The next one becomes your main photo.'
              : 'It is your only photo. Members will see your initial until you add another.'
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
    </>
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
    controls: { gap: TOKENS.space.md, paddingTop: TOKENS.space.md },
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
    // a hairline rather than a gap: one card, two related questions. The
    // hairline spans the card's inner width (padding to padding), which is why
    // this block carries no horizontal inset of its own.
    channels: {
      gap: TOKENS.space.sm,
      marginTop: TOKENS.space.sm,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    channelsLabel: { ...TOKENS.typography.textSmSemiBold, color: t.color.text.secondary },
    /*
     * The gallery block. Hairline-topped like `channels`; the sheet's own scroll
     * padding insets it, so its label and tiles line up with the settings rows
     * rather than running to the screen edge.
     */
    photos: {
      gap: TOKENS.space.sm,
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
      gap: TOKENS.space.xl,
    },
    stat: { gap: TOKENS.space.hair },
    statValue: { ...TOKENS.typography.titleLargeEmphasized, color: t.color.text.primary },
    statLabel: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
  });
