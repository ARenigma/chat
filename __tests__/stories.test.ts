import type { Story } from '../src/lib/database.types';
import {
  canComment,
  captionTooLong,
  currentStory,
  draftDurationMs,
  draftProblem,
  groupStories,
  initialViewerState,
  isOwnStory,
  orderRail,
  playMs,
  storyExtForMime,
  storyMediaPath,
  storyMimeForPath,
  storyAge,
  storyNotice,
  viewerReducer,
  type StoryDraft,
  type ViewerState,
} from '../src/lib/stories';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

function story(id: string, provider: string, minutesAgo: number, over: Partial<Story> = {}): Story {
  const created = NOW - minutesAgo * 60_000;
  return {
    id,
    provider_id: provider,
    media_type: 'image',
    media_path: `${provider}/${id}.jpg`,
    caption: null,
    duration_ms: 7000,
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + 24 * 3600_000).toISOString(),
    ...over,
  };
}

describe('the upload path', () => {
  const SID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

  it('is {provider_id}/{story_id}.{ext}, lower case, as 144 policy requires', () => {
    expect(storyMediaPath(P1, SID, 'image/jpeg')).toBe(`${P1}/${SID.toLowerCase()}.jpg`);
    expect(storyMediaPath(P1, SID, 'video/mp4')).toBe(`${P1}/${SID.toLowerCase()}.mp4`);
    expect(storyMediaPath(P1, SID, 'image/png')?.endsWith('.png')).toBe(true);
    expect(storyMediaPath(P1, SID, 'image/webp')?.endsWith('.webp')).toBe(true);
  });

  it('matches the regex story_media_upload_allowed checks', () => {
    const re =
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|mp4)$/;
    expect(storyMediaPath(P1.toUpperCase(), SID, 'image/jpeg')).toMatch(re);
  });

  it('refuses what the bucket refuses', () => {
    expect(storyMediaPath(P1, SID, 'image/heic')).toBeNull();
    expect(storyMediaPath(P1, SID, 'video/quicktime')).toBeNull();
    expect(storyExtForMime(undefined)).toBeNull();
  });

  it('sends the content type create_story checks against the extension', () => {
    expect(storyMimeForPath('a/b.jpg')).toBe('image/jpeg');
    expect(storyMimeForPath('a/b.png')).toBe('image/png');
    expect(storyMimeForPath('a/b.webp')).toBe('image/webp');
    expect(storyMimeForPath('a/b.mp4')).toBe('video/mp4');
  });
});

describe('a pick', () => {
  const base: StoryDraft = {
    uri: 'content://x',
    mime: 'video/mp4',
    mediaType: 'video',
    durationMs: 12_000,
    bytes: 1_000_000,
    width: 1080,
    height: 1920,
  };

  it('takes a video up to 30s', () => {
    expect(draftProblem(base)).toBeNull();
    expect(draftProblem({ ...base, durationMs: 30_000 })).toBeNull();
    expect(draftProblem({ ...base, durationMs: 30_001 })).toBe('TOO_LONG');
    expect(draftProblem({ ...base, durationMs: null })).toBe('TOO_LONG');
    expect(draftProblem({ ...base, durationMs: 400 })).toBe('TOO_SHORT');
  });

  it('refuses over 50 MB and unsupported types', () => {
    expect(draftProblem({ ...base, bytes: 60 * 1024 * 1024 })).toBe('TOO_LARGE');
    expect(draftProblem({ ...base, mime: 'video/quicktime' })).toBe('UNSUPPORTED');
    expect(draftProblem({ ...base, mediaType: 'image' })).toBe('UNSUPPORTED');
  });

  it('sends an image 7s and a video its own length', () => {
    expect(draftDurationMs({ ...base, mediaType: 'image', mime: 'image/jpeg' })).toBe(7000);
    expect(draftDurationMs({ ...base, durationMs: 12_345 })).toBe(12_345);
  });

  it('holds a caption to 200 characters and 3 line breaks', () => {
    expect(captionTooLong('a'.repeat(200))).toBe(false);
    expect(captionTooLong('a'.repeat(201))).toBe(true);
    expect(captionTooLong('a\nb\nc\nd')).toBe(false);
    expect(captionTooLong('a\nb\nc\nd\ne')).toBe(true);
  });
});

describe('the rail', () => {
  const rows = [
    story('a1', P1, 300),
    story('a2', P1, 200),
    story('b1', P2, 100),
    story('c1', P3, 50),
    story('old', P3, 25 * 60),
  ];

  it('groups by provider, oldest first, dropping expired', () => {
    const groups = groupStories(rows, NOW);
    const p3 = groups.find(g => g.providerId === P3);
    expect(p3?.stories.map(s => s.id)).toEqual(['c1']);
    expect(groups.find(g => g.providerId === P1)?.stories.map(s => s.id)).toEqual(['a1', 'a2']);
  });

  it('puts unseen first, newest first within each half', () => {
    const groups = groupStories(rows, NOW);
    const seen = new Set(['c1']);
    expect(orderRail(groups, seen).map(g => g.providerId)).toEqual([P2, P1, P3]);
    expect(orderRail(groups, new Set()).map(g => g.providerId)).toEqual([P3, P2, P1]);
  });
});

