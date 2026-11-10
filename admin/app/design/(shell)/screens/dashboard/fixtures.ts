import type { DashboardData } from '@/lib/dashboard/types';

const NOW = '2026-11-10T09:30:00.000Z';
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
const days = (n: number, from: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 10, 10) - (n - 1 - i + from) * 86_400_000).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  );

export const DASHBOARD_POPULATED: DashboardData = {
  generatedAt: NOW,
  providers: {
    ok: true,
    data: {
      total: 1536,
      online: 214,
      buckets: [
        { name: 'Online', value: 214 },
        { name: 'Offline', value: 1062 },
        { name: 'Unverified', value: 74 },
        { name: 'Suspended', value: 18 },
        { name: 'Delisted', value: 168 },
      ],
    },
  },
  applications: {
    ok: true,
    data: {
      open: 37,
      oldestOpenAt: ago(24 * 6 + 3),
      weeks: ['22 Sep', '29 Sep', '6 Oct', '13 Oct', '20 Oct', '27 Oct', '3 Nov', '10 Nov'].map((s) => s),
      stages: [
        { name: 'Submitted', data: [0, 0, 1, 2, 3, 6, 9, 5] },
        { name: 'Under review', data: [0, 1, 2, 3, 4, 7, 8, 2] },
        { name: 'Needs info', data: [1, 0, 1, 2, 2, 3, 2, 0] },
        { name: 'Approved', data: [14, 18, 16, 21, 19, 24, 12, 1] },
        { name: 'Rejected', data: [6, 4, 7, 5, 6, 4, 3, 0] },
      ],
    },
  },
  payouts: {
    ok: true,
    data: {
      claimableTokens: 482300,
      claimableProviders: 63,
      payableProviders: 51,
      paidPaise: 1_284_500_00,
      paidDays: days(30, 0),
      paidTrend: Array.from({ length: 30 }, (_, i) => (i % 7 === 6 ? 0 : 20000 + ((i * 7919) % 31000))),
    },
  },
  contactGuard: { ok: true, data: { count: 4, oldestAt: ago(52) } },
  refunds: { ok: true, data: { count: 2, oldestAt: ago(5) } },
  activity: {
    ok: true,
    data: {
      days: days(14, 0),
      series: [
        { name: 'Config changes', data: [2, 0, 1, 4, 3, 0, 0, 5, 2, 1, 6, 3, 2, 4] },
        { name: 'Admin actions', data: [8, 11, 9, 14, 12, 3, 2, 16, 13, 10, 18, 15, 9, 12] },
      ],
      total: 3 + 0 + 1 + 4 + 3 + 0 + 0 + 5 + 2 + 1 + 6 + 3 + 2 + 4 + 143,
    },
  },
  configMissing: { ok: true, data: 0 },
};

export const DASHBOARD_EMPTY: DashboardData = {
  generatedAt: NOW,
  providers: { ok: true, data: { total: 0, online: 0, buckets: [] } },
  applications: {
    ok: true,
    data: { open: 0, oldestOpenAt: null, weeks: DASHBOARD_POPULATED.applications.ok ? DASHBOARD_POPULATED.applications.data.weeks : [], stages: [] },
  },
  payouts: {
    ok: true,
    data: { claimableTokens: 0, claimableProviders: 0, payableProviders: 0, paidPaise: 0, paidDays: [], paidTrend: [] },
  },
  contactGuard: { ok: true, data: { count: 0, oldestAt: null } },
  refunds: { ok: true, data: { count: 0, oldestAt: null } },
  activity: { ok: true, data: { days: [], series: [], total: 0 } },
  configMissing: { ok: true, data: 2 },
};

/** Two sections fail, the rest load: proves an error stays inside its panel. */
export const DASHBOARD_ERROR: DashboardData = {
  ...DASHBOARD_POPULATED,
  providers: { ok: false, error: 'relation "admin.providers_list" does not exist' },
  payouts: { ok: false, error: 'permission denied for view payout_history' },
  activity: { ok: false, error: 'canceling statement due to statement timeout' },
};
