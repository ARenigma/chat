import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import {
  RenderModeType,
  RtcSurfaceView,
  VideoMirrorModeType,
} from 'react-native-agora';
import type { CallVideoSource } from './types';

interface Props {
  source: CallVideoSource;
  style: StyleProp<ViewStyle>;
  objectFit?: 'cover' | 'contain';
  mirror?: boolean;
  zOrder?: number;
}

/**
 * Vendor-neutral video surface entry point. Today only Agora ships; add a
 * branch here when a second SDK is reintroduced — CallScreen stays untouched.
 */
export function CallVideoView({
  source,
  style,
  objectFit = 'cover',
  mirror = false,
}: Props) {
  return (
    <RtcSurfaceView
      canvas={{
        uid: source.uid,
        renderMode:
          objectFit === 'contain'
            ? RenderModeType.RenderModeFit
            : RenderModeType.RenderModeHidden,
        mirrorMode: mirror
          ? VideoMirrorModeType.VideoMirrorModeEnabled
          : VideoMirrorModeType.VideoMirrorModeDisabled,
      }}
      zOrderMediaOverlay={source.local}
      style={style}
    />
  );
}
