import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderPhoto, ProviderSummary } from '../lib/database.types';
import { avatarImageSource } from '../lib/clayAvatars';
import { genderLetter, initialOf, providerFirstName } from '../lib/display';
import { offeredChannelsLine, presenceForSpeech, readPresence } from '../lib/presence';
import { tick } from '../lib/haptics';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { contentColumnWidth } from '../lib/windowSize';
import { rateLabel, type Channel } from '../lib/rates';
import { useProfile, useProviders } from '../api/chat';
import { useProviderPhotos, useProviderRatings } from '../api/provider';
import { CALLS_ENABLED } from '../api/calls';
import { useEconomicsConfig, useKillSwitches, FALLBACK_ECONOMICS } from '../api/appConfig';
import { useStore } from '../store/useStore';
import { useFavorites } from '../store/useFavorites';
import { minutesUntil, useNotifyProvider } from '../api/sessions';
import { fadeSwapOutFast, springTo } from '../theme/motion';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';
import { RatingStars } from '../components/RatingStars';
import { MetaChip } from '../components/MetaChip';
import { displayRating, formatReviewCount } from '../lib/systemRating';
import { ScreenLoader } from '../components/ScreenLoader';
import { openWallet } from '../lib/routes/actions';

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
  /**
   * Presented as a tall native sheet (the `ProviderDetail` route, owner
   * 2026-09-26, ADR-0032). The sheet's edge sits below the status bar, so the
   * bar takes no top inset; and the page's vertical scroller turns on nested
   * scrolling, which a ScrollView inside an Android form sheet needs so that
   * BottomSheetBehavior tells a scroll from a drag down
   * (https://reactnavigation.org/docs/native-stack-navigator#presentation).
   */
  sheet?: boolean;
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
/*
 * No back barrier, deliberately (navigation step 7): this is a native-stack
 * route (a formSheet, or the full-page ProviderProfile), so hardware back is
 * the stack's and pops it. Home's search back-guard (useSearchBack) is
 * focus-scoped and is not registered while this screen covers Home.
 */
