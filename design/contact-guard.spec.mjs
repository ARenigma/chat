/**
 * The contact guard's one rule spec.
 *
 * `scripts/gen-contact-guard.mjs` turns this file into two detectors that must
 * agree: generated PL/pgSQL in a migration (the server, which decides) and
 * `src/lib/contactGuard.generated.ts` (the app's mirror, which only predicts).
 * Never edit either output. Edit this file, run `npm run contact-guard`, and
 * `npm run contact-guard:check` fails the build on drift (RULE 4).
 *
 * Owner policy (Amit, 2026-09-25):
 *   * HARD rules find an actual identifier, however disguised: a phone number,
 *     an email, a UPI id or bank detail, a link, a social handle. A hard hit
 *     blocks the send once the mode switch says `enforce`.
 *   * SIGNAL rules find intent with no identifier ("WA pe aao"). They are
 *     logged for review and never block. They are emitted into SQL only, so the
 *     intent lexicon is not readable from the APK.
 *   * UTR and order numbers stay blocked (any run of 10+ digits); the refusal
 *     carries reason `reference` so the copy can point to Help.
 *
 * THE DIALECT. Every pattern must mean the same thing to Postgres's ARE engine
 * and to a JavaScript RegExp with the `u` flag. So patterns never use \d \w \s
 * \b (on the live database \d matches Devanagari digits, and in Postgres \b is
 * a backspace), never `.` unescaped, never a lazy quantifier, never a
 * back-reference in the pattern, and never a bound above 255 (Postgres's
 * RE_DUP_MAX). Code points are written \uXXXX, or \UXXXXXXXX above the BMP.
 * Alternations are built with alt(), which sorts longest-first: Postgres takes
 * the longest alternative and JavaScript the first, and sorting plus explicit
 * boundaries leaves only one possible match. Replacement boundaries matter;
 * boolean rules only need the same language. The generator lints every
 * pattern against this list and refuses to emit on a violation.
 *
 * Tuning history: v1 of this spec was scored once on a blind set written by an
 * author who never saw it (supabase/tests/contact_guard_cases.json, set
 * "blind1", scores in the fixture's header), then tuned on that set's misses.
 * Set "blind2" was written the same way and scored only after tuning froze.
 */

/** Escape a literal word for use inside a pattern. */
const lit = word => word.replace(/[.+*?()[\]{}|^$\\]/g, m => `\\${m}`);

/** A longest-first alternation of literal words, so both engines pick the same one. */
export const alt = words =>
  [...new Set(words)]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .map(lit)
    .join('|');

// ---------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------

/** Digit words, per language, romanised and native. Value is the digit. */
const DIGIT_WORDS = {
  0: [
    'zero',
    'shunya',
    'shoonya',
    'sunya',
    'shunyo',
    'shunno',
    'sunna',
    'sonne',
    'sifar',
    'poojyam',
    'pujyam',
    'शून्य',
    'सुन्य',
    'जीरो',
    'ज़ीरो',
    'शुन्य',
    'শূন্য',
  ],
  1: [
    'one',
    'ek',
    'ekk',
    'ikk',
    'okati',
    'ondu',
    'onnu',
    'ondru',
    'एक',
    'वन',
    'এক',
  ],
  2: [
    'two',
    'do',
    'doo',
    'don',
    'dui',
    'rendu',
    'irandu',
    'eradu',
    'दो',
    'दोन',
    'टू',
    'দুই',
  ],
  3: [
    'three',
    'teen',
    'tin',
    'tinn',
    'theen',
    'tran',
    'moodu',
    'mooru',
    'moonu',
    'moondru',
    'तीन',
    'थ्री',
    'তিন',
  ],
  4: [
    'four',
    'char',
    'chaar',
    'naalugu',
    'naalku',
    'naangu',
    'naalu',
    'चार',
    'फोर',
    'চার',
  ],
  5: [
    'five',
    'paanch',
    'panch',
    'paach',
    'panj',
    'aidu',
    'ainthu',
    'anju',
    'पांच',
    'पाँच',
    'पाच',
    'फाइव',
    'পাঁচ',
  ],
  6: [
    'six',
    'chhe',
    'chhah',
    'chah',
    'chheh',
    'cheh',
    'chhai',
    'chhoy',
    'chha',
    'saha',
    'aaru',
    'छह',
    'छः',
    'छे',
    'सहा',
    'सिक्स',
    'ছয়',
  ],
  7: ['seven', 'saat', 'satt', 'edu', 'ezhu', 'elu', 'सात', 'सेवन', 'সাত'],
  8: [
    'eight',
    'aath',
    'aat',
    'atth',
    'enimidi',
    'ettu',
    'entu',
    'आठ',
    'एट',
    'আট',
  ],
  9: [
    'nine',
    'nau',
    'nav',
    'noy',
    'tommidi',
    'onbathu',
    'onbadhu',
    'ombattu',
    'नौ',
    'नऊ',
    'नाइन',
    'নয়',
  ],
};

/** English teens and tens. A tens word becomes "<d>~", resolved after units. */
const ENGLISH_TEENS = {
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
};
const ENGLISH_TENS = {
  twenty: '2~',
  thirty: '3~',
  forty: '4~',
  fourty: '4~',
  fifty: '5~',
  sixty: '6~',
  seventy: '7~',
  eighty: '8~',
  ninety: '9~',
};

/**
 * Hindi 10 to 99, the common romanisations of each. "saath" (sixty, also
 * "with") is left out on purpose.
 */
