import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBackBarrier } from '../lib/backGuard';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  usePayoutAccount,
  useTaxProfile,
  useSavePayoutAccount,
  useSavePan,
  useCashfreeVerification,
  cashfreeVerificationAvailable,
  type PayoutMethod,
} from '../api/provider';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { M3Field } from '../components/TextField';

interface Props {
  onBack: () => void;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Where a provider gets paid: a UPI VPA or a bank account, plus a PAN.
 *
 * PAN is mandatory (migration 049): without it TDS-194O withholding is 5% rather
 * than 0.1%, so a provider cannot be listed until both the payout account and the
 * PAN are verified. Verification runs through Cashfree (Payouts + Verification
 * Suite) in service-role Edge functions — see docs/provider-payouts.md. Until
 * Cashfree Payouts is enabled on the account the details still SAVE and simply
 * sit "pending", which is what the note at the top says.
 *
 * No Aadhaar, no liveness, no document upload (product decision 2026-09-03): the
 * only PII is name/phone/email (already on the profile) + bank + PAN.
 */
export function ProviderBankScreen({ onBack }: Props) {
  /*
   * This screen covers Home, and Home stays mounted underneath it (App.tsx
   * renders pushed screens as overlays so returning never remounts Home's
   * lists). Without this barrier Home's search guard — live whenever its search
   * field is open — still hears the hardware back press from up here, closes a
   * field nobody can see, and reports the press handled, so this screen never
   * pops. See src/lib/backGuard.ts.
   */
  useBackBarrier();

  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const { data: account } = usePayoutAccount();
  const { data: tax } = useTaxProfile();
  const saveAccount = useSavePayoutAccount();
  const savePan = useSavePan();
  const verify = useCashfreeVerification();
  // The native sheet is the preferred path — one consent fills a verified PAN and
  // bank, so nothing below is typed. It is only present in a device build with the
  // Cashfree SDK; in Jest and any build without it, the manual form is all there is.
  const canVerifyWithCashfree = cashfreeVerificationAvailable();

  const [method, setMethod] = useState<PayoutMethod>(account?.method ?? 'upi');
  const [vpa, setVpa] = useState(account?.upi_vpa ?? '');
  const [accountNumber, setAccountNumber] = useState(account?.account_number ?? '');
  const [ifsc, setIfsc] = useState(account?.ifsc ?? '');
  const [holder, setHolder] = useState(account?.account_holder_name ?? '');
  const [pan, setPan] = useState(tax?.pan ?? '');

  const accountValid =
    method === 'upi'
      ? vpa.includes('@') && vpa.length >= 3
      : /^[0-9]{9,18}$/.test(accountNumber) && IFSC_RE.test(ifsc.toUpperCase()) && holder.trim().length > 0;
  const panValid = PAN_RE.test(pan.toUpperCase());
  const canSave = accountValid && panValid && !saveAccount.isPending && !savePan.isPending;

  const onSave = (): void => {
    if (panValid) {
      savePan.mutate(pan.toUpperCase());
    }
    if (accountValid) {
      saveAccount.mutate({
        method,
        upiVpa: method === 'upi' ? vpa.trim() : undefined,
        accountNumber: method === 'bank' ? accountNumber.trim() : undefined,
        ifsc: method === 'bank' ? ifsc.toUpperCase().trim() : undefined,
        accountHolderName: holder.trim() || undefined,
      });
    }
  };

  const accountStatus = useMemo(() => statusChip(account?.verification_status), [account]);
  const panStatus = useMemo(() => statusChip(tax?.status === 'not_provided' ? undefined : tax?.status), [tax]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="bank-back"
          accessibilityLabel="Back"
          press="none"
          highlight="dim"
          size={28}
          // `back` sets no radius, so the `dim` fill painted a solid 28x40
          // rectangle behind the chevron. Oblong box, so the pill resolves to a
          // 28-wide stadium rather than a true circle.
          // https://developer.android.com/training/material/animations
          shape="circle"
          style={styles.back}>
          <Icon name="chevronLeft" size={TOKENS.icon.md} />
        </Pressable>
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
          allowFontScaling
          numberOfLines={1}
          style={styles.headerTitle}>
          Get paid
        </Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        {...SCROLL_PHYSICS}
        style={styles.scroll}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + TOKENS.space.lg }]}
        keyboardShouldPersistTaps="handled">
        {/* Placeholder note: verification is not live until Cashfree Payouts is
            enabled on the account. Details still save. */}
        <View style={styles.note}>
          <Text allowFontScaling style={styles.noteText}>
            Add where you want to be paid. We verify it before your first payout.
            Until payouts go live, your details are saved and shown as pending.
          </Text>
        </View>

        {/* Preferred path: Cashfree 1-Click. One consent verifies PAN + bank, so
            the manual form below is the fallback rather than the main event. */}
        {canVerifyWithCashfree ? (
          <View style={styles.verifyBlock}>
            <Button
              label="Verify with Cashfree"
              onPress={() => verify.mutate()}
              busy={verify.isPending}
              busyLabel="Verifying"
              testID="bank-verify-cashfree"
            />
            <Text allowFontScaling style={styles.verifyHint}>
              Confirm your PAN and bank in one tap. Nothing to type.
            </Text>
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text allowFontScaling style={styles.orText}>
                or enter manually
              </Text>
              <View style={styles.orLine} />
            </View>
          </View>
        ) : null}

        {/* Method toggle */}
        <View style={styles.tabs}>
          {(['upi', 'bank'] as const).map(m => (
            <Pressable
              key={m}
              onPress={() => setMethod(m)}
              testID={`bank-method-${m}`}
              accessibilityRole="tab"
              checked={method === m}
              accessibilityLabel={m === 'upi' ? 'UPI' : 'Bank account'}
              press="none"
              style={[styles.tab, method === m && styles.tabActive]}>
              <Text
                allowFontScaling
                style={[styles.tabLabel, method === m && styles.tabLabelActive]}>
                {m === 'upi' ? 'UPI' : 'Bank account'}
              </Text>
            </Pressable>
          ))}
        </View>

        {method === 'upi' ? (
          <M3Field
            label="UPI ID"
            value={vpa}
            onChangeText={setVpa}
            placeholder="yourname@upi"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="bank-vpa"
          />
        ) : (
          <>
            <M3Field
              label="Account number"
              value={accountNumber}
              onChangeText={t => setAccountNumber(t.replace(/[^0-9]/g, ''))}
              placeholder="Account number"
              inputMode="numeric"
              keyboardType="number-pad"
              testID="bank-account-number"
            />
            <M3Field
              label="IFSC"
              value={ifsc}
              onChangeText={t => setIfsc(t.toUpperCase())}
              placeholder="HDFC0000001"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={11}
              testID="bank-ifsc"
            />
            <M3Field
              label="Account holder name"
              value={holder}
              onChangeText={setHolder}
              placeholder="As printed on the account"
              testID="bank-holder"
            />
          </>
        )}

        {accountStatus !== null ? (
          <View style={styles.statusRow}>
            <Icon name={accountStatus.icon} size={TOKENS.icon.sm} color={accountStatus.color(theme)} />
            <Text allowFontScaling style={[styles.statusText, { color: accountStatus.color(theme) }]}>
              {accountStatus.label}
              {account?.verification_error != null ? `: ${account.verification_error}` : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.divider} />

        <M3Field
          label="PAN"
          value={pan}
          onChangeText={t => setPan(t.toUpperCase())}
          placeholder="ABCPV1234D"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={10}
          testID="bank-pan"
          /* This was a loose `Text` under the field. It is M3's supporting-text
             slot, so it goes in the slot: same 4dp gap and bodySmall, but now
             owned by the field rather than by a sibling that a reorder could
             separate from it. */
          supportingText="Required. With your PAN, tax withheld on your earnings is 0.1% instead of 5%."
        />
        {panStatus !== null ? (
          <View style={styles.statusRow}>
            <Icon name={panStatus.icon} size={TOKENS.icon.sm} color={panStatus.color(theme)} />
            <Text allowFontScaling style={[styles.statusText, { color: panStatus.color(theme) }]}>
              {panStatus.label}
            </Text>
          </View>
        ) : null}

        <View style={styles.spacer} />

        <Button
          label="Save"
          onPress={onSave}
          disabled={!canSave}
          busy={saveAccount.isPending || savePan.isPending}
          busyLabel="Saving"
          testID="bank-save"
        />
        {saveAccount.isError || savePan.isError ? (
          <Text allowFontScaling style={styles.error}>
            Could not save. Please try again.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

type Chip = { label: string; icon: 'check' | 'dot' | 'close'; color: (t: ReturnType<typeof useTheme>) => string };

function statusChip(status: string | undefined): Chip | null {
  switch (status) {
    case 'verified':
      return { label: 'Verified', icon: 'check', color: t => t.color.text.positive };
    case 'pending':
    case 'unverified':
      return { label: 'Pending verification', icon: 'dot', color: t => t.color.text.secondary };
    case 'failed':
      return { label: "Couldn't verify", icon: 'close', color: t => t.color.state.danger };
    default:
      return null;
  }
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    back: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      flex: 1,
      textAlign: 'center',
    },
    scroll: { flex: 1 },
    body: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.lg,
      gap: TOKENS.space.sm,
    },
    note: {
      padding: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
      marginBottom: TOKENS.space.xs,
    },
    noteText: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
    verifyBlock: { gap: TOKENS.space.xs, marginBottom: TOKENS.space.xs },
    verifyHint: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    orRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.xs,
    },
    orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.color.border.hairline },
    orText: { ...TOKENS.typography.labelMedium, color: t.color.text.tertiary },
    tabs: {
      flexDirection: 'row',
      gap: TOKENS.space.xs,
      marginBottom: TOKENS.space.xs,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: TOKENS.space.sm,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.strong,
    },
    tabActive: {
      backgroundColor: t.color.text.primary,
      borderColor: t.color.text.primary,
    },
    tabLabel: { ...TOKENS.typography.labelLargeEmphasized, color: t.color.text.primary },
    tabLabelActive: { color: t.color.text.onInverse },
    /* `field`, `fieldLabel`, `input` and `hint` all lived here and are now
       M3Field's: the local Field wrapper duplicated the label, and `input` was a
       52dp-tall copy of the container that M3 specifies at 56. */
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space['2xs'],
    },
    statusText: { ...TOKENS.typography.bodyMedium },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
      marginVertical: TOKENS.space.sm,
    },
    spacer: { height: TOKENS.space.lg },
    error: { ...TOKENS.typography.bodyMedium, color: t.color.state.danger, textAlign: 'center' },
  });
