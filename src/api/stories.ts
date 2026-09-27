/**
 * Stories, the network half (migrations 143-152).
 *
 * Every call is a plain async function first and a react-query hook second,
 * so the calls are unit-tested against a mocked client (__tests__/storiesApi
 * .test.ts) without rendering anything. The hooks add caching, invalidation
 * and the notice line, nothing else.
 *
 * Reads: `stories` (RLS is story_is_visible, so a row that arrives may be
 * shown), `story_views` (own rows: what is seen), `story_comment_feed` (the
 * only read of comments), and three RPCs for counts and the provider's
 * insights. Media is never read from the bucket: 144 gives clients no SELECT
 * policy, and `story-media-url` signs for at most 60 seconds after its own
 * visibility check.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { newUuid } from '../lib/ids';
import { contactGuardNotice } from '../lib/contactGuard';
import { armStallDetector } from '../lib/uploadStall';
import type {
  CreateStoryResult,
  MyStoryInsight,
  PostStoryCommentResult,
  ReactionEmoji,
  ReportReason,
  Story,
  StoryCommentFeedItem,
  StoryMediaUrl,
  StoryReaction,
  StoryReactionCount,
  StoryReactionResult,
  StoryViewer,
} from '../lib/database.types';
import {
  STORIES_BUCKET,
  draftDurationMs,
  draftProblem,
  normaliseCaption,
  storyMediaPath,
  storyMimeForPath,
  storyNotice,
  type StoryDraft,
} from '../lib/stories';
import { useStore } from '../store/useStore';

const storyKeys = {
  all: ['stories'] as const,
  live: ['stories', 'live'] as const,
  seen: ['stories', 'seen'] as const,
  media: (storyId: string) => ['stories', 'media', storyId] as const,
  counts: (storyId: string) => ['stories', 'counts', storyId] as const,
  mine: (storyId: string) => ['stories', 'myReaction', storyId] as const,
  comments: (storyId: string) => ['stories', 'comments', storyId] as const,
  insights: ['stories', 'insights'] as const,
  viewers: (storyId: string) => ['stories', 'viewers', storyId] as const,
};

/** A refusal as the line to show: the contact guard's own copy first. */
export function storyRefusalLine(result: { error?: string | null } | null | undefined): string {
  return contactGuardNotice(result) ?? storyNotice(result?.error ?? null);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every live story the caller may see, newest first (RLS filters audience). */
async function fetchLiveStories(): Promise<Story[]> {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as Story[];
}

/** The ids of stories the caller has seen (own rows only, 145). */
async function fetchSeenStoryIds(): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await supabase.from('story_views').select('story_id').gt('viewed_at', since);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as { story_id: string }[]).map(r => r.story_id);
}

/** A short-lived signed URL, after the function's own visibility check. */
export async function fetchStoryMediaUrl(storyId: string): Promise<StoryMediaUrl> {
  const { data, error } = await supabase.functions.invoke<StoryMediaUrl>('story-media-url', {
    body: { story_id: storyId },
  });
  if (error || data === null || typeof data?.url !== 'string') {
    throw new Error('NOT_FOUND');
  }
  return data;
}

async function fetchReactionCounts(storyId: string): Promise<StoryReactionCount[]> {
  const { data, error } = await supabase.rpc('story_reaction_counts', { p_story_id: storyId });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as StoryReactionCount[];
}

