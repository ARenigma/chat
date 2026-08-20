import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deleteAccount, ensureSession, linkGoogle } from '../api/auth';
import { resetStore, useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';

interface Props {
  visible: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Account and privacy. Two jobs: optional identity linking so a reinstall keeps
 * her history, and the Play Store data-deletion route — one destructive action
 * that hard deletes the auth user, cascading to profile, chats and messages in a
 * single transaction. No soft delete, no retention window.
 */
export function SettingsSheet({ visible, onClose, onDeleted }: Props) {
  const setNotice = useStore(s => s.setNotice);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const onLink = useCallback(async () => {
    setBusy(true);
    try {
      await linkGoogle();
      setNotice('Continue in your browser to finish linking.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not start linking');
    } finally {
      setBusy(false);
    }
  }, [setNotice]);

  const onDelete = useCallback(async () => {
    setBusy(true);
    try {
      await deleteAccount();
      queryClient.clear();
      resetStore();
      await ensureSession();
      onDeleted();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete account');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }, [onDeleted, queryClient, setNotice]);

  if (confirming) {
    return (
      <Sheet
        visible={visible}
        testID="delete-confirm-sheet"
        title="Delete everything?"
        body={
          'This permanently deletes your profile, every conversation and every ' +
          'message. It cannot be undone.'
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

  return (
    <Sheet
      visible={visible}
      testID="settings-sheet"
      title="Account & privacy"
      body={
        'You’re signed in anonymously. No contacts, no location, no photos, no ' +
        'advertising ID. Link an identity only if you want your history to survive ' +
        'a reinstall.'
      }
      onClose={onClose}>
      <Button label="Link Google" disabled={busy} onPress={() => {
          void onLink();
        }} />
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
