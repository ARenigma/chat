import React, { useCallback, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSoftReset } from '../lib/routes/useSoftReset';
import { useTabPress } from '../lib/routes/useTabPress';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';
import { useSearchBack } from '../hooks/useSearchBack';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { THEME_DEFAULT_MODE } from '../config';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { TabTopBar } from '../components/TabTopBar';
import { Divider } from '../components/Divider';
import { useQueryClient } from '@tanstack/react-query';
import { beginSignOut, deleteAccount } from '../api/auth';
import { stopPush } from '../lib/push';
import { track } from '../lib/telemetry';
import { useSetClayAvatar } from '../api/provider';
import { CLAY_SEEDS, CLAY_IMAGES } from '../lib/clayAvatars';
import { useProfile } from '../api/chat';
import { legalUrl } from '../lib/legal';
import { initialOf } from '../lib/display';
import { formatRupees } from '../lib/rates';
import { visibleSections, type SettingsRowId } from '../lib/settingsSections';
import { Avatar } from '../components/Avatar';
import { resetStore, useStore } from '../store/useStore';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme, useThemeMode } from '../theme/ThemeProvider';

interface Props {
  onDeleted: () => void;
  onSignedOut: () => void;
  /** Absent on the provider tree, a provider does not apply again. */
  onBlocked?: () => void;
  /** Opens the recharge history — the money ledger. Member tree only. */
  onTransactions?: () => void;
  /**
   * Opens the billing documents (`public.invoices`) and their PDFs. Member tree
   * only, for the same reason as `onTransactions`: a provider is paid out, not
   * billed, and has no invoices of their own.
   */
  onInvoices?: () => void;
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
   * Provider-only rows, placed into their sections by SETTINGS_SECTIONS: Edit
   * profile and Your photos under "Your profile", Get paid under "Money". Data
   * rather than JSX so the search filters them like every other row.
   */
  extraRows?: Partial<Record<'edit-profile' | 'photos' | 'get-paid', SettingsRowSpec>>;
  /**
   * What the scroll clears at its foot, chosen by the host rather than by a
   * mode flag. The provider You tab passes it (its own bottom nav already owns
   * the safe-area inset, so plain breathing room); the member tree passes
   * nothing and gets the overlay toolbar's exact height.
   *
   * Replaced `showBack`/`embedded` in navigation step 6. Settings is a tab root
   * on both trees, so the pushed "back arrow over the cover" case had no caller
   * left, and one number is all the two remaining cases differ by.
   */
  bottomOffset?: number;
}

/**
 * Where a row's title starts: the 32 dp icon slot plus the content slot's
 * leading pad. Dividers align to this so a rule never cuts under the icon.
 */
const ROW_TEXT_INSET = 32 + TOKENS.space.sm;

/** One navigable row of the list, as data. */
interface SettingsRowSpec {
  icon: IconName;
  title: string;
  detail?: string;
  /**
   * `attention` sets the detail in the danger ink. Never the only signal: the
   * detail's own words say "Action needed" (WCAG 1.4.1, use of colour).
   */
  detailTone?: 'default' | 'attention';
  /** Drawn before the chevron: the photos row's thumbnail strip. */
  trailing?: React.ReactNode;
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
}

/**
 * The app's own notification settings page, the system screen for exactly
 * this app. `Settings.ACTION_APP_NOTIFICATION_SETTINGS` with
 * `Settings.EXTRA_APP_PACKAGE`, added in API 26; minSdk is 24, and the
 * Settings reference warns a matching Activity may not exist, so the app
 * details page (`Linking.openSettings`) is the fallback for both cases.
 * https://developer.android.com/reference/android/provider/Settings#ACTION_APP_NOTIFICATION_SETTINGS
 * https://reactnative.dev/docs/linking#sendintent-android
 */
function openNotificationSettings(): void {
  Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
    // The applicationId (android/app/build.gradle), the same on every variant:
    // there is deliberately no applicationIdSuffix (see the note there).
    { key: 'android.provider.extra.APP_PACKAGE', value: 'com.companionchat' },
  ]).catch(() => {
    Linking.openSettings().catch(() => undefined);
  });
}

interface SettingsRowContentProps {
  icon: IconName;
  title: string;
  detail?: string;
  detailTone?: 'default' | 'attention';
  trailing?: React.ReactNode;
  selected?: boolean;
  danger?: boolean;
  chevron?: boolean;
}

