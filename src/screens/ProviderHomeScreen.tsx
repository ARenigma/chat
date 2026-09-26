import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import {
  ProviderPushGate,
  ProviderPushGateProvider,
} from '../components/ProviderPushGate';
import { useProviderWaitingCount } from '../shell/badgeCounts';
import { ProviderChatsScreen } from './ProviderChatsScreen';
import { ProviderSavedScreen } from './ProviderSavedScreen';
import { ProviderYouScreen } from './ProviderYouScreen';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenPayout: () => void;
  /** Per-session earnings ledger, opened from the settings list on the You tab. */
  onOpenUsage: () => void;
  /** The provider's blocked-members list, opened from the settings list. */
  onOpenBlocked: () => void;
  /** Sign-out and account deletion, forwarded into the You tab's SettingsSheet. */
  onSignedOut: () => void;
  onDeleted: () => void;
}

type Tab = 'chats' | 'favourites' | 'you';

/**
 * The provider's working surface, in three tabs (Amit, 2026-09-03): Chats (the
 * work), Saved (members they bookmarked) and You (availability, money, photos
 * and settings).
 *
 * A COMPOSITION since navigation step 6. Each tab is its own screen
 * (ProviderChatsScreen, ProviderSavedScreen, ProviderYouScreen) so the
 * navigator can register them as tab roots; until it does, this file mounts
 * one at a time behind the same local bottom nav it always had, so nothing the
 * provider sees has moved. It is deleted when the provider tabs are mounted
 * under react-navigation (step 7).
 */
export function ProviderHomeScreen({
  onOpenConversation,
  onOpenPayout,
  onOpenUsage,
  onOpenBlocked,
  onSignedOut,
  onDeleted,
}: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('chats');
  // Only work counts as waiting. Their own thread is not a person waiting on them.
  const waiting = useProviderWaitingCount();

  return (
    <ProviderPushGateProvider>
      {/* No top inset here: the Chats head takes it, and the You tab's
          SettingsSheet owns its own status-bar inset via its top app bar. */}
      <View style={styles.root}>
        {/* The gate first and absolute (zIndex 20), exactly where the inline
            copy sat, so it still covers every tab and the nav. */}
        <ProviderPushGate />
        {tab === 'chats' ? (
          <ProviderChatsScreen onOpenConversation={onOpenConversation} />
        ) : tab === 'favourites' ? (
          <ProviderSavedScreen onOpenConversation={onOpenConversation} />
        ) : (
          <ProviderYouScreen
            onOpenPayout={onOpenPayout}
            onOpenUsage={onOpenUsage}
            onOpenBlocked={onOpenBlocked}
            onSignedOut={onSignedOut}
            onDeleted={onDeleted}
          />
        )}

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
            icon="heart"
            label="Saved"
            active={tab === 'favourites'}
            badge={0}
            onPress={() => setTab('favourites')}
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
    </ProviderPushGateProvider>
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
        {/* The FILL glyph when selected (each tab icon has a `-fill` entry in
            design/icons.json's `active` map), not the same outline in a lighter ink.
            Colour alone is the failure mode this repo has now hit twice, and M3
            names the fix for this exact control: "the icon of the active
            destination is filled".
            https://m3.material.io/components/navigation-bar/guidelines */}
        <Icon name={icon} active={active} size={TOKENS.icon.lg} color={color} />
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

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
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
      // M3's navigation bar puts 4dp between the icon and its label, not 2.
      // https://m3.material.io/components/navigation-bar/specs
      gap: TOKENS.space['2xs'],
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
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

