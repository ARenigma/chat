/**
 * First-party telemetry.
 *
 * No third-party analytics SDK, and that is a constraint rather than a
 * preference: the manifest gate permits exactly INTERNET and VIBRATE, and the
 * Play data-safety declaration says no advertising id and no analytics SDK.
 * Adding Firebase Analytics or PostHog would make both statements false and
 * would very likely add a permission through manifest merging. A table we own
 * costs nothing and keeps the claim true.
 *
 * Three rules, all enforced server-side by `guard_event_shape` rather than
 * trusted here, because the client is the least trustworthy place to enforce
 * anything:
 *
 *   1. the event name must be on the allowlist
 *   2. props must not carry anything that looks like content or an identifier
 *   3. props must be small
 *
 * `record` is fire-and-forget and never throws. Telemetry that can break a send
 * is worse than no telemetry.
 */
import { supabase } from './supabase';
import type { TelemetryEvent } from './database.types';
import { propsAreSafe, type EventProps } from './telemetryGuard';

export { propsAreSafe } from './telemetryGuard';
export type { EventProps } from './telemetryGuard';

export async function record(
  name: TelemetryEvent,
  props: EventProps = {},
): Promise<void> {
  try {
    if (!propsAreSafe(props)) {
      // Deliberately dropped rather than sent and rejected: the point is that
      // this data never leaves the device.
      if (__DEV__) {
        console.warn(`telemetry: dropped "${name}" — unsafe prop key`);
      }
      return;
    }

    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (userId === undefined) {
      return;
    }

    await supabase.from('events').insert({ user_id: userId, name, props });
  } catch {
    // Never surface a telemetry failure to the caller.
  }
}

/** Convenience for the common `void record(...)` call site. */
export function track(name: TelemetryEvent, props: EventProps = {}): void {
  void record(name, props);
}
