import {
  APP_ENV,
  MSG91_WIDGET_ID,
  MSG91_WIDGET_TOKEN,
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
 *
 * The two MSG91 values are the widget's *client* pair and belong here for the
 * same reason: they are extractable from any APK, MSG91 issues them for exactly
 * that, and the access token they produce proves nothing on its own. The server
 * authkey is a different value and lives only in Edge Function secrets.
 */
export const ENV = {
  supabaseUrl: SUPABASE_URL ?? '',
  supabaseAnonKey: SUPABASE_ANON_KEY ?? '',
  sentryDsn: SENTRY_DSN ?? '',
  appEnv: APP_ENV ?? 'development',
  msg91WidgetId: MSG91_WIDGET_ID ?? '',
  msg91WidgetToken: MSG91_WIDGET_TOKEN ?? '',
  turnUrl: TURN_URL ?? '',
  turnUsername: TURN_USERNAME ?? '',
  turnCredential: TURN_CREDENTIAL ?? '',
} as const;

/** Deep-link target for the optional OAuth account link. */
export const AUTH_REDIRECT_URL = 'companionchat://auth-callback';

/** Fail loudly at boot rather than mysteriously on the first request. */
export function assertEnv(): void {
  const missing = (['supabaseUrl', 'supabaseAnonKey'] as const).filter(k => ENV[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}, copy .env.example to .env and fill it in.`,
    );
  }
}
