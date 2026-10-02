/**
 * The transcript's scroll indicator sits on the right, like Android's own,
 * Bluesky's and WhatsApp's (Amit, S22 2026-10-03). FlashList's Android
 * inversion is a 180° rotation, which carried the native bar to the left.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  SCROLL_BAR_DEFAULT_DELAY_MS,
  SCROLL_BAR_FADE_DURATION_MS,
  chatV2ThumbGeometry,
} from '../src/chat-v2/chatState';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('chat scroll thumb', () => {
  it('is hidden when nothing scrolls', () => {
    expect(chatV2ThumbGeometry({ offset: 0, content: 500, viewport: 800, track: 700 })).toBeNull();
  });

  it('sits at the bottom at the newest message, the list being inverted', () => {
    const g = chatV2ThumbGeometry({ offset: 0, content: 4000, viewport: 800, track: 700 });
    expect(g).not.toBeNull();
    expect(g!.top + g!.length).toBeCloseTo(700);
  });

  it('reaches the top at the oldest message', () => {
    const g = chatV2ThumbGeometry({ offset: 3200, content: 4000, viewport: 800, track: 700 });
    expect(g!.top).toBeCloseTo(0);
  });

  it('is proportional, with a floor so a long transcript still shows one', () => {
    expect(chatV2ThumbGeometry({ offset: 0, content: 1600, viewport: 800, track: 800 })!.length).toBe(400);
    expect(chatV2ThumbGeometry({ offset: 0, content: 100000, viewport: 800, track: 800 })!.length).toBe(32);
  });

  it("uses ViewConfiguration's own timing", () => {
    expect(SCROLL_BAR_DEFAULT_DELAY_MS).toBe(300);
    expect(SCROLL_BAR_FADE_DURATION_MS).toBe(250);
  });

  it('turns the native (left-side) bar off and mounts this one', () => {
    const list = read('src/chat-v2/ChatListV2.tsx');
    expect(list).toContain('showsVerticalScrollIndicator={false}');
    expect(list).toContain('<ChatScrollThumbV2');
  });
});
