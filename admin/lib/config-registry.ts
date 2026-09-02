/**
 * Config domain registry.
 *
 * Every domain, field, human label, unit, validation constraint, and
 * runtime-wiring status is declared here. The ConfigVersionEditor reads
 * this registry to render guided controls and validate payloads. The
 * same schema is imported by the draft API route to server-validate
 * before inserting a new version row.
 *
 * Runtime status values:
 *   'live'    — field is consumed by Postgres RPCs or mobile JS at runtime
 *   'partial' — consumed in some but not all enforcement paths
 *   'seeded'  — stored in DB only; mobile still uses compile-time fallback
 */

export type FieldType =
  | 'rupees'       // displayed as ₹, stored as integer tokens (1 token = ₹1)
  | 'paise'        // displayed as ₹, stored as integer paise
  | 'percent'      // displayed as %, stored as basis points (bps, /100 to display)
  | 'percent-int'  // displayed as %, stored as integer percent (0–100, /100 to consume)
  | 'integer'      // plain integer
  | 'days'         // integer + "days" label
  | 'hours'        // integer + "hours" label
  | 'boolean'      // switch control
  | 'enum'         // select dropdown
  | 'rupee-array'  // repeatable ₹ amounts (recharge packs)
  | 'string-array' // repeatable strings (product IDs, report reasons)
  | 'string';      // plain text input

export type RuntimeStatus = 'live' | 'partial' | 'seeded';

export interface FieldDef {
  key: string;
  label: string;
  description: string;
  type: FieldType;
  /** Inclusive min (after unit conversion to stored value) */
  min?: number;
  /** Inclusive max (after unit conversion to stored value) */
  max?: number;
  /** Options for 'enum' type */
  options?: Array<{ value: string; label: string }>;
  /** Default value (stored representation) */
  default?: unknown;
  /** Whether a change here has safety/financial consequences */
  risk?: 'low' | 'medium' | 'high';
  /** Impact description shown near the field */
  impact?: string;
  runtime: RuntimeStatus;
}

export interface DomainDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  fields: FieldDef[];
}

