/**
 * Every person is named by first name only, in the app and in notifications
 * (Amit, 2026-09-27 for providers; 2026-10-03 for everyone: "always show only
 * first name everywhere whether in app or notification").
 *
 * Two copies of one rule: src/lib/display.ts for the app, and
 * supabase/functions/_shared/names.ts for the push senders, which cannot import
 * the app. Both run over the same table here. The surfaces are components that
 * jest cannot import, so their use of the helper is pinned as source text.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { firstName } from '../src/lib/display';
import {
  firstName as serverFirstName,
  pushName,
} from '../supabase/functions/_shared/names';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const TABLE: ReadonlyArray<readonly [string | null | undefined, string]> = [
  ['Priya Sharma', 'Priya'],
  ['  Priya   Sharma  ', 'Priya'],
  ['Priya', 'Priya'],
  ['Anjali\tDevi Rao', 'Anjali'],
  ['Meera\nK', 'Meera'],
  ['Dr. Kavya Iyer', 'Kavya'],
  ['dr kavya', 'kavya'],
  ['Smt Lalita Rao', 'Lalita'],
  ['Dr.', 'Dr.'],
  ['Pandit Ramesh', 'Pandit'],
  ['Drishti Rao', 'Drishti'],
  ['प्रिया शर्मा', 'प्रिया'],
  ['', ''],
  ['   ', ''],
  [null, ''],
  [undefined, ''],
];

describe('firstName', () => {
  it.each(TABLE)('%j -> %j', (input, expected) => {
    expect(firstName(input)).toBe(expected);
  });

  it('agrees with the push senders’ copy on every row', () => {
    for (const [input, expected] of TABLE) {
      expect(serverFirstName(input)).toBe(expected === '' ? null : expected);
    }
  });

  it('shortens every push name, member or provider', () => {
    expect(pushName('Priya Sharma', true)).toBe('Priya');
    expect(pushName('Amit ranjan', false)).toBe('Amit');
    expect(pushName(null, true)).toBeNull();
    expect(pushName(null, false)).toBeNull();
  });
});

describe('every surface that names a person uses it', () => {
  const SURFACES: ReadonlyArray<readonly [string, RegExp]> = [
    ['src/components/ProviderRow.tsx', /const firstName = getFirstName\(provider\.display_name\);/],
    ['src/components/ProviderCard.tsx', /const firstName = getFirstName\(provider\.display_name\);/],
    ['src/screens/HomeScreen.tsx', /name=\{firstName\(featured\?\.display_name\) \|\| 'Someone for you'\}/],
    ['src/screens/HomeScreen.tsx', /const name = firstName\(chat\.peer_display_name\)/],
    ['src/screens/HomeScreen.tsx', /style=\{styles\.featuredName\}>\s*\{firstName\(provider\.display_name\)\}\s*<\/Text>/],
    ['src/screens/ChatsListScreen.tsx', /const peerName = firstName\(c\.peer_display_name\)/],
    // The chat header, notices, reply strip and review sheet, both sides.
    ['src/chat-v2/useChatV2Controller.ts', /: firstName\(fullName\) \|\| undefined;/],
    ['src/screens/ProviderDetailScreen.tsx', /\{firstName\(provider\.display_name\)\}\s*<Text style=\{styles\.heroAge\}>/],
    ['src/screens/CallScreen.tsx', /const shown = firstName\(full\)/],
    ['src/components/HomeSuggestionScreen.tsx', /\{firstName\(suggestion\.display_name\)\}/],
    ['src/screens/UsageLedgerScreen.tsx', /\{firstName\(row\.peer_name\)/],
    // What a provider sees of a member.
    ['src/screens/ProviderChatsScreen.tsx', /firstName\(item\.peer_display_name\)/],
    ['src/screens/ProviderSavedScreen.tsx', /firstName\(item\.peer_display_name\)/],
    // C11 (2026-10-09): label-resolved displayName is computed with firstName;
    // the render now reads `{displayName}` but the firstName call is still there.
    ['src/components/ChatRequestScreen.tsx', /firstName\(incoming\.peerName\)/],
    ['src/screens/BlockedUsersScreen.tsx', /\{firstName\(p\.display_name\)/],
    ['src/screens/StoryViewerScreen.tsx', /name: firstName\(p\?\.display_name\)/],
    ['src/screens/StoryViewerScreen.tsx', /name=\{firstName\(v\.display_name\)/],
    ['src/components/stories/StoryReplySheet.tsx', /\{firstName\(c\.author_display_name\)/],
    ['src/components/stories/StoryRail.tsx', /const name = firstName\(p\?\.display_name\)/],
    ['supabase/functions/_shared/names.ts', /export function pushName[^{]*\{\s*return providerFirstName\(displayName\);/],
    ['supabase/functions/send-push/index.ts', /pushName\(row\.sender_display_name, senderIsProvider\)/],
    ['supabase/functions/send-call/index.ts', /pushName\(row\.caller_display_name, callerIsProvider\)/],
    ['supabase/functions/send-engagement/index.ts', /providerFirstName\(row\.provider_display_name\)/],
    ['supabase/functions/send-open-alert/index.ts', /providerFirstName\(directory\.display_name\)/],
    ['supabase/functions/send-open-alert/index.ts', /providerFirstName\(handle as string \| null\)/],
  ];

  it.each(SURFACES)('%s', (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  /*
   * No full name left on screen in the member's provider surfaces: every
   * rendered `{provider.display_name}` and every `${provider.display_name}` in
   * a label goes through the helper. `initialOf(provider.display_name)` stays,
   * the initial is the same letter.
   */
  it('the app no longer has a provider-only helper', () => {
    expect(read('src/lib/display.ts')).not.toMatch(/export function providerFirstName/);
  });

  it.each([
    'src/components/ProviderRow.tsx',
    'src/components/ProviderCard.tsx',
    'src/screens/ProviderDetailScreen.tsx',
  ])('%s renders no whole display_name', file => {
    const source = read(file);
    expect(source).not.toMatch(/\{provider\.display_name\}/);
    expect(source).not.toMatch(/\$\{provider\.display_name\}/);
  });

  it('the senders look the role up, not the directory', () => {
    for (const fn of ['send-push', 'send-call']) {
      const source = read(`supabase/functions/${fn}/index.ts`);
      expect(source).toMatch(/\.from\('profiles'\)\s*\.select\('id'\)\s*\.in\('id', peerIds\)\s*\.eq\('role', 'provider'\)/);
    }
  });
});
