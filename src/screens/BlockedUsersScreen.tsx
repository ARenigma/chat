import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { useBackBarrier } from '../lib/backGuard';
import { initialOf } from '../lib/display';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useBlockedPeople, useUnblockUser } from '../api/safety';
import { Avatar } from '../components/Avatar';
import { BackButton } from '../components/BackButton';
import { Button } from '../components/Button';
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
 * The list is `blocked_people` (152), not the provider directory filtered by
 * the block set. The directory has no members, so a provider who blocked a
 * member, from a chat or from a comment on their story, was told "You haven't
 * blocked anyone" and had no way to undo it. Every row is somebody the caller
 * blocked, member or provider, under their public name only.
 */
export function BlockedUsersScreen({ onBack }: Props) {
  /*
   * This screen covers Home, and Home stays mounted underneath it (App.tsx
   * renders pushed screens as overlays so returning never remounts Home's
   * lists). Without this barrier Home's search guard — live whenever its search
   * field is open — still hears the hardware back press from up here, closes a
   * field nobody can see, and reports the press handled, so this screen never
   * pops. See src/lib/backGuard.ts.
   */
  useBackBarrier();

  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { data: list, isLoading, isError, isFetching, refetch } = useBlockedPeople();
  const unblock = useUnblockUser();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="blocked-back" style={styles.barIcon} />
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.barTitle}>
          Blocked
        </Text>
      </View>

      {/*
        Rows first, whatever the fetch did last. React Query keeps the previous
        data when a background refetch fails but still raises `isError`, so an
        error-first order let a failed refresh after an unblock hide every block
        still in force, on a screen with no way to ask again. Same order as the
        Chats list (2026-09-17 audit): cached rows, then loading, then failure,
        then empty.

        Loading and failure are their own states, never the empty one. "You
        haven't blocked anyone" is a claim about somebody's safety settings, and
        showing it before the list arrives, or when it could not be read, tells
        them a block they made is gone.
      */}
      {list !== undefined && list.length > 0 ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + TOKENS.space.xl }]}>
          <Text allowFontScaling style={styles.hint}>
            Unblocking lets this person message you again. They are never told
            they were blocked.
          </Text>
          {list.map(p => (
            <View key={p.handle} style={styles.row}>
              <Avatar initial={initialOf(p.display_name)} size={40} />
              <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.name}>
                {p.display_name}
              </Text>
              <Pressable
                onPress={() => unblock.mutate(p.handle)}
                disabled={unblock.isPending}
                testID={`unblock-${p.handle}`}
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
      ) : isLoading ? (
        <View style={styles.empty}>
          <Text allowFontScaling style={styles.emptyText}>
            Loading…
          </Text>
        </View>
      ) : isError || list === undefined ? (
        /*
         * A retry, because this is the only screen a block can be undone from:
         * a failure with no way to ask again leaves every block here stuck until
         * the screen is closed and reopened. `busy` rather than nothing while it
         * runs, since a failing refetch retries once before it settles and a
         * button that goes quiet for that long reads as dead.
         */
        <View style={styles.empty}>
          <Text allowFontScaling style={styles.emptyText}>
            Could not load your blocked list right now.
          </Text>
          <View style={styles.emptyRetry}>
            <Button
              label="Try Again"
              busy={isFetching}
              busyLabel="Trying Again"
              testID="blocked-retry"
              onPress={() => {
                void refetch();
              }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text allowFontScaling style={styles.emptyText}>
            You haven’t blocked anyone.
          </Text>
        </View>
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
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    list: {
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
    },
    hint: {
      ...TOKENS.typography.bodyMedium,
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
      ...TOKENS.typography.titleMediumEmphasized,
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
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.primary,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    emptyRetry: {
      alignSelf: 'stretch',
      paddingTop: TOKENS.space.md,
    },
  });