export const CONFIG_REGISTRY: DomainDef[] = [
  {
    key: 'economics',
    name: 'Pricing & commission',
    description: 'Per-minute rates charged to members and provider revenue share.',
    icon: '₹',
    fields: [
      {
        key: 'chat_rate_tokens_per_min',
        label: 'Chat rate',
        description: 'Amount charged to the member per minute of a text chat session.',
        type: 'rupees',
        min: 1,
        max: 500,
        default: 22,
        risk: 'high',
        impact: 'Affects all new chat sessions immediately on publish.',
        runtime: 'live',
      },
      {
        key: 'audio_rate_tokens_per_min',
        label: 'Voice call rate',
        description: 'Amount charged to the member per minute of a voice call.',
        type: 'rupees',
        min: 1,
        max: 500,
        default: 22,
        risk: 'high',
        impact: 'Affects all new voice calls immediately on publish.',
        runtime: 'live',
      },
      {
        key: 'video_rate_tokens_per_min',
        label: 'Video call rate',
        description: 'Amount charged to the member per minute of a video call.',
        type: 'rupees',
        min: 1,
        max: 500,
        default: 35,
        risk: 'high',
        impact: 'Affects all new video calls immediately on publish.',
        runtime: 'live',
      },
      {
        key: 'provider_share_percent',
        label: 'Provider revenue share',
        description: 'Integer percentage of session revenue (pre-GST, after refunds) paid to the provider. Stored as 0–100; consumers divide by 100.',
        type: 'percent-int',
        min: 0,
        max: 100,
        default: 60,
        risk: 'high',
        impact: 'Applies to sessions ended after this version becomes active.',
        runtime: 'live',
      },
      {
        key: 'gst_rate_bps',
        label: 'GST rate',
        description: 'GST rate applied to recharge transactions. Shown on invoices.',
        type: 'percent',
        min: 0,
        max: 3000,
        default: 1800,
        risk: 'high',
        impact: 'Applied to new recharge orders only.',
        runtime: 'partial',
      },
    ],
  },
  {
    key: 'recharge',
    name: 'Recharge packs',
    description: 'Top-up amounts shown on the Recharge screen and Play product IDs.',
    icon: '⚡',
    fields: [
      {
        key: 'packs_inr',
        label: 'Pack amounts (₹)',
        description: 'Ordered list of recharge pack values shown to members. Minimum ₹1.',
        type: 'rupee-array',
        default: [100, 300, 500, 1000, 2500, 5000],
        risk: 'medium',
        impact: 'Changes the packs displayed on the Recharge screen in the app.',
        runtime: 'live',
      },
      {
        key: 'play_product_ids',
        label: 'Google Play product SKUs',
        description: 'Play Billing product IDs corresponding to each pack (must be same length as pack amounts).',
        type: 'string-array',
        default: [],
        risk: 'high',
        impact: 'Required for Play User Choice Billing to function.',
        runtime: 'seeded',
      },
      {
        key: 'cashfree_enabled',
        label: 'Cashfree payments',
        description: 'Enable UPI / card payments via Cashfree as the primary rail.',
        type: 'boolean',
        default: false,
        risk: 'high',
        impact: 'Enables real-money recharge via Cashfree. Test in staging first.',
        runtime: 'seeded',
      },
      {
        key: 'play_ucb_enabled',
        label: 'Google Play billing',
        description: 'Enable the Google Play User Choice Billing alternative billing integration.',
        type: 'boolean',
        default: false,
        risk: 'high',
        impact: 'Enables Play Billing flow. Requires valid Play product IDs above.',
        runtime: 'seeded',
      },
    ],
  },
  {
    key: 'wallet',
    name: 'Wallet credits',
    description: 'Starting token grant for new users and daily free-token refill.',
    icon: '👛',
    fields: [
      {
        key: 'starting_grant_tokens',
        label: 'New-user token grant',
        description: 'Free tokens credited when a new account is created. Set to 0 to disable.',
        type: 'rupees',
        min: 0,
        max: 10000,
        default: 0,
        risk: 'medium',
        impact: 'Applies to new accounts created after publish.',
        runtime: 'partial',
      },
      {
        key: 'daily_refill_enabled',
        label: 'Daily free tokens',
        description: 'Allow members to claim free tokens once per day.',
        type: 'boolean',
        default: false,
        risk: 'low',
        runtime: 'live',
      },
      {
        key: 'daily_refill_tokens',
        label: 'Daily refill amount',
        description: 'Tokens granted on each daily claim. Only effective when daily free tokens is on.',
        type: 'rupees',
        min: 1,
        max: 1000,
        default: 25,
        risk: 'low',
        runtime: 'live',
      },
    ],
  },
  {
    key: 'thresholds',
    name: 'Limits',
    description: 'Low-balance warning, anti-spam rate limit, and refund window.',
    icon: '⚠',
    fields: [
      {
        key: 'low_balance_tokens',
        label: 'Low-balance warning threshold',
        description: 'Members see a "top up" nudge when their balance drops below this amount.',
        type: 'rupees',
        min: 0,
        max: 10000,
        default: 22,
        risk: 'low',
        // Not wired: the app's low-balance warning is minutes-based
        // (CRITICAL_TALK_MINUTES × rate ≈ 220 tokens). This flat 22-token seed
        // means ≈1 min, so consuming it as-is would fire the warning 10× later.
        // Reconciling needs a product decision on the value + updating the seed.
        runtime: 'seeded',
      },
      {
        key: 'rate_limit_messages_per_min',
        label: 'Max messages per minute',
        description: 'Anti-spam: maximum messages a member can send in a rolling 60-second window.',
        type: 'integer',
        min: 1,
        max: 120,
        default: 20,
        risk: 'medium',
        runtime: 'live',
      },
      {
        key: 'unanswered_refund_window_hours',
        label: 'Unanswered-session refund window',
        description: 'Hours after session start before an unanswered-session refund becomes eligible.',
        type: 'hours',
        min: 1,
        max: 168,
        default: 24,
        risk: 'medium',
        runtime: 'seeded',
      },
    ],
  },
  {
    key: 'payouts',
    name: 'Provider payouts',
    description: 'Cashfree payout cadence, settlement hold, and minimum transfer amount.',
    icon: '💸',
    fields: [
      {
        key: 'cadence',
        label: 'Payout frequency',
        description: 'How often provider earnings are disbursed via Cashfree Payouts.',
        type: 'enum',
        options: [{ value: 'weekly', label: 'Weekly' }],
        default: 'weekly',
        risk: 'medium',
        runtime: 'live',
      },
      {
        key: 'hold_days',
        label: 'Settlement hold',
        description: 'Days earnings are held before becoming payable. Covers refund windows.',
        type: 'days',
        min: 0,
        max: 60,
        default: 7,
        risk: 'high',
        runtime: 'live',
      },
      {
        key: 'minimum_paise',
        label: 'Minimum payout',
        description: 'Providers must accumulate at least this amount before a payout is triggered.',
        type: 'paise',
        min: 100,
        max: 1000000,
        default: 50000,
        risk: 'low',
        runtime: 'live',
      },
      {
        key: 'cashfree_payouts_enabled',
        label: 'Enable Cashfree payouts',
        description: 'Turn on the Cashfree Payouts rail for provider disbursement.',
        type: 'boolean',
        default: false,
        risk: 'high',
        impact: 'Real money is transferred when this is on. Verify credentials first.',
        runtime: 'partial',
      },
    ],
  },
  {
    key: 'kill_switches',
    name: 'App controls',
    description: 'Runtime feature gates — flip to disable features without a deploy.',
    icon: '🔴',
    fields: [
      {
        key: 'payments_enabled',
        label: 'Real payments',
        description: 'Allow members to complete real-money recharge transactions.',
        type: 'boolean',
        default: false,
        risk: 'high',
        impact: 'Master payments gate. Turning off blocks all new paid recharges.',
        runtime: 'live',
      },
      {
        key: 'voice_calls_enabled',
        label: 'Voice calls',
        description: 'Allow members and providers to start audio-only calls.',
        type: 'boolean',
        default: true,
        risk: 'high',
        impact: 'Emergency stop for new voice calls. Active calls are not disconnected.',
        runtime: 'live',
      },
      {
        key: 'video_calls_enabled',
        label: 'Video calls',
        description: 'Allow members and providers to start calls with video.',
        type: 'boolean',
        default: true,
        risk: 'high',
        impact: 'Emergency stop for new video calls. Voice calls remain available.',
        runtime: 'live',
      },
      {
        key: 'new_registrations_enabled',
        label: 'New registrations',
        description: 'Allow new users to create accounts.',
        type: 'boolean',
        default: true,
        risk: 'medium',
        impact: 'Turning off closes sign-up without a deploy.',
        runtime: 'partial',
      },
      {
        key: 'mock_payments_allowed',
        label: 'Mock payments (testing)',
        description: 'Allow test recharges without a real payment. Disable in production.',
        type: 'boolean',
        default: true,
        risk: 'high',
        impact: 'Must be OFF in production. Allows free balance top-ups.',
        runtime: 'seeded',
      },
    ],
  },
  {
    key: 'report_taxonomy',
    name: 'Report categories',
    description: 'Reasons shown to members when they report content or a provider.',
    icon: '⚑',
    fields: [
      {
        key: 'reasons',
        label: 'Report reasons',
        description:
          'Ordered list of category slugs. The app shows human-readable labels mapped from these slugs.',
        type: 'string-array',
        default: [
          'sexual_content',
          'child_safety',
          'harassment',
          'threats_violence',
          'hate_speech',
          'self_harm',
          'scam_spam',
          'impersonation',
          'privacy',
          'illegal_activity',
          'other',
        ],
        risk: 'medium',
        impact: 'Changes the report options available in-app after the next config poll.',
        runtime: 'live',
      },
    ],
  },
  {
    key: 'auth_ui',
    name: 'Sign-in controls',
    description: 'Display-only flags controlling which sign-in methods are shown on the auth screen.',
    icon: '🔑',
    fields: [
      {
        key: 'phone_auth_tab_visible',
        label: 'Show phone sign-in',
        description: 'Display the phone + OTP sign-in option on the auth screen.',
        type: 'boolean',
        default: true,
        risk: 'low',
        impact: 'Display-only. Server-side auth is unaffected.',
        runtime: 'live',
      },
      {
        key: 'google_auth_tab_visible',
        label: 'Show Google sign-in',
        description: 'Display the "Sign in with Google" option on the auth screen.',
        type: 'boolean',
        default: true,
        risk: 'low',
        impact: 'Display-only. Server-side auth is unaffected.',
        runtime: 'live',
      },
    ],
  },
  {
    key: 'permissions',
    name: 'Device permissions',
    description:
      'Runtime permission policy by build environment. Internal builds may treat notifications as optional.',
    icon: '📱',
    fields: [
      {
        key: 'environment_mode',
        label: 'Environment mode',
        description:
          'When set to internal, non-production app builds use *_internal fields. Production builds always use *_production.',
        type: 'enum',
        options: [
          { value: 'internal', label: 'Internal testing' },
          { value: 'production', label: 'Production' },
        ],
        default: 'internal',
        risk: 'medium',
        runtime: 'live',
      },
      {
        key: 'notification_internal',
        label: 'Notifications (internal)',
        description: 'Notification permission policy for internal/testing builds.',
        type: 'enum',
        options: [
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ],
        default: 'optional',
        risk: 'low',
        runtime: 'live',
      },
      {
        key: 'notification_production',
        label: 'Notifications (production)',
        description: 'Notification permission policy for production builds.',
        type: 'enum',
        options: [
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ],
        default: 'required',
        risk: 'medium',
        runtime: 'live',
      },
      {
        key: 'microphone_internal',
        label: 'Microphone (internal)',
        description: 'Microphone permission policy for internal/testing builds.',
        type: 'enum',
        options: [
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ],
        default: 'required',
        risk: 'medium',
        runtime: 'live',
      },
      {
        key: 'microphone_production',
        label: 'Microphone (production)',
        description: 'Microphone permission policy for production builds.',
        type: 'enum',
        options: [
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ],
        default: 'required',
        risk: 'high',
        runtime: 'live',
      },
      {
        key: 'camera_internal',
        label: 'Camera (internal)',
        description: 'Camera permission policy for internal/testing builds.',
        type: 'enum',
        options: [
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ],
        default: 'required',
        risk: 'medium',
        runtime: 'live',
      },
      {
        key: 'camera_production',
        label: 'Camera (production)',
        description: 'Camera permission policy for production builds.',
        type: 'enum',
        options: [
          { value: 'optional', label: 'Optional' },
          { value: 'required', label: 'Required' },
        ],
        default: 'required',
        risk: 'high',
        runtime: 'live',
      },
    ],
  },
];

