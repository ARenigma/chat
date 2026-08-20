import React, { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import { PERSONAS, type Persona, type PersonaId } from '../lib/personas';
import { useProfile } from '../api/chat';
import { useStore } from '../store/useStore';
import { CompanionRow } from '../components/CompanionRow';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';

interface Props {
  onSelect: (id: PersonaId) => void;
  onOpenSettings: () => void;
}

/**
 * The first frame of the app. No sign-up, no tour, no permission prompt — the
 * anonymous session is already live by the time this renders.
 */
export function CompanionsScreen({ onSelect, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  useProfile();

  const onPressRow = useCallback((persona: Persona) => onSelect(persona.id), [onSelect]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.meta}>
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
          {'Who’s on your\nmind tonight?'}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Each one remembers her own conversations.
        </Text>
      </View>

      <FlatList
        data={PERSONAS}
        keyExtractor={p => p.id}
        renderItem={({ item, index }) => (
          <CompanionRow
            persona={item}
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
});
