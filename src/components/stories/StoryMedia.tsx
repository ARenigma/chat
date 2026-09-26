/**
 * One story's picture or clip, filling the viewer.
 *
 * The URL comes from `story-media-url` (144): signed for at most 60 seconds
 * after the function's own visibility check, cached for 40 by useStoryMedia.
 * A 404 is "no longer available" and nothing more, by the function's design.
 *
 * VIDEO (react-native-video 6.19.3; Media3 ExoPlayer on Android). Android's
 * media guidance for a short in-feed clip, applied:
 *   - muted by default, the viewer's tap-to-unmute is the only way to sound,
 *     because an autoplaying clip with audio is the one thing Android's
 *     audio-focus guidance says an app must not surprise a user with
 *     (https://developer.android.com/media/optimize/audio-focus). Muted, the
 *     player asks for no focus (`disableFocus`), so it never pauses the
 *     user's music; unmuted, it does.
 *   - paused whenever the story is not live on screen (held, sheet open,
 *     screen blurred, app backgrounded) and never played in the background
 *     (`playInBackground` false, the default, stated), per the Media3 player
 *     lifecycle (https://developer.android.com/media/media3/exoplayer/hello-world).
 *   - looped while open (`repeat`), and stopped by the viewer's own clock at
 *     `duration_ms`, capped at 30s (playMs), so a file that lies about its
 *     length still ends.
 *   - poster: the backend stores no thumbnail, so the poster is the viewer's
 *     dark surface with a loading mark until the first frame
 *     (`onReadyForDisplay`). A real poster frame needs a server-side
 *     thumbnail; stated here as the deviation.
 */
import React, { memo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';

import { useStoryMedia } from '../../api/stories';
import type { Story } from '../../lib/database.types';
import { STORY_NOTICE } from '../../lib/stories';
import { TOKENS } from '../../theme/tokens';
import { LoadingIndicator } from '../LoadingIndicator';

interface Props {
  story: Story;
  /** Whether the story is live: plays the clip. */
  playing: boolean;
  muted: boolean;
  /** Media is on screen; the clock may start. */
  onReady: (storyId: string) => void;
  onFailed: (storyId: string) => void;
}

function StoryMediaView({ story, playing, muted, onReady, onFailed }: Props) {
  const media = useStoryMedia(story.id);
  const [shown, setShown] = useState(false);
  const url = media.data?.url;

  const ready = () => {
    setShown(true);
    onReady(story.id);
  };
  const failed = () => onFailed(story.id);

  return (
    <View style={styles.fill}>
      {url !== undefined && story.media_type === 'image' ? (
        <Image
          source={{ uri: url }}
          style={styles.fill}
          resizeMode="contain"
          onLoad={ready}
          onError={failed}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {url !== undefined && story.media_type === 'video' ? (
        <Video
          source={{ uri: url }}
          style={styles.fill}
          resizeMode="contain"
          paused={!playing}
          muted={muted}
          repeat
          playInBackground={false}
          disableFocus={muted}
          onReadyForDisplay={ready}
          onError={failed}
        />
      ) : null}
      {media.isError ? (
        <View style={styles.center}>
          <Text allowFontScaling style={styles.error}>
            {STORY_NOTICE.NOT_FOUND}
          </Text>
        </View>
      ) : !shown ? (
        <View style={styles.center} pointerEvents="none">
          <LoadingIndicator />
        </View>
      ) : null}
    </View>
  );
}

export const StoryMedia = memo(StoryMediaView);

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    ...TOKENS.typography.bodyMedium,
    color: '#FFFFFF',
    paddingHorizontal: TOKENS.space.xl,
    textAlign: 'center',
  },
});
