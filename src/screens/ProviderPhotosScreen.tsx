import React, { useCallback, useState } from 'react';
import { Image, PixelRatio, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderPhoto } from '../lib/database.types';
import { MAX_PROVIDER_PHOTOS } from '../lib/database.types';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { sizedStorageImageUri } from '../lib/storageImage';
import { useProfile } from '../api/chat';
import {
  useAddProviderPhotos,
  useProviderPhotos,
  useRemoveProviderPhoto,
  useSetPrimaryPhoto,
} from '../api/provider';
import { BackButton } from '../components/BackButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

/**
 * The gallery tile, in dp: three across the 360dp column with the page's
 * 16dp margins and a 12dp gutter.
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
  onBack: () => void;
}

/**
 * "Your photos": the provider's gallery (migration 070) on its own page,
 * pushed from the You tab's "Your photos" row (owner, 2026-09-25, Option A).
 * It left the You tab so the tab reads as money and availability first; a
 * gallery is edited occasionally and looked at rarely, which is a sub-page's
 * frequency, not a tab root's.
 *
 * The push is the stack's default transition; nothing on the page animates
 * (a gallery a provider manages a few times a month has no motion to earn).
 * It owns the photo-remove confirmation, because the only thing that opens it
 * lives here.
 */
export function ProviderPhotosScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const { data: profile } = useProfile();
  const { data: photos } = useProviderPhotos(profile?.id ?? null);
  const addPhotos = useAddProviderPhotos();
  const setPrimary = useSetPrimaryPhoto();
  const removePhoto = useRemoveProviderPhoto();

  const [pendingDelete, setPendingDelete] = useState<ProviderPhoto | null>(null);
  const gallery = photos ?? [];
  const remaining = MAX_PROVIDER_PHOTOS - gallery.length;

  /**
   * Add photos.
   *
   * `selectionLimit` greater than 1 routes through `PickMultipleVisualMedia` —
   * the system photo picker, which requires NO runtime permission and is not
   * the MediaStore / READ_MEDIA_IMAGES path the app refuses on Play-policy
   * grounds (the manifest removes that permission; see
   * `__tests__/contract.test.ts` › "never declares a restricted media-read
   * permission"). It adds no dependency and no native change on the installed
   * react-native-image-picker 7.2.3 (RULE 5).
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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="provider-photos-screen">
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="photos-back" style={styles.barIcon} />
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          allowFontScaling
          style={styles.barTitle}>
          Your photos
        </Text>
      </View>
      <ScrollView
        {...SCROLL_PHYSICS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: barOffset }]}>
        <View style={styles.photos} testID="provider-photos">
          <Text allowFontScaling style={styles.hint}>
            Members swipe these on your profile. Tap one to make it your main photo.
            {` ${gallery.length} of ${MAX_PROVIDER_PHOTOS}.`}
          </Text>
          {/* One-of-N, so radios and not switches. Toggle.tsx is an M3
              SWITCH (accessibilityRole="switch"), and a row of switches
              would say each photo can be the main one independently —
              which the database (provider_photos_one_primary) makes
              untrue.
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
                        sizedStorageImageUri(p.url, PHOTO_TILE, PHOTO_TILE, PixelRatio.get()) ??
                        undefined,
                    }}
                    style={styles.photoImg}
                  />
                  {p.is_primary ? (
                    <View style={styles.photoBadge}>
                      <Icon name="check" size={TOKENS.icon.xs} color={theme.color.text.onAccent} />
                    </View>
                  ) : null}
                </Pressable>
                {/* Removal is its own small target, and it opens a
                    confirmation rather than acting — the two controls overlap
                    at the corner, so a mis-tap has to be recoverable.

                    THE ABSOLUTE POSITION LIVES ON THIS WRAPPER VIEW, NOT ON
                    THE PRESSABLE. `Pressable` splits the caller's style: only
                    the box-sizing keys (BOX_KEYS in Pressable.tsx) reach the
                    touchable root, and `position`/`top`/`right` stay on the
                    inner Animated.View, which anchored the badge to its own
                    24dp box and laid it out BELOW the tile.

                    The 48dp target survives: `size` makes the hitSlop
                    arithmetic explicit (24 + 2×12), and the slop reaching past
                    the tile's edges is genuinely pressable — RN 0.86's
                    ReactViewGroup does not clip children, TouchTargetHelper
                    only refuses an out-of-bounds descendant under a clipping
                    ancestor, and Fabric unions a child's hitSlop into the
                    parent's overflow inset (YogaLayoutableShadowNode.cpp:777).
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
                /* `disabled` while the upload is in flight, not `busy`: this
                   tile has no label to swap into a participle (contract.test's
                   "narrates every mutation a button starts"). The outcome
                   arrives as a notice. */
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
      </ScrollView>

      {/* Removing a photo is not undoable — the object goes with the row — so it
          takes M3's basic confirmation dialog, with the consequence named.

          THREE BRANCHES, NOT TWO. "The next one becomes your main photo" is
          what 070's AFTER trigger does — it promotes the oldest survivor — but
          only while there IS a survivor. On the last photo the same trigger
          nulls the mirrored scalar instead (pgTAP 320, case 13), and the
          profile hero then draws the provider's initial. */}
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
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    barIcon: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
    barTitle: { ...TOKENS.typography.textLgSemiBoldTight, color: t.color.text.primary },
    scroll: { paddingHorizontal: TOKENS.space.md, paddingTop: TOKENS.space.sm },
    photos: { gap: TOKENS.space.md },
    hint: { ...TOKENS.typography.textSm, color: t.color.text.secondary },
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
     * accentStrong on the non-text floor: the mark inside is a 14dp `check`
     * Icon, so it answers to 3:1 ("For all other text, set the color contrast
     * ratio to at least 3:1",
     * developer.android.com/guide/topics/ui/accessibility/apps). `bg/accent`
     * misses that in dark (2.59:1); accentStrong is 5.19:1 / 6.13:1.
     * `__tests__/walletTone.test.ts` pins it.
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
     * The corner the remove control hangs on. POSITION ONLY: these are the
     * properties `Pressable` keeps on its inner view, so a plain View applies
     * them. The control's own box stays below, forwarded to the touchable root.
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
  });
