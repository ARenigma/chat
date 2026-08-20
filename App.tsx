import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS } from './src/theme/tokens';
import { assertEnv } from './src/lib/env';
import { initSentry } from './src/lib/sentry';
import { isPersonaId, type PersonaId } from './src/lib/personas';
import { ensureSession, handleAuthDeepLink } from './src/api/auth';
import { useStore } from './src/store/useStore';
import { RefillSheet } from './src/screens/RefillSheet';
import { Button } from './src/components/Button';
import { ChatScreen } from './src/screens/ChatScreen';
import { CompanionsScreen } from './src/screens/CompanionsScreen';
import { SettingsSheet } from './src/screens/SettingsSheet';

initSentry();

const LAST_PERSONA_KEY = 'companion.lastPersona';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

type Boot = { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; message: string };

/**
 * Navigation is a single piece of state, deliberately.
 *
 * Two destinations do not justify a navigation library: no deep-link routing
 * beyond the auth callback, no history stack worth persisting, no shared element
 * transitions. React Navigation would add ~15 transitive packages and a native
 * screens dependency to express `persona ?? selector`.
 */
function Root() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setNotice = useStore(s => s.setNotice);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        assertEnv();
        await ensureSession();
        const stored = await AsyncStorage.getItem(LAST_PERSONA_KEY);
        if (cancelled) {
          return;
        }
        if (isPersonaId(stored)) {
          setPersona(stored);
        }
        setBoot({ phase: 'ready' });
      } catch (err) {
        if (!cancelled) {
          setBoot({
            phase: 'error',
            message: err instanceof Error ? err.message : 'Could not start',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The only deep link the app handles: the optional OAuth account link.
  useEffect(() => {
    const consume = (url: string | null): void => {
      if (url === null) {
        return;
      }
      handleAuthDeepLink(url)
        .then(handled => {
          if (handled) {
            setNotice('Account linked.');
          }
        })
        .catch(() => setNotice('Could not finish linking.'));
    };

    void Linking.getInitialURL().then(consume);
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));
    return () => sub.remove();
  }, [setNotice]);

  const selectPersona = useCallback((id: PersonaId) => {
    setPersona(id);
    void AsyncStorage.setItem(LAST_PERSONA_KEY, id);
  }, []);

  const clearPersona = useCallback(() => {
    setPersona(null);
    void AsyncStorage.removeItem(LAST_PERSONA_KEY);
  }, []);

  if (boot.phase === 'loading') {
    return <View style={styles.blank} />;
  }

  if (boot.phase === 'error') {
    return (
      <View style={styles.fatal}>
        <Text style={styles.fatalTitle} allowFontScaling>
          Could not start
        </Text>
        <Text style={styles.fatalBody} allowFontScaling>
          {boot.message}
        </Text>
        <View style={styles.retryWrap}>
          <Button
            label="Try again"
            onPress={() => {
              setBoot({ phase: 'loading' });
              setAttempt(n => n + 1);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.host}>
      {persona === null ? (
        <CompanionsScreen onSelect={selectPersona} onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        <ChatScreen personaId={persona} onBack={clearPersona} />
      )}
      <RefillSheet />
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDeleted={() => {
          setSettingsOpen(false);
          clearPersona();
        }}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        {/* Light-first palette, so dark status bar content. No backgroundColor:
            unsupported once edge-to-edge is on (Android 15+). */}
        <StatusBar barStyle="dark-content" translucent />
        <Root />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  blank: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  fatal: {
    flex: 1,
    gap: TOKENS.space.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: TOKENS.space.lg,
    backgroundColor: TOKENS.color.bg.base,
  },
  fatalTitle: {
    ...TOKENS.typography.displayLarge,
    color: TOKENS.color.text.primary,
  },
  fatalBody: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
    textAlign: 'center',
  },
  retryWrap: {
    alignSelf: 'stretch',
    paddingHorizontal: TOKENS.space['2xl'],
  },
});
