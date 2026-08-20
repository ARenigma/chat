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
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
