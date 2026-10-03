/**
 * The full-screen story viewer (owner's reference, 2026-09-26): segmented
 * progress across the top, the provider's avatar, name and time posted, a
 * ··· menu and a ✕ beside it; tap right for next, left for previous, hold to
 * pause, swipe down to close; "+ Reply" at the bottom opens the comments
 * sheet, and for a member a chat button opens the PAID chat (openChat, the
 * same entry every other surface uses).
 *
 * State lives in the pure reducer in lib/stories.ts (tested); this file maps
 * gestures, focus and the app's lifecycle onto its actions.
 *
 * GESTURE MAP (react-native-gesture-handler 3, competing: first to activate wins)
 *   tap, left third            previous story (or the previous provider's last)
 *   tap, right two thirds      next story (or the next provider, or close)
 *   hold >= 200ms              pause while held, resume on release
 *   drag down                  follows the finger; past 25% of the height or
 *                              faster than the sheet dismiss velocity, closes
 *   hardware back              closes (the native stack's own pop)
 * The left third, not half, is the platform's story idiom: forward is the
 * common action and gets the larger target.
 *
 * MOTION (animate-expo, in its order):
 *   - Story to story within a provider: NO animation. Tens a session, a cut is
 *     the feedback (step 1).
 *   - Provider to provider: a simple slide, 240ms (duration.base) strong ease-out (quint), direction
 *     from the tap (spatial consistency). Chosen over the cube: the cube is a
 *     3D rotation of two live media surfaces, twice the decode and a
 *     perspective transform on Android for a transition seen tens of times a
 *     session; a slide carries the same "next person" meaning for a fraction.
 *   - Drag to dismiss: the finger drives translateY on the UI thread; release
 *     hands its velocity to the spring (`sheetIn`/`sheetOut`, the app's
 *     sheet springs), distance OR velocity dismisses (emil-design-eng
 *     "momentum-based dismissal"). The backdrop dims from the same value.
 *   - Hold: the chrome fades out (opacity, duration.fast) and back on release.
 *   - Reduced motion: no slide (a jump), the drag still tracks the finger
 *     (it is direct manipulation) but settles without the spring, the progress
 *     segment jumps instead of filling (StoryProgress).
 *
 * The screen hides the bottom bar (`minimalShell` in the route) and pauses on
 * blur and on background (AppState), with the clip.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, useCompetingGestures, useLongPressGesture, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {

  SlideInLeft,
  SlideInRight,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProfile, useProviders, useSelfId } from '../api/chat';
import {
  deleteOwnStory,
  reportStory,
  useInvalidateStories,
  useLiveStories,
  useMarkStoryViewed,
  useMyStoryInsights,
  useSeenStoryIds,
  useStoryViewers,
} from '../api/stories';
import { FALLBACK_REPORT_TAXONOMY, getReasonLabel, useReportTaxonomy } from '../api/appConfig';
import { useBlockUser } from '../api/safety';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { StoryMedia } from '../components/stories/StoryMedia';
import { StoryProgress } from '../components/stories/StoryProgress';
import { StoryReplySheet } from '../components/stories/StoryReplySheet';
import type { ReportReason, Story } from '../lib/database.types';
import { newUuid } from '../lib/ids';
import { firstName } from '../lib/display';
import {
  currentStory,
  groupStories,
  initialViewerState,
  isOwnStory,
  playMs,
  storyAge,
  viewerReducer,
  type StoryGroup,
  type ViewerAction,
  type ViewerState,
} from '../lib/stories';
import { useStore } from '../store/useStore';
import { DURATION, EASE_OUT_QUINT, GESTURE, sheetIn, sheetOut } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

/** The viewer's own dark surface, both themes: media is framed on black. */
export const STORY_BASE = '#000000';
const INK = '#FFFFFF';
const INK_SOFT = 'rgba(255,255,255,0.78)';
const PILL = 'rgba(255,255,255,0.16)';

const HOLD_MS = 200;
const DISMISS_FRACTION = 0.25;

interface Props {
  providerIds: string[];
  startProviderId: string;
  onClose: () => void;
  onOpenChat: (peerId: string) => void;
}

