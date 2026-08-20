-- ---------------------------------------------------------------------------
-- 007 — which side of a conversation you are on
-- ---------------------------------------------------------------------------
-- One column, and it fixes two things that both come from the same wrong
-- assumption: that a person's *profile role* tells you their role in a given
-- conversation. It does not, and the counterexample is not exotic — it is the
-- supply pipeline working as designed.
--
-- A member who is admitted as a provider keeps every thread they had as a
-- member. Those threads still have `member_id = them`, they paid for them, and
-- they are still entitled to rate them. Meanwhile their *work* list should show
-- only the threads where they are the one being paid.
--
-- `conversation_summaries` published `peer_id` but never said which side the
-- caller was on, so the client had to guess from `profiles.role` — which was
-- wrong for exactly the accounts the product wants most. Two consequences,
-- both observed on a real device after an admission:
--
--   1. The provider home screen listed the provider's own member-side thread as
--      if it were work, labelled with the peer's directory name.
--   2. The rating prompt was hidden from the one person who could legitimately
--      submit one, because `submit_review` checks conversation membership while
--      the client was checking the profile role.
--
-- Nothing about privacy changes: the caller already had to be a participant to
-- see the row at all, and `member_id` is compared rather than published.

-- Recreated rather than altered — a view's column list cannot be extended in
-- place. Identical to the 006 definition apart from the final column, and still
-- security_invoker so the underlying RLS on `conversations` remains the
-- boundary.
drop view if exists public.conversation_summaries;

create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    c.last_message_at,
    case when c.member_id = auth.uid() then c.provider_id else c.member_id end
      as peer_id,
    d.display_name as peer_display_name,
    coalesce(d.is_available, false) as peer_available,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    (select m.sender_id from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count,
    -- Drives the "how was it?" prompt without a second query.
    exists (select 1 from public.reviews r where r.conversation_id = c.id)
      as reviewed,
    -- The paying side, per conversation. Not derivable from profiles.role.
    (c.member_id = auth.uid()) as i_am_member
  from public.conversations c
  left join public.provider_directory d
    on d.id = case when c.member_id = auth.uid() then c.provider_id else c.member_id end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_summaries is
  'One row per thread the caller participates in. `i_am_member` is the '
  'authoritative answer to "am I the paying side of THIS thread" — profiles.role '
  'is not, because a promoted provider keeps their member-side threads.';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;
