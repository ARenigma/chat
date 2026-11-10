// Fixture data for the /design preview. Nothing here touches Supabase.
// Later agents: render real screens against these shapes, then swap in live data.

export type ProviderStatus = 'active' | 'under_review' | 'needs_info' | 'approved' | 'rejected';

export interface FixtureProvider {
  id: string;
  name: string;
  email: string;
  status: ProviderStatus;
  kind: 'Astrologer' | 'Listener' | 'Counsellor';
  languages: string[];
  rating: number;
  sessions: number;
  earnings: number; // INR
  joined: string; // ISO date
}

export const PROVIDERS: FixtureProvider[] = [
  { id: 'PRV-1042', name: 'Meera Iyer', email: 'meera.iyer@example.com', status: 'active', kind: 'Astrologer', languages: ['Hindi', 'English'], rating: 4.8, sessions: 1284, earnings: 482300, joined: '2026-03-12' },
  { id: 'PRV-1041', name: 'Rohan Kapoor', email: 'rohan.k@example.com', status: 'active', kind: 'Listener', languages: ['Hindi'], rating: 4.6, sessions: 903, earnings: 211400, joined: '2026-03-28' },
  { id: 'PRV-1040', name: 'Ananya Das', email: 'ananya.das@example.com', status: 'under_review', kind: 'Counsellor', languages: ['Bengali', 'English'], rating: 0, sessions: 0, earnings: 0, joined: '2026-10-29' },
  { id: 'PRV-1039', name: 'Vikram Nair', email: 'vikram.nair@example.com', status: 'needs_info', kind: 'Astrologer', languages: ['Malayalam', 'English'], rating: 0, sessions: 0, earnings: 0, joined: '2026-10-27' },
  { id: 'PRV-1038', name: 'Priya Menon', email: 'priya.menon@example.com', status: 'approved', kind: 'Listener', languages: ['Tamil', 'English'], rating: 4.9, sessions: 61, earnings: 18700, joined: '2026-10-21' },
  { id: 'PRV-1037', name: 'Karan Malhotra', email: 'karan.m@example.com', status: 'rejected', kind: 'Astrologer', languages: ['Punjabi'], rating: 0, sessions: 0, earnings: 0, joined: '2026-10-18' },
  { id: 'PRV-1036', name: 'Sneha Kulkarni', email: 'sneha.k@example.com', status: 'active', kind: 'Counsellor', languages: ['Marathi', 'Hindi'], rating: 4.7, sessions: 512, earnings: 164900, joined: '2026-06-02' },
  { id: 'PRV-1035', name: 'Arjun Reddy', email: 'arjun.reddy@example.com', status: 'active', kind: 'Astrologer', languages: ['Telugu', 'English'], rating: 4.5, sessions: 740, earnings: 301200, joined: '2026-05-19' },
  { id: 'PRV-1034', name: 'Divya Sharma', email: 'divya.sharma@example.com', status: 'under_review', kind: 'Listener', languages: ['Hindi', 'English'], rating: 0, sessions: 0, earnings: 0, joined: '2026-10-15' },
  { id: 'PRV-1033', name: 'Imran Qureshi', email: 'imran.q@example.com', status: 'active', kind: 'Listener', languages: ['Urdu', 'Hindi'], rating: 4.4, sessions: 388, earnings: 92100, joined: '2026-07-08' },
  { id: 'PRV-1032', name: 'Lakshmi Pillai', email: 'lakshmi.p@example.com', status: 'approved', kind: 'Astrologer', languages: ['Malayalam'], rating: 4.8, sessions: 44, earnings: 15200, joined: '2026-10-10' },
  { id: 'PRV-1031', name: 'Nikhil Joshi', email: 'nikhil.j@example.com', status: 'needs_info', kind: 'Counsellor', languages: ['Gujarati', 'Hindi'], rating: 0, sessions: 0, earnings: 0, joined: '2026-10-06' },
];

export const STATUS_ORDER: ProviderStatus[] = ['under_review', 'needs_info', 'approved', 'active', 'rejected'];

export interface FixtureActivity {
  id: string;
  kind: 'event' | 'comment';
  actor: string;
  text: string;
  at: string;
  /** Comment cards can carry a second message (a reply). */
  reply?: { actor: string; text: string; at: string };
}

