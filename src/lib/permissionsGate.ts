import { PermissionsAndroid, Platform } from 'react-native';
import type { IconName } from '../components/Icon';
import { requestAndroidPermission } from './permissions';

/**
 * The permissions Pappal explains before Home, and the arithmetic of "asked".
 *
 * ADR-0026. Pappal is calls and chats with a real person; every path from Home
 * ends in a microphone (a call, a voice note), and video calls need a camera.
 * Notifications improve reachability but are an opt-in, not a condition of
 * using Home. The
 * app used to fire three bare system dialogs over Home the moment it opened,
 * with no word about why — and a "Deny" there, twice, is permanent. So the ask
 * moved to one screen, before Home, that names each permission with its reason
 * (Amit, 2026-09-05, goal item 15: "permissions screen before home, all
 * mandatory").
 *
 * This module is the list and the two async steps; the screen is the words.
 *
 * Where this departs from developer.android.com and why (also in the ADR):
 *   - The docs say ask in context and never wall the app. The product decision
 *     is that Home IS the context — there is nothing to do there that does not
 *     need these — and the cancel the docs insist on is Sign out, not a Home
 *     without calls.
 *   - The docs' "educational UI" is exactly this screen, so requests carry NO
 *     `rationale` object: PermissionsAndroid would show a second explanation in
 *     an Alert on top of the one the screen already gave.
 *   - Requests are awaited strictly one at a time. Android drops a permission
 *     request while another dialog is pending; two at once returned the second
 *     as denied without ever showing it (App.tsx, 2026-08).
 * https://developer.android.com/training/permissions/requesting
 * https://developer.android.com/develop/ui/views/notifications/notification-permission
 */

export type GateKind = 'microphone' | 'camera' | 'notifications';

export interface GatePermission {
  kind: GateKind;
  permission: string;
  title: string;
  reason: string;
  icon: IconName;
  /** Whether denial prevents the boot machine from entering Home. */
  required: boolean;
  /** Below this API level the permission is not a runtime one and counts as granted. */
  minApi: number;
}

export const GATE_PERMISSIONS: readonly GatePermission[] = [
  {
    kind: 'microphone',
    permission: 'android.permission.RECORD_AUDIO',
    title: 'Microphone',
    reason: 'Voice calls and voice notes. Nothing is recorded until you press record.',
    icon: 'mic',
    required: true,
    minApi: 23,
  },
  {
    kind: 'camera',
    permission: 'android.permission.CAMERA',
    title: 'Camera',
    reason: 'Video calls, and the photos you choose to send.',
    icon: 'camera',
    required: true,
    minApi: 23,
  },
  {
    // A runtime permission only from Android 13; the manifest declares it, so
    // below 33 checkSelfPermission reports it granted and this never prompts.
    kind: 'notifications',
    permission: 'android.permission.POST_NOTIFICATIONS',
    title: 'Notifications',
    reason: 'So a reply or an incoming call reaches you when Pappal is closed.',
    icon: 'chat',
    required: false,
    minApi: 33,
  },
];

/**
 * `blocked` is a permanent denial (the second "Deny", or "Don't ask again"):
 * the system will not show the dialog again and only Settings can grant it.
 */
export type GateStatus = 'granted' | 'denied' | 'blocked';
export type GateStatuses = Record<GateKind, GateStatus>;

/** Whether this device will ever be asked for this permission. */
export function appliesOnThisDevice(
  p: GatePermission,
  apiLevel: number = Number(Platform.Version),
  os: string = Platform.OS,
): boolean {
  return os === 'android' && apiLevel >= p.minApi;
}

/** Every required permission that applies here is granted. */
export function gateSatisfied(
  statuses: Partial<GateStatuses>,
  apiLevel: number = Number(Platform.Version),
  os: string = Platform.OS,
): boolean {
  return GATE_PERMISSIONS.every(
    p =>
      !p.required ||
      !appliesOnThisDevice(p, apiLevel, os) ||
      statuses[p.kind] === 'granted',
  );
}

/** Which permissions still need asking, in the order they will be asked. */
export function outstanding(
  statuses: Partial<GateStatuses>,
  apiLevel: number = Number(Platform.Version),
  os: string = Platform.OS,
): GatePermission[] {
  return GATE_PERMISSIONS.filter(
    p => appliesOnThisDevice(p, apiLevel, os) && statuses[p.kind] !== 'granted',
  );
}

/**
 * The current grants, without prompting. `check` cannot tell a plain denial
 * from a permanent one, so anything not granted reads `denied` here; the
 * screen keeps a `blocked` it learnt from a request until a check says granted.
 */
export async function checkGate(): Promise<GateStatuses> {
  const result: GateStatuses = { microphone: 'granted', camera: 'granted', notifications: 'granted' };
  for (const p of GATE_PERMISSIONS) {
    if (!appliesOnThisDevice(p)) {
      continue;
    }
    const granted = await PermissionsAndroid.check(
      p.permission as Parameters<typeof PermissionsAndroid.check>[0],
    );
    result[p.kind] = granted ? 'granted' : 'denied';
  }
  return result;
}

/**
 * Ask for everything outstanding, one dialog at a time, reporting each answer
 * as it lands so the screen can update the row before the next dialog opens.
 * No rationale object — the screen already said why.
 */
export async function requestGate(
  current: GateStatuses,
  onStatus: (kind: GateKind, status: GateStatus) => void,
): Promise<GateStatuses> {
  const next: GateStatuses = { ...current };
  for (const p of outstanding(current)) {
    const outcome = await requestAndroidPermission(p.permission);
    const status: GateStatus =
      outcome === 'granted' ? 'granted' : outcome === 'never_ask_again' ? 'blocked' : 'denied';
    next[p.kind] = status;
    onStatus(p.kind, status);
  }
  return next;
}
