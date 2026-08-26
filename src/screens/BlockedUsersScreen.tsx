import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { useProviders } from '../api/chat';
import { useBlockedPeerIds, useUnblockUser } from '../api/safety';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';

interface Props {
  onBack: () => void;
}

/**
 * The blocked-users list — the one place a block is reversible.
 *
 * v13's Home filters blocked people out of the rail and the directory, which is
 * correct (a person you blocked should not resurface), but it means there is no
 * longer a thread to open to unblock them. Play's UGC policy requires that a
 * block be manageable, so this screen exists solely to undo one.
 *
 * Names are resolved through the directory (`useProviders`), which still lists a
 * blocked provider — the filtering is client-side. A blocked id with no
 * directory entry (a rare member-to-member block) is not shown here yet; the
 * common marketplace case is a member unblocking a provider.
 */
export function BlockedUsersScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: providers } = useProviders();
  const blocked = useBlockedPeerIds();
  const unblock = useUnblockUser();

  const list = useMemo<ProviderSummary[]>(
    () => (providers ?? []).filter(p => blocked.has(p.id)),
    [providers, blocked],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={onBack}
          testID="blocked-back"
          accessibilityLabel="Back"
          press="none"
          size={28}
          style={styles.barIcon}>
          <Icon name="chevronLeft" size={26} color={theme.color.text.primary} />
        </Pressable>
        <Text allowFontScaling style={styles.barTitle}>
          Blocked
        </Text>
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text allowFontScaling style={styles.emptyText}>
            You haven’t blocked anyone.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + TOKENS.space.xl }]}>
          <Text allowFontScaling style={styles.hint}>
            Unblocking lets this person message you again. They are never told
            they were blocked.
          </Text>
          {list.map(p => (
            <View key={p.id} style={styles.row}>
              <Avatar initial={initialOf(p.display_name)} size={40} />
              <Text allowFontScaling numberOfLines={1} style={styles.name}>
                {p.display_name}
              </Text>
              <Pressable
                onPress={() => unblock.mutate(p.id)}
                disabled={unblock.isPending}
                testID={`unblock-${p.id}`}
                accessibilityLabel={`Unblock ${p.display_name}`}
                press="chip"
                style={styles.unblock}>
                <Text allowFontScaling style={styles.unblockLabel}>
                  Unblock
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
    },
    barIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barTitle: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    list: {
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
    },
    hint: {
      ...TOKENS.typography.subhead,
      color: t.color.text.secondary,
      paddingBottom: TOKENS.space.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
    },
    name: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      flex: 1,
    },
    // A neutral pill, not the accent: unblocking is a reversal, not the primary
    // action the coral is reserved for.
    unblock: {
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
    unblockLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.primary,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
