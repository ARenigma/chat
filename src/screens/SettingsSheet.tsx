import React, { useCallback, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { THEME_DEFAULT_MODE } from '../config';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { TopAppBar, TOP_APP_BAR_HEIGHT } from '../components/TopAppBar';
import { TabTopBar } from '../components/TabTopBar';
import { ChatWallpaper } from '../components/ChatWallpaper';
import { Divider } from '../components/Divider';
import { useQueryClient } from '@tanstack/react-query';
import { deleteAccount, signOut } from '../api/auth';
import { stopPush } from '../lib/push';
import { track } from '../lib/telemetry';
import { widgetConfigured } from '../lib/msg91Widget';
import { useSetClayAvatar, useSetPresence } from '../api/provider';
import { CLAY_SEEDS, CLAY_IMAGES } from '../lib/clayAvatars';
import { useProfile } from '../api/chat';
import { PRESENCE_OPTIONS, presenceDetail } from '../lib/presence';
import { PHONE_VERIFY_ENABLED } from '../api/phone';
import { legalUrl } from '../lib/legal';
import { initialOf } from '../lib/display';
import { formatRupees } from '../lib/rates';
import { Avatar } from '../components/Avatar';
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
  onBlocked?: () => void;
  /** Opens the recharge history + invoice download screen. Member tree only. */
  onTransactions?: () => void;
  /**
   * Opens the per-session usage ledger. On BOTH trees (goal item 2): a member
   * asks where the tokens went, a provider asks which conversation paid what,
   * and it is the same rows read from two sides.
   */
  onUsage?: () => void;
  /**
   * Provider-only controls (availability, what they offer, photos, earnings,
   * stats) rendered between the profile hero and the settings list. This is how
   * the provider's "You" tab is the SAME single settings surface as the member's
   * — one screen, not a dashboard plus a second settings behind a gear. Hidden
   * while a search is open, exactly like the hero. Member tree passes nothing.
   */
  topSection?: React.ReactNode;
  /**
   * Docked inside another screen's own bottom nav (the provider "You" tab) rather
   * than the member tree's overlay toolbar. The host nav already reserves the
   * bottom safe-area inset, so the scroll clears itself with plain breathing room
   * instead of the toolbar's height. Ignored when `showBack` is true.
   */
  embedded?: boolean;
}

/**
 * Where a row's title starts: the 32 dp icon slot plus the content slot's
 * leading pad. Dividers align to this so a rule never cuts under the icon.
 */
const ROW_TEXT_INSET = 32 + TOKENS.space.sm;

interface SettingsRowContentProps {
  icon: IconName;
  title: string;
  detail?: string;
  selected?: boolean;
  danger?: boolean;
  chevron?: boolean;
}

/**
 * One accessible list-item content grid: leading icon, dominant content slot,
 * and a narrow trailing slot. The Pressable owner remains the single 48dp+
 * action target, as required by the M3 list slot guidance.
 * https://m3.material.io/components/lists/specs
 */
