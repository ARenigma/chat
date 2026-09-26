/**
 * Route param types for the react-navigation native-stack + bottom-tabs tree.
 *
 * adapted from bluesky-social/social-app src/lib/routes/types.ts (MIT),
 * see THIRD_PARTY_LICENSES.md
 *
 * Params must be serialisable:
 * https://reactnavigation.org/docs/params
 */

import type {
  NavigationState,
  NavigatorScreenParams,
  PartialState,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Call medium — matches the database type in src/lib/database.types.ts. */
export type CallMedium = 'voice' | 'video';

type CommonParams = {
  Chat: { peerId: string };
  ChatV2: { peerId: string; benchmarkReadOnly: boolean };
  /** callId is null between beginCall() and start_call resolving. */
  Call: {
    peerId: string;
    direction: 'out' | 'in';
    callId: string | null;
    medium: CallMedium;
  };
  Blocked: undefined;
  Usage: undefined;
};

export type MemberScreenParams = CommonParams & {
  ChatsList: undefined;
  ProviderDetail: { providerId: string };
  Wallet: undefined;
  Apply: { from: 'home' | 'settings' | 'applicationStatus' };
  ApplicationStatus: undefined;
  Invoices: undefined;
  Transactions: undefined;
  HomeSuggestion: { suggestionId: string };
};

export type ProviderScreenParams = CommonParams & {
  ChatRequest: { requestId: string };
  Payout: undefined;
};

export type MemberTabParams = {
  HomeTab: NavigatorScreenParams<MemberScreenParams & { Home: undefined }>;
  FavouritesTab: NavigatorScreenParams<
    MemberScreenParams & { Favourites: undefined }
  >;
  CallsTab: NavigatorScreenParams<MemberScreenParams & { Calls: undefined }>;
  YouTab: NavigatorScreenParams<MemberScreenParams & { You: undefined }>;
};

export type ProviderTabParams = {
  ChatsTab: NavigatorScreenParams<ProviderScreenParams & { Chats: undefined }>;
  SavedTab: NavigatorScreenParams<ProviderScreenParams & { Saved: undefined }>;
  YouTab: NavigatorScreenParams<ProviderScreenParams & { You: undefined }>;
};

// NOTE: Not strictly exact but close enough for routing; a TS wizard could
// get this 100% (adapted note from Bluesky's types.ts).
export type AllNavigatorParams = MemberTabParams &
  ProviderTabParams &
  MemberScreenParams &
  ProviderScreenParams & {
    Home: undefined;
    Favourites: undefined;
    Calls: undefined;
    You: undefined;
    Chats: undefined;
    Saved: undefined;
  };

// NOTE: NativeStackNavigationProp is not strictly correct for tab screens but
// is close enough in practice; typed wrappers in the adapter layer use the
// narrower props from NativeStackScreenProps.
export type NavigationProp = NativeStackNavigationProp<AllNavigatorParams>;

/** Both concrete and stale (partial) navigator states. */
export type State =
  | NavigationState
  | Omit<PartialState<NavigationState>, 'stale'>;
