import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { tick } from '../lib/haptics';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { sizedStorageImageUri } from '../lib/storageImage';
import { contentColumnWidth } from '../lib/windowSize';
import { rateLabel, type Channel } from '../lib/rates';
import { useConversations, useProfile, useProviders } from '../api/chat';
import { CALLS_ENABLED } from '../api/calls';
import { useEconomicsConfig, useKillSwitches, FALLBACK_ECONOMICS } from '../api/appConfig';
import { useStore } from '../store/useStore';
import { useFavorites } from '../store/useFavorites';
import { springTo } from '../theme/motion';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';
import { MetaChip } from '../components/MetaChip';
import { ScreenLoader } from '../components/ScreenLoader';
import { SafetySheet } from './SafetySheet';

interface Props {
  providerId: string;
  onBack: () => void;
  onOpenChat: (providerId: string) => void;
  /** Audio/video, each gated by its live admin control. */
  onStartCall: (providerId: string, channel: 'audio' | 'video') => void;
}

/**
 * The provider profile — a v13 screen the first-gen app did not have at all
 * (tapping a provider went straight into a chat). It sits between the directory
 * and a conversation: a hero, three priced actions, and an ABOUT.
 *
 * Pricing is per-minute (ADR-0019). Rates are read from the admin economics
 * config (`useEconomicsConfig`) and fall back to `FALLBACK_ECONOMICS` when
 * offline. Audio and video have independent live admin controls; Chat is live.
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
  const openWallet = useStore(s => s.openWallet);
  useProfile();
  const { data: killSwitches } = useKillSwitches();
  const { data: economics } = useEconomicsConfig();
  const voiceCallsEnabled =
    (killSwitches?.voice_calls_enabled ?? true) && CALLS_ENABLED;
  const videoCallsEnabled =
    (killSwitches?.video_calls_enabled ?? true) && CALLS_ENABLED;
  const chatRate = economics?.chat_rate_tokens_per_min ?? FALLBACK_ECONOMICS.chat_rate_tokens_per_min;
  const audioRate = economics?.audio_rate_tokens_per_min ?? FALLBACK_ECONOMICS.audio_rate_tokens_per_min;
  const videoRate = economics?.video_rate_tokens_per_min ?? FALLBACK_ECONOMICS.video_rate_tokens_per_min;
  const { data: providers, isPending } = useProviders();
  const { data: conversations } = useConversations();
  // Favourites are persisted now (#10), not throwaway local state — the heart
  // reads and writes the saved-favourites store, which the Favourites tab lists.
  const favorite = useFavorites(s => s.ids.includes(providerId));
  const toggleFavorite = useFavorites(s => s.toggle);
  const [safetyOpen, setSafetyOpen] = useState(false);

  // Block/report is offered ONLY when there is an existing conversation with this
  // provider (#3): you cannot block someone you have never talked to. Reaching the
  // profile from Explore (no thread) shows no block; reaching it from an active
  // chat's header (a thread exists) does.
  const thread = useMemo(
    () => (conversations ?? []).find(c => c.peer_id === providerId),
    [conversations, providerId],
  );

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
        <BackButton onPress={onBack} testID="detail-back" style={styles.barIcon} />
        <TokenCounter balance={balance} onPress={openWallet} />
      </View>

      {isPending ? (
        <ScreenLoader />
      ) : provider === null ? (
        <View style={styles.state}>
          <Text allowFontScaling style={styles.stateText}>
            This person is no longer available.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + TOKENS.space.xl }]}>
          <Hero
            provider={provider}
            favorite={favorite}
            onToggleFavorite={() => {
              tick();
              toggleFavorite(providerId);
            }}
          />

          <View style={styles.actions}>
            <ActionButton
              channel="audio"
              kind="primary"
              glyph="call"
              rate={audioRate}
              enabled={voiceCallsEnabled && provider.audio_enabled}
              offered={provider.audio_enabled}
              onPress={onAudio}
              label={`Call ${provider.display_name}`}
            />
            <ActionButton
              channel="chat"
              kind="tint"
              glyph="chat"
              rate={chatRate}
              enabled={provider.chat_enabled}
              offered={provider.chat_enabled}
              onPress={onChat}
              label={`Message ${provider.display_name}`}
            />
            <ActionButton
              channel="video"
              kind="dark"
              glyph="video"
              rate={videoRate}
              enabled={videoCallsEnabled && provider.video_enabled}
              offered={provider.video_enabled}
              onPress={onVideo}
              label={`Video call ${provider.display_name}`}
            />
          </View>

          <View style={styles.hairline} />

          <Text allowFontScaling style={styles.aboutLabel}>
            ABOUT
          </Text>
          <Text allowFontScaling style={styles.aboutBody}>
            {provider.about && provider.about !== ''
              ? provider.about
              : 'Here to listen. Talk about anything, or nothing.'}
          </Text>

          {/* Block / report — only once a conversation exists (#3). Quiet and last,
              the way iOS puts a destructive contact action at the foot of a card. */}
          {thread !== undefined ? (
            <Pressable
              onPress={() => setSafetyOpen(true)}
              testID="detail-safety"
              accessibilityLabel={`Block or report ${provider.display_name}`}
              accessibilityHint="Opens safety options"
              press="row"
              style={styles.safetyRow}>
              <Icon name="block" size={18} color={theme.color.text.secondary} />
              <Text allowFontScaling style={styles.safetyLabel}>
                Block or report {provider.display_name}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      {provider !== null && thread !== undefined ? (
        <SafetySheet
          visible={safetyOpen}
          onClose={() => setSafetyOpen(false)}
          conversationId={thread.conversation_id}
          peerId={providerId}
          peerName={provider.display_name}
          messageId={null}
        />
      ) : null}
    </View>
  );
}

