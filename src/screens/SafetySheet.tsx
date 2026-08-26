import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ReportReason } from '../lib/database.types';
import { useBlockUser, useIsBlocked, useSubmitReport, useUnblockUser } from '../api/safety';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { TextField } from '../components/TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
  conversationId: string | undefined;
  peerId: string | undefined;
  peerName: string;
  /** The message that prompted this, if the user long-pressed a specific one. */
  messageId: string | null;
}

/**
 * Reasons, in the order a distressed person scans them rather than alphabetically
 * or by internal severity. `self_harm` is worded as concern for the other person
 * because that is what it is, it routes to support, not enforcement.
 */
const REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'sexual_content', label: 'Unwanted sexual content' },
  { value: 'minor_safety', label: 'They may be under 18' },
  { value: 'solicitation', label: 'Asking to move off the app, or for money' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'self_harm', label: 'I am worried about their safety' },
  { value: 'other', label: 'Something else' },
];

type Step = 'menu' | 'reasons' | 'detail';

/**
 * One sheet for both remedies, because they are the same decision at different
 * intensities: blocking is immediate and needs nobody, reporting asks a human to
 * look. Presenting them together means a user in a bad moment does not have to
 * find two separate places.
 */
export function SafetySheet({
  visible,
  onClose,
  conversationId,
  peerId,
  peerName,
  messageId,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');

  const blocked = useIsBlocked(peerId);
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const report = useSubmitReport();

  const dismiss = (): void => {
    setStep('menu');
    setReason(null);
    setDetail('');
    onClose();
  };

  const submit = (): void => {
    if (conversationId === undefined || reason === null) {
      return;
    }
    report.mutate(
      {
        conversationId,
        messageId,
        reason,
        detail: detail.trim() === '' ? null : detail.trim(),
      },
      { onSuccess: dismiss },
    );
  };

  if (step === 'reasons') {
    return (
      <Sheet
        visible={visible}
        testID="report-reasons"
        title="What Happened?"
        body="This goes to a person on our team. Nothing you pick here is shared with them."
        onCancel={() => setStep('menu')}
        cancelLabel="Back"
        onClose={dismiss}>
        {/* iOS table cells, not Material list items. They carried radius.md, no
            separators, no chevrons and no `press` prop at all, so each one
            inherited `press="card"` and a full-width row visibly shrank 2.5% under
            the finger, which on a list of eight reads as the row wobbling. */}
        <View style={styles.reasons}>
          {REASONS.map((r, i) => (
            <React.Fragment key={r.value}>
              <Pressable
                testID={`reason-${r.value}`}
                accessibilityLabel={r.label}
                press="none"
                highlight="ios"
                onPress={() => {
                  setReason(r.value);
                  setStep('detail');
                }}
                style={styles.reasonRow}>
                <Text allowFontScaling style={styles.reasonLabel}>
                  {r.label}
                </Text>
                <Icon name="chevronRight" size={13} color={theme.color.text.tertiary} />
              </Pressable>
              {i === REASONS.length - 1 ? null : <View style={styles.reasonSeparator} />}
            </React.Fragment>
          ))}
        </View>
      </Sheet>
    );
  }

  if (step === 'detail') {
    return (
      <Sheet
        visible={visible}
        testID="report-detail"
        title="Anything to Add?"
        body="Optional. The message you reported is already attached."
        onCancel={() => setStep('reasons')}
        cancelLabel="Back"
        onClose={dismiss}>
        <TextField
          testID="report-detail-input"
          style={styles.input}
          value={detail}
          onChangeText={setDetail}
          placeholder="What should we know?"
          placeholderTextColor={theme.color.text.tertiary}
          multiline
          maxLength={2000}
          allowFontScaling
          underlineColorAndroid="transparent"
        />
        <Button
          label="Submit Report"
          busy={report.isPending}
          busyLabel="Submitting report"
          onPress={submit}
          testID="report-submit"
        />
        {/* Reporting without blocking is a real choice, the reporter may want
            the conversation to continue while a human looks at it. */}
        <Button
          label="Submit and Block"
          kind="danger"
          busy={report.isPending}
          busyLabel="Submitting report"
          onPress={() => {
            if (peerId !== undefined) {
              block.mutate(peerId);
            }
            submit();
          }}
          testID="report-submit-and-block"
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      testID="safety-sheet"
      title={peerName}
      body={
        blocked
          ? 'You have blocked this person. Neither of you can message the other.'
          : 'Blocking is immediate and they are not told. Reporting asks our team to look.'
      }
      onCancel={dismiss}
      onClose={dismiss}>
      {/* Both of these had a pending `disabled` and no label for it, so the one
          action in the app somebody takes while frightened gave no feedback at
          all until it finished. */}
      {blocked ? (
        <Button
          label="Unblock"
          busy={unblock.isPending}
          busyLabel="Unblocking"
          onPress={() => {
            if (peerId !== undefined) {
              unblock.mutate(peerId, { onSuccess: dismiss });
            }
          }}
          testID="unblock-user"
        />
      ) : (
        <Button
          label={`Block ${peerName}`}
          kind="danger"
          busy={block.isPending}
          busyLabel="Blocking"
          onPress={() => {
            if (peerId !== undefined) {
              block.mutate(peerId, { onSuccess: dismiss });
            }
          }}
          testID="block-user"
        />
      )}
      <Button
        label="Report a Problem"
        kind="secondary"
        onPress={() => setStep('reasons')}
        testID="open-report"
      />
    </Sheet>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  reasons: {
    alignSelf: 'stretch',
    paddingBottom: TOKENS.space.sm,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: TOKENS.space.sm,
    // space.sm already yields a 44pt cell, so the target needs nothing added.
    paddingVertical: TOKENS.space.sm,
  },
  reasonSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.color.border.hairline,
  },
  reasonLabel: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.primary,
  },
  input: {
    alignSelf: 'stretch',
    minHeight: 88,
    maxHeight: 160,
    padding: TOKENS.space.md,
    marginBottom: TOKENS.space.sm,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.primary,
    textAlignVertical: 'top',
  },
});