async function fetchMyReaction(storyId: string): Promise<ReactionEmoji | null> {
  const { data, error } = await supabase
    .from('story_reactions')
    .select('emoji')
    .eq('story_id', storyId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return ((data as Pick<StoryReaction, 'emoji'> | null)?.emoji ?? null) as ReactionEmoji | null;
}

export async function fetchComments(storyId: string): Promise<StoryCommentFeedItem[]> {
  const { data, error } = await supabase
    .from('story_comment_feed')
    .select('*')
    .eq('story_id', storyId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as StoryCommentFeedItem[];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function markStoryViewed(storyId: string): Promise<void> {
  await supabase.rpc('mark_story_viewed', { p_story_id: storyId });
}

/** Same emoji again takes it back (146); the result's emoji is the new state. */
export async function toggleStoryReaction(storyId: string, emoji: ReactionEmoji): Promise<StoryReactionResult> {
  const { data, error } = await supabase.rpc('toggle_story_reaction', { p_story_id: storyId, p_emoji: emoji });
  if (error) {
    return { success: false, error: 'BAD_REQUEST' };
  }
  return data as StoryReactionResult;
}

/**
 * `commentId` is minted once per comment and resent on a retry (147), so a
 * retry after a lost response is the original success, not a duplicate.
 */
export async function postStoryComment(
  storyId: string,
  body: string,
  commentId: string,
): Promise<PostStoryCommentResult> {
  const { data, error } = await supabase.rpc('post_story_comment', {
    p_comment_id: commentId,
    p_story_id: storyId,
    p_body: body,
  });
  if (error) {
    return { success: false, error: 'BAD_REQUEST' };
  }
  return data as PostStoryCommentResult;
}

/**
 * The author removes their own; the provider removes one on their story, and
 * with a reason the report is filed first in the same transaction (150).
 */
async function deleteStoryComment(
  commentId: string,
  report?: { reason: ReportReason; reportId: string },
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('delete_story_comment', {
    p_comment_id: commentId,
    p_report_reason: report?.reason ?? null,
    p_report_id: report?.reportId ?? null,
  });
  if (error) {
    return { success: false, error: 'BAD_REQUEST' };
  }
  return data as { success: boolean; error?: string };
}

/** The provider's one public reaction to a comment on their own story (148). */
export async function reactToStoryComment(commentId: string, emoji: ReactionEmoji): Promise<StoryReactionResult> {
  const { data, error } = await supabase.rpc('react_to_story_comment', { p_comment_id: commentId, p_emoji: emoji });
  if (error) {
    return { success: false, error: 'BAD_REQUEST' };
  }
  return data as StoryReactionResult;
}

export async function reportStory(storyId: string, reason: ReportReason, reportId: string): Promise<boolean> {
  const { error } = await supabase.rpc('report_story', {
    p_story_id: storyId,
    p_reason: reason,
    p_report_id: reportId,
  });
  return !error;
}

export async function reportStoryComment(commentId: string, reason: ReportReason, reportId: string): Promise<boolean> {
  const { error } = await supabase.rpc('report_story_comment', {
    p_comment_id: commentId,
    p_reason: reason,
    p_report_id: reportId,
  });
  return !error;
}

/** A member blocks a comment's author; the provider blocks a commenter (152). */
export async function blockCommentAuthor(commentId: string, asProvider: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc(asProvider ? 'block_story_commenter' : 'block_story_comment_author', {
    p_comment_id: commentId,
  });
  return !error && (data as { success?: boolean } | null)?.success === true;
}

export async function deleteOwnStory(storyId: string): Promise<boolean> {
  const { error } = await supabase.from('stories').delete().eq('id', storyId);
  return !error;
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * The upload, the shape attachments.ts uses and for its reason: RN's FormData
 * cannot carry storage-js's body, a `{ uri, name, type }` part streams the
 * file natively, and XHR is the only transport with upload progress. No
 * `x-upsert`: a story's media is evidence once reported (150).
 */
function uploadStoryMedia(
  path: string,
  uri: string,
  accessToken: string,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  const type = storyMimeForPath(path);
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', {
    uri: uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`,
    name: `story.${path.slice(path.lastIndexOf('.') + 1)}`,
    type,
  } as unknown as Blob);

  return new Promise<boolean>(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ENV.supabaseUrl}/storage/v1/object/${STORIES_BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', ENV.supabaseAnonKey);
    if (onProgress !== undefined) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(e.loaded / e.total);
        }
      };
    }
    // A stall detector, not a total timeout: a 40 MB clip on a slow but
    // moving link must not be killed (uploadStall.ts).
    const disarm = armStallDetector(xhr, 30_000);
    const done = (ok: boolean) => {
      disarm();
      resolve(ok);
    };
    // "Already exists" at THIS path is a success, not a conflict: the path is
    // this story's own (its id, its owner), so the object can only be the
    // earlier attempt of this same post whose response was lost. Without this
    // a retry after a dropped response could never finish, since no x-upsert.
    xhr.onload = () =>
      done(
        (xhr.status >= 200 && xhr.status < 300) ||
          xhr.status === 409 ||
          /already exists|duplicate/i.test(xhr.responseText ?? ''),
      );
    xhr.onerror = () => done(false);
    xhr.onabort = () => done(false);
    xhr.send(form);
  });
}

/** Where a post attempt stands; `storyId` is kept across retries. */
export interface PostAttempt {
  storyId: string;
  /** The upload finished; a retry only re-runs create_story. */
  uploaded: boolean;
}

export type PostOutcome =
  | { ok: true; storyId: string }
  | { ok: false; line: string; attempt: PostAttempt; retryable: boolean };

/**
 * Upload, then create_story. The id is minted by the client (143: the media
 * is named after it), kept across a retry so a lost response is the same
 * story, and replaced only after MEDIA_RELEASED, which says the old id is
 * spent.
 */
export async function postStory(
  providerId: string,
  draft: StoryDraft,
  caption: string,
  previous: PostAttempt | null,
  onProgress?: (fraction: number) => void,
): Promise<PostOutcome> {
  const attempt: PostAttempt = previous ?? { storyId: newUuid(), uploaded: false };
  const problem = draftProblem(draft);
  if (problem !== null) {
    return { ok: false, line: storyNotice(problem), attempt, retryable: false };
  }
  const path = storyMediaPath(providerId, attempt.storyId, draft.mime);
  if (path === null) {
    return { ok: false, line: storyNotice('UNSUPPORTED'), attempt, retryable: false };
  }
  if (!attempt.uploaded) {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (token === undefined) {
      return { ok: false, line: storyNotice('UNAUTHORIZED'), attempt, retryable: false };
    }
    const ok = await uploadStoryMedia(path, draft.uri, token, onProgress);
    if (!ok) {
      return { ok: false, line: storyNotice('UPLOAD'), attempt, retryable: true };
    }
    attempt.uploaded = true;
  }
  const { data, error } = await supabase.rpc('create_story', {
    p_story_id: attempt.storyId,
    p_media_type: draft.mediaType,
    p_media_path: path,
    p_caption: normaliseCaption(caption),
    p_duration_ms: draftDurationMs(draft),
  });
  if (error) {
    return { ok: false, line: storyNotice('NETWORK'), attempt, retryable: true };
  }
  const result = data as CreateStoryResult;
  if (result.success && result.story_id) {
    return { ok: true, storyId: result.story_id };
  }
  if (result.error === 'MEDIA_RELEASED' || result.error === 'MEDIA_MISSING') {
    // The id is spent or its object is gone: the retry starts over.
    return { ok: false, line: storyNotice(result.error), attempt: { storyId: newUuid(), uploaded: false }, retryable: true };
  }
  const retryable = result.error === 'RATE_LIMITED';
  return { ok: false, line: storyRefusalLine(result), attempt, retryable };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useLiveStories(enabled = true) {
  return useQuery<Story[]>({
    queryKey: storyKeys.live,
    queryFn: fetchLiveStories,
    enabled,
    staleTime: 30_000,
    // Stories are not in the realtime publication (143), so the rail polls,
    // paused in the background through focusManager (App.tsx).
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useSeenStoryIds(enabled = true) {
  return useQuery<ReadonlySet<string>>({
    queryKey: storyKeys.seen,
    queryFn: async () => new Set(await fetchSeenStoryIds()),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The signed URL. A mount after 40s mints a new one (the signature lasts 60);
 * a mounted story keeps its URL, with no refetch on focus, because a new URL
 * under a playing clip would restart it. A 30s MP4 is buffered long before
 * its signature lapses.
 */
export function useStoryMedia(storyId: string | undefined) {
  return useQuery<StoryMediaUrl>({
    queryKey: storyKeys.media(storyId ?? ''),
    queryFn: () => fetchStoryMediaUrl(storyId as string),
    enabled: storyId !== undefined,
    staleTime: 40_000,
    gcTime: 50_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useMarkStoryViewed() {
  const qc = useQueryClient();
  return useCallback(
    (storyId: string) => {
      const seen = qc.getQueryData<ReadonlySet<string>>(storyKeys.seen);
      if (seen?.has(storyId)) {
        return;
      }
      qc.setQueryData<ReadonlySet<string>>(storyKeys.seen, prev => new Set([...(prev ?? []), storyId]));
      markStoryViewed(storyId).catch(() => undefined);
    },
    [qc],
  );
}

export function useStoryReactions(storyId: string | undefined, enabled: boolean) {
  const counts = useQuery<StoryReactionCount[]>({
    queryKey: storyKeys.counts(storyId ?? ''),
    queryFn: () => fetchReactionCounts(storyId as string),
    enabled: enabled && storyId !== undefined,
  });
  const mine = useQuery<ReactionEmoji | null>({
    queryKey: storyKeys.mine(storyId ?? ''),
    queryFn: () => fetchMyReaction(storyId as string),
    enabled: enabled && storyId !== undefined,
  });
  return { counts: counts.data ?? [], mine: mine.data ?? null };
}

export function useToggleStoryReaction(storyId: string | undefined) {
  const qc = useQueryClient();
  const setNotice = useStore(s => s.setNotice);
  return useMutation({
    mutationFn: (emoji: ReactionEmoji) => toggleStoryReaction(storyId as string, emoji),
    onSuccess: result => {
      if (!result.success) {
        setNotice(storyRefusalLine(result));
        return;
      }
      qc.setQueryData(storyKeys.mine(storyId as string), result.emoji ?? null);
      qc.invalidateQueries({ queryKey: storyKeys.counts(storyId as string) }).catch(() => undefined);
    },
  });
}

export function useStoryComments(storyId: string | undefined, enabled: boolean) {
  return useQuery<StoryCommentFeedItem[]>({
    queryKey: storyKeys.comments(storyId ?? ''),
    queryFn: () => fetchComments(storyId as string),
    enabled: enabled && storyId !== undefined,
    refetchInterval: enabled ? 20_000 : false,
  });
}

/** Posting a comment. The caller keeps `commentId` until success so a retry reuses it. */
export function usePostStoryComment(storyId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, commentId }: { body: string; commentId: string }) =>
      postStoryComment(storyId as string, body, commentId),
    onSuccess: result => {
      if (result.success) {
        qc.invalidateQueries({ queryKey: storyKeys.comments(storyId as string) }).catch(() => undefined);
      }
    },
  });
}

export function useDeleteStoryComment(storyId: string | undefined) {
  const qc = useQueryClient();
  const setNotice = useStore(s => s.setNotice);
  return useMutation({
    mutationFn: ({ commentId, report }: { commentId: string; report?: { reason: ReportReason; reportId: string } }) =>
      deleteStoryComment(commentId, report),
    onSuccess: result => {
      if (!result.success) {
        setNotice(storyRefusalLine(result));
      }
      qc.invalidateQueries({ queryKey: storyKeys.comments(storyId as string) }).catch(() => undefined);
    },
  });
}

export function useReactToComment(storyId: string | undefined) {
  const qc = useQueryClient();
  const setNotice = useStore(s => s.setNotice);
  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: ReactionEmoji }) =>
      reactToStoryComment(commentId, emoji),
    onSuccess: (result, { commentId }) => {
      if (!result.success) {
        setNotice(storyRefusalLine(result));
        return;
      }
      qc.setQueryData<StoryCommentFeedItem[]>(storyKeys.comments(storyId as string), prev =>
        prev?.map(c => (c.id === commentId ? { ...c, creator_reaction: result.emoji ?? null } : c)),
      );
    },
  });
}

export function useMyStoryInsights(enabled: boolean) {
  return useQuery<MyStoryInsight[]>({
    queryKey: storyKeys.insights,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_story_insights', {});
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? []) as MyStoryInsight[];
    },
    enabled,
  });
}

export function useStoryViewers(storyId: string | undefined, enabled: boolean) {
  return useQuery<StoryViewer[]>({
    queryKey: storyKeys.viewers(storyId ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('story_viewers', { p_story_id: storyId as string });
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? []) as StoryViewer[];
    },
    enabled: enabled && storyId !== undefined,
  });
}

/** After a delete or a post: the rail, the viewer and insights all re-read. */
export function useInvalidateStories() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: storyKeys.all }).catch(() => undefined);
  }, [qc]);
}
