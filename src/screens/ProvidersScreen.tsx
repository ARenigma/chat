import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { enterBlock } from '../theme/motion';
import type { ProviderSummary } from '../lib/database.types';
import { useProfile, useProviders } from '../api/chat';
import { useStore } from '../store/useStore';
import { ProviderRow } from '../components/ProviderRow';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';

interface Props {
  onSelect: (providerId: string) => void;
  /** Present because the directory is reached from the inbox, not the launcher. */
  onBack: () => void;
  onOpenSettings: () => void;
}

/**
 * The first frame of the app. No sign-up, no tour, no permission prompt — the
 * anonymous session is already live by the time this renders.
 *
 * The directory is a server query now rather than a bundled constant, so unlike
 * the persona list it has genuine loading and empty states: there may be nobody
 * admitted yet, and saying so is better than an empty list that looks broken.
 */
export function ProvidersScreen({ onSelect, onBack, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  useProfile();
  const { data: providers, isPending, isError, refetch } = useProviders();

  const onPressRow = useCallback(
    (provider: ProviderSummary) => onSelect(provider.id),
    [onSelect],
  );

  const list = providers ?? [];
  const free = list.filter(p => p.is_available).length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.meta}>
        <Pressable
          onPress={onBack}
          testID="directory-back"
          accessibilityLabel="Back to your conversations"
          press="chip"
          size={40}
          style={styles.iconButton}>
          <Icon glyph="chevron-left" size={16} color={TOKENS.color.text.secondary} />
        </Pressable>
        <TokenCounter balance={balance} onPress={openRefill} />
        <View style={styles.spacer} />
        <Pressable
          onPress={onOpenSettings}
          testID="open-settings"
          accessibilityLabel="Account and privacy"
          press="chip"
          size={40}
          style={styles.iconButton}>
          <Icon glyph="dots" size={18} color={TOKENS.color.text.secondary} />
        </Pressable>
      </View>

      {/* The headline counts. "4 people free now." is the only fact on this
          screen a member can act on, and a fixed slogan wasted the largest type
          on the page saying nothing they did not already know. It falls back to
          the slogan while the count is unknown, because a hero that reads
          "0 people free now." on a slow network is worse than no hero. */}
      <Animated.View entering={enterBlock(0)} style={styles.head}>
        <Text allowFontScaling style={styles.title}>
          {free > 0 ? `${free} ${free === 1 ? 'person' : 'people'}\nfree now.` : 'Someone’s here\nto listen.'}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Real people, ready to talk. Not therapy — just company.
        </Text>
      </Animated.View>

      {isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={TOKENS.color.text.secondary} />
        </View>
      ) : isError ? (
        <Pressable
          onPress={() => {
            void refetch();
          }}
          testID="directory-retry"
          accessibilityLabel="Retry loading the directory"
          style={styles.state}>
          <Text allowFontScaling style={styles.stateText}>
            Could not load the directory. Tap to retry.
          </Text>
        </Pressable>
      ) : list.length === 0 ? (
        <View style={styles.state}>
          <Text testID="directory-empty" allowFontScaling style={styles.stateText}>
            Nobody is available just yet. Check back shortly.
          </Text>
        </View>
      ) : (
        <FlashList
          data={list}
          keyExtractor={p => p.id}
          renderItem={({ item, index }) => (
            <ProviderRow provider={item} index={index} onPress={onPressRow} />
          )}
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
    paddingBottom: TOKENS.space.lg,
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
  head: {
    paddingHorizontal: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xl,
    gap: TOKENS.space['2xs'] + 2,
  },
  title: {
    ...TOKENS.typography.displaySmall,
    color: TOKENS.color.text.primary,
  },
  subtitle: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  list: {
    paddingHorizontal: TOKENS.space.lg,
    gap: TOKENS.space.sm,
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
