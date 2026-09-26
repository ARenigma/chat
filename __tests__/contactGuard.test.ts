/**
 * The contact guard's mirror against the shared fixture.
 *
 * supabase/tests/contact_guard_cases.json is asserted here against the
 * TypeScript mirror and, through scripts/db-test.mjs, against the SQL. Both
 * must equal each row's `expect`, so the two detectors agree on every row.
 * `expect` is what the spec does today; `label` is the author's truth, and
 * the floors below say how far apart the two are allowed to drift.
 */
import cases from '../supabase/tests/contact_guard_cases.json';
import {
  CONTACT_GUARD_SPEC,
  contactCategory,
  contactFragment,
  contactGuardPrefilter,
  contactGuardRules,
  contactGuardRulesUnfiltered,
  contactReason,
  contactWindow,
  isContactBlocked,
} from '../src/lib/contactGuard.generated';
import { contactGuardNotice, precheckContactGuard } from '../src/lib/contactGuard';

type Row = {
  text: string;
  label: 'hard' | 'signal' | 'allow' | 'reference';
  set: string;
  expect: { rules: string[]; signals: string[] };
};
type Sequence = {
  messages: string[];
  label: 'split' | 'benign';
  set: string;
  expect: { windows: (string | null)[] };
};

const rows = cases.rows as Row[];
const sequences = cases.sequences as Sequence[];

describe('contact guard mirror', () => {
  it('is the spec the fixture was recorded against', () => {
    expect(cases.spec).toBe(CONTACT_GUARD_SPEC);
  });

  it('returns the recorded hard rules on every fixture row', () => {
    const differ = rows
      .filter(r => JSON.stringify(contactGuardRules(r.text)) !== JSON.stringify(r.expect.rules))
      .map(r => r.text);
    expect(differ).toEqual([]);
  });

  it('blocks exactly when a hard rule fires', () => {
    const differ = rows.filter(r => isContactBlocked(r.text) !== r.expect.rules.length > 0);
    expect(differ.map(r => r.text)).toEqual([]);
  });

  it('never lets the prefilter hide a hit', () => {
    const hidden = rows.filter(
      r => contactGuardRulesUnfiltered(r.text).length > 0 && !contactGuardPrefilter(r.text),
    );
    expect(hidden.map(r => r.text)).toEqual([]);
  });

  it('answers every recorded window the same way', () => {
    const differ = sequences.filter(s => {
      const got = s.messages.map((_, i) => contactWindow(s.messages.slice(Math.max(0, i - 5), i + 1)));
      return JSON.stringify(got) !== JSON.stringify(s.expect.windows);
    });
    expect(differ.map(s => s.messages)).toEqual([]);
  });
});

/**
 * Floors that can only rise. Measured on spec b0130d3b: blind2 was written by
 * an author who never saw the spec and scored once, after tuning froze;
 * blind1 was scored once the same way, then tuned on.
 */
const FLOORS: Record<string, { hard: number; allowBlocked: number; reference: number }> = {
  probes: { hard: 34, allowBlocked: 0, reference: 3 },
  blind1: { hard: 170, allowBlocked: 0, reference: 30 },
  blind2: { hard: 108, allowBlocked: 0, reference: 20 },
};

describe('contact guard recall and false blocks', () => {
  for (const [set, floor] of Object.entries(FLOORS)) {
    it(`${set}: holds its recall floor and false-block ceiling`, () => {
      const inSet = rows.filter(r => r.set === set);
      const blocked = (r: Row) => isContactBlocked(r.text);
      expect(inSet.filter(r => r.label === 'hard' && blocked(r)).length).toBeGreaterThanOrEqual(floor.hard);
      expect(inSet.filter(r => r.label === 'allow' && blocked(r)).length).toBeLessThanOrEqual(floor.allowBlocked);
      expect(inSet.filter(r => r.label === 'reference' && blocked(r)).length).toBe(floor.reference);
    });
  }

  it('never hard-blocks a benign sequence', () => {
    const hits = sequences
      .filter(s => s.label === 'benign')
      .filter(s => s.messages.some((m, i) => isContactBlocked(m) || contactWindow(s.messages.slice(Math.max(0, i - 5), i + 1)) !== null));
    expect(hits.map(s => s.messages)).toEqual([]);
  });
});

