/**
 * Stories, the pure half: the upload key, the pick checks, the rail order, the
 * viewer's state machine and the error copy. No React, no Supabase, so every
 * rule here is a unit test (__tests__/stories.test.ts) rather than a device
 * check.
 *
 * The backend is migrations 143-152; database.types.ts carries the shapes.
 */
import type { Story, StoryError, StoryMediaType } from './database.types';

/** The private bucket (144). */
export const STORIES_BUCKET = 'stories';

/** 144's `file_size_limit`: the Storage API refuses anything larger. */
const MAX_STORY_BYTES = 50 * 1024 * 1024;

/** 143's `story_duration_in_range`: a video clip is 1-30s. */
const MAX_VIDEO_MS = 30_000;
const MIN_VIDEO_MS = 1_000;

/** 143: an image shows for 7s when no duration is given. */
const IMAGE_DISPLAY_MS = 7_000;

/** 143's caption rule: 1-200 characters, at most 3 line breaks. */
export const MAX_CAPTION_CHARS = 200;
const MAX_CAPTION_LINE_BREAKS = 3;

/** 147's comment rule: 1-500 visible characters, at most 6 lines. */
export const MAX_COMMENT_CHARS = 500;

type StoryExt = 'jpg' | 'png' | 'webp' | 'mp4';

/**
 * The extension 144's bucket accepts for a content type, or null when the
 * bucket would refuse it. One for one with `allowed_mime_types`, and with the
 * extension check create_story runs (MEDIA_MISMATCH), so a pick that passes
 * here cannot be refused for its type there.
 */
export function storyExtForMime(mime: string | null | undefined): StoryExt | null {
  switch ((mime ?? '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    default:
      return null;
  }
}

/** The upload's content type, from the key's extension, as create_story checks it. */
export function storyMimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'mp4':
      return 'video/mp4';
    default:
      return 'image/jpeg';
  }
}

/**
 * `{provider_id}/{story_id}.{ext}`: the only name 144's upload policy
 * (story_media_upload_allowed) lets the caller write. Lower-case ids, because
 * the policy's regex is lower-case hex.
 */
export function storyMediaPath(providerId: string, storyId: string, mime: string): string | null {
  const ext = storyExtForMime(mime);
  if (ext === null) {
    return null;
  }
  return `${providerId.toLowerCase()}/${storyId.toLowerCase()}.${ext}`;
}

/** What the Photo Picker handed back, reduced to what a story needs. */
export interface StoryDraft {
  uri: string;
  mime: string;
  mediaType: StoryMediaType;
  /** Video only, in milliseconds. */
  durationMs: number | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
}

export type DraftProblem = 'UNSUPPORTED' | 'TOO_LONG' | 'TOO_SHORT' | 'TOO_LARGE';

/** Why a pick cannot be posted, before a byte is uploaded; null when it can. */
export function draftProblem(draft: StoryDraft): DraftProblem | null {
  const ext = storyExtForMime(draft.mime);
  if (ext === null || (draft.mediaType === 'video') !== (ext === 'mp4')) {
    return 'UNSUPPORTED';
  }
  if (draft.bytes !== null && draft.bytes > MAX_STORY_BYTES) {
    return 'TOO_LARGE';
  }
  if (draft.mediaType === 'video') {
    if (draft.durationMs === null || draft.durationMs > MAX_VIDEO_MS) {
      return 'TOO_LONG';
    }
    if (draft.durationMs < MIN_VIDEO_MS) {
      return 'TOO_SHORT';
    }
  }
  return null;
}

/** The duration create_story is sent: the clip's, or the image default. */
export function draftDurationMs(draft: StoryDraft): number {
  return draft.mediaType === 'video'
    ? Math.min(MAX_VIDEO_MS, Math.max(MIN_VIDEO_MS, Math.round(draft.durationMs ?? MAX_VIDEO_MS)))
    : IMAGE_DISPLAY_MS;
}

