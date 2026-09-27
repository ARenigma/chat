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

/** The mirror of `attachment_path_is_scoped`, so a malformed key is a refusal before upload. */
const ATTACHMENT_PATH =
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

export function isAttachmentPath(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_PATH.test(value.toLowerCase());
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
