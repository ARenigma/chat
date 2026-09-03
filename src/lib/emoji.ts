/**
 * The emoji dataset, and the two rules that make it behave like a keyboard.
 *
 * Bundled rather than pulled from a package (RULE 5): emoji are unicode strings,
 * so a picker needs a list, a keyword index and a skin-tone rule — not a
 * dependency with its own render layer, its own styling and its own failure
 * modes to inherit. The whole payload is a few KB of plain data.
 *
 * Deliberately NOT the full Unicode set. A keyboard-sized list is a scroll nobody
 * finishes; this is the common set per category, which is what search is for.
 */

export type EmojiCategoryId =
  | 'recent'
  | 'smileys'
  | 'people'
  | 'nature'
  | 'food'
  | 'activity'
  | 'travel'
  | 'objects'
  | 'symbols';

export interface EmojiCategory {
  id: EmojiCategoryId;
  /** The tab glyph. A picker's own tabs are emoji in every keyboard. */
  glyph: string;
  label: string;
}

export interface Emoji {
  /** The base sequence, with no skin-tone modifier applied. */
  char: string;
  /** Lowercase words used by search. The name first, then loose synonyms. */
  keywords: string;
  /**
   * Whether `char` accepts a Fitzpatrick modifier. Only set on emoji that
   * actually render one — appending a modifier to a non-human emoji produces a
   * tofu box on Android rather than being ignored.
   */
  tone?: true;
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { id: 'recent', glyph: '🕘', label: 'Recently used' },
  { id: 'smileys', glyph: '😀', label: 'Smileys and emotion' },
  { id: 'people', glyph: '👋', label: 'People and body' },
  { id: 'nature', glyph: '🐻', label: 'Animals and nature' },
  { id: 'food', glyph: '🍎', label: 'Food and drink' },
  { id: 'activity', glyph: '⚽', label: 'Activity' },
  { id: 'travel', glyph: '🚗', label: 'Travel and places' },
  { id: 'objects', glyph: '💡', label: 'Objects' },
  { id: 'symbols', glyph: '❤️', label: 'Symbols' },
];

/**
 * The five Fitzpatrick modifiers, in the order every keyboard shows them.
 *
 * Index 0 is "no modifier" — the default yellow — which is why this is not a
 * plain list of five: the absence of a modifier is itself one of the six
 * choices, and storing it as `''` keeps `char + TONES[i]` the whole rule.
 */
export const TONES: readonly string[] = [
  '',
  '\u{1F3FB}',
  '\u{1F3FC}',
  '\u{1F3FD}',
  '\u{1F3FE}',
  '\u{1F3FF}',
];

/** A swatch per tone, for the tone picker itself. */
export const TONE_SWATCHES: readonly string[] = TONES.map(t => `\u{270B}${t}`);

