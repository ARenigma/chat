import type { ContactGuardRow, RefundRow } from '@/app/(authenticated)/queues/types';

/** Fixed clock so the preview and screenshots are stable. */
export const NOW = Date.parse('2026-11-10T10:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const cg = (
  n: number,
  name: string | null,
  state: string,
  strikes: number,
  cats: string[],
  hoursAgo: number,
  extra: Partial<ContactGuardRow> = {}
): ContactGuardRow => ({
  user_id: `${(0x4f1a0000 + n * 7919).toString(16)}-3c1e-4b7a-9d2f-${String(100000000000 + n).slice(-12)}`,
  role: n % 3 === 0 ? 'listener' : n % 3 === 1 ? 'astrologer' : 'counsellor',
  display_name: name,
  review_state: state,
  review_requested_at: ago(hoursAgo),
  active_strikes: strikes,
  paused_until: null,
  directory_hidden_until: null,
  suspended_until: null,
  last_event_at: ago(hoursAgo - 1),
  categories: cats,
  ...extra,
});

export const CONTACT_GUARD: ContactGuardRow[] = [
  cg(1, 'Meera Iyer', 'human_review', 3, ['phone_number', 'whatsapp'], 2, { paused_until: ago(-48) }),
  cg(2, 'Rohan Kapoor', 'human_review', 2, ['phone_number'], 7),
  cg(3, 'Ananya Das', 'human_review', 4, ['off_platform_payment', 'upi_id', 'phone_number'], 19, { directory_hidden_until: ago(-120), suspended_until: ago(-24 * 7) }),
  cg(4, null, 'human_review', 1, ['email'], 31),
  cg(5, 'Vikram Nair', 'auto_flagged', 1, ['social_handle'], 52),
  cg(6, 'Priya Menon', 'auto_flagged', 1, ['whatsapp'], 70),
  cg(7, 'Karan Malhotra', 'auto_flagged', 2, ['phone_number', 'email'], 96),
  cg(8, 'Sneha Kulkarni', 'auto_flagged', 1, [], 140),
  cg(9, 'Arjun Reddy', 'appealed', 2, ['off_platform_payment'], 200),
  cg(10, 'Divya Sharma', 'appealed', 1, ['upi_id'], 410),
  cg(11, 'Imran Qureshi', 'auto_flagged', 1, ['social_handle', 'email'], 900),
  cg(12, 'Lakshmi Pillai', 'human_review', 3, ['phone_number'], 1100, { suspended_until: '2999-01-01T00:00:00Z' }),
];

const rf = (
  n: number,
  status: string,
  tokens: number,
  hoursAgo: number,
  notes: string | null,
  extra: Partial<RefundRow> = {}
): RefundRow => ({
  id: `${(0x9be20000 + n * 104729).toString(16)}-71aa-4c0d-8e55-${String(200000000000 + n).slice(-12)}`,
  user_id: `${(0x2d7c0000 + n * 6007).toString(16)}-b3f1-45e8-a9c4-${String(300000000000 + n).slice(-12)}`,
  purchased_tokens: tokens,
  amount_paise: tokens * 100,
  status,
  notes,
  created_at: ago(hoursAgo),
  resolved_at: null,
  resolved_by: null,
  ...extra,
});

export const REFUNDS: RefundRow[] = [
  rf(1, 'pending', 1200, 3, 'Account closed by user, 1,200 purchased tokens unspent.'),
  rf(2, 'pending', 450, 9, null),
  rf(3, 'pending', 12800, 26, 'Closure after a disputed session. Wallet shows two chargebacks in the last 30 days, so check the payment gateway before approving. Customer support thread linked in the ticket.'),
  rf(4, 'pending', 90, 60, 'Duplicate purchase on 4 Nov.'),
  rf(5, 'approved', 2000, 130, 'Verified against gateway.', { resolved_at: ago(100), resolved_by: 'amit@pappal.dev' }),
  rf(6, 'processed', 600, 300, null, { resolved_at: ago(250), resolved_by: 'sneha@pappal.dev' }),
  rf(7, 'denied', 150, 380, 'Tokens were spent in sessions.', { resolved_at: ago(350), resolved_by: 'amit@pappal.dev' }),
  rf(8, 'processed', 3000, 720, 'Paid out via gateway.', { resolved_at: ago(700), resolved_by: 'amit@pappal.dev' }),
];

/** Many rows, to look at density and scrolling. */
export const MANY_CONTACT_GUARD: ContactGuardRow[] = Array.from({ length: 48 }, (_, i) =>
  cg(100 + i, `Provider ${i + 1}`, i % 4 === 0 ? 'human_review' : 'auto_flagged', (i % 4) + 1, i % 3 === 0 ? ['phone_number', 'email', 'upi_id'] : ['whatsapp'], i * 5 + 1)
);
