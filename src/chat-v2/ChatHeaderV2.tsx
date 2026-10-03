/**
 * The V2 chat header: who you are talking to, and every control that is about
 * the conversation rather than about a message in it.
 *
 * A separate file from the screen for the same reason the composer and the
 * list are: the screen owns ONE thing, the keyboard hierarchy, and a 120-line
 * app bar inside that body is how a layout authority quietly acquires a second
 * job. It renders no keyboard component and holds no domain state — every
 * value arrives as a prop from `useChatV2Controller`.
 *
 * WHAT IS DELIBERATELY ABSENT: a member-side balance pill. It was removed from
 * the chat header on 2026-09-08 because it competed with the countdown for the
 * same glance — during a session the member needs to know how long they have,
 * and a raw token balance beside it answers a question they did not ask.
 * Balance lives on Home and in Recharge; the countdown and the recharge
 * control live in `ChatSessionBarV2`. Nor a provider earnings pill: the
 * header is the same on both sides (Amit, 2026-10-03: "provider side chat
 * header should be exactly same as member side ... provider chat header will
 * never wallet pill"), and earnings live in the provider's settings.
 */
import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Avatar } from '../components/Avatar';
import { HeaderSubtitle } from '../components/HeaderSubtitle';
import { Icon } from '../components/Icon';
import { PaperMenu, type PaperMenuItem } from '../components/PaperMenu';
import { Pressable } from '../components/Pressable';
import type { PresenceRead } from '../lib/presence';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

/**
 * The header handset, one step under `icon.md`, for an optical reason.
 *
 * Measured on the Redmi at density 440: at the same `size` token the video
 * glyph inks 19.3 x 19.3dp and the handset 19.6 x 20.0dp, so equal sizes give
 * unequal ink and the call control reads as the bigger of the pair. 19 brings
 * the handset to ~19.0dp and the two to within 0.3dp. The same measured
 * departure V1 carries, named rather than inline so the icon-scale gate can
 * see a reason instead of a drift.
 */
const CALL_GLYPH_SIZE = 19;

/** The overflow button's width, WhatsApp's (S22, 2026-10-03). */
const OVERFLOW_WIDTH = 40;

/**
 * The height the identity column always reserves: the name's line box plus the
 * presence line's, whether or not there is a presence line.
 *
 * M3 reserves top-app-bar height on the CONTAINER and composes no subtitle row
 * when there is no subtitle (`TopAppBarLayout` builds a two-child `Column` only
 * `if (subtitle != null)`; `AppBarSmallTokens.ContainerHeight = 64.dp`).
 * Reserving it on the column buys the same fixed height AND lets the one-line
 * state centre on the avatar, which an always-rendered blank row cannot do.
 */
const IDENTITY_LINES =
  TOKENS.typography.titleMediumEmphasized.lineHeight +
  TOKENS.typography.labelMedium.lineHeight;

interface Props {
  /** The private label when one is set, the peer's own name otherwise. */
  displayName: string;
  peerInitial: string;
  peerAvatarUrl: string | null;
  presence: PresenceRead;
  /** Which side of the thread we are on. Not `profiles.role`. */
  canStartAudio: boolean;
  canStartVideo: boolean;
  /** A non-chat session is live, so a call would dead-end at the call screen. */
  sessionBusy: boolean;
  /** A paid session is running, so it can be ended. */
  sessionActive: boolean;
  endingSession: boolean;
  onBack: () => void;
  /**
   * Opens the peer's full profile.
   *   Member tree  → provider detail screen
   *   Provider tree → safe member profile sheet
   * Present on both trees. When absent (benchmark route) the identity block
   * is a plain view rather than a pressable.
   */
  onOpenProfile?: () => void;
  /**
   * Report or block — moved to the right-edge overflow menu (2026-09-20).
   * Still a separate callback so the benchmark route can keep both absent.
   */
  onOpenSafety?: () => void;
  /** Absent until the conversation exists: there is nothing to label before then. */
  onRename?: () => void;
  onStartCall?: (channel: 'audio' | 'video') => void;
  onEndSession: () => void;
  /**
   * False once the chat is covered (navigation step 6). The overflow menu is a
   * Modal, and a Modal left open over a covered chat sits above the next
   * screen. Defaults to true; the old tree unmounts instead.
   */
  focused?: boolean;
}

