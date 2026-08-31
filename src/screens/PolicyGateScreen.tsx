/**
 * Policy acceptance gate.
 *
 * Shown for new users immediately after sign-in, and for existing users when a
 * material policy change requires re-acceptance. Blocks navigation until all
 * pending versions are accepted. Cannot be dismissed without accepting.
 *
 * ADR-0020 — policy acceptance required before any UGC operation.
 * Migration 027: pending_policy_acceptances() / accept_policy() RPCs.
 */

import React, { useCallback } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import { usePendingPolicies, useAcceptAllPendingPolicies } from '../api/policy';

interface Props {
  onAccepted: () => void;
}

export function PolicyGateScreen({ onAccepted }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { data: pending = [] } = usePendingPolicies();
  const acceptAll = useAcceptAllPendingPolicies();

  const handleContinue = useCallback(async () => {
    const ids = pending.map(p => p.id);
    await acceptAll.mutateAsync(ids);
    onAccepted();
  }, [pending, acceptAll, onAccepted]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Text allowFontScaling style={styles.title}>
          Before you continue
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Please review and accept the following to use Pappal.
        </Text>
        {pending.map(policy => (
          <React.Fragment key={policy.id}>
            <View style={styles.policyItem}>
              <Text allowFontScaling style={styles.policyLabel}>
                {policy.kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
              </Text>
              {policy.summary ? (
                <Text allowFontScaling style={styles.policySummary}>
                  {policy.summary}
                </Text>
              ) : null}
              <Pressable
                onPress={() => {
                  Linking.openURL(policy.url).catch(() => undefined);
                }}
                press="none"
                highlight="ios"
                accessibilityRole="link"
                accessibilityLabel={`Read ${policy.kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'}`}
              >
                <Text allowFontScaling style={styles.policyLink}>
                  Read full document
                </Text>
              </Pressable>
            </View>
          </React.Fragment>
        ))}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label="I agree and continue"
          onPress={() => {
            handleContinue().catch(() => undefined);
          }}
          busy={acceptAll.isPending}
          busyLabel="Saving acceptance"
          testID="policy-accept"
        />
        <Text allowFontScaling style={styles.hint}>
          By continuing, you agree to the documents listed above.
        </Text>
      </View>
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
      flex: 1,
    },
    scrollContent: {
      padding: TOKENS.space.lg,
      gap: TOKENS.space.md,
    },
    title: {
      fontSize: 22,
      color: t.color.text.primary,
      fontFamily: 'Geist-Bold',
    },
    subtitle: {
      fontSize: 15,
      color: t.color.text.secondary,
      fontFamily: 'Geist-Regular',
      lineHeight: 22,
    },
    policyItem: {
      gap: 6,
      paddingVertical: TOKENS.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    policyLabel: {
      fontSize: 15,
      color: t.color.text.primary,
      fontFamily: 'Geist-SemiBold',
    },
    policySummary: {
      fontSize: 13,
      color: t.color.text.secondary,
      fontFamily: 'Geist-Regular',
      lineHeight: 19,
    },
    policyLink: {
      fontSize: 13,
      color: t.color.text.accent,
      fontFamily: 'Geist-Regular',
    },
    footer: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.md,
      gap: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    hint: {
      fontSize: 12,
      color: t.color.text.tertiary,
      textAlign: 'center',
      fontFamily: 'Geist-Regular',
    },
  });
