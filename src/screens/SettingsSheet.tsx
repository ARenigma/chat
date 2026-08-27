import React, { useCallback, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Appbar,
  Button as PaperButton,
  Dialog,
  List,
  Portal,
  Text as PaperText,
} from 'react-native-paper';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { Toggle } from '../components/Toggle';
import { useQueryClient } from '@tanstack/react-query';
import { deleteAccount, signOut } from '../api/auth';
import { stopPush } from '../lib/push';
import { track } from '../lib/telemetry';
import { widgetConfigured } from '../lib/msg91Widget';
import { useMyApplication, useSetPresence } from '../api/provider';
import { useProfile } from '../api/chat';
import { PRESENCE_OPTIONS, presenceDetail } from '../lib/presence';
import { PHONE_VERIFY_ENABLED } from '../api/phone';
import { PhoneVerifySheet } from './PhoneVerifySheet';
import { resetStore, useStore } from '../store/useStore';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme, useThemeMode } from '../theme/ThemeProvider';

/**
 * List.Item `right` renderers, hoisted to module scope.
 *
 * Paper takes a render function for `right`; defined inline it is a new component
 * every render (the `no-unstable-nested-components` rule, and a real remount).
 * At module scope they are stable references. The chevron and check take Paper's
 * own props; the theme switch reads the mode from context itself, so selection is
 * expressed by *which* renderer is passed (or none), never by a closure.
 */
type RightProps = { color: string; style?: StyleProp<ViewStyle> };

function ChevronRight(props: RightProps) {
  return <List.Icon {...props} icon="chevron-right" />;
}

function CheckIcon(props: RightProps) {
  return <List.Icon {...props} icon="check" />;
}

function ThemeSwitchRight() {
  const { isDark, setMode } = useThemeMode();
  return (
    <View style={rightStyles.switchWrap} pointerEvents="box-none">
      <Toggle
        testID="theme-toggle"
        value={isDark}
        onValueChange={next => setMode(next ? 'dark' : 'light')}
        accessibilityLabel="Dark Mode"
      />
    </View>
  );
}

const rightStyles = StyleSheet.create({
  switchWrap: { justifyContent: 'center' },
});

interface Props {
  /** Back to the tree's home. Settings is a mounted screen, not a sheet. */
  onBack: () => void;
  /**
   * Whether to draw a back action in the app bar. False on the member tree,
   * where Settings is a fixed bottom-nav tab (the Home tab is the way back, like
   * WhatsApp); true on the provider tree, which has no bottom nav. Hardware back
   * pops it either way.
   */
  showBack?: boolean;
  onDeleted: () => void;
  onSignedOut: () => void;
  /** Absent on the provider tree, a provider does not apply again. */
  onApply?: () => void;
  onApplicationStatus?: () => void;
  onBlocked?: () => void;
}

/**
 * Account and privacy — Material 3, our tokens.
 *
 * Rebuilt on react-native-paper (wave-3 #1): a Material 3 `Appbar`, `List`,
 * `Switch` and `Dialog` instead of the hand-rolled iOS grouped list this used to
 * be. The components are Material's; the coral, the Inter type and the neutrals
 * are ours, through the theme in PaperHost. This is the pattern the rest of the
 * app's screens follow now — native M3 components wearing the design system.
 *
 * The file keeps its name to avoid a churn of imports and test paths; it is a
 * screen, not a sheet. The two genuinely modal moments stay modal: the delete
 * confirmation is an M3 `Dialog`, and phone verification is still the OTP sheet.
 *
 * Identity linking is gone with the anonymous session: the Google account *is*
 * the account. What replaced it is the route into provider onboarding, which
 * lives here because becoming a provider is a deliberate act, not a nudge.
 */
