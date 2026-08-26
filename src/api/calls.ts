/**
 * Calls: the flag, and nothing else yet.
 *
 * Migration 011 shipped the whole server half, `start_call`, `answer_call`,
 * `heartbeat_call`, `end_call`, the per-minute meter, the one-live-call indexes,
 * the blocking and suspension gates, and `pending_call_pushes` for ringing a
 * sleeping phone. All of it is real and all of it is tested in
 * `supabase/tests/100_calls_and_metering.sql`.
 *
 * What does not exist is the client half: there is no WebRTC dependency, no
 * signalling channel, no media surface and no in-call screen. So `start_call`
 * would succeed, the callee's row would go to `ringing`, the ticker would mark it
 * `missed` forty-five seconds later, and neither person would ever have heard
 * anything. That is worse than a button that is visibly off.
 */

/**
 * Off until there is a media layer behind it.
 *
 * The chat header renders the phone and video glyphs regardless, at the disabled
 * opacity and with `accessibilityState={{ disabled: true }}`, because the two
 * affordances are load-bearing in the restyle's header layout and hiding them
 * would mean the header changes shape on the commit that turns calling on. What
 * they must not do is dial.
 *
 * Same reasoning as `PHONE_VERIFY_ENABLED` in src/api/phone.ts and
 * `PHONE_AUTH_ENABLED` in src/api/auth.ts, and the same lesson behind all three:
 * a control that accepts a tap and then silently fails is the mistake that
 * shipped once already. Flip this in the commit that lands the media path, not
 * before.
 *
 * When it flips, four things have to be true at once and they are worth writing
 * down here because none of them is in the schema: the member must hold
 * `call_minimum_minutes()` worth of balance before the phone rings, blocking must
 * gate a call exactly as it gates a message (it does, server-side, in both
 * `start_call` and every tick of `meter_active_calls`), nothing may be recorded,
 * and either party may initiate.
 */
export const CALLS_ENABLED = false;
