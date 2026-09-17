/**
 * GENERATED FILE, DO NOT EDIT.
 *
 * Source: design/handles.json. Regenerate with `npm run handles`;
 * `npm run handles:check` fails the build when this file has drifted.
 *
 * The vocabulary and word-shapes behind every name the app suggests. The
 * generator proves, before emitting, that no combination here can fail
 * check_display_name (migration 040) or USERNAME_PATTERN in src/lib/username.ts,
 * and that no word breaks the tone rules stageName.ts describes.
 *
 * - calm: 36 adjectives, 73 nouns, 12 suffixes, 4 shapes, 5,212,200 names (8,760 without a number).
 * - pop: 28 adjectives, 112 nouns, 12 suffixes, 6 shapes, 33,502,672 names (16,912 without a number).
 */

export type HandleVoice = 'calm' | 'pop';

/** A slot in a template. 'number' is the trailing two-or-three digits. */
export type HandleWordRole = 'adjective' | 'noun' | 'suffix';
export type HandleRole = HandleWordRole | 'number';

export interface HandleTemplate {
  readonly id: string;
  readonly slots: readonly HandleRole[];
  /** How many distinct names this shape can produce. */
  readonly combinations: number;
}

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 24;
export const HANDLE_NUMBER_MIN = 10;
export const HANDLE_NUMBER_MAX = 999;

/** The domains each voice draws from, in declaration order. For auditing. */
export const HANDLE_DOMAINS: Record<HandleVoice, readonly string[]> = {
  calm: ['weather', 'light', 'water', 'land', 'trees', 'birds', 'kitchen', 'home'],
  pop: ['cinema', 'music', 'food', 'places', 'festivals', 'cricket', 'folklore', 'nature'],
};

export const HANDLE_WORDS: Record<
  HandleVoice,
  Record<HandleWordRole, readonly string[]>