/** A caption the server would store, trimmed; null for blank. Mirrors 143's story_text_trim. */
export function normaliseCaption(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** Whether a caption breaks 143's length or line-break rule. */
export function captionTooLong(text: string): boolean {
  const t = text.trim();
  return [...t].length > MAX_CAPTION_CHARS || (t.match(/\n/g)?.length ?? 0) > MAX_CAPTION_LINE_BREAKS;
}

// ---------------------------------------------------------------------------
// The rail and the viewer
// ---------------------------------------------------------------------------

/** One provider's live stories, oldest first, as the viewer plays them. */
export interface StoryGroup {
  providerId: string;
  stories: Story[];
}

/** Group a flat list by provider, each group oldest first. Expired rows dropped. */
export function groupStories(stories: readonly Story[], nowMs: number): StoryGroup[] {
  const byProvider = new Map<string, Story[]>();
  for (const s of stories) {
    if (Date.parse(s.expires_at) <= nowMs) {
      continue;
    }
    const list = byProvider.get(s.provider_id) ?? [];
    list.push(s);
    byProvider.set(s.provider_id, list);
  }
  return [...byProvider.entries()].map(([providerId, list]) => ({
    providerId,
    stories: list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
  }));
}

export function groupHasUnseen(group: StoryGroup, seen: ReadonlySet<string>): boolean {
  return group.stories.some(s => !seen.has(s.id));
}

function latestMs(group: StoryGroup): number {
  const last = group.stories[group.stories.length - 1];
  return last === undefined ? 0 : Date.parse(last.created_at);
}

/**
 * The rail's order: providers with anything unseen first, then the rest; each
 * half newest post first. Stable for equal times by provider id, so the rail
 * does not reshuffle between two fetches that changed nothing.
 */
export function orderRail(groups: readonly StoryGroup[], seen: ReadonlySet<string>): StoryGroup[] {
  return [...groups].sort((a, b) => {
    const ua = groupHasUnseen(a, seen) ? 0 : 1;
    const ub = groupHasUnseen(b, seen) ? 0 : 1;
    if (ua !== ub) {
      return ua - ub;
    }
    const t = latestMs(b) - latestMs(a);
    return t !== 0 ? t : a.providerId.localeCompare(b.providerId);
  });
}

/** Where a group opens: its first unseen story, or the start when all are seen. */
function firstUnseenIndex(group: StoryGroup, seen: ReadonlySet<string>): number {
  const i = group.stories.findIndex(s => !seen.has(s.id));
  return i === -1 ? 0 : i;
}

export interface ViewerState {
  groups: StoryGroup[];
  groupIndex: number;
  storyIndex: number;
  /** Held by a finger, the sheet, a menu, or the app in the background. */
  paused: boolean;
  closed: boolean;
}

export type ViewerAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'close' }
  /** Drop what expired (or was deleted) since the viewer opened. */
  | { type: 'prune'; nowMs: number; removedIds?: readonly string[] };

export function initialViewerState(
  groups: StoryGroup[],
  startProviderId: string,
  seen: ReadonlySet<string>,
): ViewerState {
  const groupIndex = Math.max(
    0,
    groups.findIndex(g => g.providerId === startProviderId),
  );
  const group = groups[groupIndex];
  return {
    groups,
    groupIndex,
    storyIndex: group === undefined ? 0 : firstUnseenIndex(group, seen),
    paused: false,
    closed: group === undefined,
  };
}

export function currentStory(state: ViewerState): Story | null {
  return state.groups[state.groupIndex]?.stories[state.storyIndex] ?? null;
}

/**
 * The viewer's transitions. Next past the last story of the last provider
 * closes; prev before the first story of a provider goes to the LAST story of
 * the provider before (the order the user just watched), and at the very
 * start restarts the first story rather than closing.
 */
