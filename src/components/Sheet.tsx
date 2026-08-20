import React, { memo, type ReactNode } from 'react';
import { Modal, Pressable as RNPressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';

interface Props {
  visible: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

const SPRING = {
  damping: TOKENS.motion.spring.damping,
  stiffness: TOKENS.motion.spring.stiffness,
  mass: TOKENS.motion.spring.mass,
};

/**
 * Bottom sheet. Never opened by a state change on its own — only by an explicit
 * tap or a blocked send, so it can never interrupt a conversation in progress.
 */
function SheetView({ visible, title, body, onClose, children, testID }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(TOKENS.motion.duration.fast)} style={styles.scrim}>
        <RNPressable style={styles.scrimFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <Animated.View
          testID={testID}
          entering={FadeInDown.springify()
            .damping(SPRING.damping)
            .stiffness(SPRING.stiffness)
            .mass(SPRING.mass)}
          style={styles.sheet}>
          <View style={styles.grabberRow}>
            <View style={styles.grabber} />
          </View>
          <Text testID="sheet-title" allowFontScaling style={styles.title}>
            {title}
          </Text>
          {body ? (
            <Text allowFontScaling style={styles.body}>
              {body}
            </Text>
          ) : null}
          <View style={styles.actions}>{children}</View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

export const Sheet = memo(SheetView);

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  scrimFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    paddingTop: 14,
    paddingHorizontal: TOKENS.space.xl,
    paddingBottom: TOKENS.space['2xl'],
    gap: TOKENS.space.sm,
    borderTopLeftRadius: TOKENS.radius.xl,
    borderTopRightRadius: TOKENS.radius.xl,
    backgroundColor: TOKENS.color.bg.raised,
    ...TOKENS.elevation.sheet,
  },
  grabberRow: {
    alignItems: 'center',
    paddingBottom: TOKENS.space.xs,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: TOKENS.color.border.hairline,
  },
  title: {
    ...TOKENS.typography.titleMedium,
    color: TOKENS.color.text.primary,
  },
  body: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  actions: {
    paddingTop: TOKENS.space.sm,
    gap: TOKENS.space.sm,
  },
});
