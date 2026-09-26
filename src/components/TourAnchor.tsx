import React, { useCallback, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useHomeTour, type TourTargetId } from '../store/useHomeTour';

interface Props {
  id: TourTargetId;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Whether this copy of the anchor may register. Defaults to true.
   *
   * Home renders one Chats rail and one Explore head PER PAGE of its category
   * pager, and both pages are laid out at once (the neighbour off screen, one
   * page-width to the side). Two anchors with one id would each register on
   * layout and the last to lay out would win — possibly the off-screen one,
   * whose window rect is a page-width away from anything the member can see.
   * Only the settled page's copy registers. The two pages share one geometry,
   * so a rect registered by either while it was settled is the right rect.
   */
  active?: boolean;
}

/**
 * Registers a window-space rect for the Home spotlight tour.
 * `collapsable={false}` so Android does not flatten the view before measure.
 */
export function TourAnchor({ id, children, style, active = true }: Props) {
  const register = useHomeTour(s => s.register);
  const ref = useRef<View>(null);

  const onLayout = useCallback(() => {
    if (!active) {
      return;
    }
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        register(id, { x, y, width, height });
      }
    });
  }, [active, id, register]);

  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} style={style}>
      {children}
    </View>
  );
}