const SMILEYS: readonly Emoji[] = [
  { char: '😀', keywords: 'grinning smile happy' },
  { char: '😃', keywords: 'smiley happy joy' },
  { char: '😄', keywords: 'smile happy laugh' },
  { char: '😁', keywords: 'beaming grin' },
  { char: '😅', keywords: 'sweat smile relief' },
  { char: '😂', keywords: 'joy laugh tears lol' },
  { char: '🤣', keywords: 'rofl rolling laughing' },
  { char: '🙂', keywords: 'slight smile' },
  { char: '😊', keywords: 'blush smile warm' },
  { char: '😇', keywords: 'innocent halo angel' },
  { char: '🥰', keywords: 'love hearts adore' },
  { char: '😍', keywords: 'heart eyes love' },
  { char: '😘', keywords: 'kiss blowing' },
  { char: '😗', keywords: 'kissing' },
  { char: '😋', keywords: 'yum tasty savouring' },
  { char: '😜', keywords: 'wink tongue playful' },
  { char: '🤪', keywords: 'zany goofy silly' },
  { char: '🤗', keywords: 'hug hugging' },
  { char: '🤔', keywords: 'thinking hmm think' },
  { char: '🤐', keywords: 'zipper mouth quiet' },
  { char: '😐', keywords: 'neutral blank' },
  { char: '😑', keywords: 'expressionless' },
  { char: '😶', keywords: 'no mouth silent' },
  { char: '🙄', keywords: 'eye roll rolling eyes' },
  { char: '😏', keywords: 'smirk smug' },
  { char: '😴', keywords: 'sleeping sleep zzz' },
  { char: '😪', keywords: 'sleepy tired' },
  { char: '😌', keywords: 'relieved calm' },
  { char: '🤤', keywords: 'drooling' },
  { char: '😔', keywords: 'pensive sad down' },
  { char: '😢', keywords: 'cry sad tear' },
  { char: '😭', keywords: 'sob crying loudly' },
  { char: '😤', keywords: 'triumph huff steam' },
  { char: '😡', keywords: 'angry rage mad' },
  { char: '🤯', keywords: 'mind blown exploding head' },
  { char: '😳', keywords: 'flushed embarrassed' },
  { char: '🥺', keywords: 'pleading puppy eyes' },
  { char: '😱', keywords: 'scream fear shock' },
  { char: '😨', keywords: 'fearful scared' },
  { char: '😰', keywords: 'anxious sweat worried' },
  { char: '🤒', keywords: 'sick thermometer ill' },
  { char: '🤕', keywords: 'bandage hurt injured' },
  { char: '🥳', keywords: 'party celebrate partying' },
  { char: '😎', keywords: 'sunglasses cool' },
  { char: '🤓', keywords: 'nerd geek glasses' },
  { char: '🙃', keywords: 'upside down' },
  { char: '😬', keywords: 'grimace awkward' },
  { char: '🥱', keywords: 'yawn bored tired' },
];

const PEOPLE: readonly Emoji[] = [
  { char: '👋', keywords: 'wave hello hi bye', tone: true },
  { char: '🤚', keywords: 'raised back hand', tone: true },
  { char: '✋', keywords: 'raised hand stop high five', tone: true },
  { char: '👌', keywords: 'ok perfect', tone: true },
  { char: '🤌', keywords: 'pinched fingers', tone: true },
  { char: '✌️', keywords: 'victory peace', tone: true },
  { char: '🤞', keywords: 'crossed fingers luck hope', tone: true },
  { char: '🤟', keywords: 'love you gesture', tone: true },
  { char: '🤙', keywords: 'call me shaka', tone: true },
  { char: '👍', keywords: 'thumbs up yes good like', tone: true },
  { char: '👎', keywords: 'thumbs down no bad', tone: true },
  { char: '👏', keywords: 'clap applause bravo', tone: true },
  { char: '🙌', keywords: 'raising hands celebration praise', tone: true },
  { char: '🤝', keywords: 'handshake deal agree' },
  { char: '🙏', keywords: 'pray thanks please namaste', tone: true },
  { char: '💪', keywords: 'muscle strong flex', tone: true },
  { char: '🫶', keywords: 'heart hands love', tone: true },
  { char: '👀', keywords: 'eyes look watching' },
  { char: '🧠', keywords: 'brain mind' },
  { char: '👶', keywords: 'baby infant', tone: true },
  { char: '🧒', keywords: 'child kid', tone: true },
  { char: '👩', keywords: 'woman', tone: true },
  { char: '👨', keywords: 'man', tone: true },
  { char: '🧑', keywords: 'person adult', tone: true },
  { char: '👵', keywords: 'old woman grandmother', tone: true },
  { char: '👴', keywords: 'old man grandfather', tone: true },
  { char: '🤷', keywords: 'shrug dunno whatever', tone: true },
  { char: '🤦', keywords: 'facepalm', tone: true },
  { char: '💃', keywords: 'dancing woman dance', tone: true },
  { char: '🕺', keywords: 'dancing man dance', tone: true },
  { char: '🚶', keywords: 'walking person walk', tone: true },
  { char: '🧘', keywords: 'lotus meditation yoga calm', tone: true },
];

