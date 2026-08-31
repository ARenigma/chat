const MAX_TRANSFORM_PX = 2500;

function targetPixels(dp: number, pixelRatio: number): number {
  return Math.min(MAX_TRANSFORM_PX, Math.max(1, Math.round(dp * pixelRatio)));
}

/**
 * Ask Supabase Storage for the pixels the target can display, not the original.
 *
 * Android recommends decoding near the ImageView's physical dimensions because
 * larger bitmaps add memory and decode work without visible detail. Supabase's
 * transformation endpoint performs that reduction before network transfer.
 *
 * Non-Supabase and malformed URLs remain untouched: this helper must not invent
 * transformation semantics for an arbitrary CDN.
 *
 * https://developer.android.com/topic/performance/graphics/load-bitmap
 * https://supabase.com/docs/guides/storage/serving/image-transformations
 */
export function sizedStorageImageUri(
  uri: string,
  widthDp: number,
  heightDp: number,
  pixelRatio: number,
  quality = 80,
): string {
  const publicObject = '/storage/v1/object/public/';
  const signedObject = '/storage/v1/object/sign/';
  const publicRender = '/storage/v1/render/image/public/';
  const signedRender = '/storage/v1/render/image/sign/';

  let rendered = uri;
  if (uri.includes(publicObject)) {
    rendered = uri.replace(publicObject, publicRender);
  } else if (uri.includes(signedObject)) {
    rendered = uri.replace(signedObject, signedRender);
  } else if (!uri.includes(publicRender) && !uri.includes(signedRender)) {
    return uri;
  }

  const [path, ...queryParts] = rendered.split('?');
  const params = new URLSearchParams(queryParts.join('?'));
  params.set('width', String(targetPixels(widthDp, pixelRatio)));
  params.set('height', String(targetPixels(heightDp, pixelRatio)));
  params.set('resize', 'cover');
  params.set('quality', String(Math.min(100, Math.max(20, Math.round(quality)))));
  return `${path}?${params.toString()}`;
}
