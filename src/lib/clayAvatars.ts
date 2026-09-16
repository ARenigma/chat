import { PixelRatio, type ImageSourcePropType } from 'react-native';
import { sizedStorageImageUri } from './storageImage';

/** Allowlisted DiceBear clay seeds shipped as bundled PNGs. */
export const CLAY_SEEDS = [
  'ada',
  'bloom',
  'coral',
  'dusk',
  'ember',
  'fern',
  'glow',
  'haze',
  'iris',
  'jade',
  'kiwi',
  'luna',
] as const;

export type ClaySeed = (typeof CLAY_SEEDS)[number];

export const CLAY_IMAGES: Record<ClaySeed, ImageSourcePropType> = {
  ada: require('../../assets/avatars/clay/ada.png'),
  bloom: require('../../assets/avatars/clay/bloom.png'),
  coral: require('../../assets/avatars/clay/coral.png'),
  dusk: require('../../assets/avatars/clay/dusk.png'),
  ember: require('../../assets/avatars/clay/ember.png'),
  fern: require('../../assets/avatars/clay/fern.png'),
  glow: require('../../assets/avatars/clay/glow.png'),
  haze: require('../../assets/avatars/clay/haze.png'),
  iris: require('../../assets/avatars/clay/iris.png'),
  jade: require('../../assets/avatars/clay/jade.png'),
  kiwi: require('../../assets/avatars/clay/kiwi.png'),
  luna: require('../../assets/avatars/clay/luna.png'),
};

const CLAY_PREFIX = 'clay:';

export function isClayUri(uri: string | null | undefined): uri is string {
  return typeof uri === 'string' && uri.startsWith(CLAY_PREFIX);
}

export function claySource(uri: string): ImageSourcePropType | null {
  if (!isClayUri(uri)) {
    return null;
  }
  const seed = uri.slice(CLAY_PREFIX.length) as ClaySeed;
  return CLAY_IMAGES[seed] ?? null;
}

/**
 * Resolve avatar_url for `<Image source={…} />`.
 * Clay avatars use bundled PNGs; everything else stays a remote URI.
 */
export function resolveAvatarSource(
  uri: string | null | undefined,
): ImageSourcePropType | { uri: string } | null {
  if (uri == null || uri === '') {
    return null;
  }
  const local = claySource(uri);
  if (local !== null) {
    return local;
  }
  return { uri };
}

/**
 * The one resolver for an `avatar_url` on its way into `<Image source={…} />`.
 *
 * Every surface that reached for `sizedStorageImageUri` directly drew an empty
 * frame for every member, because a member's `avatar_url` is ALWAYS the
 * `clay:<seed>` sentinel — members have no photo upload path — and that string
 * is a bundled PNG, not a URL. This resolves the sentinel to its `require()` and
 * a real Storage object to a right-sized transform, so a call site cannot pick
 * only one of the two.
 *
 * Null means "there is no image": no avatar_url, or a seed outside the
 * allowlist. The caller renders its initial fallback.
 */
export function avatarImageSource(
  uri: string | null | undefined,
  widthDp: number,
  heightDp: number,
  quality?: number,
): ImageSourcePropType | null {
  if (uri == null || uri === '') {
    return null;
  }
  const local = claySource(uri);
  if (local !== null) {
    return local;
  }
  const sized = sizedStorageImageUri(
    uri,
    widthDp,
    heightDp,
    PixelRatio.get(),
    quality,
  );
  return sized === null ? null : { uri: sized };
}

/**
 * The DiceBear clay figure sits low-left in its source art, so a plain circular
 * crop cuts the face. Nudge it up and right and zoom slightly to centre it.
 *
 * Shared rather than re-derived per surface: Avatar and the call screen's 148pt
 * face frame the same twelve PNGs, and two copies of these three numbers drift.
 */
export function clayFraming(size: number) {
  return {
    transform: [
      { scale: 1.12 },
      { translateX: size * 0.03 },
      { translateY: -size * 0.04 },
    ],
  } as const;
}
