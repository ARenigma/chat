import { NativeModules } from 'react-native';

/**
 * Recent photos for the attach panel's in-app strip.
 *
 * Thin wrapper over the native `RecentMedia` module. The interesting reasoning —
 * why this is PARTIAL access only, why READ_MEDIA_IMAGES is deliberately absent,
 * and why that means the strip only ever shows a user-chosen subset — lives in
 * `RecentMediaPackage.kt` and in the AndroidManifest comment beside the
 * permission. Read those before changing anything here.
 *
 * https://developer.android.com/about/versions/14/changes/partial-photo-video-access
 */

/**
 * `unsupported` is not a failure. It is Android 13 and below, where
 * READ_MEDIA_VISUAL_USER_SELECTED does not exist — the caller shows the Photos
 * tile alone, exactly as it did before this module existed.
 */
export type MediaAccess = 'granted' | 'denied' | 'unsupported';

export interface RecentPhoto {
  /** A `content://` URI. Pass straight to `<Image source={{ uri }} />`. */
  uri: string;
  width: number;
  height: number;
}

interface RecentMediaNative {
  getAccess(): Promise<MediaAccess>;
  requestAccess(): Promise<MediaAccess>;
  listRecent(limit: number): Promise<RecentPhoto[]>;
}

/*
 * Optional at the type level because the module is Android-only and absent in
 * Jest, where NativeModules is a bare object. Every export below degrades to the
 * no-access answer rather than throwing, so a test or a future platform renders
 * the panel without the strip instead of crashing it.
 */
const native = (NativeModules as { RecentMedia?: RecentMediaNative }).RecentMedia;

/**
 * Never cached, by instruction.
 *
 * The platform docs: "Don't store the permission state in a permanent way,
 * including SharedPreferences or DataStore. The stored state might not be in
 * sync with the actual state." A partial grant can also lapse on its own, so the
 * panel asks every time it opens.
 */
export async function mediaAccess(): Promise<MediaAccess> {
  return (await native?.getAccess()) ?? 'unsupported';
}

/**
 * Show the system photo-selection dialog. MUST come from a user gesture.
 *
 * Also the RE-selection path: calling this while already granted is how the user
 * adds more photos to the strip, which is why it does not short-circuit on an
 * existing grant.
 */
export async function requestMediaAccess(): Promise<MediaAccess> {
  return (await native?.requestAccess()) ?? 'unsupported';
}

/**
 * The newest photos the app can see. Empty is a valid, expected answer — a
 * denied grant, a lapsed one, or a user who selected nothing.
 */
export async function recentPhotos(limit: number): Promise<RecentPhoto[]> {
  return (await native?.listRecent(limit)) ?? [];
}
