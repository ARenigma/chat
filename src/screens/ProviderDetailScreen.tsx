import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { DEFAULT_RATES, rateLabel, type Channel } from '../lib/rates';
import { useProfile, useProviders } from '../api/chat';
import { CALLS_ENABLED } from '../api/calls';
import { useStore } from '../store/useStore';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';

interface Props {
  providerId: string;
  onBack: () => void;
  onOpenChat: (providerId: string) => void;
  /** Audio/video. Gated behind CALLS_ENABLED; a no-op notice until calls ship. */
  onStartCall: (providerId: string, channel: 'audio' | 'video') => void;
}

/**
 * The provider profile — a v13 screen the first-gen app did not have at all
 * (tapping a provider went straight into a chat). It sits between the directory
 * and a conversation: a hero, three priced actions, and an ABOUT.
 *
 * Pricing is per-minute (ADR-0019). Rates come from `DEFAULT_RATES` until the
 * schema carries per-provider rates; the three buttons show ₹/min the way v13
 * does. Audio and video are gated behind `CALLS_ENABLED`; Chat is live.
 *
 * The photo hero degrades to a warm gradient with the person's mark, since the
 * data model has no `avatar_url` yet — same honest fallback as the featured card
 * on Home.
 */
export function ProviderDetailScreen({ providerId, onBack, onOpenChat, onStartCall }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  useProfile();
  const { data: providers, isPending } = useProviders();
  const [favorite, setFavorite] = useState(false);

  const provider = useMemo<ProviderSummary | null>(
    () => (providers ?? []).find(p => p.id === providerId) ?? null,
    [providers, providerId],
  );

  const onChat = useCallback(() => onOpenChat(providerId), [onOpenChat, providerId]);
  const onAudio = useCallback(() => onStartCall(providerId, 'audio'), [onStartCall, providerId]);
  const onVideo = useCallback(() => onStartCall(providerId, 'video'), [onStartCall, providerId]);

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
        <Pressable
          onPress={onBack}
          testID="detail-back"
          accessibilityLabel="Back"
          press="none"
          size={28}
          style={styles.barIcon}>
          <Icon name="chevronLeft" size={26} color={theme.color.text.primary} />
        </Pressable>
        <TokenCounter balance={balance} onPress={openRefill} />
      </View>

      {isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : provider === null ? (
        <View style={styles.state}>
          <Text allowFontScaling style={styles.stateText}>
            This person is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + TOKENS.space.xl }]}>
          <Hero provider={provider} favorite={favorite} onToggleFavorite={() => setFavorite(v => !v)} />

          <View style={styles.actions}>
            <ActionButton
              channel="audio"
              kind="primary"
              glyph="call"
              enabled={CALLS_ENABLED}
              onPress={onAudio}
              label={`Call ${provider.display_name}`}
            />
            <ActionButton
              channel="chat"
              kind="tint"
              glyph="chat"
              enabled
              onPress={onChat}
              label={`Message ${provider.display_name}`}
            />
            <ActionButton
              channel="video"
              kind="dark"
              glyph="video"
              enabled={CALLS_ENABLED}
              onPress={onVideo}
              label={`Video call ${provider.display_name}`}
            />
          </View>

          <View style={styles.hairline} />

          <Text allowFontScaling style={styles.aboutLabel}>
            ABOUT
          </Text>
          <Text allowFontScaling style={styles.aboutBody}>
            {provider.headline && provider.headline !== ''
              ? provider.headline
              : 'Here to listen. Talk about anything, or nothing.'}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function Hero({
  provider,
  favorite,
  onToggleFavorite,
}: {
  provider: ProviderSummary;
  favorite: boolean;
  onToggleFavorite: () => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const gradient = `linear-gradient(150deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  const presence = readPresence(provider.presence, provider.last_active_at);
  const age = provider.age !== null ? ` ${provider.age}` : '';
  const languages = provider.languages.slice(0, 3);
  const metaParts = [
    languages.join(' · '),
    provider.rating_count > 0 ? `★ ${provider.rating_avg?.toFixed(1)}` : 'New here',
  ].filter(s => s !== '');
  return (
    <View style={styles.hero}>
      <View
        style={[
          styles.heroFill,
          { experimental_backgroundImage: gradient },
        ]}
      />
      <Text allowFontScaling={false} style={styles.heroWatermark}>
        {initialOf(provider.display_name)}
      </Text>
      {/* Absolute position lives on this wrapper View, not on the Pressable:
          Pressable applies `style` to an inner Animated.View, so `position:
          absolute` on it anchors to the Pressable's own bottom-pinned box rather
          than to the hero — which put the heart mid-right instead of top-right. */}
      <View style={styles.favoriteSlot}>
        <Pressable
          onPress={onToggleFavorite}
          testID="detail-favorite"
          accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
          press="chip"
          size={40}
          style={styles.favorite}>
          <Icon
            name="heart"
            active={favorite}
            size={22}
            color={favorite ? theme.color.bg.accent : '#FFFFFF'}
          />
        </Pressable>
      </View>
      <View style={styles.heroBody}>
        <View style={styles.heroNameRow}>
          <Text allowFontScaling numberOfLines={1} style={styles.heroName}>
            {provider.display_name}
            <Text style={styles.heroAge}>{age}</Text>
          </Text>
          {presence.here ? <View style={styles.heroDot} /> : null}
        </View>
        {provider.headline && provider.headline !== '' ? (
          <Text allowFontScaling numberOfLines={1} style={styles.heroTagline}>
            {provider.headline}
          </Text>
        ) : null}
        <Text
          allowFontScaling
          style={styles.heroMeta}
          accessibilityLabel={`${metaParts.join(', ')}, ${presenceForSpeech(presence)}`}>
          {metaParts.join('  ·  ')}
        </Text>
        {languages.length > 0 ? (
          <View style={styles.chips}>
            {languages.map(lang => (
              <View key={lang} style={styles.chip}>
                <Text allowFontScaling style={styles.chipText}>
                  {lang}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ActionButton({
  channel,
  kind,
  glyph,
  enabled,
  onPress,
  label,
}: {
  channel: Channel;
  kind: 'primary' | 'tint' | 'dark';
  glyph: 'call' | 'chat' | 'video';
  enabled: boolean;
  onPress: () => void;
  label: string;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const fg =
    kind === 'tint' ? theme.color.text.accent : theme.color.text.onAccent;
  // The `flex: 1` lives on this wrapper View, not on the Pressable: a `flex: 1`
  // set on a Pressable never reaches its outer touchable (it styles an inner
  // view), so three flex Pressables collapse to content width. The View
  // distributes the row; the Pressable carries an explicit `width: '100%'` +
  // fixed height so its content is centred in a full-width button.
  return (
    <View style={styles.actionSlot}>
      <Pressable
        onPress={onPress}
        disabled={!enabled}
        testID={`action-${channel}`}
        accessibilityLabel={`${label}, ${rateLabel(DEFAULT_RATES[channel])}${enabled ? '' : ', coming soon'}`}
        press="button"
        style={[
          styles.actionButton,
          kind === 'primary' && styles.actionPrimary,
          kind === 'tint' && styles.actionTint,
          kind === 'dark' && styles.actionDark,
          !enabled && styles.actionDisabled,
        ]}>
        <Icon name={glyph} size={22} color={fg} />
        <Text allowFontScaling numberOfLines={1} style={[styles.actionRate, { color: fg }]}>
          {rateLabel(DEFAULT_RATES[channel])}
        </Text>
      </Pressable>
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
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    barIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: TOKENS.space.md,
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    stateText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    hero: {
      height: 420,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    heroFill: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    },
    heroWatermark: {
      position: 'absolute',
      right: 8,
      top: 40,
      fontFamily: TOKENS.typography.displayLarge.fontFamily,
      fontSize: 300,
      lineHeight: 340,
      color: 'rgba(255,255,255,0.14)',
    },
    favoriteSlot: {
      position: 'absolute',
      top: TOKENS.space.md,
      right: TOKENS.space.md,
    },
    favorite: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.24)',
    },
    heroBody: {
      padding: TOKENS.space.lg,
      gap: TOKENS.space['2xs'],
    },
    heroNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    heroName: {
      ...TOKENS.typography.displayLarge,
      color: '#FFFFFF',
      flexShrink: 1,
    },
    heroAge: {
      ...TOKENS.typography.displaySmall,
      color: 'rgba(255,255,255,0.82)',
    },
    heroDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.color.state.available,
    },
    heroTagline: {
      ...TOKENS.typography.bodyMedium,
      color: 'rgba(255,255,255,0.95)',
    },
    heroMeta: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.82)',
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space['2xs'],
    },
    chip: {
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 4,
      borderRadius: TOKENS.radius.xs,
      backgroundColor: 'rgba(0,0,0,0.24)',
    },
    chipText: {
      ...TOKENS.typography.labelSmall,
      color: '#FFFFFF',
    },
    actions: {
      flexDirection: 'row',
      gap: TOKENS.space.xs,
      paddingTop: TOKENS.space.lg,
    },
    actionSlot: {
      flex: 1,
    },
    actionButton: {
      width: '100%',
      height: 64,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    actionPrimary: {
      backgroundColor: t.color.bg.accent,
    },
    actionTint: {
      backgroundColor: t.color.bg.accentTint,
    },
    actionDark: {
      backgroundColor: t.color.text.primary,
    },
    actionDisabled: {
      opacity: 0.5,
    },
    actionRate: {
      ...TOKENS.typography.labelSmall,
    },
    hairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
      marginTop: TOKENS.space.xl,
    },
    aboutLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.lg,
      paddingBottom: TOKENS.space.xs,
    },
    aboutBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.primary,
    },
  });
