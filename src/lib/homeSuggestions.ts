/**
 * State machine for the idle-home provider suggestion campaign.
 *
 * Fires when a member is idle on Home for 10 seconds; shows up to three
 * sequential "calling"-style prompts, one per 10 seconds. Each prompt shows
 * a different provider from the server-fetched batch. The machine cancels on
 * any navigation, background transition, active session, or real incoming call.
 *
 * Design choices confirmed by Amit (2026-09-20):
 *   - Three providers per campaign, no daily cap, no provider opt-in.
 *   - Copy says "{name} is calling" even though the provider did not initiate.
 *   - Accept → real provider connection request (announce_chat_open) + push.
 *   - Decline or 30-second provider timeout → member returns Home.
 *   - Feature flag: HOME_SUGGESTIONS_ENABLED in src/config.ts.
 */

export type CampaignState =
  | { phase: 'dormant' }
  | { phase: 'idle_wait' }
  | { phase: 'fetching' }
  | { phase: 'prompting'; promptIndex: number; secondsLeft: number }
  | { phase: 'connecting'; providerId: string }
  | { phase: 'cooldown' }
  | { phase: 'suppressed' };

export type CampaignEvent =
  | { type: 'HOME_MOUNT' }
  | { type: 'HOME_UNMOUNT' }
  | { type: 'APP_BACKGROUND' }
  | { type: 'APP_FOREGROUND' }
  | { type: 'IDLE_TIMER_FIRED' }
  | { type: 'SUGGESTIONS_READY'; count: number }
  | { type: 'SUGGESTIONS_EMPTY' }
  | { type: 'TICK' }  // 1-second tick while prompting
  | { type: 'PROMPT_EXPIRE' }
  | { type: 'MEMBER_ACCEPT' }
  | { type: 'MEMBER_DISMISS' }
  | { type: 'CONNECT_SUCCESS' }
  | { type: 'CONNECT_FAIL' }
  | { type: 'REAL_CALL_ARRIVED' }
  | { type: 'REAL_RING_ARRIVED' };

/** How long the member sees each prompt. Matches send-call TTL and ChatRingScreen. */
export const PROMPT_DURATION_S = 30;

/** Idle wait before the first prompt fires. */
export const IDLE_WAIT_MS = 10_000;

/** Gap between prompts. */
export const INTER_PROMPT_MS = 10_000;

export const INITIAL_STATE: CampaignState = { phase: 'dormant' };

/**
 * Pure state-transition function.  No side effects — everything that touches
 * timers, RPCs or navigation is the caller's responsibility, triggered by the
 * returned next state.
 */
export function transitionCampaign(
  state: CampaignState,
  event: CampaignEvent,
): CampaignState {
  switch (event.type) {
    case 'HOME_MOUNT':
      if (state.phase === 'dormant') return { phase: 'idle_wait' };
      return state;

    case 'HOME_UNMOUNT':
    case 'APP_BACKGROUND':
      return { phase: 'dormant' };

    case 'APP_FOREGROUND':
      // Only restart idle timer if we are dormant (was backgrounded).
      if (state.phase === 'dormant') return { phase: 'idle_wait' };
      return state;

    case 'REAL_CALL_ARRIVED':
    case 'REAL_RING_ARRIVED':
      // A real call takes priority; suppress the campaign for this visit.
      return { phase: 'suppressed' };

    case 'IDLE_TIMER_FIRED':
      if (state.phase === 'idle_wait') return { phase: 'fetching' };
      return state;

    case 'SUGGESTIONS_READY':
      if (state.phase === 'fetching' && event.count > 0) {
        return { phase: 'prompting', promptIndex: 0, secondsLeft: PROMPT_DURATION_S };
      }
      if (state.phase === 'fetching') return { phase: 'cooldown' };
      return state;

    case 'SUGGESTIONS_EMPTY':
      if (state.phase === 'fetching') return { phase: 'cooldown' };
      return state;

    case 'TICK':
      if (state.phase === 'prompting') {
        const next = state.secondsLeft - 1;
        return { ...state, secondsLeft: Math.max(0, next) };
      }
      return state;

    case 'PROMPT_EXPIRE': {
      if (state.phase !== 'prompting') return state;
      const nextIndex = state.promptIndex + 1;
      // Max 3 prompts (indices 0, 1, 2).
      if (nextIndex >= 3) return { phase: 'cooldown' };
      // More prompts in the batch — show the next after INTER_PROMPT_MS.
      // The caller starts the inter-prompt timer; we reset to idle_wait-like.
      return { phase: 'idle_wait' };
    }

    case 'MEMBER_DISMISS': {
      if (state.phase !== 'prompting') return state;
      const nextIndex = state.promptIndex + 1;
      if (nextIndex >= 3) return { phase: 'cooldown' };
      return { phase: 'idle_wait' };
    }

    case 'MEMBER_ACCEPT':
      if (state.phase === 'prompting') {
        return { phase: 'connecting', providerId: '' };
      }
      return state;

    case 'CONNECT_SUCCESS':
      return { phase: 'cooldown' };

    case 'CONNECT_FAIL':
      return { phase: 'cooldown' };

    default:
      return state;
  }
}
