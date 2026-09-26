/**
 * The screen's navigation, with every forward navigation deduped (250ms), so
 * a fast double tap on a row or a button pushes once.
 *
 * FORWARD navigation only. Programmatic removals (`removeSelf`, the targeted
 * pops and replaces in `actions.ts`) never come through here: a call that
 * ends within one round trip of its push must still leave (nav-migration §3).
 *
 * adapted from bluesky-social/social-app src/lib/hooks/useNavigationDeduped.ts
 * (MIT), see THIRD_PARTY_LICENSES.md
 */

import { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';

import { useDedupe } from './useDedupe';
import type { NavigationProp } from '../lib/routes/types';

export type DedupedNavigationProp = Pick<
  NavigationProp,
  'push' | 'navigate' | 'getState' | 'getParent' | 'canGoBack'
>;

export function useNavigationDeduped(): DedupedNavigationProp {
  const navigation = useNavigation<NavigationProp>();
  const dedupe = useDedupe();

  return useMemo<DedupedNavigationProp>(
    () => ({
      push: ((...args: Parameters<typeof navigation.push>) => {
        dedupe(() => navigation.push(...args));
      }) as NavigationProp['push'],
      navigate: ((...args: Parameters<typeof navigation.navigate>) => {
        dedupe(() => navigation.navigate(...args));
      }) as NavigationProp['navigate'],
      getState: () => navigation.getState(),
      getParent: ((...args: Parameters<typeof navigation.getParent>) =>
        navigation.getParent(...args)) as NavigationProp['getParent'],
      canGoBack: () => navigation.canGoBack(),
    }),
    [dedupe, navigation],
  );
}
