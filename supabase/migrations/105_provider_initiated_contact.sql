-- ===========================================================================
-- 105  A provider reaching out reaches the member, through the queue that
--      already exists
-- ===========================================================================
-- Requirement: when a provider starts a conversation or reaches out to a
-- member, the member gets a push — the same way a member reaching a provider
-- already does.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ALREADY WIRED, AND WHAT IS NOT
-- ---------------------------------------------------------------------------
-- Traced end to end before writing anything, because three of the four
-- provider-initiated events turn out to be fine and only the fourth is not:
--
--   PROVIDER SENDS A MESSAGE          wired. `pending_pushes` (008/009/015)
--                                     picks the recipient with
--                                     `case when m.sender_id = c.member_id
--                                      then c.provider_id else c.member_id end`
--                                     — symmetric — and `message_push_on_insert`
--                                     (092) dispatches it immediately. Confirmed
--                                     against the live database: the trigger is
--                                     present on `public.messages`, and members
--                                     hold 28 of the 44 registered push tokens,
--                                     so the member direction is not a token gap
--                                     either.
--   PROVIDER PLACES A CALL            wired. `call_push_on_insert` (017) →
--                                     send-call → `pending_call_pushes`, whose
--                                     recipient is `c.callee_id`, direction-free.
--   PROVIDER OPENS THE CHAT           wired. `announce_chat_open` (068) →
--                                     send-open-alert. Both directions, subject
--                                     to 068's four rules.
--   PROVIDER CREATES A CHAT REQUEST   NOT WIRED. `public.session_requests` has
--                                     exactly one trigger in the live database,
--                                     `enforce_provider_channel` (064). Nothing
--                                     enqueues a push for a request, in either
--                                     direction.
--
-- That last one is the whole defect, and it is worse than it looks because of
-- HOW the provider-initiated chat path is built. 077 gives the provider two
-- ways to open a thread:
--
--   a. `send_message` — inserts a session_request AND a message. The member
--      hears about it only because the MESSAGE happens to push.
--   b. `create_session_request` — inserts a session_request and nothing else.
--      Granted to `authenticated`, callable by the provider side of any
--      conversation (077 gives the provider branch its own 30-minute expiry, so
--      it is an anticipated path, not a dead one), and the member is told
--      NOTHING. No message row, so no `pending_pushes` row, so no push, ever.
--
-- So provider-initiated contact is notified by accident — by riding a message —
-- rather than by construction. This makes the REQUEST the notifiable event, so
-- it holds however the provider starts.
--
-- ---------------------------------------------------------------------------
-- WHY IT GOES IN `pending_pushes` AND NOT SOMEWHERE NEW
-- ---------------------------------------------------------------------------
-- Because `Conversations.notify` is the only notification this app builds that
-- Android will actually treat as a conversation, and `pending_pushes` is the
-- only queue that reaches it.
--
-- https://developer.android.com/develop/ui/views/notifications/conversations
--   "A notification is considered as a conversation notification if the
--   following are true: The notification uses MessagingStyle. […] (Only if the
--   app targets Android 11 or higher) The notification is associated with a
--   valid long-lived dynamic or cached sharing shortcut."
--
-- `Conversations.kt:146-231` does all of it — MessagingStyle, a `Person` keyed
-- on the peer id, `pushDynamicShortcut` with `setLongLived(true)`,
-- `setShortcutId`, CATEGORY_MESSAGE, on the `conversations` channel. It is
-- driven by `readConversationPush`, which is driven by a `pending_pushes` row.
--
-- The alternative — reusing the `kind: 'engagement'` payload that
-- `announce_chat_open` already sends — was rejected on the docs. That one lands
-- in `notifyEngagement` (Conversations.kt:248-290), which is a BigPictureStyle
-- on the separate `engagement` channel: not MessagingStyle, no Person, no
-- shortcut, therefore not a conversation notification, and on a channel the
-- user can silence without silencing real messages. A provider opening a thread
-- with a member is a 1:1 message event, and the docs name one correct style for
-- that.
--
-- The payload the two branches emit is identical in shape, so the member's
-- device needs no app release and no native work: a contact row renders as
-- "{provider} wants to have a chat with you" in the same MessagingStyle
-- transcript, which is the line `index.js` already passes for every message
-- push.
--
-- CALL CHANNELS ARE DELIBERATELY EXCLUDED, for the same reason. A provider
-- ringing a member is a call, and a call has its own compliant style —
-- `CallStyle.forIncomingCall` via 017 / `notifyCall`. Putting a call invitation
-- into MessagingStyle would be choosing the wrong documented style for the
-- event.
--
-- ---------------------------------------------------------------------------
-- CONSENT: A PROVIDER MUST NOT BE ABLE TO PUSH A MEMBER WHO REFUSED THEM
-- ---------------------------------------------------------------------------
-- Checked against the blocking tables rather than assumed. `public.blocks`
-- (005:37) is the only one, `public.is_blocked_pair` (005:65) is the symmetric
-- test over it, and the queue has never consulted either — it did not need to,
-- because `send_message` refuses a blocked pair before the row exists (077) and
-- `start_call` does the same (079). A session request has no such guard at the
-- queue, and `create_session_request` (077) does not check blocking at all, so
-- without this a blocked provider could ring a member's lock screen at will.
--
-- Two refusals are honoured, both on the contact branch:
--
--   `blocks`                                 either party blocked the other.
--   `conversations.chat_consent_declined_at` the member declined a paid chat in
--                                            this conversation. 086 made that
--                                            binding on the SERVER rather than
--                                            in the client's composer; pushing
--                                            "wants to have a chat with you" is
--                                            precisely re-asking the question
--                                            they answered.
--
-- The block test is also added to the MESSAGE branch, which is a small change
-- in existing behaviour and is stated rather than smuggled: a message sent
-- before a block, still sitting unnotified in the queue, would otherwise be
-- delivered to a lock screen after the block. The queue should not carry a push
-- the recipient has since refused. Such a row simply leaves the view and ages
-- out of the 24-hour window unnotified.
--
-- 068's other two rules are NOT duplicated here. The member's balance is
-- already enforced upstream — `create_session_request` refuses when the member
-- cannot cover a minute — and presence is 068's rule for a doorbell, not for an
-- addressed request.

