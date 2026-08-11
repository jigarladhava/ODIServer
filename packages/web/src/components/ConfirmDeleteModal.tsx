import { useState } from 'react';
import { deleteEntity } from '../lib/api-client';
import type { EntityKind } from '../lib/types';
import { Modal } from './Modal';

export interface DeleteTarget {
  kind: EntityKind;
  id: string;
  name: string;
  /** Channel id for devices, device id for tags — used to reselect the parent. */
  parentId?: string;
}

interface ConfirmDeleteModalProps {
  target: DeleteTarget | null;
  onClose: () => void;
  onDeleted: (target: DeleteTarget) => void;
}

const cascadeNote: Record<EntityKind, string | null> = {
  channel: ' All of its devices and tags will also be deleted.',
  device: ' All of its tags will also be deleted.',
  tag: null,
};

export function ConfirmDeleteModal({ target, onClose, onDeleted }: ConfirmDeleteModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!target) return null;

  const onConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      await deleteEntity(target.kind, target.id);
      onDeleted(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Delete ${target.kind}`} onClose={onClose}>
      <p className="text-[12px]">
        Delete {target.kind}{' '}
        <span translate="no" className="font-mono font-medium">
          {target.name}
        </span>
        ?{cascadeNote[target.kind]}
      </p>
      {error && (
        <p role="alert" className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-bad">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2.5">
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-sm border border-border bg-inset px-3 text-[12px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="h-7 rounded-sm border border-bad bg-bad px-3 text-[12px] font-medium text-white enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-bad"
        >
          {busy ? 'Deleting…' : `Delete ${target.kind}`}
        </button>
      </div>
    </Modal>
  );
}
