-- 015 — the sender's photo in the push payload (#6, SP photo as notification hero).
--
-- The push sender (supabase/functions/send-push) says who a message is from and
-- never what it says. This adds one more fact it may carry: the sender's public
-- profile photo, so Android can render it as the notification's BigPicture — the
-- "SP photo as hero in the dropdown" Amit asked for.
--
-- `avatar_url` comes from `provider_directory`, which by construction holds only
-- providers, joined LEFT — so this column is non-null exactly when the sender is
-- a provider (the SP-photo case) and null for a member sender, who has no public
-- photo and gets no image. It is the same public-bucket URL already published to
-- every member in the directory, so nothing newly sensitive leaves the database;
-- the one new disclosure is at the device, where the photo now shows on the lock
-- screen, which is a product decision recorded with the feature.
--
-- Appended as the last column because `create or replace view` can only add at
-- the end (009 dropped-and-recreated for the same rule); nothing else changes.
create or replace view public.pending_pushes
with (security_invoker = true) as
  select
    m.id as message_id,
    m.conversation_id,
    m.sender_id as peer_id,
    t.token,
    t.platform,
    d.display_name as sender_display_name,
    m.created_at,
    d.avatar_url as sender_avatar_url
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.push_tokens t
    on t.user_id = case when m.sender_id = c.member_id then c.provider_id else c.member_id end
  left join public.provider_directory d on d.id = m.sender_id
  where m.read_at is null
    and m.notified_at is null
    and m.created_at > now() - interval '24 hours';

revoke all on public.pending_pushes from anon, authenticated;

comment on view public.pending_pushes is
  'One row per (undelivered message, recipient device). Never exposes the message '
  'body: a notification says who replied, not what they said. May carry the '
  'sender_avatar_url (public provider photo) for the notification hero image. '
  'Service role only.';
