/**
 * A thin wrapper around PermissionsAndroid that handles the NEVER_ASK_AGAIN
 * case at every permission site consistently.
 *
 * Android's permission model has three outcomes: GRANTED, DENIED (the user
 * can be asked again next time), and NEVER_ASK_AGAIN (they ticked "Don't ask
 * again" or were denied too many times — the system will no longer show the
 * dialog). Only the third one warrants UI: the second is silent because the
 * next explicit user action will trigger the prompt again naturally.
 */
import { Alert, Linking, PermissionsAndroid, Platform, type Rationale } from 'react-native';

export type PermissionOutcome = 'granted' | 'denied' | 'never_ask_again';

/**
 * Request an Android permission and return a typed outcome.
 *
 * On non-Android platforms always returns `'granted'` (iOS asks automatically
 * on first use via Info.plist; there is nothing to request here).
 */
export async function requestAndroidPermission(
  permission: string,
  rationale?: Rationale,
): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    return 'granted';
  }
  const result = await PermissionsAndroid.request(
    permission as Parameters<typeof PermissionsAndroid.request>[0],
    rationale,
  );
  if (result === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'never_ask_again';
  }
  return 'denied';
}

/**
 * Show a minimal Alert that offers to open Settings.
 *
 * Only called on NEVER_ASK_AGAIN — not on a plain denial, which can be
 * re-requested next time the user tries the feature again. The message should
 * name the feature that needs the permission so the user knows what to enable.
 */
export function alertPermissionBlocked(feature: string): void {
  Alert.alert(
    'Permission required',
    `${feature} was blocked. Open Settings to allow it.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => undefined); } },
    ],
  );
}