/**
 * A navigable row: the Pressable is the single target, full-bleed like every
 * row here. No press scale and no enter motion — settings rows are a
 * tens-a-day surface, so the frequency gate (emil-design-eng) leaves them the
 * state layer alone.
 */
function SettingsRow({ spec }: { spec: SettingsRowSpec }) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={spec.onPress}
      testID={spec.testID}
      accessibilityLabel={spec.accessibilityLabel}
      press="none"
      highlight="dim"
      style={styles.row}
    >
      <SettingsRowContent
        icon={spec.icon}
        title={spec.title}
        detail={spec.detail}
        detailTone={spec.detailTone}
        trailing={spec.trailing}
      />
    </Pressable>
  );
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
  detailTone = 'default',
  trailing,
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
          style={[styles.rowTitle, danger && styles.rowTitleDanger]}
        >
          {title}
        </Text>
        {detail ? (
          <Text
            allowFontScaling
            numberOfLines={2}
            style={[
              styles.rowDetail,
              detailTone === 'attention' && styles.rowDetailAttention,
            ]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ?? null}
      {selected ? (
        <Icon
          name="check"
          size={TOKENS.icon.sm}
          color={theme.color.text.primary}
        />
      ) : chevron ? (
        <Icon
          name="chevronRight"
          size={TOKENS.icon.sm}
          color={theme.color.text.tertiary}
        />
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
  onDeleted,
  onSignedOut,
  onBlocked,
  onTransactions,
  onInvoices,
  onUsage,
  topSection,
  extraRows,
  bottomOffset,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
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
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<Animated.ScrollView | null>(null);
  // Re-tap You at its root: back to the top, search results or not, since
  // search filters this list in place (step 9, nav-migration §6).
  useSoftReset(() => scrollRef.current?.scrollTo({ y: 0, animated: !reducedMotion }));
  const [query, setQuery] = useState('');
  const barOffset = useBottomBarOffset(TOKENS.space.md);
  // Hardware back leaves search first, as on Home (`useSearchBack`, nav §4).
  const closeSearch = useCallback(() => {
    // The IME leaves with search, on every exit (as on Home).
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
  }, []);
  useSearchBack(searching, closeSearch);
  // Pressing You leaves search, as pressing Home does (2026-09-27). 'You' is
  // the bar's name for this tab on BOTH trees (BottomBar MEMBER_TABS and
  // PROVIDER_TABS), so one name covers the member and the provider.
  useTabPress('You', closeSearch);
  const needle = query.trim().toLowerCase();
  const shows = (rowTitle: string) =>
    needle === '' || rowTitle.toLowerCase().includes(needle);
  /*
   * A union of one since 2026-09-17, when the Presence row left this sheet.
   * Kept as a union rather than a boolean because the next multi-choice setting
   * joins it here, and because the sheet below already switches on the name.
   */
  const [choiceSheet, setChoiceSheet] = useState<'theme' | null>(null);
  const [avatarSheet, setAvatarSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: profile } = useProfile();
  const setClayAvatar = useSetClayAvatar();
  const isProvider = profile?.role === 'provider';
  // The clay seed currently in use, so the picker can mark it selected.
  const currentSeed =
    profile?.avatar_url?.startsWith('clay:') === true
      ? profile.avatar_url.slice('clay:'.length)
      : null;

  const onDelete = useCallback(async () => {
    setBusy(true);
    try {
      await deleteAccount();
      /*
       * Only once the account is gone. The token row cascades with the user,
       * but the *device* keeps the FCM token, and a token that outlives its row
       * would be re-registered by the next sign-in on this phone, so stopPush
       * still has to run; it used to run FIRST, and a deletion that then failed
       * (offline, an RPC error) left an account that still exists on a device
       * with no token and no listeners, silent until the next cold start.
       *
       * After, rather than first with a startPush in the catch to undo it:
       * restarting push can raise the POST_NOTIFICATIONS dialog bare over this
       * sheet (the ambush ADR-0026 exists to prevent), mints a new FCM token,
       * and has to reach the network that the deletion just failed to reach.
       * Nothing needs undoing if nothing was stopped. The cost is a moment in
       * which the listeners outlive the account, and anything they send lands
       * on a user that no longer exists: push_tokens.user_id references
       * auth.users on delete cascade (migration 008), so a late
       * register_push_token fails its foreign key rather than recreating a row.
       * stopPush never throws, so it cannot turn a completed deletion into the
       * error notice below. Its row delete now runs without a session and
       * finds nothing to remove, which is the cascade having done it already.
       */
      // Bounded: the account is already gone, so a stalled Play Services call
      // in the teardown must not hold the busy sheet forever. The teardown
      // carries on in the background either way.
      await Promise.race([
        stopPush(),
        new Promise<void>(resolve => setTimeout(resolve, 5_000)),
      ]);
      track('account_deleted');
      queryClient.clear();
      resetStore();
      // No fresh session to start any more: deletion signs you out, and the
      // phone screen is where you land.
      onDeleted();
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : 'Could not delete account',
      );
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
   * cache and the store is what "signed out" actually means on this device, and
   * all three are synchronous: the cache and the store here, the stored
   * session inside `beginSignOut`, before its first await. This comment used
   * to say so while the session was in fact removed last, by auth-js after
   * `/logout` returned, so a sign-out followed by a swipe-away launched back
   * into the account. The remote teardown runs after, unawaited, as the
   * leaving account on a client of its own (the push row delete, then
   * `/logout`), so the next sign-in neither waits for it nor is ended by it.
   *
   * If the process dies mid-teardown, the session is already gone from the
   * device, and the next launch finishes the remote half
   * (`resumePendingSignOuts`), so the push row stops ringing this phone.
   */
  const onSignOutPress = useCallback(() => {
    queryClient.clear();
    resetStore();
    onSignedOut();
    // Recorded in auth.ts the moment it starts, so a sign-in on the screen
    // this just showed waits for it rather than being ended by it.
    beginSignOut().catch(() => {
      // Best-effort: the user is already gone from this device's point of
      // view, and there is no screen left to report a failure to.
    });
  }, [onSignedOut, queryClient]);

  const themeLabel =
    mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System';
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
  const profileMetaText = [
    accountLabel,
    profile ? formatRupees(profile.token_balance) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  /*
   * Every row this tree offers, by id; SETTINGS_SECTIONS decides where each
   * one sits. A row whose handler the host did not pass is absent, which is
   * how the member tree has no Get paid and the provider tree no Recharge
   * history, from one list.
   */
  const rowSpecs: Partial<Record<SettingsRowId, SettingsRowSpec>> = {
    ...extraRows,
    usage:
      onUsage === undefined
        ? undefined
        : {
            icon: 'listen',
            title: isProvider ? 'Earnings by session' : 'Usage by session',
            detail: isProvider
              ? 'What each conversation paid'
              : 'What each conversation cost',
            onPress: onUsage,
            testID: 'settings-usage',
            accessibilityLabel: 'Usage by session',
          },
    // The money ledger. Its detail line does not claim invoices: those are
    // the next row, and two rows promising one thing is how a member ends up
    // on the one that does not have it.
    transactions:
      onTransactions === undefined
        ? undefined
        : {
            icon: 'wallet',
            title: 'Recharge history',
            detail: 'Your top-ups, and what each one cost',
            onPress: onTransactions,
            testID: 'settings-transactions',
            accessibilityLabel: 'Recharge history',
          },
    // `public.invoices` and the stored PDF of each (migration 019). Member
    // tree only: a provider is paid out, not billed.
    invoices:
      onInvoices === undefined
        ? undefined
        : {
            // receipt glyph matches the document theme of the screen it opens.
            // Amit 2026-09-29: receipt replaces download (design/icons.json).
            icon: 'receipt',
            title: 'Bills & invoices',
            detail: 'Open or save the bill for any top-up',
            onPress: onInvoices,
            testID: 'settings-invoices',
            accessibilityLabel: 'Bills and invoices',
          },
    notifications: {
      icon: 'bell',
      title: 'Notifications',
      detail: 'Sounds and alerts, in your phone settings',
      onPress: openNotificationSettings,
      testID: 'settings-notifications',
      accessibilityLabel: 'Notifications, opens your phone settings',
    },
    theme: {
      icon: 'settings',
      title: 'Theme',
      detail: themeLabel,
      onPress: () => setChoiceSheet('theme'),
      testID: 'settings-theme',
      accessibilityLabel: `Theme, ${themeLabel}`,
    },
    blocked:
      onBlocked === undefined
        ? undefined
        : {
            icon: 'block',
            title: 'Blocked people',
            detail: 'Review people you have blocked',
            onPress: onBlocked,
            testID: 'settings-blocked',
            accessibilityLabel: 'Blocked People',
          },
    /*
     * Terms, Privacy and Refund: android-audit.md launch-blocking gap. All
     * three are `Linking.openURL` to the system browser, no in-app webview,
     * at the URLs the seeded policy_versions rows use (migration 027). Refund
     * is here because the purchase surfaces state "no refunds" and a member
     * could not read the policy in-app.
     */
    terms: {
      icon: 'report',
      title: 'Terms of service',
      onPress: () => {
        void Linking.openURL(legalUrl('terms'));
      },
      testID: 'settings-terms',
      accessibilityLabel: 'Terms of Service',
    },
    privacy: {
      icon: 'block',
      title: 'Privacy policy',
      onPress: () => {
        void Linking.openURL(legalUrl('privacy'));
      },
      testID: 'settings-privacy',
      accessibilityLabel: 'Privacy Policy',
    },
    refund: {
      icon: 'wallet',
      title: 'Refund policy',
      onPress: () => {
        void Linking.openURL(legalUrl('refund'));
      },
      testID: 'settings-refund',
      accessibilityLabel: 'Refund Policy',
    },
  };
  const sections = visibleSections(id => {
    const spec = rowSpecs[id];
    return spec !== undefined && shows(spec.title);
  });

  return (
    <View style={styles.root} testID="settings-sheet">
      {/*
       * The tab's own chrome: the SAME bar Home and Favourites render, with
       * "Settings" in the wordmark's slot at regular weight (Amit: "just chnage
       * pappal to fav to settings but weight of fav and setting should be
       * regular not bold like brand"). No type tabs — Settings has no
       * Listener/Astrologer split — and no back arrow, because this is a tab's
       * first screen on both trees.
       */}
    <TabTopBar
        title="Settings"
        searching={searching}
        onSearchOpen={() => setSearching(true)}
        onSearchClose={closeSearch}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search settings"
        testID="settings"
      />
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[
          styles.scroll,
          // The host's offset when it gives one, else the bottom bar's own
          // offset (`useBottomBarOffset`), so the last row clears the bar.
          {
            paddingBottom: bottomOffset ?? barOffset,
          },
        ]}
      >
        {needle !== '' ? null : (
          <View style={styles.profileHero}>
            {/* No cover image any more (Amit, on device: the WhatsApp half-doodle
              cover was dated). A calm centred-avatar header instead — the pattern
              the reference app / iOS Settings / Notion use: the identity sits on the page
              itself, not on a wallpaper band. */}
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
                style={styles.profileAvatarHit}
              >
                <Avatar
                  initial={initialOf(profileName)}
                  size={88}
                  uri={profile?.avatar_url ?? null}
                />
                <View style={styles.profileCamera}>
                  {/* A "+" edit affordance, not a camera: tapping the avatar opens
                    the DiceBear picker, not a photo/camera upload. */}
                  <Icon
                    name="plus"
                    size={TOKENS.icon.sm}
                    color={theme.color.text.onAccent}
                  />
                </View>
              </Pressable>
              <Text
                maxFontSizeMultiplier={
                  TOKENS.fontScaleCap.titleMediumEmphasized
                }
                allowFontScaling
                numberOfLines={1}
                style={styles.profileName}
              >
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
        {/* The list, in sections (owner, 2026-09-25, "Option A approved"): Your
            profile, Money, App, Legal, in that order, from SETTINGS_SECTIONS so
            the order is data a test can read. Bluesky's SettingsList shape: a
            label per section, 48dp rows with no rule between them, and one
            hairline between sections. A section whose rows this tree does not
            offer, or a search does not match, is not drawn at all.

            THE PRESENCE ROW WAS HERE until 2026-09-17. A provider's
            availability switch (their own "You" tab, above) is the only control
            over being reachable now; src/lib/presence.ts carries the argument. */}
        {sections.map((section, index) => (
          <View
            key={section.id}
            style={styles.section}
            testID={`settings-section-${section.id}`}
          >
            {index === 0 ? null : <Divider />}
            {needle === '' ? (
              <Text
                allowFontScaling
                accessibilityRole="header"
                style={styles.subheader}
              >
                {section.title}
              </Text>
            ) : null}
            {section.rows.map(id => {
              const spec = rowSpecs[id];
              return spec === undefined ? null : (
                <SettingsRow key={id} spec={spec} />
              );
            })}
          </View>
        ))}

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
                style={styles.row}
              >
                <SettingsRowContent
                  icon="logout"
                  title="Sign out"
                  chevron={false}
                />
              </Pressable>
            </>
          ) : null}
          {/* The destructive action in the error colour, its own row, which is
              how a destructive action is kept from sitting flush against a
              benign one. */}
          {shows('Delete account') ? (
            <Pressable
              onPress={() => requestAnimationFrame(() => setConfirming(true))}
              testID="delete-account"
              accessibilityLabel="Delete Account"
              press="none"
              highlight="dim"
              style={styles.row}
            >
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
                void Linking.openURL(
                  'market://details?id=com.companionchat',
                ).catch(() =>
                  Linking.openURL(
                    'https://play.google.com/store/apps/details?id=com.companionchat',
                  ),
                );
              }}
              testID="settings-rate"
              accessibilityLabel="Rate us on the Play Store"
              press="none"
              highlight="dim"
              style={styles.rateFooter}
            >
              <Icon
                name="star"
                size={TOKENS.icon.xs}
                color={theme.color.text.secondary}
              />
              <Text allowFontScaling style={styles.rateFooterText}>
                Rate Pappal on the Play Store
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.ScrollView>

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
        onClose={() => setChoiceSheet(null)}
      >
        <View style={styles.choiceList}>
          {(['light', 'dark', 'system'] as const).map((option, index) => {
            const on = mode === option;
            const label =
              option === 'light'
                ? 'Light'
                : option === 'dark'
                ? 'Dark'
                : 'System';
            return (
              <React.Fragment key={option}>
                {index === 0 ? null : (
                  <Divider variant="inset" insetStart={ROW_TEXT_INSET} />
                )}
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
                  style={styles.row}
                >
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
        onClose={() => setAvatarSheet(false)}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={styles.avatarPicker}
        >
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
                style={[
                  styles.avatarChoice,
                  selected && styles.avatarChoiceSelected,
                ]}
              >
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
        }
      >
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
    scroll: {
      paddingHorizontal: TOKENS.space.xl,
    },
    // No cover band any more, so no full-bleed negative margin and nothing to
    // clip: the hero is plain page content that centres the identity.
    profileHero: {
      alignItems: 'center',
      backgroundColor: t.color.bg.base,
    },
    // Centred avatar + name + balance on the page itself. `paddingTop` gives the
    // avatar air below the top app bar / TabTopBar instead of the old -44 overlap
    // onto a cover.
    profileIdentity: {
      alignItems: 'center',
      paddingTop: TOKENS.space.xl,
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
    // List section label: Bluesky text_sm font_semi_bold (ADR-0033).
    subheader: {
      ...TOKENS.typography.textSmSemiBold,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.xs,
    },
    // One section of the list: its label, its rows, and a hairline above
    // every section but the first (Bluesky SettingsList.Divider, `my_sm`).
    // No card or tile chrome: the page surface is the list.
    section: {
      backgroundColor: t.color.bg.base,
      paddingTop: TOKENS.space.xs,
    },
    groupSpaced: {
      marginTop: TOKENS.space.xl,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      /*
       * 48dp, Bluesky's SettingsList.Item `minHeight: 48`, and the floor
       * Android sets for any touch target: "at least 48dp x 48dp"
       * (developer.android.com/guide/topics/ui/accessibility/apps). STATED
       * DEVIATION from M3's list spec (56dp one-line, 72dp two-line): the
       * owner chose Bluesky's proportions (2026-09-25), and a two-line row
       * still grows past 48 on its own content.
       */
      minHeight: TOKENS.interaction.minTarget,
      paddingVertical: TOKENS.space.sm,
      backgroundColor: t.color.bg.base,
      // FULL-BLEED press highlight (Amit, on the S22: the tap read as an inset
      // box, not a full row). The scroll pads content by `xl`; the row cancels
      // that on its own box (negative margin) and re-adds it as padding, so the
      // touchable — and the `dim` state layer painted on it — spans screen edge
      // to edge while the icon/text stay inset. `borderRadius: 0` squares the
      // layer so it is a full row strip, not Pressable's default pill.
      marginHorizontal: -TOKENS.space.xl,
      paddingHorizontal: TOKENS.space.xl,
      borderRadius: 0,
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
    // Bluesky's roles (ADR-0033): text_md titles, text_sm detail,
    // text_sm semibold section labels.
    rowTitle: {
      ...TOKENS.typography.textMd,
      color: t.color.text.primary,
    },
    rowDetail: {
      ...TOKENS.typography.textSm,
      color: t.color.text.secondary,
      marginTop: TOKENS.space.hair,
    },
    rowDetailAttention: {
      color: t.color.state.danger,
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
      paddingHorizontal: TOKENS.space['2xs'],
      // Clip state layer to a rounded shape (star icon + text link).
      borderRadius: TOKENS.radius.xs,
    },
    rateFooterText: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.secondary,
    },
  });
