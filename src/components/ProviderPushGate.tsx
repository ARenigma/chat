import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { notificationsGranted } from '../lib/push';
import { Pressable } from './Pressable';

/**
 * Whether the provider can be reached at all: notification permission, read on
 * mount and again every time the app returns to the foreground (a provider who
 * went to Settings and came back must not see a stale gate).
 *
 * A provider of its own since the provider split (navigation step 6), because
 * the value is not any one tab's: it used to be state on ProviderHomeScreen,
 * and once Chats, Saved and You are separate screens a per-screen copy would
 * be three AppState listeners reading the same permission.
 */
const PushOkContext = createContext<boolean>(true);

export function ProviderPushGateProvider({ children }: { children: React.ReactNode }) {
  const [pushOk, setPushOk] = useState(true);
  useEffect(() => {
    const refresh = () => {
      void notificationsGranted().then(setPushOk);
    };
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => sub.remove();
  }, []);
  return <PushOkContext.Provider value={pushOk}>{children}</PushOkContext.Provider>;
}

function useProviderPushOk(): boolean {
  return useContext(PushOkContext);
}

/**
 * The full-cover gate: chats and calls cannot reach a provider with
 * notifications off, so nothing else on the surface is worth showing until it
 * is fixed. Drawn by whoever hosts the provider screens, over all of them.
 */
export function ProviderPushGate() {
  const styles = useStyles(makeStyles);
  const pushOk = useProviderPushOk();
  if (pushOk) {
    return null;
  }
  return (
    <View style={styles.pushGate} testID="provider-push-gate">
      {/* Capped like every title role (ADR-0024). The inline copy was not:
          it shared a file with a capped title, which is what the file-level
          font-cap gate could see, so the split surfaced it. */}
      <Text
        maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
        allowFontScaling
        style={styles.emptyTitle}>
        Turn on notifications
      </Text>
      <Text allowFontScaling style={styles.emptyBody}>
        Chats and calls cannot reach you while notifications are off.
      </Text>
      <Pressable
        onPress={() => {
          Linking.openSettings().catch(() => undefined);
        }}
        accessibilityLabel="Open settings"
        press="button"
        style={styles.pushGateButton}>
        <Text allowFontScaling style={styles.pushGateButtonLabel}>
          Open settings
        </Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    pushGate: {
      ...StyleSheet.absoluteFill,
      zIndex: 20,
      elevation: 20,
      backgroundColor: t.color.bg.base,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
      gap: TOKENS.space.md,
    },
    emptyTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
    },
    emptyBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    /*
     * THE HEIGHT IS STATED, and it is not decoration.
     *
     * `Pressable` splits a caller's style: only the box keys reach the touchable
     * root, everything else moves to an inner view that gets `flexGrow: 1`. This
     * pill had padding and a radius and no box key at all, so its root had no
     * size of its own and the growing inner view took the whole of `pushGate` —
     * which is `absoluteFill`, so the whole screen. The same shape as the
     * provider row's avatar ring (`ProviderRow.tsx`, `ring`) and as the chat
     * attach panel's grant chip, both of which shipped before being caught —
     * the panel has since been deleted, the ring has not.
     * `__tests__/contract.test.ts` now fails the build on it.
     *
     * 48, so the button is exactly Android's minimum touch target rather than the
     * 44 the old vertical padding came to — "each interactive UI element [should]
     * have a focusable area of at least 48dp x 48dp".
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     */
    pushGateButton: {
      height: TOKENS.interaction.minTarget,
      marginTop: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accent,
    },
    pushGateButtonLabel: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.onAccent,
    },
  });
