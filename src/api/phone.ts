/**
 * Phone verification: proving a signed-in account holds a number.
 *
 * This is **not** sign-in. The session already exists (Google, per ADR-0004) and
 * nothing here creates or changes one. That distinction is the reason this path
 * can ship today while phone *login* cannot: login needs Supabase Auth to send
 * the SMS, which needs a DLT-approved template. The MSG91 widget verifies the
 * code itself and hands back a token, which is useless for minting a session and
 * exactly right for asserting "this account holds this number".
 *
 * ## The interface, and what it hides
 *
 * One hook. The screen gets `step`, `busy`, `error` and four verbs, and never
 * sees a request id, an access token, MSG91's prose, or the Edge Function. Those
 * are the parts worth hiding: `reqId` has to survive a resend, the access token
 * must reach `verify-phone` and be stored nowhere, and MSG91's error strings are
 * vendor English that must not reach a user.
 *
 * ## The one rule
 *
 * Never send a phone number to `verify-phone`. It asks MSG91 which number the
 * token belongs to and stamps that. If the client supplied the number, anyone
 * could verify a number they hold and submit somebody else's, and the unique
 * index in migration 010 would let them squat on it.
 */
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalisePhone } from '../lib/phone';
import { errorTick, tick } from '../lib/haptics';
import { track } from '../lib/telemetry';
import { retryOtp, sendOtp, verifyOtp, type WidgetFailure } from '../lib/msg91Widget';

/**
 * Off until `verifyAccessToken` is proven to work.
 *
 * `widgetConfigured()` is not enough on its own. The MSG91 client path is
 * verified end to end, but the server hop that actually records the number has
 * never returned success: it answers `AuthenticationFailure` (code 201) for both
 * documented request shapes. With the widget values present in a local `.env`,
 * `widgetConfigured()` is true, so without this flag Settings would offer a flow
 * that takes a correct code and then silently fails to record anything.
 *
 * **Still off after 2026-08-26, while `PHONE_AUTH_ENABLED` went on.** They are
 * not the same switch and the difference is worth stating, because turning both
 * together is the obvious mistake. `PHONE_AUTH_ENABLED` is phone SIGN-IN over
 * the Supabase send-SMS hook with Fast2SMS as carrier, and every secret that
 * path needs is now verifiably set on the project. This flag is the MSG91 WIDGET
 * path for attaching a number to an account that already has a session — a
 * different carrier, a different endpoint, and a different failure. The report
 * that the 201 was an IP block rather than a bad request is plausible and would
 * explain everything, but it is a report, not a green response from
 * `verifyAccessToken`, and this flag is the one thing standing between a correct
 * code and a number nobody recorded.
 *
 * Same reasoning as `PHONE_AUTH_ENABLED` used to carry, and the same lesson:
 * a button that accepts input and then fails is the Facebook mistake, and that
 * one shipped before it was caught. Flip to `true` in the commit that makes
 * `verifyAccessToken` succeed, not before. ADR-0009 §8.
 */
export const PHONE_VERIFY_ENABLED = false;

export type VerifyStep = 'number' | 'code' | 'verified';

/** Which control is spinning. `null` means none, so the field stays editable. */
export type VerifyBusy = 'sending' | 'confirming' | 'resending' | null;

/**
 * User-facing copy, decided here rather than in the screen.
 *
 * Every string names what to do next, because "verification failed" is a dead
 * end. `already-taken` is the only one that is not the user's mistake and it is
 * also the ban-evasion signal, so it says the specific thing.
 */
const COPY: Record<VerifyFailure, string> = {
  'not-configured': 'Phone verification is unavailable in this build.',
  network: 'No connection. Check your network and try again.',
  'wrong-code': 'That code is not right. Check it and try again.',
  expired: 'That code has expired. Send a new one.',
  'too-many': 'Too many attempts. Wait a few minutes before trying again.',
  rejected: 'That did not work. Try sending a new code.',
  'bad-number': 'That does not look like a complete number.',
  'already-taken': 'That number is already verified on another account.',
  'no-session': 'Sign in again, then verify your number.',
  server: 'Could not record that just now. Try again shortly.',
};