export function SettingsSheet({
  onBack,
  showBack = true,
  onDeleted,
  onSignedOut,
  onApply,
  onApplicationStatus,
  onBlocked,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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

  const providerAppearance =
    profile?.role === 'provider'
      ? ' Anyone browsing the directory sees it too.'
      : ' Only people you have a conversation with can see it.';

  return (
    <View style={styles.root} testID="settings-sheet">
      {/* Material 3 top app bar: a back action and the screen title, flat on the
          page (no tonal elevation) so it reads as one surface. */}
      <Appbar.Header mode="small" elevated={false} style={styles.appbar}>
        {/* Appbar.Action, not BackAction: BackAction's built-in icon bypasses our
            PaperProvider icon adapter and renders tofu (no vector-icons font),
            whereas an explicit `icon` routes through the adapter to our glyph.
            Shown only where there is no bottom nav to carry the way back. */}
        {showBack ? (
          <Appbar.Action icon="chevron-left" onPress={onBack} accessibilityLabel="Back" testID="settings-back" />
        ) : null}
        <Appbar.Content title="Account & Privacy" />
      </Appbar.Header>

      <ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[
          styles.scroll,
          // Clear the frosted bottom nav on the member tree (its exact height, so
          // content scrolls under the glass and clears it), or just the safe inset
          // on the provider tree, which has no nav.
          {
            paddingBottom:
              insets.bottom +
              (showBack ? TOKENS.space['3xl'] : NAV_BAR_HEIGHT + TOKENS.space.md),
          },
        ]}>
        <Text allowFontScaling style={styles.intro}>
          {'Signed in with Google. Your name and email are never shown to anyone ' +
            'you talk to. No contacts, no location, no photos, no advertising ID.'}
        </Text>

        {/* Presence, first because it is the only setting that changes what
            someone else sees. Three rows with a checkmark: a switch cannot
            express three states, and 'hidden' must be a state, not an absence. */}
        <List.Section>
          <List.Subheader>Presence</List.Subheader>
          {PRESENCE_OPTIONS.map(option => (
            <List.Item
              key={option.value}
              title={option.label}
              onPress={() => {
                if (presence !== option.value) {
                  setPresence.mutate(option.value);
                }
              }}
              testID={`presence-${option.value}`}
              accessibilityLabel={presence === option.value ? `${option.label}, selected` : option.label}
              right={presence === option.value ? CheckIcon : undefined}
            />
          ))}
        </List.Section>
        <Text allowFontScaling style={styles.footer}>
          {presenceDetail(presence)}
          {providerAppearance}
        </Text>

        <List.Section>
          <List.Subheader>Appearance</List.Subheader>
          <List.Item title="Dark Mode" right={ThemeSwitchRight} />
        </List.Section>
        <Text allowFontScaling style={styles.footer}>
          Follows your phone until you choose here.
        </Text>

        {canVerifyPhone || hasApplication || onApply !== undefined ? (
          <List.Section>
            <List.Subheader>Account</List.Subheader>
            {canVerifyPhone ? (
              <List.Item
                title="Verify Phone Number"
                onPress={() => setVerifying(true)}
                testID="settings-verify-phone"
                right={ChevronRight}
              />
            ) : null}
            {hasApplication && onApplicationStatus !== undefined ? (
              <List.Item
                title="Provider Application"
                onPress={onApplicationStatus}
                testID="settings-application"
                right={ChevronRight}
              />
            ) : onApply !== undefined ? (
              <List.Item
                title="Become a Provider"
                onPress={onApply}
                testID="settings-apply"
                right={ChevronRight}
              />
            ) : null}
          </List.Section>
        ) : null}

        {/* Managing a block is a UGC-policy requirement: Home hides blocked
            people, so this is the only route back to unblocking one. */}
        {onBlocked !== undefined ? (
          <List.Section>
            <List.Subheader>Privacy & Safety</List.Subheader>
            <List.Item
              title="Blocked Users"
              onPress={onBlocked}
              testID="settings-blocked"
              right={ChevronRight}
            />
          </List.Section>
        ) : null}

        <List.Section>
          <List.Item
            title="Sign Out"
            onPress={() => {
              void onSignOutPress();
            }}
            disabled={busy}
            testID="sign-out"
          />
          {/* The destructive action in the M3 error colour, its own separated
              item, which is how Material keeps an irreversible action from
              sitting flush against a benign one. */}
          <List.Item
            title="Delete Account"
            titleStyle={styles.dangerTitle}
            onPress={() => setConfirming(true)}
            testID="delete-account"
          />
        </List.Section>

        <Text allowFontScaling style={styles.brandFooter}>
          Pappal
        </Text>
      </ScrollView>

      {/* Phone verification stays the OTP sheet, layered over the screen. */}
      <PhoneVerifySheet visible={verifying} onClose={() => setVerifying(false)} />

      {/* Delete confirmation: an M3 dialog, because a destructive confirm IS a
          popup. Names the object and says what the button deletes, not 'Yes'. */}
      <Portal>
        <Dialog
          visible={confirming}
          onDismiss={() => setConfirming(false)}
          testID="delete-confirm-sheet">
          <Dialog.Title>Delete Account?</Dialog.Title>
          <Dialog.Content>
            <PaperText variant="bodyMedium" style={styles.dialogBody}>
              {'This permanently deletes your profile, every conversation and every ' +
                'message. It cannot be undone. Abuse reports you or someone else filed ' +
                'are kept without your name, so they cannot be erased by deleting an ' +
                'account.'}
            </PaperText>
          </Dialog.Content>
          <Dialog.Actions>
            <PaperButton onPress={() => setConfirming(false)}>Cancel</PaperButton>
            <PaperButton
              onPress={() => {
                void onDelete();
              }}
              loading={busy}
              textColor={theme.color.state.danger}
              testID="delete-confirm">
              Delete Account
            </PaperButton>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    appbar: {
      backgroundColor: t.color.bg.base,
    },
    scroll: {
      paddingHorizontal: TOKENS.space['2xs'],
    },
    intro: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space['2xs'],
      paddingBottom: TOKENS.space.sm,
    },
    footer: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space['2xs'],
    },
    dangerTitle: {
      color: t.color.state.danger,
    },
    dialogBody: {
      color: t.color.text.secondary,
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
