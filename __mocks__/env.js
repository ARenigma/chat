/**
 * Test double for the `@env` virtual module.
 *
 * Values match `.env.example` so a test that accidentally depends on a real
 * project fails loudly instead of quietly talking to production.
 */
module.exports = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'placeholder-anon-key',
  SENTRY_DSN: '',
  APP_ENV: 'test',
  // Deliberately blank. `widgetConfigured()` is then false under test, so no
  // test can reach MSG91, and the "not configured" branch is the one exercised
  // by default rather than the one nobody ever runs.
  MSG91_WIDGET_ID: '',
  MSG91_WIDGET_TOKEN: '',
};
