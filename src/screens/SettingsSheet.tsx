import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteAccount, signOut } from '../api/auth';
import { track } from '../lib/telemetry';
import { useMyApplication } from '../api/provider';
import { resetStore, useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onSignedOut: () => void;
  /** Absent on the provider tree — a provider does not apply again. */
  onApply?: () => void;
  onApplicationStatus?: () => void;
}

/**
 * Account and privacy.
 *
 * Identity linking is gone with the anonymous session: the phone number *is* the
 * account, so there is nothing to upgrade. What replaced it is the route into
 * provider onboarding, which needs to live somewhere a member can find without
 * being advertised at — becoming a provider is a deliberate act, not a nudge.
 */
export function SettingsSheet({
  visible,
  onClose,
  onDeleted,
  onSignedOut,
  onApply,
  onApplicationStatus,
}: Props) {
  const setNotice = useStore(s => s.setNotice);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: application } = useMyApplication();

  const onDelete = useCallback(async () => {
    setBusy(true);
    try {
      await deleteAccount();
      track('account_deleted');
      queryClient.clear();
      resetStore();
      // No fresh session to start any more: deletion signs you out, and the
      // phone screen is where you land.
      onDeleted();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [onDeleted, queryClient, setNotice]);

  const onSignOutPress = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
      queryClient.clear();
      resetStore();
      onSignedOut();
    } finally {
      setBusy(false);
    }
  }, [onSignedOut, queryClient]);

  if (confirming) {
    return (
      <Sheet
        visible={visible}
        testID="delete-confirm-sheet"
        title="Delete everything?"
        body={
          'This permanently deletes your profile, every conversation and every ' +
          'message. It cannot be undone. Abuse reports you or someone else filed ' +
          'are kept without your name, so they cannot be erased by deleting an ' +
          'account.'
        }
        onClose={() => setConfirming(false)}>
        <Button
          label={busy ? 'Deleting…' : 'Yes, delete everything'}
          kind="danger"
          disabled={busy}
          onPress={() => {
            void onDelete();
          }}
          testID="delete-confirm"
        />
        <Button label="Cancel" kind="secondary" onPress={() => setConfirming(false)} />
      </Sheet>
    );
  }

  const hasApplication = application !== null && application !== undefined;

  return (
    <Sheet
      visible={visible}
      testID="settings-sheet"
      title="Account & privacy"
      body={
        'Signed in with your phone number, which is never shown to anyone you ' +
        'talk to. No contacts, no location, no photos, no advertising ID.'
      }
      onClose={onClose}>
      {hasApplication && onApplicationStatus !== undefined ? (
        <Button
          label="My provider application"
          onPress={onApplicationStatus}
          testID="settings-application"
        />
      ) : onApply !== undefined ? (
        <Button label="Become a provider" onPress={onApply} testID="settings-apply" />
      ) : null}
      <Button
        label="Sign out"
        kind="secondary"
        disabled={busy}
        onPress={() => {
          void onSignOutPress();
        }}
        testID="sign-out"
      />
      <Button
        label="Delete account & all data"
        kind="danger"
        onPress={() => setConfirming(true)}
        testID="delete-account"
      />
      <Button label="Close" kind="secondary" onPress={onClose} />
    </Sheet>
  );
}