function SettingsRowContent({
  icon,
  title,
  detail,
  selected = false,
  danger = false,
  chevron = true,
}: SettingsRowContentProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <>
      <View style={[styles.iconBox, danger && styles.iconBoxDanger]}>
        <Icon
          name={icon}
          size={TOKENS.icon.md}
          color={danger ? theme.color.state.danger : theme.color.text.secondary}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text
          allowFontScaling
          style={[styles.rowTitle, danger && styles.rowTitleDanger]}>
          {title}
        </Text>
        {detail ? (
          <Text allowFontScaling numberOfLines={2} style={styles.rowDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Icon name="check" size={TOKENS.icon.sm} color={theme.color.text.primary} />
      ) : chevron ? (
        <Icon name="chevronRight" size={TOKENS.icon.sm} color={theme.color.text.tertiary} />
      ) : null}
    </>
  );
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
  onBlocked,
  onTransactions,
  onUsage,
  topSection,
  embedded = false,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mode, setMode } = useThemeMode();
  const setNotice = useStore(s => s.setNotice);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  /*
   * The bar's magnifier filters THIS screen — WhatsApp's model, and Amit's
   * answer when asked what search should do away from Home (2026-09-08). A
   * settings search that jumped to a people directory would be a tab switch
   * wearing a magnifier.
   *
   * `shows` is matched against the row's own visible title, so what a member
   * types is what they can read. While a query is open the profile hero and
   * the section subheader are hidden: they are chrome for browsing, and they
   * push the one matching row off the top of a short list.
   */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shows = (rowTitle: string) =>
    needle === '' || rowTitle.toLowerCase().includes(needle);
  const [verifying, setVerifying] = useState(false);
  const [choiceSheet, setChoiceSheet] = useState<'presence' | 'theme' | null>(null);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: profile } = useProfile();
  const setPresence = useSetPresence();
  const setClayAvatar = useSetClayAvatar();
  // Hidden until the profile loads, and hidden if it never does. Defaulting the
  // other way would show a checkmark against a state the person has not chosen.
  const presence = profile?.presence ?? 'hidden';
  const isProvider = profile?.role === 'provider';
  // The clay seed currently in use, so the picker can mark it selected.
  const currentSeed =
    profile?.avatar_url?.startsWith('clay:') === true
      ? profile.avatar_url.slice('clay:'.length)
      : null;

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

  /**
   * Leave first, tidy up after.
   *
   * This used to await five sequential network round-trips before the screen
   * moved — FCM `getToken`, the `push_tokens` delete, FCM `deleteToken`, the
   * Firebase sign-out and the Supabase one — with the button held `busy` for all
   * of it. On a slow connection that is several seconds of a dead-looking tap
   * for something the user experiences as purely local (Amit, 2026-09-04: "sign
   * out is very slow -- why?").
   *
   * None of that work needs to block the exit. Dropping the local session, the
   * cache and the store is synchronous and is what "signed out" actually means
   * on this device, so it happens now and the screen leaves immediately. The
   * remote teardown runs after, unawaited, and in an order that still has a
   * valid session when it needs one: the push token is revoked BEFORE the
   * session it authenticates with goes away.
   *
   * The failure mode if the process dies mid-teardown is a stale `push_tokens`
   * row, which `startPush` overwrites on the next sign-in on this device — the
   * same self-healing path a crash during sign-out always relied on.
   */
  const onSignOutPress = useCallback(() => {
    queryClient.clear();
    resetStore();
    onSignedOut();
    void (async () => {
      try {
        await stopPush();
        await signOut();
      } catch {
        // Best-effort: the user is already gone from this device's point of
        // view, and there is no screen left to report a failure to.
      }
    })();
  }, [onSignedOut, queryClient]);


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

  const showAccountSection = canVerifyPhone;
  const presenceLabel =
    PRESENCE_OPTIONS.find(option => option.value === presence)?.label ?? 'Hidden';
  const themeLabel = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System';
  // Members no longer see an account-type label under the avatar (Amit,
  // 2026-09-02): it stated the obvious. Providers keep theirs — the directory
  // side is the meaningful distinction. The balance carries the rest.
  const accountLabel = isProvider ? 'Provider account' : '';
  const profileName = profile?.display_name?.trim() || 'Your account';
  /*
   * `token_balance` is the COLUMN; ₹ is what the member reads. This line
   * interpolated the raw integer and appended the word "tokens", so it was the
   * one balance in the app the currency sweep could not reach by changing a
   * formatter — there was no formatter. It also skipped grouping, rendering
   * 120000 rather than ₹1,20,000.
   */
  const profileMetaText = [accountLabel, profile ? formatRupees(profile.token_balance) : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.root} testID="settings-sheet">
      {/*
       * The tab's own chrome: the SAME bar Home and Favourites render, with
       * "Settings" in the wordmark's slot at regular weight (Amit: "just chnage
       * pappal to fav to settings but weight of fav and setting should be
       * regular not bold like brand"). No type tabs — Settings has no
       * Listener/Astrologer split — and no back arrow, because this is a tab's
       * first screen. `showBack` is the PUSHED case (the provider tree), which
       * keeps the cover's own back button below instead.
       */}
      {showBack ? null : (
        <TabTopBar
          title="Settings"
          searching={searching}
          onSearchOpen={() => setSearching(true)}
          onSearchClose={() => {
            setQuery('');
            setSearching(false);
          }}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder="Search settings"
          testID="settings"
        />
      )}
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[
          styles.scroll,
          // Clear the frosted bottom nav on the member tree (its exact height, so
          // content scrolls under the glass and clears it), or just the safe inset
          // on the provider tree, which has no nav.
          {
            // Three cases: pushed (its own screen, just clear the gesture nav),
            // embedded in a host tab whose bottom nav already owns the inset
            // (plain breathing room), or the member's overlay toolbar (clear its
            // exact height so content scrolls under the glass).
            paddingBottom: embedded
              ? TOKENS.space['3xl']
              : insets.bottom +
                (showBack ? TOKENS.space['3xl'] : NAV_BAR_HEIGHT + TOKENS.space.md),
          },
        ]}>
        {/* WhatsApp's profile-shortcut variant puts a compact app bar over the
            cover. This back action is intentional even on the member tree: the
            user selected that variant after the first profile-first pass.
            https://developer.android.com/develop/ui/compose/components/app-bars */}
        {needle !== '' ? null : (
        <View style={styles.profileHero}>
          {/*
            * On the TAB the cover is shorter by exactly the app bar it no
            * longer holds. Its 168 was sized around a bar sitting INSIDE it
            * (see the style's own note); with `TabTopBar` above the scroll
            * view instead, that 64dp became dead space over the avatar. The
            * subtraction is written out rather than replaced with 104 so the
            * two numbers cannot drift apart.
            */}
          <View
            style={[
              styles.profileCover,
              showBack ? null : { height: 168 - TOP_APP_BAR_HEIGHT },
            ]}>
            <ChatWallpaper />
            {/* The cover's back arrow is the PUSHED case only: on the member
                tree Settings is a tab, and a tab's first screen has nothing to
                go back to (Amit, 2026-09-08). `TabTopBar` above carries that
                case, so this whole bar would be a second, contradictory one. */}
            {/* The status-bar inset belongs to whichever bar is topmost. On the
                tab that is `TabTopBar`, which pads itself, so reserving it here
                too would put the gap back. */}
            <View style={showBack ? { paddingTop: insets.top } : null}>
              {showBack ? (
              <TopAppBar
                title=""
                transparent
                testID="settings-app-bar"
                leading={
                  <Pressable
                    onPress={onBack}
                    testID="settings-back"
                    accessibilityLabel="Back"
                    press="none"
                    highlight="dim"
                    size={48}
                    // `backButton` sets no radius, so the `dim` fill painted a
                    // solid 48dp square behind a 20pt glyph. Icon-only controls
                    // take borderless (circular) ink.
                    // https://developer.android.com/training/material/animations
                    //
                    // Deviation, stated per rule 1.6: the box IS the 48dp touch
                    // target, so the circle is 48dp where M3 draws a 40dp layer
                    // inside a 48dp target. Shrinking it would need a nested view;
                    // a 48dp circle already reads as the button rather than as a
                    // box, which is the defect being fixed.
                    shape="circle"
                    style={styles.backButton}>
                    <Icon name="back" size={TOKENS.icon.md} />
                  </Pressable>
                }
              />
              ) : null}
            </View>
          </View>
          <View style={styles.profileIdentity}>
            {/* Both roles can now change their photo (Amit, 2026-09-02): tap the
                avatar to open the photo sheet rather than launching the picker
                straight away, so "remove" and "choose" are one deliberate step. */}
            <Pressable
              onPress={() => setAvatarSheet(true)}
              testID="settings-avatar"
              accessibilityLabel="Change avatar"
              press="none"
              highlight="dim"
              disabled={setClayAvatar.isPending}
              style={styles.profileAvatarHit}>
              <Avatar
                initial={initialOf(profileName)}
                size={88}
                uri={profile?.avatar_url ?? null}
              />
              <View style={styles.profileCamera}>
                {/* A "+" edit affordance, not a camera: tapping the avatar opens
                    the DiceBear picker, not a photo/camera upload. */}
                <Icon name="plus" size={TOKENS.icon.sm} color={theme.color.text.onAccent} />
              </View>
            </Pressable>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.profileName}>
              {profileName}
            </Text>
            {profileMetaText ? (
              <Text allowFontScaling style={styles.profileMeta}>
                {profileMetaText}
              </Text>
            ) : null}
          </View>
        </View>
        )}
        {/* Provider controls sit between the hero and the list — the same place a
            member has nothing — so a provider's "You" tab is one settings surface,
            not a dashboard with a second settings behind a gear. Chrome for
            browsing, so hidden while searching, like the hero above. */}
        {needle === '' && topSection !== undefined ? topSection : null}
        {/* Root rows stay scannable like WhatsApp Settings. Multi-choice controls
            move into sheets, but retain radio semantics and one selection per row. */}
        {needle === '' ? (
          <Text allowFontScaling style={styles.subheader}>
            Settings
          </Text>
        ) : null}
        <View style={styles.group}>
          {shows('Presence') ? (
          <>
          <Pressable
            onPress={() => setChoiceSheet('presence')}
            testID="settings-presence"
            accessibilityLabel={`Presence, ${presenceLabel}`}
            press="none"
            highlight="dim"
            style={styles.row}>
            <SettingsRowContent
              icon="person"
              title="Presence"
              detail={presenceLabel}
            />
          </Pressable>
          <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </>
          ) : null}
          {onBlocked !== undefined && shows('Blocked people') ? (
            <>
              <Pressable
                onPress={onBlocked}
                testID="settings-blocked"
                accessibilityLabel="Blocked People"
                press="none"
                highlight="dim"
                style={styles.row}>
                <SettingsRowContent
                  icon="block"
                  title="Blocked people"
                  detail="Review people you have blocked"
                />
              </Pressable>
              <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
            </>
          ) : null}
        </View>

        <View style={styles.group}>
          {shows('Theme') ? (
          <>
          <Pressable
            onPress={() => setChoiceSheet('theme')}
            testID="settings-theme"
            accessibilityLabel={`Theme, ${themeLabel}`}
            press="none"
            highlight="dim"
            style={styles.row}>
            <SettingsRowContent icon="settings" title="Theme" detail={themeLabel} />
          </Pressable>
          <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </>
          ) : null}
        </View>

        {showAccountSection ? (
          <View style={styles.group}>
              {canVerifyPhone && shows('Phone verification') ? (
                <Pressable
                  onPress={() => requestAnimationFrame(() => setVerifying(true))}
                  testID="settings-verify-phone"
                  accessibilityLabel="Verify Phone Number"
                  press="none"
                  highlight="dim"
                  style={styles.row}>
                  <SettingsRowContent
                    icon="call"
                    title="Phone verification"
                    detail="Optional account recovery"
                  />
                </Pressable>
              ) : null}
              {/* No provider entry in member settings: member and provider are
                  mutually exclusive worlds (Amit, 2026-09-03). Becoming a provider
                  happens through "Become a partner" at sign-up, not from here. */}
              <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </View>
        ) : null}

        {/* Recharge history: top-ups and GST invoice downloads. Shown only on
            the member tree (provider tree has no onTransactions). */}
        {onTransactions !== undefined && shows('Recharge history') ? (
          <View style={styles.group}>
              <Pressable
                onPress={onTransactions}
                testID="settings-transactions"
                accessibilityLabel="Recharge history"
                press="none"
                highlight="dim"
                style={styles.row}>
                <SettingsRowContent
                  icon="wallet"
                  title="Recharge history"
                  detail="Receipts and GST invoices"
                />
              </Pressable>
              <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </View>
        ) : null}

        {/* Usage by session (goal item 2). On both trees, with the title the
            caller's own side of the row: a member spent, a provider earned. */}
        {onUsage !== undefined &&
        shows(isProvider ? 'Earnings by session' : 'Usage by session') ? (
          <View style={styles.group}>
            <Pressable
              onPress={onUsage}
              testID="settings-usage"
              accessibilityLabel="Usage by session"
              press="none"
              highlight="dim"
              style={styles.row}>
              <SettingsRowContent
                icon="listen"
                title={isProvider ? 'Earnings by session' : 'Usage by session'}
                detail={
                  isProvider
                    ? 'What each conversation paid'
                    : 'What each conversation cost'
                }
              />
            </Pressable>
            <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </View>
        ) : null}

        {/*
          * Terms and Privacy links: android-audit.md launch-blocking gap.
          * Both are `Linking.openURL` — no in-app webview, same reason as
          * the Google sign-in: Linking opens the system browser.
          * URLs are the same as the seeded policy_versions rows (migration 027).
          */}
        <View style={styles.group}>
          {shows('Terms of service') ? (
          <>
          <Pressable
            onPress={() => {
              void Linking.openURL(legalUrl('terms'));
            }}
            testID="settings-terms"
            accessibilityLabel="Terms of Service"
            press="none"
            highlight="dim"
            style={styles.row}>
            <SettingsRowContent icon="report" title="Terms of service" />
          </Pressable>
          <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </>
          ) : null}
          {shows('Privacy policy') ? (
          <Pressable
            onPress={() => {
              void Linking.openURL(legalUrl('privacy'));
            }}
            testID="settings-privacy"
            accessibilityLabel="Privacy Policy"
            press="none"
            highlight="dim"
            style={styles.row}>
            <SettingsRowContent icon="block" title="Privacy policy" />
          </Pressable>
          ) : null}
        </View>

        <View style={styles.groupSpaced}>
          {shows('Sign out') ? (
          <>
          <Divider />
          <Pressable
            onPress={() => {
              void onSignOutPress();
            }}
            disabled={busy}
            testID="sign-out"
            accessibilityLabel="Sign Out"
            press="none"
            highlight="dim"
            style={styles.row}>
            <SettingsRowContent icon="logout" title="Sign out" chevron={false} />
          </Pressable>
          <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
          </>
          ) : null}
          {/* The destructive action in the error colour, its own separated row,
              which is how a destructive action is kept from sitting flush against
              a benign one. */}
          {shows('Delete account') ? (
          <Pressable
            onPress={() => requestAnimationFrame(() => setConfirming(true))}
            testID="delete-account"
            accessibilityLabel="Delete Account"
            press="none"
            highlight="dim"
            style={styles.row}>
            <SettingsRowContent
              icon="report"
              title="Delete account"
              danger
              chevron={false}
            />
          </Pressable>
          ) : null}
        </View>
        {/* Chrome, like the hero above: a search result should be the row and
            nothing else. */}
        {needle === '' ? (
        <View style={styles.footer}>
          <Text allowFontScaling={false} style={styles.brandFooter}>
            Pappal
          </Text>
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
            highlight="dim"
            style={styles.rateFooter}>
            <Icon name="star" size={TOKENS.icon.xs} color={theme.color.text.secondary} />
            <Text allowFontScaling style={styles.rateFooterText}>
              Rate Pappal on the Play Store
            </Text>
          </Pressable>
        </View>
        ) : null}
      </Animated.ScrollView>

      <Sheet
        visible={choiceSheet === 'presence'}
        testID="presence-choice-sheet"
        title="Presence"
        body={`${presenceDetail(presence)}${providerAppearance}`}
        onClose={() => setChoiceSheet(null)}>
        <View style={styles.choiceList}>
          {PRESENCE_OPTIONS.map((option, index) => {
            const on = presence === option.value;
            return (
              <React.Fragment key={option.value}>
                {index === 0 ? null : <Divider variant="inset" insetStart={ROW_TEXT_INSET} />}
                <Pressable
                  onPress={() => {
                    if (!on) setPresence.mutate(option.value);
                    setChoiceSheet(null);
                  }}
                  testID={`presence-${option.value}`}
                  accessibilityRole="radio"
                  checked={on}
                  accessibilityLabel={option.label}
                  press="none"
                  highlight="dim"
                  style={styles.row}>
                  <SettingsRowContent
                    icon="person"
                    title={option.label}
                    selected={on}
                    chevron={false}
                  />
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
      </Sheet>

      <Sheet
        visible={choiceSheet === 'theme'}
        testID="theme-choice-sheet"
        title="Theme"
        /*
         * The copy names the ACTUAL default, so it cannot go stale silently
         * again: it read "Light is the default" until 2026-09-08, which the
         * config flip to dark made false in the one place a member goes to
         * check. Derived from THEME_DEFAULT_MODE rather than written out.
         */
        body={`${
          THEME_DEFAULT_MODE === 'system'
            ? 'Your device setting'
            : THEME_DEFAULT_MODE === 'dark'
              ? 'Dark'
              : 'Light'
        } is the default. System follows your device setting.`}
        onClose={() => setChoiceSheet(null)}>
        <View style={styles.choiceList}>
          {(['light', 'dark', 'system'] as const).map((option, index) => {
            const on = mode === option;
            const label =
              option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System';
            return (
              <React.Fragment key={option}>
                {index === 0 ? null : <Divider variant="inset" insetStart={ROW_TEXT_INSET} />}
                <Pressable
                  onPress={() => {
                    setMode(option);
                    setChoiceSheet(null);
                  }}
                  testID={`theme-${option}`}
                  accessibilityRole="radio"
                  checked={on}
                  accessibilityLabel={label}
                  press="none"
                  highlight="dim"
                  style={styles.row}>
                  <SettingsRowContent
                    icon="settings"
                    title={label}
                    selected={on}
                    chevron={false}
                  />
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
      </Sheet>

      {/* Avatar picker: a horizontal slider of the bundled DiceBear "clay"
          avatars. No gallery, no remove — one deliberate pick from a set that
          ships in the app (Amit, 2026-09-02).

          The provider copy says what migration 070 does. `useSetClayAvatar`
          writes `profiles.avatar_url` directly and succeeds, but the photos are
          authoritative while a gallery is non-empty: the 070 sync trigger
          rewrites avatar_url from the primary photo on the next gallery change,
          and ProviderDetailScreen's hero pages the gallery and never reads
          avatar_url at all. Picking clay art here and finding a photo tomorrow
          is a surface silently overruling the person using it, so the surface
          says so. */}
      <Sheet
        visible={avatarSheet}
        testID="avatar-choice-sheet"
        title="Choose your avatar"
        body={
          isProvider
            ? 'Shown in the directory and in your chats. If you have gallery photos, your main photo is used instead.'
            : 'Shown to people you chat with.'
        }
        onClose={() => setAvatarSheet(false)}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={styles.avatarPicker}>
          {CLAY_SEEDS.map(seed => {
            const selected = seed === currentSeed;
            return (
              <Pressable
                key={seed}
                onPress={() => {
                  setClayAvatar.mutate(seed);
                  setAvatarSheet(false);
                }}
                testID={`avatar-clay-${seed}`}
                accessibilityLabel={`Avatar ${seed}`}
                accessibilityRole="radio"
                checked={selected}
                press="none"
                style={[styles.avatarChoice, selected && styles.avatarChoiceSelected]}>
                <Image
                  source={CLAY_IMAGES[seed]}
                  style={styles.avatarChoiceImage}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>

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
        footer={
          <>
            <Button label="Cancel" onPress={() => setConfirming(false)} />
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
          </>
        }>
        {null}
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
    backButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      paddingHorizontal: TOKENS.space.xl,
    },
    profileHero: {
      marginHorizontal: -TOKENS.space.xl,
      overflow: 'hidden',
      alignItems: 'center',
      backgroundColor: t.color.bg.base,
    },
    profileCover: {
      position: 'relative',
      width: '100%',
      // 168, down from 240 (Amit, 2026-09-02: too much dead space up top). The
      // app bar sits inside this cover, so its height IS the top space before
      // the identity block; the avatar still overlaps its lower edge by 44.
      height: 168,
      overflow: 'hidden',
    },
    profileIdentity: {
      alignItems: 'center',
      marginTop: -44,
      paddingBottom: TOKENS.space.xl,
      paddingHorizontal: TOKENS.space.md,
    },
    profileAvatarHit: {
      position: 'relative',
      width: 88,
      height: 88,
      borderRadius: 44,
    },
    profileCamera: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      // Coral edit badge, not a black disc: it now signals "change your avatar"
      // and reads as a branded affordance rather than a stray black image.
      backgroundColor: t.color.bg.accent,
      borderWidth: 2,
      borderColor: t.color.bg.base,
    },
    // DiceBear clay avatar picker — a horizontal slider of round choices.
    avatarPicker: {
      flexDirection: 'row',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.sm,
    },
    avatarChoice: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderCurve: 'continuous',
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
      backgroundColor: t.color.bg.sunken,
    },
    avatarChoiceSelected: {
      borderColor: t.color.bg.accent,
    },
    avatarChoiceImage: {
      width: '100%',
      height: '100%',
      // Match the settings avatar framing: the clay figure sits low-left in the
      // source art, so nudge it up and right and zoom slightly to fill.
      transform: [{ scale: 1.12 }, { translateX: 2 }, { translateY: -3 }],
    },
    profileName: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      marginTop: TOKENS.space.xs,
    },
    profileMeta: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      marginTop: TOKENS.space['2xs'],
    },
    subheader: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.sm,
      paddingBottom: TOKENS.space.sm,
    },
    // WhatsApp's Settings root is one continuous list on the page surface.
    // Sections are semantic in code but add no card, tile, or divider chrome.
    group: {
      backgroundColor: t.color.bg.base,
    },
    groupSpaced: {
      marginTop: TOKENS.space.xl,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 64,
      paddingVertical: TOKENS.space.sm,
      backgroundColor: t.color.bg.base,
    },
    iconBox: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Destructive rows get a danger-tinted disc behind the icon so the action
    // reads as dangerous at a glance — the muted maroon ink alone did not.
    iconBoxDanger: {
      borderRadius: 16,
      backgroundColor: `${t.color.state.danger}1F`,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: TOKENS.space.sm,
    },
    rowTitle: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowDetail: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      marginTop: TOKENS.space.hair,
    },
    rowTitleDanger: {
      color: t.color.state.danger,
    },
    choiceList: {
      marginTop: TOKENS.space.sm,
    },
    // Bottom-of-settings footer: the wordmark, then the Play Store rate link
    // directly beneath it.
    footer: {
      alignItems: 'center',
      paddingTop: TOKENS.space.lg,
      paddingBottom: TOKENS.space.xl,
      gap: TOKENS.space['2xs'],
    },
    brandFooter: {
      fontFamily: TOKENS.face.wordmark,
      fontSize: 18,
      // The brand colour, not a grey whisper (#9): the wordmark is the brand.
      color: t.color.bg.accent,
      textAlign: 'center',
    },
    rateFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingVertical: TOKENS.space['2xs'],
    },
    rateFooterText: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.secondary,
    },
  });