function FavoriteButton({
  favorite,
  onToggle,
  accent,
}: {
  favorite: boolean;
  onToggle: () => void;
  accent: string;
}) {
  const styles = useStyles(makeStyles);
  const scale = useSharedValue(1);
  const reduceMotion = useRef(false);

  useEffect(() => {
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', next => {
      reduceMotion.current = next;
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(next => {
      reduceMotion.current = next;
    });
    return () => sub.remove();
  }, []);

  const pop = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={() => {
        onToggle();
        if (!reduceMotion.current) {
          scale.value = withSequence(springTo(1.18, 'bounce'), springTo(1, 'snap'));
        }
      }}
      testID="detail-favorite"
      accessibilityLabel={favorite ? 'Remove from favourites' : 'Add to favourites'}
      press="none"
      onColor={LIGHT.color.text.onAccent}
      size={40}
      style={styles.favorite}>
      <Animated.View style={[styles.favoriteGlyph, pop]}>
        <Icon
          name="heart"
          active={favorite}
          size={22}
          color={favorite ? accent : LIGHT.color.text.onAccent}
        />
      </Animated.View>
    </Pressable>
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
  const { width: windowWidth } = useWindowDimensions();
  const gradient = `linear-gradient(150deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  const presence = readPresence(provider.presence, provider.last_active_at);
  const age = provider.age !== null ? ` ${provider.age}` : '';
  const languages = provider.languages.slice(0, 3);
  const metaParts = [
    provider.rating_count > 0 ? `★ ${provider.rating_avg?.toFixed(1)}` : 'New here',
  ];
  return (
    <View style={styles.hero}>
      {provider.avatar_url ? (
        <>
          {/* Brand gradient sits under the photo as its placeholder, so the hero
              is never a blank rectangle while the full-size image loads — it reads
              as the coral card, then the photo fades in over it (fadeDuration).
              This is the "photo load delay": the fetch was fine, the empty frame
              before it was the problem. */}
          <View style={[styles.heroFill, { experimental_backgroundImage: gradient }]} />
          <Image
            source={{
              uri: sizedStorageImageUri(
                provider.avatar_url,
                contentColumnWidth(windowWidth) - TOKENS.space.md * 2,
                420,
                PixelRatio.get(),
              ),
            }}
            fadeDuration={220}
            style={styles.heroFill}
          />
          <View style={styles.heroScrim} />
        </>
      ) : (
        <>
          <View style={[styles.heroFill, { experimental_backgroundImage: gradient }]} />
          <Text allowFontScaling={false} style={styles.heroWatermark}>
            {initialOf(provider.display_name)}
          </Text>
        </>
      )}
      {/* Absolute position lives on this wrapper View, not on the Pressable:
          Pressable applies `style` to an inner Animated.View, so `position:
          absolute` on it anchors to the Pressable's own bottom-pinned box rather
          than to the hero — which put the heart mid-right instead of top-right.
          No bounce/chip scale: both moved the glyph under the finger. */}
      <View style={styles.favoriteSlot}>
        <FavoriteButton favorite={favorite} onToggle={onToggleFavorite} accent={theme.color.bg.accent} />
      </View>
      <View style={styles.heroBody}>
        <View style={styles.heroNameRow}>
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.heroName}>
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
        {/* M3 AssistChips for languages — same native chip as the directory
            list, onMedia tone over the hero photo. */}
        {languages.length > 0 ? (
          <View style={styles.chips}>
            {languages.map(lang => (
              <MetaChip key={lang} tone="onMedia" label={lang} />
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
  rate,
  enabled,
  offered = true,
  onPress,
  label,
}: {
  channel: Channel;
  kind: 'primary' | 'tint' | 'dark';
  glyph: 'call' | 'chat' | 'video';
  /** Live admin rate (tokens/min). Falls back to DEFAULT_RATES[channel] at the call site. */
  rate: number;
  enabled: boolean;
  /**
   * False when THIS PROVIDER does not offer the channel (migration 064), as
   * opposed to an operator kill switch. Both disable the button; only this one
   * is about them, so only this one says so. Defaults true so a caller that has
   * not thought about it reads as "we are the ones who turned it off".
   */
  offered?: boolean;
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
        accessibilityLabel={`${label}, ${rateLabel(rate)}${
          enabled ? '' : offered ? ', coming soon' : ', not offered'
        }`}
        press="none"
        highlight="ios"
        style={[
          styles.actionButton,
          kind === 'primary' && styles.actionPrimary,
          kind === 'tint' && styles.actionTint,
          kind === 'dark' && styles.actionDark,
          !enabled && styles.actionDisabled,
        ]}>
        <Icon name={glyph} size={22} color={fg} />
        <Text allowFontScaling numberOfLines={1} style={[styles.actionRate, { color: fg }]}>
          {rateLabel(rate)}
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
      ...TOKENS.typography.bodyLarge,
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
    heroScrim: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      experimental_backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0) 50%)',
    },
    heroWatermark: {
      position: 'absolute',
      right: 8,
      top: 40,
      fontFamily: TOKENS.face.semibold,
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
    favoriteGlyph: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
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
      ...TOKENS.typography.headlineMediumEmphasized,
      color: '#FFFFFF',
      flexShrink: 1,
    },
    heroAge: {
      ...TOKENS.typography.bodySmall,
      color: 'rgba(255,255,255,0.82)',
    },
    heroDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.color.state.available,
    },
    heroTagline: {
      ...TOKENS.typography.bodyLarge,
      color: 'rgba(255,255,255,0.95)',
    },
    heroMeta: {
      ...TOKENS.typography.bodyMedium,
      color: 'rgba(255,255,255,0.82)',
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space['2xs'],
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
      gap: TOKENS.space['2xs'],
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
      ...TOKENS.typography.labelMediumEmphasized,
    },
    hairline: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
      marginTop: TOKENS.space.xl,
    },
    aboutLabel: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.lg,
      paddingBottom: TOKENS.space.xs,
    },
    aboutBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    safetyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      marginTop: TOKENS.space['2xl'],
      paddingVertical: TOKENS.space.sm,
    },
    safetyLabel: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
  });