describe('contact guard categories and reasons', () => {
  const read = (text: string) => {
    const rules = contactGuardRules(text);
    return { category: contactCategory(rules), reason: contactReason(rules) };
  };

  it('names the identifier it found', () => {
    expect(read('mera number 70158 84326').category).toBe('phone');
    expect(read('priya.sharma95@gmail.com').category).toBe('email');
    expect(read('rohan99@ybl').category).toBe('payment');
    expect(read('HDFC0001234').category).toBe('payment');
    expect(read('www.astroseva.in').category).toBe('link');
    expect(read('@priya.astro').category).toBe('handle');
    expect(read('kal milte hain').category).toBeNull();
  });

  it('marks a bare long reference so the copy can point to Help', () => {
    expect(read('UTR 402911882345 ka paisa nahi aaya')).toEqual({ category: 'phone', reason: 'reference' });
    expect(read('mera number 70158 84326').reason).toBeNull();
  });
});

describe('contact guard fragments', () => {
  it('reads digit groups with carrier words as a fragment', () => {
    expect(contactFragment('mera number 70158')).toBe('70158');
    expect(contactFragment('aur 84326 🙏')).toBe('84326');
    expect(contactFragment('pehle 5 digit 93154')).toBe('93154');
  });

  it('does not read a time, a date, a price or a lone digit as one', () => {
    expect(contactFragment('4:35')).toBe('');
    expect(contactFragment('12/08')).toBe('');
    expect(contactFragment('99.5')).toBe('');
    expect(contactFragment('9')).toBe('');
    expect(contactFragment('kya haal hai')).toBe('');
  });

  it('completes a number only on the message that completes it, in either order', () => {
    expect(contactWindow(['70158'])).toBeNull();
    expect(contactWindow(['70158', '84326'])).toBe('7015884326');
    expect(contactWindow(['54321', '98765'])).toBe('9876554321');
    expect(contactWindow(['kitne ka pack hai?', '500', 'ok 1000 wala'])).toBeNull();
  });
});

/**
 * The mirror runs on send, never per keystroke, but a 4,000-character draft
 * (the body cap) must still stay far under a frame. Postgres is linear on
 * these shapes (the ARE engine is a hybrid DFA); a JavaScript backtracking
 * blowup would show here first.
 */
describe('contact guard cost', () => {
  const shapes = [
    'a1 '.repeat(1334),
    'whatsapp '.repeat(445),
    '9 '.repeat(2000),
    '@'.repeat(4000),
    'a.'.repeat(2000),
    'नौ '.repeat(1334),
    'insta pe '.repeat(445),
    '98765 '.repeat(667),
    'x@y.'.repeat(1000),
    'double nine '.repeat(334),
    '9🔥'.repeat(1333),
  ];

  it.each(shapes.map(s => [s.slice(0, 12), s]))('%s… stays under 60 ms', (_label, shape) => {
    isContactBlocked(shape);
    const start = Date.now();
    isContactBlocked(shape);
    contactGuardRules(shape);
    expect(Date.now() - start).toBeLessThan(60);
  });
});

describe('the composer precheck', () => {
  it('predicts nothing outside enforce mode', () => {
    expect(precheckContactGuard('mera number 70158 84326', 'shadow')).toBeNull();
    expect(precheckContactGuard('mera number 70158 84326', 'off')).toBeNull();
  });

  it('explains a block before the send in enforce mode', () => {
    const refusal = precheckContactGuard('mera number 70158 84326', 'enforce');
    expect(refusal).toEqual(expect.objectContaining({ error: 'CONTACT_INFO', category: 'phone' }));
    expect(contactGuardNotice(refusal)).toMatch(/Phone numbers can't be shared/);
  });

  it('lets an ordinary message through in enforce mode', () => {
    expect(precheckContactGuard('DOB 12/08/1995 4:35 am patna', 'enforce')).toBeNull();
  });

  it('checks the window over the sender’s own recent messages', () => {
    const refusal = precheckContactGuard('84326', 'enforce', ['70158']);
    expect(refusal).toEqual(expect.objectContaining({ error: 'CONTACT_INFO', category: 'window' }));
  });
});