const HINDI_NUMBERS = {
  das: '10',
  gyarah: '11',
  gyara: '11',
  barah: '12',
  bara: '12',
  terah: '13',
  tera: '13',
  chaudah: '14',
  chauda: '14',
  pandrah: '15',
  pandra: '15',
  solah: '16',
  sola: '16',
  satrah: '17',
  satra: '17',
  atharah: '18',
  athara: '18',
  unnis: '19',
  unees: '19',
  bees: '20',
  ikkis: '21',
  ikkees: '21',
  bais: '22',
  baees: '22',
  teis: '23',
  tees: '30',
  chaubis: '24',
  chobis: '24',
  pachchis: '25',
  pachis: '25',
  chhabbis: '26',
  chabbis: '26',
  sattais: '27',
  sataees: '27',
  atthais: '28',
  athais: '28',
  untis: '29',
  iktis: '31',
  battis: '32',
  taintis: '33',
  tetis: '33',
  chauntis: '34',
  chautis: '34',
  paintis: '35',
  chhattis: '36',
  chattis: '36',
  saintis: '37',
  adtis: '38',
  artis: '38',
  untalis: '39',
  chalis: '40',
  chaalis: '40',
  iktalis: '41',
  bayalis: '42',
  byalis: '42',
  taintalis: '43',
  tetalis: '43',
  chauvalis: '44',
  chawalis: '44',
  paintalis: '45',
  chhiyalis: '46',
  saintalis: '47',
  adtalis: '48',
  artalis: '48',
  unchas: '49',
  pachas: '50',
  pachaas: '50',
  ikyavan: '51',
  ikyawan: '51',
  bavan: '52',
  baawan: '52',
  tirpan: '53',
  trepan: '53',
  chauvan: '54',
  chauwan: '54',
  pachpan: '55',
  chhappan: '56',
  chappan: '56',
  sattavan: '57',
  sattawan: '57',
  atthavan: '58',
  athawan: '58',
  unsath: '59',
  iksath: '61',
  basath: '62',
  tirsath: '63',
  chausath: '64',
  painsath: '65',
  chhiyasath: '66',
  sadsath: '67',
  adsath: '68',
  arsath: '68',
  unhattar: '69',
  sattar: '70',
  ikhattar: '71',
  bahattar: '72',
  tihattar: '73',
  chauhattar: '74',
  pachhattar: '75',
  chhihattar: '76',
  sathattar: '77',
  satattar: '77',
  sattattar: '77',
  athattar: '78',
  unasi: '79',
  assi: '80',
  ikyasi: '81',
  bayasi: '82',
  tirasi: '83',
  chaurasi: '84',
  pachasi: '85',
  chhiyasi: '86',
  sattasi: '87',
  athasi: '88',
  nawasi: '89',
  navasi: '89',
  nabbe: '90',
  nabbey: '90',
  ikyanve: '91',
  banve: '92',
  baanve: '92',
  tiranve: '93',
  chauranve: '94',
  pachanve: '95',
  chhiyanve: '96',
  sattanve: '97',
  athanve: '98',
  ninyanve: '99',
};

const NUMBER_DICT = Object.fromEntries([
  ...Object.entries(DIGIT_WORDS).flatMap(([d, words]) =>
    words.map(w => [w, d]),
  ),
  ...Object.entries(ENGLISH_TEENS),
  ...Object.entries(ENGLISH_TENS),
  ...Object.entries(HINDI_NUMBERS),
]);

/** The same words, marked (§) so a copy can tell word digits from typed ones. */
const MARKED_NUMBER_DICT = Object.fromEntries(
  Object.entries(NUMBER_DICT).map(([w, d]) => [w, `${d}§`]),
);

/**
 * One messenger's name is assembled rather than written, because the repo
 * never spells it in code (its attribution lives only in
 * THIRD_PARTY_LICENSES.md). The generator also emits its "g" as a \u0067 escape in
 * every pattern, so neither output spells it either; both engines read the
 * escape as the letter.
 */
const TG = ['tele', 'gram'].join('');

/** Apps a handle or a hand-off can name. */
const APPS = [
  'instagram',
  'insta',
  'ig',
  'snapchat',
  'snap',
  'sc',
  TG,
  'tele',
  'tg',
  'twitter',
  'facebook',
  'fb',
  'discord',
  'skype',
  'kik',
  'wechat',
  'threads',
  'youtube',
  'yt',
  'moj',
  'josh',
  'sharechat',
  'linkedin',
  'signal',
  'imo',
  'koo',
  'tiktok',
  'reddit',
  'pinterest',
  'clubhouse',
  'whatsapp',
  'watsapp',
  'whatsap',
  'watsap',
  'wtsp',
  'arattai',
  'jiochat',
  'hike',
  'botim',
  'इंस्टा',
  'इंस्टाग्राम',
  'व्हाट्सएप',
  'व्हाट्सऐप',
  'वॉट्सऐप',
  'टेलीग्राम',
  'फेसबुक',
  'स्नैपचैट',
];

/** UPI handles (the part after @ in a VPA). */
const UPI = [
  'okaxis',
  'okhdfcbank',
  'okicici',
  'oksbi',
  'ybl',
  'ibl',
  'axl',
  'paytm',
  'upi',
  'apl',
  'yapl',
  'ptyes',
  'ptsbi',
  'pthdfc',
  'ptaxis',
  'jupiteraxis',
  'fbl',
  'kotak',
  'icici',
  'sbi',
  'hdfcbank',
  'axisbank',
  'idfcbank',
  'idfcfirst',
  'freecharge',
  'airtel',
  'ikwik',
  'waicici',
  'wahdfcbank',
  'waaxis',
  'wasbi',
  'slc',
  'timecosmos',
  'pingpay',
  'abfspay',
  'axisb',
  'yesbank',
  'yesbankltd',
  'rbl',
  'indus',
  'federal',
  'kbl',
  'aubank',
  'barodampay',
  'mahb',
  'cnrb',
  'pnb',
  'boi',
  'uboi',
  'unionbank',
  'citi',
  'hsbc',
  'dbs',
  'equitas',
  'jio',
  'amazonpay',
  'apay',
  'gpay',
  'superyes',
  'tapicici',
  'naviaxis',
  'niyoicici',
  'yescred',
  'kmbl',
  'okbizaxis',
  'phonepe',
  'bhim',
  'sib',
  'dlb',
  'kvb',
  'tjsb',
  'utbi',
  'allbank',
  'andb',
];

/** Mail providers, for addresses written without an @. */
const MAIL = [
  'gmail',
  'googlemail',
  'yahoo',
  'ymail',
  'outlook',
  'hotmail',
  'live',
  'rediffmail',
  'rediff',
  'icloud',
  'protonmail',
  'proton',
  'zoho',
  'aol',
];

/** Short-link and platform domains. */
const KNOWN_DOMAINS = [
  'wa.me',
  't.me',
  `${TG}.me`,
  `${TG}.dog`,
  `${TG}.org`,
  'chat.whatsapp.com',
  'api.whatsapp.com',
  'whatsapp.com',
  'instagram.com',
  'instagr.am',
  'ig.me',
  'fb.com',
  'fb.me',
  'facebook.com',
  'youtube.com',
  'youtu.be',
  'linktr.ee',
  'bit.ly',
  'tinyurl.com',
  'snapchat.com',
  'x.com',
  'twitter.com',
  'discord.gg',
  'discord.com',
  'signal.me',
  'signal.group',
  'linkedin.com',
  'lnkd.in',
  'goo.gl',
  'forms.gle',
  'shorturl.at',
  'rb.gy',
  'cutt.ly',
  'is.gd',
  't.co',
  'threads.net',
  'sharechat.com',
  'snap.com',
  'skype.com',
  'join.skype.com',
];

/** Top-level domains a bare "name.tld" is read as a link for. */
const TLDS = [
  'com',
  'net',
  'org',
  'info',
  'biz',
  'xyz',
  'app',
  'site',
  'online',
  'store',
  'shop',
  'live',
  'guru',
  'blog',
  'link',
  'page',
  'tech',
  'club',
  'top',
  'io',
  'ai',
  'me',
  'in',
  'us',
  'uk',
  'tv',
  'gg',
  'ly',
  'to',
  'dev',
  'world',
  'life',
  'space',
  'website',
  'fun',
  'pro',
  'one',
  'vip',
  'ink',
  'cc',
  'ws',
  'bio',
  'social',
  'chat',
  'email',
  'care',
  'help',
  'services',
  'studio',
  'academy',
  'today',
  'news',
  'media',
  'digital',
  'network',
  'cloud',
  'host',
  'art',
  'love',
  'astrology',
  'yoga',
  'ee',
  'be',
  'gle',
  'am',
  'gd',
];

