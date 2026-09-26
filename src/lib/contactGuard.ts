/**
 * The contact guard, client side: the mode switch, the composer's precheck,
 * and the English copy for every refusal the server returns.
 *
 * The server decides (migrations 156-157). The generated mirror in
 * contactGuard.generated.ts carries the same hard rules so the composer can
 * explain a block BEFORE the send, and only in enforce mode: in shadow mode
 * the server logs and delivers, so predicting a block would stop a message
 * the server lets through. A mirror that predicts nothing is always safe,
 * because the server still refuses what it must.
 *
 * Copy follows the design's draft (.claude/plans/contact-guard-v2.md 6.2):
 * each line names what was found, never a vague "risk". Hindi and Hinglish
 * versions are Amit's call.
 */
import { contactCategory, contactGuardRules, contactReason, contactWindow } from './contactGuard.generated';
import { timeOfDay } from './datetime';

/** kill_switches.contact_guard_mode, read by the gate and by the app. */
export type ContactGuardMode = 'off' | 'shadow' | 'enforce';

export const DEFAULT_CONTACT_GUARD_MODE: ContactGuardMode = 'shadow';

export function contactGuardModeFrom(value: unknown): ContactGuardMode {
  return value === 'off' || value === 'shadow' || value === 'enforce' ? value : DEFAULT_CONTACT_GUARD_MODE;
}

/** The refusal codes the guarded RPCs return, beside their older codes. */
export type ContactGuardError =
  | 'CONTACT_INFO'
  | 'CONTACT_RESTRICTED'
  | 'CONTACT_COOLDOWN'
  | 'CONTACT_TOO_LONG'
  | 'IMAGES_DISABLED';

export type ContactGuardCategory = 'phone' | 'email' | 'payment' | 'link' | 'handle' | 'window';

/** Where the text was going; public and profile text get their own line. */
export type ContactGuardSurface = 'chat' | 'story_comment' | 'story_caption' | 'profile';

export interface ContactGuardRefusal {
  success?: false;
  error: ContactGuardError;
  category?: ContactGuardCategory | null;
  reason?: 'reference' | 'date_like' | null;
  field?: string | null;
  surface?: ContactGuardSurface | null;
  strikes?: number | null;
  warn?: boolean | null;
  restricted_until?: string | null;
  directory_hidden_until?: string | null;
  retry_after_s?: number | null;
}

const CODES: readonly ContactGuardError[] = [
  'CONTACT_INFO',
  'CONTACT_RESTRICTED',
  'CONTACT_COOLDOWN',
  'CONTACT_TOO_LONG',
  'IMAGES_DISABLED',
];

export function isContactGuardError(code: unknown): code is ContactGuardError {
  return typeof code === 'string' && (CODES as readonly string[]).includes(code);
}

/**
 * The composer's check at the moment of send. Null when the send should go
 * ahead as normal. `recentOwn` is the sender's own last few messages in this
 * conversation, oldest first, for a number split across messages.
 */
export function precheckContactGuard(
  text: string,
  mode: ContactGuardMode,
  recentOwn: readonly string[] = [],
): ContactGuardRefusal | null {
  if (mode !== 'enforce' || text.trim() === '') {
    return null;
  }
  const rules = contactGuardRules(text);
  if (rules.length > 0) {
    return {
      error: 'CONTACT_INFO',
      category: contactCategory(rules),
      reason: contactReason(rules),
      surface: 'chat',
    };
  }
  if (recentOwn.length > 0 && contactWindow([...recentOwn.slice(-5), text]) !== null) {
    return { error: 'CONTACT_INFO', category: 'window', surface: 'chat' };
  }
  return null;
}

/** One line per refusal code, for the NOTICE maps that key on the code alone. */
export const CONTACT_GUARD_NOTICE: Record<ContactGuardError, string> = {
  CONTACT_INFO: "Not sent. Contact details can't be shared on Pappal.",
  CONTACT_RESTRICTED:
    'Messaging is paused because of repeated attempts to share contact details. Calls still work.',
  CONTACT_COOLDOWN: 'Too many blocked messages. Try again in a few minutes.',
  CONTACT_TOO_LONG: 'Messages can be up to 4,000 characters.',
  IMAGES_DISABLED: "Photos can't be sent in chat.",
};

