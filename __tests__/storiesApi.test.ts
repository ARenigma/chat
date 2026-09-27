jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
    functions: { invoke: jest.fn() },
    auth: { getSession: jest.fn() },
  },
}));
jest.mock('../src/lib/uploadStall', () => ({ armStallDetector: () => () => undefined }));

import { supabase } from '../src/lib/supabase';
import {
  blockCommentAuthor,
  fetchComments,
  fetchStoryMediaUrl,
  postStory,
  postStoryComment,
  reactToStoryComment,
  storyRefusalLine,
  toggleStoryReaction,
} from '../src/api/stories';
import type { StoryDraft } from '../src/lib/stories';

const rpc = supabase.rpc as jest.Mock;
const from = supabase.from as jest.Mock;
const invoke = supabase.functions.invoke as jest.Mock;
const getSession = supabase.auth.getSession as jest.Mock;

const PROVIDER = '11111111-1111-4111-8111-111111111111';
const STORY = '22222222-2222-4222-8222-222222222222';

/** A chainable query builder that resolves to `result` wherever it is awaited. */
function builder(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'delete']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(result);
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { b, calls };
}

/** XMLHttpRequest, answering every send with `status` (0 = network error). */
function fakeXhr(status: number) {
  const opened: string[] = [];
  class FakeXhr {
    upload: { onprogress?: (e: unknown) => void } = {};
    status = status;
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open(_m: string, url: string) {
      opened.push(url);
    }
    setRequestHeader() {}
    send() {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      if (status === 0) {
        this.onerror?.();
      } else {
        this.onload?.();
      }
    }
  }
  (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  return opened;
}

const video: StoryDraft = {
  uri: 'content://media/1',
  mime: 'video/mp4',
  mediaType: 'video',
  durationMs: 12_000,
  bytes: 1_000,
  width: 1080,
  height: 1920,
};

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  invoke.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
});

describe('reactions', () => {
  it('toggles through toggle_story_reaction with the allowlisted emoji', async () => {
    rpc.mockResolvedValue({ data: { success: true, emoji: '❤️' }, error: null });
    const result = await toggleStoryReaction(STORY, '❤️');
    expect(rpc).toHaveBeenCalledWith('toggle_story_reaction', { p_story_id: STORY, p_emoji: '❤️' });
    expect(result.emoji).toBe('❤️');
  });

  it('a transport error is a refusal, not a throw', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await toggleStoryReaction(STORY, '👍')).toEqual({ success: false, error: 'BAD_REQUEST' });
  });

  it('the provider likes a comment through react_to_story_comment', async () => {
    rpc.mockResolvedValue({ data: { success: true, emoji: '❤️' }, error: null });
    await reactToStoryComment('c1', '❤️');
    expect(rpc).toHaveBeenCalledWith('react_to_story_comment', { p_comment_id: 'c1', p_emoji: '❤️' });
  });
});

describe('comments', () => {
  it('posts with the client-minted id, so a retry is the same comment', async () => {
    rpc.mockResolvedValue({ data: { success: true, comment_id: 'c1' }, error: null });
    await postStoryComment(STORY, 'hello', 'c1');
    await postStoryComment(STORY, 'hello', 'c1');
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc).toHaveBeenCalledWith('post_story_comment', {
      p_comment_id: 'c1',
      p_story_id: STORY,
      p_body: 'hello',
    });
  });

  it('shows the contact guard line for a guarded refusal', () => {
    expect(storyRefusalLine({ error: 'CONTACT_INFO', surface: 'story_comment' } as never)).toMatch(/Public posts/);
    expect(storyRefusalLine({ error: 'RATE_LIMITED' })).toMatch(/Slow down/);
  });

  it('reads only the public feed view, oldest first', async () => {
    const { b, calls } = builder({ data: [{ id: 'c1' }], error: null });
    from.mockReturnValue(b);
    expect(await fetchComments(STORY)).toEqual([{ id: 'c1' }]);
    expect(from).toHaveBeenCalledWith('story_comment_feed');
    expect(calls).toContainEqual(['eq', ['story_id', STORY]]);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: true }]]);
  });

  it('a member and a provider block through their own RPCs', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null });
    await blockCommentAuthor('c1', false);
    await blockCommentAuthor('c1', true);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['block_story_comment_author', 'block_story_commenter']);
  });
});

