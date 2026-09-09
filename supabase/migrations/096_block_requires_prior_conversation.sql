-- 096_block_requires_prior_conversation.sql
--
-- A member may only block a provider they have actually interacted with — never
-- a provider they merely browsed on the discovery card (Amit, 2026-09-10). The
-- client already removed block/report from ProviderDetailScreen; this is the
-- server-side enforcement so the rule holds no matter what calls the API.
--
-- Blocking is a direct INSERT into public.blocks, gated in migration 005 only by
-- `with check (auth.uid() = blocker_id)`. We tighten that to also require that a
-- conversation already exists between the two parties. Every legitimate block
-- path satisfies this: ChatScreen operates on a conversation (open_conversation,
-- migration 003, creates the row when the chat is opened), and both the header
-- and message-long-press block actions live there. Only the removed discovery
-- card offered a block with no conversation, which is exactly what this refuses.

-- Does a conversation exist between two users (in either role)?
--
-- SECURITY DEFINER so the check is not itself filtered by conversations RLS and
-- gives the same answer regardless of which side blocks; it returns only a
-- boolean and never leaks a row. Mirrors is_blocked_pair (migration 005), which
-- is DEFINER for the same class of reason.
create or replace function public.share_conversation(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where (c.member_id = p_a and c.provider_id = p_b)
       or (c.member_id = p_b and c.provider_id = p_a)
  );
$$;

revoke all on function public.share_conversation(uuid, uuid) from public, anon;
grant execute on function public.share_conversation(uuid, uuid) to authenticated;

-- Re-create the INSERT policy with the interaction requirement. The block itself
-- persists if the conversation is later removed — the guard is only about who you
-- are allowed to block in the first place, not about maintaining the block.
drop policy if exists "Owner creates own blocks" on public.blocks;
create policy "Owner creates own blocks"
  on public.blocks for insert
  with check (
    auth.uid() = blocker_id
    and public.share_conversation(blocker_id, blocked_id)
  );