> = {
  calm: {
    adjective: [
      'Quiet', 'Warm', 'Steady', 'Gentle', 'Kind', 'Calm', 'Patient', 'Bright', 'Soft', 'Still',
      'Open', 'Clear', 'Mellow', 'Sunny', 'Easy', 'Cosy', 'Golden', 'Silver', 'Amber', 'Dusky',
      'Misty', 'Hushed', 'Slow', 'Tender', 'Sweet', 'Fresh', 'Wide', 'Deep', 'Light', 'Little',
      'Lazy', 'Breezy', 'Rainy', 'Velvet', 'Honey', 'Wild',
    ],
    noun: [
      'Monsoon', 'Sunrise', 'Sunset', 'Twilight', 'Drizzle', 'Cloudburst', 'Breeze', 'Shade',
      'Lantern', 'Ember', 'Firefly', 'Harbour', 'River', 'Haven', 'Lake', 'Delta', 'Backwater',
      'Estuary', 'Lagoon', 'Island', 'Ghat', 'Anchor', 'Compass', 'Meadow', 'Orchard', 'Valley',
      'Foothill', 'Plateau', 'Dune', 'Harvest', 'Paddy', 'Mustard', 'Grove', 'Canopy', 'Willow',
      'Banyan', 'Peepal', 'Neem', 'Tulsi', 'Bamboo', 'Teak', 'Sandal', 'Fern', 'Moss', 'Lotus',
      'Jasmine', 'Marigold', 'Sunbird', 'Koel', 'Heron', 'Egret', 'Sparrow', 'Mynah', 'Chai',
      'Saffron', 'Mango', 'Guava', 'Cardamom', 'Jaggery', 'Almond', 'Coconut', 'Ginger', 'Clove',
      'Kettle', 'Teapot', 'Veranda', 'Courtyard', 'Terrace', 'Balcony', 'Window', 'Doorway',
      'Hearth', 'Bazaar',
    ],
    suffix: [
      'Light', 'Glow', 'Song', 'Line', 'Side', 'Fall', 'Rest', 'Stone', 'Path', 'Wood', 'Bloom',
      'Nest',
    ],
  },
  pop: {
    adjective: [
      'Filmi', 'Jhakaas', 'Bindaas', 'Rangeela', 'Deewana', 'Dhinchak', 'Zabardast', 'Superhit',
      'Retro', 'Vintage', 'Classic', 'Solid', 'Kadak', 'Mast', 'Sunehra', 'Meetha', 'Teekha',
      'Namkeen', 'Garam', 'Thanda', 'Chatpata', 'Desi', 'Local', 'Pucca', 'Bada', 'Purana',
      'Jhatpat', 'Ekdum',
    ],
    noun: [
      'Baazigar', 'Sholay', 'Talkies', 'Interval', 'Masala', 'Tashan', 'Jugaad', 'Flashback',
      'Trailer', 'Sequel', 'Cameo', 'Matinee', 'Dialogue', 'Screenplay', 'Poster', 'Marquee',
      'Gabbar', 'Mogambo', 'Circuit', 'Basanti', 'Chulbul', 'Shehzada', 'Jaadu', 'Qawwali',
      'Dhol', 'Tabla', 'Sitar', 'Veena', 'Sarod', 'Bansuri', 'Thumri', 'Antara', 'Mukhda', 'Taal',
      'Raag', 'Ghazal', 'Dhun', 'Alaap', 'Sargam', 'Mridang', 'Dholak', 'Shehnai', 'Tarana',
      'Jalebi', 'Samosa', 'Pakoda', 'Chaat', 'Bhel', 'Vada', 'Idli', 'Dosa', 'Thali', 'Biryani',
      'Kulfi', 'Lassi', 'Falooda', 'Rasgulla', 'Barfi', 'Ladoo', 'Halwa', 'Chutney', 'Achaar',
      'Paratha', 'Kachori', 'Khichdi', 'Sev', 'Papad', 'Rabri', 'Bazaar', 'Galli', 'Chowk',
      'Nukkad', 'Mohalla', 'Haveli', 'Dhaba', 'Chowpatty', 'Maidan', 'Junction', 'Platform',
      'Rangoli', 'Patang', 'Phuljhadi', 'Dhamaal', 'Baraat', 'Sangeet', 'Mehendi', 'Dandiya',
      'Garba', 'Anaar', 'Googly', 'Doosra', 'Yorker', 'Bouncer', 'Sixer', 'Century', 'Innings',
      'Maiden', 'Wicket', 'Stumps', 'Gully', 'Powerplay', 'Amrit', 'Vimana', 'Samudra',
      'Kalpataru', 'Chakravyuh', 'Mayavi', 'Kavach', 'Monsoon', 'Peacock', 'Mango', 'Neem',
    ],
    suffix: [
      'Giri', 'Panti', 'Tales', 'Vibes', 'Mode', 'Wala', 'Club', 'Zone', 'Core', 'Squad', 'Fan',
      'Baaz',
    ],
  },
};

export const HANDLE_TEMPLATES: Record<HandleVoice, readonly HandleTemplate[]> = {
  calm: [
    { id: 'adjective_noun', slots: ['adjective', 'noun'], combinations: 2628 },
    { id: 'noun_noun', slots: ['noun', 'noun'], combinations: 5256 },
    { id: 'noun_suffix', slots: ['noun', 'suffix'], combinations: 876 },
    { id: 'adjective_noun_number', slots: ['adjective', 'noun', 'number'], combinations: 5203440 },
  ],
  pop: [
    { id: 'adjective_noun', slots: ['adjective', 'noun'], combinations: 3136 },
    { id: 'noun_noun', slots: ['noun', 'noun'], combinations: 12432 },
    { id: 'noun_suffix', slots: ['noun', 'suffix'], combinations: 1344 },
    { id: 'adjective_noun_number', slots: ['adjective', 'noun', 'number'], combinations: 6209280 },
    { id: 'noun_noun_number', slots: ['noun', 'noun', 'number'], combinations: 24615360 },
    { id: 'noun_suffix_number', slots: ['noun', 'suffix', 'number'], combinations: 2661120 },
  ],
};

/** Total distinct names per voice, summed over that voice's templates. */
export const HANDLE_COMBINATIONS: Record<HandleVoice, number> = {
  calm: 5212200,
  pop: 33502672,
};
