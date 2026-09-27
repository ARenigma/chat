/**
 * The "+ Reply" sheet: the caption, the quick reactions, the public comments
 * and, for a member, the comment input.
 *
 * Owner rules (2026-09-26) this file is the shape of:
 *   - comments are free and PUBLIC, shown as name + avatar only (148's feed);
 *   - reactions are free, counts public, who reacted only in the provider's
 *     insights (146, 149);
 *   - the provider CANNOT reply (147 refuses it); they get a heart per
 *     comment instead (148), which members see as "Liked by creator";
 *   - no camera or mic in the input until media moderation exists.
 *
 * BIDI: every piece of user text (caption, commenter name, comment body) is
 * its own <Text> node and is never concatenated with app copy, so a name
 * holding right-to-left or isolate characters cannot reorder the words
 * around it (the review's isolation note).
 *
 * Motion: none of its own. The sheet's rise and drag are Sheet.tsx's; the
 * reaction chips and hearts change fill, not position (a state change seen
 * tens of times a session: emil-design-eng "should this animate", no).
 */
import React, { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import {
  storyRefusalLine,
  useDeleteStoryComment,
  usePostStoryComment,
  useReactToComment,
  useStoryComments,
  useStoryReactions,
  useToggleStoryReaction,
  blockCommentAuthor,
  reportStoryComment,
} from '../../api/stories';
import { getReasonLabel, useContactGuardMode, useKillSwitches, useReportTaxonomy, FALLBACK_REPORT_TAXONOMY } from '../../api/appConfig';
import { precheckContactGuard, contactGuardNotice } from '../../lib/contactGuard';
import type { ReportReason, Story, StoryCommentFeedItem } from '../../lib/database.types';
import { newUuid } from '../../lib/ids';
import { REACTION_CHOICES } from '../../lib/reactions';
import { SCROLL_PHYSICS } from '../../lib/scroll';
import { MAX_COMMENT_CHARS, canComment, isOwnStory, storyAge } from '../../lib/stories';
import { useStore } from '../../store/useStore';
import { TOKENS, type Theme } from '../../theme/tokens';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { Pressable } from '../Pressable';
import { SendButton } from '../SendButton';
import { Sheet } from '../Sheet';
import { TextField } from '../TextField';

interface Props {
  visible: boolean;
  story: Story;
  selfId: string | undefined;
  onClose: () => void;
}

type Acting = { comment: StoryCommentFeedItem; step: 'menu' | 'reasons'; intent: 'report' | 'remove' };

function StoryReplySheetView({ visible, story, selfId, onClose }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const own = isOwnStory(selfId, story);
  const member = canComment(selfId, story);
  const { data: kill } = useKillSwitches();
  const storiesOn = kill?.stories_enabled !== false;
  const guardMode = useContactGuardMode();
  const setNotice = useStore(s => s.setNotice);

  const reactions = useStoryReactions(story.id, visible);
  const toggle = useToggleStoryReaction(story.id);
  const comments = useStoryComments(story.id, visible);
  const post = usePostStoryComment(story.id);
  const remove = useDeleteStoryComment(story.id);
  const heart = useReactToComment(story.id);
  const { data: taxonomy = FALLBACK_REPORT_TAXONOMY } = useReportTaxonomy();

  const [draft, setDraft] = useState('');
  // Minted once per comment and kept until it posts, so a retry after a lost
  // response is the same comment (147).
  const [commentId, setCommentId] = useState(newUuid);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [acting, setActing] = useState<Acting | null>(null);
  const [sentCount, setSentCount] = useState(0);

  const countOf = (emoji: string) => reactions.counts.find(c => c.emoji === emoji)?.reaction_count ?? 0;

  const send = () => {
    const body = draft.trim();
    if (body === '' || post.isPending) {
      return;
    }
    const refusal = precheckContactGuard(body, guardMode);
    if (refusal !== null) {
      setInlineError(contactGuardNotice({ ...refusal, surface: 'story_comment' }));
      return;
    }
    post.mutate(
      { body, commentId },
      {
        onSuccess: result => {
          if (result.success) {
            setDraft('');
            setInlineError(null);
            setCommentId(newUuid());
            setSentCount(n => n + 1);
          } else {
            setInlineError(storyRefusalLine(result));
          }
        },
        onError: () => setInlineError(storyRefusalLine({ error: 'NETWORK' })),
      },
    );
  };

  const finishReport = async (reason: ReportReason) => {
    if (acting === null) {
      return;
    }
    const { comment, intent } = acting;
    setActing(null);
    if (intent === 'remove') {
      remove.mutate({ commentId: comment.id, report: { reason, reportId: newUuid() } });
      return;
    }
    const ok = await reportStoryComment(comment.id, reason, newUuid());
    setNotice(ok ? 'Reported. Thank you.' : 'Could not report right now.', ok ? 'confirm' : 'error');
  };

  const block = async (comment: StoryCommentFeedItem) => {
    setActing(null);
    const ok = await blockCommentAuthor(comment.id, own);
    setNotice(ok ? 'Blocked.' : 'Could not block right now.', ok ? 'confirm' : 'error');
    comments.refetch().catch(() => undefined);
  };

  const footer = member && storiesOn ? (
    <View>
      {inlineError !== null ? (
        <Text allowFontScaling style={styles.inlineError} accessibilityLiveRegion="polite">
          {inlineError}
        </Text>
      ) : null}
      <View style={styles.inputRow}>
        <TextField
          testID="story-comment-input"
          style={styles.input}
          value={draft}
          onChangeText={t => {
            setDraft(t);
            setInlineError(null);
          }}
          placeholder="Add a public comment"
          placeholderTextColor={theme.color.text.tertiary}
          maxLength={MAX_COMMENT_CHARS}
          multiline
          allowFontScaling
          underlineColorAndroid="transparent"
        />
        <SendButton onPress={send} disabled={draft.trim() === '' || post.isPending} sendHaloKey={sentCount} />
      </View>
      <Text allowFontScaling style={styles.publicNote}>
        Comments are public. Your name and picture show beside them.
      </Text>
    </View>
  ) : undefined;

  if (acting !== null) {
    return (
      <Sheet
        visible={visible}
        title={acting.step === 'reasons' ? 'Why?' : 'Comment'}
        onClose={() => setActing(null)}
        onCancel={() => setActing(null)}
        cancelLabel="Back"
        testID="story-comment-actions">
        {acting.step === 'reasons'
          ? taxonomy.reasons.map(slug => (
              <ActionRow
                key={slug}
                label={getReasonLabel(slug)}
                onPress={() => {
                  finishReport(slug as ReportReason).catch(() => undefined);
                }}
                testID={`story-comment-reason-${slug}`}
              />
            ))
          : commentActions(acting.comment, own).map(a => (
              <ActionRow
                key={a.key}
                label={a.label}
                danger={a.danger}
                testID={`story-comment-${a.key}`}
                onPress={() => {
                  if (a.key === 'report' || a.key === 'removeReport') {
                    setActing({ ...acting, step: 'reasons', intent: a.key === 'report' ? 'report' : 'remove' });
                  } else if (a.key === 'block') {
                    block(acting.comment).catch(() => undefined);
                  } else {
                    setActing(null);
                    remove.mutate({ commentId: acting.comment.id });
                  }
                }}
              />
            ))}
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} title="Comments" onClose={onClose} detents="large" footer={footer} testID="story-reply-sheet">
      <ScrollView {...SCROLL_PHYSICS} nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.scroll}>
        {story.caption !== null ? (
          <Text allowFontScaling style={styles.caption} testID="story-caption">
            {story.caption}
          </Text>
        ) : null}

        <View style={styles.reactionRow} accessibilityRole={member ? undefined : 'summary'}>
          {REACTION_CHOICES.map(emoji => {
            const count = countOf(emoji);
            const mine = reactions.mine === emoji;
            const chip = (
              <View style={[styles.chip, mine && styles.chipMine]}>
                <Text allowFontScaling={false} style={styles.chipEmoji}>
                  {emoji}
                </Text>
                {count > 0 ? (
                  <Text allowFontScaling style={styles.chipCount}>
                    {count}
                  </Text>
                ) : null}
              </View>
            );
            return member && storiesOn ? (
              <Pressable
                key={emoji}
                onPress={() => toggle.mutate(emoji)}
                accessibilityLabel={mine ? `Remove ${emoji}` : `React ${emoji}`}
                selected={mine}
                press="chip"
                testID={`story-react-${emoji}`}>
                {chip}
              </Pressable>
            ) : (
              <View key={emoji} accessible accessibilityLabel={`${emoji} ${count}`}>
                {chip}
              </View>
            );
          })}
        </View>

        {own ? (
          <Text allowFontScaling style={styles.ownNote}>
            You can like comments. Replies are off on your own story.
          </Text>
        ) : null}

        {(comments.data ?? []).length === 0 && !comments.isLoading ? (
          <Text allowFontScaling style={styles.empty}>
            No comments yet.
          </Text>
        ) : null}

        {(comments.data ?? []).map(c => (
          <View key={c.id} style={styles.comment} testID={`story-comment-${c.id}`}>
            <Avatar initial={c.author_display_name.slice(0, 1).toUpperCase()} uri={c.author_avatar_url} size={34} />
            <View style={styles.commentBody}>
              <View style={styles.commentHead}>
                <Text allowFontScaling numberOfLines={1} style={styles.commentName}>
                  {c.author_display_name}
                </Text>
                <Text allowFontScaling style={styles.commentAge}>
                  {storyAge(c.created_at, Date.now())}
                </Text>
              </View>
              <Text allowFontScaling style={styles.commentText}>
                {c.body}
              </Text>
              {!own && c.creator_reaction !== null ? (
                <View style={styles.liked} testID={`story-comment-liked-${c.id}`}>
                  <Icon name="heart" active size={TOKENS.icon.xs} color={theme.color.text.accent} />
                  <Text allowFontScaling style={styles.likedText}>
                    Liked by creator
                  </Text>
                </View>
              ) : null}
            </View>
            {own ? (
              <Pressable
                onPress={() => heart.mutate({ commentId: c.id, emoji: '❤️' })}
                accessibilityLabel={c.creator_reaction !== null ? 'Unlike comment' : 'Like comment'}
                selected={c.creator_reaction !== null}
                press="chip"
                shape="circle"
                size={40}
                testID={`story-comment-heart-${c.id}`}>
                <Icon
                  name="heart"
                  active={c.creator_reaction !== null}
                  size={TOKENS.icon.md}
                  color={c.creator_reaction !== null ? theme.color.text.accent : theme.color.text.tertiary}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setActing({ comment: c, step: 'menu', intent: 'report' })}
              accessibilityLabel="Comment options"
              press="chip"
              shape="circle"
              size={40}
              testID={`story-comment-more-${c.id}`}>
              <Icon name="more" size={TOKENS.icon.md} color={theme.color.text.tertiary} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** What each role may do to a comment, in the order the menu lists it. */
function commentActions(
  comment: Pick<StoryCommentFeedItem, 'is_own'>,
  viewerIsProvider: boolean,
): { key: 'delete' | 'report' | 'removeReport' | 'block' | 'remove'; label: string; danger?: boolean }[] {
  if (comment.is_own) {
    return [{ key: 'delete', label: 'Delete comment', danger: true }];
  }
  if (viewerIsProvider) {
    return [
      { key: 'remove', label: 'Remove comment', danger: true },
      { key: 'removeReport', label: 'Remove and report' },
      { key: 'block', label: 'Block this person' },
    ];
  }
  return [
    { key: 'report', label: 'Report comment' },
    { key: 'block', label: 'Block this person' },
  ];
}

const ActionRow = memo(function ActionRowView({
  label,
  onPress,
  danger,
  testID,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} press="row" testID={testID} style={styles.actionRow}>
      <Text allowFontScaling style={[styles.actionLabel, danger && styles.actionDanger]}>
        {label}
      </Text>
    </Pressable>
  );
});

export const StoryReplySheet = memo(StoryReplySheetView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    scroll: {
      flexGrow: 0,
    },
    caption: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      marginBottom: TOKENS.space.md,
    },
    reactionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.xs,
      marginBottom: TOKENS.space.md,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      minHeight: TOKENS.interaction.minTarget,
      minWidth: TOKENS.interaction.minTarget,
      paddingHorizontal: TOKENS.space.sm,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.sunken,
      justifyContent: 'center',
    },
    chipMine: {
      backgroundColor: t.color.bg.selected,
      borderWidth: 1,
      borderColor: t.color.border.accent,
    },
    chipEmoji: {
      fontSize: 20,
      lineHeight: 24,
    },
    chipCount: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.primary,
    },
    ownNote: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      marginBottom: TOKENS.space.sm,
    },
    empty: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      paddingVertical: TOKENS.space.md,
    },
    comment: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.xs,
    },
    commentBody: {
      flex: 1,
      minWidth: 0,
    },
    commentHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: TOKENS.space.xs,
    },
    commentName: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.primary,
      flexShrink: 1,
    },
    commentAge: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
    commentText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.primary,
    },
    liked: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      marginTop: TOKENS.space['2xs'],
    },
    likedText: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: TOKENS.space.xs,
    },
    input: {
      flex: 1,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      backgroundColor: t.color.bg.sunken,
      borderRadius: TOKENS.radius.lg,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
      minHeight: TOKENS.interaction.minTarget,
      maxHeight: TOKENS.layout.field * 2,
    },
    publicNote: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      marginTop: TOKENS.space.xs,
    },
    inlineError: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.primary,
      marginBottom: TOKENS.space.xs,
    },
    actionRow: {
      minHeight: TOKENS.layout.rowOneLine,
      justifyContent: 'center',
    },
    actionLabel: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    actionDanger: {
      color: t.color.state.danger,
    },
  });
