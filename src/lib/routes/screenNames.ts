/**
 * Maps new route names to their legacy telemetry strings.
 *
 * The old flat-route system used strings like 'home', 'chat', 'call'.
 * Navigation.tsx's onReady / onStateChange pass the focused route name
 * through LEGACY_KIND before calling trackScreenOpened, so existing
 * analytics dashboards keep their continuity.
 *
 * New routes that have no legacy equivalent get their own kind string.
 * Provider 'Chats' maps to 'home' (it replaced ProviderHomeScreen).
 *
 * nav-migration §3, R17.
 */

export type LegacyKind = string;

/**
 * Every route name must have an entry here. A contract test pins that no
 * route is missing (implemented in step 7 when Navigation.tsx is mounted).
 */
export const LEGACY_KIND: Record<string, LegacyKind> = {
  // Member roots
  Home: 'home',
  Favourites: 'favourites',
  Calls: 'calls',
  You: 'you',

  // Provider roots
  Chats: 'home',
  Saved: 'saved',

  // Shared pushed screens
  Chat: 'chat',
  ChatV2: 'chatV2',
  Call: 'call',
  Blocked: 'blocked',
  Usage: 'usage',

  // Member-only pushed screens
  ChatsList: 'chatsList',
  ProviderDetail: 'providerDetail',
  // Same screen as a full page from inside a chat; one telemetry kind.
  ProviderProfile: 'providerDetail',
  Wallet: 'wallet',
  Apply: 'apply',
  ApplicationStatus: 'applicationStatus',
  Invoices: 'invoices',
  Transactions: 'transactions',
  HomeSuggestion: 'homeSuggestion',

  // Provider-only pushed screens
  ChatRequest: 'chatRequest',
  Payout: 'payout',
  ProviderPhotos: 'providerPhotos',
  EditProfile: 'editProfile',

  // Tab keys (bottom-tabs reports these as the focused route while at root)
  HomeTab: 'home',
  FavouritesTab: 'favourites',
  CallsTab: 'calls',
  YouTab: 'you',
  ChatsTab: 'home',
  SavedTab: 'saved',
};
