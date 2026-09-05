import { storage } from '../../lib/storage';

/**
 * Capture profile for the physical A/B matrix.
 *
 * The two-phone harness sets this before each run via
 * `companionchat://call-sim?resolution=hd|fhd`. Production never opens that
 * URI, so the default stays HD (720p) — the bitrate/CPU budget we already ship.
 * Full HD is an experiment arm only; it is not a product claim until the
 * report says the unit economics still clear.
 */
export type VideoResolution = 'hd' | 'fhd';

export interface VideoCaptureProfile {
  resolution: VideoResolution;
  width: number;
  height: number;
  maxBitrate: number;
  maxFramerate: number;
}

const KEY = 'call_media.video_resolution';

const PROFILES: Record<VideoResolution, VideoCaptureProfile> = {
  hd: {
    resolution: 'hd',
    width: 1280,
    height: 720,
    maxBitrate: 1_500_000,
    maxFramerate: 24,
  },
  fhd: {
    resolution: 'fhd',
    width: 1920,
    height: 1080,
    maxBitrate: 2_500_000,
    maxFramerate: 24,
  },
};

export function parseVideoResolution(
  value: string | null | undefined,
): VideoResolution | null {
  if (value === 'hd' || value === 'fhd') return value;
  return null;
}

export function setVideoResolution(resolution: VideoResolution): void {
  storage.set(KEY, resolution);
}

export function getVideoCaptureProfile(): VideoCaptureProfile {
  const stored = parseVideoResolution(storage.get(KEY));
  return PROFILES[stored ?? 'hd'];
}
