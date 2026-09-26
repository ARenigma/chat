-- ===========================================================================
-- 155  Provider presence: a heartbeat, "Online" / "last seen", and the inbox
--      that read every provider as offline
-- ===========================================================================
-- Owner decisions (Amit, 2026-09-27):
--   1. A provider's last seen is ALWAYS ON for members. A member's own last
--      seen stays hidden from everyone. A blocked pair, in either direction,
--      sees neither.
--   2. Availability off is never "Online", but "last seen ..." still shows.
--   3. As live as possible without spamming. The provider app heartbeats on
--      foreground and every 30 s while foregrounded, and says OFFLINE on
--      background. ONLINE = is_available AND a heartbeat within 75 s AND no
--      explicit offline since. The member side refetches the chat header's
--      peer every 15 s while the chat is open.
--
-- ── The bug this also fixes ─────────────────────────────────────────────────
-- conversation_summaries (last rebuilt in 037) never selected peer_available
-- or peer_is_provider, though conversation_peers has projected both since 011.
-- So the Home Chats rail, the Chats list and the chat header, which read the
-- inbox row, saw every provider as not loaded (no dot), while the Explore card
-- (provider_directory.is_available) was right. Both are appended below.
--
-- ── The data model, and why it is the minimal one ───────────────────────────
-- Two columns on profiles, one of them already there:
--   * last_active_at (011): the server time of the provider's last presence
--     EVENT, a heartbeat or an explicit offline. It is what "last seen" is.
--   * presence_online (new, boolean): what that last event said.
-- ONLINE is derived, never stored:
--     is_available AND presence_online AND last_active_at > now() - 75 s
-- An explicit offline writes last_active_at = now() and presence_online =
-- false, so it flips the provider off at once and stamps the moment they left.
-- A lost offline (the OS killed the app first) is covered by the 75 s window:
-- two missed 30 s heartbeats plus slack for a slow network.
--
-- The alternative, a separate presence_offline_at timestamp, needs a
-- comparison of two timestamps to say what the last event was, and a
-- greatest() of them to say when. The boolean answers both with the one stamp
-- that already exists, and makes the rate limit's "state unchanged" test an
-- equality.
--
-- ── What is published, and to whom ──────────────────────────────────────────
-- Derived here, in the two definer views every surface reads, so the Explore
-- card, the rail, the Chats list and the chat header cannot disagree:
--   * provider_directory: online, last_seen_at
--   * conversation_peers:  peer_online, peer_last_seen_at
--   * conversation_summaries passes the peers' pair through.
-- last_seen_at is date_trunc('minute', last_active_at): the line reads "last
-- seen today at 10:15 am", and publishing seconds would be a finer record of
-- somebody's day than the product needs. online is a boolean and says nothing
-- finer than 75 s.
--
-- Both are withheld (false / NULL):
--   * when the peer is a member. The views gate on role = 'provider', and
--     presence_heartbeat writes nothing for a member, so a member's last seen
--     is absent at rest as well as on the wire;
--   * across a block in either direction;
--   * when never seen (last_active_at null).
-- presence_visible (011) no longer gates anything: providers are always on and
-- members are never on, so the setting has nothing left to decide. It stays in
-- the schema, unread, with presence and touch_presence, for 111's reason.
--
-- The old stamp columns, provider_directory.last_active_at and
-- conversation_peers/_summaries.peer_last_active_at, are RETIRED to a typed
-- NULL. They cannot be dropped (create or replace keeps every column, and
-- conversation_summaries and pending_pushes depend on these views), and left as
-- they were they would publish the raw heartbeat to the second, gated only on
-- presence_visible, to blocked members as well. Nothing in the app reads them:
-- touch_presence was never called, so they were always NULL in practice.
--
-- ── The block test is inlined, on purpose ───────────────────────────────────
-- is_blocked_pair(uuid, uuid) is closed to clients (143), and a function called
-- inside a view is checked against the view's CALLER, not its owner
-- (https://www.postgresql.org/docs/current/sql-createview.html, "Functions
-- called in the view are treated the same as if they had been called directly
-- from the query using the view"). Calling it here would make both views fail
-- with "permission denied" for every member. The EXISTS below is the same
-- symmetric test as 005's, reading public.blocks as the view owner, and the
-- only pair it tests is (auth.uid(), this row's provider): the viewer learns
-- whether they share a block with someone, which blocking already shows them
-- (the chat refuses to send), and nothing about anyone else's blocks.
--
-- No explicit BEGIN/COMMIT: the Supabase CLI wraps each file in its own
-- transaction, and a COMMIT inside closes it early.

-- ---------------------------------------------------------------------------
-- 1. The one new column
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists presence_online boolean not null default false;

comment on column public.profiles.presence_online is
  'What the provider''s last presence event said: true for a heartbeat, false '
  'for an explicit offline (155). Written only by presence_heartbeat(), and '
  'guarded, for last_active_at''s reason. Never read alone: online is '
  'is_available AND this AND last_active_at within 75 s.';

comment on column public.profiles.last_active_at is
  'Server time of the provider''s last presence event, a heartbeat or an '
  'explicit offline (155); what "last seen" is. Written only by '
  'presence_heartbeat(), for providers only, so a member''s is never written. '
  'Guarded, because a client that could write it could backdate it, and '
  'presence you can forge reads as "away" while somebody is watching.';

-- ---------------------------------------------------------------------------
-- 2. The guard covers the new column
-- ---------------------------------------------------------------------------
-- 011's guard, restated with its one check and the new one. Reproducing a body
-- is the mistake 010 and 054 made with a long guard; this one has a single
-- condition and 570 pins both. SECURITY INVOKER (the default) is load-bearing:
-- under DEFINER current_user is the owner and the guard passes everything.
-- create or replace keeps the ACL 153 closed.
create or replace function public.guard_presence_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.last_active_at is distinct from old.last_active_at then
      raise exception 'profiles.last_active_at is not client-writable'
        using errcode = '42501';
    end if;
    if new.presence_online is distinct from old.presence_online then
      raise exception 'profiles.presence_online is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. presence_heartbeat: the only writer
-- ---------------------------------------------------------------------------
-- The caller is auth.uid(), never an argument. Providers only: a member's call
-- matches no row and writes nothing, so there is no member trail at rest.
--
-- Rate limit, server-side, so a buggy client cannot turn presence into a write
-- storm on profiles: the UPDATE is skipped while the last event is under 20 s
-- old AND says the same thing. A change of state (online -> offline, or back)
-- is always written at once, because that is the transition a member is
-- waiting to see. The client's 30 s interval clears the 20 s floor with room
-- for timer jitter, so a well-behaved provider is never throttled.
--
-- now() and not clock_timestamp(): the event is stamped with its transaction,
-- which is what every other server stamp in this schema does.
create or replace function public.presence_heartbeat(p_online boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_online is null then
    raise exception 'p_online must be true or false' using errcode = '22004';
  end if;

  update public.profiles
  set    last_active_at  = now(),
         presence_online = p_online
  where  id = v_uid
    and  role = 'provider'
    and  (last_active_at is null
          or last_active_at <= now() - interval '20 seconds'
          or presence_online is distinct from p_online);
end;
$$;

comment on function public.presence_heartbeat(boolean) is
  'The provider app''s presence signal (155): true on foreground and every '
  '30 s while foregrounded, false on background. Providers only; a member''s '
  'call writes nothing. At most one write per 20 s per user unless the state '
  'changes. Online and last seen are derived from it in provider_directory '
  'and conversation_peers.';

-- Client RPC: closed to PUBLIC and anon, open to authenticated, and on 568's
-- list (and 563's 39t allowlist). 153 closed the default, so without the grant
-- the heartbeat is uncallable.
revoke all on function public.presence_heartbeat(boolean) from public, anon;
grant execute on function public.presence_heartbeat(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. touch_presence is retired
-- ---------------------------------------------------------------------------
-- Kept, per 153's practice of closing rather than dropping: nothing calls it
-- (no client ever did), and left open it would let ANY role stamp
-- last_active_at, a member included, outside the heartbeat's rate limit and
-- without setting presence_online. Closed to every client role.
revoke execute on function public.touch_presence() from public, anon, authenticated;

comment on function public.touch_presence() is
  'Retired by 155 and closed to clients: presence_heartbeat() is the writer. '
  'Never called by any client. Kept rather than dropped, as 153 closes rather '
  'than drops.';

-- ---------------------------------------------------------------------------
-- 5. conversation_peers: the peer's online and last seen
-- ---------------------------------------------------------------------------
-- Restated from 103 with peer_last_active_at retired and two columns appended.
-- `create or replace` requires the existing columns in the existing order, and
-- conversation_summaries selects from this view, so it cannot be dropped.
-- The WITH clause is restated because create or replace replaces the view's
-- options with the ones given: omitting it would silently make this an
-- invoker view, and the auth.uid() WHERE below would then run under the
-- caller's RLS on profiles.
create or replace view public.conversation_peers
with (security_invoker = false) as
  select
    c.id as conversation_id,
    peer.id as peer_id,
    coalesce(peer.display_name, public.member_handle(peer.id))
      as peer_display_name,
    case when peer.role = 'provider' then peer.is_available else false end
      as peer_available,
    -- Retired (155): read peer_last_seen_at. See the header.
    null::timestamptz as peer_last_active_at,
    (peer.role = 'provider') as peer_is_provider,
    peer.presence as peer_presence,
    peer.avatar_url as peer_avatar_url,
    -- Online: a provider, open, whose last event was a heartbeat under 75 s
    -- old, and no block between the two of you. False, never null, for
    -- everyone else.
    coalesce(
      peer.role = 'provider'
      and not pair.blocked
      and peer.is_available
      and peer.presence_online
      and peer.last_active_at > now() - interval '75 seconds',
      false
    ) as peer_online,
    -- Last seen: a provider's last event, to the minute. Shown whether or not
    -- they are open (decision 2). NULL for a member, across a block, and for
    -- a provider never seen.
    case
      when peer.role = 'provider' and not pair.blocked
        then date_trunc('minute', peer.last_active_at)
    end as peer_last_seen_at
  from public.conversations c
  join public.profiles peer
    on peer.id = case
      when c.member_id = auth.uid() then c.provider_id else c.member_id
    end
  cross join lateral (
    select exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = peer.id)
         or (b.blocker_id = peer.id and b.blocked_id = auth.uid())
    ) as blocked
  ) pair
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_peers is
  'The peer of every thread the caller is in. Definer, so the auth.uid() '
  'predicate in the WHERE is the access control and not a convenience. Both '
  'roles publish the username and the clay avatar (103). 155 added '
  'peer_online and peer_last_seen_at, a PROVIDER peer''s presence only, to the '
  'minute, and withheld across a block, and retired peer_last_active_at to '
  'NULL. Everything else about a member stays unreachable here by '
  'construction, their presence included: the column list is the privacy '
  'boundary.';

-- Restated from 011; create or replace keeps them, and this makes the file the
-- record.
revoke all on public.conversation_peers from anon, authenticated;
grant select on public.conversation_peers to authenticated;

-- ---------------------------------------------------------------------------
-- 6. conversation_summaries: the rail bug, and the same presence
-- ---------------------------------------------------------------------------
-- 037's list unchanged, with peer_last_active_at now the retired NULL it reads
-- from conversation_peers, and four columns appended: peer_available and
-- peer_is_provider (the bug), peer_online and peer_last_seen_at. Invoker, as in
-- 037: RLS on conversations is the access control here, and the presence
-- columns arrive already derived and gated by the definer view above.
create or replace view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id                                                        as conversation_id,
    case when c.member_id = auth.uid()
         then c.provider_id else c.member_id
    end                                                         as peer_id,
    pe.peer_display_name,
    coalesce(pe.peer_presence, 'hidden'::public.presence_choice) as peer_presence,
    pe.peer_last_active_at,
    pe.peer_avatar_url,
    tm.last_session_at,
    tm.last_session_channel,
    tm.last_session_duration_seconds,
    tm.last_preview_kind,
    latest.status                                               as last_session_status,
    coalesce(tm.unread_count_member, 0)                         as unread_count_member,
    coalesce(tm.unread_count_provider, 0)                       as unread_count_provider,
    (c.member_id = auth.uid())                                  as i_am_member,
    pe.peer_available,
    pe.peer_is_provider,
    pe.peer_online,
    pe.peer_last_seen_at
  from public.conversations c
  left join public.conversation_peers pe
         on pe.conversation_id = c.id
  left join public.conversation_thread_meta tm
         on tm.conversation_id = c.id
  left join lateral (
    select ps.status
    from   public.paid_sessions ps
    where  ps.conversation_id = c.id
    order  by ps.created_at desc
    limit  1
  ) latest on true
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_summaries is
  'Metadata-only inbox projection: peer identity and presence, latest session '
  'activity/channel/status, and role-specific unread counts. Message content '
  'is intentionally absent (ADR-0020). 155 appended peer_available and '
  'peer_is_provider, which the rail and the Chats list read and 037 had '
  'dropped, and peer_online / peer_last_seen_at from conversation_peers.';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 7. provider_directory: the same two readings
-- ---------------------------------------------------------------------------
-- Restated in full from 083, last_active_at retired to NULL, two columns
-- appended. The column list is the privacy boundary: nothing here is new
-- about the provider except the two presence readings, and both are derived
-- (a boolean, and a stamp to the minute), never the raw heartbeat.
--
-- The block test is new to this view and is scoped to the presence columns:
-- a provider you have blocked, or who blocked you, is still listed exactly as
-- before (that is 004's and the directory filters' business, not this
-- migration's), but reads as not online with no last seen.
create or replace view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.gender,
    extract(year from age(p.date_of_birth))::int as age,
    p.headline,
    p.languages,
    p.is_available,
    p.rating_avg,
    p.rating_count,
    p.median_reply_seconds,
    -- Retired (155): read last_seen_at. See the header.
    null::timestamptz as last_active_at,
    p.created_at,
    p.presence,
    p.avatar_url,
    p.about,
    p.chat_enabled,
    p.audio_enabled,
    p.video_enabled,
    p.provider_category,
    p.expertise,
    -- The same derivation as conversation_peers.peer_online, so the Explore
    -- card and the chat header cannot disagree. role = 'provider' is already
    -- the WHERE.
    coalesce(
      not pair.blocked
      and p.is_available
      and p.presence_online
      and p.last_active_at > now() - interval '75 seconds',
      false
    ) as online,
    case when not pair.blocked then date_trunc('minute', p.last_active_at) end
      as last_seen_at
  from public.profiles p
  cross join lateral (
    select exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    ) as blocked
  ) pair
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'Explicit-column privacy boundary over profiles: what a member may see about '
  'a provider. 064 added the three channel switches; 065 added '
  'provider_category; 083 added expertise. 155 added online (open, and a '
  'heartbeat under 75 s old with no offline since) and last_seen_at (the last '
  'presence event, to the minute), both withheld across a block, and retired '
  'last_active_at to NULL. `age` is an integer here and has been since 042.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;
