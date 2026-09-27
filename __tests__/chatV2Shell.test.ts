import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('isolated V2 Kirill chat shell', () => {
  it('uses the reference keyboard hierarchy and native keyboard motion', () => {
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    const list = read('src/chat-v2/ChatListV2.tsx');

    expect(screen).toMatch(
      /<KeyboardGestureArea[\s\S]*<ChatListV2[\s\S]*<KeyboardStickyView[\s\S]*<ChatComposerV2/,
    );
    expect(list).toContain('<FlashList');
    expect(list).toContain('inverted');
    expect(list).toContain('renderScrollComponent={renderScrollComponent}');
    expect(list).toContain('<KeyboardChatScrollView');
    expect(list).toContain('automaticallyAdjustContentInsets={false}');
    expect(list).toContain('contentInsetAdjustmentBehavior="never"');
    expect(list).toContain('keyboardDismissMode="interactive"');
    expect(list).toContain('keyboardLiftBehavior="always"');
    expect(list).toContain('extraContentPadding={extraContentPadding}');
    expect(list).toContain("drawDistance={Dimensions.get('screen').height}");
    expect(list).toContain('getItemType={getItemType}');
    expect(screen).toContain('extraContentPadding.set(height)');
    // The MEASURED dock — every sticky child together — drives the gesture
    // area's offset and the transcript's padding, not the composer alone.
    expect(screen).toContain('offset={dockHeight}');
    expect(screen).toContain('onLayout={onDockLayout}');
    const composer = read('src/chat-v2/ChatComposerV2.tsx');
    const isolatedSources = `${screen}\n${list}\n${composer}`;
    expect(isolatedSources).not.toContain("from '../screens/ChatScreen'");
    expect(isolatedSources).not.toContain("from '../components/Turn'");
    expect(isolatedSources).not.toMatch(
      /from ['"][^'"]*(imeGeometry|keyboardEngine|keyboardPanel)/,
    );
    /*
     * The keyboard hierarchy itself still hand-rolls no motion: the IME lift is
     * native, on the UI thread, and a JS animation racing it is the
     * double-authority jump this rewrite exists to remove. The COMPOSER is no
     * longer in that ban — it now owns a mic, and the swap between the capsule
     * and the recording bar is a deliberate tap, not a keyboard event.
     */
    expect(`${screen}\n${list}`).not.toMatch(/\bentering=|withTiming|withSpring/);
    expect(composer).toContain("import { TextField } from '../components/TextField'");
  });

  it('exposes the stable V2 automation contract', () => {
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    const list = read('src/chat-v2/ChatListV2.tsx');
    const composer = read('src/chat-v2/ChatComposerV2.tsx');

    expect(screen).toContain('testID="chat-v2-screen"');
    // Back lives in `ChatHeaderV2` since the chrome was extracted — the screen
    // owns the keyboard hierarchy and nothing else.
    expect(read('src/chat-v2/ChatHeaderV2.tsx')).toContain(
      'testID="chat-v2-back"',
    );
    expect(list).toContain('testID="chat-v2-list"');
    expect(list).toContain('testID={`chat-v2-row-${item.id}`}');
    expect(composer).toContain('nativeID="chat-v2-input"');
    expect(composer).toContain('testID="chat-v2-input"');
    expect(composer).toContain('testID="chat-v2-send"');
    expect(composer).toContain('testID="chat-v2-mic"');
    // A refused send keeps the draft: the clear sits AFTER the early return.
    expect(composer).toMatch(/if \(!onSend\(text\)\) \{\s*return;\s*\}\s*setText\(''\);/);
  });
});
