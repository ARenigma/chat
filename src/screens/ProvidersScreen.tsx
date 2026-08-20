import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.meta}>
        <Pressable
          onPress={onBack}
          testID="directory-back"
          accessibilityLabel="Back to your conversations"
          style={styles.iconButton}>
          <Icon glyph="chevron-left" size={16} color={TOKENS.color.text.secondary} />
        </Pressable>
        <TokenCounter balance={balance} onPress={openRefill} />
        <View style={styles.spacer} />
        <Pressable
          onPress={onOpenSettings}
          testID="open-settings"
          accessibilityLabel="Account and privacy"
          style={styles.iconButton}>
          <Icon glyph="dots" size={18} color={TOKENS.color.text.secondary} />
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text allowFontScaling style={styles.title}>
          {'Someone’s here\nto listen.'}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Real people, ready to talk. Not therapy — just company.
        </Text>
      </View>

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
        <FlatList
          data={list}
          keyExtractor={p => p.id}
          renderItem={({ item, index }) => (
            <ProviderRow
              provider={item}
              index={index}
              divider={index > 0}
              onPress={onPressRow}
            />
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
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: {
    paddingHorizontal: TOKENS.space.lg,
    paddingBottom: TOKENS.space.xl,
    gap: TOKENS.space['2xs'] + 2,
  },
  title: {
    ...TOKENS.typography.displayLarge,
    color: TOKENS.color.text.primary,
  },
  subtitle: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  list: {
    paddingHorizontal: TOKENS.space.lg,
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
