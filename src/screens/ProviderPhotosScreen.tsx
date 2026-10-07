import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useProfile } from '../api/chat';
import { BackButton } from '../components/BackButton';
import { ProviderPhotoGallery } from '../components/ProviderPhotoGallery';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

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
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const { data: profile } = useProfile();

  return (
    <View
      style={[styles.root, { paddingTop: insets.top }]}
      testID="provider-photos-screen"
    >
      <View style={styles.bar}>
        <BackButton
          onPress={onBack}
          testID="photos-back"
          style={styles.barIcon}
        />
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          allowFontScaling
          style={styles.barTitle}
        >
          Your photos
        </Text>
      </View>
      <ScrollView
        {...SCROLL_PHYSICS}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: barOffset }]}
      >
        <ProviderPhotoGallery providerId={profile?.id ?? null} />
      </ScrollView>
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
    barIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barTitle: {
      ...TOKENS.typography.textLgSemiBoldTight,
      color: t.color.text.primary,
    },
    scroll: { paddingHorizontal: TOKENS.space.md, paddingTop: TOKENS.space.sm },
  });
