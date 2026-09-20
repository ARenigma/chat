import {
  APP_ENV,
  SENTRY_DSN,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  TURN_CREDENTIAL,
  TURN_URL,
  TURN_USERNAME,
} from '@env';

/**
 * Build-time configuration, inlined by Babel from `.env`, nothing here is a
 * secret. The anon key is RLS-scoped; the Sentry DSN is ingest-only. The service
 * role key is never on a device: the only privileged operation, provider
 * admission, runs from the ops surface.
 */
export const ENV = {
  supabaseUrl: SUPABASE_URL ?? '',
  supabaseAnonKey: SUPABASE_ANON_KEY ?? '',
  sentryDsn: SENTRY_DSN ?? '',
  appEnv: APP_ENV ?? 'development',
  turnUrl: TURN_URL ?? '',
  turnUsername: TURN_USERNAME ?? '',
  turnCredential: TURN_CREDENTIAL ?? '',
} as const;

/** Deep-link target for the optional OAuth account link. */
export const AUTH_REDIRECT_URL = 'companionchat://auth-callback';
/** Browser Google OAuth callback used only to finish Truecaller account linking. */
export const TRUECALLER_LINK_REDIRECT_URL =
  'companionchat://auth-callback/truecaller-link';

/** Fail loudly at boot rather than mysteriously on the first request. */
export function assertEnv(): void {
  const missing = (['supabaseUrl', 'supabaseAnonKey'] as const).filter(
    k => ENV[k] === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(
        ', ',
      )}, copy .env.example to .env and fill it in.`,
    );
  }
}
