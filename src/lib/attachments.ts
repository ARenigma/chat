/**
 * Image attachments, the pure half.
 *
 * The exact mirror of `lib/voice.ts` for photos: path shape, the client-side
 * check of the server's scope constraint, and the reader that turns a row into a
 * renderable image or null. Kept dependency-free (no native picker, no storage
 * client) so a type-only import never drags a native module into a jest graph.
 *
 * Every bound here mirrors migration 014: the path regex is `attachment_path_is_scoped`,
 * the extensions are the bucket's `allowed_mime_types`, and the size ceiling is
 * its `file_size_limit`.
 */
import type { Message } from './database.types';

/** The bucket's `file_size_limit`. A pick larger than this is refused before upload. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The maximum number of photos returned in one gallery launch.
 *
 * Android routes `selectionLimit > 1` through `PickMultipleVisualMedia`, the
 * system Photo Picker with multi-select support, which needs no extra permission
 * (`react-native-image-picker` v7.x android/ImagePickerModuleImpl.java:154).
 * Each selected asset goes through the same validation path as a single pick and
 * costs one token per send. Ten matches the WhatsApp per-pick ceiling without
 * requiring a bulk-send contract this product does not have.
 */
export const MAX_PICK = 10;

/**
 * The longest edge a picked or captured photo is allowed to keep, passed as
 * `maxWidth`/`maxHeight` to both `launchImageLibrary` and `launchCamera`.
 *
 * Before this bound (2026-09-17 audit), the picker was called with only
 * `quality: 0.9` and no size limit at all. react-native-image-picker's own
 * Android source makes what that combination means concrete:
 * `Utils.getImageDimensBasedOnConstraints` returns the ORIGINAL dimensions
 * whenever either bound is 0 (`android/src/main/java/com/imagepicker/Utils.java:265-267`),
 * while `shouldResizeImage` still returns true whenever `quality != 100`
 * (`Utils.java:293`) — so every photo was being RE-ENCODED at full capture
 * resolution rather than downscaled, sending a modern 12MP photo out at
 * several megabytes on a connection this product cannot assume clears that
 * in any bounded time.
 *
 * 1280 is not a guess: it is Telegram's own figure for exactly this
 * decision (`AndroidUtilities.java:3019-3030`, `photoSize = 1280`), and
 * `SendMessagesHelper.java:9194-9208` downscales to it before every send.
 */
export const PHOTO_MAX_DIMENSION = 1280;

/** The three formats the bucket accepts, MIME -> extension. */
const EXT_BY_MIME: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** The upload content type for a stored key, from its extension. Defaults to JPEG. */
export function attachmentMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

/**
 * The extension for a picked image, from its reported MIME. Defaults to `jpg`:
 * the picker occasionally returns a null type for a camera capture, and JPEG is
 * what the camera writes.
 */
export function attachmentExt(mime: string | null | undefined): 'jpg' | 'png' | 'webp' {
  return (mime && EXT_BY_MIME[mime.toLowerCase()]) || 'jpg';
}

/**
 * The object key for a photo, the access-control boundary rather than a folder:
 * `attachment_path_is_scoped` pins the whole string, `send_message` refuses a
 * path whose first segment is not the conversation, and the Storage policy
 * authorises a read on that same first segment.
 */
export function attachmentObjectPath(
  conversationId: string,
  objectId: string,
  ext: 'jpg' | 'png' | 'webp',
): string {
  return `${conversationId}/${objectId}.${ext}`;
}

/** The mirror of `attachment_path_is_scoped`, so a malformed key is a refusal before upload. */
const ATTACHMENT_PATH =
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

export function isAttachmentPath(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_PATH.test(value.toLowerCase());
}

/** What the picker produced, once it is known to be a usable image. */
export interface ImageDraft {
  /** Local file uri, the one the picker returned. */
  uri: string;
  width: number;
  height: number;
  /** Reported MIME, or null for a camera capture the picker did not tag. */
  mime: string | null;
}

/** An image payload, or null for a non-image row. Keeps the branch out of renderItem. */
export function imageOf(
  message: Pick<Message, 'attachment_path' | 'attachment_width' | 'attachment_height'>,
): { path: string; width: number; height: number } | null {
  const path = message.attachment_path;
  const width = message.attachment_width;
  const height = message.attachment_height;
  if (
    typeof path !== 'string' ||
    path === '' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { path, width, height };
}