export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  if (state.closed && action.type !== 'prune') {
    return state;
  }
  switch (action.type) {
    case 'next': {
      const group = state.groups[state.groupIndex];
      if (group !== undefined && state.storyIndex < group.stories.length - 1) {
        return { ...state, storyIndex: state.storyIndex + 1 };
      }
      if (state.groupIndex < state.groups.length - 1) {
        return { ...state, groupIndex: state.groupIndex + 1, storyIndex: 0 };
      }
      return { ...state, closed: true };
    }
    case 'prev': {
      if (state.storyIndex > 0) {
        return { ...state, storyIndex: state.storyIndex - 1 };
      }
      if (state.groupIndex > 0) {
        const before = state.groups[state.groupIndex - 1];
        return {
          ...state,
          groupIndex: state.groupIndex - 1,
          storyIndex: Math.max(0, (before?.stories.length ?? 1) - 1),
        };
      }
      return { ...state, storyIndex: 0 };
    }
    case 'pause':
      return state.paused ? state : { ...state, paused: true };
    case 'resume':
      return state.paused ? { ...state, paused: false } : state;
    case 'close':
      return { ...state, closed: true };
    case 'prune': {
      const removed = new Set(action.removedIds ?? []);
      const current = currentStory(state);
      const currentGroup = state.groups[state.groupIndex]?.providerId;
      const groups = state.groups
        .map(g => ({
          ...g,
          stories: g.stories.filter(s => Date.parse(s.expires_at) > action.nowMs && !removed.has(s.id)),
        }))
        .filter(g => g.stories.length > 0);
      if (groups.length === 0) {
        return { ...state, groups, groupIndex: 0, storyIndex: 0, closed: true };
      }
      // Stay on the same story if it survived; else the same provider at the
      // same position (the next one slides in); else the next provider.
      let groupIndex = groups.findIndex(g => g.providerId === currentGroup);
      let storyIndex: number;
      if (groupIndex === -1) {
        groupIndex = Math.min(state.groupIndex, groups.length - 1);
        storyIndex = 0;
      } else {
        const group = groups[groupIndex] as StoryGroup;
        const same = current === null ? -1 : group.stories.findIndex(s => s.id === current.id);
        storyIndex = same !== -1 ? same : Math.min(state.storyIndex, group.stories.length - 1);
      }
      return { ...state, groups, groupIndex, storyIndex };
    }
  }
}

/**
 * How long a story plays: an image its display time, a video its clip length,
 * both capped at the 30s the backend allows (143) so a file that lies about
 * its length still stops.
 */
export function playMs(story: Pick<Story, 'media_type' | 'duration_ms'>): number {
  const fallback = story.media_type === 'video' ? MAX_VIDEO_MS : IMAGE_DISPLAY_MS;
  const ms = Number.isFinite(story.duration_ms) && story.duration_ms > 0 ? story.duration_ms : fallback;
  return Math.min(MAX_VIDEO_MS, ms);
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export type StoryNoticeCode = StoryError | DraftProblem | 'UPLOAD' | 'NETWORK';

/** One line per refusal. Contact-guard refusals go through contactGuardNotice first. */
export const STORY_NOTICE: Record<StoryNoticeCode, string> = {
  UNAUTHORIZED: 'Session expired. Reopen the app to continue.',
  BAD_REQUEST: 'That could not be posted.',
  NOT_FOUND: 'This story is no longer available.',
  FORBIDDEN: 'That is not available to you.',
  SUSPENDED: 'Your account is under review.',
  POLICY_REQUIRED: 'Accept the latest Terms and Privacy Policy to continue.',
  STORIES_DISABLED: 'Stories are paused right now. Try again later.',
  NOT_LISTED: 'Stories open once your profile is live.',
  MEDIA_MISSING: 'The upload did not finish. Try again.',
  MEDIA_MISMATCH: 'That file type is not supported.',
  MEDIA_RELEASED: 'That upload expired. Try again.',
  LIMIT_REACHED: 'You have 30 live stories, the most at once. One has to expire first.',
  RATE_LIMITED: 'Slow down a moment, then try again.',
  UNSUPPORTED: 'Pick a JPEG, PNG or WebP photo, or an MP4 video.',
  TOO_LONG: 'Videos can be up to 30 seconds.',
  TOO_SHORT: 'Videos need to be at least a second long.',
  TOO_LARGE: 'That file is over 50 MB.',
  UPLOAD: 'The upload failed. Check your connection and try again.',
  NETWORK: 'Could not reach Pappal. Check your connection.',
};

export function storyNotice(code: string | null | undefined): string {
  return (code && (STORY_NOTICE as Record<string, string>)[code]) || STORY_NOTICE.BAD_REQUEST;
}

/**
 * The backend refuses a provider's own comment (147: "the story's provider
 * cannot reply"). The UI never offers the input to the story's owner; this is
 * the one predicate both the sheet and its test read.
 */
export function canComment(viewerId: string | undefined, story: Pick<Story, 'provider_id'>): boolean {
  return viewerId !== undefined && viewerId !== story.provider_id;
}

/** "now", "12m", "3h": how long ago a story went up. Stories live 24h, so never days. */
export function storyAge(createdAt: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 60_000));
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.min(23, Math.floor(minutes / 60))}h`;
}

/** Whether the viewer is the story's provider: delete, insights and comment hearts. */
export function isOwnStory(viewerId: string | undefined, story: Pick<Story, 'provider_id'>): boolean {
  return viewerId !== undefined && viewerId === story.provider_id;
}
