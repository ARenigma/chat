-- ---------------------------------------------------------------------------
-- 047  Point policy records at Pappal's real public site
-- ---------------------------------------------------------------------------
-- bond-app.vercel.app belongs to an unrelated cryptocurrency product. Keep the
-- existing policy version and acceptance rows intact: this changes only the
-- document location and neutralises the stale paid-chat summary; it does not
-- publish new legal terms or require users to accept the same policy again.

update public.policy_versions
set url = 'https://chat-arenigmas-projects.vercel.app/terms.html',
    summary = 'Terms of Use for the Pappal social conversation platform.'
where kind = 'terms'
  and url = 'https://bond-app.vercel.app/terms.html';

update public.policy_versions
set url = 'https://chat-arenigmas-projects.vercel.app/privacy.html',
    summary = 'Privacy Policy for Pappal and its conversation features.'
where kind = 'privacy'
  and url = 'https://bond-app.vercel.app/privacy.html';
