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

import { AppRegistry, LogBox } from 'react-native';
import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { handleBackgroundPush } from './src/lib/push';
import { finishPendingSignOuts } from './src/api/auth';
import { declineFromNotification } from './src/lib/chatRequestDecline';

/*
 * LogBox's yellow chip docks over the welcome CTA and swallows Maestro / adb
 * taps on Continue (hierarchy still shows welcome-continue after a "successful"
 * tap). First-party InteractionManager usage is gone; residual RN/deps warnings
 * still paint the chip. Silence LogBox in __DEV__ so device QA and e2e can
 * drive the owned surface — Metro/terminal still show the warnings.
 * https://docs.maestro.dev/get-started/supported-platform/react-native
 */
if (__DEV__) {
  LogBox.ignoreAllLogs(true);
}

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
 *   - `kind: 'contact'` with a requestId → a MessagingStyle notification with
 *     Accept/Decline actions for a provider-initiated paid chat request (migration
 *     105 + notifyChatRequest). Falls back to a plain conversation notification
 *     when requestId is absent (older server build before send-push redeploy).
 *   - anything else → a MessagingStyle conversation notification for a real
 *     message. Its body is a warm line and never carries message text:
 *     content on a lock screen is a disclosure this product cannot make, given
 *     who the conversations are with.
 *
 * A push that arrives while the app is in the foreground never reaches this
 * handler; RNFirebase hands it to `onMessage` instead. The routing itself is
 * `handleBackgroundPush` in src/lib/push.ts, next to `onForegroundPush`, which
 * routes the last two kinds the same way, posting the same notification on the
 * in-app channel (a banner with no sound) and skipping the conversation on
 * screen. Both post nothing while no session is stored on the device, and this
 * one then retries any sign-out whose server half is still pending
 * (`finishPendingSignOuts`), since a headless context never mounts the boot
 * effect that otherwise does.
 */
setBackgroundMessageHandler(getMessaging(), remote =>
  handleBackgroundPush(remote, finishPendingSignOuts),
);

/*
 * The Decline button on a chat-request notification, run with or without the
 * app open (ChatRequestDeclineService starts React when it is not running).
 * At module scope for the same reason as the FCM handler above: a headless
 * context runs this file and mounts nothing, so a listener inside the tree is
 * never reached. The name is ChatRequestDeclineService.TASK.
 * https://reactnative.dev/docs/headless-js-android
 */
AppRegistry.registerHeadlessTask(
  'ChatRequestDecline',
  () => declineFromNotification,
);

AppRegistry.registerComponent(appName, () => App);