export function ChatHeaderV2({
  displayName,
  peerInitial,
  peerAvatarUrl,
  presence,
  canStartAudio,
  canStartVideo,
  sessionBusy,
  sessionActive,
  endingSession,
  onBack,
  onOpenProfile,
  onOpenSafety,
  onRename,
  onStartCall,
  onEndSession,
  focused = true,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // The documented reactive source for the reservation below: it "automatically
  // updates all of its values when screen size or font scale changes".
  // https://reactnative.dev/docs/usewindowdimensions
  const { fontScale } = useWindowDimensions();
  const callsAvailable = onStartCall !== undefined;

  /**
   * Identity press goes to the PROFILE, never to safety.
   *
   * Before this change: `onOpenProfile ?? onOpenSafety` — on the member tree
   * both are passed, so `onOpenSafety` was unreachable from the header. That
   * meant members could only report/block from a long-press on a message.
   * Safety is now in the right-edge menu (Bluesky pattern); profile is the
   * identity tap on both trees.
   */
  const onIdentityPress = onOpenProfile;

  /** State for the right-edge overflow menu (Bluesky ConvoMenu pattern). */
  const [menuVisible, setMenuVisible] = React.useState(false);
  const [menuAnchor, setMenuAnchor] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const menuButtonRef = React.useRef<View>(null);
  React.useEffect(() => {
    if (!focused) {
      setMenuVisible(false);
    }
  }, [focused]);
  const menuHasItems =
    onRename !== undefined || onOpenSafety !== undefined;

  /*
   * The avatar, the name and the presence line, built once and then wrapped in
   * either a touch target or a plain view. The alternative — a Pressable with
   * a no-op handler — is a control that reports itself to TalkBack as a button
   * and then does nothing when it is activated.
   */
  const identity = (
    <>
      {/* 40, measured from WhatsApp on the S22 (2026-10-03): a 109px photo
          at density 450 is 38.75dp, in a 48dp slot after the 48dp back target,
          and the name starts at 100dp. 40 is the nearest avatar size. */}
      <Avatar
        initial={peerInitial}
        uri={peerAvatarUrl}
        size={40}
        online={presence.here}
      />
      <View
        style={[styles.identityText, { minHeight: IDENTITY_LINES * fontScale }]}
      >
        <Text
          testID="chat-v2-title"
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
          numberOfLines={1}
          style={styles.title}
        >
          {displayName}
        </Text>
        {/* Renders nothing when it has nothing to say, and subscribes to the
            typing store itself — a broadcast re-renders this leaf and not the
            header. */}
        <HeaderSubtitle presence={presence} />
      </View>
    </>
  );

  return (
    <View testID="chat-v2-header" style={styles.header}>
      <Pressable
        onPress={onBack}
        testID="chat-v2-back"
        accessibilityLabel="Back"
        press="none"
        highlight="dim"
        shape="circle"
        size={TOKENS.interaction.minTarget}
        style={styles.navButton}
      >
        <Icon name="back" size={TOKENS.icon.md} color={theme.color.text.secondary} />
      </Pressable>

      {/*
       * One target for the avatar, the name and the presence line — a centred
       * identity block that pushes somewhere, which is what an iOS nav title
       * does. `flex: 1` lives on this wrapper rather than on the Pressable:
       * set on the Pressable it reaches an inner view while the touchable hugs
       * its content, and the name clips to nothing.
       */}
      <View style={styles.identitySlot}>
        {onIdentityPress === undefined ? (
          <View testID="chat-v2-identity" style={styles.identity}>
            {identity}
          </View>
        ) : (
          <Pressable
            onPress={onIdentityPress}
            testID="chat-v2-identity"
            accessibilityLabel={`${displayName}. View profile`}
            accessibilityHint={onRename !== undefined ? 'Long press to rename this chat' : 'Opens their profile'}
            press="none"
            highlight="dim"
            style={styles.identity}
          >
            {identity}
          </Pressable>
        )}
      </View>

      {/*
       * Drawn and DISABLED rather than hidden, so flipping a kill switch or a
       * provider channel never changes the header's geometry. A live non-chat
       * session blocks both: the server returns BUSY, and a control that is
       * drawn and then refuses is worse than one that was never there.
       */}
      <Pressable
        onPress={() => onStartCall?.('video')}
        disabled={!callsAvailable || !canStartVideo || sessionBusy}
        testID="chat-v2-call-video"
        accessibilityLabel={`Video call ${displayName}`}
        press="none"
        shape="circle"
        size={TOKENS.interaction.minTarget}
        style={[
          styles.navButton,
          (!callsAvailable || !canStartVideo || sessionBusy) &&
            styles.navDisabled,
        ]}
      >
        <Icon
          name="video"
          size={TOKENS.icon.md}
          color={theme.color.text.secondary}
        />
      </Pressable>
      <Pressable
        onPress={() => onStartCall?.('audio')}
        disabled={!callsAvailable || !canStartAudio || sessionBusy}
        testID="chat-v2-call-audio"
        accessibilityLabel={`Voice call ${displayName}`}
        press="none"
        shape="circle"
        size={TOKENS.interaction.minTarget}
        style={[
          styles.navButton,
          (!callsAvailable || !canStartAudio || sessionBusy) &&
            styles.navDisabled,
        ]}
      >
        <Icon
          name="call"
          size={CALL_GLYPH_SIZE}
          color={theme.color.text.secondary}
        />
      </Pressable>

      {/*
       * End, and it lives in the header rather than in the countdown bar: the
       * bar appears only inside the last five minutes, and a member who could
       * not stop paying until the money had nearly run out would be able to
       * end a session at the one moment ending it saves them nothing.
       *
       * `disabled` while the request is in flight, not `busy`: `busy` is the
       * held-compression state that pairs with a `busyLabel`, and an icon-only
       * control has no label to swap. The outcome arrives as the dialog.
       */}
      {sessionActive ? (
        <Pressable
          onPress={onEndSession}
          disabled={endingSession}
          testID="chat-v2-end-session"
          accessibilityLabel="End paid session"
          accessibilityHint="Stops the per-minute charge"
          press="none"
          size={TOKENS.interaction.minTarget}
          shape="circle"
          style={styles.navButton}
        >
          {/* A door with an arrow out, not a stop square: this control LEAVES a
              session rather than halting a process. Danger red stays — it is
              the one destructive control in the bar. */}
          <Icon
            name="logout"
            size={TOKENS.icon.md}
            color={theme.color.state.danger}
          />
        </Pressable>
      ) : null}

      {/*
       * Right-edge overflow menu (Bluesky ConvoMenu pattern).
       *
       * Block, Report, and Rename used to be reached from the identity tap
       * (member tree: `onOpenSafety` was unreachable because `onOpenProfile ??
       * onOpenSafety` always resolved to profile; provider tree: identity opened
       * safety with no profile). Splitting them here fixes both trees:
       *   Identity tap → profile on both sides
       *   ··· menu     → Rename / Block / Report
       * Absent on the benchmark route (no `onOpenSafety` → no `menuHasItems`).
       */}
      {menuHasItems ? (
        <>
          <Pressable
            onPress={() => {
              menuButtonRef.current?.measureInWindow((x, y, w, h) => {
                setMenuAnchor({ x, y, width: w, height: h });
                setMenuVisible(true);
              });
            }}
            testID="chat-v2-menu"
            accessibilityLabel="Conversation options"
            press="none"
            highlight="dim"
            shape="circle"
            size={OVERFLOW_WIDTH}
            style={[styles.navButton, styles.overflowButton]}
          >
            {/* Wrap in a View so measureInWindow works (Pressable is not a View). */}
            <View ref={menuButtonRef} collapsable={false}>
              <Icon name="more" size={TOKENS.icon.md} color={theme.color.text.secondary} />
            </View>
          </Pressable>
          <PaperMenu
            visible={menuVisible}
            anchor={menuAnchor}
            anchorKind="trigger"
            onClose={() => setMenuVisible(false)}
            items={([] as PaperMenuItem[]).concat(
              onRename !== undefined
                ? [{ key: 'rename', label: 'Rename chat', onPress: () => { setMenuVisible(false); onRename(); } }]
                : [],
              onOpenSafety !== undefined
                ? [
                    { key: 'report', label: 'Report', onPress: () => { setMenuVisible(false); onOpenSafety(); } },
                    { key: 'block', label: 'Block', divider: true, onPress: () => { setMenuVisible(false); onOpenSafety(); } },
                  ]
                : [],
            )}
          />
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      // space.xs, not sm: five controls plus the pill in one row, and 12pt gaps
      // leave the name about 60pt on a 360pt screen.
      // No gap: each 48dp target already carries its own 12dp of air around
      // the glyph, which is the spacing the 28dp boxes plus an 8dp gap made.
      gap: 0,
      // Flush, as WhatsApp's toolbar is (S22, 2026-10-03: back target from
      // x=0, overflow to the right edge): the 48dp targets carry their own air,
      // and the 16dp this padding cost came out of the name and the "last
      // seen" line, which clipped.
      paddingHorizontal: 0,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.sm,
      // The M3 small top app bar's container height, stated rather than left to
      // arithmetic: the measure policy floors the bar at it.
      minHeight: TOKENS.layout.appBarSmall,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
      backgroundColor: t.color.bg.base,
    },
    // 48dp targets around the unchanged 24dp glyphs: M3's icon button and
    // Android's minimum touch target (developer.android.com/guide/topics/ui/
    // accessibility/apps#large-controls). They were 28x40, the smallest
    // controls on the most-used screen (B8, S22 audit 2026-09-29).
    navButton: {
      width: TOKENS.interaction.minTarget,
      height: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
      // No borderRadius here: icon-only callers pass shape="circle" so the
      // Pressable paints a circle state layer. A radius here would override
      // shapeStyle (see Pressable.tsx, where innerStyle follows shapeStyle).
    },
    // WhatsApp's overflow is 113px = 40dp wide against the right edge; the
    // Pressable's slop (size 40) still makes a 48dp target.
    overflowButton: {
      width: OVERFLOW_WIDTH,
    },
    // The M3 disabled container opacity, which is what a control that is drawn
    // and cannot fire has to look like.
    // https://m3.material.io/foundations/interaction/states/state-layers
    navDisabled: {
      opacity: 0.35,
    },
    identitySlot: {
      flex: 1,
    },
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      // 48 back + 4 + 40 avatar + 8 gap = the name at 100dp, WhatsApp's x.
      paddingLeft: TOKENS.space['2xs'],
      paddingVertical: TOKENS.space.hair,
      borderRadius: TOKENS.radius.xs,
      borderCurve: 'continuous',
    },
    identityText: {
      flex: 1,
      justifyContent: 'center',
    },
    title: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
  });
