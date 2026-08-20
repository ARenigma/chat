import EventSource from 'react-native-sse';
import { ENV } from '../lib/env';
import { FUNCTIONS_URL, supabase } from '../lib/supabase';
import type {
  StreamChatRequest,
  StreamErrorCode,
} from '../../supabase/functions/_shared/protocol';

/**
 * The streaming read path.
 *
 * Two things make this jitter-free:
 *   1. Deltas are accumulated into a local string and published to the store at
 *      most once per frame (`requestAnimationFrame`). A fast model emits 30-60
 *      deltas a second; without batching that is 60 React commits a second, all
 *      of them dropped frames on a mid-range Android device.
 *   2. Only the cumulative text is published — never an array — so the single
 *      subscribing component re-renders and the transcript's `FlatList` keeps a
 *      byte-identical `data` prop and does no work at all while streaming.
 *
 * `pollingInterval: 0` disables EventSource's automatic reconnect: a chat
 * completion is a one-shot, and a silent retry would debit a second token.
 */

type CustomEvent = 'balance' | 'chunk' | 'end' | 'stream_error';

export interface StreamHandlers {
  /** Authoritative post-debit balance, straight from the atomic RPC. */
  onBalance: (balance: number) => void;
  /** Cumulative text, frame-batched. */
  onText: (text: string) => void;
  /** Final text; the assistant row is already persisted server-side. */
  onDone: (text: string) => void;
  onError: (code: StreamErrorCode) => void;
}

export interface StreamHandle {
  cancel: () => void;
}

function codeForStatus(status: number): StreamErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 402:
      return 'INSUFFICIENT_TOKENS';
    default:
      return 'UPSTREAM_FAILED';
  }
}

function parsePayload<T>(data: string | null): T | null {
  if (data === null) {
    return null;
  }
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function streamChat(
  request: StreamChatRequest,
  handlers: StreamHandlers,
): Promise<StreamHandle> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    handlers.onError('UNAUTHORIZED');
    return { cancel: () => {} };
  }

  const source = new EventSource<CustomEvent>(`${FUNCTIONS_URL}/stream-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ENV.supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    pollingInterval: 0,
    timeout: 60_000,
    timeoutBeforeConnection: 0,
  });

  let text = '';
  let settled = false;
  let frameQueued = false;

  const publish = (): void => {
    if (frameQueued) {
      return;
    }
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      if (!settled) {
        handlers.onText(text);
      }
    });
  };

  const settle = (run: () => void): void => {
    if (settled) {
      return;
    }
    settled = true;
    source.removeAllEventListeners();
    source.close();
    run();
  };

  source.addEventListener('balance', event => {
    const payload = parsePayload<{ balance: number }>(event.data);
    if (payload && typeof payload.balance === 'number') {
      handlers.onBalance(payload.balance);
    }
  });

  source.addEventListener('chunk', event => {
    const payload = parsePayload<{ text: string }>(event.data);
    if (payload && typeof payload.text === 'string') {
      text += payload.text;
      publish();
    }
  });

  source.addEventListener('end', () => {
    settle(() => handlers.onDone(text));
  });

  source.addEventListener('stream_error', event => {
    const payload = parsePayload<{ code: StreamErrorCode }>(event.data);
    settle(() => handlers.onError(payload?.code ?? 'UPSTREAM_FAILED'));
  });

  source.addEventListener('error', event => {
    // Transport-level: non-2xx response, socket failure, or timeout.
    const status = event.type === 'error' ? event.xhrStatus : 0;
    settle(() => handlers.onError(status > 0 ? codeForStatus(status) : 'UPSTREAM_FAILED'));
  });

  return {
    cancel: () => settle(() => {}),
  };
}