describe('media', () => {
  it('asks story-media-url, never the bucket', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://x', media_type: 'image', expires_in: 60 }, error: null });
    expect((await fetchStoryMediaUrl(STORY)).url).toBe('https://x');
    expect(invoke).toHaveBeenCalledWith('story-media-url', { body: { story_id: STORY } });
  });

  it('a 404 is NOT_FOUND', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: '404' } });
    await expect(fetchStoryMediaUrl(STORY)).rejects.toThrow('NOT_FOUND');
  });
});

describe('posting a story', () => {
  it('uploads to stories/{provider}/{story}.mp4, then calls create_story', async () => {
    const opened = fakeXhr(200);
    rpc.mockResolvedValue({ data: { success: true, story_id: 'S' }, error: null });
    const progress: number[] = [];
    const out = await postStory(PROVIDER, video, '  hi  ', null, f => progress.push(f));
    expect(out).toEqual({ ok: true, storyId: 'S' });
    expect(opened[0]).toMatch(new RegExp(`/storage/v1/object/stories/${PROVIDER}/[0-9a-f-]{36}\\.mp4$`));
    expect(progress).toEqual([0.5]);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('create_story');
    expect(args.p_media_type).toBe('video');
    expect(args.p_caption).toBe('hi');
    expect(args.p_duration_ms).toBe(12_000);
    expect(opened[0]).toContain(args.p_media_path);
  });

  it('refuses a clip over 30s before uploading anything', async () => {
    const opened = fakeXhr(200);
    const out = await postStory(PROVIDER, { ...video, durationMs: 45_000 }, '', null);
    expect(out.ok).toBe(false);
    expect(opened).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a failed upload is retryable with the same id; the retry does not re-upload after success', async () => {
    fakeXhr(0);
    const first = await postStory(PROVIDER, video, '', null);
    expect(first.ok).toBe(false);
    if (first.ok) {
      return;
    }
    expect(first.retryable).toBe(true);
    const opened = fakeXhr(200);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'net' } });
    const second = await postStory(PROVIDER, video, '', first.attempt);
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.attempt.storyId).toBe(first.attempt.storyId);
    expect(second.attempt.uploaded).toBe(true);
    rpc.mockResolvedValueOnce({ data: { success: true, story_id: first.attempt.storyId }, error: null });
    const third = await postStory(PROVIDER, video, '', second.attempt);
    expect(third.ok).toBe(true);
    expect(opened).toHaveLength(1);
  });

  it('maps the cap and the kill switch, and mints a new id after MEDIA_RELEASED', async () => {
    fakeXhr(200);
    rpc.mockResolvedValueOnce({ data: { success: false, error: 'LIMIT_REACHED' }, error: null });
    const capped = await postStory(PROVIDER, video, '', null);
    expect(!capped.ok && capped.line).toMatch(/30 live stories/);
    rpc.mockResolvedValueOnce({ data: { success: false, error: 'STORIES_DISABLED' }, error: null });
    const off = await postStory(PROVIDER, video, '', null);
    expect(!off.ok && off.line).toMatch(/paused/);
    rpc.mockResolvedValueOnce({ data: { success: false, error: 'MEDIA_RELEASED' }, error: null });
    const released = await postStory(PROVIDER, video, '', { storyId: STORY, uploaded: true });
    expect(!released.ok && released.attempt.storyId).not.toBe(STORY);
    expect(!released.ok && released.attempt.uploaded).toBe(false);
  });

  it('shows the guard line for a caption with contact details', async () => {
    fakeXhr(200);
    rpc.mockResolvedValueOnce({
      data: { success: false, error: 'CONTACT_INFO', surface: 'story_caption' },
      error: null,
    });
    const out = await postStory(PROVIDER, video, 'call me', null);
    expect(!out.ok && out.line).toMatch(/Public posts/);
  });
});
