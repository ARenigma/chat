/** Member username rules — mirrored by check_display_name() in migration 040. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export type UsernameLocalStatus = 'idle' | 'too_short' | 'invalid_chars' | 'ok';

export function usernameLocalStatus(raw: string): UsernameLocalStatus {
  const trimmed = raw.trim();
  if (trimmed.length < USERNAME_MIN) {
    return trimmed.length === 0 ? 'idle' : 'too_short';
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return 'invalid_chars';
  }
  return 'ok';
}

export function isUsernameLocallyValid(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    trimmed.length >= USERNAME_MIN &&
    trimmed.length <= USERNAME_MAX &&
    USERNAME_PATTERN.test(trimmed)
  );
}
