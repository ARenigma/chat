import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { deleteAccount, signOut } from '../api/auth';
import { stopPush } from '../lib/push';
import { track } from '../lib/telemetry';
import { widgetConfigured } from '../lib/msg91Widget';
import { useMyApplication, useSetPresence } from '../api/provider';
import { useProfile } from '../api/chat';
import {
  PRESENCE_OPTIONS,
  presenceDetail,
  type PresenceOption,
} from '../lib/presence';
import { PHONE_VERIFY_ENABLED } from '../api/phone';
import { PhoneVerifySheet } from './PhoneVerifySheet';
import { resetStore, useStore } from '../store/useStore';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme, useThemeMode } from '../theme/ThemeProvider';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { Toggle } from '../components/Toggle';

interface Props {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onSignedOut: () => void;
  /** Absent on the provider tree, a provider does not apply again. */
  onApply?: () => void;
  onApplicationStatus?: () => void;
  onBlocked?: () => void;
}

/**
 * Account and privacy.
 *
 * Identity linking is gone with the anonymous session: the Google account *is*
 * the account, so there is nothing to upgrade. What replaced it is the route into
 * provider onboarding, which needs to live somewhere a member can find without
 * being advertised at, becoming a provider is a deliberate act, not a nudge.
 */
export function SettingsSheet({
  visible,
  onClose,
  onDeleted,
  onSignedOut,
  onApply,
  onApplicationStatus,
  onBlocked,
}: Props) {
  const styles = useStyles(makeStyles);
  const { isDark, setMode } = useThemeMode();
  const setNotice = useStore(s => s.setNotice);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: application } = useMyApplication();
  const { data: profile } = useProfile();
  const setPresence = useSetPresence();
  // Hidden until the profile loads, and hidden if it never does. Defaulting the
  // other way would show a checkmark against a state the person has not chosen.
  const presence = profile?.presence ?? 'hidden';

  const onDelete = useCallback(async () => {
    setBusy(true);
    try {
      // Before the account goes: the token row cascades with the user, but the
      // *device* keeps the FCM token, and a token that outlives its row would
      // be re-registered by the next sign-in on this phone.
      await stopPush();
      await deleteAccount();
      track('account_deleted');
      queryClient.clear();
      resetStore();
      // No fresh session to start any more: deletion signs you out, and the
      // phone screen is where you land.
      onDeleted();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [onDeleted, queryClient, setNotice]);

  const onSignOutPress = useCallback(async () => {
    setBusy(true);
    try {
      await stopPush();
      await signOut();
      queryClient.clear();
      resetStore();
      onSignedOut();
    } finally {
      setBusy(false);
    }
  }, [onSignedOut, queryClient]);

  // Swapped in rather than nested, the same way the delete confirmation is: two
  // Sheets on screen at once means two drag handlers and two backdrops.
  if (verifying) {
    return <PhoneVerifySheet visible={visible} onClose={() => setVerifying(false)} />;
  }

  if (confirming) {
    return (
      <Sheet
        visible={visible}
        testID="delete-confirm-sheet"
        // iOS destructive confirmations name the object rather than asking
        // 'everything?', and their confirm button says what it deletes instead of
        // saying 'Yes'.
        title="Delete Account?"
        body={
          'This permanently deletes your profile, every conversation and every ' +
          'message. It cannot be undone. Abuse reports you or someone else filed ' +
          'are kept without your name, so they cannot be erased by deleting an ' +
          'account.'
        }
        onCancel={() => setConfirming(false)}
        onClose={() => setConfirming(false)}>
        {/* The place the narration matters most: this is irreversible, it is
            slow, and the old 45% disabled label was close to unreadable at the
            exact moment somebody most wants to know it is happening. */}
        <Button
          label="Delete Account"
          kind="danger"
          busy={busy}
          busyLabel="Deleting everything"
          onPress={() => {
            void onDelete();
          }}
          testID="delete-confirm"
        />
      </Sheet>
    );
  }

  const hasApplication = application !== null && application !== undefined;

  /*
   * Offered only when it can succeed and only when it is not already done.
   *
   * Three conditions, and each removes a different way of showing a dead end.
   * `PHONE_VERIFY_ENABLED` is off while the server hop is unproven;
   * `widgetConfigured()` is false in a build with no MSG91 values; and there is
   * nothing to offer someone who has already verified.
   */
  const canVerifyPhone =
    PHONE_VERIFY_ENABLED &&
    widgetConfigured() &&
    profile !== undefined &&
    profile.phone_verified_at === null;

  return (
    <Sheet
      visible={visible}
      testID="settings-sheet"
      title="Account & Privacy"
      body={
        'Signed in with Google. Your name and email are never shown to anyone ' +
        'you talk to. No contacts, no location, no photos, no advertising ID.'
      }
      // 'Close' moves into the sheet's own bar. It was the sixth stacked
      // full-width button on this screen, which is the extreme case of the
      // Material bottom-sheet idiom this pass removes.
      onDone={onClose}
      doneLabel="Close"
      onClose={onClose}>
      {/* Five inset-grouped tables, not six stacked full-width buttons.
          Everything below is one iOS Settings screen: an exclusive choice, a
          switch row, chevron rows, and the two account actions in their own groups
          so the destructive one is never adjacent to something benign. */}

      {/* Presence, first because it is the only setting here that changes what
          somebody else sees. It is the same control in the same place for both
          roles: App.tsx mounts this sheet on the provider tree and the member
          tree, and presence is not a provider feature.

          Three rows with a checkmark rather than a segmented control or a switch.
          A switch cannot express three states, and 'hidden' has to be a state
          rather than the absence of one, or opting out and declaring yourself
          absent become the same statement. Three rows is also what iOS Settings
          does for an exclusive choice of this size. */}
      {/* Section headers, v11-style — grouped light: uppercase labels name each
          band so the sheet reads as one settings surface rather than a stack of
          unrelated cards. */}
      <Text allowFontScaling style={styles.sectionLabel}>
        PRESENCE
      </Text>
      <View style={styles.group}>
        {PRESENCE_OPTIONS.map((option, index) => (
          <PresenceRow
            key={option.value}
            option={option}
            selected={presence === option.value}
            onPress={() => {
              if (presence !== option.value) {
                setPresence.mutate(option.value);
              }
            }}
            first={index === 0}
            last={index === PRESENCE_OPTIONS.length - 1}
          />
        ))}
      </View>
      {/* The consequence of the CURRENT choice, not all three. A footer listing
          every option's effect is a second copy of the rows above it.

          The second sentence branches on role because the answer genuinely
          differs: `conversation_peers` shows a member's presence only to the
          people they have a thread with, and `provider_directory` publishes a
          provider's to every member browsing. Telling a provider that only their
          threads can see it would be false. */}
      <Text allowFontScaling style={styles.footer}>
        {presenceDetail(presence)}
        {profile?.role === 'provider'
          ? ' Anyone browsing the directory sees it too.'
          : ' Only people you have a conversation with can see it.'}
      </Text>

      <Text allowFontScaling style={styles.sectionLabel}>
        APPEARANCE
      </Text>
      <View style={styles.group}>
        {/* Setting an explicit mode rather than toggling between light and dark
            leaves `system` reachable only until the first tap, which is the right
            trade. Someone who has expressed a preference has expressed it; someone
            who never touches this keeps following the OS, which is what the
            default should do and what the initial value reflects. */}
        <View style={[styles.row, styles.rowOnly]}>
          <Text allowFontScaling style={styles.rowTitle}>
            Dark Mode
          </Text>
          <Toggle
            testID="theme-toggle"
            value={isDark}
            // Not tracked: the telemetry allowlist is enforced by a database
            // trigger, so a new event name costs a migration, and a local display
            // preference is not worth one. It is stored on the device only.
            onValueChange={next => setMode(next ? 'dark' : 'light')}
            accessibilityLabel="Dark Mode"
          />
        </View>
      </View>
      {/* Under the group, not inside the row. An explanatory sentence crammed into
          a switch row makes the row two lines tall and the sentence unfindable;
          iOS puts it in a section footer. */}
      <Text allowFontScaling style={styles.footer}>
        Follows your phone until you choose here.
      </Text>

      {canVerifyPhone || hasApplication || onApply !== undefined ? (
        <>
        <Text allowFontScaling style={styles.sectionLabel}>
          ACCOUNT
        </Text>
        <View style={styles.group}>
          {canVerifyPhone ? (
            <ChevronRow
              label="Verify Phone Number"
              onPress={() => setVerifying(true)}
              testID="settings-verify-phone"
              first
              last={!hasApplication && onApply === undefined}
            />
          ) : null}
          {hasApplication && onApplicationStatus !== undefined ? (
            <ChevronRow
              label="Provider Application"
              onPress={onApplicationStatus}
              testID="settings-application"
              first={!canVerifyPhone}
              last
            />
          ) : onApply !== undefined ? (
            <ChevronRow
              label="Become a Provider"
              onPress={onApply}
              testID="settings-apply"
              first={!canVerifyPhone}
              last
            />
          ) : null}
        </View>
        </>
      ) : null}

      {/* Managing a block is a UGC-policy requirement: v13's Home hides blocked
          people, so this is the only route back to unblocking one. */}
      {onBlocked !== undefined ? (
        <>
        <Text allowFontScaling style={styles.sectionLabel}>
          PRIVACY & SAFETY
        </Text>
        <View style={styles.group}>
          <ChevronRow
            label="Blocked Users"
            onPress={onBlocked}
            testID="settings-blocked"
            first
            last
          />
        </View>
        </>
      ) : null}

      <View style={styles.group}>
        <Pressable
          onPress={() => {
            void onSignOutPress();
          }}
          disabled={busy}
          testID="sign-out"
          accessibilityLabel="Sign Out"
          press="none"
          highlight="ios"
          style={[styles.row, styles.rowOnly, styles.centred]}>
          <Text allowFontScaling style={styles.actionLabel}>
            Sign Out
          </Text>
        </Pressable>
      </View>

      {/* Its own group, on its own, which is how iOS separates an irreversible
          action from the rest of a settings screen. */}
      <View style={styles.group}>
        <Pressable
          onPress={() => setConfirming(true)}
          testID="delete-account"
          accessibilityLabel="Delete Account"
          press="none"
          highlight="ios"
          style={[styles.row, styles.rowOnly, styles.centred]}>
          <Text allowFontScaling style={[styles.actionLabel, styles.dangerLabel]}>
            Delete Account
          </Text>
        </Pressable>
      </View>

      {/* The brandmark closes the sheet, v11-style — a quiet full stop that says
          this is the end of the settings surface. */}
      <Text allowFontScaling style={styles.brandFooter}>
        Pappal
      </Text>
    </Sheet>
  );
}

/**
 * A grouped table row that pushes somewhere.
 *
 * A chevron row, not a Button: a filled full-width button says "this is the
 * action of the sheet", and neither of these is, they are navigation.
 */
/**
 * One option in an exclusive choice: a label, and a checkmark on the one that is
 * chosen.
 *
 * The checkmark is `text/primary` rather than the accent. iOS puts tintColor on
 * a settings checkmark, and the accent budget permits a state, so this would be
 * defensible either way; primary wins because only one row in the group ever
 * carries a glyph, which makes the selection unambiguous without spending the
 * one hue the palette reserves for a call to act.
 *
 * Selection is announced through the label rather than `accessibilityState`,
 * because `Pressable` does not surface the state prop and widening the app's only
 * interactive primitive for one screen is the wrong trade. The label is what a
 * screen reader has, so the label carries the fact.
 */
function PresenceRow({
  option,
  selected,
  onPress,
  first,
  last,
}: {
  option: PresenceOption;
  selected: boolean;
  onPress: () => void;
  first: boolean;
  last: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <>
      {first ? null : <View style={styles.rowSeparator} />}
      <Pressable
        onPress={onPress}
        testID={`presence-${option.value}`}
        accessibilityLabel={selected ? `${option.label}, selected` : option.label}
        accessibilityHint={option.detail}
        press="none"
        highlight="ios"
        style={[styles.row, first && styles.rowFirst, last && styles.rowLast]}>
        <Text allowFontScaling style={styles.rowTitle}>
          {option.label}
        </Text>
        {selected ? (
          <Icon name="check" size={17} color={theme.color.text.primary} />
        ) : null}
      </Pressable>
    </>
  );
}

function ChevronRow({
  label,
  onPress,
  testID,
  first,
  last,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  first: boolean;
  last: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <>
      {first ? null : <View style={styles.rowSeparator} />}
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityLabel={label}
        press="none"
        highlight="ios"
        style={[styles.row, first && styles.rowFirst, last && styles.rowLast]}>
        <Text allowFontScaling style={styles.rowTitle}>
          {label}
        </Text>
        <Icon name="chevronRight" size={13} color={theme.color.text.tertiary} />
      </Pressable>
    </>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // `bg/sunken`, not `bg/raised`. An inset-grouped table normally sits on
    // systemGroupedBackground with its rows on systemBackground, but the sheet's
    // own surface is already `bg/raised`, and in light mode that is #FFFFFF, so
    // rows on `bg/raised` inside it would have no edge at all. Inside a sheet the
    // group takes the next step down instead.
    group: {
      alignSelf: 'stretch',
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.sunken,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      minHeight: 44,
      backgroundColor: t.color.bg.sunken,
    },
    // Radius on the group's ends only, which is what makes a run of rows read as
    // one table rather than as a stack of pills.
    rowFirst: {
      borderTopLeftRadius: TOKENS.radius.field,
      borderTopRightRadius: TOKENS.radius.field,
    },
    rowLast: {
      borderBottomLeftRadius: TOKENS.radius.field,
      borderBottomRightRadius: TOKENS.radius.field,
    },
    rowOnly: {
      borderRadius: TOKENS.radius.field,
    },
    centred: {
      justifyContent: 'center',
    },
    // Inset to the text edge, between rows and never after the last.
    rowSeparator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: TOKENS.space.md,
      backgroundColor: t.color.border.hairline,
    },
    rowTitle: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    actionLabel: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    dangerLabel: {
      color: t.color.state.danger,
    },
    footer: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space['2xs'],
    },
    // Uppercase band label above each group, iOS grouped-settings style.
    sectionLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.lg,
      paddingBottom: TOKENS.space.xs,
    },
    brandFooter: {
      fontFamily: TOKENS.typography.wordmark.fontFamily,
      fontSize: 15,
      color: t.color.text.tertiary,
      textAlign: 'center',
      paddingTop: TOKENS.space.xl,
      paddingBottom: TOKENS.space.md,
    },
  });
