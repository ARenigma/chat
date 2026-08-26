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

import { AppRegistry } from 'react-native';
import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import {
  notifyConversation,
  readConversationPush,
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
 * The body is deliberately generic and does not come from the server. The view
 * the push is generated from carries no message text, and it should not: message
 * content on a lock screen is a disclosure this product cannot make, given who
 * the conversations are with.
 */
setBackgroundMessageHandler(getMessaging(), async remote => {
  const push = readConversationPush(remote.data);
  if (push === null) {
    return;
  }
  await notifyConversation(push, 'Sent you a message');
});

AppRegistry.registerComponent(appName, () => App);