const CATEGORY_LINE: Record<ContactGuardCategory, string> = {
  phone: "Not sent. Phone numbers can't be shared on Pappal. Remove it to send.",
  email: "Not sent. Email addresses can't be shared on Pappal.",
  payment: "Not sent. UPI IDs and bank details can't be shared here. Payment problem? Go to Help.",
  link: "Not sent. Links can't be shared on Pappal.",
  handle: "Not sent. Social media usernames can't be shared on Pappal.",
  window: 'Not sent. This would complete a phone number across messages.',
};

const REFERENCE_LINE =
  'Not sent. Long numbers look like phone numbers here. For a payment or order reference, go to Help.';
const DATE_LIKE_LINE = "Not sent. This reads as a phone number. If it's a date, write it like 9/8/1962.";
const PUBLIC_LINE = "Public posts can't include phone numbers, emails, UPI IDs, links or usernames.";
const WARN_LINE = 'One more attempt pauses your messaging for 24 hours.';

const FIELD_LABEL: Record<string, string> = {
  display_name: 'Your name',
  headline: 'Your headline',
  about: 'Your about',
  username: 'Your username',
  expertise: 'Your expertise',
  languages: 'Your languages',
  preferred_languages: 'Your languages',
};

/**
 * The line to show for a guard refusal, or null when `result` is not one.
 * Accepts any `{ error }` shape so every caller can pass its RPC result as is.
 */
export function contactGuardNotice(result: unknown): string | null {
  if (
    typeof result !== 'object' ||
    result === null ||
    !isContactGuardError((result as { error?: unknown }).error)
  ) {
    return null;
  }
  const refusal = result as ContactGuardRefusal;
  switch (refusal.error) {
    case 'CONTACT_RESTRICTED':
      return refusal.restricted_until
        ? `Messaging is paused until ${timeOfDay(refusal.restricted_until)} because of repeated attempts to share contact details. Calls still work.`
        : CONTACT_GUARD_NOTICE.CONTACT_RESTRICTED;
    case 'CONTACT_INFO': {
      let line: string;
      if (refusal.surface === 'profile') {
        const label = (refusal.field && FIELD_LABEL[refusal.field]) || 'This field';
        return `${label} can't include contact details, links or social usernames.`;
      } else if (refusal.surface === 'story_comment' || refusal.surface === 'story_caption') {
        line = PUBLIC_LINE;
      } else if (refusal.category === 'phone' && refusal.reason === 'reference') {
        line = REFERENCE_LINE;
      } else if (refusal.category === 'phone' && refusal.reason === 'date_like') {
        line = DATE_LIKE_LINE;
      } else {
        line = (refusal.category && CATEGORY_LINE[refusal.category]) || CONTACT_GUARD_NOTICE.CONTACT_INFO;
      }
      return refusal.warn ? `${line} ${WARN_LINE}` : line;
    }
    default:
      return CONTACT_GUARD_NOTICE[refusal.error];
  }
}

/**
 * The SQLSTATE the profile trigger raises when a saved field holds contact
 * details (157). A profile write is a direct table update, so the refusal
 * arrives as an error, with `{category, field}` as JSON in its details.
 */
export const CONTACT_INFO_SQLSTATE = 'P0011';

export function contactGuardRefusalFromError(
  error: { code?: string; details?: string | null } | null | undefined,
): ContactGuardRefusal | null {
  if (error?.code !== CONTACT_INFO_SQLSTATE) {
    return null;
  }
  let detail: { category?: ContactGuardCategory; field?: string } = {};
  try {
    detail = JSON.parse(error.details ?? '{}') as typeof detail;
  } catch {
    // An unparsable detail still means a contact-guard refusal.
  }
  return {
    error: 'CONTACT_INFO',
    category: detail.category ?? null,
    field: detail.field ?? null,
    surface: 'profile',
  };
}
