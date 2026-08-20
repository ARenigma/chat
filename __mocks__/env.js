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
};
