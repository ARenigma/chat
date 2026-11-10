import type { HistoryRow, PayableRow } from '@/app/(authenticated)/payouts/types';

export const NOW = Date.parse('2026-11-10T10:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const names = [
  'Meera Iyer', 'Rohan Kapoor', 'Ananya Das', 'Vikram Nair', 'Priya Menon', 'Karan Malhotra',
  'Sneha Kulkarni', 'Arjun Reddy', 'Divya Sharma', 'Imran Qureshi', 'Lakshmi Pillai', 'Nikhil Joshi',
];
const pid = (n: number) => `${(0x7a310000 + n * 8191).toString(16)}-52de-4f90-b6a1-${String(400000000000 + n).slice(-12)}`;

const q = (n: number, tokens: number, account: string | null, pan: string | null): PayableRow => ({
  provider_id: pid(n),
  display_name: names[n] ?? null,
  claimable_tokens: tokens,
  account_status: account,
  pan_status: pan,
  payable: account === 'verified' && pan === 'verified',
});

export const QUEUE: PayableRow[] = [
  q(0, 482300, 'verified', 'verified'),
  q(1, 211400, 'verified', 'verified'),
  q(2, 164900, 'verified', 'pending'),
  q(3, 92100, 'pending', 'verified'),
  q(4, 48800, 'verified', 'verified'),
  q(5, 30200, 'rejected', 'not_provided'),
  q(6, 18700, 'verified', 'verified'),
  q(7, 15200, null, null),
  q(8, 9800, 'verified', 'verified'),
  q(9, 2450, 'verified', 'verified'),
];

const h = (
  n: number,
  p: number,
  status: string,
  tokens: number,
  hoursAgo: number,
  by: string | null,
  settled: boolean,
  ref: string | null
): HistoryRow => ({
  id: `${(0xc4d90000 + n * 7727).toString(16)}-1b0e-4a62-9c37-${String(500000000000 + n).slice(-12)}`,
  provider_id: pid(p),
  provider_name: names[p] ?? null,
  status,
  total_tokens: tokens,
  total_paise: tokens * 100,
  cashfree_batch_id: ref,
  initiated_by: by,
  initiated_at: ago(hoursAgo),
  completed_at: settled ? ago(hoursAgo - 0.5) : null,
  created_at: ago(hoursAgo),
});

export const HISTORY: HistoryRow[] = [
  h(1, 0, 'processing', 120000, 1, 'amit@pappal.dev', false, 'CFB_7841123'),
  h(2, 1, 'completed', 88000, 20, 'amit@pappal.dev', true, 'CFB_7839921'),
  h(3, 4, 'failed', 41500, 30, 'amit@pappal.dev', false, 'CFB_7839002'),
  h(4, 6, 'completed', 22400, 52, 'sneha@pappal.dev', true, 'CFB_7836410'),
  h(5, 7, 'completed', 15200, 98, 'amit@pappal.dev', true, 'CFB_7830188'),
  h(6, 2, 'pending', 66000, 120, null, false, null),
  h(7, 8, 'completed', 9800, 140, 'amit@pappal.dev', true, 'CFB_7827555'),
  h(8, 9, 'failed', 2450, 200, 'sneha@pappal.dev', false, 'CFB_7821073'),
  h(9, 3, 'completed', 54200, 340, 'amit@pappal.dev', true, 'CFB_7810234'),
  h(10, 5, 'completed', 30100, 500, 'amit@pappal.dev', true, 'CFB_7799001'),
  h(11, 10, 'completed', 17650, 700, 'amit@pappal.dev', true, 'CFB_7790012'),
];

export const MANY_HISTORY: HistoryRow[] = Array.from({ length: 50 }, (_, i) =>
  h(100 + i, i % 11, i % 9 === 0 ? 'failed' : i % 7 === 0 ? 'processing' : 'completed', 5000 + i * 1370, i * 14 + 2, 'amit@pappal.dev', i % 9 !== 0 && i % 7 !== 0, `CFB_${7700000 + i * 37}`)
);
