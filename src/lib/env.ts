import { APP_ENV, SENTRY_DSN, SUPABASE_ANON_KEY, SUPABASE_URL } from '@env';

/**
 * Build-time configuration, inlined by Babel from `.env` — nothing here is a
 * secret. The anon key is RLS-scoped; the Sentry DSN is ingest-only. Service
 * role keys and the OpenAI key exist solely as Supabase function secrets.
 */
export const ENV = {
  supabaseUrl: SUPABASE_URL ?? '',
  supabaseAnonKey: SUPABASE_ANON_KEY ?? '',
  sentryDsn: SENTRY_DSN ?? '',
  appEnv: APP_ENV ?? 'development',
} as const;

/** Deep-link target for the optional OAuth account link. */
export const AUTH_REDIRECT_URL = 'companionchat://auth-callback';

/** Fail loudly at boot rather than mysteriously on the first request. */
export function assertEnv(): void {
  const missing = (['supabaseUrl', 'supabaseAnonKey'] as const).filter(k => ENV[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} — copy .env.example to .env and fill it in.`,
    );
  }
}
