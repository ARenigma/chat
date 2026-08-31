import React, { useMemo, useState } from 'react';
import { useRailPrefs } from '../store/useRailPrefs';
import { ConfirmDialog } from './ConfirmDialog';
import { PaperMenu, type MenuAnchor, type PaperMenuItem } from './PaperMenu';

interface Props {
  peerId: string | null;
  /** Rail offers Remove (hide from Home only). The extended list does not. */
  surface: 'rail' | 'list';
  visible: boolean;
  onClose: () => void;
  /** Window rect of the long-pressed face/row — menu sits next to it. */
  anchor: MenuAnchor | null;
}

/**
 * Pin / Remove / Delete for a conversation.
 *
 * Remove is rail-only: the face leaves Home, the row stays in Chats. Delete
 * confirms, then hides the conversation from both lists on this device.
 */
export function ConversationMenu({ peerId, surface, visible, onClose, anchor }: Props) {
  const pinned = useRailPrefs(s => (peerId !== null ? s.pinned.includes(peerId) : false));
  const togglePin = useRailPrefs(s => s.togglePin);
  const hideFromRail = useRailPrefs(s => s.hideFromRail);
  const deleteLocal = useRailPrefs(s => s.deleteLocal);
  const [confirm, setConfirm] = useState(false);

  const items = useMemo<readonly PaperMenuItem[]>(() => {
    if (peerId === null) {
      return [];
    }
    const rows: PaperMenuItem[] = [
      {
        key: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        onPress: () => togglePin(peerId),
      },
    ];
    if (surface === 'rail') {
      rows.push({
        key: 'remove',
        label: 'Remove from Home',
        onPress: () => hideFromRail(peerId),
      });
    }
    rows.push({
      key: 'delete',
      label: 'Delete',
      danger: true,
      keepOpen: true,
      onPress: () => setConfirm(true),
    });
    return rows;
  }, [peerId, pinned, surface, togglePin, hideFromRail]);

  return (
    <>
      <PaperMenu
        visible={visible && peerId !== null && !confirm}
        items={items}
        onClose={onClose}
        anchor={anchor}
        testID="conversation-menu"
      />
      <ConfirmDialog
        visible={confirm && peerId !== null}
        title="Delete this chat?"
        body="It leaves your lists on this device. Their chat is unchanged."
        cancelLabel="Cancel"
        confirmLabel="Delete"
        destructive
        testID="conversation-delete"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          if (peerId !== null) {
            deleteLocal(peerId);
          }
          setConfirm(false);
          onClose();
        }}
      />
    </>
  );
}