/** Words after an @ that address a person or a time, not a handle. */
const NOT_A_HANDLE = [
  'home',
  'work',
  'office',
  'ghar',
  'night',
  'morning',
  'evening',
  'noon',
  'all',
  'everyone',
  'here',
  'there',
  'pappal',
  'admin',
  'support',
  'time',
  'sir',
  'madam',
  'mam',
  'maam',
  'ji',
  'didi',
  'bhaiya',
  'bhai',
  'guruji',
  'pandit',
  'panditji',
  'baba',
  'team',
  'you',
  'me',
];

// ---------------------------------------------------------------------------
// Pattern pieces
// ---------------------------------------------------------------------------

const APP = `(?:${alt(APPS)})`;
const UPIW = `(?:${alt(UPI)})`;
const MAILW = `(?:${alt(MAIL)})`;
const TLD = `(?:${alt(TLDS)})`;
/** A letter boundary that also knows Devanagari and Bengali letters. */
const NL = String.raw`[a-z\u0900-\u097f\u0980-\u09ff]`;
/** A handle-like token: letters and digits with a digit, dot or underscore in it. */
const IDTOKEN = String.raw`(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])`;
/** The mobile shape once separators are gone. */
const MOBILE = String.raw`(?:91|0)?[6-9][0-9]{9}`;
/** A separator inside a written number: spaces, dots, slashes, hyphens, brackets, a currency sign. */
const SEP = String.raw`[ .()/\u20b9$\u20ac\u00a3-]{0,3}`;
/** A calendar date with a 19xx or 20xx year, in any of . / - or space. */
/**
 * Copy guards, each a NECESSARY condition on copy t for any rule on that copy
 * to fire, so a copy that cannot matter is never built. They are what keeps
 * an ordinary message inside Postgres's 32-entry compiled-regex cache (past
 * it, every call recompiles everything). Jest proves on every fixture row
 * that the guards and the prefilter never change a verdict.
 */
const PHONE_GUARD = `[0-9]|(?<!${NL})(?:${alt([
  ...Object.keys(NUMBER_DICT),
  'double',
  'triple',
])})(?!${NL})`;
const DIGIT_GUARD = '[0-9]';
const TEXT_ID_GUARD = String.raw`[@#[({<]|[a-z0-9_][ ]*\.[ ]*[a-z]|(?<!${NL})(?:${alt(
  [
    ...APPS,
    ...MAIL,
    'dot',
    'daat',
    'dott',
    'point',
    'underscore',
    'under score',
    'at',
    'attherate',
    'www',
    'http',
    'https',
    'ftp',
    'id',
    'username',
    'user name',
    'userid',
    'handle',
  ],
)})(?!${NL})`;

const DATE = String.raw`(?<![0-9])(?:0?[1-9]|[12][0-9]|3[01])[ ]?[ ./-][ ]?(?:0?[1-9]|1[0-2])[ ]?[ ./-][ ]?(?:19|20)[0-9]{2}(?![0-9])|(?<![0-9])(?:19|20)[0-9]{2}[ ]?[./-][ ]?(?:0?[1-9]|1[0-2])[ ]?[./-][ ]?(?:0?[1-9]|[12][0-9]|3[01])(?![0-9])`;

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
// `fold` is the generated table in contact-guard.tables.json: every Unicode
// decimal digit to 0-9 by value, and every letter or symbol whose
// compatibility decomposition is one ASCII letter, digit or @ . + # _ : / -
// (fullwidth, mathematical, circled, accented), plus hand-listed Cyrillic and
// Greek look-alikes (CONFUSABLES below). It never maps an ASCII character.

const E_STEPS = [
  // [at] (at) {at} <at> and the same for dot.
  {
    op: 'replace',
    re: String.raw`[ ]*[[({<][ ]*(?:at|@)[ ]*[\])}>][ ]*`,
    to: '@',
  },
  {
    op: 'replace',
    re: String.raw`[ ]*[[({<][ ]*(?:dot|\.)[ ]*[\])}>][ ]*`,
    to: '.',
  },
  // "at the rate", which only ever means @.
  {
    op: 'replace',
    re: String.raw`[ ]*(?<![a-z])(?:at the rate of|at the rate|attherate|at-the-rate|at sign)(?![a-z])[ ]*`,
    to: '@',
  },
  // "name at gmail", "name at okaxis".
  {
    op: 'replace',
    re: String.raw`(?<=[a-z0-9])[ ]+(?:at|@)[ ]+(?=(?:${alt([
      ...MAIL,
      ...UPI,
    ])})(?![a-z0-9]))`,
    to: '@',
  },
  // "name @ gmail.com": spaces around an @ that joins a domain.
  {
    op: 'replace',
    re: String.raw`(?<=[a-z0-9])[ ]*@[ ]*(?=(?:${alt([
      ...MAIL,
      ...UPI,
    ])})(?![a-z0-9])|[a-z0-9-]+\.${TLD}(?![a-z0-9]))`,
    to: '@',
  },
  // "pe @ devpatel": an @ followed by a space before a handle.
  { op: 'replace', re: String.raw`(?<![a-z0-9])@[ ]+(?=[a-z0-9_])`, to: '@' },
  // Spoken separators inside a handle: "ananya underscore reads", "shivam dot vibes".
  {
    op: 'replace',
    re: String.raw`(?<=[a-z0-9])[ ]*(?<![a-z])(?:underscore|under score)(?![a-z])[ ]*(?=[a-z0-9])`,
    to: '_',
  },
  // "dot com", "daat in", "gmail . com".
  {
    op: 'replace',
    re: String.raw`[ ]*(?<![a-z])(?:dot|daat|dott|point)(?![a-z])[ ]*(?=${TLD}(?![a-z0-9]))`,
    to: '.',
  },
  {
    op: 'replace',
    re: String.raw`(?<=[a-z0-9])[ ]+(?:dot|daat)[ ]+(?=[a-z0-9])`,
    to: '.',
  },
  // A spaced dot before a TLD, when the label is at least two characters (so
  // "p.m. me" stays prose) or is t or wa (t.me, wa.me).
  {
    op: 'replace',
    re: String.raw`(?:(?<=[a-z0-9]{2})|(?<=(?:^|[^a-z0-9])(?:t|wa)))[ ]*\.[ ]*(?=${TLD}(?![a-z0-9]))`,
    to: '.',
  },
  // "t.me / name".
  {
    op: 'replace',
    re: String.raw`(?<=\.(?:${alt(TLDS)}))[ ]*/[ ]*(?=[a-z0-9_+])`,
    to: '/',
  },
];

