/**
 * The birth-details card: the one line it sends, the grammar the transcript
 * reads it back with, and the contact guard's verdict on it.
 *
 * The guard is not told about the card. The card's shape is chosen so the
 * guard cannot fire on it (src/lib/birthDetails.ts), and that claim is checked
 * here against the real mirror over the pickers' whole digit space, and in
 * supabase/tests/contact_guard_cases.json (set `birth_card`), which Jest and
 * pgTAP both assert, so the SQL agrees on the same rows.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import cases from '../supabase/tests/contact_guard_cases.json';
import {
  BIRTH_YEAR_MIN,
  birthPlaceProblem,
  formatBirthDetails,
  formatBirthTime,
  isBirthDateValid,
  parseBirthDetails,
  type BirthDetails,
} from '../src/lib/birthDetails';
import {
  birthDateStart,
  pickBirthDate,
  pickBirthTime,
} from '../src/lib/birthPicker';
import {
  contactGuardRules,
  contactWindow,
} from '../src/lib/contactGuard.generated';
import { precheckContactGuard } from '../src/lib/contactGuard';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const TODAY = new Date(2026, 8, 27, 12, 0, 0);
const card = (over: Partial<BirthDetails> = {}): BirthDetails => ({
  date: { year: 1994, month: 8, day: 14 },
  time: { hour: 6, minute: 40 },
  place: 'Pune',
  ...over,
});

describe('formatBirthDetails', () => {
  it('writes the one shape', () => {
    expect(formatBirthDetails(card(), TODAY)).toBe(
      'Birth details: 14 Aug 1994, 6:40 am, Pune',
    );
    expect(formatBirthDetails(card({ time: null }), TODAY)).toBe(
      'Birth details: 14 Aug 1994, time unknown, Pune',
    );
    expect(
      formatBirthDetails(
        card({
          date: { year: 2001, month: 12, day: 31 },
          time: { hour: 23, minute: 5 },
          place: '  Navi   Mumbai ',
        }),
        TODAY,
      ),
    ).toBe('Birth details: 31 Dec 2001, 11:05 pm, Navi Mumbai');
  });

  it.each([
    [0, 0, '12:00 am'],
    [0, 59, '12:59 am'],
    [11, 59, '11:59 am'],
    [12, 0, '12:00 pm'],
    [13, 7, '1:07 pm'],
    [23, 59, '11:59 pm'],
  ])('%i:%i is %s', (hour, minute, expected) => {
    expect(formatBirthTime({ hour, minute })).toBe(expected);
  });

  it('refuses what the pickers cannot give or the place must not hold', () => {
    expect(
      formatBirthDetails(
        card({ date: { year: 2026, month: 9, day: 28 } }),
        TODAY,
      ),
    ).toBeNull();
    expect(
      formatBirthDetails(
        card({ date: { year: 1899, month: 12, day: 31 } }),
        TODAY,
      ),
    ).toBeNull();
    expect(
      formatBirthDetails(
        card({ date: { year: 1999, month: 2, day: 29 } }),
        TODAY,
      ),
    ).toBeNull();
    expect(
      formatBirthDetails(card({ time: { hour: 24, minute: 0 } }), TODAY),
    ).toBeNull();
    expect(formatBirthDetails(card({ place: 'Sector 62' }), TODAY)).toBeNull();
    expect(formatBirthDetails(card({ place: 'P' }), TODAY)).toBeNull();
  });

  it('keeps today and leap days', () => {
    expect(isBirthDateValid({ year: 2026, month: 9, day: 27 }, TODAY)).toBe(
      true,
    );
    expect(isBirthDateValid({ year: 2000, month: 2, day: 29 }, TODAY)).toBe(
      true,
    );
    expect(
      isBirthDateValid({ year: BIRTH_YEAR_MIN, month: 1, day: 1 }, TODAY),
    ).toBe(true);
  });

  it('explains a bad place in words', () => {
    expect(birthPlaceProblem('Pune')).toBeNull();
    expect(birthPlaceProblem('नई दिल्ली')).toBeNull();
    expect(
      birthPlaceProblem("Coxs Bazar, Chittagong (old town) - St. Mary's"),
    ).toBeNull();
    expect(birthPlaceProblem('Pune 411001')).toBe(
      'A place of birth has no numbers. Enter the city only.',
    );
    expect(birthPlaceProblem('Pune ४११')).toBe(
      'A place of birth has no numbers. Enter the city only.',
    );
    expect(birthPlaceProblem('me@mail')).toBe('Use letters only for the city.');
    expect(birthPlaceProblem(' ')).toBe('Enter the city you were born in.');
    expect(birthPlaceProblem('a'.repeat(61))).toBe(
      'Keep it under 60 characters.',
    );
  });
});

describe('parseBirthDetails', () => {
  it('reads back every line the card writes', () => {
    for (const details of [
      card(),
      card({ time: null }),
      card({ time: { hour: 0, minute: 0 } }),
      card({ time: { hour: 12, minute: 30 }, place: 'नई दिल्ली' }),
    ]) {
      const line = formatBirthDetails(details, TODAY);
      expect(line).not.toBeNull();
      expect(parseBirthDetails(line)).toEqual(details);
    }
  });

  it.each([
    'Birth details: 14 Aug 1994, 6:40 am',
    'birth details: 14 Aug 1994, 6:40 am, Pune',
    'Birth details: 14 August 1994, 6:40 am, Pune',
    'Birth details: 014 Aug 1994, 6:40 am, Pune',
    'Birth details: 14 Aug 1994, 06:40 am, Pune',
    'Birth details: 14 Aug 1994, 18:40, Pune',
    'Birth details: 31 Feb 1994, 6:40 am, Pune',
    'Birth details: 14 Aug 1994, 6:40 am, Pune 411001',
    'Birth details: 14 Aug 1994, 6:40 am,  Pune',
    'Birth details: 14 Aug 1994, 6:40 am, pune@mail',
  ])('is not a card: %s', line => {
    expect(parseBirthDetails(line)).toBeNull();
  });

  it('is not a card for null, voice or empty', () => {
    expect(parseBirthDetails(null)).toBeNull();
    expect(parseBirthDetails(undefined)).toBeNull();
    expect(parseBirthDetails('')).toBeNull();
  });
});

describe('the contact guard never fires on a card', () => {
  const PLACES = ['Pune', 'Navi Mumbai', 'Sri Ganganagar', 'नई दिल्ली'];

  it('over every day and year the date picker offers', () => {
    let checked = 0;
    for (let year = BIRTH_YEAR_MIN; year <= 2026; year += 1) {
      for (let day = 1; day <= 31; day += 1) {
        for (const [hour, minute] of [
          [0, 0],
          [9, 59],
          [10, 45],
          [11, 59],
          [21, 8],
          [23, 19],
        ] as const) {
          const month = ((day + year) % 12) + 1;
          const line = formatBirthDetails(
            {
              date: { year, month, day },
              time: { hour, minute },
              place: PLACES[day % 4] as string,
            },
            new Date(2026, 11, 31),
          );
          if (line === null) {
            continue;
          }
          checked += 1;
          expect(contactGuardRules(line)).toEqual([]);
        }
      }
    }
    expect(checked).toBeGreaterThan(20_000);
  });

  it('over every minute of the day, on the days with the most digits', () => {
    for (const day of [9, 10, 19, 28, 31]) {
      for (const year of [1900, 1999, 2026]) {
        for (let m = 0; m < 24 * 60; m += 1) {
          const line = formatBirthDetails(
            {
              date: { year, month: 1, day },
              time: { hour: Math.floor(m / 60), minute: m % 60 },
              place: 'Pune',
            },
            new Date(2026, 11, 31),
          );
          expect(line).not.toBeNull();
          expect(contactGuardRules(line as string)).toEqual([]);
        }
      }
    }
  });

  it('in every month and with the time unknown', () => {
    for (let month = 1; month <= 12; month += 1) {
      const line = formatBirthDetails(
        card({ date: { year: 1990, month, day: 9 }, time: null }),
        TODAY,
      ) as string;
      expect(contactGuardRules(line)).toEqual([]);
    }
  });

  it('breaks the split-number window rather than joining it', () => {
    const line = formatBirthDetails(card(), TODAY) as string;
    expect(contactWindow(['98765', line, '43210'])).toBeNull();
    expect(contactWindow([line, '43210'])).toBeNull();
    expect(precheckContactGuard(line, 'enforce', ['98765'])).toBeNull();
  });

  it('is pinned for both detectors in the shared fixture', () => {
    const rows = (
      cases as {
        rows: { text: string; set: string; expect: { rules: string[] } }[];
      }
    ).rows.filter(r => r.set === 'birth_card');
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const r of rows) {
      expect(parseBirthDetails(r.text)).not.toBeNull();
      expect(r.expect.rules).toEqual([]);
    }
  });
});

describe('the pickers', () => {
  it('answer null without the native module', async () => {
    await expect(pickBirthDate(null, TODAY)).resolves.toBeNull();
    await expect(pickBirthTime(null)).resolves.toBeNull();
  });

  it('open 25 years back', () => {
    expect(birthDateStart(TODAY)).toEqual({ year: 2001, month: 1, day: 1 });
  });

  it('are the framework dialogs in a DialogFragment, bounded, following the clock setting', () => {
    const kt = read(
      'android/app/src/main/java/com/companionchat/BirthPickerModule.kt',
    );
    expect(kt).toContain(
      'https://developer.android.com/develop/ui/views/components/pickers',
    );
    expect(kt).toMatch(
      /class BirthDateDialogFragment : BirthPickerDialogFragment\(\), DatePickerDialog\.OnDateSetListener/,
    );
    expect(kt).toMatch(
      /class BirthTimeDialogFragment : BirthPickerDialogFragment\(\), TimePickerDialog\.OnTimeSetListener/,
    );
    expect(kt).toContain('DateFormat.is24HourFormat(requireContext())');
    // Max before min: a min past the default max throws.
    expect(kt.indexOf('datePicker.maxDate')).toBeLessThan(
      kt.indexOf('datePicker.minDate'),
    );
    expect(
      read('android/app/src/main/java/com/companionchat/MainApplication.kt'),
    ).toContain('add(BirthPickerPackage())');
  });
});

describe('the card in the chat', () => {
  it('is offered only in a member chat with an astrologer', () => {
    const controller = read('src/chat-v2/useChatV2Controller.ts');
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    const composer = read('src/chat-v2/ChatComposerV2.tsx');
    expect(controller).toMatch(
      /peerIsAstrologer:\s*isMemberSide && provider\?\.provider_category === 'astrologer'/,
    );
    expect(screen).toMatch(
      /chat\.peerIsAstrologer && !benchmarkReadOnly \? openBirthDetails : undefined/,
    );
    expect(screen).toContain('onBirthDetails={onBirthDetails}');
    expect(composer).toMatch(/\{onBirthDetails !== undefined \? \(/);
    expect(composer).toContain('testID="chat-v2-birth-details"');
  });

  it('sends through the chat’s own send path, the precheck included', () => {
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    const sheet = read('src/chat-v2/BirthDetailsSheet.tsx');
    // Through `onSendBirthDetails`, which holds the card for the session-start
    // dialog and otherwise calls `onSend`.
    expect(screen).toMatch(/<BirthDetailsSheet[\s\S]*?onSend=\{onSendBirthDetails\}/);
    expect(screen).toMatch(/return onSend\(body\);/);
    expect(sheet).toMatch(/if \(onSend\(body\)\) \{\s*onClose\(\);/);
    expect(sheet).toContain('pickBirthDate(date)');
    expect(sheet).toContain('pickBirthTime(time)');
    expect(sheet).toContain("I don't know the time");
  });

  it('renders as a card on both sides', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');
    expect(cell).toContain(
      'const birth = useMemo(() => parseBirthDetails(text), [text]);',
    );
    expect(cell).toMatch(/birth !== null \? \(\s*<BirthCardBody/);
    expect(cell).toContain('testID="chat-v2-birth-card"');
    // Both sides: the card takes `mine` for its ink, and no side is excluded.
    expect(cell).toMatch(
      /const ink = mine \? styles\.quoteInkMine : styles\.quoteInkPeer;/,
    );
  });
});
