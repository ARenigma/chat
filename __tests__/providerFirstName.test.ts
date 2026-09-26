/**
 * A provider is named by first name only, everywhere a member reads it (Amit,
 * 2026-09-27: "always render only first name of provider").
 *
 * Two copies of one rule: src/lib/display.ts for the app, and
 * supabase/functions/_shared/names.ts for the push senders, which cannot import
 * the app. Both run over the same table here. The surfaces are components that
 * jest cannot import, so their use of the helper is pinned as source text.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { providerFirstName } from '../src/lib/display';
import {
  providerFirstName as serverFirstName,
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
  ['Dr. Kavya Iyer', 'Dr.'],
  ['प्रिया शर्मा', 'प्रिया'],
  ['', ''],
  ['   ', ''],
  [null, ''],
  [undefined, ''],
];

describe('providerFirstName', () => {
  it.each(TABLE)('%j -> %j', (input, expected) => {
    expect(providerFirstName(input)).toBe(expected);
  });

  it('agrees with the push senders’ copy on every row', () => {
    for (const [input, expected] of TABLE) {
      expect(serverFirstName(input)).toBe(expected === '' ? null : expected);
    }
  });

  it('shortens a push name only for a provider', () => {
    expect(pushName('Priya Sharma', true)).toBe('Priya');
    expect(pushName('quiet river', false)).toBe('quiet river');
    expect(pushName(null, true)).toBeNull();
    expect(pushName(null, false)).toBeNull();
  });
});

describe('every surface that names a provider to a member uses it', () => {
  const SURFACES: ReadonlyArray<readonly [string, RegExp]> = [
    ['src/components/ProviderRow.tsx', /const firstName = providerFirstName\(provider\.display_name\);/],
    ['src/components/ProviderCard.tsx', /const firstName = providerFirstName\(provider\.display_name\);/],
    ['src/screens/HomeScreen.tsx', /name=\{providerFirstName\(featured\?\.display_name\) \|\| 'Someone for you'\}/],
    ['src/screens/HomeScreen.tsx', /chat\.i_am_member \? providerFirstName\(chat\.peer_display_name\)/],
    ['src/screens/HomeScreen.tsx', /\{providerFirstName\(provider\.display_name\)\}\s*<Text style=\{styles\.featuredAge\}>/],
    ['src/screens/ChatsListScreen.tsx', /c\.i_am_member \? providerFirstName\(c\.peer_display_name\)/],
    ['src/chat-v2/useChatV2Controller.ts', /isMemberSide\s*\?\s*providerFirstName\(fullName\)/],
    ['src/screens/ProviderDetailScreen.tsx', /\{providerFirstName\(provider\.display_name\)\}\s*<Text style=\{styles\.heroAge\}>/],
    ['src/screens/CallScreen.tsx', /isMemberSide \? providerFirstName\(full\)/],
    ['src/components/HomeSuggestionScreen.tsx', /\{providerFirstName\(suggestion\.display_name\)\}/],
    ['src/screens/UsageLedgerScreen.tsx', /row\.i_am_member \? providerFirstName\(row\.peer_name\)/],
    ['supabase/functions/send-push/index.ts', /pushName\(row\.sender_display_name, senderIsProvider\)/],
    ['supabase/functions/send-call/index.ts', /pushName\(row\.caller_display_name, callerIsProvider\)/],
    ['supabase/functions/send-engagement/index.ts', /providerFirstName\(row\.provider_display_name\)/],
    ['supabase/functions/send-open-alert/index.ts', /providerFirstName\(directory\?\.display_name\)/],
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
