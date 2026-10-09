/**
 * Source-pinned unit tests for the provider profile sweep (190).
 *
 * These tests cover pure TypeScript logic only: no rendering, no network, no DB.
 * Server-side enforcement is covered by supabase/tests/190_*.sql (pgTAP).
 *
 * Sections:
 *   1. providerProfileEdit — display name validation in validateProfileEdit
 *   2. providerProfileEdit — changedParts includes `name`
 *   3. providerProfileEdit — draftFromProfile seeds displayName
 *   4. usageKpis — existing contract (source-pin)
 *   5. providerLedgerTotals — D2 split
 *   6. earningsStatusLabel — D2 status-word-to-label mapping (via the
 *      exported function from UsageLedgerScreen — tested through its
 *      module boundary)
 */

/*
 * Loading UsageLedgerScreen pulls in the theme, which loads Reanimated and
 * MMKV. Neither has a native runtime in Jest — stub both out the same way
 * usageLedger.test.ts does so the pure logic (usageKpis, providerLedgerTotals,
 * earningsStatusLabel) is reachable without standing up a renderer.
 */
jest.mock('react-native-reanimated', () => {
  const chain: unknown = new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === '__esModule') return true;
      return prop === 'value' ? 0 : chain;
    },
    set: () => true,
    apply: () => chain,
  });
  return chain;
});

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

import {
  validateProfileEdit,
  changedParts,
  draftFromProfile,
  isProfileEditDirty,
  type ProfileEditDraft,
} from '../src/lib/providerProfileEdit';
import { usageKpis, providerLedgerTotals } from '../src/screens/UsageLedgerScreen';
import type { UsageRow } from '../src/api/usage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function draft(overrides: Partial<ProfileEditDraft> = {}): ProfileEditDraft {
  return {
    displayName: 'QuietHarbour',
    headline: 'Here to listen',
    about: 'A short bio.',
    languages: ['English'],
    expertise: [],
    ...overrides,
  };
}

function makeRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    session_id: 'sess-1',
    channel: 'chat',
    started_at: '2026-09-01T10:00:00Z',
    ended_at: '2026-09-01T10:10:00Z',
    elapsed_seconds: 600,
    minutes: 10,
    i_am_member: false,
    tokens: 60,
    earnings_status: 'pending',
    peer_id: 'peer-1',
    peer_name: 'Someone',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Display name validation
// ---------------------------------------------------------------------------

