import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const call = withoutComments(read('src/screens/CallScreen.tsx'));
const cutover = read('supabase/migrations/037_session_cutover.sql');
const noop = read(
  'supabase/migrations/088_unanswered_message_refund_is_pre_cutover.sql',
);
const moderate = read('scripts/moderate.mjs');

/**
 * Two ways to charge a member for a call nobody was on, and neither is caught
 * by anything else in this suite.
 *
 * Both were found on 2026-09-08 while auditing "is a call correct from both
 * parties", and they are opposite mistakes: one client claiming MORE than it
 * has, and one server function refunding a charge that no longer exists. They
 * share a file because they share a failure mode — a number moving without a
 * real event behind it — and because both are invisible on a screen.
 */
describe('the lease tells the truth about media, because billing reads it', () => {
  /*
   * `claim_session_lease` is where a call's first minute is taken. The gate is
   * BOTH participants holding a lease of kind `connected`, and for a call that
   * kind is required rather than mere presence — so the word `connected`
   * leaving this client is a billing assertion, not a status label.
   */
  it('bills minute one only when both sides claim connected media', () => {
    const fn = cutover.slice(
      cutover.indexOf('create or replace function public.claim_session_lease'),
      cutover.indexOf('revoke all on function public.claim_session_lease'),
    );
    expect(fn).not.toBe('');
    // The stricter of the two counts: kind = 'connected', not just a heartbeat.
    expect(fn).toMatch(/v_both_media[\s\S]{0,200}kind = 'connected'/);
    // And a call (not chat) is gated on it before the first deduct.
    expect(fn).toMatch(
      /v_session\.channel = 'chat' or v_both_media[\s\S]{0,400}deduct_tokens/,
    );
    expect(fn).toMatch(/minutes_billed\s*=\s*1/);
  });

  it('claims connected from the media state, never unconditionally', () => {
    /*
     * THE DEFECT. This passed a bare `'connected'` from the moment a session id
     * existed. On the callee that id arrives from `answer_call` before any
     * media is up, so the device asserted connected media while still
     * negotiating — and the gate above believes it. Paired with a caller whose
     * media genuinely was up, that bills a minute the callee could not hear.
     *
     * The fix has to be a DERIVED kind, so the assertion cannot outrun the
     * fact. `connState === 'connected'` is `mediaReady`, set from Agora's
     * `onUserJoined` rather than from joining the edge.
     */
    const lease = call.slice(
      call.indexOf('useSessionLease('),
      call.indexOf('const enableVideoRef'),
    );
    expect(lease).not.toBe('');
    expect(lease).toMatch(
      /connState === 'connected' \? 'connected' : 'foreground'/,
    );
    // The bare form is the bug. It must not be what reaches the server.
    expect(lease).not.toMatch(/^\s*'connected',\s*$/m);
  });
});

describe('the unanswered-message refund is not revived by accident', () => {
  /*
   * `refund_unanswered_messages` (006) credits one token per unanswered member
   * message. That was right when a message cost a token. Migration 037 moved
   * chat to per-minute sessions and `send_message` debits nothing per message,
   * so the credit now refunds a charge that never happened — once per message.
   *
   * An audit that only checks "is it scheduled?" concludes it should be, which
   * is why the reasoning is pinned here as well as in 088's header.
   */
  it('still charges nothing per message, which is why the refund is wrong', () => {
    const sendMessage = read(
      'supabase/migrations/077_sp_initiate_member_consent.sql',
    ).slice(
      read('supabase/migrations/077_sp_initiate_member_consent.sql').indexOf(
        'create or replace function public.send_message',
      ),
    );
    expect(sendMessage).not.toBe('');
    expect(sendMessage).not.toMatch(/deduct_tokens/);
    expect(sendMessage).not.toMatch(/spend_chat_minute/);
  });

  it('is a no-op that returns zero', () => {
    const fn = noop.slice(
      noop.indexOf('create or replace function public.refund_unanswered_messages'),
    );
    expect(fn).toMatch(/return 0;/);
    // The paying lines from 006 are gone from the live definition.
    expect(fn).not.toMatch(/credit_user_token/);
    expect(fn).not.toMatch(/update public\.messages set refunded_at/);
  });

  it('is scheduled by no migration', () => {
    const dir = join(__dirname, '..', 'supabase', 'migrations');
    const scheduled = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .filter(f => {
        const body = readFileSync(join(dir, f), 'utf8');
        // A cron.schedule whose command mentions the function, in either order.
        return /cron\.schedule\([^;]{0,400}refund_unanswered_messages/.test(body);
      });
    expect(scheduled).toEqual([]);
  });

  it('is not called by the operator maintenance command', () => {
    const fn = moderate.slice(
      moderate.indexOf('async function maintenance()'),
      moderate.indexOf('const COMMANDS'),
    );
    expect(fn).not.toBe('');
    expect(withoutComments(fn)).not.toMatch(/rpc\('refund_unanswered_messages'\)/);
    // The rest of the command still does its work — this is a removal of one
    // call, not a quietly gutted maintenance path.
    expect(fn).toMatch(/rpc\('refresh_reply_latencies'\)/);
    expect(fn).toMatch(/rpc\('purge_orphaned_voice_notes'\)/);
  });
});
