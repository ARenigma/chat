/** Plain, serialisable shapes shared by the server queries and the dashboard view. */

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

export interface NamedSeries {
  name: string;
  data: number[];
}

export interface DashboardData {
  /** ISO time the data was read; the view derives every "age" from it so render is deterministic. */
  generatedAt: string;
  providers: Section<{ total: number; online: number; buckets: { name: string; value: number }[] }>;
  applications: Section<{
    open: number;
    oldestOpenAt: string | null;
    weeks: string[];
    stages: NamedSeries[];
  }>;
  payouts: Section<{
    claimableTokens: number;
    claimableProviders: number;
    payableProviders: number;
    paidPaise: number;
    paidDays: string[];
    paidTrend: number[];
  }>;
  contactGuard: Section<{ count: number; oldestAt: string | null }>;
  refunds: Section<{ count: number; oldestAt: string | null }>;
  activity: Section<{ days: string[]; series: NamedSeries[]; total: number }>;
  /** Config domains without an active prod version. */
  configMissing: Section<number>;
}
