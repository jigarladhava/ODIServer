import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md overscroll-contain rounded-sm border border-border bg-panel"
      >
        <div className="flex h-9 items-center justify-between border-b border-border px-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M3 3l10 10M13 3 3 13" />
            </svg>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto px-3 py-3">{children}</div>
        {footer && (
          <div className="flex h-11 items-center justify-end gap-2 border-t border-border px-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