/** Breaks shared by the joined-digit copies: clock, calendar date, slash, percent, degree, price. */
const DIGIT_BREAKS = [
  { op: 'replace', re: DATE, to: '#' },
  {
    op: 'replace',
    re: String.raw`(?<![0-9])[0-9]{1,4}[ ]*[/.-][ ]*[0-9]{1,2}[ ]*[/.-][ ]*[0-9]{1,4}(?![0-9])`,
    to: '#',
  },
  { op: 'replace', re: String.raw`(?<=[0-9])[ ]*:[ ]*(?=[0-9])`, to: '#' },
  { op: 'replace', re: String.raw`[/%\u00b0'\u20b9$\u20ac\u00a3]`, to: '#' },
  {
    op: 'replace',
    re: String.raw`(?<![a-z])(?:rupees|rupaye|rupiya|rupay|rupee|inr|rs)(?![a-z])`,
    to: '#',
  },
];

export const COPIES = [
  {
    // The base copy every other one starts from.
    name: 't',
    from: 'input',
    steps: [
      { op: 'strip_invisible' },
      { op: 'fold' },
      { op: 'lower' },
      { op: 'strip_marks_after_ascii' },
      { op: 'spaces' },
      {
        op: 'replace',
        re: String.raw`&(?:nbsp|#160|#xa0);`,
        to: ' ',
        ifContains: '&',
      },
      {
        op: 'replace',
        re: String.raw`&(?:commat|#64|#x40);`,
        to: '@',
        ifContains: '&',
      },
      {
        op: 'replace',
        re: String.raw`&(?:period|#46|#x2e);`,
        to: '.',
        ifContains: '&',
      },
      { op: 'replace', re: String.raw`&amp;`, to: '&', ifContains: '&' },
    ],
  },
  {
    // Digit-shaped tokens with letters standing in for digits: 9876S43Z1O,
    // and the short ones with only O, I or L in them: 1O, 4l5.
    name: 'd',
    from: 't',
    steps: [
      {
        op: 'tokens',
        match: 'a-z0-9',
        guard: '[0-9]',
        when: String.raw`^(?=[0-9oilszbgq]{6,}$)(?=(?:[a-z]*[0-9]){4})[0-9oilszbgq]+$`,
        translate: { from: 'oilszbgq', to: '01152899' },
      },
      {
        op: 'tokens',
        match: 'a-z0-9',
        guard: '[0-9]',
        when: String.raw`^(?=[0-9oil]*[0-9])(?=[0-9oil]*[oil])[0-9oil]{2,5}$`,
        translate: { from: 'oil', to: '011' },
      },
    ],
  },
  {
    // Phone copy: number words become digits; a calendar date with a year is
    // taken out, so "9.8.1962 10.53" is a date and a time, not 9819621053.
    name: 'p',
    guard: PHONE_GUARD,
    from: 'd',
    steps: [
      {
        op: 'tokens',
        match: String.raw`a-z\u0900-\u097f\u0980-\u09ff`,
        dict: NUMBER_DICT,
      },
      { op: 'replace', re: String.raw`~[ -]*([1-9])(?![0-9])`, to: '$1' },
      { op: 'replace', re: String.raw`~`, to: '0' },
      {
        op: 'replace',
        re: String.raw`(?<![a-z])double[ -]*([0-9])`,
        to: '$1$1',
      },
      {
        op: 'replace',
        re: String.raw`(?<![a-z])triple[ -]*([0-9])`,
        to: '$1$1$1',
      },
      { op: 'replace', re: String.raw`(?<![a-z])plus[ ]*(?=91)`, to: '+' },
      { op: 'replace', re: DATE, to: '#' },
    ],
  },
  {
    // Read backwards, for "ulta padho".
    name: 'rp',
    guard: PHONE_GUARD,
    from: 'p',
    steps: [{ op: 'reverse' }],
  },
  {
    // Every digit group in the message, words reduced to "w" and symbols to a
    // space, with clock, date, slash, percent, degree and price shapes kept as
    // hard breaks (#). Built from d, not p: number WORDS spread over a sentence
    // ("ek do din") are p's business, not this copy's.
    name: 'pd',
    guard: DIGIT_GUARD,
    from: 'd',
    steps: [
      ...DIGIT_BREAKS,
      {
        op: 'replace',
        re: String.raw`[a-z\u0900-\u097f\u0980-\u09ff]+`,
        to: 'w',
      },
      { op: 'replace', re: String.raw`[ ]*[,;][ ,;]*`, to: ',' },
      { op: 'replace', re: String.raw`[^0-9#w,]+`, to: ' ' },
      { op: 'replace', re: String.raw`[ ]*#[ ]*`, to: '#' },
      { op: 'replace', re: String.raw`^[ ]+|[ ]+$`, to: '' },
    ],
  },
  {
    // Number words joined across any separator that follows a word digit,
    // commas included: "nau aath, bees, pachpan, chaalis, satattar". Typed
    // digits are not joined across commas here, so a list of marks is not.
    name: 'pw',
    guard: PHONE_GUARD,
    from: 'd',
    steps: [
      {
        op: 'tokens',
        match: String.raw`a-z\u0900-\u097f\u0980-\u09ff`,
        dict: MARKED_NUMBER_DICT,
      },
      { op: 'replace', re: String.raw`~§[ -]*([1-9])§`, to: '$1§' },
      { op: 'replace', re: String.raw`~§`, to: '0§' },
      {
        op: 'replace',
        re: String.raw`(?<![a-z])double[ -]*([0-9])§`,
        to: '$1$1§',
      },
      {
        op: 'replace',
        re: String.raw`(?<![a-z])triple[ -]*([0-9])§`,
        to: '$1$1$1§',
      },
      { op: 'replace', re: String.raw`§[ ,.;:/|+&-]*(?=[0-9])`, to: '' },
      { op: 'replace', re: String.raw`§`, to: '' },
    ],
  },
  { name: 'e', from: 't', guard: TEXT_ID_GUARD, steps: E_STEPS },
  {
    // Letter-spaced text joined back: "p r i y a @ g m a i l . c o m".
    name: 'ec',
    guard: TEXT_ID_GUARD,
    from: 't',
    steps: [
      {
        op: 'replace',
        re: String.raw`(?<=(?:^|[^a-z0-9])[a-z0-9]) (?=[a-z0-9](?:[^a-z0-9]|$))`,
        to: '',
      },
      ...E_STEPS,
    ],
  },
];

// ---------------------------------------------------------------------------
// Hard rules: an identifier is present. Category order is the UI's priority.
// ---------------------------------------------------------------------------

export const CATEGORY_ORDER = ['phone', 'payment', 'email', 'link', 'handle'];

/** The one monotone mobile, how a chart or a count reads, with optional spaces or words. */
const MONOTONE = String.raw`9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$)`;

