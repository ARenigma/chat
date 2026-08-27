/**
 * @format
 */

// Must precede any Supabase import: gotrue-js builds request URLs with the
// WHATWG URL API, which Hermes does not ship.
import 'react-native-url-polyfill/auto';

// Also before Supabase, and for a sharper reason: without WebCrypto, auth-js
// generates the PKCE verifier with Math.random() and sends it unhashed as the
// challenge. See src/lib/webcrypto.ts.
import './src/lib/webcrypto';

// WebRTC globals (navigator.mediaDevices, RTCPeerConnection, …) for audio
// calling. Registered at module scope so they exist before any call code runs.
import { registerGlobals } from 'react-native-webrtc';
registerGlobals();

import { AppRegistry } from 'react-native';
import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import {
  notifyCall,
  notifyConversation,
  notifyEngagement,
  readCallPush,
  readConversationPush,
  readEngagementPush,
} from './src/lib/conversations';

/*
 * The FCM background handler, registered at module scope.
 *
 * It has to be here rather than inside a component, and outside the React tree
 * entirely: when a data-only message arrives with the app killed, React Native
 * starts a headless JS context that runs this file and nothing else. A handler
 * registered in a `useEffect` would never be reached, and the message would be
 * silently dropped with no error anywhere.
 *
 * **This exists because the payload is data-only.** A payload with a
 * `notification` block is rendered by the system and never reaches JavaScript,
 * which also means it can never be a conversation notification — `MessagingStyle`,
 * `Person` and the long-lived shortcut all have to be assembled by the app. See
 * `android/app/src/main/java/com/companionchat/Conversations.kt`.
 *
 * Three notification types are routed here (Amit, 2026-08-27):
 *   - `kind: 'call'` → a CallStyle incoming-call notification that rings as a
 *     branded heads-up popup (not a full-screen takeover — Amit, 2026-08-27).
 *   - `kind: 'engagement'` → a BigPicture re-engagement nudge (an SP photo plus a
 *     call to action), for when there is no real message.
 *   - anything else → a MessagingStyle conversation notification for a real
 *     message. Its body is deliberately generic and never carries message text:
 *     content on a lock screen is a disclosure this product cannot make, given
 *     who the conversations are with.
 */
setBackgroundMessageHandler(getMessaging(), async remote => {
  const call = readCallPush(remote.data);
  if (call !== null) {
    await notifyCall(call);
    return;
  }
  const nudge = readEngagementPush(remote.data);
  if (nudge !== null) {
    await notifyEngagement(nudge);
    return;
  }
  const push = readConversationPush(remote.data);
  if (push === null) {
    return;
  }
  await notifyConversation(push, 'Sent you a message');
});

AppRegistry.registerComponent(appName, () => App);
