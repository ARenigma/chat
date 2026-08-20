/**
 * The telemetry prop guard, kept dependency-free.
 *
 * Split out of `telemetry.ts` for the same reason `transcript.ts` is pure: that
 * module imports the Supabase client, which reaches AsyncStorage and therefore
 * native code, so a test of this logic would need a native mock to assert a
 * regular expression. The rule is the part worth testing; the network call is
 * not.
 */

/**
 * Mirrors the `guard_event_shape` trigger in migration 005. The server is the
 * real enforcement — this exists so a mistake surfaces in a test rather than as
 * a silent insert rejection nobody is watching.
 */
export const FORBIDDEN_PROP_KEY =
  /(body|message|content|text|detail|email|phone|name|token)/i;

/** Only primitives. An object would be a place for a message body to hide. */
export type EventProps = Record<string, string | number | boolean>;

export function propsAreSafe(props: EventProps): boolean {
  return !Object.keys(props).some(key => FORBIDDEN_PROP_KEY.test(key));
}
