import React, { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
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

interface Props {
  /** Back to the tree's home. Settings is a mounted screen, not a sheet. */
  onBack: () => void;
  /**
   * Whether to draw a back action in the header. False on the member tree, where
   * Settings is a fixed bottom-nav tab (the Home tab is the way back, like
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
  /** Opens the recharge history + invoice download screen. Member tree only. */
  onTransactions?: () => void;
}

/**
 * Account and privacy — hand-rolled Material 3 on the Fuse tokens, the same
 * primitives every other screen uses (ADR-0010).
 *
 * This was briefly rebuilt on react-native-paper (wave-3), which made it the one
 * screen in the app drawing its header, rows and dialog from Paper's theme bridge
 * rather than our own components — a visible seam the design audit flagged. Reverted
 * (Amit, 2026-08-27): a bare-chevron header like ProviderStatus, the inset-grouped
 * row table PaymentSheet/SafetySheet already use, our `Toggle`, and the app's
 * `Sheet` for the delete confirm. Paper and its theme bridge are gone with it.
 *
 * The file keeps its name to avoid churning imports and test paths; it is a
 * screen, not a sheet. Phone verification stays the OTP sheet, and the delete
 * confirmation stays modal — a destructive confirm is one of the few things that
 * should be.
 */
export function SettingsSheet({
  onBack,
  showBack = true,
  onDeleted,
  onSignedOut,
  onApply,
  onApplicationStatus,
  onBlocked,
  onTransactions,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
      // *device* keeps the FCM token, and a token that outlives its row would be
      // re-registered by the next sign-in on this phone.
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

  const showAccountSection =
    canVerifyPhone || hasApplication || onApply !== undefined;

  return (
    <View style={styles.root} testID="settings-sheet">
      {/* A bare-chevron header on the page colour, the same anatomy as
          ProviderStatus/ProviderApplication — no tonal app bar, one surface. The
          back affordance is shown only where there is no bottom nav to carry it. */}
      <View style={[styles.header, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
        {showBack ? (
          <Pressable
            onPress={onBack}
            testID="settings-back"
            accessibilityLabel="Back"
            press="none"
            highlight="ios"
            size={28}
            style={styles.backButton}>
            <Icon name="chevronLeft" size={22} />
          </Pressable>
        ) : null}
        <Text allowFontScaling style={styles.title}>
          Account &amp; Privacy
        </Text>
      </View>

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
            someone else sees. Three rows with a checkmark: a switch cannot express
            three states, and 'hidden' must be a state, not an absence. */}
        <Text allowFontScaling style={styles.subheader}>
          Presence
        </Text>
        <View style={styles.group}>
          {PRESENCE_OPTIONS.map((option, index) => {
            const on = presence === option.value;
            return (
              <React.Fragment key={option.value}>
                {index === 0 ? null : <View style={styles.separator} />}
                <Pressable
                  onPress={() => {
                    if (!on) {
                      setPresence.mutate(option.value);
                    }
                  }}
                  testID={`presence-${option.value}`}
                  accessibilityLabel={on ? `${option.label}, selected` : option.label}
                  press="none"
                  highlight="ios"
                  style={styles.row}>
                  <Text allowFontScaling style={styles.rowTitle}>
                    {option.label}
                  </Text>
                  {on ? (
                    <Icon name="check" size={18} color={theme.color.text.primary} />
                  ) : null}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
        <Text allowFontScaling style={styles.footer}>
          {presenceDetail(presence)}
          {providerAppearance}
        </Text>

        <Text allowFontScaling style={styles.subheader}>
          Appearance
        </Text>
        <View style={styles.group}>
          {/* Not a Pressable: the Toggle is the control, and a row press that
              fought the switch would be two targets for one setting. */}
          <View style={styles.row}>
            <Text allowFontScaling style={styles.rowTitle}>
              Dark Mode
            </Text>
            <Toggle
              testID="theme-toggle"
              value={isDark}
              onValueChange={next => setMode(next ? 'dark' : 'light')}
              accessibilityLabel="Dark Mode"
            />
          </View>
        </View>
        <Text allowFontScaling style={styles.footer}>
          Follows your phone until you choose here.
        </Text>

        {showAccountSection ? (
          <>
            <Text allowFontScaling style={styles.subheader}>
              Account
            </Text>
            <View style={styles.group}>
              {canVerifyPhone ? (
                <Pressable
                  onPress={() => setVerifying(true)}
                  testID="settings-verify-phone"
                  accessibilityLabel="Verify Phone Number"
                  press="none"
                  highlight="ios"
                  style={[styles.row, styles.rowChevron]}>
                  <Text allowFontScaling style={styles.rowTitle}>
                    Verify Phone Number
                  </Text>
                  <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} />
                </Pressable>
              ) : null}
              {canVerifyPhone && (hasApplication || onApply !== undefined) ? (
                <View style={styles.separator} />
              ) : null}
              {hasApplication && onApplicationStatus !== undefined ? (
                <Pressable
                  onPress={onApplicationStatus}
                  testID="settings-application"
                  accessibilityLabel="Provider Application"
                  press="none"
                  highlight="ios"
                  style={[styles.row, styles.rowChevron]}>
                  <Text allowFontScaling style={styles.rowTitle}>
                    Provider Application
                  </Text>
                  <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} />
                </Pressable>
              ) : onApply !== undefined ? (
                <Pressable
                  onPress={onApply}
                  testID="settings-apply"
                  accessibilityLabel="Become a Provider"
                  press="none"
                  highlight="ios"
                  style={[styles.row, styles.rowChevron]}>
                  <Text allowFontScaling style={styles.rowTitle}>
                    Become a Provider
                  </Text>
                  <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} />
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}

        {/* Recharge history: top-ups and GST invoice downloads. Shown only on
            the member tree (provider tree has no onTransactions). */}
        {onTransactions !== undefined ? (
          <>
            <Text allowFontScaling style={styles.subheader}>
              Billing
            </Text>
            <View style={styles.group}>
              <Pressable
                onPress={onTransactions}
                testID="settings-transactions"
                accessibilityLabel="Recharge history"
                press="none"
                highlight="ios"
                style={[styles.row, styles.rowChevron]}>
                <Text allowFontScaling style={styles.rowTitle}>
                  Recharge history
                </Text>
                <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} />
              </Pressable>
            </View>
          </>
        ) : null}

        {/* Managing a block is a UGC-policy requirement: Home hides blocked
            people, so this is the only route back to unblocking one. */}
        {onBlocked !== undefined ? (
          <>
            <Text allowFontScaling style={styles.subheader}>
              Privacy &amp; Safety
            </Text>
            <View style={styles.group}>
              <Pressable
                onPress={onBlocked}
                testID="settings-blocked"
                accessibilityLabel="Blocked Users"
                press="none"
                highlight="ios"
                style={[styles.row, styles.rowChevron]}>
                <Text allowFontScaling style={styles.rowTitle}>
                  Blocked Users
                </Text>
                <Icon name="chevronRight" size={18} color={theme.color.text.tertiary} />
              </Pressable>
            </View>
          </>
        ) : null}

        <View style={[styles.group, styles.groupSpaced]}>
          <Pressable
            onPress={() => {
              void onSignOutPress();
            }}
            disabled={busy}
            testID="sign-out"
            accessibilityLabel="Sign Out"
            press="none"
            highlight="ios"
            style={styles.row}>
            <Text allowFontScaling style={styles.rowTitle}>
              Sign Out
            </Text>
          </Pressable>
          <View style={styles.separator} />
          {/* The destructive action in the error colour, its own separated row,
              which is how a destructive action is kept from sitting flush against
              a benign one. */}
          <Pressable
            onPress={() => setConfirming(true)}
            testID="delete-account"
            accessibilityLabel="Delete Account"
            press="none"
            highlight="ios"
            style={styles.row}>
            <Text allowFontScaling style={[styles.rowTitle, styles.rowTitleDanger]}>
              Delete Account
            </Text>
          </Pressable>
        </View>

        {/* Rate us (#9): opens the Play listing (market:// first, then the https
            fallback for devices without the Play app). The 🙏 carries the thanks. */}
        <Pressable
          onPress={() => {
            void Linking.openURL('market://details?id=com.companionchat').catch(() =>
              Linking.openURL(
                'https://play.google.com/store/apps/details?id=com.companionchat',
              ),
            );
          }}
          testID="settings-rate"
          accessibilityLabel="Rate us on the Play Store"
          press="none"
          highlight="ios"
          style={styles.rateRow}>
          <Text allowFontScaling style={styles.rateText}>
            Rate us on the Play Store 🙏
          </Text>
        </Pressable>
        <Text allowFontScaling={false} style={styles.brandFooter}>
          Pappal
        </Text>
      </ScrollView>

      {/* Phone verification stays the OTP sheet, layered over the screen. */}
      <PhoneVerifySheet visible={verifying} onClose={() => setVerifying(false)} />

      {/* Delete confirmation: a destructive confirm IS modal. Names the object and
          says what the button deletes, not 'Yes'. */}
      <Sheet
        visible={confirming}
        testID="delete-confirm-sheet"
        title="Delete Account?"
        body={
          'This permanently deletes your profile, every conversation and every ' +
          'message. It cannot be undone. Abuse reports you or someone else filed ' +
          'are kept without your name, so they cannot be erased by deleting an ' +
          'account.'
        }
        onClose={() => setConfirming(false)}
        onCancel={() => setConfirming(false)}
        cancelLabel="Cancel">
        <Button
          label="Delete Account"
          kind="danger"
          busy={busy}
          busyLabel="Deleting Account"
          onPress={() => {
            void onDelete();
          }}
          testID="delete-confirm"
        />
      </Sheet>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    backButton: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -TOKENS.space['2xs'],
    },
    title: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.md,
    },
    intro: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space['2xs'],
      paddingBottom: TOKENS.space.md,
    },
    subheader: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.lg,
      paddingBottom: TOKENS.space.xs,
    },
    // Plain white sections, not the grey inset-grouped card. A single hairline at
    // the TOP opens each section; there is no bottom hairline, because a bottom
    // rule plus the next section's top rule framed the gap between two sections as
    // an empty "ghost" row (Amit, 2026-08-27). iOS grouped-PLAIN does the same:
    // one rule per section boundary, not two.
    group: {
      backgroundColor: t.color.bg.base,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
    },
    groupSpaced: {
      marginTop: TOKENS.space.xl,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 52,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      backgroundColor: t.color.bg.base,
    },
    rowChevron: {
      // A row that navigates; the chevron already sits at the trailing edge via
      // space-between, this is just where any future per-variant tweak lands.
    },
    rowTitle: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowTitleDanger: {
      color: t.color.state.danger,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: TOKENS.space.md,
      backgroundColor: t.color.border.hairline,
    },
    footer: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.xs,
      paddingTop: TOKENS.space.xs,
    },
    rateRow: {
      alignItems: 'center',
      paddingTop: TOKENS.space['2xl'],
    },
    rateText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    brandFooter: {
      fontFamily: TOKENS.typography.wordmark.fontFamily,
      fontSize: 15,
      // The brand colour, not a grey whisper (#9): the wordmark is the brand.
      color: t.color.bg.accent,
      textAlign: 'center',
      paddingTop: TOKENS.space.sm,
      paddingBottom: TOKENS.space.md,
    },
  });