export const HARD = [
  // Phone. phone_run10 alone is what reason `reference` means: a UTR, PNR or
  // order id, blocked by policy, with copy that points to Help.
  {
    id: 'phone_mobile',
    category: 'phone',
    copy: 'p',
    re: String.raw`(?<![0-9])(?:(?:\+|00)[ ]*91[ .-]*|91[ .-]+|0[ .-]*)?[6-9](?:${SEP}[0-9]){9}(?![0-9])`,
  },
  {
    id: 'phone_run10',
    category: 'phone',
    copy: 'p',
    re: String.raw`[0-9]{10}`,
  },
  {
    id: 'phone_intl',
    category: 'phone',
    copy: 'p',
    re: String.raw`(?:\+|(?<![0-9])00)[ ]*[1-9](?:[ .()-]{0,2}[0-9]){7,13}(?![0-9])`,
  },
  {
    id: 'phone_landline',
    category: 'phone',
    copy: 'p',
    re: String.raw`(?<![0-9])0[1-9][0-9]{1,3}[ -]?[2-9][0-9]{2,3}[ -]?[0-9]{3,4}(?![0-9])`,
  },
  // At most four digit groups, words or symbols between them, that join into
  // a mobile: "98765, 43210", "mera 98765 aur 43210". Capped at four groups so
  // a list of marks or ages ("87, 91, 78, 94 aur 88") does not join.
  {
    id: 'phone_digits',
    category: 'phone',
    copy: 'pd',
    re: String.raw`(?:^|#)[ w,]*(?=[0-9]+(?:[ w,]+[0-9]+){0,3}[ w,]*(?:#|$))(?:9[ w,]*1[ w,]*|0[ w,]*)?(?!${MONOTONE})[6-9](?:[ w,]*[0-9]){9}[ w,]*(?:#|$)`,
  },
  // Single digits split by commas, symbols or emoji and no words: "9🔥8🔥7…",
  // "9, 7, 1, 1, 2, …".
  {
    id: 'phone_spread',
    category: 'phone',
    copy: 'pd',
    re: String.raw`(?:^|#)[ w,]*(?!${MONOTONE})[6-9](?:[ ,][0-9]){9}[ w,]*(?:#|$)`,
  },
  // Up to five groups split only by symbols or emoji, never by a word or a
  // comma: "93🔥15🔥62🔥80🔥47", "94_12_38_67_05". A comma list ("87, 91, 78,
  // 94, 88") is how marks and ages are written, so it is left to the others.
  {
    id: 'phone_symbols',
    category: 'phone',
    copy: 'pd',
    re: String.raw`(?:^|#)[ w,]*(?=[0-9]+(?:[ ][0-9]+){0,4}[ w,]*(?:#|$))(?:9[ ]?1[ ]?|0[ ]?)?(?!${MONOTONE})[6-9](?:[ ]?[0-9]){9}[ w,]*(?:#|$)`,
  },
  {
    id: 'phone_words',
    category: 'phone',
    copy: 'pw',
    re: String.raw`(?<![0-9])(?:91|0)?[6-9][0-9]{9}(?![0-9])`,
  },
  {
    id: 'phone_reversed',
    category: 'phone',
    copy: 'rp',
    re: String.raw`(?<![0-9])[6-9](?:${SEP}[0-9]){9}(?![0-9])`,
    requires: {
      copy: 't',
      re: String.raw`(?<![a-z])(?:ulta|ultaa|ulte|ulti|reverse|reversed|backwards|backward|peeche se|piche se|pichhe se|right to left)(?![a-z])`,
    },
  },

  // Payment.
  {
    id: 'vpa',
    category: 'payment',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@${UPIW}(?![a-z0-9])`,
  },
  {
    id: 'vpa',
    category: 'payment',
    copy: 'ec',
    re: String.raw`(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@${UPIW}(?![a-z0-9])`,
  },
  {
    id: 'ifsc',
    category: 'payment',
    copy: 't',
    re: String.raw`(?<![a-z0-9])[a-z]{4}0[a-z0-9]{6}(?![a-z0-9])`,
  },
  {
    id: 'bank_account',
    category: 'payment',
    copy: 'p',
    re: String.raw`(?<![a-z])(?:a/c|acct|account|khata|ac)(?:[ .]*(?:no|number|num|nmbr))?[ .:#-]*[0-9](?:[ -]?[0-9]){8,17}(?![0-9])`,
  },
  {
    id: 'at_id',
    category: 'payment',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{2,63}@(?!${MAILW}(?![a-z0-9]))[a-z]{2,20}(?![a-z0-9.@])`,
  },

  // Email.
  {
    id: 'email',
    category: 'email',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!${UPIW}(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?![a-z0-9])`,
  },
  {
    id: 'email',
    category: 'email',
    copy: 'ec',
    re: String.raw`(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!${UPIW}(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?![a-z0-9])`,
  },
  {
    id: 'email_no_tld',
    category: 'email',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._-])[a-z0-9][a-z0-9._%+-]{1,63}@${MAILW}(?![a-z0-9])`,
  },
  // An address with the @ left out, next to its provider: "priya.95 on gmail",
  // "gmail pe aa jao, meenal.gupta.1991".
  {
    id: 'mail_local_near',
    category: 'email',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._])${IDTOKEN}(?:[ ]+(?:on|pe|par|ka|ki|at|wala|wali|in|hai|is|h))?[ ]+${MAILW}(?![a-z])`,
  },
  {
    id: 'mail_local_near',
    category: 'email',
    copy: 'e',
    re: String.raw`(?<![a-z])${MAILW}(?:[ ,]+[a-z]+){0,4}[ ,]*[:=-]?[ ]*${IDTOKEN}`,
  },

  // Link.
  {
    id: 'url_scheme',
    category: 'link',
    copy: 'e',
    re: String.raw`(?<![a-z])(?:https?|ftp)[ ]*:[ ]*/[ ]*/|(?<![a-z0-9])www[ ]*\.[ ]*[a-z0-9]`,
  },
  {
    id: 'url_known',
    category: 'link',
    copy: 'e',
    re: String.raw`(?<![a-z0-9])(?:${alt(KNOWN_DOMAINS)})(?![a-z0-9])`,
  },
  {
    id: 'url_known',
    category: 'link',
    copy: 'ec',
    re: String.raw`(?<![a-z0-9])(?:${alt(KNOWN_DOMAINS)})(?![a-z0-9])`,
  },
  {
    id: 'url_tld',
    category: 'link',
    copy: 'e',
    re: String.raw`(?<![a-z0-9@._-])(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9-]{2,62})*\.${TLD}(?![a-z0-9])`,
  },

  // Handle.
  {
    id: 'handle',
    category: 'handle',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._@])@(?!(?:${alt(
      NOT_A_HANDLE,
    )})(?![a-z0-9._]))(?![0-9]{1,2}(?:[:.][0-9]{2})?(?:am|pm|baje|bje)?(?![a-z0-9_]))(?![0-9]+(?![a-z_]))[a-z0-9_](?:[a-z0-9_]|\.(?=[a-z0-9_])){2,29}(?![a-z0-9_])`,
  },
  {
    id: 'app_handle',
    category: 'handle',
    copy: 'e',
    re: String.raw`(?<!${NL})${APP}(?!${NL})(?:[ ]*(?:pe|par|on|me|mein|id|handle|username|user|naam|name|hai|h|is|mera|meri|my|search|karo|kar|follow|add|dhundo|dhundho|dhoondo|dhundh|dhoondh|आईडी|:|-)){0,4}[^a-z0-9@]{0,8}@?${IDTOKEN}`,
  },
  {
    id: 'id_colon_handle',
    category: 'handle',
    copy: 'e',
    re: String.raw`(?<![a-z])(?<!(?:order|txn|transaction|booking|session|ticket|ref|payment|utr|upi|call|meeting|reference|tracking|customer|employee|roll|student|aadhaar|pan) )(?:${APP}[ ]+)?(?:id|username|user name|userid|user id|handle)[ ]*[:=-][ ]*@?(?:${IDTOKEN}|[a-z]{6,30}(?![a-z0-9_]))`,
  },
  {
    id: 'handle_on_app',
    category: 'handle',
    copy: 'e',
    re: String.raw`(?<![a-z0-9._])${IDTOKEN}[ ]+(?:on|pe|par|at)[ ]+(?:instagram|insta|ig|snapchat|snap|${TG}|tg|twitter|facebook|fb|discord|skype|threads)(?![a-z])`,
  },
  {
    id: 'discord_tag',
    category: 'handle',
    copy: 'e',
    re: String.raw`(?<![a-z0-9_.])[a-z0-9_.]{2,32}#[0-9]{4}(?![0-9])`,
  },
  {
    id: 'skype_live',
    category: 'handle',
    copy: 'e',
    re: String.raw`(?<![a-z])live[ ]*:[ ]*[a-z][a-z0-9]*[._0-9][a-z0-9._-]*`,
  },
];

