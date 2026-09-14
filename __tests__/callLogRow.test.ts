import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Missed/declined/failed calls are the loud, tappable "call back" entry
 * (Amit, 2026-09-13, "show missed audio/video calls like whatsapp when any party
 * doesnt accept"); a connected call that ended stays a muted log line.
 */
describe('CallLogRow — missed calls are red and tappable, connected calls are muted', () => {
  const src = strip(read('src/components/CallLogRow.tsx'));

  it('tints missed/declined/failed with the danger colour', () => {
    expect(src).toContain('const unconnected = call.status !== ');
    // Icon and text take the danger tint on the unconnected path.
    expect(src).toContain('theme.color.state.danger');
    expect(src).toContain('color: t.color.state.danger');
  });

  it('makes an unconnected call tappable to call back, connected calls not', () => {
    expect(src).toContain('onCallBack');
    expect(src).toContain('testID="call-back"');
    expect(src).toContain('Tap to call back');
    // The call-back affordance is gated on onCallBack being provided, so a
    // missed row with calling disabled stays informative but non-tappable.
    expect(src).toContain('const canCallBack = onCallBack !== undefined;');
  });

  it('distinguishes voice from video in every state via the glyph', () => {
    expect(src).toContain("const iconName = isVideo ? 'video' : 'call';");
  });
});

describe('ChatScreen wires call-back only when a call can actually start', () => {
  const chat = strip(read('src/screens/ChatScreen.tsx'));

  it('passes onCallBack gated on medium being enabled and no non-chat session live', () => {
    expect(chat).toContain('onCallBack={onStartCall && allowed && !busy ? callBack : undefined}');
    expect(chat).toContain("item.call.medium === 'video' ? canStartVideo : canStartAudio");
    expect(chat).toContain("activeSession != null && activeSession.channel !== 'chat'");
  });
});
