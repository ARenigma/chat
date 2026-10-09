/**
 * A provider posts a story: pick, preview, optional caption, Post.
 *
 * PICKER (RULE 1). The Android Photo Picker, through react-native-image-picker
 * 7.2.3, whose `launchImageLibrary` builds `PickVisualMedia` with
 * `ImageAndVideo` for a single pick (ImagePickerModuleImpl.java:124-152).
 * The Photo Picker needs NO storage permission: the app declares only
 * READ_MEDIA_VISUAL_USER_SELECTED, and nothing here asks for more
 * (https://developer.android.com/training/data-storage/shared/photopicker).
 * On devices without the system picker, androidx.activity's contract falls
 * back to ACTION_OPEN_DOCUMENT, still permission-free.
 *
 * LIMITS, checked before a byte is uploaded (lib/stories.ts, tested): JPEG,
 * PNG or WebP photos, MP4 video of 1-30 s, under 50 MB, which are 143's and
 * 144's own rules. The picker reports a video's duration in whole seconds
 * (VideoMetadata.java:39 divides milliseconds by 1000), so a 30.9 s clip reads
 * as 30 and is accepted; the player stops every story at 30 s (playMs).
 * Photos are re-encoded to at most 1920 px on the long edge, a full-screen
 * frame on the densest phone this app targets, as attachments.ts bounds chat
 * photos for the same reason (a 12 MP original is several MB on a slow link).
 *
 * POSTING: upload to `stories/{provider_id}/{story_id}.{ext}` with byte
 * progress, then create_story. The story id is kept across a retry
 * (api/stories.ts postStory), so a lost response is the same story, not two.
 * Refusals map to one line each: the cap (30 live), the kill switch, too
 * long, the contact guard on the caption.
 *
 * D7 fixes:
 *  - IME handling: `useImeSpace` pads the root so the caption field is not
 *    covered by the keyboard, matching ProviderEditProfileScreen.
 *    https://developer.android.com/develop/ui/views/layout/insets#ime-animations
 *  - Discard confirm: `usePreventRemove` holds back-navigation when there is
 *    a draft, a non-empty caption, or an upload in progress, showing a
 *    ConfirmDialog rather than silently dropping the work.
 *    https://reactnavigation.org/docs/preventing-going-back
 *
 * Motion: none. The screen is a push (the platform's transition); the
 * progress bar is the shared ProgressBar, a determinate M3 indicator.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { launchImageLibrary, type Asset } from 'react-native-image-picker';
import Video from 'react-native-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';

import { useContactGuardMode, useKillSwitches } from '../api/appConfig';
import { useSelfId } from '../api/chat';
import { postStory, useInvalidateStories, type PostAttempt } from '../api/stories';
import { BackButton } from '../components/BackButton';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProgressBar } from '../components/ProgressBar';
import { TextField } from '../components/TextField';
import { contactGuardNotice, precheckContactGuard } from '../lib/contactGuard';
import {
  MAX_CAPTION_CHARS,
  captionTooLong,
  draftProblem,
  storyNotice,
  type StoryDraft,
} from '../lib/stories';
import { useImeSpace } from '../lib/useImeSpace';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useStore } from '../store/useStore';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

const PHOTO_MAX = 1920;

interface Props {
  onBack: () => void;
  onPosted: () => void;
}

/** The picker's asset as a draft; null when it is not something a story can be. */
function draftFromAsset(asset: Asset | undefined): StoryDraft | null {
  if (asset?.uri === undefined) {
    return null;
  }
  const mime = (asset.type ?? '').toLowerCase();
  const isVideo = mime.startsWith('video/');
  return {
    uri: asset.uri,
    mime,
    mediaType: isVideo ? 'video' : 'image',
    durationMs: isVideo && typeof asset.duration === 'number' ? asset.duration * 1000 : null,
    bytes: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

export function StoryCreateScreen({ onBack, onPosted }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // D7: IME space so the caption field is never covered by the keyboard.
  // https://developer.android.com/develop/ui/views/layout/insets#ime-animations
  const imeSpace = useImeSpace();
  const navigation = useNavigation();
  const { data: selfId } = useSelfId();
  const { data: kill } = useKillSwitches();
  const storiesOn = kill?.stories_enabled !== false;
  const guardMode = useContactGuardMode();
  const invalidate = useInvalidateStories();
  const setNotice = useStore(s => s.setNotice);

  const [draft, setDraft] = useState<StoryDraft | null>(null);
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState<PostAttempt | null>(null);

  // D7: discard guard — hold back-navigation when there is a draft, a
  // non-empty caption, or an upload in progress.
  // https://reactnavigation.org/docs/preventing-going-back
  const hasDraft = draft !== null || caption.trim().length > 0 || posting;
  const [heldAction, setHeldAction] = useState<NavigationAction | null>(null);

  usePreventRemove(hasDraft, ({ data }) => {
    setHeldAction(data.action);
  });

  const pick = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'mixed',
      selectionLimit: 1,
      maxWidth: PHOTO_MAX,
      maxHeight: PHOTO_MAX,
      quality: 0.9,
      videoQuality: 'high',
    });
    if (result.didCancel) {
      if (draft === null) {
        onBack();
      }
      return;
    }
    const next = draftFromAsset(result.assets?.[0]);
    if (next === null) {
      setError(storyNotice('UNSUPPORTED'));
      return;
    }
    const problem = draftProblem(next);
    setError(problem === null ? null : storyNotice(problem));
    setDraft(problem === null ? next : null);
    setAttempt(null);
    setProgress(0);
  }, [draft, onBack]);

  // The screen opens on the picker: "Your story" is a request to pick.
  useEffect(() => {
    pick().catch(() => setError(storyNotice('UNSUPPORTED')));
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const post = async () => {
    if (draft === null || selfId === undefined || posting) {
      return;
    }
    if (captionTooLong(caption)) {
      setError(`Captions can be up to ${MAX_CAPTION_CHARS} characters and 4 lines.`);
      return;
    }
    const refusal = precheckContactGuard(caption, guardMode);
    if (refusal !== null) {
      setError(contactGuardNotice({ ...refusal, surface: 'story_caption' }));
      return;
    }
    setPosting(true);
    setError(null);
    const out = await postStory(selfId, draft, caption, attempt, setProgress);
    setPosting(false);
    if (out.ok) {
      invalidate();
      setNotice('Your story is up for 24 hours.', 'confirm');
      onPosted();
      return;
    }
    setAttempt(out.attempt);
    setError(out.line);
  };

  return (
    // D7: paddingBottom is the IME space when the keyboard is up, else the
    // safe-area bottom inset (matching ProviderEditProfileScreen's pattern).
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: imeSpace > 0 ? imeSpace : insets.bottom }]}>
      <View style={styles.bar}>
        <BackButton onPress={onBack} />
        <Text
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLarge}
          accessibilityRole="header"
          style={styles.title}>
          New story
        </Text>
      </View>
      <ScrollView {...SCROLL_PHYSICS} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.preview} testID="story-create-preview">
          {draft?.mediaType === 'image' ? (
            <Image source={{ uri: draft.uri }} style={styles.media} resizeMode="contain" />
          ) : null}
          {draft?.mediaType === 'video' ? (
            <Video source={{ uri: draft.uri }} style={styles.media} resizeMode="contain" muted repeat disableFocus />
          ) : null}
          {draft === null ? (
            <Button label="Choose a photo or video" kind="secondary" onPress={() => { pick().catch(() => undefined); }} testID="story-create-pick" />
          ) : null}
        </View>
        {draft !== null ? (
          <Button label="Choose another" kind="secondary" onPress={() => { pick().catch(() => undefined); }} disabled={posting} testID="story-create-repick" />
        ) : null}
        <TextField
          testID="story-create-caption"
          style={styles.caption}
          value={caption}
          onChangeText={t => {
            setCaption(t);
            setError(null);
          }}
          placeholder="Add a caption (optional)"
          placeholderTextColor={theme.color.text.tertiary}
          maxLength={MAX_CAPTION_CHARS}
          multiline
          allowFontScaling
          underlineColorAndroid="transparent"
        />
        <Text allowFontScaling style={styles.hint}>
          Everyone on Pappal can see your story for 24 hours. Captions are public.
        </Text>
        {!storiesOn ? (
          <Text allowFontScaling style={styles.error}>
            {storyNotice('STORIES_DISABLED')}
          </Text>
        ) : null}
        {error !== null ? (
          <Text allowFontScaling style={styles.error} accessibilityLiveRegion="polite" testID="story-create-error">
            {error}
          </Text>
        ) : null}
        {posting ? <ProgressBar progress={progress} /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button
          label={attempt !== null && error !== null ? 'Try again' : 'Post'}
          onPress={() => { post().catch(() => undefined); }}
          disabled={draft === null || !storiesOn}
          busy={posting}
          busyLabel="Posting"
          testID="story-create-post"
        />
      </View>

      {/* D7: discard confirm — shown when back is pressed while there is a
          draft, a caption, or an upload in progress. The held action is
          replayed on "Discard" so hardware back, the header arrow and a tab
          re-press all land here. Same pattern as EditProfileRoute.
          https://reactnavigation.org/docs/preventing-going-back */}
      <ConfirmDialog
        visible={heldAction !== null}
        title="Discard story?"
        body={
          posting
            ? 'Your story is still uploading. Leaving will cancel it.'
            : 'Your draft will be lost.'
        }
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        destructive
        onCancel={() => setHeldAction(null)}
        onConfirm={() => {
          const action = heldAction;
          setHeldAction(null);
          if (action !== null) {
            navigation.dispatch(action);
          }
        }}
        testID="story-create-discard-confirm"
      />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.xs,
      minHeight: TOKENS.layout.appBarSmall,
    },
    title: {
      ...TOKENS.typography.titleLarge,
      color: t.color.text.primary,
    },
    body: {
      padding: TOKENS.space.md,
      gap: TOKENS.space.md,
    },
    preview: {
      aspectRatio: 9 / 16,
      maxHeight: 420,
      alignSelf: 'center',
      width: '100%',
      borderRadius: TOKENS.radius.lg,
      overflow: 'hidden',
      backgroundColor: t.color.bg.sunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    media: {
      ...StyleSheet.absoluteFill,
    },
    caption: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      backgroundColor: t.color.bg.sunken,
      borderRadius: TOKENS.radius.md,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      minHeight: TOKENS.layout.field,
      maxHeight: TOKENS.layout.field * 2.5,
    },
    hint: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    error: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.primary,
    },
    footer: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.sm,
    },
  });