export function ProviderDetailScreen({ providerId, onBack, onOpenChat, onStartCall, sheet = false }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
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
  // Favourites are persisted now (#10), not throwaway local state — the heart
  // reads and writes the saved-favourites store, which the Favourites tab lists.
  const favorite = useFavorites(s => s.ids.includes(providerId));
  const toggleFavorite = useFavorites(s => s.toggle);

  // No block/report on the profile card. A member can only block a provider they
  // have actually had a session with, and that action lives in the chat itself
  // (the chat header + a message long-press open the SafetySheet). The profile
  // card is discovery — offering block here let a member block a provider they
  // had never interacted with (Amit, 2026-09-10).

  const provider = useMemo<ProviderSummary | null>(
    () => (providers ?? []).find(p => p.id === providerId) ?? null,
    [providers, providerId],
  );

  /*
   * The one rating this screen shows, from the same function the card and the
   * hero use — so tapping a "4.7" never opens a profile that disagrees with it.
   * Falls back to a zeroed shape while the directory is still loading, which is
   * the only moment `provider` is null and the block is not rendered anyway.
   */
  const shownRating = useMemo(
    () =>
      provider === null
        ? { score: 0, count: 0, system: false }
        : displayRating(provider),
    [provider],
  );

  const onChat = useCallback(() => onOpenChat(providerId), [onOpenChat, providerId]);
  const onAudio = useCallback(() => onStartCall(providerId, 'audio'), [onStartCall, providerId]);
  const onVideo = useCallback(() => onStartCall(providerId, 'video'), [onStartCall, providerId]);

  /*
   * THE NOTIFY ACTION, WHICH RUNS HERE RATHER THAN SOMEWHERE ELSE.
   *
   * It used to be `onPress={onChat}`: the away button opened the conversation,
   * `announce_chat_open` fired from the chat's controller (`useAnnounceChatOpen`
   * in `src/chat-v2/useChatV2Controller.ts`), and this screen
   * unmounted on the tap. So the one surface that could have shown "Notified"
   * was gone before there was anything to show, and idle -> pending -> notified
   * could not exist. `useNotifyProvider` performs the RPC in place and keeps the
   * member here; the state it returns is what the button draws.
   *
   * NOTIFIED NOW SURVIVES A COLD START, and the paragraph that used to stand
   * here said it could not. It was wrong about one thing and the rest followed:
   * `announce_chat_open` is not the only way to read the cooldown. The push it
   * dispatches is recorded in `conversation_thread_meta.provider_alerted_at`
   * (068:131-140), which the member may read directly (030:280-292), so the
   * state is restored from the server WITHOUT ringing anything. See
   * `useRestoredNotifyState` in api/sessions.ts.
   *
   * It mattered more than it read. Found on the S22 by force-stopping and
   * relaunching: the control came back saying "Notify" for somebody who had
   * just been notified, the member tapped it, and 068's thirty-minute
   * per-direction cooldown swallowed the second tap — so they believed they had
   * pinged twice and the provider had been pinged once. The control was lying
   * about the server's state.
   *
   * STILL NOTHING IS PERSISTED LOCALLY, because a local flag is the one thing
   * that CAN claim the peer knows when the server never told anyone. And the
   * restored button stays pressable: a tap on it answers `cooldown` with the
   * authoritative `cooldown_until`, or actually alerts if the window has since
   * been shortened.
   */
  const notify = useNotifyProvider(providerId);
  const notified = notify.state.kind === 'notified';
  const notifyAgainIn = notify.state.kind === 'notified' ? minutesUntil(notify.state.cooldownUntil) : null;

  /*
   * AWAY OFFERS ONE ACTION, AND IT IS NOT A CALL.
   *
   * The same rule the directory row got on 2026-09-13 (ProviderRow.tsx:413),
   * from the same column: the master switch, `is_available`, so this screen
   * and the card the member tapped to reach it cannot disagree about who can
   * be reached. The switch and NOT the presence dot (2026-09-27, migration
   * 155): the dot is the server's `online`, a heartbeat in the last 75 s, and
   * a provider who is open but idle still takes a call, so offering them only
   * a bell would withhold an action that works. A row that said "Notify" must not open a
   * profile offering Call and Video — that is the false-affordance class twice
   * over, since the tap would ring a phone nobody is holding and `start_call`
   * would refuse it anyway.
   *
   * CLOSED OUTRANKS THE CHANNEL SET, which is the one ordering rule between
   * this branch and the gating below it: a provider who has shut the master
   * switch is offline whatever their three toggles say, so the branch is taken
   * first and the channels are never consulted inside it.
   *
   * The Notify action needs no new endpoint. It opens the conversation, and
   * opening it is what notifies them: `announce_chat_open` (migration 068)
   * pushes to the peer precisely when they are away, the member has a minute,
   * and no session is running.
   */
  const away = provider !== null && !provider.is_available;
  /*
   * `peer_present` came back from the doorbell: they are here NOW, between the
   * directory read this screen is drawn from and the tap. Offering to fetch
   * somebody who is standing in the room is the false affordance in reverse, so
   * the row of live actions comes back. The directory is invalidated in the same
   * breath (api/sessions.ts), so the presence dot agrees on the next read.
   */
  const peerBack = notify.state.kind === 'present';

  return (
    <View style={styles.root}>
      {/* No bar at all on the sheet. Its back arrow went first (the grabber,
          the swipe down and system back already close it; S22, 2026-09-27),
          which left a bar holding only the balance, right under the page's own
          balance chip that stays visible above the sheet: the same chip twice
          (S22, 2026-09-29). The full page keeps both. */}
      {sheet ? (
        <View style={styles.barSheet} />
      ) : (
        <View style={[styles.bar, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
          <BackButton onPress={onBack} testID="detail-back" style={styles.barIcon} />
          <TokenCounter balance={balance} onPress={openWallet} />
        </View>
      )}

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
          nestedScrollEnabled={sheet}
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
            {away && !peerBack ? (
              /* One action, full width — the row's three slots collapse to one
                 because there is only one honest thing to offer. The bell and
                 the word together, as on the directory row: the glyph says this
                 is a different KIND of action from the Call this button is
                 standing in for, and the word says which. Priced at the CHAT
                 rate because that is what it opens and what it will bill.

                 THE SWAP IS THE ONE NEW ANIMATION IN THIS CHANGE, and it is a
                 fade-through of the whole control rather than of its parts: the
                 button changes its mind as one object, which three independently
                 fading pieces would not read as. `fadeSwapOutFast` is the existing
                 builder for exactly this ("a button label that just narrated
                 itself", motion.ts), DURATION.fast (170ms), EASE_OUT, opacity
                 only, and it carries `reduceMotion(ReduceMotion.System)` so the
                 OS setting turns the movement off without turning the state
                 change off. Keyed on the state name, so it runs once per
                 transition and never on a re-render.

                 A live region, not an announcement: a focused control whose
                 label changes does not announce on its own, and Android 16
                 deprecates announceForAccessibility in favour of exactly this.
                 https://developer.android.com/about/versions/16/behavior-changes-all

                 OFF WHILE IDLE, because a live region speaks when its content
                 ARRIVES as well as when it changes, and this subtree arrives
                 whenever the screen does. Polite only once the control has
                 something to report. */
              <Animated.View
                key={notify.state.kind}
                exiting={fadeSwapOutFast}
                style={styles.actionSlot}
                accessibilityLiveRegion={notify.state.kind === 'idle' ? 'none' : 'polite'}>
                <ActionButton
                  channel="chat"
                  kind="tonal"
                  glyph={notified ? 'check' : 'bell'}
                  word={notified ? 'Notified' : 'Notify'}
                  rate={chatRate}
                  note={notifyAgainIn === null ? undefined : `again in ${notifyAgainIn}m`}
                  busy={notify.state.kind === 'pending'}
                  busyLabel="Notifying"
                  enabled={provider.chat_enabled}
                  offered={provider.chat_enabled}
                  onPress={notify.notify}
                  label={
                    notified
                      ? `${providerFirstName(provider.display_name)} has been notified`
                      : `Notify ${providerFirstName(provider.display_name)} that you want to chat`
                  }
                />
              </Animated.View>
            ) : (
              /* ONLY WHAT IS OFFERED IS DRAWN, and this is a change of kind
                 rather than of degree: these three used to render always and go
                 disabled, which is M3's vocabulary for "this control exists and
                 you may not use it yet" and was answering a question nobody
                 asked. Amit, 2026-09-17: show only the offered actions, plus a
                 line naming the limit. The line is in the hero, under the name.

                 `enabled` keeps only the OPERATOR's kill switches now. The two
                 states it used to conflate are different facts — "we have not
                 shipped this" is ours and stays as a dimmed button with
                 "coming soon", "she does not do this" is hers and is now an
                 absence — which is why `offered` survives on the away branch
                 above and has nothing left to say down here.

                 064's `profiles_at_least_one_channel` is what keeps this row
                 from rendering empty. */
              <>
                {provider.audio_enabled ? (
                  <ActionButton
                    channel="audio"
                    kind="primary"
                    glyph="call"
                    rate={audioRate}
                    enabled={voiceCallsEnabled}
                    onPress={onAudio}
                    label={`Call ${providerFirstName(provider.display_name)}`}
                  />
                ) : null}
                {provider.chat_enabled ? (
                  <ActionButton
                    channel="chat"
                    kind="outline"
                    glyph="chat"
                    rate={chatRate}
                    enabled
                    onPress={onChat}
                    label={`Message ${providerFirstName(provider.display_name)}`}
                  />
                ) : null}
                {provider.video_enabled ? (
                  <ActionButton
                    channel="video"
                    kind="dark"
                    glyph="video"
                    rate={videoRate}
                    enabled={videoCallsEnabled}
                    onPress={onVideo}
                    label={`Video call ${providerFirstName(provider.display_name)}`}
                  />
                ) : null}
              </>
            )}
          </View>

          <View style={styles.hairline} />

          <Text allowFontScaling style={styles.aboutLabel}>
            About
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

              The earned stars are the FILL glyph, not the outline one in a
              different colour. That paragraph used to say the opposite, and it
              was true when it was written: the set then had one stroked `star`
              and a static font cannot fake a fill, so colour carried the whole
              state. The icon font now carries `star-fill` beside `star`, which
              is what `active` on `Icon` selects, and
              this block was left behind on the colour-only path while
              `RatingStars` (the directory row) moved over. A rating read as
              five outlines in two tints here and as four solid stars plus an
              outline on the card the member had just tapped. */}
          <Text allowFontScaling style={[styles.aboutLabel, styles.ratingsLabel]}>
            Ratings
          </Text>
          {/*
            * THE SUMMARY FOLLOWS THE DIRECTORY; THE REVIEWS BELOW STAY REAL.
            *
            * Found on the device: a card showing "4.7 stars" opened a profile
            * that said "No ratings yet. Yours would be the first." — the member
            * taps a number and lands on its contradiction, on the one screen
            * they went to in order to check it.
            *
            * So the headline figure comes from `displayRating`, the same
            * function the card and the hero use, and there is no empty state
            * left to reach. What is NOT faked is the list underneath:
            * `ratings.recent` is genuine review text and stays exactly as
            * written. A summary that says 5.8k above three real reviews is odd;
            * a summary that contradicts the card the member just tapped is
            * worse, and this is the lesser of the two while system ratings are
            * on. It resolves itself at 50 genuine ratings, when `displayRating`
            * starts returning the real numbers here and everywhere else.
            */}
          {(
            <View testID="ratings-chart" style={styles.ratingBlock}>
              <Text
                maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized}
                allowFontScaling
                style={styles.ratingBig}>
                {shownRating.score.toFixed(1)}
              </Text>
              <View style={styles.ratingStars}>
                {/* The fraction, drawn: RatingStars at icon.md (B3, 2026-09-29).
                    Floor drew 4.9 as four stars under a card that shows ~five;
                    rounding up drew a solid fifth star under "4.7". A clipped
                    fifth star says exactly the number above it, the way the
                    card already does. */}
                <RatingStars
                  score={shownRating.score}
                  size={TOKENS.icon.md}
                  accessibilityLabel={`Rated ${shownRating.score.toFixed(1)} out of 5`}
                />
              </View>
              <Text allowFontScaling style={styles.ratingCount}>
                {`${formatReviewCount(shownRating.count)} ${shownRating.count === 1 ? 'review' : 'reviews'}`}
              </Text>

              {(ratings?.recent ?? []).map((r, i) => (
                <View key={`${r.created_at}-${i}`} style={styles.reviewRow}>
                  <View style={styles.ratingStars}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <Icon
                        key={n}
                        name="star"
                        active={n <= r.rating}
                        size={TOKENS.icon.xs}
                        color={n <= r.rating ? theme.color.text.rating : theme.color.border.strong}
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

        </ScrollView>
      )}
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
  const reduceMotion = useReduceMotion();

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
      size={TOKENS.interaction.minTarget}
      style={styles.favoriteTarget}>
      {/* The 40dp scrim circle is the look; the Pressable around it is the
          48dp target TalkBack measures (B7, S22 audit 2026-09-29). */}
      <View style={styles.favorite}>
      <Animated.View style={[styles.favoriteGlyph, pop]}>
        <Icon
          name="heart"
          active={favorite}
          size={TOKENS.icon.md}
          color={favorite ? accent : LIGHT.color.text.onAccent}
        />
      </Animated.View>
      </View>
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
  // The coral field, ramp 500 -> 700 rather than 400 -> 600 (owner,
  // 2026-09-27): with no photo there is no scrim, so the name block reads
  // white straight off it, and on 400 -> 600 the 82% meta line measures 3.89:1
  // (3.65:1 at the 600dp column), under 4.5 (check-contrast.mjs GRADIENT_TEXT).
  const gradient = `linear-gradient(150deg, ${theme.color.bg.accentGradientFrom} 0%, ${theme.color.bg.accentGradientTo} 100%)`;
  // The hero's dot and its spoken line: the server's `online` or last seen
  // (migration 155), the reading every other dot uses.
  const presence = readPresence({
    online: provider.online,
    lastSeenAt: provider.last_seen_at,
    now: new Date(),
  });
  // Suppressed while they are closed, because the actions below have already
  // collapsed to Notify and a limit on a set nobody can reach says nothing.
  // The switch, as `away` is, and not the dot: an open, idle provider's
  // actions are all still there, and so is the limit on them.
  const channelLine = provider.is_available ? offeredChannelsLine(provider) : null;
  // "F-28" here too, so the hero, the card and this header agree on how a
  // person is labelled. See `genderLetter`.
  const letter = genderLetter(provider.gender);
  const age =
    provider.age !== null
      ? ` ${letter === null ? '' : `${letter}-`}${provider.age}`
      : '';
  const languages = provider.languages.slice(0, 3);

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
                accessibilityLabel={`${providerFirstName(provider.display_name)}, photo ${i + 1} of ${gallery.length}`}>
                <Image
                  source={avatarImageSource(uri, pageW, HERO_HEIGHT) ?? undefined}
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
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized}
            allowFontScaling
            numberOfLines={1}
            style={styles.heroName}
            // Presence is spoken here since the meta line went (it only ever
            // showed the rating, which the Ratings section below already says).
            accessibilityLabel={[`${providerFirstName(provider.display_name)}${age}`, presenceForSpeech(presence)]
              .filter(Boolean)
              .join(', ')}>
            {providerFirstName(provider.display_name)}
            <Text style={styles.heroAge}>{age}</Text>
          </Text>
          {presence.here ? <View style={styles.heroDot} /> : null}
        </View>
        {/* Under the name and above their own words, because it qualifies the
            row of buttons below rather than describing the person. */}
        {channelLine !== null ? (
          <Text allowFontScaling numberOfLines={1} style={styles.heroChannels}>
            {channelLine}
          </Text>
        ) : null}
        {provider.headline && provider.headline !== '' ? (
          <Text allowFontScaling numberOfLines={1} style={styles.heroTagline}>
            {provider.headline}
          </Text>
        ) : null}
        {/* No rating line on the photo: the Ratings section below says it,
            with the stars and the count (Amit, 2026-09-29: "no duplication of
            information ever"). */}
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
  word,
  rate,
  note,
  busy = false,
  busyLabel,
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
  kind: 'primary' | 'outline' | 'dark' | 'tonal';
  glyph: 'call' | 'chat' | 'video' | 'bell' | 'check';
  /**
   * A word beside the glyph, for the button that is alone in the row.
   *
   * The three-up row says what it does with a glyph and nothing else, which
   * works because the three are a SET — phone, bubble, camera read against each
   * other. The away state has no set to read against: one bell over a rate
   * would be a guess. So the button that replaces the row carries the verb, and
   * carrying it turns the layout on its side (`actionWide`) rather than adding
   * a third stacked line to a 64dp box.
   */
  word?: string;
  /** Live admin rate (tokens/min). Falls back to DEFAULT_RATES[channel] at the call site. */
  rate: number;
  /**
   * Replaces the rate on the second line, and in the spoken label.
   *
   * There is exactly one caller: a Notify button that has already rung. The
   * price of a chat is the right second line while the button is an offer; once
   * it is a status, when the doorbell may ring again is the only fact left worth
   * the space.
   */
  note?: string;
  /** A request is in flight. Holds the surface compressed; see Pressable. */
  busy?: boolean;
  /**
   * What the button says while `busy`. The present participle of `word`, the
   * same contract `Button.busyLabel` has (Button.tsx:17-21) — a control that
   * compresses and says nothing tells a member their tap was felt but not what
   * it started.
   */
  busyLabel?: string;
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
  // One branch per fill, because the three fills are three different token
  // families and only `primary` is an accent one. `dark` used to fall through to
  // `text.onAccent` here while its fill was `text.primary`, which paired a
  // near-white label with a fill that IS white in dark mode (1.04:1); see the
  // note on `actionDark` in makeStyles.
  const fg =
    kind === 'outline'
      ? theme.color.text.primary
      : kind === 'dark'
        ? theme.color.text.onInverse
        : kind === 'tonal'
          ? theme.color.text.onAccentTint
          : theme.color.text.onAccent;
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
        busy={busy}
        testID={`action-${channel}`}
        accessibilityLabel={`${label}, ${note ?? rateLabel(rate)}${
          enabled ? '' : offered ? ', coming soon' : ', not offered'
        }`}
        press="none"
        highlight="dim"
        /*
         * `actionDisabled` IS GONE, and it was never doing anything. Pressable
         * applies the caller's style BEFORE its own animated style
         * (Pressable.tsx:360, `[styles.clip, shapeStyle, innerStyle, animated]`)
         * and that animated style sets `opacity: disabled ? 0.45 : 1`
         * unconditionally, so a declared `opacity: 0.5` here was overwritten on
         * every frame. One control, two answers, and the one nearest the reader
         * was the dead one. `disabled` already carries the dim and sets
         * accessibilityState.disabled; the M3 numbers behind it are
         * interaction.stateDisabledContent / Container in design/tokens.json.
         */
        style={[
          styles.actionButton,
          word !== undefined && styles.actionWide,
          kind === 'primary' && styles.actionPrimary,
          kind === 'outline' && styles.actionOutline,
          kind === 'dark' && styles.actionDark,
          kind === 'tonal' && styles.actionTonal,
        ]}>
        <Icon name={glyph} size={TOKENS.icon.lg} color={fg} />
        {word !== undefined ? (
          <Text allowFontScaling numberOfLines={1} style={[styles.actionWord, { color: fg }]}>
            {busy ? busyLabel ?? word : word}
          </Text>
        ) : null}
        <Text allowFontScaling numberOfLines={1} style={[styles.actionRate, { color: fg }]}>
          {note ?? rateLabel(rate)}
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
    // The sheet's top gap under the grabber, in place of the bar.
    barSheet: {
      height: TOKENS.space.sm,
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
    // Pulled out by the target's extra 4dp a side, so the circle sits exactly
    // where it did at 40dp.
    favoriteSlot: {
      position: 'absolute',
      top: TOKENS.space.md - (TOKENS.interaction.minTarget - 40) / 2,
      right: TOKENS.space.md - (TOKENS.interaction.minTarget - 40) / 2,
    },
    favoriteTarget: {
      width: TOKENS.interaction.minTarget,
      height: TOKENS.interaction.minTarget,
      // The state layer is the circle, as the scrim is.
      borderRadius: TOKENS.interaction.minTarget / 2,
      alignItems: 'center',
      justifyContent: 'center',
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
    // Pure white, the only line over this photo that gets it: the name is the
    // subject and this is the condition on everything below, so it outranks the
    // tagline's 95% and the meta line's 82%.
    heroChannels: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: '#FFFFFF',
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
    /*
     * accentStrong, not accent: this button carries BOTH a label and a glyph.
     *
     * `actionRate` is 12dp Bold (labelMediumEmphasized) in `text/onAccent`, and
     * the `call` glyph beside it is 22dp in the same colour.
     * developer.android.com/guide/topics/ui/accessibility/apps ("Increase text
     * visibility"): "If the text is smaller than 18sp, or if the text is bold
     * and smaller than 14sp, use foreground and background colors that result
     * in a color contrast ratio of at least 4.5:1. For all other text, set the
     * color contrast ratio to at least 3:1." 12dp is under 18sp, so the label
     * takes 4.5:1 — and the glyph does not rescue the fill either, because it
     * is a 22dp mark on the 3:1 non-text floor and `bg/accent` in DARK mode is
     * a light blue at 2.59:1, under even that. Measured 3.44:1 light / 2.59:1
     * dark; `bg/accentStrong` is 5.19:1 / 6.13:1.
     *
     * The fill moves rather than `fg`, as on the six surfaces fixed in aba2c13:
     * this is the primary of three actions and the coral is what says so, while
     * the only ink that would work is `text/primary` (4.95:1 light, 2.70:1 dark
     * — in dark it IS white). design/tokens.json says it on the token itself:
     * bg/accent "must NEVER sit under small white text; that is what
     * bg/accentStrong is for".
     */
    actionPrimary: {
      backgroundColor: t.color.bg.accentStrong,
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
    /*
     * The away "Notify" button, M3's FILLED TONAL recipe.
     *
     * WAS `actionQuiet`: transparent container, hairline stroke, `text/tertiary`
     * ink. That is not a quiet button, it is M3's DISABLED button, drawn on a
     * control that is enabled and is the only thing this screen offers. Measured
     * against the real tokens: the label 4.39:1 light / 3.68:1 dark against the
     * 4.5 floor that 12dp and 14dp type takes, and the hairline 1.71:1 / 1.50:1
     * against the 3:1 one for a non-text boundary.
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     *
     * "Filled tonal buttons have a lighter background color and darker label
     * color, making them less visually prominent than a regular filled button.
     * They're still used for final or unblocking actions in a flow, but may be
     * better when these actions don't require quite so much emphasis" — which is
     * Notify next to Call exactly. It is also the rank the old style was reaching
     * for: the doc's emphasis order is elevated, filled, filled tonal, outlined,
     * text, so tonal sits below the coral `actionPrimary` without leaving the
     * ladder.
     * https://github.com/material-components/material-components-android/blob/master/docs/components/CommonButton.md
     *
     * TWO STATED DEPARTURES. M3's tonal button has no stroke (strokeColor null,
     * strokeWidth 0dp) and 2dp of elevation; this keeps a 1dp accent stroke and
     * stays flat. The stroke is load-bearing rather than decorative —
     * `bg/accentTint` (ramp 50 / 900) measures 1.17:1 against this page in
     * light and 1.13:1 in dark, so the fill alone is not a findable boundary —
     * and both it and the label are registered pairs in
     * scripts/check-contrast.mjs (label text/onAccentTint 9.90:1 / 6.16:1,
     * outline step 500 5.19:1 / 3.25:1 against the page). The elevation is dropped because
     * nothing in this app is elevated; the design separates by fill.
     */
    actionTonal: {
      backgroundColor: t.color.bg.accentTint,
      borderWidth: 1,
      borderColor: t.color.bg.accent,
    },
    /*
     * `bg/inverse`, not `text/primary`. THE VIDEO BUTTON WAS INVISIBLE IN DARK
     * MODE, and this is a worse failure than the accent one above rather than a
     * tidier version of it.
     *
     * An ink token was being used as a fill, and the two flip in opposite
     * directions: `text/primary` is #1C1C1E light but #FFFFFF dark, while its
     * label `text/onAccent` is white in both. So in dark mode this button
     * painted #FAFAFA text and a 22dp glyph onto a #FFFFFF fill — 1.04:1, which
     * is not "hard to read", it is nothing on screen. Against
     * developer.android.com/guide/topics/ui/accessibility/apps, 4.5:1 for the
     * 12dp label and 3:1 for the glyph.
     *
     * `bg/inverse` is the token for a dark full-width fill and it exists for
     * exactly this — its own note calls it "Primary button", and it is #1C1C1E
     * in light, the SAME value `text/primary` has there, so light mode does not
     * move by a single pixel. Dark flips it to #E9EEF4 with `text/onInverse`
     * ink at 14.6:1. That pair is already registered in
     * scripts/check-contrast.mjs as "the primary button label", so this button
     * is now measured by the gate instead of being an unlisted hand-pairing of
     * an ink token with an on-accent label.
     */
    actionDark: {
      backgroundColor: t.color.bg.inverse,
    },
    /*
     * The single-action layout: a ROW, so the bell sits beside its verb.
     *
     * Found on the directory row on 2026-09-13 (ProviderRow.tsx:805) — with the
     * default column direction the bell stacked on top of "Notify" and grew the
     * control by a line. Here the box is a fixed 64dp, so a third stacked line
     * would not grow it, it would crop it.
     */
    actionWide: {
      flexDirection: 'row',
      gap: TOKENS.space.xs,
    },
    actionWord: {
      ...TOKENS.typography.labelLargeEmphasized,
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
    // Bluesky section header: text_lg font_semi_bold, sentence case, primary
    // ink, pt_2xl 24 / pb_md 12 (ModuleHeader), ADR-0033. Was an uppercase
    // 12dp overline in secondary ink.
    aboutLabel: {
      ...TOKENS.typography.textLgSemiBold,
      color: t.color.text.primary,
      paddingTop: TOKENS.space.xl,
      paddingBottom: TOKENS.space.sm,
    },
    aboutBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
  });