const NATURE: readonly Emoji[] = [
  { char: '🐶', keywords: 'dog puppy' },
  { char: '🐱', keywords: 'cat kitten' },
  { char: '🐭', keywords: 'mouse' },
  { char: '🐹', keywords: 'hamster' },
  { char: '🐰', keywords: 'rabbit bunny' },
  { char: '🦊', keywords: 'fox' },
  { char: '🐻', keywords: 'bear' },
  { char: '🐼', keywords: 'panda' },
  { char: '🐨', keywords: 'koala' },
  { char: '🐯', keywords: 'tiger' },
  { char: '🦁', keywords: 'lion' },
  { char: '🐮', keywords: 'cow' },
  { char: '🐷', keywords: 'pig' },
  { char: '🐵', keywords: 'monkey' },
  { char: '🙈', keywords: 'see no evil monkey' },
  { char: '🐔', keywords: 'chicken' },
  { char: '🐧', keywords: 'penguin' },
  { char: '🐦', keywords: 'bird' },
  { char: '🦋', keywords: 'butterfly' },
  { char: '🐝', keywords: 'bee honeybee' },
  { char: '🐢', keywords: 'turtle' },
  { char: '🐬', keywords: 'dolphin' },
  { char: '🐳', keywords: 'whale' },
  { char: '🌵', keywords: 'cactus' },
  { char: '🌲', keywords: 'evergreen tree' },
  { char: '🌸', keywords: 'cherry blossom flower' },
  { char: '🌺', keywords: 'hibiscus flower' },
  { char: '🌻', keywords: 'sunflower' },
  { char: '🌹', keywords: 'rose flower' },
  { char: '🍀', keywords: 'four leaf clover luck' },
  { char: '🍁', keywords: 'maple leaf autumn' },
  { char: '🌙', keywords: 'crescent moon night' },
  { char: '⭐', keywords: 'star' },
  { char: '🌟', keywords: 'glowing star sparkle' },
  { char: '☀️', keywords: 'sun sunny' },
  { char: '🌈', keywords: 'rainbow' },
  { char: '☁️', keywords: 'cloud' },
  { char: '🔥', keywords: 'fire lit hot' },
  { char: '❄️', keywords: 'snowflake cold' },
  { char: '💧', keywords: 'droplet water' },
];

const FOOD: readonly Emoji[] = [
  { char: '🍎', keywords: 'apple' },
  { char: '🍌', keywords: 'banana' },
  { char: '🍉', keywords: 'watermelon' },
  { char: '🍇', keywords: 'grapes' },
  { char: '🍓', keywords: 'strawberry' },
  { char: '🥭', keywords: 'mango' },
  { char: '🍍', keywords: 'pineapple' },
  { char: '🥥', keywords: 'coconut' },
  { char: '🍅', keywords: 'tomato' },
  { char: '🥑', keywords: 'avocado' },
  { char: '🌶️', keywords: 'chilli pepper spicy' },
  { char: '🍞', keywords: 'bread' },
  { char: '🧀', keywords: 'cheese' },
  { char: '🍗', keywords: 'chicken leg poultry' },
  { char: '🍔', keywords: 'burger hamburger' },
  { char: '🍟', keywords: 'fries chips' },
  { char: '🍕', keywords: 'pizza' },
  { char: '🌮', keywords: 'taco' },
  { char: '🍜', keywords: 'noodles ramen' },
  { char: '🍚', keywords: 'rice' },
  { char: '🍛', keywords: 'curry rice' },
  { char: '🍣', keywords: 'sushi' },
  { char: '🍪', keywords: 'cookie biscuit' },
  { char: '🎂', keywords: 'birthday cake' },
  { char: '🍰', keywords: 'cake slice' },
  { char: '🍫', keywords: 'chocolate' },
  { char: '🍿', keywords: 'popcorn' },
  { char: '☕', keywords: 'coffee tea hot drink chai' },
  { char: '🍵', keywords: 'green tea' },
  { char: '🧃', keywords: 'juice box' },
  { char: '🥤', keywords: 'soft drink cup' },
  { char: '🍺', keywords: 'beer' },
  { char: '🥂', keywords: 'cheers champagne toast' },
];

