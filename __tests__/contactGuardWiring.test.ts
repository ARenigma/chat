/**
 * Where the contact guard meets the app: the composer's precheck, the window
 * of recent own messages it reads, and the profile writes that map a P0011
 * refusal to the guard's own line.
 *
 * The screens import native modules jest cannot load, so the wiring is pinned
 * as source text; everything that can be called is called.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ContactGuardRefusalError,
  contactGuardRefusalFromError,
  precheckContactGuard,
} from '../src/lib/contactGuard';
import {
  CONTACT_WINDOW_MS,
  chatV2RecentOwnTexts,
  type ChatV2MessageRow,
  type ChatV2Row,
} from '../src/chat-v2/rows';
import type { TranscriptMessage } from '../src/lib/transcript';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const NOW = Date.parse('2026-09-27T10:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

let seq = 0;
function row(
  body: string | null,
  at: string,
  over: Partial<Pick<ChatV2MessageRow, 'mine' | 'pending' | 'failed' | 'deleted'>> = {},
): ChatV2MessageRow {
  seq += 1;
  const message = {
    id: `m${seq}`,
    conversation_id: 'c1',
    sender_id: over.mine === false ? 'peer' : 'me',
    body,
    created_at: at,
  } as unknown as TranscriptMessage;
  return {
    kind: 'message',
    id: `m${seq}`,
    sortAt: at,
    message,
    mine: true,
    first: true,
    last: true,
    opensDay: false,
    pending: false,
    failed: false,
    deleted: false,
    ...over,
  };
}

describe('chatV2RecentOwnTexts', () => {
  it('returns the last five own text bodies, oldest first', () => {
    // Newest first, as the transcript holds them.
    const rows: ChatV2Row[] = [1, 2, 3, 4, 5, 6].map(n => row(`t${n}`, ago(n * 1000)));
    expect(chatV2RecentOwnTexts(rows, NOW)).toEqual(['t5', 't4', 't3', 't2', 't1']);
  });

  it('skips the peer, pending, failed, deleted and bodiless rows', () => {
    const rows: ChatV2Row[] = [
      row('pending', ago(1000), { pending: true }),
      row('failed', ago(2000), { failed: true }),
      row('peer', ago(3000), { mine: false }),
      row(null, ago(4000)),
      row('deleted', ago(5000), { deleted: true }),
      { kind: 'system', id: 's1', sortAt: ago(6000), text: 'Session started', opensDay: false },
      row('kept', ago(7000)),
    ];
    expect(chatV2RecentOwnTexts(rows, NOW)).toEqual(['kept']);
  });

  it('stops at fifteen minutes', () => {
    const rows: ChatV2Row[] = [
      row('inside', ago(CONTACT_WINDOW_MS - 1)),
      row('outside', ago(CONTACT_WINDOW_MS + 1)),
    ];
    expect(chatV2RecentOwnTexts(rows, NOW)).toEqual(['inside']);
  });

  it('feeds the precheck a number split across messages', () => {
    const rows: ChatV2Row[] = [row('70158', ago(30_000))];
    const recent = chatV2RecentOwnTexts(rows, NOW);
    expect(precheckContactGuard('84326', 'enforce', recent)?.category).toBe('window');
    // Outside enforce mode the precheck never predicts.
    expect(precheckContactGuard('84326', 'shadow', recent)).toBeNull();
  });
});

describe('the composer precheck', () => {
  const screen = read('src/chat-v2/ChatScreenV2.tsx');
  const composer = read('src/chat-v2/ChatComposerV2.tsx');
  const onSend = screen.slice(screen.indexOf('const onSend = useCallback('), screen.indexOf('const onSendVoice'));

  it('checks before sending and keeps a predicted block out of the send', () => {
    expect(screen).toContain('const guardMode = useContactGuardMode();');
    expect(onSend).toMatch(/precheckContactGuard\(\s*text,\s*guardMode,\s*chatV2RecentOwnTexts\(/);
    expect(onSend).toMatch(/if \(refusal\) \{[\s\S]*contactGuardNotice\(refusal\)[\s\S]*errorTick\(\);\s*return false;/);
    // The refusal returns before sendText: a predicted block is never sent.
    expect(onSend.indexOf('return false')).toBeLessThan(onSend.indexOf('sendText('));
    expect(onSend).toMatch(/sendText\([^)]*\);\s*return true;/);
  });

  it('clears the field only when the send went ahead', () => {
    expect(composer).toContain('onSend: (text: string) => boolean;');
    expect(composer).toMatch(/if \(!onSend\(text\)\) \{\s*return;\s*\}\s*setText\(''\);/);
  });
});

describe('profile writes map P0011', () => {
  it('throws the guard line for a refused field', () => {
    const refusal = contactGuardRefusalFromError({
      code: 'P0011',
      details: '{"category":"phone","field":"about"}',
    });
    expect(refusal).not.toBeNull();
    const err = new ContactGuardRefusalError(refusal!);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Your about can't include contact details, links or social usernames.");
  });

  const SITES: ReadonlyArray<readonly [string, string]> = [
    ['src/api/profileSetup.ts', "rpc('claim_member_profile'"],
    ['src/api/profileSetup.ts', 'preferred_languages: [...languages]'],
    ['src/api/provider.ts', "rpc('complete_provider_onboarding'"],
    ['src/api/provider.ts', ".from('profiles').update(patch)"],
    ['src/api/provider.ts', "const { data, error } = await supabase.rpc('set_provider_expertise'"],
    // The Edit profile save (180): both of its writes map the refusal.
    ['src/api/provider.ts', "const { error } = await supabase.rpc('update_provider_profile'"],
    ['src/api/provider.ts', "const { error } = await supabase.rpc('set_provider_expertise'"],
  ];

  it.each(SITES)('%s at %s maps the refusal before its own throw', (file, marker) => {
    const source = read(file);
    const at = source.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const after = source.slice(at, at + 700);
    const mapped = after.indexOf('contactGuardRefusalFromError(error)');
    const thrown = after.indexOf('throw new ContactGuardRefusalError(refusal)');
    const generic = after.indexOf('throw new Error(error.message)');
    expect(mapped).toBeGreaterThan(-1);
    expect(thrown).toBeGreaterThan(mapped);
    expect(generic).toBeGreaterThan(thrown);
  });

  it('shows the guard line where onError had a generic one', () => {
    const provider = read('src/api/provider.ts');
    expect(provider.match(/err instanceof ContactGuardRefusalError\s*\?\s*err\.message/g)?.length).toBe(3);
  });
});
