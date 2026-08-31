import React, { useCallback, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useHomeTour, type TourTargetId } from '../store/useHomeTour';

interface Props {
  id: TourTargetId;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Registers a window-space rect for the Home spotlight tour.
 * `collapsable={false}` so Android does not flatten the view before measure.
 */
export function TourAnchor({ id, children, style }: Props) {
  const register = useHomeTour(s => s.register);
  const ref = useRef<View>(null);

  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        register(id, { x, y, width, height });
      }
    });
  }, [id, register]);

  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={style}>
      {children}
    </View>
  );
}
