// Fixture data for the Providers preview. Nothing here touches Supabase.
import type { ProviderDetail, ProviderNav, ProviderRow } from '@/app/(authenticated)/providers/model';

// Fixed clock so every screenshot is reproducible.
export const NOW = '2026-11-10T09:30:00.000Z';

const row = (n: number, o: Partial<ProviderRow>): ProviderRow => ({
  id: `${(0x3f9a1c00 + n * 7919).toString(16)}-4b2e-4d7a-9c51-${(0xa1b2c3d4e5f0 + n).toString(16)}`,
  display_name: 'Provider',
  provider_category: 'Astrologer',
  is_available: false,
  presence_online: false,
  identity_verified: true,
  suspended_until: null,
  delisted_at: null,
  rating_avg: null,
  rating_count: 0,
  photo_count: 4,
  pending_tokens: 0,
  paid_tokens: 0,
  active_strikes: 0,
  created_at: '2026-10-01T08:00:00Z',
  ...o,
});

export const PROVIDER_ROWS: ProviderRow[] = [
  row(1, { display_name: 'Meera Iyer', presence_online: true, is_available: true, rating_avg: 4.8, rating_count: 1284, pending_tokens: 18400, paid_tokens: 482300, created_at: '2026-03-12T08:00:00Z' }),
  row(2, { display_name: 'Rohan Kapoor', provider_category: 'Listener', presence_online: true, is_available: true, rating_avg: 4.6, rating_count: 903, pending_tokens: 9250, paid_tokens: 211400, created_at: '2026-03-28T08:00:00Z' }),
  row(3, { display_name: 'Sneha Kulkarni', provider_category: 'Counsellor', is_available: true, rating_avg: 4.7, rating_count: 512, pending_tokens: 6100, paid_tokens: 164900, created_at: '2026-06-02T08:00:00Z' }),
  row(4, { display_name: 'Arjun Reddy', is_available: true, rating_avg: 4.5, rating_count: 740, pending_tokens: 12800, paid_tokens: 301200, active_strikes: 1, created_at: '2026-05-19T08:00:00Z' }),
  row(5, { display_name: 'Imran Qureshi', provider_category: 'Listener', rating_avg: 4.4, rating_count: 388, pending_tokens: 2200, paid_tokens: 92100, created_at: '2026-07-08T08:00:00Z' }),
  row(6, { display_name: 'Lakshmi Pillai', rating_avg: 4.8, rating_count: 44, pending_tokens: 0, paid_tokens: 15200, photo_count: 2, created_at: '2026-10-10T08:00:00Z' }),
  row(7, { display_name: 'Ananya Das', provider_category: 'Counsellor', identity_verified: false, photo_count: 1, created_at: '2026-10-29T08:00:00Z' }),
  row(8, { display_name: 'Vikram Nair', identity_verified: false, photo_count: 3, created_at: '2026-10-27T08:00:00Z' }),
  row(9, { display_name: 'Divya Sharma', provider_category: 'Listener', identity_verified: false, photo_count: 0, created_at: '2026-10-15T08:00:00Z' }),
  row(10, { display_name: 'Karan Malhotra', suspended_until: '2026-11-24T00:00:00Z', rating_avg: 3.9, rating_count: 61, active_strikes: 3, pending_tokens: 1400, paid_tokens: 9800, created_at: '2026-08-18T08:00:00Z' }),
  row(11, { display_name: 'Nikhil Joshi', provider_category: 'Counsellor', suspended_until: '2999-01-01T00:00:00Z', rating_avg: 2.1, rating_count: 14, active_strikes: 5, created_at: '2026-09-06T08:00:00Z' }),
  row(12, { display_name: 'Priya Menon', provider_category: 'Listener', delisted_at: '2026-10-30T08:00:00Z', rating_avg: 4.9, rating_count: 61, paid_tokens: 18700, created_at: '2026-04-21T08:00:00Z' }),
  row(13, { display_name: null, provider_category: null, identity_verified: false, photo_count: 0, created_at: '2026-11-08T08:00:00Z' }),
];

const NAMES = ['Aarav', 'Bhavna', 'Chetan', 'Deepa', 'Esha', 'Farhan', 'Gauri', 'Harsh', 'Isha', 'Jatin', 'Kavya', 'Manish'];
const SURNAMES = ['Gupta', 'Rao', 'Banerjee', 'Chopra', 'Desai', 'Fernandes', 'Ghosh', 'Iyengar', 'Khan', 'Lal'];
const CATS = ['Astrologer', 'Listener', 'Counsellor', 'Tarot reader'];

export const MANY_ROWS: ProviderRow[] = Array.from({ length: 64 }, (_, i) =>
  row(100 + i, {
    display_name: `${NAMES[i % NAMES.length]!} ${SURNAMES[(i * 3) % SURNAMES.length]!}`,
    provider_category: CATS[i % CATS.length]!,
    presence_online: i % 5 === 0,
    is_available: i % 3 !== 0,
    identity_verified: i % 9 !== 4,
    suspended_until: i % 17 === 5 ? '2026-12-01T00:00:00Z' : null,
    delisted_at: i % 23 === 7 ? '2026-10-20T00:00:00Z' : null,
    rating_avg: i % 7 === 0 ? null : 3.6 + ((i * 13) % 14) / 10,
    rating_count: (i * 37) % 900,
    photo_count: 1 + (i % 5),
    pending_tokens: (i * 1130) % 21000,
    active_strikes: i % 11 === 0 ? 2 : 0,
    created_at: new Date(Date.UTC(2026, 9, 28) - i * 86400000 * 2.3).toISOString(),
  })
);

