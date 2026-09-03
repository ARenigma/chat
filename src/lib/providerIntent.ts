/**
 * The "Become a partner" intent, persisted.
 *
 * The provider-signup flag lives in the in-memory store for reactivity, but the
 * auth → boot transition intermittently lost it (a store reset somewhere between
 * tapping "Become a partner" and the boot machine reading it), dropping the
 * would-be provider on the member Home instead of the provider onboarding.
 *
 * Persisting the intent to storage makes it survive that: it is set when the
 * button is tapped, read (and used to restore the reactive flag) at boot, and
 * cleared when the onboarding screen is left or completed. Storage is not reset
 * by whatever clears the in-memory store, so the intent cannot be lost mid-flow.
 */
export const PROVIDER_INTENT_KEY = 'companion.providerIntent';