type MenuStep = 'menu' | 'reasons' | 'insights' | 'confirmDelete';

export function StoryViewerScreen({ providerIds, startProviderId, onClose, onOpenChat }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const { data: selfId } = useSelfId();
  const live = useLiveStories();
  const seen = useSeenStoryIds();
  const markViewed = useMarkStoryViewed();
  const invalidate = useInvalidateStories();
  const setNotice = useStore(s => s.setNotice);

  // The order is fixed when the viewer opens: a rail refetch must not reshuffle
  // the providers under the user's thumb.
  const [state, setState] = useState<ViewerState | null>(null);
  useEffect(() => {
    if (state !== null || live.data === undefined || seen.isLoading) {
      return;
    }
    const byProvider = new Map(groupStories(live.data, Date.now()).map(g => [g.providerId, g]));
    const groups = providerIds.map(id => byProvider.get(id)).filter((g): g is StoryGroup => g !== undefined);
    setState(initialViewerState(groups, startProviderId, seen.data ?? new Set()));
  }, [state, live.data, seen.isLoading, seen.data, providerIds, startProviderId]);

  const dispatch = useCallback((action: ViewerAction) => {
    setState(prev => (prev === null ? prev : viewerReducer(prev, action)));
  }, []);

  // Direction of the last provider change, for the slide.
  const lastGroup = useRef<number | null>(null);
  const slideFrom = useRef<'right' | 'left'>('right');
  if (state !== null && lastGroup.current !== state.groupIndex) {
    slideFrom.current = lastGroup.current === null || state.groupIndex > lastGroup.current ? 'right' : 'left';
    lastGroup.current = state.groupIndex;
  }

  // Closed by the reducer (past the end, or everything expired): leave.
  const closedOnce = useRef(false);
  useEffect(() => {
    if (state?.closed === true && !closedOnce.current) {
      closedOnce.current = true;
      onClose();
    }
  }, [state?.closed, onClose]);
  useEffect(() => {
    if (live.data !== undefined && state === null && live.isFetched && providerIds.length === 0) {
      onClose();
    }
  }, [live.data, live.isFetched, state, providerIds.length, onClose]);

  // A story that expires while open drops out; checked twice a minute.
  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'prune', nowMs: Date.now() }), 30_000);
    return () => clearInterval(id);
  }, [dispatch]);

  // Background pauses (the Media3 player lifecycle: never play unseen).
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuStep, setMenuStep] = useState<MenuStep | null>(null);
  const [muted, setMuted] = useState(true);
  const [readyId, setReadyId] = useState<string | null>(null);

  const story = state === null ? null : currentStory(state);
  const group = state === null ? undefined : state.groups[state.groupIndex];
  const own = story !== null && isOwnStory(selfId, story);
  const live_ = focused && appActive && !sheetOpen && menuStep === null && state?.paused !== true;
  const running = live_ && story !== null && readyId === story.id;

  const onReady = useCallback(
    (storyId: string) => {
      setReadyId(storyId);
    },
    [],
  );
  useEffect(() => {
    if (story !== null && readyId === story.id && !own) {
      markViewed(story.id);
    }
  }, [story, readyId, own, markViewed]);
  const onFailed = useCallback(
    (storyId: string) => {
      // Gone (expired, deleted, blocked): the 404 says which by saying nothing.
      // Show the line briefly, then drop it, if the viewer is still on it.
      setTimeout(() => dispatch({ type: 'prune', nowMs: Date.now(), removedIds: [storyId] }), 1500);
    },
    [dispatch],
  );
  const onDone = useCallback(() => dispatch({ type: 'next' }), [dispatch]);

  // ---- names ---------------------------------------------------------------
  const providers = useProviders();
  const profile = useProfile();
  const who = useMemo(() => {
    if (group === undefined) {
      return { name: '', avatar: null as string | null };
    }
    if (group.providerId === selfId) {
      return { name: 'Your story', avatar: profile.data?.avatar_url ?? null };
    }
    const p = providers.data?.find(x => x.id === group.providerId);
    return { name: firstName(p?.display_name), avatar: p?.avatar_url ?? null };
  }, [group, selfId, providers.data, profile.data]);

  // ---- gestures -------------------------------------------------------------
  const dragY = useSharedValue(0);
  const close = onClose;
  const pan = usePanGesture({
    activeOffsetY: [-12, 12],
    failOffsetX: [-24, 24],
    onUpdate: e => {
      dragY.set(e.translationY > 0 ? e.translationY : e.translationY / 4);
    },
    onDeactivate: e => {
      const far = dragY.get() > height * DISMISS_FRACTION;
      const fast = e.velocityY > GESTURE.dismissVelocity;
      if (far || fast) {
        dragY.set(reduced ? withTiming(height, { duration: DURATION.fast }) : sheetOut(height, e.velocityY));
        scheduleOnRN(close);
        return;
      }
      dragY.set(reduced ? withTiming(0, { duration: DURATION.fast }) : sheetIn(e.velocityY));
    },
  });
  const hold = useLongPressGesture({
    minDuration: HOLD_MS,
    maxDistance: 24,
    runOnJS: true,
    onActivate: () => dispatch({ type: 'pause' }),
    onFinalize: () => dispatch({ type: 'resume' }),
  });
  const tap = useTapGesture({
    maxDuration: HOLD_MS + 50,
    runOnJS: true,
    // A tap activates only once it has succeeded (finger up inside the limits).
    onActivate: e => {
      dispatch({ type: e.x < width / 3 ? 'prev' : 'next' });
    },
  });
  const gestures = useCompetingGestures(pan, hold, tap);

  // Transform only: the card follows the finger; the backdrop fades beneath it.
  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.get() }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(dragY.get(), [0, height * 0.5], [1, 0], 'clamp'),
  }));

  // ---- menu actions -----------------------------------------------------------
  const block = useBlockUser();
  const { data: taxonomy = FALLBACK_REPORT_TAXONOMY } = useReportTaxonomy();
  const insights = useMyStoryInsights(menuStep === 'insights');
  const viewers = useStoryViewers(story?.id, menuStep === 'insights' && own);

  const report = async (reason: ReportReason) => {
    if (story === null) {
      return;
    }
    setMenuStep(null);
    const ok = await reportStory(story.id, reason, newUuid());
    setNotice(ok ? 'Reported. Thank you.' : 'Could not report right now.', ok ? 'confirm' : 'error');
  };
  const remove = async (target: Story) => {
    setMenuStep(null);
    const ok = await deleteOwnStory(target.id);
    if (ok) {
      invalidate();
      dispatch({ type: 'prune', nowMs: Date.now(), removedIds: [target.id] });
      setNotice('Story deleted.', 'confirm');
    } else {
      setNotice('Could not delete right now.');
    }
  };

  if (state === null || story === null || group === undefined) {
    return <View style={styles.base} />;
  }

  /*
   * Hold to pause clears the chrome, so the held frame can be looked at: the
   * feedback that the hold took (the bar stopping is too small to see under a
   * thumb). A state-driven two-value change, so a Reanimated CSS transition
   * (animate-expo step 3), opacity only, which reduced motion keeps (step 9).
   * Only the HOLD hides it, not the sheet or the menu, which cover it anyway.
   */
  const chromeStyle = {
    opacity: state.paused ? 0 : 1,
    transitionProperty: 'opacity',
    transitionDuration: DURATION.fast,
  } as const;

  const entering = reduced
    ? undefined
    : (slideFrom.current === 'right' ? SlideInRight : SlideInLeft).duration(DURATION.base).easing(EASE_OUT_QUINT);
  const insight = insights.data?.find(i => i.story_id === story.id);

  return (
    <View style={styles.base}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Animated.View style={[styles.stage, stageStyle]} testID="story-viewer">
        {/* The gestures own the media layer only: the header and bottom
            controls are its siblings above it, so pressing ✕ or Reply is
            never also a tap to the next story. */}
        <GestureDetector gesture={gestures}>
          <Animated.View key={group.providerId} entering={entering} style={styles.fill} testID="story-stage">
            <StoryMedia
              key={story.id}
              story={story}
              playing={live_}
              muted={muted}
              onReady={onReady}
              onFailed={onFailed}
            />
          </Animated.View>
        </GestureDetector>

          <Animated.View pointerEvents="box-none" style={[styles.top, chromeStyle, { paddingTop: insets.top + TOKENS.space.xs }]}>
            <StoryProgress
              count={group.stories.length}
              index={state.storyIndex}
              durationMs={playMs(story)}
              running={running}
              storyKey={story.id}
              onDone={onDone}
            />
            <View pointerEvents="box-none" style={styles.header}>
              <Avatar initial={(who.name || '·').slice(0, 1).toUpperCase()} uri={who.avatar} size={34} />
              <View style={styles.headerText}>
                {/* User text in its own node (bidi isolation). */}
                <Text allowFontScaling numberOfLines={1} style={styles.name}>
                  {who.name}
                </Text>
                <Text allowFontScaling style={styles.age}>
                  {storyAge(story.created_at, Date.now())}
                </Text>
              </View>
              {story.media_type === 'video' ? (
                <Pressable
                  onPress={() => setMuted(m => !m)}
                  accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                  press="chip"
                  shape="circle"
                  size={40}
                  testID="story-mute">
                  <Icon name={muted ? 'speakerOff' : 'speaker'} size={TOKENS.icon.lg} color={INK} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setMenuStep('menu')}
                accessibilityLabel="Story options"
                press="chip"
                shape="circle"
                size={40}
                testID="story-more">
                <Icon name="more" size={TOKENS.icon.lg} color={INK} />
              </Pressable>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close"
                press="chip"
                shape="circle"
                size={40}
                testID="story-close">
                <Icon name="close" size={TOKENS.icon.lg} color={INK} />
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View pointerEvents="box-none" style={[styles.bottom, chromeStyle, { paddingBottom: insets.bottom + TOKENS.space.sm }]}>
            <Pressable
              onPress={() => setSheetOpen(true)}
              accessibilityLabel={own ? 'Comments' : 'Reply'}
              press="button"
              style={styles.replyPill}
              testID="story-reply">
              <Icon name={own ? 'chat' : 'plus'} size={TOKENS.icon.md} color={INK} />
              <Text allowFontScaling style={styles.replyText}>
                {own ? 'Comments' : 'Reply'}
              </Text>
            </Pressable>
            {!own ? (
              <Pressable
                onPress={() => onOpenChat(group.providerId)}
                accessibilityLabel="Chat"
                accessibilityHint="Opens a paid chat"
                press="chip"
                shape="circle"
                size={48}
                style={styles.chatButton}
                testID="story-chat">
                <Icon name="chat" size={TOKENS.icon.lg} color={INK} />
              </Pressable>
            ) : null}
          </Animated.View>
      </Animated.View>

      <StoryReplySheet visible={sheetOpen} story={story} selfId={selfId} onClose={() => setSheetOpen(false)} />

      <Sheet
        visible={menuStep !== null}
        title={
          menuStep === 'reasons'
            ? 'Why are you reporting this?'
            : menuStep === 'insights'
              ? 'Insights'
              : menuStep === 'confirmDelete'
                ? 'Delete this story?'
                : 'Story'
        }
        onClose={() => setMenuStep(null)}
        onCancel={menuStep === 'menu' ? undefined : () => setMenuStep('menu')}
        cancelLabel="Back"
        detents={menuStep === 'insights' ? 'large' : 'auto'}
        testID="story-menu">
        {menuStep === 'menu' && own ? (
          <>
            <MenuRow label="Insights" onPress={() => setMenuStep('insights')} testID="story-menu-insights" />
            <MenuRow label="Delete story" danger onPress={() => setMenuStep('confirmDelete')} testID="story-menu-delete" />
          </>
        ) : null}
        {menuStep === 'menu' && !own ? (
          <>
            <MenuRow label="Report story" onPress={() => setMenuStep('reasons')} testID="story-menu-report" />
            <MenuRow
              label="Block"
              danger
              onPress={() => {
                setMenuStep(null);
                block.mutate(group.providerId, { onSuccess: onClose });
              }}
              testID="story-menu-block"
            />
          </>
        ) : null}
        {menuStep === 'reasons'
          ? taxonomy.reasons.map(slug => (
              <MenuRow
                key={slug}
                label={getReasonLabel(slug)}
                onPress={() => {
                  report(slug as ReportReason).catch(() => undefined);
                }}
                testID={`story-reason-${slug}`}
              />
            ))
          : null}
        {menuStep === 'confirmDelete' ? (
          <MenuRow
            label="Delete"
            danger
            onPress={() => {
              remove(story).catch(() => undefined);
            }}
            testID="story-delete-confirm"
          />
        ) : null}
        {menuStep === 'insights' ? (
          <View>
            <View style={styles.stats}>
              <Stat label="Views" value={insight?.view_count} />
              <Stat label="Reactions" value={insight?.reaction_count} />
              <Stat label="Comments" value={insight?.comment_count} />
            </View>
            {(viewers.data ?? []).map((v, i) => (
              <ViewerRow key={`${v.display_name}-${i}`} name={firstName(v.display_name) || v.display_name} avatar={v.avatar_url} reaction={v.reaction} />
            ))}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

function MenuRow({ label, onPress, danger, testID }: { label: string; onPress: () => void; danger?: boolean; testID: string }) {
  const sheet = useStyles(makeSheetStyles);
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} press="row" style={sheet.menuRow} testID={testID}>
      <Text allowFontScaling style={[sheet.menuLabel, danger && sheet.menuDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  const sheet = useStyles(makeSheetStyles);
  return (
    <View style={sheet.stat}>
      <Text allowFontScaling maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLarge} style={sheet.statValue}>
        {value ?? 0}
      </Text>
      <Text allowFontScaling style={sheet.statLabel}>
        {label}
      </Text>
    </View>
  );
}

function ViewerRow({ name, avatar, reaction }: { name: string; avatar: string | null; reaction: string | null }) {
  const sheet = useStyles(makeSheetStyles);
  return (
    <View style={sheet.viewerRow}>
      <Avatar initial={name.slice(0, 1).toUpperCase()} uri={avatar} size={34} />
      <Text allowFontScaling numberOfLines={1} style={sheet.viewerName}>
        {name}
      </Text>
      {reaction !== null ? (
        <Text allowFontScaling={false} style={sheet.viewerReaction}>
          {reaction}
        </Text>
      ) : null}
    </View>
  );
}

/** The menu and insights live in the themed Sheet, so they read the theme. */
const makeSheetStyles = (t: Theme) =>
  StyleSheet.create({
    menuRow: {
      minHeight: TOKENS.layout.rowOneLine,
      justifyContent: 'center',
    },
    menuLabel: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    menuDanger: {
      color: t.color.state.danger,
    },
    stat: {
      alignItems: 'center',
    },
    statValue: {
      ...TOKENS.typography.titleLarge,
      color: t.color.text.primary,
    },
    statLabel: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    viewerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      minHeight: TOKENS.layout.rowOneLine,
    },
    viewerName: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      flex: 1,
    },
    viewerReaction: {
      fontSize: 20,
    },
  });

/*
 * The chrome is white on black in both themes, like the call screen: it sits
 * on media, not on a theme surface. The sheets it opens are themed.
 */
const makeStyles = (_t: Theme) =>
  StyleSheet.create({
  base: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: STORY_BASE,
  },
  stage: {
    flex: 1,
    backgroundColor: STORY_BASE,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFill,
  },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: TOKENS.space.xs,
    gap: TOKENS.space.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    paddingLeft: TOKENS.space['2xs'],
  },
  headerText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: TOKENS.space.xs,
    minWidth: 0,
  },
  name: {
    ...TOKENS.typography.labelLarge,
    color: INK,
    flexShrink: 1,
  },
  age: {
    ...TOKENS.typography.bodySmall,
    color: INK_SOFT,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
  },
  replyPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    minHeight: TOKENS.interaction.minTarget,
    paddingHorizontal: TOKENS.space.lg,
    borderRadius: TOKENS.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: PILL,
  },
  replyText: {
    ...TOKENS.typography.labelLarge,
    color: INK,
  },
  chatButton: {
    backgroundColor: PILL,
    borderRadius: TOKENS.radius.pill,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: TOKENS.space.md,
  },
});
