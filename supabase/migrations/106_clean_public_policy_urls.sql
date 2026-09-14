-- ---------------------------------------------------------------------------
-- 106  Canonical policy URLs without .html (matches web/vercel.json cleanUrls)
-- ---------------------------------------------------------------------------
-- Play and in-app links should use stable clean paths. Legacy *.html URLs
-- remain valid via permanent redirects on the static site.

update public.policy_versions
set url = 'https://chat-arenigmas-projects.vercel.app/terms'
where kind = 'terms'
  and url in (
    'https://chat-arenigmas-projects.vercel.app/terms.html',
    'https://bond-app.vercel.app/terms.html'
  );

update public.policy_versions
set url = 'https://chat-arenigmas-projects.vercel.app/privacy'
where kind = 'privacy'
  and url in (
    'https://chat-arenigmas-projects.vercel.app/privacy.html',
    'https://bond-app.vercel.app/privacy.html'
  );
