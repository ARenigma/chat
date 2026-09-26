/**
 * Tests for src/lib/routes/helpers.ts
 *
 * Covers: getCurrentRoute with a missing index (stale state), isTab, and
 * getTabState for every root in both member and provider trees.
 *
 * nav-migration §9 step 2.
 */

import {
  getCurrentRoute,
  getTabState,
  isTab,
  TabState,
} from '../src/lib/routes/helpers';
import type { State } from '../src/lib/routes/types';

// ---------------------------------------------------------------------------
// getCurrentRoute
// ---------------------------------------------------------------------------

describe('getCurrentRoute', () => {
  it('returns Home when state is undefined', () => {
    expect(getCurrentRoute(undefined)).toEqual({
      name: 'Home',
      params: undefined,
    });
  });

  it('descends into nested state to find the leaf', () => {
    const state: State = {
      index: 0,
      routes: [
        {
          key: 'HomeTab-abc',
          name: 'HomeTab',
          state: {
            index: 1,
            routes: [
              { key: 'Home-1', name: 'Home' },
              { key: 'ProviderDetail-2', name: 'ProviderDetail' },
            ],
          },
        },
      ],
    };
    expect(getCurrentRoute(state).name).toBe('ProviderDetail');
  });

  it('handles a stale nested state with no index by focusing the last route', () => {
    // React Navigation leaves inner `index` undefined in a stale (partial)
    // state delivered from a deep link before the navigator has hydrated it.
    // getCurrentRoute mirrors the library behaviour: focus the last route.
    const state: State = {
      index: 0,
      routes: [
        {
          key: 'HomeTab-abc',
          name: 'HomeTab',
          state: {
            // `index` is absent — this is the stale case.
            routes: [
              { key: 'Home-1', name: 'Home' },
              { key: 'Chat-2', name: 'Chat' },
            ],
          },
        },
      ],
    };
    expect(getCurrentRoute(state).name).toBe('Chat');
  });

  it('handles a stale outer state with no index by starting from routes[0]', () => {
    // The outer state also uses `|| 0` (not `??`) so an undefined index
    // picks routes[0], not the last route.
    const state: State = {
      // index absent
      routes: [
        { key: 'HomeTab-1', name: 'HomeTab' },
        { key: 'YouTab-2', name: 'YouTab' },
      ],
    };
    expect(getCurrentRoute(state).name).toBe('HomeTab');
  });
});

// ---------------------------------------------------------------------------
// isTab
// ---------------------------------------------------------------------------

describe('isTab', () => {
  it('matches the bare name', () => {
    expect(isTab('Home', 'Home')).toBe(true);
  });
  it('matches the Tab suffix', () => {
    expect(isTab('HomeTab', 'Home')).toBe(true);
  });
  it('matches the Inner suffix', () => {
    expect(isTab('HomeInner', 'Home')).toBe(true);
  });
  it('does not match a different route', () => {
    expect(isTab('Favourites', 'Home')).toBe(false);
  });
  it('does not match a partial prefix', () => {
    expect(isTab('HomeSuggestion', 'Home')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTabState — member roots
// ---------------------------------------------------------------------------

function makeStateAtRoot(tabName: string): State {
  return {
    index: 0,
    routes: [
      {
        key: `${tabName}-key`,
        name: `${tabName}Tab`,
        state: {
          index: 0,
          routes: [{ key: `${tabName}-root`, name: tabName }],
        },
      },
    ],
  };
}

function makeStateInsideTab(tabName: string): State {
  return {
    index: 0,
    routes: [
      {
        key: `${tabName}-key`,
        name: `${tabName}Tab`,
        state: {
          index: 1,
          routes: [
            { key: `${tabName}-root`, name: tabName },
            { key: 'Chat-pushed', name: 'Chat' },
          ],
        },
      },
    ],
  };
}

function makeStateOutsideTab(tabName: string, activeTab: string): State {
  return {
    index: 0,
    routes: [
      {
        key: `${activeTab}-key`,
        name: `${activeTab}Tab`,
        state: {
          index: 0,
          routes: [{ key: `${activeTab}-root`, name: activeTab }],
        },
      },
      {
        key: `${tabName}-key`,
        name: `${tabName}Tab`,
        state: {
          index: 0,
          routes: [{ key: `${tabName}-root`, name: tabName }],
        },
      },
    ],
  };
}

describe('getTabState — member tree', () => {
  for (const tab of ['Home', 'Favourites', 'Calls', 'You'] as const) {
    it(`${tab}: InsideAtRoot when at root`, () => {
      expect(getTabState(makeStateAtRoot(tab), tab)).toBe(
        TabState.InsideAtRoot,
      );
    });

    it(`${tab}: Inside when something is pushed`, () => {
      expect(getTabState(makeStateInsideTab(tab), tab)).toBe(TabState.Inside);
    });

    it(`${tab}: Outside when another tab is active`, () => {
      const other = tab === 'Home' ? 'Favourites' : 'Home';
      expect(getTabState(makeStateOutsideTab(tab, other), tab)).toBe(
        TabState.Outside,
      );
    });
  }

  it('returns Outside when state is undefined', () => {
    expect(getTabState(undefined, 'Home')).toBe(TabState.Outside);
  });
});

describe('getTabState — provider tree', () => {
  for (const tab of ['Chats', 'Saved', 'You'] as const) {
    it(`${tab}: InsideAtRoot when at root`, () => {
      expect(getTabState(makeStateAtRoot(tab), tab)).toBe(
        TabState.InsideAtRoot,
      );
    });

    it(`${tab}: Inside when something is pushed`, () => {
      expect(getTabState(makeStateInsideTab(tab), tab)).toBe(TabState.Inside);
    });
  }
});
