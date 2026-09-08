import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const call = withoutComments(read('src/screens/CallScreen.tsx'));
const agora = withoutComments(read('src/api/callMedia/agora.ts'));
const mediaTypes = withoutComments(read('src/api/callMedia/types.ts'));
const app = withoutComments(read('App.tsx'));
const sessions = withoutComments(read('src/api/sessions.ts'));
const conversations = withoutComments(
  read('android/app/src/main/java/com/companionchat/Conversations.kt'),
);
const receiver = read(
  'android/app/src/main/java/com/companionchat/CallActionReceiver.kt',
);

/**
 * Five defects found by two people on two phones, 2026-09-08, and not one of
 * them was visible to this suite beforehand.
 *
 * They share a shape worth naming: in every case a control EXISTED, rendered,
 * responded to touch, and did nothing. A button that lights up and moves no
 * hardware is worse than a missing button, because the user blames themselves
 * and tries again. So these tests assert the wiring reaches the thing that
 * actually acts — the SDK, the RPC, the intent — rather than that a handler is
 * present.
 */
describe('the speaker button moves the audio route', () => {
  it('asks the SDK rather than toggling a local boolean', () => {
    /*
     * THE DEFECT. CallScreen owned `const [speakerOn, setSpeakerOn] =
     * useState(false)` and the button was `onPress={() => setSpeakerOn(v => !v)}`.
     * The pill lit up; audio kept coming out of the earpiece. The comment above
     * it admitted as much: "audio-route wiring is a follow-up (no InCallManager
     * yet)".
     */
    expect(agora).toMatch(/setEnableSpeakerphone\(on\)/);
    // The route is the session's, not the screen's — an external headset
    // overrides it, so a screen-local boolean would misreport what is audible.
    expect(mediaTypes).toMatch(/speakerOn: boolean/);
    expect(mediaTypes).toMatch(/setSpeaker: \(on: boolean\) => void/);
    // And the screen must no longer keep its own copy.
    expect(call).not.toMatch(/useState\(false\)[^\n]*\n?[^\n]*speakerOn/);
    expect(call).not.toMatch(/setSpeakerOn/);
    expect(call).toMatch(/onPress=\{\(\) => setSpeaker\(!speakerOn\)\}/);
  });

  it('does not claim a route the SDK refused', () => {
    // setEnableSpeakerphone returns < 0 on failure. Lighting the pill anyway
    // would be the original bug with extra steps.
    expect(agora).toMatch(/< 0\) return;\s*\n\s*setSpeakerOn\(on\)/);
  });

  it('starts a video call on the speaker and a voice call on the earpiece', () => {
    expect(agora).toMatch(/setDefaultAudioRouteToSpeakerphone\(defaultSpeakerRef\.current\)/);
    expect(call).toMatch(/useCallSession\(callId, direction === 'out', enabled, medium === 'video'\)/);
  });

  it('leaves setRouteInCommunicationMode alone', () => {
    // Agora's own docs: using it together with setEnableSpeakerphone "may cause
    // conflicts". Picking one is the requirement; this pins which.
    expect(agora).not.toMatch(/setRouteInCommunicationMode/);
  });
});

describe('the call notification carries what the app needs to obey it', () => {
  it('sends the medium, so answering a video call opens a video call', () => {
    /*
     * THE DEFECT. `callActionIntent` built
     * `companionchat://call/$peerId?callId=$callId&action=$action` with no
     * `medium`, and App.tsx defaults a missing `medium` to 'voice'. So every
     * video call answered from the notification opened a voice screen — silently,
     * because 'voice' is a legitimate value and nothing could tell it was a
     * fallback. A comment in App.tsx claimed this was already fixed.
     */
    expect(conversations).toMatch(/medium: String,/);
    expect(conversations).toMatch(/action=\$action&medium=\$medium/);
    // Both buttons and the body tap (which reuses `answer`) must carry it.
    expect(conversations).toMatch(/callActionIntent\(context, peerId, callId, "answer", medium\)/);
    expect(conversations).toMatch(/callActionIntent\(context, peerId, callId, "decline", medium\)/);
  });

  it('honours action=decline instead of opening a call screen', () => {
    /*
     * THE DEFECT. `action` appeared only in App.tsx's comment. Declining from
     * the notification opened the full incoming-call screen — the loudest
     * possible answer to "no" — and left the caller ringing until the 30s sweep
     * recorded it as missed rather than declined.
     */
    expect(app).toMatch(/const action = qs\.match\(\/action=\(\[\^&\]\+\)\/\)/);
    const branch = app.slice(app.indexOf("if (action === 'decline')"));
    expect(branch.slice(0, 120)).toMatch(/void endCall\(callId\);\s*\n\s*return;/);
    // Answering still routes into the screen, which owns the lease and media.
    expect(app).toMatch(/setRoute\(\{ name: 'call', providerId: callPeer, direction: 'in', callId, medium \}\)/);
  });

  it('listens for every action the native receiver emits', () => {
    /*
     * THE DEFECT. CallActionReceiver emits four actions; CallScreen handled two.
     * The notification's Answer and Decline buttons did nothing at all when the
     * app was already running.
     */
    const emitted = [...receiver.matchAll(/emitToRN\(context, "callAction", "(\w+)"\)/g)].map(
      m => m[1],
    );
    expect(emitted.sort()).toEqual(['answer', 'decline', 'hangUp']);
    for (const action of emitted) {
      expect(call).toContain(`'${action}'`);
    }
    // Answering twice would fire a second answer_call and re-claim a held lease.
    expect(call).toMatch(/action === 'answer' && phaseRef\.current === 'ringing'/);
  });
});

describe('the wallet follows the money', () => {
  it('refreshes the balance on every billed minute of a chat session', () => {
    /*
     * THE DEFECT. `useProfile` has a 15s staleTime, no refetchInterval, and
     * `refetchOnWindowFocus` is off globally — and no realtime channel subscribed
     * to `profiles`. The balance was fetched once on mount and frozen for the
     * whole session. Amit, from a device: "Wallet not updating not after session".
     *
     * The fix rides an event that already exists: meter_active_sessions writes
     * minutes_billed back to paid_sessions in the same transaction as the debit,
     * and this channel already listens to that table. So the number moves when
     * money moves, with no added polling.
     */
    const invalidate = sessions.slice(
      sessions.indexOf('const invalidate = () => {'),
      sessions.indexOf('const channel = supabase'),
    );
    expect(invalidate).not.toBe('');
    expect(invalidate).toMatch(/queryKey: \['profile'\]/);
  });

  it('refreshes it when a call ends, which has no such channel', () => {
    // useSessionRealtime is keyed by conversation and lives in ChatScreen, so a
    // call never receives the per-minute invalidation above.
    const finish = call.slice(call.indexOf('const finish = useCallback'));
    expect(finish.slice(0, 400)).toMatch(/queryKey: \['profile'\]/);
  });
});