const ACTIVITY: readonly Emoji[] = [
  { char: '⚽', keywords: 'football soccer' },
  { char: '🏀', keywords: 'basketball' },
  { char: '🏈', keywords: 'american football' },
  { char: '⚾', keywords: 'baseball' },
  { char: '🎾', keywords: 'tennis' },
  { char: '🏐', keywords: 'volleyball' },
  { char: '🏓', keywords: 'table tennis ping pong' },
  { char: '🏸', keywords: 'badminton' },
  { char: '🏏', keywords: 'cricket' },
  { char: '🥅', keywords: 'goal net' },
  { char: '🎯', keywords: 'target bullseye direct hit' },
  { char: '🎮', keywords: 'video game controller gaming' },
  { char: '🎲', keywords: 'dice game' },
  { char: '🧩', keywords: 'puzzle piece' },
  { char: '🎨', keywords: 'art palette painting' },
  { char: '🎤', keywords: 'microphone sing karaoke' },
  { char: '🎧', keywords: 'headphones music listening' },
  { char: '🎵', keywords: 'music note' },
  { char: '🎸', keywords: 'guitar' },
  { char: '🥁', keywords: 'drum' },
  { char: '🏆', keywords: 'trophy win champion' },
  { char: '🥇', keywords: 'gold medal first' },
  { char: '🎉', keywords: 'party popper celebrate tada' },
  { char: '🎊', keywords: 'confetti ball celebrate' },
  { char: '🎁', keywords: 'gift present' },
];

const TRAVEL: readonly Emoji[] = [
  { char: '🚗', keywords: 'car automobile' },
  { char: '🚕', keywords: 'taxi cab' },
  { char: '🚌', keywords: 'bus' },
  { char: '🏍️', keywords: 'motorcycle bike' },
  { char: '🚲', keywords: 'bicycle cycle' },
  { char: '🛺', keywords: 'auto rickshaw' },
  { char: '🚂', keywords: 'train locomotive' },
  { char: '✈️', keywords: 'airplane flight travel' },
  { char: '🚀', keywords: 'rocket launch space' },
  { char: '🛳️', keywords: 'ship cruise' },
  { char: '🏠', keywords: 'house home' },
  { char: '🏢', keywords: 'office building' },
  { char: '🏥', keywords: 'hospital' },
  { char: '🏦', keywords: 'bank' },
  { char: '🕌', keywords: 'mosque' },
  { char: '🛕', keywords: 'hindu temple' },
  { char: '⛪', keywords: 'church' },
  { char: '🗼', keywords: 'tower' },
  { char: '🏖️', keywords: 'beach' },
  { char: '⛰️', keywords: 'mountain' },
  { char: '🌃', keywords: 'night city stars' },
  { char: '🌍', keywords: 'earth globe world' },
  { char: '🗺️', keywords: 'map world' },
];

const OBJECTS: readonly Emoji[] = [
  { char: '💡', keywords: 'light bulb idea' },
  { char: '🔦', keywords: 'torch flashlight' },
  { char: '📱', keywords: 'phone mobile' },
  { char: '💻', keywords: 'laptop computer' },
  { char: '⌚', keywords: 'watch time' },
  { char: '📷', keywords: 'camera photo' },
  { char: '🎥', keywords: 'movie camera video' },
  { char: '📺', keywords: 'television tv' },
  { char: '☎️', keywords: 'telephone call' },
  { char: '🔋', keywords: 'battery' },
  { char: '💰', keywords: 'money bag cash' },
  { char: '💳', keywords: 'credit card payment' },
  { char: '💎', keywords: 'gem diamond' },
  { char: '🔑', keywords: 'key' },
  { char: '🔒', keywords: 'lock secure private' },
  { char: '📚', keywords: 'books reading' },
  { char: '📝', keywords: 'memo note writing' },
  { char: '✏️', keywords: 'pencil write' },
  { char: '📌', keywords: 'pushpin pin' },
  { char: '📎', keywords: 'paperclip attach' },
  { char: '✂️', keywords: 'scissors cut' },
  { char: '🧵', keywords: 'thread' },
  { char: '🕯️', keywords: 'candle' },
  { char: '🧸', keywords: 'teddy bear toy' },
  { char: '🎈', keywords: 'balloon' },
  { char: '💊', keywords: 'pill medicine' },
  { char: '🩹', keywords: 'bandage plaster' },
  { char: '🧴', keywords: 'lotion bottle' },
];

