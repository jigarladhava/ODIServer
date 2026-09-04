import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Optional action button (e.g. Undo). */
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay; defaults to 6s (10s when an action is present). */
  durationMs?: number;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, string> = {
  info: 'border-border bg-panel text-fg',
  success: 'border-good bg-good-bg text-good',
  error: 'border-bad bg-bad-bg text-bad',
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`flex w-72 items-center gap-2 rounded-sm border px-2.5 py-2 text-[12px] shadow-lg ${toneStyles[toast.tone]}`}
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss();
          }}
          className="shrink-0 rounded-sm border border-current px-2 py-0.5 text-[11px] font-medium hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="shrink-0 px-1 text-muted hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    window.clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
      const durationMs = toast.durationMs ?? (toast.action ? 10_000 : 6_000);
      timers.current.set(id, window.setTimeout(() => dismiss(id), durationMs));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-8 right-3 z-50 flex flex-col items-end gap-2 [&>*]:pointer-events-auto"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}