// ---------------------------------------------------------------------------
// Signal rules: intent with no identifier. Logged for review, never blocked,
// server only. `unless` suppresses a rule on refusals and support questions;
// it reads the whole message, so a "nahi" anywhere suppresses it (a known
// miss: "seedha consult karo, per minute ka chakkar nahi").
// ---------------------------------------------------------------------------

const NEGATION = String.raw`(?<![a-z])(?:nahi|nahin|nhi|nai|mat|not|dont|don't|do not|cannot|can't|cant|never|mana hai|allowed nahi|not allowed)(?![a-z])`;
const PAY_SUPPORT = String.raw`(?<![a-z])(?:recharge|wallet|balance|refund|nahi aaya|nhi aaya|fail|failed|kat gaya|cut gaya|pending|deducted|debit|debited|pack)(?![a-z])`;
const SIG_APP = `(?:${alt([
  ...APPS,
  'wa',
  'wp',
  'whats app',
  'watts app',
  'google meet',
  'gmeet',
  'zoom',
  'duo',
  'messenger',
  'sms',
  'text message',
  'normal call',
  'phone call',
  'hangout',
  'hangouts',
])})`;
const MOVE_VERB = `(?:${alt([
  'aao',
  'aa jao',
  'aaja',
  'aajao',
  'aana',
  'milo',
  'milte',
  'mil',
  'baat',
  'chat',
  'call',
  'msg',
  'message',
  'text',
  'add',
  'connect',
  'contact',
  'ping',
  'follow',
  'dm',
  'join',
  'video call',
  'reply',
  'bhejo',
  'bhej do',
  'bhejti',
  'bhejta',
  'bhejunga',
  'bhejungi',
  'send',
  'aa jaiye',
  'aaiye',
  'aa jana',
  'aajana',
  'aa jaana',
])})`;
const CONTACT_NOUN = `(?:${alt([
  'number',
  'no',
  'num',
  'nmbr',
  'mobile',
  'mobile number',
  'phone',
  'phone number',
  'contact',
  'contact number',
  'whatsapp',
  'insta',
  'instagram',
  'id',
  'email',
  'mail',
  'gmail',
  'upi',
  'handle',
  'username',
  'details',
  'contact details',
])})`;
const GIVE_VERB = `(?:${alt([
  'do',
  'dedo',
  'de do',
  'dijiye',
  'dijie',
  'dena',
  'bhejo',
  'bhej do',
  'bhejna',
  'send',
  'share',
  'batao',
  'bata do',
  'batana',
  'likho',
  'chahiye',
  'milega',
  'mil sakta',
  'mil jayega',
  'please',
  'plz',
  'pls',
  'bhejiye',
  'share karo',
])})`;
const ASK_NOUN = String.raw`(?:${alt([
  'insta',
  'instagram',
  'snap',
  'snapchat',
  TG,
  'whatsapp',
  'fb',
  'facebook',
  'gmail',
  'email',
  'mail',
  'number',
  'no',
  'mobile',
  'contact',
  'id',
  'insta id',
  'gmail id',
  'email id',
  'snap id',
  'upi id',
])})`;
const YOUR = String.raw`(?:${alt([
  'apna',
  'apni',
  'apne',
  'your',
  'ur',
  'aapka',
  'aapki',
  'aapke',
  'tumhara',
  'tumhari',
  'tera',
  'teri',
])})`;

