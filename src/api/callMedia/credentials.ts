import { supabase } from '../../lib/supabase';
import type { CallMediaCredentials } from './types';

/**
 * Fetches short-lived credentials only after the server verifies that the
 * signed-in user belongs to the live call. Vendor signing secrets never ship in
 * the APK.
 *
 * Agora: https://docs.agora.io/en/video-calling/develop/authentication-workflow
 * LiveKit: https://docs.livekit.io/home/get-started/authentication/
 * Cloudflare TURN:
 * https://developers.cloudflare.com/realtime/turn/generate-credentials/
 */
export async function getCallMediaCredentials(
  callId: string,
): Promise<CallMediaCredentials> {
  const { data, error } = await supabase.functions.invoke('call-media-token', {
    body: { call_id: callId },
  });
  if (error) {
    throw error;
  }
  const value = data as Partial<CallMediaCredentials> | null;
  if (
    value === null ||
    value.callId !== callId ||
    !['current', 'livekit', 'agora'].includes(value.backend ?? '')
  ) {
    throw new Error('Invalid call media credentials');
  }
  return value as CallMediaCredentials;
}
