/**
 * The wire contract for `POST /functions/v1/stream-chat`.
 * Imported by the Edge Function and by the client's stream reader, so a
 * protocol change cannot compile on one side only.
 */

export interface StreamChatRequest {
  readonly chatId: string;
  readonly personaId: string;
  readonly message: string;
}

/** `event: balance` — emitted once, before the first token. */
export interface BalanceEvent {
  readonly balance: number;
}

/** `event: chunk` — emitted per upstream delta. */
export interface ChunkEvent {
  readonly text: string;
}

/**
 * `event: stream_error` — terminal; the debited token has already been
 * refunded. Named `stream_error` rather than `error` because `error` is a
 * reserved transport event in every EventSource implementation, and a
 * server-sent frame with that name is indistinguishable from a socket failure.
 */
export interface StreamErrorEvent {
  readonly code: StreamErrorCode;
}

export type StreamErrorCode =
  | 'INSUFFICIENT_TOKENS'
  | 'UPSTREAM_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INTERNAL';

export const SSE_EVENTS = ['balance', 'chunk', 'end', 'stream_error'] as const;
export type SSEEventName = (typeof SSE_EVENTS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