export const APPLICATION = {
  id: 'APP-1042',
  title: 'Ananya Das: counsellor application',
  summary:
    'Applicant is a licensed counsellor with 6 years of practice. Submitted ID, qualification certificate and a 3 minute intro clip. Payout account pending verification via',
  code: 'payout_account',
  status: 'under_review' as ProviderStatus,
  priority: 'Medium',
  assignee: 'Amit',
  cycle: 'Review 44',
  labels: [
    { name: 'Counsellor', tone: 'success' as const },
    { name: 'Bengali', tone: 'warning' as const },
  ],
  submitted: 'Oct 29',
  activity: [
    { id: 'a1', kind: 'event', actor: 'System', text: 'received the application from the provider app', at: '2d ago' },
    { id: 'a2', kind: 'event', actor: 'Triage', text: 'added the labels Counsellor and Bengali', at: '2d ago' },
    {
      id: 'a3',
      kind: 'comment',
      actor: 'amit',
      text: 'ID and certificate match. The intro clip is clear but quiet, worth a re-record before we list her.',
      at: '1d ago',
      reply: { actor: 'sneha', text: 'Agreed. Asking her to re-record, and for the payout account name to match the ID.', at: '1d ago' },
    },
    { id: 'a4', kind: 'event', actor: 'System', text: 'moved from Submitted to Under review', at: '1d ago' },
  ] as FixtureActivity[],
};

export const KPIS = [
  { label: 'Active providers', value: 1284, delta: 4.2, trend: [38, 41, 40, 44, 47, 46, 51, 54, 53, 58, 61, 64], deltaLabel: 'vs last 30 days' },
  { label: 'Sessions today', value: 3920, delta: 11.8, trend: [20, 24, 22, 30, 28, 35, 33, 38, 41, 39, 44, 48], deltaLabel: 'vs yesterday' },
  { label: 'Open applications', value: 37, delta: -8.1, deltaInverse: true, trend: [52, 49, 50, 47, 44, 45, 41, 40, 39, 38, 38, 37], deltaLabel: 'vs last week' },
  { label: 'Payouts pending (INR)', value: 482300, delta: 2.4, deltaInverse: true, trend: [30, 35, 33, 36, 40, 38, 42, 41, 44, 43, 46, 47], deltaLabel: 'vs last week', prefix: '₹' },
];

const DAYS = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 12 + i));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
});

export const SESSIONS_OVER_TIME = {
  categories: DAYS,
  series: [
    { name: 'Chat', data: DAYS.map((_, i) => Math.round(2200 + i * 38 + Math.sin(i / 2.3) * 260)) },
    { name: 'Voice', data: DAYS.map((_, i) => Math.round(1100 + i * 21 + Math.cos(i / 3.1) * 180)) },
  ],
};

export const APPLICATIONS_BY_WEEK = {
  categories: ['W40', 'W41', 'W42', 'W43', 'W44', 'W45'],
  series: [
    { name: 'Approved', data: [14, 18, 16, 21, 19, 24] },
    { name: 'Rejected', data: [6, 4, 7, 5, 6, 4] },
  ],
};

export const PROVIDERS_BY_STATUS = [
  { name: 'Active', value: 1284 },
  { name: 'Under review', value: 37 },
  { name: 'Approved', value: 61 },
  { name: 'Needs info', value: 18 },
  { name: 'Rejected', value: 142 },
];

// [session minutes, earnings INR] per provider
export const SESSION_VS_EARNINGS: [number, number][] = Array.from({ length: 48 }, (_, i) => {
  const minutes = 6 + ((i * 37) % 54);
  const inr = Math.round(minutes * (9 + ((i * 13) % 9)) + ((i * 29) % 70));
  return [minutes, inr];
});

export const CONFIG_SETTINGS = {
  name: 'Provider payouts',
  description: 'Cadence and thresholds for provider payouts. Changes are staged until published.',
  cadence: 'weekly',
  minimumPayout: 500,
  autoApprove: true,
  holdNewProviders: true,
  note: 'New providers are held for 7 days before their first payout.',
};
