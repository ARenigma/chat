import type { ApplicationRow } from '@/app/(authenticated)/applications/ApplicationsView';

// Fixed clock so screenshots are reproducible.
export const NOW = new Date('2026-11-10T09:30:00+05:30').getTime();
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const uid = (n: number) => `${(0xa1b2c3d4 + n * 7919).toString(16)}-4e2f-4a1b-9c3d-0123456789ab`;

const NAMES: [string, string, string[], string, number][] = [
  ['Ananya Das', 'Licensed counsellor, 6 years of practice in CBT and grief work', ['Bengali', 'English'], '1994-03-02', 20],
  ['Vikram Nair', 'Vedic astrologer, third generation, Kerala tradition', ['Malayalam', 'English'], '1988-07-19', 52],
  ['Divya Sharma', 'Empathetic listener, former teacher', ['Hindi', 'English'], '1996-11-30', 7],
  ['Nikhil Joshi', 'Relationship counsellor with a clinical psychology masters', ['Gujarati', 'Hindi'], '1991-01-14', 90],
  ['Rahul Verma', 'Tarot and numerology reader', ['Hindi'], '1993-05-05', 3],
  ['Sana Khan', 'Listener for late-night anxiety and loneliness', ['Urdu', 'Hindi', 'English'], '1999-09-09', 26],
  ['Ishaan Bhatt', 'Career counsellor', ['Hindi', 'English'], '1990-12-01', 30],
  ['Lata Subramaniam', 'Palmist and Vastu consultant', ['Tamil'], '1979-08-23', 120],
];

const mk = (i: number, status: string): ApplicationRow => {
  const p = NAMES[i % NAMES.length] as (typeof NAMES)[number];
  return {
    user_id: uid(i),
    status,
    display_name: p[0],
    headline: p[1],
    languages: p[2],
    date_of_birth: p[3],
    submitted_at: ago(p[4]),
    reviewed_at: null,
  };
};

export const QUEUE: ApplicationRow[] = [
  mk(0, 'submitted'),
  mk(1, 'submitted'),
  mk(2, 'submitted'),
  mk(3, 'under_review'),
  mk(4, 'under_review'),
  mk(5, 'needs_info'),
  { ...mk(6, 'needs_info'), headline: null },
];

export const RECENT: ApplicationRow[] = [
  { ...mk(7, 'approved'), reviewed_at: ago(5), reviewer_note: 'ID and certificate verified.' },
  { ...mk(8, 'rejected'), reviewed_at: ago(40), reviewer_note: 'Qualification certificate does not match the ID.' },
  { ...mk(9, 'approved'), reviewed_at: ago(200), reviewer_note: null },
];

export const MANY: ApplicationRow[] = Array.from({ length: 40 }, (_, i) =>
  mk(i + 20, i % 3 === 0 ? 'submitted' : i % 3 === 1 ? 'under_review' : 'needs_info'),
);

export const LONG: ApplicationRow[] = [
  {
    ...mk(0, 'submitted'),
    display_name: 'Venkatasubramanian Raghunathan Iyengar-Chandrasekharan',
    headline:
      'Licensed counsellor and certified Vedic astrologer with twelve years of combined practice across Chennai, Bengaluru and remote sessions, specialising in family mediation and career transitions',
    languages: ['Tamil', 'Telugu', 'Kannada', 'Malayalam', 'English'],
  },
  mk(1, 'submitted'),
];