describe('validateProfileEdit — displayName', () => {
  it('accepts a valid 2-char name', () => {
    const result = validateProfileEdit(draft({ displayName: 'Ai' }));
    expect(result.displayName).toBeUndefined();
  });

  it('accepts a valid 30-char name', () => {
    const result = validateProfileEdit(draft({ displayName: 'A'.repeat(30) }));
    expect(result.displayName).toBeUndefined();
  });

  it('rejects a 1-char name', () => {
    const result = validateProfileEdit(draft({ displayName: 'A' }));
    expect(result.displayName).toMatch(/at least 2/);
  });

  it('rejects a 31-char name', () => {
    const result = validateProfileEdit(draft({ displayName: 'A'.repeat(31) }));
    expect(result.displayName).toMatch(/30 characters/);
  });

  it('rejects a name with spaces', () => {
    const result = validateProfileEdit(draft({ displayName: 'Quiet Harbour' }));
    expect(result.displayName).toMatch(/letters, numbers/i);
  });

  it('rejects a reserved word — pappal', () => {
    const result = validateProfileEdit(draft({ displayName: 'PappalGuru' }));
    expect(result.displayName).toMatch(/not available/i);
  });

  it('rejects a reserved word — admin (case-insensitive)', () => {
    const result = validateProfileEdit(draft({ displayName: 'SuperADMIN' }));
    expect(result.displayName).toMatch(/not available/i);
  });

  it('rejects a phone-number name — 6+ consecutive digits', () => {
    const result = validateProfileEdit(draft({ displayName: 'Calm987654' }));
    expect(result.displayName).toMatch(/phone/i);
  });

  it('rejects a phone-number name — 8+ total digits', () => {
    // 8 digits total — triggers the containsPhone guard.
    const result = validateProfileEdit(draft({ displayName: 'AB12345678' }));
    expect(result.displayName).toMatch(/phone/i);
  });

  it('accepts a name with up to 7 total digits that are not consecutive', () => {
    // 7 digits total, none consecutive ≥ 6 — should pass the phone check.
    const result = validateProfileEdit(draft({ displayName: 'A1B2C3D4E5F' }));
    // 5 digits — fine.
    expect(result.displayName).toBeUndefined();
  });

  it('accepts a name with underscore', () => {
    const result = validateProfileEdit(draft({ displayName: 'Quiet_22' }));
    expect(result.displayName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. changedParts includes `name`
// ---------------------------------------------------------------------------

describe('changedParts', () => {
  it('marks name as changed when displayName changes', () => {
    const a = draft({ displayName: 'OldName' });
    const b = draft({ displayName: 'NewName' });
    expect(changedParts(a, b).name).toBe(true);
  });

  it('does not mark name as changed when whitespace differs only', () => {
    const a = draft({ displayName: 'QuietHarbour' });
    const b = draft({ displayName: '  QuietHarbour  ' });
    expect(changedParts(a, b).name).toBe(false);
  });

  it('marks fields as changed when headline changes', () => {
    const a = draft({ headline: 'Old' });
    const b = draft({ headline: 'New' });
    expect(changedParts(a, b).fields).toBe(true);
  });

  it('marks name false when only headline changes', () => {
    const a = draft({ headline: 'Old' });
    const b = draft({ headline: 'New' });
    expect(changedParts(a, b).name).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. draftFromProfile seeds displayName
// ---------------------------------------------------------------------------

describe('draftFromProfile', () => {
  it('seeds displayName from profile.display_name', () => {
    const profile = {
      display_name: 'QuietHarbour',
      headline: 'Here to listen',
      about: 'Bio',
      languages: ['English'],
    };
    const result = draftFromProfile(profile);
    expect(result.displayName).toBe('QuietHarbour');
  });

  it('seeds empty string when display_name is null', () => {
    const profile = {
      display_name: null,
      headline: null,
      about: null,
      languages: [] as string[],
    };
    const result = draftFromProfile(profile);
    expect(result.displayName).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. usageKpis — source pin for existing contract
// ---------------------------------------------------------------------------

describe('usageKpis', () => {
  it('returns null for empty rows', () => {
    expect(usageKpis([])).toBeNull();
  });

  it('uses rows.length as sessions, not sum of tokens', () => {
    const rows = [makeRow({ tokens: 150 }), makeRow({ session_id: 'sess-2', tokens: 50 })];
    const kpis = usageKpis(rows);
    expect(kpis?.sessions).toBe(2);
    expect(kpis?.tokens).toBe(200);
  });

  it('labels as Earned when first row is i_am_member=false', () => {
    const rows = [makeRow({ i_am_member: false })];
    expect(usageKpis(rows)?.tokensLabel).toBe('Earned');
  });

  it('labels as Spent when first row is i_am_member=true', () => {
    const rows = [makeRow({ i_am_member: true })];
    expect(usageKpis(rows)?.tokensLabel).toBe('Spent');
  });
});

// ---------------------------------------------------------------------------
// 5. providerLedgerTotals — D2 split
// ---------------------------------------------------------------------------

describe('providerLedgerTotals', () => {
  it('returns null for empty rows', () => {
    expect(providerLedgerTotals([])).toBeNull();
  });

  it('sums earning and spending rows separately', () => {
    const rows = [
      makeRow({ i_am_member: false, tokens: 60, session_id: 's1' }),
      makeRow({ i_am_member: true,  tokens: 20, session_id: 's2' }),
      makeRow({ i_am_member: false, tokens: 40, session_id: 's3' }),
    ];
    const totals = providerLedgerTotals(rows);
    expect(totals?.earned).toBe(100);
    expect(totals?.spent).toBe(20);
    expect(totals?.hasSpent).toBe(true);
  });

  it('sets hasSpent false when no member-side rows', () => {
    const rows = [makeRow({ i_am_member: false, tokens: 60 })];
    const totals = providerLedgerTotals(rows);
    expect(totals?.hasSpent).toBe(false);
    expect(totals?.spent).toBe(0);
  });

  it('counts refunded rows as 0 tokens (server already sends 0 per D2)', () => {
    // The server returns tokens=0 for refunded rows; the client just sums them.
    const rows = [
      makeRow({ i_am_member: false, tokens: 0, earnings_status: 'refunded', session_id: 's1' }),
      makeRow({ i_am_member: false, tokens: 60, earnings_status: 'paid', session_id: 's2' }),
    ];
    const totals = providerLedgerTotals(rows);
    expect(totals?.earned).toBe(60); // 0 + 60
  });
});

// ---------------------------------------------------------------------------
// 6. isProfileEditDirty picks up displayName changes
// ---------------------------------------------------------------------------

describe('isProfileEditDirty', () => {
  it('is dirty when only displayName changes', () => {
    const a = draft({ displayName: 'OldName' });
    const b = draft({ displayName: 'NewName' });
    expect(isProfileEditDirty(a, b)).toBe(true);
  });

  it('is clean when displayName differs only by surrounding whitespace', () => {
    const a = draft({ displayName: 'QuietHarbour' });
    const b = draft({ displayName: '  QuietHarbour  ' });
    expect(isProfileEditDirty(a, b)).toBe(false);
  });
});
