/**
 * What the route adapters need from SignedIn that is not navigation: the
 * signed-in role, and the session transitions only the boot machine can make
 * (sign-out and account deletion unmount the whole container; a provider
 * submit re-runs the policy and permission gates).
 */

import { createContext, useContext } from 'react';

export interface SignedInActions {
  role: 'member' | 'provider';
  onSignedOut: () => void;
  onProviderOnboarded: () => void;
}

export const SignedInActionsContext = createContext<SignedInActions | null>(null);
SignedInActionsContext.displayName = 'SignedInActionsContext';

export function useSignedInActions(): SignedInActions {
  const value = useContext(SignedInActionsContext);
  if (value === null) {
    throw new Error('useSignedInActions must be used inside RoutesContainer');
  }
  return value;
}