const SYMBOLS: readonly Emoji[] = [
  { char: '❤️', keywords: 'red heart love' },
  { char: '🧡', keywords: 'orange heart' },
  { char: '💛', keywords: 'yellow heart' },
  { char: '💚', keywords: 'green heart' },
  { char: '💙', keywords: 'blue heart' },
  { char: '💜', keywords: 'purple heart' },
  { char: '🖤', keywords: 'black heart' },
  { char: '🤍', keywords: 'white heart' },
  { char: '💔', keywords: 'broken heart' },
  { char: '💕', keywords: 'two hearts love' },
  { char: '💖', keywords: 'sparkling heart' },
  { char: '✨', keywords: 'sparkles shiny' },
  { char: '💫', keywords: 'dizzy star' },
  { char: '💯', keywords: 'hundred points perfect' },
  { char: '✅', keywords: 'check mark done tick yes' },
  { char: '❌', keywords: 'cross mark no wrong' },
  { char: '❓', keywords: 'question mark' },
  { char: '❗', keywords: 'exclamation mark' },
  { char: '⚠️', keywords: 'warning caution' },
  { char: '🚫', keywords: 'prohibited no' },
  { char: '🔔', keywords: 'bell notification' },
  { char: '🔕', keywords: 'bell mute silent' },
  { char: '➕', keywords: 'plus add' },
  { char: '➖', keywords: 'minus subtract' },
  { char: '🔴', keywords: 'red circle' },
  { char: '🟢', keywords: 'green circle' },
  { char: '🔵', keywords: 'blue circle' },
  { char: '⬛', keywords: 'black square' },
  { char: '⬜', keywords: 'white square' },
  { char: '🕉️', keywords: 'om hindu' },
  { char: '☮️', keywords: 'peace' },
  { char: '♻️', keywords: 'recycle' },
];

/** Every category except `recent`, which is built at runtime from storage. */
export const EMOJI_BY_CATEGORY: Readonly<
  Record<Exclude<EmojiCategoryId, 'recent'>, readonly Emoji[]>
> = {
  smileys: SMILEYS,
  people: PEOPLE,
  nature: NATURE,
  food: FOOD,
  activity: ACTIVITY,
  travel: TRAVEL,
  objects: OBJECTS,
  symbols: SYMBOLS,
};

/** Flat list, for search. Built once at module load, not per keystroke. */
export const ALL_EMOJI: readonly Emoji[] = Object.values(EMOJI_BY_CATEGORY).flat();

/**
 * Apply a skin tone, when the emoji takes one and a tone is chosen.
 *
 * The modifier goes after the base codepoint — but NOT after a trailing
 * VS16 (U+FE0F), which is why `✌️` is handled by stripping it first: `✌️🏽`
 * renders as a hand followed by a loose swatch on Android, while `✌🏽` is the
 * single toned glyph the user asked for.
 */
export function withTone(emoji: Emoji, tone: string): string {
  if (emoji.tone !== true || tone === '') {
    return emoji.char;
  }
  return emoji.char.replace(/️$/, '') + tone;
}

/**
 * Substring match over name and synonyms.
 *
 * Deliberately not fuzzy: a fuzzy match over a few hundred short keyword strings
 * puts "handshake" under "s" and reads as noise. A blank query returns nothing so
 * the caller can fall back to the browsing view rather than rendering everything.
 */
export function searchEmoji(query: string): readonly Emoji[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return [];
  }
  return ALL_EMOJI.filter(e => e.keywords.includes(q));
}
