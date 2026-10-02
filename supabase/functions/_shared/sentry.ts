/**
 * Error capture for Edge Functions, the server half of the app's Sentry.
 *
 * Follows Supabase's guide (https://supabase.com/docs/guides/functions/examples/sentry-monitoring):
 * `npm:@sentry/deno`, `defaultIntegrations: false`, and an explicit scope per
 * request, because "Sentry Deno SDK currently do not support Deno.serve
 * instrumentation, which means that there is no scope separation between
 * requests". Errors only: without Deno.serve instrumentation there is no trace
 * to continue, so the app's incoming `sentry-trace` id is attached as a tag
 * instead, which is enough to find the device event a failure belongs to.
 *
 * No-op without SENTRY_DSN, so a function deploys and runs before the secret is
 * set. Never attaches the request body: payloads here carry message text,
 * phone numbers and payment details.
 */
import * as Sentry from 'npm:@sentry/deno@^8';

const dsn = Deno.env.get('SENTRY_DSN') ?? '';

if (dsn !== '') {
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    sendDefaultPii: false,
  });
}

/** The trace id from the app's `sentry-trace: <traceId>-<spanId>[-<sampled>]`. */
function incomingTraceId(request: Request): string | undefined {
  const header = request.headers.get('sentry-trace');
  const id = header?.split('-')[0];
  return id !== undefined && /^[0-9a-f]{32}$/.test(id) ? id : undefined;
}

/**
 * Wraps a `Deno.serve` handler: an exception thrown by it is captured in its
 * own scope (function name, execution id, region, app trace id) and rethrown,
 * so the runtime's own 500 behaviour is unchanged.
 */
export function withSentry(
  fn: string,
  handler: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (dsn !== '') {
        Sentry.withScope(scope => {
          scope.setTag('function', fn);
          scope.setTag('execution_id', Deno.env.get('SB_EXECUTION_ID') ?? 'unknown');
          scope.setTag('region', Deno.env.get('SB_REGION') ?? 'unknown');
          const trace = incomingTraceId(request);
          if (trace !== undefined) scope.setTag('app_trace_id', trace);
          Sentry.captureException(error);
        });
        await Sentry.flush(2000);
      }
      throw error;
    }
  };
}

/**
 * For a failure a function handles and answers itself (FCM refused every
 * token, a webhook signature did not match): reported without throwing.
 * `context` must be ids and codes only, never payload values.
 */
export async function reportEdgeFailure(
  fn: string,
  message: string,
  context: Record<string, string | number | boolean> = {},
): Promise<void> {
  if (dsn === '') return;
  Sentry.withScope(scope => {
    scope.setTag('function', fn);
    scope.setTag('execution_id', Deno.env.get('SB_EXECUTION_ID') ?? 'unknown');
    for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
    Sentry.captureMessage(`[${fn}] ${message}`, 'error');
  });
  await Sentry.flush(2000);
}