describe('the viewer state machine', () => {
  const groups = groupStories(
    [story('a1', P1, 300), story('a2', P1, 200), story('b1', P2, 100), story('b2', P2, 90)],
    NOW,
  );
  const open = (provider = P1, seen: ReadonlySet<string> = new Set()): ViewerState =>
    initialViewerState(groups, provider, seen);
  const ids = (s: ViewerState) => currentStory(s)?.id;

  it('opens a provider at its first unseen story', () => {
    expect(ids(open(P1, new Set(['a1'])))).toBe('a2');
    expect(ids(open(P1, new Set(['a1', 'a2'])))).toBe('a1');
  });

  it('advances within a provider, then across, then closes', () => {
    let s = open();
    s = viewerReducer(s, { type: 'next' });
    expect(ids(s)).toBe('a2');
    s = viewerReducer(s, { type: 'next' });
    expect(ids(s)).toBe('b1');
    s = viewerReducer(s, { type: 'next' });
    s = viewerReducer(s, { type: 'next' });
    expect(s.closed).toBe(true);
  });

  it('goes back to the previous provider at its last story', () => {
    let s = open(P2);
    s = viewerReducer(s, { type: 'prev' });
    expect(ids(s)).toBe('a2');
    s = viewerReducer(s, { type: 'prev' });
    s = viewerReducer(s, { type: 'prev' });
    expect(ids(s)).toBe('a1');
    expect(s.closed).toBe(false);
  });

  it('pauses and resumes without moving', () => {
    let s = viewerReducer(open(), { type: 'pause' });
    expect(s.paused).toBe(true);
    expect(ids(s)).toBe('a1');
    s = viewerReducer(s, { type: 'resume' });
    expect(s.paused).toBe(false);
  });

  it('does nothing once closed', () => {
    const closed = viewerReducer(open(), { type: 'close' });
    expect(viewerReducer(closed, { type: 'next' })).toBe(closed);
  });

  it('prunes an expired story and keeps its place', () => {
    let s = viewerReducer(open(), { type: 'next' }); // a2
    const a1Expiry = Date.parse(groups[0]!.stories[0]!.expires_at);
    s = viewerReducer(s, { type: 'prune', nowMs: a1Expiry + 1 });
    expect(ids(s)).toBe('a2');
    expect(s.storyIndex).toBe(0);
  });

  it('moves to the next provider when the current one runs out', () => {
    let s = open();
    s = viewerReducer(s, { type: 'prune', nowMs: NOW, removedIds: ['a1', 'a2'] });
    expect(ids(s)).toBe('b1');
    s = viewerReducer(s, { type: 'prune', nowMs: NOW, removedIds: ['b1', 'b2'] });
    expect(s.closed).toBe(true);
  });

  it('caps play time at the 30s the backend allows', () => {
    expect(playMs({ media_type: 'video', duration_ms: 90_000 })).toBe(30_000);
    expect(playMs({ media_type: 'image', duration_ms: 7000 })).toBe(7000);
    expect(playMs({ media_type: 'video', duration_ms: 0 })).toBe(30_000);
  });
});

describe('who may do what', () => {
  const s = story('x', P1, 5);

  it('a provider never gets the comment input on their own story', () => {
    expect(canComment(P1, s)).toBe(false);
    expect(canComment(P2, s)).toBe(true);
    expect(canComment(undefined, s)).toBe(false);
    expect(isOwnStory(P1, s)).toBe(true);
    expect(isOwnStory(P2, s)).toBe(false);
  });

  it('maps every refusal to a line', () => {
    expect(storyNotice('LIMIT_REACHED')).toMatch(/30/);
    expect(storyNotice('STORIES_DISABLED')).toMatch(/paused/);
    expect(storyNotice('TOO_LONG')).toMatch(/30 seconds/);
    expect(storyNotice('nonsense')).toBe(storyNotice('BAD_REQUEST'));
  });
});

describe('the posted-at stamp', () => {
  it('reads now, minutes, then hours, never days', () => {
    expect(storyAge(new Date(NOW - 20_000).toISOString(), NOW)).toBe('now');
    expect(storyAge(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe('12m');
    expect(storyAge(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toBe('3h');
    expect(storyAge(new Date(NOW - 30 * 3600_000).toISOString(), NOW)).toBe('23h');
  });
});
