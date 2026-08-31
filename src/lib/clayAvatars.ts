import type { ImageSourcePropType } from 'react-native';

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