/** Look up a domain definition by key. */
export function getDomain(key: string): DomainDef | undefined {
  return CONFIG_REGISTRY.find((d) => d.key === key);
}

/** Validate a payload object against a domain's field definitions.
 *  Returns an array of error messages (empty = valid). */
export function validatePayload(domain: DomainDef, payload: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const field of domain.fields) {
    const value = payload[field.key];

    if (value === undefined || value === null) {
      errors.push(`"${field.label}" is required.`);
      continue;
    }

    switch (field.type) {
      case 'rupees':
      case 'paise':
      case 'integer':
      case 'days':
      case 'hours': {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`"${field.label}" must be an integer.`);
        } else {
          if (field.min !== undefined && value < field.min)
            errors.push(`"${field.label}" must be at least ${field.min}.`);
          if (field.max !== undefined && value > field.max)
            errors.push(`"${field.label}" must be at most ${field.max}.`);
        }
        break;
      }

      case 'percent': {
        // Stored as basis points (e.g. 1800 = 18%)
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`"${field.label}" must be an integer (basis points).`);
        } else {
          if (field.min !== undefined && value < field.min)
            errors.push(`"${field.label}" must be at least ${field.min / 100}%.`);
          if (field.max !== undefined && value > field.max)
            errors.push(`"${field.label}" must be at most ${field.max / 100}%.`);
        }
        break;
      }

      case 'percent-int': {
        // Stored as integer percent (e.g. 60 = 60%); consumers divide by 100
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`"${field.label}" must be an integer percentage (0–100).`);
        } else {
          if (field.min !== undefined && value < field.min)
            errors.push(`"${field.label}" must be at least ${field.min}%.`);
          if (field.max !== undefined && value > field.max)
            errors.push(`"${field.label}" must be at most ${field.max}%.`);
        }
        break;
      }

      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors.push(`"${field.label}" must be true or false.`);
        }
        break;
      }

      case 'enum': {
        const validValues = (field.options ?? []).map((o) => o.value);
        if (!validValues.includes(value as string)) {
          errors.push(`"${field.label}" must be one of: ${validValues.join(', ')}.`);
        }
        break;
      }

      case 'string': {
        if (typeof value !== 'string') {
          errors.push(`"${field.label}" must be a string.`);
        }
        break;
      }

      case 'rupee-array': {
        if (!Array.isArray(value)) {
          errors.push(`"${field.label}" must be an array.`);
        } else {
          (value as unknown[]).forEach((v, i) => {
            if (typeof v !== 'number' || !Number.isInteger(v) || (v as number) < 1) {
              errors.push(`"${field.label}" item ${i + 1} must be a positive integer.`);
            }
          });
        }
        break;
      }

      case 'string-array': {
        if (!Array.isArray(value)) {
          errors.push(`"${field.label}" must be an array.`);
        } else {
          (value as unknown[]).forEach((v, i) => {
            if (typeof v !== 'string' || !(v as string).trim()) {
              errors.push(`"${field.label}" item ${i + 1} must be a non-empty string.`);
            }
          });
        }
        break;
      }
    }
  }

  // Reject unknown keys
  const knownKeys = new Set(domain.fields.map((f) => f.key));
  for (const key of Object.keys(payload)) {
    if (!knownKeys.has(key)) {
      errors.push(`Unknown field "${key}".`);
    }
  }

  return errors;
}

