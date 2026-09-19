/**
 * The permissions Pappal explains before Home. Microphone and camera remain
 * required for the current call product; notifications are an explicit opt-in.
 *
 * Modelled on PolicyGateScreen: a full-screen gate in the boot machine, so no
 * route can reach Home around it. The list, the ask order and the "does this
 * apply here" arithmetic live in lib/permissionsGate.ts; this file is the words
 * and the three states a row can be in.
 *
 * Follows the Android runtime-permission workflow where it can, and says where
 * it does not (permissionsGate.ts carries the full reasoning):
 *   - this IS the educational UI, so the system dialogs carry no second
 *     rationale;
 *   - one dialog at a time;
 *   - a permanent denial is not a dead end: the row offers Settings, and the
 *     screen re-checks when the app returns to the foreground so a grant made
 *     there is picked up without a tap;
 *   - notification denial never blocks Home. Android recommends a dismissible,
 *     contextual opt-in for non-exempt notifications.
 * https://developer.android.com/training/permissions/requesting
 * https://developer.android.com/design/ui/mobile/guides/home-screen/notifications
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import {
  GATE_PERMISSIONS,
  appliesOnThisDevice,
  checkGate,
  gateSatisfied,
  requestGate,
  type GateStatuses,
} from '../lib/permissionsGate';

interface Props {
  onGranted: () => void;
  onSignOut: () => void;
}

export function PermissionsScreen({ onGranted, onSignOut }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [statuses, setStatuses] = useState<GateStatuses | null>(null);
  const [asking, setAsking] = useState(false);
  // "Not allowed" is only said after they have actually answered a dialog; a
  // fresh check reads every unasked permission as denied and that is not news.
  const [askedOnce, setAskedOnce] = useState(false);

  // A `blocked` learnt from a request outlives a re-check that still says "not
  // granted": check() cannot tell the two apart, and Settings is the only way
  // out of a block, so the row must keep saying so.
  const refresh = useCallback(async (): Promise<GateStatuses> => {
    const fresh = await checkGate();
    setStatuses(prev => {
      if (prev === null) {
        return fresh;
      }
      const merged: GateStatuses = { ...fresh };
      for (const p of GATE_PERMISSIONS) {
        if (fresh[p.kind] !== 'granted' && prev[p.kind] === 'blocked') {
          merged[p.kind] = 'blocked';
        }
      }
      return merged;
    });
    return fresh;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Back from Settings: re-check, and go straight through if everything is now
  // allowed. The system dialogs also background the app briefly, which is
  // harmless here — nothing is granted until they answer.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        void refresh().then(fresh => {
          if (gateSatisfied(fresh)) {
            onGranted();
          }
        });
      }
    });
    return () => sub.remove();
  }, [refresh, onGranted]);

  const rows = GATE_PERMISSIONS.filter(p => appliesOnThisDevice(p));
  const anyBlocked = rows.some(
    p => p.required && statuses?.[p.kind] === 'blocked',
  );
  const anyDenied = rows.some(
    p => p.required && statuses?.[p.kind] === 'denied',
  );

  const allow = useCallback(async () => {
    if (statuses === null || asking) {
      return;
    }
    setAsking(true);
    try {
      // Everything outstanding, one dialog at a time; a blocked one returns at
      // once without a dialog, so asking again costs nothing and never nags.
      const next = await requestGate(statuses, (kind, status) =>
        setStatuses(prev => (prev === null ? prev : { ...prev, [kind]: status })),
      );
      setAskedOnce(true);
      setStatuses(next);
      if (gateSatisfied(next)) {
        onGranted();
        return;
      }
      if (rows.some(p => p.required && next[p.kind] === 'blocked')) {
        Linking.openSettings().catch(() => undefined);
      }
    } finally {
      setAsking(false);
    }
  }, [statuses, asking, rows, onGranted]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="permissions-gate">
      <ScrollView
        {...SCROLL_PHYSICS}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling style={styles.title}>
          Permissions for calls and replies
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Microphone and camera enable calls. Notifications are optional and help
          replies reach you when Pappal is closed.
        </Text>
        {rows.map(p => {
          const status = statuses?.[p.kind];
          return (
            <View key={p.kind} style={styles.row} testID={`permissions-row-${p.kind}`}>
              {/* Neutral disc: the glyph names the permission, it is not an
                  action or a state, and the accent budget (theme.test) is for
                  those two only. */}
              <View style={styles.disc}>
                <Icon name={p.icon} size={TOKENS.icon.md} color={theme.color.text.secondary} />
              </View>
              <View style={styles.rowText}>
                <Text allowFontScaling style={styles.rowTitle}>
                  {p.title}
                </Text>
                <Text allowFontScaling style={styles.optionalLabel}>
                  {p.required ? null : 'Optional'}
                </Text>
                <Text allowFontScaling style={styles.rowReason}>
                  {p.reason}
                </Text>
                {status === 'blocked' ? (
                  <Pressable
                    onPress={() => {
                      Linking.openSettings().catch(() => undefined);
                    }}
                    press="none"
                    highlight="dim"
                    accessibilityRole="link"
                    accessibilityLabel={`Open Settings to allow ${p.title}`}
                    testID={`permissions-open-settings-${p.kind}`}>
                    <Text allowFontScaling style={styles.rowLink}>
                      Android has blocked this. Open Settings to allow it.
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text
                allowFontScaling
                style={[styles.rowStatus, status === 'granted' && styles.rowStatusOn]}
                testID={`permissions-status-${p.kind}`}>
                {status === 'granted'
                  ? 'Allowed'
                  : status === 'blocked'
                    ? 'Blocked'
                    : status === 'denied' && askedOnce
                      ? 'Not allowed'
                      : ''}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + TOKENS.space.md }]}>
        <Button
          label={anyBlocked ? 'Open Settings' : anyDenied && askedOnce ? 'Try again' : 'Allow and continue'}
          onPress={() => {
            allow().catch(() => undefined);
          }}
          busy={asking}
          busyLabel="Asking Android"
          testID="permissions-allow"
        />
        <Text allowFontScaling style={styles.hint}>
          You can change any of these later in Android Settings.
        </Text>
        <Pressable
          onPress={onSignOut}
          press="button"
          accessibilityRole="button"
          accessibilityLabel="Sign out instead"
          testID="permissions-sign-out"
          style={styles.signOut}>
          <Text allowFontScaling style={styles.signOutLabel}>
            Sign out instead
          </Text>
        </Pressable>
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
      ...TOKENS.typography.titleLargeEmphasized,
      color: t.color.text.primary,
    },
    subtitle: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    disc: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.sunken,
    },
    rowText: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    rowTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    optionalLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.tertiary,
    },
    rowReason: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    rowLink: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.accent,
    },
    rowStatus: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.tertiary,
      minWidth: 64,
      textAlign: 'right',
      paddingTop: TOKENS.space.xs,
    },
    rowStatusOn: {
      color: t.color.text.positive,
    },
    footer: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.md,
      gap: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    hint: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      textAlign: 'center',
    },
    signOut: {
      alignSelf: 'center',
      paddingVertical: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
    },
    signOutLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.secondary,
    },
  });
