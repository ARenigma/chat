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
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderPhoto, ProviderSummary } from '../lib/database.types';
import { isClayUri, resolveAvatarSource } from '../lib/clayAvatars';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { tick } from '../lib/haptics';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { sizedStorageImageUri } from '../lib/storageImage';
import { contentColumnWidth } from '../lib/windowSize';
import { rateLabel, type Channel } from '../lib/rates';
import { useConversations, useProfile, useProviders } from '../api/chat';
import { useProviderPhotos, useProviderRatings } from '../api/provider';
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

/**
 * The hero card's height, named because three things now depend on it agreeing:
 * the card, each page inside the pager, and the pixel size asked of Supabase's
 * image transform.
 */
const HERO_HEIGHT = 420;

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
 * The hero is a pager over the provider's gallery (migration 070), primary photo
 * first, and degrades in two steps: to the single `avatar_url` for a provider
 * who has never opened the photo manager, and then to a warm gradient with the
 * person's mark — the same honest fallback as the featured card on Home.
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
  const { data: ratings } = useProviderRatings(providerId);
  const { data: photos } = useProviderPhotos(providerId);
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
            photos={photos ?? []}
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
              kind="outline"
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

          <View style={styles.hairline} />

          {/* Ratings (goal item 10), restated 2026-09-06 to Amit's spec: the
              number centred, the stars under it, the reviews under those.
              The 5-4-3-2-1 distribution ladder is GONE. It was five bars of
              arithmetic in a place where the only question is "is she any good
              and what did people say" — and on a seeded profile with three
              reviews it drew four empty tracks, which reads as absence rather
              than as data. `get_provider_ratings` still returns `distribution`;
              nothing renders it, and the RPC contract is left alone so the
              admin side can keep it.

              The stars are the outline Lucide glyph in both states, separated
              by colour alone — active in the token gold, the rest in the
              outline grey. Lucide ships one `star`, stroked, and there is no
              filled sibling in a static font, so a filled/hollow pair is not
              available to us (RULE 4: the font is generated from
              design/icons.json). */}
          <Text allowFontScaling style={[styles.aboutLabel, styles.ratingsLabel]}>
            RATINGS
          </Text>
          {ratings === null || ratings === undefined || ratings.rating_count === 0 ? (
            <Text
              allowFontScaling
              style={[styles.aboutBody, styles.ratingsEmpty]}
              testID="ratings-empty">
              No ratings yet. Yours would be the first.
            </Text>
          ) : (
            <View testID="ratings-chart" style={styles.ratingBlock}>
              <Text
                maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized}
                allowFontScaling
                style={styles.ratingBig}>
                {(ratings.rating_avg ?? 0).toFixed(1)}
              </Text>
              <View style={styles.ratingStars}>
                {[1, 2, 3, 4, 5].map(n => (
                  <Icon
                    key={n}
                    name="star"
                    size={20}
                    color={
                      n <= Math.round(ratings.rating_avg ?? 0)
                        ? theme.color.text.token
                        : theme.color.border.strong
                    }
                  />
                ))}
              </View>
              <Text allowFontScaling style={styles.ratingCount}>
                {`${ratings.rating_count} ${ratings.rating_count === 1 ? 'rating' : 'ratings'}`}
              </Text>

              {ratings.recent.map((r, i) => (
                <View key={`${r.created_at}-${i}`} style={styles.reviewRow}>
                  <View style={styles.ratingStars}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <Icon
                        key={n}
                        name="star"
                        size={12}
                        color={n <= r.rating ? theme.color.text.token : theme.color.border.strong}
                      />
                    ))}
                  </View>
                  <Text allowFontScaling style={styles.reviewBody}>
                    {r.comment}
                  </Text>
                </View>
              ))}
            </View>
          )}


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
  photos,
  favorite,
  onToggleFavorite,
}: {
  provider: ProviderSummary;
  photos: ProviderPhoto[];
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

  // The gallery when there is one, the single avatar when there is not. Nothing
  // regresses for a provider (or a seed row) who has never opened the photo
  // manager, and nothing breaks before migration 070 is applied: the query fails,
  // `photos` is empty, and the pager is one page that renders as the hero always
  // did.
  const gallery = useMemo<string[]>(
    () =>
      photos.length > 0
        ? photos.map(p => p.url)
        : provider.avatar_url !== null
          ? [provider.avatar_url]
          : [],
    [photos, provider.avatar_url],
  );

  /*
   * Seeded from the window rather than 0, because a first frame at width 0 makes
   * `pagingEnabled` snap against a zero-width page, and corrected by `onLayout`
   * so a rotation or a 600dp content column lands on whole pages too. The seed
   * is the same arithmetic the single image used before: the content column less
   * the ScrollView's own horizontal padding.
   */
  const [pageW, setPageW] = useState(() =>
    Math.round(contentColumnWidth(windowWidth) - TOKENS.space.md * 2),
  );
  const [page, setPage] = useState(0);

  const onHeroLayout = useCallback((e: LayoutChangeEvent) => {
    setPageW(Math.round(e.nativeEvent.layout.width));
  }, []);

  const onSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, pageW));
      setPage(Math.min(Math.max(next, 0), Math.max(0, gallery.length - 1)));
    },
    [pageW, gallery.length],
  );

  return (
    <View style={styles.hero} onLayout={onHeroLayout}>
      {gallery.length > 0 ? (
        <>
          {/* Brand gradient sits under the strip as its placeholder, so the hero
              is never a blank rectangle while a page decodes — it reads as the
              coral card, then the photo fades in over it (fadeDuration). This is
              the "photo load delay": the fetch was fine, the empty frame before
              it was the problem. */}
          <View style={[styles.heroFill, { experimental_backgroundImage: gradient }]} />
          <ScrollView
            horizontal
            /* `pagingEnabled`, and deliberately NOT `snapToInterval`. The page
               here IS the pager's own width, which is exactly what pagingEnabled
               means — "the scroll view stops on multiples of the scroll view's
               size" — and the same page says snapToInterval "Overrides less
               configurable pagingEnabled prop", so setting both is a silent
               conflict in which the interval wins. HeroCarousel on Home uses
               snapToInterval because its card is NARROWER than its strip; this
               one is not.
               https://reactnative.dev/docs/scrollview#pagingenabled
               https://reactnative.dev/docs/scrollview#snaptointerval

               M3 calls this the "full-screen" carousel strategy — one item
               filling the whole carousel, recommended for portrait — as opposed
               to the "hero" strategy (one large item plus a peek) that
               HeroCarousel implements. Snapping to the nearest item is part of
               the strategy, not decoration.
               https://github.com/material-components/material-components-android/blob/master/docs/components/Carousel.md */
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            /* The cross-axis conflict with the vertical parent ScrollView is
               resolved by the PLATFORM, not by a prop, and the two props that
               look like the fix are not: `directionalLockEnabled` is iOS-only,
               and `nestedScrollEnabled` is the SAME-axis case. Android decides
               in ViewGroup.onInterceptTouchEvent — whichever axis crosses
               ViewConfiguration.scaledTouchSlop first claims the gesture. What
               this code controls is that a half-claimed swipe still resolves to
               a WHOLE page (pagingEnabled, plus settling on both handlers
               below), and that each page is a plain View with no Pressable
               competing for the responder.
               https://developer.android.com/develop/ui/views/touch-and-input/gestures/viewgroup
               https://reactnative.dev/docs/scrollview#nestedscrollenabled-android */
            onMomentumScrollEnd={onSettled}
            /* A slow drag that never gains momentum ends here instead — the same
               pair HeroCarousel settles on. */
            onScrollEndDrag={onSettled}
            scrollEventThrottle={16}
            {...SCROLL_PHYSICS}
            style={styles.heroFill}
            testID="hero-pager">
            {gallery.map((uri, i) => (
              <View
                key={uri}
                style={[styles.heroPage, { width: pageW }]}
                accessible
                /* Purpose, not type: no "image", no "button". The position is in
                   the label because there is no pager role to carry it, and a
                   screen-reader user swiping the strip has to know where they
                   are.
                   https://developer.android.com/guide/topics/ui/accessibility/principles */
                accessibilityLabel={`${provider.display_name}, photo ${i + 1} of ${gallery.length}`}>
                <Image
                  source={
                    isClayUri(uri)
                      ? (resolveAvatarSource(uri) as ImageSourcePropType)
                      : {
                          uri: sizedStorageImageUri(uri, pageW, HERO_HEIGHT, PixelRatio.get()),
                        }
                  }
                  fadeDuration={220}
                  style={styles.heroFill}
                />
              </View>
            ))}
          </ScrollView>
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
      {/* The page indicator: a centred row of circles, one per page, the selected
          one a different colour — the platform's own recipe for a pager.
          https://developer.android.com/develop/ui/compose/layouts/pager

          DEPARTURE, stated: that page puts the row at the BOTTOM. The bottom
          120dp of this hero is the name / tagline / meta / language-chip block
          over the scrim, so dots there land on the name. Top-centre balances the
          favourite heart at top-right, and is where the apps a member already
          uses put it.

          This row is full-width (left: 0, right: 0) and sits in the same 16dp
          band as the favourite heart, so it OVERLAPS a real control. That is
          resolved by `pointerEvents="none"` — "The View is never the target of
          touch events" — and not by JSX order. Sibling order does decide
          hit-testing (TouchTargetHelper walks children back to front), so
          declaring the dots first happened to work; it is not a layout
          property, it is a fact about this file's line numbering, and the next
          person to reorder these two blocks would silently hand the heart's
          touches to a strip of dots.
          https://reactnative.dev/docs/view#pointerevents */}
      {gallery.length > 1 ? (
        <View
          style={styles.pagerDots}
          pointerEvents="none"
          testID="hero-pager-dots"
          accessible
          /* A live region, NOT AccessibilityInfo.announceForAccessibility:
             Android 16 deprecates announcements and names
             setAccessibilityLiveRegion as the replacement for "changes to
             critical UI". targetSdk is 36, so this is the supported route.
             https://developer.android.com/about/versions/16/behavior-changes-all */
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Photo ${page + 1} of ${gallery.length}`}>
          {gallery.map((uri, i) => (
            <View key={uri} style={[styles.pagerDot, i === page && styles.pagerDotOn]} />
          ))}
        </View>
      ) : null}
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
  /**
   * M3 button emphasis, one rank each. `primary` is the filled button, `dark`
   * a filled button on the inverse surface, `outline` M3's OUTLINED button —
   * transparent container, 1dp stroke, label in the on-surface colour, no
   * elevation.
   *
   * https://github.com/material-components/material-components-android/blob/master/docs/components/CommonButton.md
   * "Outlined buttons pair well with filled buttons to indicate a secondary,
   * alternate action." Three filled colours in one row read as three unrelated
   * things rather than a hierarchy, which is Amit's objection (2026-09-06).
   * WHICH channel takes the lower rank is his call, not the spec's; he chose
   * chat.
   */
  kind: 'primary' | 'outline' | 'dark';
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
    kind === 'outline' ? theme.color.text.primary : theme.color.text.onAccent;
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
        highlight="dim"
        style={[
          styles.actionButton,
          kind === 'primary' && styles.actionPrimary,
          kind === 'outline' && styles.actionOutline,
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
      height: HERO_HEIGHT,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    heroFill: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    },
    /*
     * One page of the pager. The height is explicit rather than '100%' because a
     * percentage inside a horizontal ScrollView's content container resolves
     * against a height the container is still deriving; the card is a fixed
     * HERO_HEIGHT, so the page can say so.
     */
    heroPage: {
      height: HERO_HEIGHT,
    },
    /*
     * 6dp dots with a 4dp gap, active pure white over the inactive 45% white.
     * The Compose sample draws 16dp circles, which is a sample's proportion and
     * not a spec; 6dp matches the palette already used over this media — the
     * meta line at 82% white, the 10dp presence dot — and keeps six of them
     * reading as dots rather than as a row of buttons.
     */
    pagerDots: {
      position: 'absolute',
      top: TOKENS.space.md,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: TOKENS.space['2xs'],
    },
    pagerDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.45)',
    },
    pagerDotOn: {
      backgroundColor: '#FFFFFF',
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
    /*
     * M3 outlined button: transparent container, 1dp stroke, 0dp elevation.
     * `border/strong` is our outline role — its own note says "input and toggle
     * outlines", which is the same role M3 gives the stroke (colorOnSurface at
     * 12%). No new token for a colour we already name.
     */
    actionOutline: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.color.border.strong,
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
    /*
     * The whole ratings block is centred on the column, which is what makes the
     * number read as a verdict rather than as a table cell. `alignItems` on the
     * container does the work; every child then centres its own text, because a
     * centred View still left-aligns the text inside it.
     */
    ratingsLabel: { textAlign: 'center' },
    ratingsEmpty: { textAlign: 'center' },
    ratingBlock: {
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
    },
    ratingBig: {
      ...TOKENS.typography.headlineMediumEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
    },
    ratingStars: { flexDirection: 'row', gap: TOKENS.space.hair },
    ratingCount: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    reviewRow: {
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space.md,
    },
    reviewBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
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
