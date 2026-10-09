-- Migration 187: provider request sweep fixes (2026-10-09)
--
-- C11: get_request_peer_info — a SECURITY DEFINER read the provider's ring
--      calls when the member is brand-new and absent from the conversation
--      cache. Returns peer display name, avatar, and the first message preview
--      (≤120 chars) for the requesting conversation. Only the addressed
--      provider may call it.
--
-- C14: conversation_summaries — add peer_request_pending: true when there is
--      a live, unanswered chat request from the peer addressed to the caller as
--      recipient. Provider inbox reads this to show "Wants to chat" on pending-
--      request rows without a second query.

-- ---------------------------------------------------------------------------
-- 1. get_request_peer_info (C11)
-- ---------------------------------------------------------------------------
-- Security model: the caller must be the request's recipient_id. The function
-- is SECURITY DEFINER so it can join profiles (whose RLS limits member reads)
-- and messages (which are hidden after session settlement — migration 045).
-- The preview is limited to 120 characters server-side so no full message body
-- can be extracted through this path.
-- https://developer.android.com/develop/ui/views/notifications/conversations

create or replace function public.get_request_peer_info(p_request_id uuid)
returns table (
  peer_display_name    text,
  peer_avatar_url      text,
  first_message_preview text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_initiator_id    uuid;
  v_requested_at    timestamptz;
begin
  -- Gate: only the request's recipient may read peer info through this path.
  select sr.conversation_id, sr.initiator_id, sr.created_at
    into v_conversation_id, v_initiator_id, v_requested_at
    from public.session_requests sr
   where sr.id = p_request_id
     and sr.recipient_id = auth.uid();

  if not found then
    -- Not this provider's request (or request does not exist): return nothing.
    return;
  end if;

  return query
  select
    -- member_handle is a function (011), as conversation_peers reads it.
    coalesce(p.display_name, public.member_handle(p.id))::text  as peer_display_name,
    p.avatar_url::text                                           as peer_avatar_url,
    -- The message that came WITH this request, capped at 120 chars. Not the
    -- conversation's first message ever: that can belong to an earlier
    -- session whose transcript was hidden when it ended (045), and this
    -- SECURITY DEFINER read would otherwise hand hidden text back out. Only a
    -- visible message from the initiator, sent around the request, qualifies.
    -- LEFT JOIN so the function returns a row even when none does.
    left(m.body, 120)::text                                      as first_message_preview
  from public.profiles p
  left join lateral (
    select msg.body
    from   public.messages msg
    where  msg.conversation_id = v_conversation_id
      and  msg.sender_id = v_initiator_id
      and  msg.hidden_at is null
      and  msg.created_at >= v_requested_at - interval '2 minutes'
    order  by msg.created_at asc
    limit  1
  ) m on true
  where p.id = v_initiator_id;
end;
$$;

revoke all on function public.get_request_peer_info(uuid) from public;
grant execute on function public.get_request_peer_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. conversation_summaries — add peer_request_pending (C14)
-- ---------------------------------------------------------------------------
-- The view body is copied exactly from migration 155 (the last definition),
-- with one column appended: peer_request_pending.
--
-- Dependent objects: none. conversation_summaries is queried directly by
-- PostgREST; no other view or function depends on it in this schema.

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
    pe.peer_last_seen_at,
    -- C14: true when there is a live, unanswered chat request from the peer
    -- addressed to the caller as recipient. Only ever true on provider-side
    -- rows (i_am_member = false); on member-side rows there is no such request.
    -- Capped to 'pending' + responded_at IS NULL + not yet expired so the flag
    -- disappears as soon as the provider accepts or the request times out.
    exists (
      select 1
      from   public.session_requests sr
      where  sr.conversation_id = c.id
        and  sr.recipient_id = auth.uid()
        and  sr.channel = 'chat'
        and  sr.status  = 'pending'
        and  sr.responded_at is null
        and  sr.expires_at > now()
    )                                                           as peer_request_pending
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
  'dropped, and peer_online / peer_last_seen_at from conversation_peers. '
  '187 appended peer_request_pending for the provider inbox (C14).';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;