export const SIGNAL = [
  {
    id: 'app_move',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])${SIG_APP}[ ]+(?:pe|par|pr|py|on|me|mein|pa)[ ]+(?:[a-z]+[ ]+){0,2}${MOVE_VERB}(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'app_verb',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])${SIG_APP}[ ]+(?:karo|kar do|kardo|karna|kar dena|kijiye|karein|consultation|consult|session|reading|booking|channel|group)(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'move_to_app',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])(?:message|text|call|ping|dm|add|follow|contact|reach|find|search)[ ]+(?:me|us|mujhe|hume)[ ]+(?:on|at|in|pe|par)[ ]+${SIG_APP}(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'app_question',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])${SIG_APP}(?:[ ]+(?:ya|or)[ ]+${SIG_APP})?[ ]*(?:id[ ]*)?\?|(?<![a-z])${SIG_APP}[ ]+(?:use|chalate|chalati)[ ]+(?:karte|karti|karta|ho|hain)(?![a-z])`,
  },
  {
    id: 'ask_contact',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])(?:${YOUR}|mujhe|mujhko)[ ]+(?:[a-z]+[ ]+){0,2}${CONTACT_NOUN}(?:[ ]+[a-z]+){0,3}[ ]+${GIVE_VERB}(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'ask_what_is',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])${ASK_NOUN}[ .]*(?:kya hai|kya h|hai kya|h kya|batao|bolo|milega)(?![a-z])|(?<![a-z])${YOUR}[ ]+(?:[a-z]+[ ]+)?${ASK_NOUN}[ .]*(?:kya|hai|h)(?![a-z])`,
  },
  {
    id: 'noun_give',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])(?:number|mobile number|phone number|contact number|whatsapp number|mobile|contact|whatsapp|email|mail|gmail|insta|upi|address|bank details|account details|account number)[ ]+(?:do|dedo|de do|dijiye|bhejo|bhej do|send karo|send|share karo|batao|bolo)(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'exchange',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])(?:number|numbers|contact|contacts|details)[ ]+(?:exchange|share)[ ]+(?:karein|karen|kare|karte|karo|kar|kr)(?![a-z])`,
  },
  {
    id: 'ask_contact_en',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])(?:give me|send me|share|what's|whats|what is|drop|dm me)[ ]+(?:your|ur)[ ]+(?:number|no|phone|mobile|contact|whatsapp|insta|email|id)(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'offer_contact',
    category: 'request',
    copy: 't',
    re: String.raw`(?<![a-z])(?:mera|meri|my)[ ]+(?:wala[ ]+)?(?:number|no|mobile|phone|contact|whatsapp|insta|id|email|gmail|upi)[ ]+(?:le lo|lelo|save karo|save kar lo|note karo|note kar lo|likh lo|save kar|chahiye|yaad hai|tumhare paas|aapke paas)(?![a-z])`,
  },
  {
    id: 'off_platform',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])(?:app|pappal|platform|yahan|yaha|idhar)[ ]+(?:ke|se|k)[ ]+(?:bahar|bina|alawa)(?![a-z])|(?<![a-z])(?:outside|off)[ ]+(?:the[ ]+|this[ ]+)?(?:app|pappal|platform)(?![a-z])|(?<![a-z])(?:bahar|outside)[ ]+(?:baat|milte|milo|chat|call|contact|mil)(?![a-z])|(?<![a-z])(?:kahin|kahi|kisi)[ ]+(?:aur|or)[ ]+(?:chalein|chale|chalte|baat|milte|app)(?![a-z])|(?<![a-z])(?:koi|dusre|doosre|another|other)[ ]+(?:aur[ ]+)?(?:app|platform)[ ]+(?:pe|par|on)(?![a-z])|(?<![a-z])app[ ]+(?:ki|ka)[ ]+(?:zarurat|jarurat|zaroorat)[ ]+nahi(?![a-z])|(?<![a-z])app[ ]+(?:wala|wali)?[ ]*mat[ ]+use(?![a-z])|(?<![a-z])offline[ ]+(?:session|consult|consultation|reading|milte|baat|meeting)(?![a-z])`,
  },
  {
    id: 'direct_contact',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])(?:direct|directly|seedha|sidha|seedhe|sidhe)[ ]+(?:call|baat|contact|pay|payment|paisa|paise|number|msg|message|whatsapp|consult|booking|aana|aao|milo|milna)(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'personal_contact',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])(?:personal|private|pvt)[ ]+(?:number|no|contact|whatsapp|chat|mobile)(?![a-z])`,
    unless: { copy: 't', re: NEGATION },
  },
  {
    id: 'cheaper_outside',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])(?:commission|cut|charges|charge|paisa|paise)[ ]+(?:bachega|bach jayega|nahi lagega|nahi katega|save)(?![a-z])|(?<![a-z])(?:sasta|sasti|saste|cheaper|kam paise|kam paisa)[ ]+(?:padega|hoga|milega|pad jayega|rahega)(?![a-z])`,
  },
  {
    id: 'pay_outside',
    category: 'payment',
    copy: 't',
    re: String.raw`(?<![a-z])(?:gpay|google pay|phonepe|phone pe|paytm|upi|bhim|qr|qr code|scanner|neft|imps|rtgs)[ ]+(?:[a-z]+[ ]+){0,2}(?:kar do|kardo|karo|kar dena|kar dunga|kar dungi|bhejo|bhej do|bhej|bhejunga|bhej dunga|send|pay|transfer|scan)(?![a-z])|(?<![a-z])(?:gpay|phonepe|paytm|upi)[ ]+(?:number|no|id)(?![a-z])`,
    unless: { copy: 't', re: PAY_SUPPORT },
  },
  {
    id: 'missed_call',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])missed call[ ]+(?:do|de do|dedo|dena|maaro|maro|karo|kar do)(?![a-z])|(?<![a-z])(?:number|whatsapp|call|phone)[ ]+(?:pe|par)[ ]+shift(?![a-z])`,
  },
  {
    id: 'split_announce',
    category: 'split',
    copy: 't',
    re: String.raw`(?<![a-z])(?:baaki|baki|next|agla|agle|remaining|rest|dusra|doosra|second|pehle|pehla|first)[ ]+(?:[0-9]+[ ]+)?(?:digits|digit|half|hissa)(?![a-z])|(?<![a-z])(?:next|agle|dusre|doosre|alag|separate|teen|do|2|3)[ ]+(?:message|messages|msg|msgs)(?![a-z])|(?<![a-z])(?:tod[ ]+ke|tod kar|todke|break karke|tukdo|tukde|parts me)(?![a-z])`,
  },
  {
    id: 'profile_pointer',
    category: 'pointer',
    copy: 't',
    re: String.raw`(?<![a-z])(?:number|contact|link|id|details)(?:[ ]+[a-z]+){0,4}[ ]+(?:bio|dp|status|profile|description)(?![a-z])|(?<![a-z])(?:bio|dp|status)[ ]+(?:me|mein|pe|par|mai)[ ]+(?:[a-z]+[ ]+){0,2}(?:number|contact|link|id|details)(?![a-z])|(?<![a-z])link[ ]+(?:in|me|mein)[ ]+(?:bio|profile|description)(?![a-z])|(?<![a-z])link[ ]+(?:bhejo|do|dedo|send|share)(?![a-z])`,
  },
  {
    id: 'search_me',
    category: 'pointer',
    copy: 't',
    re: String.raw`(?<![a-z])(?:naam|name)[ ]+(?:google|youtube|insta|instagram|facebook|fb)[ ]+(?:pe|par|on)[ ]+search(?![a-z])|(?<![a-z])(?:full name|poora naam|pura naam|real name|asli naam|surname)(?![a-z])|(?<![a-z])(?:dhoondh|dhundh|dhund|search)[a-z]*[ ]+(?:[a-z]+[ ]+){0,2}${SIG_APP}(?![a-z])|(?<![a-z])${SIG_APP}[ ]+(?:pe|par|on)[ ]+(?:search|dhoondh|dhundh|find)(?![a-z])|(?<![a-z])(?:dm|inbox)[ ]+(?:for|karein|karo|kare)(?![a-z])|(?<![a-z])direct[ ]+booking(?![a-z])|(?<![a-z])naam[ ]+same(?![a-z])`,
  },
  {
    id: 'meet_offline',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?<![a-z])address[ ]+(?:do|dedo|bhejo|batao|send)(?![a-z])|(?<![a-z])(?:mil[ ]+ke|milke)[ ]+(?:session|baat|reading|consult)(?![a-z])`,
  },
  {
    id: 'devanagari_move',
    category: 'handoff',
    copy: 't',
    re: String.raw`(?:नंबर|नम्बर)[ ]+(?:दे|दो|भेजो|दीजिए|दीजिये)|(?:व्हाट्सएप|व्हाट्सऐप|वॉट्सऐप|इंस्टा|टेलीग्राम)[ ]+(?:पे|पर|में)`,
  },
];

