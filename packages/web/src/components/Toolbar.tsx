import type { ReactNode } from 'react';
import { PlusIcon, TrashIcon } from './icons';

interface ToolbarProps {
  onNewChannel: () => void;
  /** undefined → disabled (no channel/device selected to parent the new entity) */
  onNewDevice?: () => void;
  onNewTag?: () => void;
  /** undefined → disabled (nothing selected) */
  onDelete?: () => void;
  deleteLabel?: string;
}

const focusRing =
  'focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent';

function ToolButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 items-center gap-1.5 rounded-sm border border-transparent px-2 text-[12px] enabled:hover:border-border enabled:hover:bg-hover disabled:cursor-not-allowed disabled:text-muted ${focusRing}`}
    >
      {children}
    </button>
  );
}

export function Toolbar({ onNewChannel, onNewDevice, onNewTag, onDelete, deleteLabel }: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Configuration toolbar"
      className="flex h-9 items-center gap-0.5 border-b border-border bg-panel px-2"
    >
      <ToolButton onClick={onNewChannel} title="Add a new channel">
        <PlusIcon />
        New Channel
      </ToolButton>
      <ToolButton
        onClick={onNewDevice}
        disabled={!onNewDevice}
        title={onNewDevice ? 'Add a device to the selected channel' : 'Select a channel in the tree first'}
      >
        <PlusIcon />
        New Device
      </ToolButton>
      <ToolButton
        onClick={onNewTag}
        disabled={!onNewTag}
        title={onNewTag ? 'Add a tag to the selected device' : 'Select a device in the tree first'}
      >
        <PlusIcon />
        New Tag
      </ToolButton>
      <div role="separator" aria-orientation="vertical" className="mx-1.5 h-5 border-l border-border" />
      <ToolButton
        onClick={onDelete}
        disabled={!onDelete}
        title={onDelete ? (deleteLabel ?? 'Delete the selected entity') : 'Select a channel, device, or tag first'}
      >
        <TrashIcon />
        Delete
      </ToolButton>
    </div>
  );
}