export const LONG_ROW: ProviderRow = row(200, {
  display_name: 'Dr. Venkata Subramaniam Ramachandran Iyer-Narasimhan of the Madras Astrological Society',
  provider_category: 'Vedic astrology and counselling',
  rating_avg: 4.2,
  rating_count: 12,
  pending_tokens: 1234567,
  presence_online: true,
});

const svg = (c1: string, c2: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/></linearGradient></defs><rect width='96' height='96' fill='url(#g)'/></svg>`
  )}`;

const BASE: ProviderDetail = {
  profile: {
    id: PROVIDER_ROWS[0]!.id,
    display_name: 'Meera Iyer',
    role: 'provider',
    provider_category: 'Astrologer',
    is_available: true,
    presence_online: true,
    identity_verified_at: '2026-03-13T10:20:00Z',
    suspended_until: null,
    delisted_at: null,
    rating_avg: 4.8,
    rating_count: 1284,
    languages: ['Hindi', 'English', 'Tamil'],
    headline: 'Vedic astrologer, 12 years. Career, marriage and timing questions.',
    about:
      'I read charts in the Parashari tradition and keep sessions practical: what the planets say about the next two years, and what to do about it.\nOpen to first-time clients. I answer in Hindi, English or Tamil.',
    date_of_birth: '1988-04-09',
    created_at: '2026-03-12T08:00:00Z',
  },
  photos: [
    { id: 'ph1', url: svg('rgb(236,120,86)', 'rgb(120,52,80)'), is_primary: true, created_at: '2026-03-12T08:30:00Z' },
    { id: 'ph2', url: svg('rgb(86,140,236)', 'rgb(40,52,120)'), is_primary: false, created_at: '2026-03-12T08:32:00Z' },
    { id: 'ph3', url: svg('rgb(96,200,150)', 'rgb(30,90,80)'), is_primary: false, created_at: '2026-03-14T11:02:00Z' },
  ],
  batches: [
    { id: 'b1', status: 'completed', total_tokens: 24000, total_paise: 2400000, initiated_by: 'amit@pappal.dev', created_at: '2026-10-28T06:00:00Z', completed_at: '2026-10-28T06:05:00Z' },
    { id: 'b2', status: 'completed', total_tokens: 18650, total_paise: 1865000, initiated_by: 'amit@pappal.dev', created_at: '2026-10-14T06:00:00Z', completed_at: '2026-10-14T06:04:00Z' },
    { id: 'b3', status: 'failed', total_tokens: 9100, total_paise: 910000, initiated_by: null, created_at: '2026-09-30T06:00:00Z', completed_at: null },
  ],
  strikes: [
    { id: 's1', created_at: '2026-10-02T14:10:00Z', expires_at: '2026-12-01T14:10:00Z', voided_at: null },
    { id: 's2', created_at: '2026-08-11T09:00:00Z', expires_at: '2026-10-10T09:00:00Z', voided_at: '2026-08-15T10:00:00Z' },
  ],
  panStatus: 'verified',
  payoutAccountStatus: 'verified',
  pendingTokens: 18400,
  paidTokens: 482300,
  now: NOW,
};

export type DetailState = 'populated' | 'suspended' | 'banned' | 'bare' | 'long';

export function detailFixture(state: DetailState): ProviderDetail {
  switch (state) {
    case 'suspended':
      return { ...BASE, profile: { ...BASE.profile, presence_online: false, suspended_until: '2026-11-24T00:00:00Z' } };
    case 'banned':
      return { ...BASE, profile: { ...BASE.profile, presence_online: false, is_available: false, suspended_until: '2999-01-01T00:00:00Z', delisted_at: '2026-10-30T08:00:00Z' } };
    case 'bare':
      return {
        ...BASE,
        profile: { ...BASE.profile, display_name: null, provider_category: null, identity_verified_at: null, presence_online: false, is_available: false, languages: null, headline: null, about: null, date_of_birth: null, rating_avg: null, rating_count: 0 },
        photos: [],
        batches: [],
        strikes: [],
        panStatus: null,
        payoutAccountStatus: null,
        pendingTokens: 0,
        paidTokens: 0,
      };
    case 'long':
      return {
        ...BASE,
        profile: {
          ...BASE.profile,
          display_name: LONG_ROW.display_name,
          provider_category: LONG_ROW.provider_category,
          headline: 'Twelve years reading Parashari charts, Jaimini timing, KP and Lal Kitab remedies across career, marriage, property and foreign-travel questions for clients across three continents.',
          about: BASE.profile.about + '\n\n' + 'Additional notes. '.repeat(30),
          languages: ['Hindi', 'English', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sanskrit', 'Marathi'],
        },
        strikes: [],
      };
    default:
      return BASE;
  }
}

export const NAV: ProviderNav = { position: 1, total: 64, prevId: null, nextId: PROVIDER_ROWS[1]!.id };