-- ---------------------------------------------------------------------------
-- 1. The request learns whether it has been announced
-- ---------------------------------------------------------------------------
-- Same column, same name and same meaning as `messages.notified_at` (008) and
-- `calls.notified_at` (011), because it is the same fact and `mark_notified`
-- below stamps both from one call.
alter table public.session_requests
  add column if not exists notified_at timestamptz;

comment on column public.session_requests.notified_at is
  'Set by the push sender once the member has been told about a '
  'provider-initiated request (105). Mirrors messages.notified_at: separate '
  'from responded_at so an announced-but-unanswered request is not announced '
  'twice.';

-- The queue scan wants the pending, unannounced tail and nothing else. The
-- enum literal is cast explicitly because a partial-index predicate must be
-- immutable, and an uncast enum comparison is not.
create index if not exists session_requests_pending_push_idx
  on public.session_requests (created_at)
  where notified_at is null
    and status = 'pending'::public.session_request_status;

-- ---------------------------------------------------------------------------
-- 2. One definition of "blocked", reachable from the queue
-- ---------------------------------------------------------------------------
-- `pending_pushes` is `security_invoker = true`, so the EXECUTE check on any
-- function inside it runs against whoever is reading — service_role, or the
-- owner of `dispatch_pending_pushes`. 005 revoked `is_blocked_pair` from
-- `public` only, and on the hosted project Supabase's default privileges left
-- service_role holding EXECUTE anyway (verified: has_function_privilege(
-- 'service_role', ...) is true). The pgTAP harness creates its own bare
-- service_role (supabase/tests/harness.sql:15) with no such default, so the
-- grant is made explicit here to keep the two the same shape.
--
-- It discloses nothing new: service_role has BYPASSRLS and can already read
-- `public.blocks` outright. The alternative — inlining the EXISTS in the view —
-- would give this file a second, drifting copy of what "blocked" means.
grant execute on function public.is_blocked_pair(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The queue, now two sources and one shape
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: `create or replace view` can only
-- append columns and cannot change the body at all. 009 and 011 did the same
-- for the same reason. Nothing selects from this view except
-- `dispatch_pending_pushes` and the send-push function.
--
-- COLUMN NAMES AND ORDER ARE UNCHANGED, and `kind` is appended last. That is a
-- compatibility decision, not tidiness: the currently deployed send-push does
-- `select('*')` and reads fields by name, so this migration closes the gap on
-- its own, before the function is redeployed — a contact row is already in
-- exactly the shape that function sends. `message_id` keeps its name for the
-- same reason, and now means "the row that owes a push": a message id on the
-- message branch, a session_request id on the contact branch. They are uuids
-- from disjoint tables, so they cannot collide.
drop view if exists public.pending_pushes;

create view public.pending_pushes
with (security_invoker = true) as
  -- A message nobody has been told about. Unchanged from 015 except for the
  -- block test and `kind`.
  select
    m.id                as message_id,
    m.conversation_id,
    m.sender_id         as peer_id,
    t.token,
    t.platform,
    d.display_name      as sender_display_name,
    m.created_at,
    d.avatar_url        as sender_avatar_url,
    'message'::text     as kind
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.push_tokens t
    on t.user_id = case when m.sender_id = c.member_id then c.provider_id else c.member_id end
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
  -- the admitted providers — role, identity verified, not suspended — so a
  -- provider under review or under suspension cannot ring a member. It also
  -- supplies the two facts the payload carries, the stage name and the public
  -- photo.
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
    -- message's. Without it, MessagingStyle — which is cumulative by design —
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
-- relied on silently; stated here so the pgTAP harness — which has no default
-- privileges (supabase/tests/harness.sql) — ends up with the same view the
-- sender actually reads.
grant select on public.pending_pushes to service_role;

comment on view public.pending_pushes is
  'One row per (thing that owes a push, recipient device). Two sources since '
  '105: an undelivered message, and a provider-initiated chat request, which '
  'the member would otherwise only hear about if it happened to carry a '
  'message. Never exposes a message body: a notification says who is reaching '
  'you, not what they said. Both branches drop out for a blocked pair, and the '
  'contact branch also drops out once the member has declined a paid chat in '
  'that conversation (086). Service role only.';

-- ---------------------------------------------------------------------------
-- 4. Stamping, for both sources, from the one call the sender already makes
-- ---------------------------------------------------------------------------
-- The sender hands back the ids it settled; they are uuids from two disjoint
-- tables, so each UPDATE matches its own and ignores the other. Keeping the
-- signature and the argument name is what lets the currently deployed send-push
-- keep working unchanged.
create or replace function public.mark_notified(p_message_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with messages_touched as (
    update public.messages
    set    notified_at = now()
    where  id = any(p_message_ids) and notified_at is null
    returning 1
  ), requests_touched as (
    update public.session_requests
    set    notified_at = now()
    where  id = any(p_message_ids) and notified_at is null
    returning 1
  )
  select (select count(*) from messages_touched)::int
       + (select count(*) from requests_touched)::int;
$$;

-- `create or replace function` keeps the existing ACL, but the privileges are
-- the point of the function and are restated so this file can be read alone.
revoke all on function public.mark_notified(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_notified(uuid[]) to service_role;

comment on function public.mark_notified(uuid[]) is
  'Mark pushes delivered. 105: stamps messages.notified_at AND '
  'session_requests.notified_at, because pending_pushes now has both sources '
  'and the sender settles them in one list.';

-- ---------------------------------------------------------------------------
-- 5. At most one dispatch per transaction
-- ---------------------------------------------------------------------------
-- Needed before the new trigger can be added, not after.
--
-- 077's `send_message` inserts a session_request and then a message in one
-- transaction. With a trigger on each table, that is two `net.http_post` calls
-- and two send-push runs starting milliseconds apart — and send-push sends to
-- FCM BEFORE it calls `mark_notified`, so two concurrent runs can both read the
-- same pending row and send it twice. MessagingStyle is cumulative, so the
-- member would see the line twice in one transcript.
--
-- A transaction-local GUC is the whole fix: `is_local => true` makes the flag
-- live until commit and no longer, so the first trigger in a transaction
-- dispatches and any later one in the SAME transaction does not. pg_net queues
-- the request and sends it after commit, so the one dispatch still sees every
-- row the transaction wrote.
--
-- That it survives at all was measured rather than assumed, because a function
-- with a `SET` clause opens its own GUC nest level and pops it on return, which
-- is what discards `search_path` — and this function has a SET clause, is
-- SECURITY DEFINER, and is called from `notify_message_push()`, which is both
-- of those again. On postgres 16: the value is still readable after returning
-- through TWO such functions, and is gone after commit, so it dedupes within
-- the transaction and leaks into no later one on a pooled connection.
--
-- If the HTTP call itself raises, `notify_message_push`'s exception block rolls
-- its subtransaction back — the flag with it — so a later statement in the same
-- transaction is free to try again. That is the behaviour worth having.
--
-- This does not close the cron-versus-trigger overlap that 092 already accepted
-- — two SEPARATE transactions can still race — and it is not claimed to. It
-- closes the one this migration would otherwise create.
create or replace function public.dispatch_pending_pushes()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
  v_pending int;
begin
  -- 105. Already dispatched in this transaction; a second HTTP call would only
  -- race the first one to the same rows.
  if coalesce(current_setting('pappal.push_dispatched', true), '') = '1' then
    return;
  end if;

  -- Nothing to send is the common case, and it should cost one index scan
  -- rather than an HTTP request. The Edge Function is idempotent either way;
  -- this is about not paying for a cold start sixty times an hour for nothing.
  select count(*) into v_pending from public.pending_pushes limit 1;
  if v_pending = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_sender_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';

  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    -- Deliberately quiet: an unconfigured sender must not fill the logs once a
    -- minute forever. The absence of notifications is the symptom, and
    -- `select * from vault.decrypted_secrets` is the diagnosis.
    return;
  end if;

  -- Set only once the call is actually going out, so a run that bailed on an
  -- empty queue or an unset secret does not suppress a later statement in the
  -- same transaction that has something real to send.
  perform set_config('pappal.push_dispatched', '1', true);

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.dispatch_pending_pushes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The request fires the same dispatcher the message does
-- ---------------------------------------------------------------------------
-- `public.notify_message_push()` (092) is reused verbatim rather than copied or
-- renamed. It takes no arguments, names no table, and does exactly one thing:
-- drain the queue now, and never fail its own INSERT — the `to_regclass` guard
-- for the pgTAP harness that has no Vault, and the total exception handler,
-- because a swallowed notification is a late notification (the cron retries
-- within the minute) and a raised one is a lost row.
--
-- Renaming it to match its widened job would mean dropping and recreating a
-- live trigger on `public.messages` for a word. The comment is updated instead.
--
-- STATEMENT-level, matching 092: the dispatcher takes no arguments and drains
-- everything, so one call per statement is sufficient and a bulk insert does
-- not fan out into N HTTP requests.
drop trigger if exists session_request_push_on_insert on public.session_requests;
create trigger session_request_push_on_insert
  after insert on public.session_requests
  for each statement execute function public.notify_message_push();

comment on function public.notify_message_push() is
  '092/105. Fires dispatch_pending_pushes() as soon as a row that owes a push '
  'is inserted — a message (092) or a session request (105) — so a '
  'notification does not wait for the once-a-minute cron. Cannot fail its own '
  'INSERT: a notification is never worth a lost message or a lost request.';