export type VerifyFailure =
  | WidgetFailure
  | 'bad-number'
  | 'already-taken'
  | 'no-session'
  | 'server';

/**
 * Posts the access token to `verify-phone`, which is the only thing that can
 * write the number. Returns null on success, a failure otherwise.
 */
async function recordVerification(accessToken: string): Promise<VerifyFailure | null> {
  const { data: session } = await supabase.auth.getSession();
  const bearer = session.session?.access_token;
  if (bearer === undefined) {
    return 'no-session';
  }
  const { error } = await supabase.functions.invoke('verify-phone', {
    body: { accessToken },
  });
  if (error == null) {
    return null;
  }
  // `FunctionsHttpError` carries the response; 409 is the unique-index
  // collision, which is the one failure with a real meaning to the user.
  const status = (error as { context?: { status?: number } }).context?.status;
  if (status === 409) {
    return 'already-taken';
  }
  return status === 400 ? 'rejected' : 'server';
}

export interface PhoneVerification {
  readonly step: VerifyStep;
  readonly busy: VerifyBusy;
  /** Already-resolved copy. The screen renders it and decides nothing. */
  readonly error: string | null;
  /** The number as MSG91 accepted it, for the "code sent to ..." line. */
  readonly identifier: string | null;
  /** `input` is whatever is in the text field; normalisation happens here. */
  readonly send: (input: string) => Promise<void>;
  readonly confirm: (code: string) => Promise<void>;
  readonly resend: () => Promise<void>;
  /** Back to the number step, e.g. "Change number". */
  readonly reset: () => void;
}

export function usePhoneVerification(): PhoneVerification {
  const [step, setStep] = useState<VerifyStep>('number');
  const [busy, setBusy] = useState<VerifyBusy>(null);
  const [failure, setFailure] = useState<VerifyFailure | null>(null);
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [reqId, setReqId] = useState<string | null>(null);

  const send = useCallback(async (input: string) => {
    const normalised = normalisePhone(input);
    if (normalised === null) {
      errorTick();
      setFailure('bad-number');
      return;
    }
    setBusy('sending');
    setFailure(null);
    const outcome = await sendOtp(normalised);
    setBusy(null);
    if (!outcome.ok) {
      errorTick();
      setFailure(outcome.reason);
      return;
    }
    tick();
    setIdentifier(normalised);
    setReqId(outcome.reqId);
    setStep('code');
  }, []);

  const confirm = useCallback(
    async (code: string) => {
      if (reqId === null) {
        setFailure('rejected');
        return;
      }
      setBusy('confirming');
      setFailure(null);
      const outcome = await verifyOtp(reqId, code);
      if (!outcome.ok) {
        setBusy(null);
        errorTick();
        setFailure(outcome.reason);
        return;
      }
      // MSG91 is satisfied; the number is not verified until our own server says
      // so, so the spinner stays up across both calls rather than flashing a
      // success the next line could retract.
      const problem = await recordVerification(outcome.accessToken);
      setBusy(null);
      if (problem !== null) {
        errorTick();
        setFailure(problem);
        return;
      }
      tick();
      /*
       * `identity_linked`, not a new `phone_verified` event.
       *
       * The event name is checked twice: a CHECK in migration 006's trigger and
       * a parity test against the TypeScript union. Adding a name means a
       * migration, and this is what `identity_linked` already means: an
       * identity was attached to an existing account. No number is attached as
       * a prop, and the trigger would reject it if one were.
       */
      track('identity_linked');
      setStep('verified');
    },
    [reqId],
  );

  const resend = useCallback(async () => {
    if (reqId === null) {
      return;
    }
    setBusy('resending');
    setFailure(null);
    const outcome = await retryOtp(reqId);
    setBusy(null);
    if (!outcome.ok) {
      errorTick();
      setFailure(outcome.reason);
      return;
    }
    tick();
  }, [reqId]);

  const reset = useCallback(() => {
    setStep('number');
    setFailure(null);
    setIdentifier(null);
    setReqId(null);
  }, []);

  return {
    step,
    busy,
    error: failure === null ? null : COPY[failure],
    identifier,
    send,
    confirm,
    resend,
    reset,
  };
}
