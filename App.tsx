import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TOKENS } from './src/theme/tokens';
import { assertEnv } from './src/lib/env';
import { initSentry } from './src/lib/sentry';
import { isUuid } from './src/lib/ids';
import { track } from './src/lib/telemetry';
import { ensureSession, handleAuthDeepLink } from './src/api/auth';
import { useStore } from './src/store/useStore';
import { RefillSheet } from './src/screens/RefillSheet';
import { Button } from './src/components/Button';
import { ChatScreen } from './src/screens/ChatScreen';
import { InboxScreen } from './src/screens/InboxScreen';
import { ProvidersScreen } from './src/screens/ProvidersScreen';
import { SettingsSheet } from './src/screens/SettingsSheet';

initSentry();

const LAST_PROVIDER_KEY = 'companion.lastProvider';

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
 * Three destinations now, not two. The inbox is home; the directory is the
 * "start a new conversation" path reached from it, rather than the entry point.
 */
type Route =
  | { name: 'inbox' }
  | { name: 'directory' }
  | { name: 'chat'; providerId: string };

/**
 * Navigation is a single piece of state, deliberately.
 *
 * Three destinations still do not justify a navigation library: no deep-link
 * routing beyond the auth callback, no history stack worth persisting, no shared
 * element transitions. React Navigation would add ~15 transitive packages and a
 * native screens dependency to express a three-case union.
 *
 * This is the seam the provider role switch (ADR-0002) will attach to: the
 * server-supplied role selects the navigation root, so a member's tree cannot
 * reach a provider screen even with a client bug.
 */
function Root() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [route, setRoute] = useState<Route>({ name: 'inbox' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setNotice = useStore(s => s.setNotice);
  const resetConversation = useStore(s => s.resetConversation);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        assertEnv();
        await ensureSession();
        const stored = await AsyncStorage.getItem(LAST_PROVIDER_KEY);
        if (cancelled) {
          return;
        }
        // A stale or malformed id lands on the inbox rather than throwing.
        if (isUuid(stored)) {
          setRoute({ name: 'chat', providerId: stored });
        }
        setBoot({ phase: 'ready' });
        track('app_open');
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

  const openChat = useCallback((id: string) => {
    setRoute({ name: 'chat', providerId: id });
    track('conversation_opened');
    void AsyncStorage.setItem(LAST_PROVIDER_KEY, id);
  }, []);

  // Leaving a thread returns to the inbox, not the directory: the list of people
  // you are already talking to is the more useful place to land.
  const leaveChat = useCallback(() => {
    setRoute({ name: 'inbox' });
    resetConversation();
    void AsyncStorage.removeItem(LAST_PROVIDER_KEY);
  }, [resetConversation]);

  const browse = useCallback(() => {
    setRoute({ name: 'directory' });
    track('directory_viewed');
  }, []);

  const backToInbox = useCallback(() => setRoute({ name: 'inbox' }), []);

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
      {route.name === 'chat' ? (
        <ChatScreen providerId={route.providerId} onBack={leaveChat} />
      ) : route.name === 'directory' ? (
        <ProvidersScreen
          onSelect={openChat}
          onBack={backToInbox}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <InboxScreen
          onOpenConversation={openChat}
          onBrowse={browse}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      <RefillSheet />
      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onDeleted={() => {
          setSettingsOpen(false);
          backToInbox();
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