/** Convert display value → stored value for a field type. */
export function toStoredValue(type: FieldType, displayValue: number): number {
  if (type === 'percent') return Math.round(displayValue * 100); // bps
  // 'percent-int' stores as integer directly; no conversion needed
  return displayValue;
}

/** Convert stored value → display value for a field type. */
export function toDisplayValue(type: FieldType, storedValue: number): number {
  if (type === 'percent') return storedValue / 100;  // bps → %
  if (type === 'paise') return storedValue / 100;    // paise → ₹
  // 'percent-int' is stored as display value (0–100)
  return storedValue;
}

/** Format a display value with its unit label. */
export function formatDisplayValue(field: FieldDef, storedValue: unknown): string {
  if (typeof storedValue === 'boolean') return storedValue ? 'On' : 'Off';
  if (Array.isArray(storedValue)) return `${(storedValue as unknown[]).length} items`;
  if (typeof storedValue === 'string') return storedValue;
  if (typeof storedValue !== 'number') return String(storedValue);

  switch (field.type) {
    case 'rupees':
      return `₹${storedValue.toLocaleString('en-IN')}`;
    case 'paise':
      return `₹${(storedValue / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    case 'percent':
      return `${(storedValue / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
    case 'percent-int':
      return `${storedValue}%`;
    case 'days':
      return `${storedValue} day${storedValue === 1 ? '' : 's'}`;
    case 'hours':
      return `${storedValue} hr${storedValue === 1 ? '' : 's'}`;
    default:
      return storedValue.toLocaleString('en-IN');
  }
}
