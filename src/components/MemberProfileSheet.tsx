/**
 * A safe read-only profile sheet for when a provider wants to see who they
 * are talking to.
 *
 * Members are pseudonymous by design (CLAUDE.md). This sheet exposes only what
 * the server already hands the provider through conversation_peers (migration
 * 103): a generated handle and a bundled clay avatar.
 *
 * No phone, email, real name, balance, legal identity, or real photo — ever.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { initialOf } from '../lib/display';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

interface Props {
  visible: boolean;
  peerName: string;
  peerAvatarUrl: string | null;
  onClose: () => void;
}

export function MemberProfileSheet({
  visible,
  peerName,
  peerAvatarUrl,
  onClose,
}: Props) {
  const styles = useStyles(makeStyles);

  return (
    <Sheet
      visible={visible}
      title="Member profile"
      onClose={onClose}
      testID="member-profile-sheet"
    >
      <View style={styles.root}>
        {/* Avatar: always clay — member photos are never stored. */}
        <Avatar
          initial={initialOf(peerName)}
          uri={peerAvatarUrl}
          size={88}
        />
        <Text
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
          style={styles.name}
          testID="member-profile-name"
        >
          {peerName}
        </Text>
        <Text allowFontScaling style={styles.caption}>
          Anonymous member
        </Text>
        <View style={styles.note}>
          <Text allowFontScaling style={styles.noteText}>
            Member identities are kept private to protect their anonymity.
          </Text>
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      paddingHorizontal: TOKENS.space.xl,
      paddingTop: TOKENS.space.md,
      paddingBottom: TOKENS.space.xl,
      alignItems: 'center',
      gap: TOKENS.space.sm,
    },
    name: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
    },
    caption: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      textAlign: 'center',
    },
    note: {
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.lg,
      padding: TOKENS.space.md,
      marginTop: TOKENS.space.sm,
    },
    noteText: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