// ---------------------------------------------------------------------------
// Numbers split across messages
// ---------------------------------------------------------------------------
// A fragment is a message that, once carrier words and symbols are gone, is
// only digit groups: "98765", "mera number 98765", "aur 43210 🙏", "pehle 5
// digit 93154". A clock, date, slash, percent, hyphen or decimal point
// disqualifies it, so "4:35", "12/08" and "99.5" never count. Its payload is
// its digits. A message with no digit group of two or more is chatter: the
// window steps over it ("sirf aapke liye", "98765", "..", "43210").

const CARRIERS = [
  'mera',
  'meri',
  'mere',
  'my',
  'number',
  'no',
  'num',
  'nmbr',
  'nbr',
  'mobile',
  'phone',
  'ph',
  'contact',
  'phir',
  'fir',
  'aur',
  'and',
  'then',
  'next',
  'baaki',
  'baki',
  'bacha',
  'remaining',
  'rest',
  'ji',
  'hai',
  'h',
  'he',
  'hain',
  'ye',
  'yeh',
  'ab',
  'lo',
  'le',
  'likho',
  'likh',
  'note',
  'karo',
  'kar',
  'first',
  'second',
  'third',
  'last',
  'part',
  'half',
  'hissa',
  'pehla',
  'pehle',
  'dusra',
  'doosra',
  'teesra',
  'aage',
  'continue',
  'cont',
  'plus',
  'is',
  'the',
  'of',
  'ok',
  'okay',
  'haan',
  'han',
  'hmm',
  'sir',
  'madam',
  'mam',
  'bhai',
  'didi',
  'wala',
  'wali',
  'ka',
  'ki',
  'se',
  'shuru',
  'start',
  'end',
  'abhi',
  'likhti',
  'likhta',
  'raha',
  'rahi',
  'hu',
  'hoon',
  'hun',
  'bhejti',
  'bhejta',
  'bhej',
  'save',
  'dekho',
  'dekh',
  'suno',
  'sun',
  'ruko',
  'bas',
  'jio',
  'airtel',
  'vi',
  'bsnl',
  'idea',
  'vodafone',
  'sim',
  'new',
  'naya',
  'purana',
];

export const FRAGMENT = {
  copy: 'p',
  steps: [
    {
      op: 'replace',
      re: String.raw`(?<![a-z0-9])[0-9]{1,2}[ ]*(?:digits|digit|ank)(?![a-z])`,
      to: ' ',
    },
    {
      op: 'replace',
      re: String.raw`(?<![a-z])(?:${alt(CARRIERS)})(?![a-z])`,
      to: ' ',
    },
    { op: 'replace', re: String.raw`[.!?]+[ ]*$`, to: '' },
    { op: 'replace', re: String.raw`[^0-9a-z:/%.\u20b9$-]`, to: ' ' },
    // Collapse multiple spaces to one so the shape check below does not need
    // (?:[ ]+…)* (a nested quantifier that risks O(n²) in Postgres's NFA).
    { op: 'replace', re: String.raw`[ ][ ]+`, to: ' ' },
  ],
  // Single space between digit groups after the collapse step above.
  shape: String.raw`^[ ]?[0-9]{1,10}(?:[ ][0-9]{1,10})*[ ]?$`,
  /** A message with no run of this many digits is chatter the window steps over. */
  chatter: String.raw`^[^0-9]*(?:[0-9][^0-9]+)*[0-9]?[^0-9]*$`,
  /** Fewest payload digits a message needs to count; a lone digit is a count. */
  minDigits: 2,
  /** Joined payloads are tested against this, forward and in reverse order. */
  mobile: String.raw`^${MOBILE}$`,
};

/**
 * The fast path's prefilter: a message none of these touch cannot fire a hard
 * rule, so the other copies are never built. Digits, @ . : # / = -, an app
 * name, a mail provider or a number word. Jest proves it never hides a hit.
 */
export const PREFILTER = {
  copy: 't',
  re: String.raw`[0-9@.:#/=-]|(?<!${NL})(?:${alt([
    ...APPS,
    ...MAIL,
    ...Object.keys(NUMBER_DICT),
    'www',
    'http',
    'id',
    'username',
    'handle',
    'live',
    'double',
    'triple',
    'dot',
    'daat',
    'dott',
    'point',
    'underscore',
    'under score',
    'attherate',
    'at the rate',
    'at sign',
  ])})(?!${NL})|[[({<]`,
};

/**
 * Look-alike letters with no compatibility decomposition, hand-listed:
 * Cyrillic and Greek letters that render as a Latin one, a few Latin
 * variants, dashes and dingbat digits. Uppercase maps straight to lowercase
 * ASCII. Merged into the fold table by the generator; never maps ASCII.
 */
export const CONFUSABLES = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ԛ: 'q',
  ԝ: 'w',
  ь: 'b',
  б: '6',
  Б: '6',
  з: '3',
  З: '3',
  А: 'a',
  В: 'b',
  Е: 'e',
  К: 'k',
  М: 'm',
  Н: 'h',
  О: 'o',
  Р: 'p',
  С: 'c',
  Т: 't',
  У: 'y',
  Х: 'x',
  Ѕ: 's',
  І: 'i',
  Ј: 'j',
  Ь: 'b',
  α: 'a',
  β: 'b',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
  Α: 'a',
  Β: 'b',
  Ε: 'e',
  Ζ: 'z',
  Η: 'h',
  Ι: 'i',
  Κ: 'k',
  Μ: 'm',
  Ν: 'n',
  Ο: 'o',
  Ρ: 'p',
  Τ: 't',
  Υ: 'y',
  Χ: 'x',
  օ: 'o',
  ս: 'u',
  ı: 'i',
  ɡ: 'g',
  ɑ: 'a',
  ɩ: 'i',
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
  '·': '.',
  '•': '.',
  '。': '.',
  '｡': '.',
  '٫': '.',
  '➊': '1',
  '➋': '2',
  '➌': '3',
  '➍': '4',
  '➎': '5',
  '➏': '6',
  '➐': '7',
  '➑': '8',
  '➒': '9',
  '➀': '1',
  '➁': '2',
  '➂': '3',
  '➃': '4',
  '➄': '5',
  '➅': '6',
  '➆': '7',
  '➇': '8',
  '➈': '9',
  '❶': '1',
  '❷': '2',
  '❸': '3',
  '❹': '4',
  '❺': '5',
  '❻': '6',
  '❼': '7',
  '❽': '8',
  '❾': '9',
  '⓿': '0',
  '⓵': '1',
  '⓶': '2',
  '⓷': '3',
  '⓸': '4',
  '⓹': '5',
  '⓺': '6',
  '⓻': '7',
  '⓼': '8',
  '⓽': '9',
};

/** Where the generated SQL goes. A spec change after deploy needs a new number. */
export const MIGRATION = 'supabase/migrations/156_contact_guard_detector.sql';
