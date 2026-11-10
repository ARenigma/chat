/**
 * The /design preview renders every component with fixture data and no Supabase
 * session. Off in production unless ADMIN_DESIGN_PREVIEW=1 is set explicitly;
 * middleware only skips auth for it outside production, so even with the flag a
 * production deploy keeps the preview behind the founder login.
 */
export function designPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ADMIN_DESIGN_PREVIEW === '1';
}
