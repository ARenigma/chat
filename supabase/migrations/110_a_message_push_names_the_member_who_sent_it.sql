-- ===========================================================================
-- 110  A chat notification names the member who sent it, not "Someone"
-- ===========================================================================
-- The message branch of `pending_pushes` (105:190-203) resolves the sender's
-- name by LEFT JOINing `provider_directory`. That view is filtered to
-- role = 'provider', so when the sender is the MEMBER the join misses,
-- `sender_display_name` comes back NULL, and send-push's
-- `row.sender_display_name ?? 'Someone'` fires. Every push a member sends to a
-- provider is from "Someone".
--
-- It is not RLS and it is not a missing service-role client: the name is simply
-- never selected. 011:1620 had it right with
-- `coalesce(d.display_name, public.member_handle(m.sender_id))`; 105 rebuilt
-- the view to add the contact branch and lost the coalesce in the restatement.
--
-- The fix goes one step further than restoring 011, because a member CAN have a
-- real display_name now (040's profile setup) and the handle is only the
-- fallback for one who has not set it. Same shape 103:562 publishes to
-- `conversation_peers`: `coalesce(peer.display_name, member_handle(peer.id))`.
-- `profiles` is joined INNER, which cannot drop a row: `messages.sender_id` is
-- `not null references profiles(id)`.
--
-- WHAT MUST NOT CHANGE, and the reason each:
--
--   `sender_avatar_url` stays sourced from `provider_directory` ONLY. A
--   member's `profiles.avatar_url` is a 'clay:<seed>' sentinel the app renders
--   from a bundled asset, not an http URL, and it would ride the payload into
--   the native `loadAvatarBitmap` (Conversations.kt:482), which hands whatever
--   it gets to `URL(url).openConnection()`. That throws MalformedURLException
--   on every push; the catch swallows it, so the visible result would be a
--   Person with no icon and a per-push exception nobody sees. A member sender
--   keeps sending no avatar, which is what happens today.
--
--   The column list and its ORDER. The deployed send-push does `select('*')`
--   on this view, so a rename or a reorder is a change to a deployed contract
--   with no build step in front of it.
--
-- The contact branch is untouched: its sender is a provider by construction
-- (INNER JOIN provider_directory, `r.initiator_id = c.provider_id`), so it has
-- never been able to say "Someone".

-- No explicit BEGIN/COMMIT: the Supabase CLI wraps each file in its own
-- transaction, and a COMMIT inside closes it early.

drop view if exists public.pending_pushes;

create view public.pending_pushes
with (security_invoker = true) as
  -- A message nobody has been told about.
  select
    m.id                as message_id,
    m.conversation_id,
    m.sender_id         as peer_id,
    t.token,
    t.platform,
    coalesce(s.display_name, public.member_handle(m.sender_id))
                        as sender_display_name,
    m.created_at,
    d.avatar_url        as sender_avatar_url,
    'message'::text     as kind
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.push_tokens t
    on t.user_id = case when m.sender_id = c.member_id then c.provider_id else c.member_id end
  join public.profiles s on s.id = m.sender_id
  left join public.provider_directory d on d.id = m.sender_id
  where m.read_at is null
    and m.notified_at is null
    and m.created_at > now() - interval '24 hours'
    and not public.is_blocked_pair(c.member_id, c.provider_id)

  union all

  -- A provider-initiated chat request the member has not been told about.
  select
    r.id                as message_id,
    r.conversation_id,
    r.initiator_id      as peer_id,
    t.token,
    t.platform,
    d.display_name      as sender_display_name,
    r.created_at,
    d.avatar_url        as sender_avatar_url,
    'contact'::text     as kind
  from public.session_requests r
  join public.conversations c on c.id = r.conversation_id
  -- The member's devices. Named explicitly rather than derived, because on this
  -- branch the direction is the point: only a provider reaching a member.
  join public.push_tokens t on t.user_id = c.member_id
  -- INNER, unlike the message branch: `provider_directory` (005/012) is exactly
  -- the admitted providers, so a provider under review or under suspension
  -- cannot ring a member. It also supplies the two facts the payload carries,
  -- the stage name and the public photo.
  join public.provider_directory d on d.id = r.initiator_id
  where r.channel = 'chat'
    and r.status = 'pending'
    and r.notified_at is null
    and r.expires_at > now()
    and r.initiator_id = c.provider_id
    and r.recipient_id = c.member_id
    -- The member's two refusals.
    and c.chat_consent_declined_at is null
    and not public.is_blocked_pair(c.member_id, c.provider_id)
    -- Suppressed once the provider has written something with, or since, the
    -- request. 077's `send_message` inserts the request and THEN the message
    -- inside one transaction, so on that path this is already false by the time
    -- the sender reads the queue and the member gets ONE notification, the
    -- message's. Without it, MessagingStyle, which is cumulative by design,
    -- would show the same "wants to have a chat with you" line twice.
    and not exists (
      select 1
      from   public.messages m2
      where  m2.conversation_id = r.conversation_id
        and  m2.sender_id       = r.initiator_id
        and  m2.created_at     >= r.created_at
    );

revoke all on public.pending_pushes from anon, authenticated;
-- A drop takes the grants with it. On the hosted project Supabase's default
-- privileges hand the new view back to service_role, which is what 009 and 011
-- relied on silently; stated here so the pgTAP harness, which has no default
-- privileges (supabase/tests/harness.sql), ends up with the same view the
-- sender actually reads.
grant select on public.pending_pushes to service_role;

comment on view public.pending_pushes is
  'One row per (thing that owes a push, recipient device). Two sources since '
  '105: an undelivered message, and a provider-initiated chat request, which '
  'the member would otherwise only hear about if it happened to carry a '
  'message. Never exposes a message body: a notification says who is reaching '
  'you, not what they said. Both branches drop out for a blocked pair, and the '
  'contact branch also drops out once the member has declined a paid chat in '
  'that conversation (086). Since 110 the message branch names a MEMBER sender '
  'from profiles, falling back to member_handle, because provider_directory '
  'has no row for one and the push said "Someone". The avatar still comes from '
  'provider_directory alone: a member''s avatar_url is a ''clay:'' sentinel, '
  'not a URL the native side can fetch. Service role only.';
